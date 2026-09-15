# ADR-0005：Orchestrator 任務派發與路由

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 1

## 背景

規格第 5 點要求 Orchestrator 負責任務拆解、依 Persona 專長動態派發與狀態聚合。OpenAI Agents SDK 的 handoff 是同行程概念，跨 utilityProcess 無法直接使用。

## 決策

1. **Persona 即工具**：Orchestrator 啟動時從 A2A registry 取得所有 Persona 的 Agent Card，為每個 Persona 動態生成一個 function tool：
   ```
   delegate_to_<persona_slug>(task: string, context?: string, mode: 'sync' | 'async', contextId?: string)
   ```
   tool description 由 Agent Card 的 `description` 與 `skills[].description` 組成，讓 LLM 依描述做 routing。registry 變更時重建 tool 清單（下一個 Run 生效）。
2. **同步模式**：tool 內部呼叫 `message/stream`，持續消費事件直到 Task 進入終態（`completed` / `failed` / `canceled`）或 `input-required`，回傳最終 artifact 文字與 taskId。逾時（預設 30 分鐘，可於 persona.yaml 覆寫）視為 failed。
3. **非同步模式**：tool 呼叫 `message/send` 後立即回傳 `{ taskId, contextId }`。Orchestrator 另有通用工具 `get_task(taskId)`、`cancel_task(taskId)`、`list_tasks()`；Task 終態時 broker 以事件推入 Orchestrator 的使用者 Thread，形式為系統訊息，觸發 Orchestrator 續跑聚合。
4. **狀態聚合**：Orchestrator 對每個進行中的委派維護 `DelegationRecord`（存 SQLite），UI 主視窗以此顯示任務樹。
5. **向上請求**：Persona 有內建工具 `ask_orchestrator(question)`，實作為 A2A `input-required` 狀態 + payload type `question`，詳見 [ADR-0010](0010-hitl-and-risk-levels.md)。
6. **不做顯式 Planner / DAG**：任務拆解由 Orchestrator 的 LLM 在 Run 內以多次 tool call 完成；並行靠同一輪多個 async 委派。

## 考慮過的替代方案

- **固定 `list_agents` + `delegate(agentId, task)` 兩個工具**：工具數不隨 Persona 增長，但 LLM 需先查詢才知道有誰，多一輪且 routing 品質較差。
- **顯式 DAG planner**：可觀測、可並行，但彈性低、難中途調整。留作後續選項。

## 後果

- Persona 數量很多（>30）時 tool 清單會膨脹 prompt；屆時再引入分組或 `list_agents` 混合方案。
- Orchestrator prompt 必須說明 sync / async 的選擇準則（短任務 sync、長任務或多任務並行 async）。

## 關聯

[ADR-0004](0004-a2a-over-messageport.md) A2A 傳輸、[ADR-0009](0009-conversation-threads-and-concurrency.md) Thread 模型、[ADR-0010](0010-hitl-and-risk-levels.md) HITL。
