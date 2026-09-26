# ADR-0011：持久化、機密儲存與可觀測性

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：新增 `privacy_vault`、`privacy_ledger`、`sandbox_runs`；OTLP 外送受 trustZone 限制
- 修訂：2026-09-26：新增 `privacy_cases`
- 適用階段：Phase 1

## 背景

需要儲存 Persona / Provider / 排程設定、每個 Thread 的訊息、SDK RunState、A2A Task、通知、trace。API Key 需安全保存。OpenAI Agents SDK 預設把 trace 上傳到 OpenAI 平台，多 Provider 場景不適合。

## 決策

### 持久化

1. **main 持有單一 SQLite**（`better-sqlite3`，WAL 模式），路徑 `<userData>/arlo.db`。Migration 以 `drizzle-orm` + `drizzle-kit` 管理。
2. **Agent 行程不碰 DB**。agent-runtime 的 `IpcSession`、`IpcTaskStore`、`IpcTraceExporter` 都透過 MessagePort 對 main 發 `db/*` 請求；main 落庫後把變更以 `state/*` 事件廣播給相關 renderer。
3. 主要資料表：`personas`（yaml 快取與狀態）、`provider_profiles`、`secrets`、`threads`、`messages`、`run_states`、`a2a_tasks`、`delegations`、`schedules`、`schedule_runs`、`notifications`、`trace_spans`、`events`、`privacy_vault`、`privacy_ledger`、`sandbox_runs`、`privacy_cases`。
   - `messages`、`run_states`、`trace_spans` 保存**本機真值**：別名化只發生在送往雲端的請求上（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）。
   - `privacy_cases` 保存案件名稱、建立時間與綁定的 Thread；`privacy_vault` 以 `(scope_id, alias)` 為鍵，值以 `safeStorage` 加密；`privacy_ledger` 保存別名化後的外送內容與授權事件（[ADR-0016](0016-privacy-policy-ledger-and-transparency.md)）；`sandbox_runs` 保存腳本全文、後端、資源用量與結果摘要（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）。
4. persona.yaml 與 skills 以檔案系統為真相來源（[ADR-0008](0008-persona-workspace-and-skills.md)），DB 只存快取與執行狀態。

### 機密

5. API Key 以 Electron `safeStorage.encryptString()` 加密後存 `secrets` 表；只在 main 解密。
6. Agent 行程需要的 key（含 Gate 偵測器綁定的 key）由 main 在 spawn 與設定變更時以 MessagePort 訊息注入（不用 env，避免 `ps` / crash dump 洩漏）。
7. Renderer 永遠拿不到明文；UI 只顯示尾碼 4 碼。IPC 契約中不存在「讀取 secret」的方法。
8. `safeStorage.isEncryptionAvailable()` 為 false（Linux 無 keyring）時拒絕儲存 key 並提示，不 fallback 到明文。

### 可觀測性

9. agent-runtime 註冊自訂 `TracingProcessor`，把 span（agent、generation、function、MCP、guardrail）送回 main 寫 `trace_spans`；`setTracingDisabled(false)` 但移除預設的 OpenAI exporter，預設**不上傳** OpenAI。
10. Run streaming 事件（`raw_model_stream_event`、`run_item_stream_event`、`agent_updated_stream_event`）即時經 main 推到面板，面板顯示訊息、可展開的 reasoning（Provider 有回傳時）、工具呼叫輸入 / 輸出、耗時、token 用量。
11. 提供 OTLP exporter 開關（設定頁），開啟後同時把 span 送到使用者指定的 OTLP endpoint（Jaeger、Langfuse 等）。OTLP endpoint 也依 [ADR-0015](0015-privacy-gate-aliasing-and-vault.md) 的規則推導 trustZone：`local`／`private` 送完整 span；`cloud` 只送時間、名稱、狀態、token 用量等 metadata，移除所有內容屬性（輸入、輸出、工具參數）。
12. 保留策略：`trace_spans`、`messages`、`privacy_vault`、`privacy_ledger`、`sandbox_runs` 預設保留 90 天，設定可調；`notifications` 保留 30 天。沙箱 run 目錄在 run 結束 24 小時後刪除。

## 考慮過的替代方案

- **每個 Persona 自己一個 SQLite**：workspace 可整包搬移，但全域查詢要合併多 DB。
- **JSON / JSONL 檔案**：零原生依賴，但查詢與並發寫入痛。
- **OS keychain（@napi-rs/keyring）**：更標準但多一個原生依賴，Linux 需 secret-service；safeStorage 已由 Electron 內建處理。
- **保留 OpenAI 平台 tracing**：非 OpenAI Provider 的 trace 會失敗或洩漏。

## 後果

- `better-sqlite3` 是原生模組，需在 electron-builder 流程中 rebuild；CI 三平台都要驗證。
- main 成為所有寫入的瓶頸，但 SQLite 本機寫入吞吐遠高於 LLM 事件速率。
- Trace 資料與訊息一起在本機，離線可完整回放任一 Run。

## 關聯

[ADR-0002](0002-process-model.md) 行程、[ADR-0003](0003-agent-sdk-and-model-providers.md) Provider、[ADR-0009](0009-conversation-threads-and-concurrency.md) Thread。
