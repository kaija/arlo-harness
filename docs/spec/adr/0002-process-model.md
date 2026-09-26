# ADR-0002：行程模型與 Agent 生命週期

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：角色改為 Privacy Agent／Planner／Operator；新增腳本沙箱行程
- 適用階段：Phase 1

## 背景

規格第 3、6 點要求每個 Agent（Privacy Agent、Planner、每個 Operator）運行於獨立 Process / Worker，並且即使視窗在背景也要持續執行。Agent 需要完整 Node 環境（MCP stdio 子行程、檔案系統、Playwright），且一個 Operator 崩潰不得影響其他 Agent。

## 決策

1. **每個 Agent 一個 Electron `utilityProcess`**。Privacy Agent 一個；Planner 一個，只在 `privacy.mode = 'slm'` 時存在（[ADR-0005](0005-privacy-agent-and-task-dispatch.md)）；每個已啟用的 Persona 各一個 Operator。入口為 `apps/desktop/src/agent-host`，載入 `packages/agent-runtime`，依 spawn 參數的 `role`（`privacy-slm`、`privacy-llm`、`planner`、`operator`）組裝對應角色。
2. **IPC**：main 在 spawn 時建立 `MessageChannelMain`，一端交給 utilityProcess，一端由 main 的 broker 持有。所有 Agent ↔ main、Agent ↔ Agent 通訊都經由 main 轉發（星型），詳見 [ADR-0004](0004-a2a-over-messageport.md)。
3. **生命週期：App 啟動時全部常駐**。App 就緒後 spawn Privacy Agent、（SLM 模式下的）Planner，以及 SQLite 中所有已啟用 Persona 的 Operator 行程。行程不因閒置回收。切換 `privacy.mode` 時只啟停 Planner 並重新組裝 Privacy Agent 的角色，進行中的任務以原模式完成。
4. **崩潰處理**：main 監聽 `exit` 事件；非預期退出時記錄到 Action Center（severity=error）、將該 Agent 進行中的 A2A Task 標記 `failed`，並以指數退避（1s、5s、30s，最多 3 次）自動重啟。重啟後 Thread 歷程從 SQLite 還原。
5. **注入資訊**：spawn 時透過 `utilityProcess.fork(path, args, { env, serviceName })` 傳入 role、personaId、workspace 路徑、CDP 連線資訊；Provider 金鑰以初始 MessagePort 訊息注入（不走 env，避免 `ps` 可見），詳見 [ADR-0011](0011-persistence-secrets-observability.md)。綁定 `cloud` Provider 的 Agent 另外收到 Privacy Agent 的偵測器綁定與政策快照，供 Gate 使用（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）。
6. **停用 / 刪除 Persona（或因模式切換停止 Planner）**：先送 A2A `tasks/cancel` 給所有進行中 Task，等待最多 10 秒後 `kill()`。
7. **腳本沙箱行程**：compute-to-data 的腳本由 main 的 `sandbox/*` 服務以 OS 沙箱包裝後用 `child_process` 啟動（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)），每次執行一個短命行程，執行結束或逾時即終止。它不是 Agent，不接 MessagePort，也不常駐。

## 考慮過的替代方案

- **Node `child_process` / `worker_threads`**：與 Electron 解耦、好測；但需自行處理生命週期，且無法直接享有 Electron 的 MessagePort 整合。utilityProcess 本質上就是 Electron 管理的 child_process，取其官方支援。
- **每個 Agent 一個隱藏 renderer**：renderer sandbox 限制 Node API，且背景節流風險高。否決。
- **單行程 async 隔離**：違反規格第 6 點。否決。
- **懶啟動 + 閒置回收**：資源省，但觸發有冷啟動延遲（MCP 子行程、Playwright 連線）。使用者明確選擇常駐。

## 後果

- Operator 數量增加時記憶體線性增長（每個 utilityProcess 約 50–100 MB 未含 MCP 子行程）。ADR 記為已知代價；UI 應顯示各 Agent 的行程資源用量。SLM 模式多一個 Planner 行程。
- 崩潰隔離有效：一個 Operator 的 MCP server 掛掉不影響其他人。Privacy Agent 崩潰期間，main 暫存新的入口訊息，等它重啟後再送達；進行中的 Operator 不受影響，因為 Gate 直接呼叫偵測器 Provider，不經過 Privacy Agent 行程（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）。
- 所有跨行程資料都需可序列化（structured clone），`packages/shared` 定義 IPC 契約型別。

## 關聯

[ADR-0004](0004-a2a-over-messageport.md) A2A 傳輸、[ADR-0007](0007-window-and-viewport-model.md) 視窗模型、[ADR-0011](0011-persistence-secrets-observability.md) 持久化與機密。
