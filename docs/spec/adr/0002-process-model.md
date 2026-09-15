# ADR-0002：行程模型與 Agent 生命週期

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 1

## 背景

規格第 3、6 點要求 Orchestrator 與每個 Persona Agent 運行於獨立 Process / Worker，並且即使視窗在背景也要持續執行。Agent 需要完整 Node 環境（MCP stdio 子行程、檔案系統、Playwright），且一個 Persona 崩潰不得影響其他 Agent。

## 決策

1. **每個 Agent 一個 Electron `utilityProcess`**。Orchestrator 一個，每個 Persona 一個。入口為 `apps/desktop/src/agent-host`，載入 `packages/agent-runtime`。
2. **IPC**：main 在 spawn 時建立 `MessageChannelMain`，一端交給 utilityProcess，一端由 main 的 broker 持有。所有 Agent ↔ main、Agent ↔ Agent 通訊都經由 main 轉發（星型），詳見 [ADR-0004](0004-a2a-over-messageport.md)。
3. **生命週期：App 啟動時全部常駐**。App 就緒後依 SQLite 中的 Persona 清單 spawn 所有已啟用的 Persona 行程與 Orchestrator 行程。行程不因閒置回收。
4. **崩潰處理**：main 監聽 `exit` 事件；非預期退出時記錄到 Action Center（severity=error）、將該 Persona 進行中的 A2A Task 標記 `failed`，並以指數退避（1s、5s、30s，最多 3 次）自動重啟。重啟後 Thread 歷程從 SQLite 還原。
5. **注入資訊**：spawn 時透過 `utilityProcess.fork(path, args, { env, serviceName })` 傳入 personaId、workspace 路徑、CDP 連線資訊；Provider 金鑰以初始 MessagePort 訊息注入（不走 env，避免 `ps` 可見），詳見 [ADR-0011](0011-persistence-secrets-observability.md)。
6. **停用 / 刪除 Persona**：先送 A2A `tasks/cancel` 給所有進行中 Task，等待最多 10 秒後 `kill()`。

## 考慮過的替代方案

- **Node `child_process` / `worker_threads`**：與 Electron 解耦、好測；但需自行處理生命週期，且無法直接享有 Electron 的 MessagePort 整合。utilityProcess 本質上就是 Electron 管理的 child_process，取其官方支援。
- **每個 Agent 一個隱藏 renderer**：renderer sandbox 限制 Node API，且背景節流風險高。否決。
- **單行程 async 隔離**：違反規格第 6 點。否決。
- **懶啟動 + 閒置回收**：資源省，但觸發有冷啟動延遲（MCP 子行程、Playwright 連線）。使用者明確選擇常駐。

## 後果

- Persona 數量增加時記憶體線性增長（每個 utilityProcess 約 50–100 MB 未含 MCP 子行程）。ADR 記為已知代價；UI 應顯示各 Persona 的行程資源用量。
- 崩潰隔離有效：一個 Persona 的 MCP server 掛掉不影響其他人。
- 所有跨行程資料都需可序列化（structured clone），`packages/shared` 定義 IPC 契約型別。

## 關聯

[ADR-0004](0004-a2a-over-messageport.md) A2A 傳輸、[ADR-0007](0007-window-and-viewport-model.md) 視窗模型、[ADR-0011](0011-persistence-secrets-observability.md) 持久化與機密。
