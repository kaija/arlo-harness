# OpenMausBot 產品與設計分析

- 來源：<https://github.com/milind-soni/OpenMausBot>（Apache-2.0；`enterprise/` 為 source-available）
- 分析快照：commit `294668d`（2026-09-24）
- 一句話定位：**「AI 團隊即通訊軟體」的本機優先桌面 App**；側欄每個聯絡人都是一個真正的 Agent，底層直接驅動使用者已安裝的 `claude` / `codex` / `grok` 等 CLI。

## 1. 產品功能

| 類別              | 功能                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot 本體          | 類 Telegram 聊天介面；每個 Bot 有自己的個性、模型、電腦、連接的 App；可釘選、標記未讀、複製、隱藏                                              |
| 引擎（BYO Agent） | Claude Code、Codex、Grok CLI、Antigravity、Cursor、Qwen、Gemini、OpenCode、Pi，以及任何 ACP CLI 或 OpenAI 相容端點（設定即可接入，不需寫程式） |
| 模型選擇          | 每個 Bot 可選模型與 effort，對話中途可切換；不可用的供應商會變暗並顯示原因                                                                     |
| 電腦              | 雲端 Linux 桌面（Box）、本機 VM、或使用者自己的電腦（Cua Driver，需明確開啟）；共享電腦池                                                      |
| 內建瀏覽器        | Electron 的 `WebContentsView`，每個 Bot 一個 tab、各自持久 partition，透過 MCP proxy 提供給 Agent                                              |
| 審批              | 對話中的 Allow / Deny / 回答卡片；五種審批等級（見 3.4）                                                                                       |
| 連接 App          | Composio 市集（Gmail、Slack、GitHub、Notion…）；使用者自訂 MCP server                                                                          |
| 頻道（Rooms）     | 多 Bot 的群組頻道，有獨立 transcript、共用指示、工作資料夾、回應規則與成員名單                                                                 |
| Chief of Staff    | 每個側欄 section 可指定一位負責協調的 Bot；接收團隊事故通報、派工                                                                              |
| 團隊套件          | 從單一 Markdown 檔（YAML frontmatter + playbook）一鍵安裝整個團隊：Bot、Chief、頻道、routine、connector 清單                                   |
| Routine / Webhook | 單次、每週幾、每 5–1440 分鐘；webhook 觸發器用獨立的本機接收器                                                                                 |
| Goal 模式         | `/goal`：持久目標，每回合判定 `done / continue / wait`，有回合預算                                                                             |
| 記憶              | 每個 Bot 的 `MEMORY.md` + 主題檔 + 每日日誌，純 Markdown                                                                                       |
| Skill             | `/learn` 把描述、URL、資料夾或「剛剛做的事」變成 `SKILL.md`                                                                                    |
| 語音              | 朗讀回覆、撥打電話給 Bot；ElevenLabs、Fish Audio、xAI、macOS 內建語音、本機 Chatterbox                                                         |
| 外部控制          | 提供 stdio MCP server，讓 Claude Desktop / Cursor 管理 Bot（刻意不暴露審批、刪除、憑證）                                                       |
| 部署              | macOS / Windows / Ubuntu 桌面版（內嵌 harness）、`npx openmausbot` 終端機版、VPS、手機配對（Tailscale / tunnel）                               |

## 2. 架構總覽

**兩個行程**：App 本身不持有任何傳輸；它以 HTTP 送出型別化指令，並把**一條 SSE 事件流**折疊成狀態。Harness server 擁有所有 Agent 行程，並把各供應商的原生協定正規化成**一種標準 runtime 事件流**。

```
┌ App（React + Tailwind，:5199）┐        ┌ Harness server（127.0.0.1:8799）──────────┐
│ 聊天 UI · 模型選擇 · 電腦面板   │─HTTP─▶│ Driver registry ─▶ Event bus ─▶ SSE        │
│ 單一 reducer，零 client 傳輸    │◀─SSE──│ Permission broker   每個 thread 一份 NDJSON │
└───────────────────────────────┘        └──┬───────────┬───────────┬────────────────┘
                                             │stream-JSON│JSON-RPC   │ACP
                                          claude CLI  codex CLI  grok CLI …
                                             └── permission request ──▶ broker（unix socket）
```

| 層      | 位置              | 職責                                                                   |
| ------- | ----------------- | ---------------------------------------------------------------------- |
| Drivers | `server/drivers/` | 每個供應商一檔；未知 driver 降級為「unavailable」，不讓整個 fleet 崩潰 |
| Harness | `server/harness/` | Registry（設定 → 活的 instance）與 fan-in event bus                    |
| API     | `server/index.ts` | Bot、turn、審批、模型目錄、電腦生命週期、connector、設定               |
| Shared  | `shared/`         | wire model、runtime 事件、審批等級等跨 App / Server 型別               |
| Desktop | `electron/`       | 內嵌 harness、平台能力（語音、本機控制）                               |

持久化是**檔案式**：`~/.openmausbot/` 下的 `bots.json`、`messages-<threadId>.json`、每個 thread 的 NDJSON 事件日誌、決策日誌、工作目錄。

## 3. 設計邏輯

### 3.1 Driver SPI：把所有引擎壓平成一個介面

`server/contracts.ts` 的 `ProviderAdapter` 刻意很小：

```ts
interface ProviderAdapter {
  capabilities: { sessionModelSwitch, agentsMcp?, computerMcp?, composioMcp?, browserMcp?,
                  images?, effortLevels?, queueing?, strictResume?, hooks?, … };
  sendTurn(input: SendTurnInput): Promise<{ turnId }>;
  interruptTurn(threadId, turnId?): Promise<void>;
  respondToRequest(threadId, requestId, decision): Promise<'allowed-once'|'rejected'|'answered'|'unavailable'>;
  steer?(threadId, text): Promise<'steered'|'refused'|'indeterminate'>;
  hasSession(threadId): boolean;
  stopAll(): Promise<void>;
  onEvent(listener): () => void;
}
```

設計要點：

- **Capability 旗標原則**：「絕不告訴 Bot 它有某個工具，除非它的 driver 真的能掛上」；UI 也不顯示 driver 無法執行的控制項（例如 effort、圖片貼上）。
- **Session 隱式建立**：第一次 turn 時啟動；`resumeCursor` 攜帶供應商原生的續接資訊（如 Claude session id）。續接失敗時以 `recoveryText` 重建，**絕不**產生默默遺失歷史的空白 session。
- **System prompt 分 stable / volatile**：記憶等會在對話中變動的段落單獨傳遞，避免每次記憶更新就重啟 CLI、讓供應商重建 prompt cache。
- **三態結果**：`steer` 回 `refused` 才可重新排隊；`indeterminate`（可能已送達）禁止重送，避免指令被執行兩次。`respondToRequest` 對已消失的請求回 `unavailable`，呼叫端視為拒絕（fail closed）。
- 標準事件型別僅 12 種：`session.started/exited`、`turn.started/completed/retrying`、`item.started/updated/completed`、`content.delta`、`request.opened/resolved`、`runtime.error`。

### 3.2 Harness 擁有一切，UI 只是投影

- Event bus 是 fan-in：所有 adapter 的事件合流，蓋上 instance id，tee 到每個 thread 的 NDJSON，再推給 SSE 與伺服器端的訊息 folder。硬性不變式：adapter 只能發自己 driver 類型的事件。
- Registry：設定解碼失敗或未知 driver → **unavailable shadow snapshot**，而不是啟動失敗，讓新舊版本設定可以前後相容。
- `system-prompt.ts`：**同一個 builder** 產生 Bot 實際收到的 prompt 與 UI 顯示的「模型看到什麼」，保證逐位元組一致。

### 3.3 對 CLI 引擎的「旁路介入」

因為工具呼叫發生在供應商 CLI 內部，harness 看不到也改不了，所以它在行程之間插入薄層：

- **permission-proxy**：Claude 的 `--permission-prompt-tool` 啟動的 MCP stdio server，透過 unix socket 把每個請求轉給 harness 的 broker，等待人類回覆。CLI 自己的 `AskUserQuestion` 也從這裡轉成聊天卡片。
- **mcp-gate**：包在每個 MCP server 外的透傳代理；過大的工具結果被截斷，原文寫到檔案並告訴模型路徑。
- **agents-proxy**：給 Bot 的同儕通訊工具（`list_bots`、`ask_bot`、`delegate_bot`…），路由回 harness，由 harness 控制 turn、權限與遞迴深度。
- **hooks**：Claude Code hooks 回報給 harness；harness 只觀察與注入上下文，不決定狀態。

### 3.4 審批等級：透傳供應商自己的權限模式

`docs/approval-levels.md` 的核心主張：**OpenMausBot 不自己判斷動作風險**——沒有 app 端 allowlist、classifier 或規則；每個等級就是供應商原生的權限模式。

| 等級              | 行為                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| Ask               | 供應商的監督模式，指令與檔案變更都詢問                               |
| Auto-accept edits | 自動接受檔案編輯（Claude / Grok `acceptEdits` 等）                   |
| Approve for me    | 使用供應商原生的自動審查（Codex、Claude auto mode…）；沒有的退回 Ask |
| Full access       | 供應商的寬鬆模式，並由 harness 自動回答殘餘的權限提示                |
| Custom            | 僅 Codex，讀取 `config.toml`                                         |

- Full / Custom **只能在打包後的本機桌面 App 開啟**（經私有行程通道，而非 Bot 可呼叫的 HTTP API），防止 Bot 自我提權。
- 設定屬於**來源對話**：既有 Ask thread 不會因 Bot 預設改成 Full 而變 Full。
- 切換到不同引擎時，Full / Custom 自動降回 Ask（授權綁定特定引擎的工具語意）。
- **Chief of Staff 的 Full access 會傳遞給它委派的工作**，解決「一個團隊的主人整天都在按審批」的問題；一般 Bot 委派仍用接收者自己的等級。
- 「Always allow this session」交給供應商自己記住；app 不保存常駐授權。
- **決策日誌**（append-only NDJSON）記錄每個工具呼叫被允許 / 拒絕 / 轉卡片的原因（哪條規則、是否無人值守），補足事件日誌缺少的「為什麼」。

### 3.5 多 Bot 協作

- **深度上限**：使用者發起的 turn 為 depth 0，可以 `ask_bot`；被問的 Bot 以 depth 1 執行且**沒有** agents 工具，阻擋 A→B→C 鏈。
- `ask_bot` 同步等待（有短的 inline 預算），超時降級為 `delegate_bot`（非同步，排在目標 Bot 空閒時執行，busy 重試 3 次）。
- 可選 `approvePeerComms`：Bot 之間的每次聯絡都要使用者核准，沿用同一套卡片流程。
- **Rooms**：多 Bot 頻道，每回合有時間上限（等待審批時不計時）；`coordinate_bots`、`post_to_room`、交接。
- **Goal 模式**：coordinator / worker 交替，最後一回合永遠留給 coordinator 做誠實的完成判定；busy 成員「停放並在空閒時續跑」，而不是讓目標失敗。
- **Incidents**：Bot 的 run 失敗 / 卡住時，事故以一個 turn 的形式送到該 section 的 Chief of Staff，附上 `retry_thread`、`delegate_bot` 的能力；使用者只看 Chief 的「Team incidents」thread。
- **Section context**：使用者管理、Bot **不可寫入**的團隊簡報，避免一個被誤導的 Bot 把指令寫進所有隊友未來的 prompt。

### 3.6 記憶：可讀、可編輯的 Markdown

```
~/.openmausbot/workspaces/<botId>/
├── MEMORY.md          每次 turn 載入（前 200 行或 24 KB，先到者為準）
└── memory/
    ├── <topic>.md     Bot 需要時用檔案工具自行讀取
    └── log/YYYY-MM-DD.md   每個完成的 turn 由 harness 追加一行
```

- 工作目錄同時是 Bot 的「桌子」：Bot 的檔案工具預設 cwd 在此，而不是使用者整個家目錄。
- 寫入為原子寫入、`0600`、自動 redact 憑證；UI 編輯帶 hash，Bot 同時修改時拒絕覆蓋；每次變更有 journal 可一鍵復原。
- **Recent-work brief**：每個 turn 的 prompt 附上 Bot 在「其他對話」最近說的話（兩天內、最多 10 行、約 350 tokens），讓 Bot 在頻道裡知道自己在 1:1 做過什麼，而不附整份 transcript。

### 3.7 可靠性防護

- **Turn watchdog**：看活動而非時長——一個 turn 可以跑一小時，但完全沒事件超過門檻才判定卡住；等待人類審批的 turn 豁免。
- **Repeat detector**：偵測同一工具 + 同參數反覆呼叫，只觀察並告知（CLI 引擎的呼叫不經 harness，無法直接中斷）。
- **Steer queue**：Bot 忙碌時送出的訊息先排隊，settle 後合併成一個 follow-up turn；支援 steer 的引擎可直接注入進行中的 turn。
- **Send idempotency**：client 產生的 nonce 對應到已持久化的訊息，重試不重複。
- **Spend cap**：以 usage ledger 計算當月花費，超過上限拒絕新 turn。

## 4. 工程實踐

- 程式碼大量以「為什麼」註解開頭（每個檔案頂部說明問題、先前的失敗模式、以及取捨）。
- `docs/plans/` 保存每個功能的計畫文件（問題 → 借鑑來源 → 設計），`docs/verification/` 規定驗證必須在隔離 fixture 進行，不碰使用者的實際資料。
- Server 以 Node 原生 type stripping 執行 TypeScript（不經編譯）。
- 新增引擎 = `server/drivers/` 一個檔案 + 一行註冊。

## 5. 優點與取捨

| 優點                                                     | 代價                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| 直接使用使用者既有的 CLI 訂閱與登入，零額外帳號          | 受制於各 CLI 的協定與行為差異，大量相容與復原邏輯                          |
| 審批透傳供應商原生模式，不自己做風險判斷                 | 各引擎能力不一致，同一個等級在不同引擎語意不同                             |
| 本機優先、檔案式儲存，易檢視、易備份                     | `server/` 約 190 個平鋪的非測試檔案、`index.ts` 超過 2 萬行；缺乏模組分層  |
| Chief of Staff、事故路由、團隊套件等「團隊營運」概念完整 | 概念數量多（section、room、channel、thread、delegation、goal），學習成本高 |
