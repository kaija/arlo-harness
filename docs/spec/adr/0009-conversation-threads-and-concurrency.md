# ADR-0009：對話 Thread 模型與 Operator 並行度

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：入口改為 Privacy Agent；Thread 與 privacy scope 的關係
- 修訂：2026-09-26：可選的案件 scope
- 適用階段：Phase 1

## 背景

規格第 9、12 點要求每個 Agent 有專屬 Chat panel 顯示即時歷程，使用者可隨時介入；觸發來源涵蓋派發、手動、事件、排程。一個 Operator 可能同時收到多個來源的任務，需要定義歷程單位與並行語意。

## 決策

### Thread 模型

1. **Thread 以 A2A `contextId` 為單位**。每個 Thread 對應一個 SDK `Session`（自訂 `IpcSession`，實際存 main 的 SQLite `messages` 表）。模型只看到該 Thread 的歷程。
2. 每個 Operator 面板固定有一條 **使用者 Thread**（`contextId = user:<personaId>`），供使用者直接介入。Operator 綁雲端模型時，這條 Thread 的內容同樣經 Gate 別名化，面板以 ☁ 標示「此對話的內容會以別名化形式送往雲端」。
3. 每次委派（Planner 或 LLM Flow 的 Privacy Agent）各建一條 **Task Thread**，`contextId` 由發起方指定；派發者對同一連串任務可重用 `contextId` 以延續脈絡。排程、事件、webhook 觸發先在 Privacy Agent 建 Thread（[ADR-0012](0012-scheduler-events-notifications.md)），再依 route 委派。
4. 面板左側列出 Thread（依最近活動排序，顯示來源標籤：user / privacy / planner / schedule / event / webhook），使用者可切換到任一 Thread 介入。
5. Privacy Agent 的主對話是 `user:privacy`（主視窗），使用者也可以開新 Thread（`privacy:<uuid>`）；每個 async 委派完成事件注入發起的 Thread。Planner 的 Thread 由 Privacy Agent 建立，`contextId = planner:<privacy Thread contextId>`。
6. **privacy scope**：Vault 別名在同一個 scope 內一致（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）。Privacy Agent 的每條 Thread 各自是一個 scope，委派出去的 Planner／Operator Task Thread 繼承發起端的 scope；Operator 使用者 Thread 是自己的 scope。
7. **案件**：使用者可以建立案件，並把 Privacy Agent 的 Thread 綁定到案件（一條 Thread 最多屬於一個案件）。綁定後，該 Thread 與其委派出去的 Thread 都使用 `case:<caseId>` scope。主視窗 Thread 列表可依案件分組；案件刪除時可選擇一併刪除所屬 Thread。

### 並行度

7. persona.yaml 的 `maxConcurrency`（預設 1）決定同時執行的 Run 數。超出的 A2A Task 保持 `submitted` 排隊（FIFO），輪到才轉 `working`。
8. `maxConcurrency = 1` 時，使用者在正在執行的 Thread 打字視為**介入**：訊息入列為該 Run 的下一輪輸入（不中斷進行中的工具呼叫）；在其他 Thread 打字則排隊。
9. `maxConcurrency > 1` 時，每個 Run 使用獨立 tab（[ADR-0006](0006-browser-automation.md)）與獨立 Thread；共用 workdir 與 session partition 的衝突由使用者自行承擔，設定 UI 顯示警告。
10. **手動觸發模式**：面板提供「傳送」（同步，等回覆）與「派發為任務」（非同步，建 Task Thread）兩種按鈕，對應規格第 12 點的 Sync / Async。

## 考慮過的替代方案

- **單一連續歷程**：context 無限長，並行時歷程交錯，排程雜訊污染對話。
- **每個 Run 全新 context**：無法連續對話。
- **固定 maxConcurrency = 1**：最安全，但使用者要求可配置。

## 後果

- SQLite `messages` 表以 `(personaId, contextId, seq)` 索引；Thread 過長時 Session 需實作截斷 / 摘要策略（v1 先做「保留最近 N 則 + 系統摘要」的簡單策略，N 可設）。
- 主視窗任務樹以 `contextId` 與 `taskId` 關聯 Privacy Agent、Planner 與 Operator 的 Thread，可從任務樹直接跳到對應 Operator Thread。
- 同一 scope 下的所有 Thread 共用別名表，刪除 Privacy Agent 的 Thread 時連同其 scope 的 Vault 一併刪除；被委派的 Task Thread 仍保留別名化前的真值歷程。

## 關聯

[ADR-0004](0004-a2a-over-messageport.md) A2A、[ADR-0005](0005-privacy-agent-and-task-dispatch.md) 派發、[ADR-0007](0007-window-and-viewport-model.md) 視窗。
