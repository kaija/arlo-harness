# ADR-0010：Human-in-the-loop 流程與工具風險等級

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 1

## 背景

規格第 10 點要求 Persona 在遭遇驗證中斷、工具錯誤、流程例外或需人工確認時，主動回傳結構化資料並中斷。OpenAI Agents SDK 以 `needsApproval` 產生 interruption；A2A 以 `input-required` 狀態表達。需要決定誰有權回答、以及哪些情況強制人工。

## 決策

### 中斷類型與 payload

Persona 把中斷映射為 A2A Task 狀態 `input-required`，`status.message` 為 DataPart：
```ts
type InterruptPayload =
  | { type: 'question';      question: string; options?: string[] }
  | { type: 'tool_approval'; toolName: string; args: unknown; riskLevel: 'medium' | 'high'; rationale: string }
  | { type: 'auth_required'; site: string; reason: 'login' | 'mfa' | 'session_expired' }
  | { type: 'captcha';       site: string; screenshotRef?: string }
  | { type: 'tool_error';    toolName: string; error: string; retryable: boolean };
```
`tool_error` 不中斷等待，只是結構化回報並轉 `failed`（或由 Persona 自行重試）。

### 回答權限

| 類型 | Orchestrator 可代答 | 強制人工 |
|---|---|---|
| question | 是 | 否 |
| tool_approval（medium） | 是 | 否 |
| tool_approval（high） | 否 | 是 |
| auth_required | 否 | 是 |
| captcha | 否 | 是 |

1. **Orchestrator 先答**：Orchestrator 在同步等待或收到 async 事件時看到 `input-required`，若類型允許代答，Orchestrator 以委派時的原始任務脈絡回答（以 `message/send` 帶同 `taskId` 續傳）。Orchestrator 若判斷無法回答，呼叫 `escalate_to_user(taskId)` 工具升級。
2. **升級給使用者**：main 把中斷寫入 Action Center（severity 依類型），發系統 Toast；若 Persona 視窗隱藏，主視窗 Agent 列表顯示待處理徽章。使用者在 Persona 面板或 Action Center 回答；`auth_required` / `captcha` 時使用者直接在該 Persona 視窗的瀏覽器完成操作後按「繼續」。
3. **恢復執行**：Persona 行程以 SDK `RunState` 序列化保存中斷點（存 SQLite `run_states`），回答到達後 `RunState.approve/reject` 或注入回答，續跑。行程重啟後可從 `run_states` 還原。
4. **逾時**：`input-required` 超過 24 小時無回應，Task 轉 `canceled`，通知 Orchestrator 與 Action Center。

### 工具風險等級

5. 三級 `riskLevel`：
   - `low`：自動執行，不產生中斷（讀取類：navigate、snapshot、extract、讀檔）。
   - `medium`：`needsApproval = true`，Orchestrator 可批（寫檔到 workdir、表單填寫、點擊）。
   - `high`：`needsApproval = true`，強制人工（送出訊息 / 郵件、付款、刪除、寫入 workdir 外、`shell_exec`、`browser_evaluate`）。
6. 內建工具有預設等級；MCP 工具**未標記預設 `medium`**；persona.yaml `tools.riskLevels` 可覆寫任一工具（含 MCP 工具，以 `<server>.<tool>` 命名）。使用者可在 UI 調整並寫回 yaml。
7. 使用者手動觸發的 Thread（無 Orchestrator 參與）中，medium 直接升級給使用者。

## 考慮過的替代方案

- **一律升級使用者**：最安全，但自動化程度低，使用者拒絕。
- **全部可代答**：auth / captcha 本質上 LLM 解不了，只多一輪延遲；且 LLM 自批高風險操作不可接受。
- **兩級（需 / 不需審批）**：沒有「一定要人」的欄位。

## 後果

- Orchestrator prompt 必須包含代答準則：只能依原始任務脈絡回答，不得臆測使用者未給的資訊。
- 每次代答都記錄到 Persona Thread 與 Orchestrator Thread（誰批的、依據什麼），可稽核。
- 風險等級是安全邊界的核心，內建工具的預設等級表需在 `packages/shared` 單一定義並有測試鎖定。

## 關聯

[ADR-0005](0005-orchestrator-task-dispatch.md) 派發、[ADR-0006](0006-browser-automation.md) 瀏覽器、[ADR-0012](0012-scheduler-events-notifications.md) 通知。
