# ADR-0005：Privacy Agent、Planner 與任務派發

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：Orchestrator 改為 Privacy Agent，新增 SLM／LLM 兩種 Flow 與雲端 Planner（盤問第 1–9、16、22 題）
- 修訂：2026-09-26：R1 分批、R3 本地 compute、案件 scope（設計缺口盤問 2b、3、4）
- 適用階段：Phase 1

## 背景

規格第 5 點要求一個角色負責任務拆解、依專長派發給其他 Agent，並聚合狀態。2026-09-25 修訂後，平台定位為「可以代理任何事（含 computer use）、同時保護隱私」的 Agent 平台：

- **所有任務都先經過 Privacy Agent**。它綁定使用者選擇的 LLM Provider 與模型，通常是自架 LLM 或 AI PC 上的本地 SLM，並決定資料怎麼處理、交給誰。
- **Operator** 是實際執行的 Agent，通常綁定雲端模型，擁有瀏覽器、computer use、MCP、skills。每個 Operator 由一個 Persona（persona.yaml workspace，[ADR-0008](0008-persona-workspace-and-skills.md)）定義。
- 本地 SLM 規劃多步驟任務的能力不足，自架大模型則足以擔任完整的 Orchestrator。因此提供兩種 Flow。

OpenAI Agents SDK 的 handoff 是同行程概念，跨 utilityProcess 無法直接使用，派發仍走 A2A（[ADR-0004](0004-a2a-over-messageport.md)）。

## 決策

### 角色與模式

1. 三種 Agent 角色（AgentId 見 [ADR-0004](0004-a2a-over-messageport.md)）：
   - `privacy`：Privacy Agent，唯一入口，常駐。
   - `planner`：雲端 Planner，只在 SLM 模式下常駐。它就是原 Orchestrator 的 runtime，綁定雲端模型，受 Gate 保護，只看得到別名化內容。
   - `operator:<personaId>`：Operator，每個已啟用的 Persona 一個。
2. **模式由使用者手動選擇**：全域設定 `privacy.mode: 'slm' | 'llm'`，預設 `slm`。設定頁說明兩者差異與建議模型規模，但不自動判定。切換只影響**之後新建的任務**，進行中的任務以原模式完成。切到 `llm` 時 main 停止 Planner 行程（先 cancel 進行中的 Task，同 [ADR-0002](0002-process-model.md) 停用流程），切回 `slm` 時再 spawn。
3. **兩種 Flow 是兩套獨立的編排實作**，實作同一個介面 `PrivacyFlow`，分別位於 `agent-runtime/src/roles/privacy-slm/` 與 `roles/privacy-llm/`，**共用**同一組安全元件：Gate、Vault、偵測器、政策、Ledger、沙箱（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)～[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）。隱私保證不因模式不同而改變；差別只在「誰選 route、誰做規劃」。

### Privacy Routes

4. 資料處理路徑：

   | Route | 名稱 | 做法 |
   |---|---|---|
   | R0 | 直通 | 沒有敏感資料，原樣交給規劃／執行者；仍經 Gate 作最後防線 |
   | R1 | 最小化 + 別名化委派 | Privacy Agent 決定哪些敏感值必須送出；不需要的移除或泛化，需要的別名化，再委派；結果還原後回覆。大量非結構化內容以文件為單位**分批**委派 |
   | R2 | Compute-to-data | 只送 schema／合成樣本，Operator 寫腳本，本機沙箱執行（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)） |
   | R3 | 純本地 | Privacy Agent 自己處理（摘要、改寫、問答），不外送；需要以敏感值為參數的計算走**本地 compute**（[ADR-0017](0017-compute-to-data-and-script-sandbox.md) 第 13 點） |
   | R4 | 詢問使用者 | 無法判斷或政策要求時以 `privacy_confirm` 中斷（[ADR-0010](0010-hitl-and-risk-levels.md)） |

**R1 分批**：郵件匯出、多份文件、對話匯出等大量非結構化內容，以「一封郵件／一份文件／一段對話」為單位分批別名化並委派，全部批次共用同一個 privacy scope，所以別名前後一致。

- 批次數超過門檻（預設 20）時，先以 `privacy_confirm` 說明批次數與預估成本，由使用者確認。
- 各批結果由派發者（Planner 或 LLM Flow）彙整。

**案件 scope**：使用者把 Thread 綁定到案件時，該 Thread 的所有 route 都使用 `case:<caseId>` scope（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) 第 18 點）。

### SLM Flow（`privacy.mode = 'slm'`）

5. Privacy Agent 是**程式驅動的狀態機**，SLM 只做有界決策，每一步都以 JSON schema 限制輸出（OpenAI 相容端點的 `response_format: json_schema`；不支援時改用 JSON mode 並在程式端驗證）：
   1. **Intake**：接收使用者訊息、附件與觸發來源（排程、webhook、事件，見第 12 點）。
   2. **Detect**：規則層 + 語意層偵測（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）。
   3. **Classify**（SLM）：`{ intent, needsCloud, route, requiredEntities[], dataShape }`。政策優先於 SLM：`schema_only` 類別一律 R2，`confirm` 類別先經 R4。
   4. **Execute route**：
      - R0／R1：把最小化、別名化後的任務以 A2A 交給 **Planner**，由 Planner 拆解並派發給 Operator。
      - R2：Privacy Agent 抽 schema 後交給 Planner（或第 12 點指定的 Operator）撰寫腳本。
      - R3：SLM 直接回答；需要以敏感值為參數的計算時，呼叫內建的確定性資料工具（`match_names`、`filter_rows` 等）。
      - R4：中斷並等待使用者。
   5. **Compose**：還原別名、組回覆、產生隱私卡片與 Ledger 紀錄（[ADR-0016](0016-privacy-policy-ledger-and-transparency.md)）。
6. SLM 輸出不符 schema 時重試一次，仍失敗就走 R4（`reason: 'uncertain'`），不猜測。
7. SLM Flow 不讓 SLM 呼叫任意工具；可用的動作只有上述狀態轉移。

### LLM Flow（`privacy.mode = 'llm'`）

8. Privacy Agent **就是 Orchestrator**，在自己的 Run 內自由規劃，但資料外送只能透過明確的 **route 工具**，每次選擇都寫入 Ledger：
   - `delegate_minimized(operator, task, context?, keep: EntityRef[], mode, contextId?)`：R0／R1，`keep` 列出必須送出的敏感值，其餘由程式移除或泛化；
   - `compute_to_data(operator, datasets, question)`：R2；
   - `compute_local(language, code, inputs, params, outputSpec)`：R3 的本地 compute，腳本由 Privacy Agent 撰寫、可帶真值參數，輸出不外送；
   - `ask_user_privacy(question, preview)`：R4；
   - 以及 `get_task(taskId)`、`cancel_task(taskId)`、`list_tasks()`。

   R3 就是 Privacy Agent 自己回答，不需要工具。LLM Flow **不**直接暴露原始的 `delegate_to_*`，所以每筆外送都有 route 紀錄。Gate 仍是最後防線。
9. 同一任務可組合多條 route，例如先 R2 算出統計，再以 R1 請 Operator 撰寫報告。

### 委派機制（Planner 與 LLM Flow 共用）

10. **Operator 即工具**：派發者（SLM 模式的 Planner、LLM 模式的 Privacy Agent）從 A2A registry 取得所有 Operator 的 Agent Card，為每個 Operator 動態生成委派工具。Planner 使用 `delegate_to_<personaId>(task, context?, mode, contextId?)`；LLM Flow 則把 Operator 作為 route 工具的 `operator` 參數列舉值。工具說明由 Agent Card 的 `description` 與 `skills[].description` 組成，registry 變更時於下一個 Run 重建。
    - **sync**：呼叫 `message/stream`，持續消費事件直到 Task 終態或 `input-required`，回傳最終 artifact 文字與 taskId。逾時預設 30 分鐘，可由 persona.yaml `delegation.timeoutMinutes` 覆寫，逾時視為 failed。
    - **async**：呼叫 `message/send` 後立即回傳 `{ taskId, contextId }`；Task 終態時 broker 以系統訊息注入派發者的 Thread，觸發續跑聚合。
    - 委派訊息帶 `arlo.privacyScope` metadata，Operator 的 Task Thread 因此繼承發起端的 Vault scope。
11. **狀態聚合**：每個委派存 `DelegationRecord`（SQLite `delegations`），並記錄 root 任務來自 Privacy Agent 的哪條 Thread；主視窗以此顯示任務樹（Privacy → Planner → Operators）。
12. **入口一律經 Privacy Agent**（盤問第 22 題）：
    - 主視窗輸入、排程、webhook、事件觸發都送到 `privacy`（[ADR-0012](0012-scheduler-events-notifications.md)）。
    - 觸發設定指定的 Operator 以 message metadata `arlo.targetOperator` 傳入：SLM Flow 把它當成 R1／R2 的固定執行者，交給 Planner 時附上「指定執行者」；LLM Flow 把它當成提示。
    - 使用者仍可在 Operator 視窗的使用者 Thread 直接介入（[ADR-0009](0009-conversation-threads-and-concurrency.md)），訊息直接進 Operator，由 Gate 自動別名化。
13. **向上請求**：Operator 的內建工具 `ask_delegator(question)` 以 A2A `input-required`（payload `question`）回到派發者。代答規則見 [ADR-0010](0010-hitl-and-risk-levels.md)。
14. **不做顯式 DAG planner**：拆解由 Planner／LLM Flow 的 LLM 在 Run 內以多次 tool call 完成，並行靠同一輪多個 async 委派。SLM Flow 的狀態機是固定的隱私流程，不是任務 DAG。

## 考慮過的替代方案

- **統一原語 + Planner 槽位**（兩模式共用同一套 route 實作，差別只在誰選 route）：程式路徑最少；使用者選擇兩套獨立流程，讓兩種模式各自最佳化。安全元件仍共用，隱私規則不會分歧。
- **Privacy Agent 永遠只選一條 route**：最可預測，但用不到自架大模型的能力。
- **能力自測後自動判定模式**：可幫非技術使用者判斷；使用者選擇手動設定，自測可作為日後的輔助。
- **SLM 模式只派給單一通用 Operator**：少一個常駐行程，但多 Operator 分工只在 LLM 模式才有。
- **固定 `list_agents` + `delegate(agentId, task)` 兩個工具**：工具數不隨 Operator 增長，但 routing 品質較差。

## 後果

- SLM 模式多一個常駐的 Planner 行程與一次 A2A 跳轉。
- 兩套 Flow 各有測試；共用的安全元件只測一次，但「兩種 Flow 都不會讓原始值出現在雲端請求中」的 canary 測試兩邊都要跑（[ADR-0014](0014-testing-ci-packaging.md)）。
- Operator 數量很多（>30）時工具清單會膨脹 prompt；屆時再引入分組或 `list_agents` 混合方案。
- Planner 與 LLM Flow 的 prompt 都必須說明 sync／async 的選擇準則，LLM Flow 另需說明 route 的選擇準則與「不確定就用 R4」。

## 關聯

[ADR-0004](0004-a2a-over-messageport.md) A2A、[ADR-0009](0009-conversation-threads-and-concurrency.md) Thread、[ADR-0010](0010-hitl-and-risk-levels.md) HITL、[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) Gate、[ADR-0016](0016-privacy-policy-ledger-and-transparency.md) 政策、[ADR-0017](0017-compute-to-data-and-script-sandbox.md) compute-to-data。
