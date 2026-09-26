# ADR-0010：Human-in-the-loop 流程與工具風險等級

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：代答者改為「派發者」；新增 `privacy_confirm` 中斷；沙箱寫回原檔為 high
- 修訂：2026-09-26：`privacy_confirm` 新增 `trust_domain` 選項與 `batch_volume` 原因
- 適用階段：Phase 1

## 背景

規格第 10 點要求 Operator 在遭遇驗證中斷、工具錯誤、流程例外或需人工確認時，主動回傳結構化資料並中斷。OpenAI Agents SDK 以 `needsApproval` 產生 interruption；A2A 以 `input-required` 狀態表達。需要決定誰有權回答、以及哪些情況強制人工。

## 決策

### 中斷類型與 payload

Agent 把中斷映射為 A2A Task 狀態 `input-required`，`status.message` 為 DataPart：
```ts
type InterruptPayload =
  | { type: 'question';      question: string; options?: string[] }
  | { type: 'tool_approval'; toolName: string; args: unknown; riskLevel: 'medium' | 'high'; rationale: string }
  | { type: 'auth_required'; site: string; reason: 'login' | 'mfa' | 'session_expired' }
  | { type: 'captcha';       site: string; screenshotRef?: string }
  | { type: 'tool_error';    toolName: string; error: string; retryable: boolean }
  | { type: 'privacy_confirm';
      reason: 'sensitive_category' | 'uncertain' | 'detector_unavailable' | 'new_domain_egress' | 'batch_volume';
      categories: string[];            // 命中的政策類別（ADR-0016）
      preview: string;                 // 別名化後、即將送出的內容
      destination: { providerId?: string; domain?: string };
      options: Array<'allow' | 'trust_domain' | 'local_only' | 'rules_only' | 'cancel'> };
```
`tool_error` 不中斷等待，只是結構化回報並轉 `failed`（或由 Operator 自行重試）。`privacy_confirm` 由 Gate 或 Privacy Agent 產生（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)、[ADR-0016](0016-privacy-policy-ledger-and-transparency.md)），可能出現在 Privacy Agent、Planner 或 Operator 的 Task 上。

### 回答權限

| 類型 | 派發者可代答 | 強制人工 |
|---|---|---|
| question | 是 | 否 |
| tool_approval（medium） | 是 | 否 |
| tool_approval（high） | 否 | 是 |
| auth_required | 否 | 是 |
| captcha | 否 | 是 |
| privacy_confirm | 否 | 是 |

**派發者**是發出該委派的 Agent：SLM 模式是 Planner（雲端，只看得到別名化內容），LLM 模式是 Privacy Agent。SLM 模式下 Privacy Agent 不代答，因為本地 SLM 不適合判斷工具審批。派發者的回答進入 Operator 時，同樣經過 Operator 的 Gate。

1. **派發者先答**：派發者在同步等待或收到 async 事件時看到 `input-required`，若類型允許代答，就以委派時的原始任務脈絡回答（以 `message/send` 帶同 `taskId` 續傳）。判斷無法回答時，呼叫 `escalate_to_user(taskId)` 工具升級。
2. **升級給使用者**：main 把中斷寫入 Action Center（severity 依類型），發系統 Toast；若 Operator 視窗隱藏，主視窗 Agent 列表顯示待處理徽章。使用者在 Operator 面板、Privacy Agent 對話或 Action Center 回答；`auth_required` / `captcha` 時使用者直接在該 Operator 視窗的瀏覽器完成操作後按「繼續」。`privacy_confirm` 的回答選項：`allow`（依別名化內容送出）、`local_only`（改走純本地 route）、`rules_only`（僅偵測器離線時出現，本任務只用規則層）、`trust_domain`（僅 `new_domain_egress` 時出現，允許並把網域加入全域信任清單）、`cancel`。`batch_volume` 用於 R1 分批的批次數超過門檻時。
3. **恢復執行**：Agent 行程以 SDK `RunState` 序列化保存中斷點（存 SQLite `run_states`），回答到達後 `RunState.approve/reject` 或注入回答，續跑。行程重啟後可從 `run_states` 還原。
4. **逾時**：`input-required` 超過 24 小時無回應，Task 轉 `canceled`，通知派發者與 Action Center。

### 工具風險等級

5. 三級 `riskLevel`：
   - `low`：自動執行，不產生中斷（讀取類：navigate、snapshot、extract、讀檔）。
   - `medium`：`needsApproval = true`，派發者可批（寫檔到 workdir、表單填寫、點擊）。
   - `high`：`needsApproval = true`，強制人工（送出訊息 / 郵件、付款、刪除、寫入 workdir 外、`shell_exec`、`browser_evaluate`、compute-to-data 結果寫回使用者原始檔案）。
   - `submit_compute_script` 為 `low`：隔離由沙箱強制（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）；`computer_*` 見 [ADR-0018](0018-computer-use.md)。
6. 內建工具有預設等級；MCP 工具**未標記預設 `medium`**；persona.yaml `tools.riskLevels` 可覆寫任一工具（含 MCP 工具，以 `<server>.<tool>` 命名）。使用者可在 UI 調整並寫回 yaml。
7. 使用者直接在 Operator 使用者 Thread 介入的任務（沒有派發者）中，medium 直接升級給使用者。

## 考慮過的替代方案

- **一律升級使用者**：最安全，但自動化程度低，使用者拒絕。
- **全部可代答**：auth / captcha 本質上 LLM 解不了，只多一輪延遲；且 LLM 自批高風險操作不可接受。
- **兩級（需 / 不需審批）**：沒有「一定要人」的欄位。

## 後果

- Planner 與 LLM Flow 的 prompt 必須包含代答準則：只能依原始任務脈絡回答，不得臆測使用者未給的資訊。
- 每次代答都記錄到 Operator Thread 與派發者 Thread（誰批的、依據什麼），可稽核。
- 風險等級是安全邊界的核心，內建工具的預設等級表需在 `packages/shared` 單一定義並有測試鎖定。

## 關聯

[ADR-0005](0005-privacy-agent-and-task-dispatch.md) 派發、[ADR-0006](0006-browser-automation.md) 瀏覽器、[ADR-0012](0012-scheduler-events-notifications.md) 通知。
