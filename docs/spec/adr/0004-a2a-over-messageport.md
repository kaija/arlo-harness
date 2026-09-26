# ADR-0004：A2A 協定與 MessagePort 傳輸

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：AgentId 改為 `privacy`／`planner`／`operator:<id>`，路由政策改以 Privacy Agent 為入口
- 適用階段：Phase 1

## 背景

規格第 10、13 點要求 Agent 之間採 A2A Protocol（a2a-js）進行標準化雙向通訊，支援同步 RPC 與非同步事件。a2a-js 的 client 預設以 fetch 打 HTTP，server 預設掛在 Express。我們的 Agent 在 utilityProcess 中，彼此以 MessagePort 相連，不希望為每個 Agent 開 HTTP port。

## 決策

1. **協定綁定**：A2A JSON-RPC（非 gRPC、非 REST）。訊息格式、Task 狀態機、Agent Card 完全沿用 `@a2a-js/sdk` 的型別與 `DefaultRequestHandler`。
2. **傳輸層**：`packages/a2a-transport` 提供
   - `MessagePortA2AServer`：在 Agent 行程內接收 JSON-RPC envelope，交給 a2a-js `DefaultRequestHandler` 處理；streaming 方法（`message/stream`、`tasks/resubscribe`）的 SSE 事件序列以 `{ kind: 'stream-event', requestId, event }` 逐筆回傳，`{ kind: 'stream-end', requestId }` 結尾。
   - `MessagePortA2AClient`：包裝 a2a-js `A2AClient`，注入自訂 `fetchImpl`，把 HTTP 語意轉為 MessagePort request/response，並把 stream-event 還原成 `ReadableStream`（SSE 格式）餵回 SDK。
   - `A2ABroker`（main）：持有每個 Agent 的 MessagePort、維護 Agent Card registry（`agentId → AgentCard`）、依 envelope 的 `to` 欄位路由。
3. **Envelope 格式**：
   ```ts
   { kind: 'a2a-request' | 'a2a-response' | 'stream-event' | 'stream-end',
     requestId: string, from: AgentId, to: AgentId, payload: JsonRpcMessage | A2AStreamEvent }
   ```
4. **AgentId**：`'privacy' | 'planner' | 'operator:<personaId>'`。`privacy`、`planner` 為保留字，不能當 personaId。main 自行發起的請求使用 `system:user`、`system:schedule`、`system:event`、`system:webhook` 作為 `from`。
5. **拓撲（v1）**：仍是經 main 的星型，路由政策如下：

   | from ↓ ／ to → | `privacy` | `planner` | `operator:*` |
   |---|---|---|---|
   | `system:*`（使用者、排程、事件、webhook） | ✅ | ❌ | 只有 `system:user`，限該 Operator 的使用者 Thread（介入） |
   | `privacy` | — | ✅ | ✅ |
   | `planner` | ✅ | — | ✅ |
   | `operator:*` | ✅（僅回應／`ask_delegator`） | ✅（僅回應／`ask_delegator`） | ❌ |

   不在表中的路由被拒（JSON-RPC error `-32003 forbidden route`，以 `error.data.reason` 區分）。`planner` 只存在於 SLM 模式；LLM 模式下送往 `planner` 會得到 `agent_unavailable`。broker 本身不限制拓撲，開放只需改路由策略。
6. **隱私 metadata**：A2A message 的 `metadata` 可帶 `arlo.privacyScope`（Vault scope，[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）與 `arlo.targetOperator`（入口指定的執行者，[ADR-0005](0005-privacy-agent-and-task-dispatch.md)）。只有 `privacy`、`planner` 與 `system:*` 可設定；broker 會移除 Operator 送出的這兩個鍵，並驗證 `privacyScope` 屬於該 Task 樹，Operator 因此不能冒用其他 scope 還原別名。
7. **Agent Card**：由 persona.yaml 的 `name`、`description`、`skills` 生成，發佈到 broker。派發者（Planner、LLM Flow 的 Privacy Agent）啟動與 Persona 變更時透過 `registry/updated` 事件重新拉取，詳見 [ADR-0005](0005-privacy-agent-and-task-dispatch.md)。
8. **Task 狀態持久化**：a2a-js 的 `TaskStore` 以 IPC 實作（`IpcTaskStore`），實際寫入 main 的 SQLite `a2a_tasks` 表，詳見 [ADR-0011](0011-persistence-secrets-observability.md)。
9. **對外 HTTP gateway**：不在 v1。schema 與 broker 設計保留 `to: 'external:<url>'` 的擴充點。

## 考慮過的替代方案

- **每個 Agent 開 localhost HTTP A2A server**：零自訂傳輸，但 port 管理、token、防火牆提示、以及 Persona 數量多時的 port 數量都是負擔。
- **真 gRPC**：需 HTTP/2，a2a-js 尚無 gRPC 綁定，需依 a2a.proto 自行實作。工程量最大。
- **只借 A2A schema 自建訊息**：失去與 A2A 生態互通。

## 後果

- SDK 升版風險集中在 `fetchImpl` 介面與 SSE 格式相容性，需以整合測試鎖定。
- 所有 Agent 間流量都經 main，main 是單點；但流量本身是控制訊息而非大資料，可接受。大型 artifact（截圖、檔案）以路徑或 SQLite blob id 傳遞，不放在 A2A message parts 內嵌。

## 關聯

[ADR-0002](0002-process-model.md) 行程模型、[ADR-0005](0005-privacy-agent-and-task-dispatch.md) 派發機制、[ADR-0009](0009-conversation-threads-and-concurrency.md) Thread 模型。
