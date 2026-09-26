# ADR-0012：排程、事件觸發與通知中心

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：所有觸發先送 Privacy Agent；outbound webhook 內容套用偵測與政策
- 適用階段：Phase 2

## 背景

規格第 12、15、16 點要求：Cron 排程觸發指定 Persona 並代入含模板變數的 Prompt；事件驅動觸發；全域 Action Center 與系統 Toast；外部推播到行動裝置。

## 決策

### 排程

1. **執行位置**：main 內單一 scheduler，使用 `croner`。排程存 SQLite `schedules` 表。
2. **格式**：5 / 6 欄 cron 表達式 + 時區（預設系統時區）。
3. **觸發流程**：到點 → 建 `schedule_runs` 記錄 → 模板變數替換 → 以 A2A `message/send`（`from: system:schedule`）送給 **Privacy Agent**，metadata `arlo.targetOperator` 帶排程指定的 Operator，`contextId = schedule:<scheduleId>:<runId>`（每次新 Thread）或 `schedule:<scheduleId>`（延續同 Thread，可設）→ Privacy Agent 依 route 處理（[ADR-0005](0005-privacy-agent-and-task-dispatch.md)）→ 結果狀態回寫 `schedule_runs`。排程也可不指定 Operator，交給 Privacy Agent 決定。
4. **模板變數**（v1 集合，Mustache 風格 `{{ }}`）：`current_time`（ISO 8601 含時區）、`timestamp`（Unix 秒）、`date`（YYYY-MM-DD）、`time`（HH:mm）、`weekday`、`schedule_id`、`schedule_name`、`run_id`。未知變數保留原文並記警告。
5. **錯過的排程**：App 關閉期間錯過的執行**不補跑**，啟動時比對 `lastRunAt` 與 cron，對每個錯過的排程寫一筆 `skipped` 的 `schedule_runs` 並推一則 info 通知到 Action Center。
6. UI：設定頁可新增 / 編輯 / 暫停排程、手動「立即執行」、檢視執行歷史。

### 事件觸發

7. **內部 event bus**（main，`packages/shared` 定義型別）：`task.completed`、`task.failed`、`task.input_required`、`persona.started`、`persona.crashed`、`notification.created`、`schedule.fired`、`webhook.received`。
8. persona.yaml `triggers.events` 可訂閱事件並指定 prompt 模板（觸發時同樣送往 Privacy Agent，以該 Persona 的 Operator 為 `arlo.targetOperator`），模板可用 `{{event.type}}`、`{{event.payload.<path>}}` 及排程變數。訂閱 `task.*` 時可加 `filter: { personaId }` 限制來源，避免自我觸發循環；系統硬性規定同一事件鏈深度上限 5。
9. **本機 HTTP webhook 接收器**：main 開 `127.0.0.1:<port>`（port 可設，預設隨機並顯示於設定頁），路徑 `POST /hooks/<personaId>`（或 `POST /hooks/privacy` 不指定 Operator），需 `Authorization: Bearer <token>`（token 於設定頁產生、以 safeStorage 加密存放）。body 為 JSON，轉為 `webhook.received` 事件，payload 可在模板中引用，並以 `from: system:webhook` 送往 Privacy Agent。webhook payload 常含第三方個資，因此一律經過 Privacy Agent 的偵測與 route，不直達 Operator。
10. 檔案系統監控、信箱輪詢等其他來源留給 MCP 或後續版本。

### 通知中心

11. **Action Center**（主視窗面板）：列出通知，欄位 `severity`（info / success / warning / error / action_required）、`source`（agentId）、`title`、`body`、`actions`（如「回答」「前往 Persona」「重試」）、已讀狀態。`action_required` 類（HITL）置頂直到處理。
12. **系統 Toast**：使用 Electron `Notification`，severity ≥ warning 或 action_required 才發；可在設定關閉。
13. Agent 端 API：內建工具 `notify(title, body, severity)` 讓任一 Agent 主動推播；系統事件（Task 終態、崩潰、HITL）自動產生通知。

### 外部推播

14. **通用 outbound webhook**：設定頁可新增多條「轉發規則」：條件（severity、source、type）→ 目標 URL + 自訂 header + body 模板（Mustache）。
15. 內建兩個範本：**ntfy**（`POST https://ntfy.sh/<topic>`，含 title / priority / tags 對應）與 **Telegram Bot**（`POST https://api.telegram.org/bot<token>/sendMessage`）。範本只是預填，仍走同一條 webhook 機制。
16. 失敗重試 3 次（指數退避），最終失敗寫一則 error 通知（不再轉發，避免循環）。
17. **外送隱私**：outbound webhook 的目標是第三方服務（ntfy、Telegram 等），渲染後的 title／body 送出前，以規則層 + 語意層偵測並套用政策（[ADR-0016](0016-privacy-policy-ledger-and-transparency.md)）。對方無法還原別名，所以這裡以 `⟦REDACTED:<category>⟧` 取代，不做可還原的別名化。每則轉發寫入 Privacy Ledger。本機 Action Center 與 Toast 顯示真值。

## 考慮過的替代方案

- **錯過的排程補跑**：適合每日報告，但長時間未開機後會一次湧進一堆；可作為每個排程的 `catchUp` 開關後續加入。
- **交給 OS 排程（launchd / Task Scheduler）喚醒 App**：App 沒開也能跑，但跨平台實作繁瑣。
- **原生推播（APNs / FCM）**：需自家手機 app 與後端。

## 後果

- webhook 接收器是本機唯一對外的 HTTP 端點；預設只綁 loopback，使用者要對外需自行用 tunnel 並承擔風險，文件需明示。
- 事件觸發可能形成鏈，深度上限與 filter 是必要防護。

## 關聯

[ADR-0005](0005-privacy-agent-and-task-dispatch.md) 派發、[ADR-0009](0009-conversation-threads-and-concurrency.md) Thread、[ADR-0010](0010-hitl-and-risk-levels.md) HITL。
