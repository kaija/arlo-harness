# Rakazo 產品與設計分析

- 來源：<https://github.com/elie222/rakazo>（Apache-2.0，Beta）
- 分析快照：commit `b22f66e`（2026-09-24）
- 一句話定位：**可自架、跨 Web / Electron / 行動裝置的「持久化 AI 隊友」平台**；每個 Bot 擁有自己的對話、記憶、排程與電腦。

## 1. 產品功能

| 類別       | 功能                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bot 本體   | 持久化 Bot：一個 Bot 一條可見對話（thread），並有記憶、routine、歷史；可自訂頭像與角色                                                    |
| 電腦       | **Team Computer**（同空間 Bot 共用檔案、工具、瀏覽器身分）與 **Private Computer**（整個工作目錄隔離）；提供瀏覽器、終端機、檔案與圖形桌面 |
| 電腦供應商 | Docker、E2B、Daytona、Box、受信任的本機電腦；全部走同一個 `SandboxProvider` 介面                                                          |
| 協作       | 委派給同儕 Bot（`message_bot`、`handoff_to_bot`）、短命 subagent（`run_subagent`）、建立新 Bot（`spawn_bot`）、群組聊天                   |
| 模型       | 透過 **Pi** agent runtime 使用自帶金鑰（BYOK）：OpenRouter、OpenAI 相容端點、Anthropic OAuth 等                                           |
| 整合       | Composio、Pipedream Connect 目錄；使用者自行安裝遠端 MCP、OpenAPI、Treg 工具來源                                                          |
| 通訊平台   | Slack、Telegram、WhatsApp、Lark、Sendblue（iMessage）等外部通道，同一 Bot 可從外部對話                                                    |
| 語音       | 朗讀回覆、聽寫、撥打電話給 Bot；ElevenLabs / OpenAI / Cartesia / Fish Audio                                                               |
| 教學       | 「Teach」：錄下使用者在桌面上的操作，產生 playbook 並轉成 Skill                                                                           |
| 雲端代理   | 可啟動外部 cloud agent（如 Cursor Cloud Agent）並追蹤狀態                                                                                 |
| 部署       | Docker Compose 一鍵安裝、VPS 自架；Electron 首次啟動可選「在本機跑整個 stack」或「連線到既有伺服器」                                      |

## 2. 架構總覽

```
apps/
  web       React 19 + Vite（Electron 也載入同一份 UI）
  api       Hono + oRPC：授權、驗證、路由、webhook 接收
  worker    Graphile Worker：實際執行 Run（agent loop）
  desktop   Electron 殼：只負責連線設定與原生功能
  mobile    Expo
packages/
  contracts   跨端型別（RunStatus、事件、RPC schema）
  core        純函式領域邏輯（狀態機、審批規則、cron、mention 解析…）
  adapter-kit 所有供應商介面（SandboxProvider、MemoryStore、VoiceProvider…）
  adapters    各供應商實作 + executor（agent 主迴圈）+ emulators
  db          Prisma + PostgreSQL
  memory / auth / logging / ui-web / ui-tokens / chat-ui / testkit
```

關鍵分層：

```
chat/API → 一個 Pi agent session → Rakazo 內建工具 → SandboxProvider → E2B / Daytona / Box / Docker
                                                     ↘ ConnectorProvider（MCP / Composio / OpenAPI）
SandboxProvider 工作目錄 ⇄ AgentHomeStore ⇄ Rakazo 自有 DATA_DIR（可攜的持久化邊界）
```

**Agent runtime 與電腦 runtime 分離**：Pi 在 API / worker 行程內執行，不在沙盒內；沙盒只是「一台被操作的電腦」。因此任何支援 tool calling 的模型都能用同一組工具。

## 3. 設計邏輯

### 3.1 產品原則（VISION.md）

Rakazo 用一份 `VISION.md` 作為產品真相來源，並明確寫出「該抵抗的變更」：

1. **持久隊友，不是拋棄式對話**：Bot 是有身分的持續實體；「一個 Bot 一條可見 thread」是身分的一部分，內部的 run / attempt 是實作細節。
2. **擁有權 = 選擇權**：模型、電腦、記憶、語音、整合全部走供應商中立的契約，沒有任何託管服務是必要依賴。
3. **所有介面同一產品**：共享行為放 packages，平台特定程式碼只留給原生導覽、儲存、權限。
4. **電腦是持久的「地方」**：即使底層容器被暫停或替換，工作狀態仍在。
5. **表面平靜、底層嚴謹**：聊天只顯示回應、有用的進度、結果與真正的求助，不顯示工具生命週期；Routine 永遠是「排程的 prompt」，不做視覺化 workflow。
6. **信任必須明確且被驗證**：Space 是授權邊界；分享 Bot 只分享設定，不分享電腦、憑證、記憶；不確定的自動審查「傾向詢問」而非默默執行。

### 3.2 供應商中立的 Adapter 邊界

`packages/adapter-kit/src/interfaces.ts` 定義約 20 個介面，每個都有 `describe()` 回傳 **capabilities**：

- `SandboxProvider`：provision / prepare / execute / observe / act / connectScreen / sendInput / 檔案 IO / exportWorkspace / importWorkspace / snapshot / stop / destroy
- `AgentRuntime`、`ModelProvider`、`ConnectorProvider`、`ManagedConnectorProvider`、`ConnectionAuthProvider`
- `MemoryStore`（Markdown 文件 + revision）與 `SemanticMemoryProvider`（recall / save / forget）
- `AgentHomeStore`（checkout / commit / restore — 以 revision 管理 Bot 的家目錄）
- `SecretStore`、`ArtifactStore`、`JobPublisher` / `JobWorkerHost`、`RealtimeFanout`、`NotificationProvider`、`VoiceProvider`、`MessagingSurface`、`WebSearchProvider` / `WebFetchProvider`、`AutoReviewProvider`

規則：**供應商 SDK 只能出現在 adapter 與 composition root**；每個供應商都配一個 **emulator**（`e2b-emulator.ts`、`composio-emulator.ts`…）與**共用 conformance test**，讓整個測試套件離線且決定性。

### 3.3 Run 狀態機與持久化執行

- `Thread → Task → Run → Attempt` 四層。Run 狀態：`queued → leased → running → (waiting_input | waiting_takeover) → completed | failed | cancelled`，由 `packages/core/src/run-state.ts` 的轉移表強制，非法轉移直接 throw。
- **Lease + fence**：worker 取得 run 時拿到 lease，每次重新取得遞增 fence 號，舊 worker 的寫入被拒絕（防止重複執行）。
- 背景工作以 Graphile Worker（PostgreSQL）排隊；另有 **job reconciler**（Postgres advisory lock 選 leader）定期修補漏掉的喚醒。
- **ExternalEffect 表 + 冪等鍵**：每個有副作用的工具呼叫先寫一筆 effect（`idempotencyKey`、`status`），完成後回寫結果；崩潰重試時不會重送已完成或狀態不明的動作（例如一次性 OTP 在送出前先刪除密文）。

### 3.4 審批（HITL）與自動審查

`packages/core/src/action-approval.ts` 把工具分成幾類：

| 類別         | 範例                                                                     | 行為                                              |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------- |
| 豁免         | `computer_act`、`shell`、`write_file`、`browser_act`（在沙盒內）         | 不需審批——沙盒本身就是安全邊界                    |
| 一律需審批   | `destination.write`、`delete_bot`、`forget_memory`、`cloud_agent_launch` | 需要使用者確認                                    |
| 無人值守安全 | `read_file`、`web_search`、`recall_memory`                               | routine 等無人值守的 run 也可執行                 |
| Connector    | 以名稱 regex 分辨 `get/list/search` vs `send/delete/pay/publish…`        | 讀取放行、變更需審批；複合動作（`_and_`）視為變更 |

- 使用者可設 `ActionApprovalRule`（永遠允許某類動作）。
- **Auto-review**：可選的 LLM 評審（1.5 秒 timeout、信心門檻 0.5），審查請求會先 redact 密碼 / token；逾時或不確定一律**轉為詢問使用者**。
- 審批綁定 **approval-effect-key**（對參數做穩定 JSON 序列化後雜湊），並綁定連線的 `resourceRevision`——OAuth 重新授權後，舊審批不能套用到新帳號。

### 3.5 電腦模型

- 預設每個 Space 一台 Team Computer；每個 Team Bot 有自己的 X display 與 Chrome 行程、持久 Chrome profile（以 Bot 身分為鍵）。
- **Screen lease**：同一 Bot 同時只有一個驅動者；不同 Bot 可並行操作各自的螢幕。
- **Takeover**：使用者「接手控制」取得排他 lease；Bot 可主動 `request_takeover`（需要密碼、驗證碼或人為判斷時），run 進入 `waiting_takeover`，釋放後從 checkpoint 續跑。
- 桌面**延遲啟動**、run 結束釋放、整機閒置（預設 10 分鐘）後停止但保留工作目錄。
- 工作目錄在 run 完成 / 失敗 / 停止 / 閒置前 checkpoint 到 `AgentHomeStore`；換供應商時用 export / import 還原，而**不**翻譯廠商專屬的 VM 快照。
- 瀏覽器工具以 a11y snapshot + element ref 操作；失敗時回報「已確認的進度」與「結果是否不確定」，**絕不自動重播**不確定的動作。

### 3.6 記憶與上下文

- 三層：**MemoryDocument**（Markdown，有 revision，可匯出）、**語意記憶**（`save_memory` / `recall_memory`，每次 run 最多注入 5 筆）、**Scratchpad**（`open / parked / done` 的工作清單）。
- 歷史壓縮：每 50 則訊息批次摘要（summary 上限 20k 字元），history window 50 則；摘要只在後續訊息連續時使用，否則退回完整視窗，避免「默默產生缺口」。
- 工具迴圈偵測：同工具、同參數連續多次視為卡住。
- 大量 connector 工具以 **lazy catalog**（`search_tools` / `load_tool` / `execute_tool`）呈現，直接暴露上限 20 個，節省上下文。

### 3.7 對話呈現

- 進度訊息（`message_user`）限 500 字元，鼓勵少量高訊號更新。
- Routine 可回傳精確的 `NO_RESPONSE` 代表「沒事可報」，不產生聊天泡泡；有任何多餘文字就保留（fail closed）。
- 工具生命週期不直接顯示，只顯示結果與真正的求助。

## 4. 工程實踐

- `AGENTS.md` 規範：「只有在保護真實邊界時才加介面」、UI 文字即 UI（PR 需說明為何需要新增文案）、測試預設離線且決定性、Tokens 單一來源產生 CSS。
- `packages/testkit`：emulator、eval runner、computer replay（錄製 → 重播電腦操作）、效能報告。
- 大量 `*.postgres.test.ts` 針對真實 DB 語意（lease、交易）。

## 5. 優點與取捨

| 優點                                                | 代價                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| 伺服器架構讓 Bot 可 24/7 執行，所有裝置看到同一狀態 | 需要 PostgreSQL、worker、Docker，自架門檻高於純桌面 App             |
| 嚴格的 adapter + emulator，換供應商成本低           | 介面數量多，`executor.ts` 單檔超過 5000 行，核心迴圈複雜            |
| 冪等 effect、lease / fence，崩潰恢復可靠            | 狀態欄位與交易邏輯繁多                                              |
| 沙盒即安全邊界，沙盒內動作免審批，體驗順暢          | Team Computer 內 Bot 彼此不隔離，需使用者理解 Team / Private 的差別 |
