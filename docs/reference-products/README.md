# 參照產品

本目錄收錄與 Arlo Harness 定位相近的開源產品分析，作為設計參照。這裡的文件**不是**決策；
採用任何做法時，仍須在 [docs/spec/adr](../spec/adr) 新增或修訂 ADR。

| 產品        | 文件                             | 一句話定位                                                                       |
| ----------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Rakazo      | [rakazo.md](rakazo.md)           | 可自架、跨 Web / Electron / 行動裝置的持久化 AI 隊友平台（伺服器 + PostgreSQL）  |
| OpenMausBot | [openmausbot.md](openmausbot.md) | 「AI 團隊即通訊軟體」的本機優先桌面 App，直接驅動使用者已安裝的 Agent CLI        |
| Codex       | [codex.md](codex.md)             | OpenAI 的本機 coding agent（Rust），以 OS 原生 sandbox 隔離 Agent 執行的每個指令 |

分析快照日期：2026-09-24。三者都在快速演進，引用細節前請對照上游最新版本。

## 對照

| 面向             | Arlo Harness（ADR）                                                                                     | Rakazo                                                   | OpenMausBot                                             | Codex                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| 形態             | Electron 桌面 App                                                                                       | Web 伺服器 + Electron / Expo 客戶端                      | Electron 桌面 App + 本機 harness server                 | CLI / TUI / IDE / 桌面 App，共用 Rust core 與 app-server                   |
| Agent 執行位置   | 每個 Persona 一個 `utilityProcess`（[0002](../spec/adr/0002-process-model.md)）                         | API / worker 行程內的 Pi runtime                         | 使用者本機的供應商 CLI 子行程                           | Codex 行程內；Agent 執行的指令在 OS sandbox 子行程中                       |
| Agent SDK / 模型 | OpenAI Agents SDK，OpenAI / 相容 / Azure（[0003](../spec/adr/0003-agent-sdk-and-model-providers.md)）   | Pi，BYOK 多供應商                                        | Claude Code、Codex、Grok 等 CLI，另有 ACP / OpenAI 相容 | 自有 agent loop，Responses API；另支援 Ollama、LM Studio 等                |
| Agent 間通訊     | A2A JSON-RPC over MessagePort，星型（[0004](../spec/adr/0004-a2a-over-messageport.md)）                 | 內建工具 `message_bot`、`handoff_to_bot`、`run_subagent` | MCP 工具 `ask_bot`、`delegate_bot`，depth 上限 1        | 行程內 multi-agent 工具（spawn、訊息）                                     |
| 協調者           | Orchestrator，Persona 即 `delegate_to_*` 工具（[0005](../spec/adr/0005-orchestrator-task-dispatch.md)） | 無中央協調者，Bot 彼此對等                               | 每個 section 的 Chief of Staff（也是一般 Bot）          | 主 Agent 自行派生子 Agent                                                  |
| 電腦 / 瀏覽器    | Electron 內嵌 WebContentsView + Playwright CDP（[0006](../spec/adr/0006-browser-automation.md)）        | 遠端 / Docker 沙盒 Linux 桌面，Team / Private            | 雲端 Box、本機 VM、本機電腦（Cua），外加內建瀏覽器 tab  | 無內建桌面；以 shell 在 Seatbelt / bwrap / Windows sandbox 內操作本機      |
| HITL             | 三級風險，Orchestrator 先代答（[0010](../spec/adr/0010-hitl-and-risk-levels.md)）                       | App 端工具分類 + 可選 LLM auto-review，不確定就問        | 透傳供應商原生權限模式，App 不判斷風險                  | `AskForApproval` × execpolicy 規則 × guardian 審查；sandbox 被拒才詢問提權 |
| 持久化           | main 持有 SQLite（[0011](../spec/adr/0011-persistence-secrets-observability.md)）                       | PostgreSQL + Prisma                                      | JSON / NDJSON / Markdown 檔案                           | rollout JSONL（可壓縮）+ SQLite 狀態庫                                     |
| 記憶             | Thread 歷程（[0009](../spec/adr/0009-conversation-threads-and-concurrency.md)）                         | Markdown 文件 + 語意記憶 + scratchpad + 歷史壓縮         | `MEMORY.md`（200 行 / 24 KB）+ 主題檔 + 每日日誌        | `AGENTS.md` + memories                                                     |
| 排程 / 觸發      | croner + webhook 接收器（[0012](../spec/adr/0012-scheduler-events-notifications.md)）                   | Routine（排程的 prompt）+ Graphile Worker                | Routine + 本機 webhook 接收器 + Goal 模式               | 開源 repo 中未見排程器；另有雲端任務（`cloud-tasks`）                      |
| Skill            | `SKILL.md` + TS tool 模組（[0008](../spec/adr/0008-persona-workspace-and-skills.md)）                   | Skill CRUD 工具、Teach（錄製操作 → playbook）            | `/learn` 產生 `SKILL.md`、團隊套件                      | Skills（`SKILL.md`）                                                       |

## 對 Arlo 的啟示

以下依對應的 ADR 排列，標示「值得借鏡」的設計，以及 Arlo 採用前需要考慮的地方。

### 行程與執行期（ADR-0002、0003）

- **Capability 旗標驅動 UI 與 prompt**（OpenMausBot）：不讓 Agent 以為它擁有 runtime 無法掛上的工具，UI 也不顯示無法作用的控制項。Arlo 的 `ProviderProfile.capabilities` 可延伸為同樣的單一真相來源（例如 realtime、vision、effort）。
- **Run 狀態機 + 轉移表**（Rakazo `run-state.ts`）：A2A Task 狀態已有規範，但 Persona 內部的 Run（排隊、執行、等待人工、重試）可比照做一個純函式轉移表放在 `packages/shared`，由 main 與 agent-runtime 共用。
- **Watchdog 看活動而非時長**（OpenMausBot）：ADR-0005 的 30 分鐘同步逾時是看總時長；加上「無事件超過 N 秒視為卡住、等待人工時豁免」可以更早抓到卡死的 utilityProcess。

### Agent 間協作（ADR-0004、0005）

- **遞迴深度上限**（OpenMausBot）：Arlo v1 以星型拓撲避免 Persona 之間互呼；未來開放拓撲時，可以沿用「被呼叫者不配發協作工具」的做法作為第二道防線。
- **Busy 時停放並在空閒時續跑，而不是失敗**（OpenMausBot Goal v2）：對應 ADR-0009 的 `maxConcurrency` 排隊；應確保排隊中的委派不會被 Orchestrator 誤判為失敗。
- **事故路由給協調者**（OpenMausBot Incidents）：Persona 崩潰或 Task 失敗時，除了寫入 Action Center，也可以把事故當成一則系統訊息注入 Orchestrator thread，讓它決定重試或改派。

### HITL（ADR-0010）

- 三種取向：Arlo 採**風險等級 + Orchestrator 代答**；Rakazo 採 **App 端工具分類 + LLM 審查（fail toward asking）**；OpenMausBot 採**透傳供應商模式**。由於 Arlo 掌握 OpenAI Agents SDK 的 tool 層，較接近 Rakazo，可參考：
  - 以工具名稱 pattern 將 connector / MCP 工具預設分為讀取與變更（`get/list/search` vs `send/delete/pay/publish`），作為未標註 `riskLevel` 時的預設。
  - **審批綁定參數雜湊與連線版本**（Rakazo `approval-effect-key`）：避免審批被重播到不同參數或重新授權後的帳號。
  - **提權只能經由使用者專屬通道**（OpenMausBot Full access 只能從桌面 App 的私有行程通道開啟）：Arlo 的風險設定寫入應只接受來自 renderer IPC，而不是 Agent 可呼叫的工具。
  - **決策日誌**（OpenMausBot）：在 `trace_spans` 之外記錄「哪個規則允許或擋下哪個工具呼叫」，除錯與稽核都更清楚。

### 瀏覽器與電腦（ADR-0006、0007）

- **失敗動作回報「是否不確定」，不自動重播**（Rakazo）：`browser-tools` 可在結果中加入 `uncertain` 欄位，並在 prompt 中要求先觀察再行動。
- **Takeover 作為 Run 狀態**（Rakazo `waiting_takeover`）：對應 ADR-0010 的 `auth_required` / `captcha`，使用者在 Persona 視窗接手後，由 checkpoint 續跑。
- **大型工具結果截斷落檔**（OpenMausBot mcp-gate）：MCP 或 `browser_snapshot` 結果過大時截斷並寫入 workdir，把路徑告訴模型。

### 持久化、記憶與可觀測性（ADR-0008、0009、0011）

- **副作用冪等表**（Rakazo `ExternalEffect`）：utilityProcess 崩潰重啟（ADR-0002 第 4 點）後，避免重送已執行的外部動作。
- **可編輯的 Markdown 記憶 + 載入預算**（OpenMausBot）：可放在 Persona workspace（ADR-0008）下，例如 `MEMORY.md`，並在 UI 上顯示「實際載入多少」。
- **Prompt 預覽與實際送出逐位元組一致**（OpenMausBot `system-prompt.ts`）：與 ADR-0007 的「思維鏈 / 工具日誌」面板相輔，便於除錯。
- **Stable / volatile system prompt 分離**：記憶變動不應破壞 prompt cache。
- **歷史壓縮的連續性檢查**（Rakazo）：摘要與後續訊息之間若有缺口，就退回完整視窗，而不是默默遺失上下文。

### 排程（ADR-0012）

- **Routine 可回報「無事可報」**（Rakazo `NO_RESPONSE`）：避免排程產生大量空泛訊息，只有剛好等於 sentinel 時才靜默（fail closed）。
- **Interval 不堆積**（OpenMausBot）：上一次仍在執行時跳過本次；與 ADR-0012「錯過不補跑」的精神一致。

### 執行隔離與 Sandbox（ADR-0002、0008、0010）

Arlo 目前的信任模型（ADR-0008「本機信任模型」）讓 Persona 的 TS tool 模組、MCP server 與未來的 shell 工具以使用者權限直接執行。Codex 示範了不靠 Docker / VM 也能做到的隔離：

- **政策是資料，平台實作是翻譯**：把 `persona.yaml` 的權限寫成類似 `PermissionProfile` 的結構（路徑 → `read` / `write` / `deny`，越具體越優先，同具體度 `deny > write > read`），再由 main 翻譯成各平台機制。macOS 優先時可先做 Seatbelt，Linux 用 bubblewrap + seccomp。平台無法表達的政策要明確失敗，不能默默放寬。
- **保護邊界本身**：Persona `workdir` 可寫，但 `persona.yaml`、`skills/`、`.git` 等「能改變下一次權限或執行內容」的路徑要唯讀，對應 Codex 的 `.codex` / `.agents` / `.git` 保護與 root anchor。
- **Sandbox 與審批分開**：ADR-0010 的風險等級管「何時問人」，sandbox 管「技術上能做什麼」。可比照 Codex 的「先在 sandbox 內跑，被拒才詢問是否提權」，並對「繞過 sandbox 就會失去某項保護」的情況一律不提權。
- **網路雙層強制**：OS sandbox 只允許連到本機 proxy，proxy 再依網域 allow/deny 決定目的地；主機名稱解析到私有 IP 時阻擋。Persona 的瀏覽器走 Electron session，也可以用 `session.setProxy` 接到同一個 proxy。
- **指令規則可測試**：若 Arlo 要提供 shell 工具，可參考 execpolicy 的前綴規則（`allow / prompt / forbidden`），並在規則中附 `match` / `not_match` 範例、載入時驗證。
- **Electron 自身強化**：參考 `process-hardening`，在 utilityProcess 關閉 core dump、清除 `LD_*` / `DYLD_*`，保護 ADR-0011 經 MessagePort 注入的 API key。

### 程式碼組織

- Rakazo 的 **`adapter-kit`（介面）/ `adapters`（實作 + emulator）/ `core`（純函式）** 分層，與 Arlo 的 `packages/*` 相容，可作為 `agent-runtime` 與 `browser-tools` 擴充供應商時的範本；每個供應商配 emulator 與共用 conformance test，符合 ADR-0014 的 FakeModel 方向。
- 兩個專案都出現**超大型單檔**（Rakazo `executor.ts` 約 5,200 行、OpenMausBot `server/index.ts` 約 20,000 行），OpenMausBot `server/` 也缺乏子目錄分層。Arlo 應及早依職責切分 main process 的 broker、scheduler、window manager，避免重蹈覆轍。
