# ADR 實作任務與 Waves

建立日期：2026-09-16。依據 [ADR 索引](README.md) 與 ADR-0001～0014。

這是開發工作的相依排程，不是 ADR-0005 所排除的產品內 DAG planner；不修改既有 Accepted 決策。Task 編號為本文件新建，並非原 ADR 已有的編號。

## 結論：哪些可以先做？

**不必等正式 UI，就能完成 Phase 1 的核心執行閉環，並先開發 Phase 2 的排程／事件／通知服務，以及 Phase 3 的語音後端。**

- **N：純 Node 可開發與驗收**：契約、Persona schema、A2A、Provider adapter、Skills／MCP、Session／排隊、派發、HITL 狀態機、trace 處理。Electron 介面用測試替身；最終跨行程整合仍需 E 類任務。
- **E：需要 Electron，但不需要正式產品 UI**：SQLite main service、safeStorage、utilityProcess、隱藏 BrowserWindow／WebContentsView、CDP、Toast、語音後端、打包。以空白 renderer、測試入口與本機測試頁驗收。
- **U：需要 renderer／使用者互動才能完整驗收**：聊天與設定面板、Action Center 回答操作、人工登入／captcha、麥克風／WebRTC、視窗切換體驗。

「沒有 UI」在本計畫指沒有正式 React 產品畫面。若連 Electron 或隱藏視窗都不允許執行，只能先驗收 N 類，不能宣稱瀏覽器／行程／safeStorage 已完成。

## 現況與使用方式

根 README 將目前專案描述為最小 Electron scaffold，五個 packages 為 placeholder；`docs/handoff-scaffold.md` 是先前骨架需求，不是完成紀錄。本次以文件規格拆解 backlog，**未逐項稽核程式實作，也未將 scaffold 存在視為功能已完成**。T01 先確認可沿用部分，其餘任務均待驗收。

同一 wave 的任務沒有彼此的必要前置，可平行安排；不同任務仍可能編輯同一 package，應事先分配檔案。表格列的是直接前置，間接前置由依賴鏈繼承。Waves 採保守批次排序；個別任務的前置完成後即可提早開始，不必等待無關支線。每個 task 應連同其必要測試交付，T25 是跨模組驗收，不是把測試延到最後。

## Waves 快查

```text
wave1:  [T01]
wave2:  [T02, T03]
wave3:  [T04, T05, T06, T07, T08]
wave4:  [T09, T10, T11, T12, T13]
wave5:  [T14, T15, T16, T17]
wave6:  [T18, T19, T20]
wave7:  [T21, T22, T23, T24, T25]
wave8:  [T26, T27, T28]
wave9:  [T29, T30]
wave10: [T31]
```

- **Wave 1–6：優先投入**。建立不依賴正式 UI 的核心；Wave 6 完成瀏覽器工具、派發與審批串接。
- **Wave 7：分支選擇點**。T25 驗收 Phase 1 無 UI 閉環；T21–T24 是可提前做的 Phase 2／3 服務，並非 Phase 1 的必要前置。
- **Wave 8–10：產品 UI 與交付**。T26、T27 不必等 Phase 2／3；若有 UI 人力，契約與其前置完成即可提早開工。T28 是仍可在沒有正式 UI 時完成的外部通知服務。

## 任務簡述表

ADR 欄以四位數對應 `adr/` 中同號文件。P1／P2／P3 沿用 ADR 的交付階段；階段是產品範圍，不等於技術上最早可開工的時間。

| Task | 任務與交付範圍 | ADR | 階段／環境 | 直接前置 | 完成驗收重點 |
|---|---|---|---|---|---|
| T01 | 確認 scaffold、package 邊界與建置入口，補缺漏 | 0001、0014 | P1／E | — | main／preload／renderer／agent-host 可建置；packages 不依賴 Electron；列出既有實作與缺口 |
| T02 | 共用資料契約：IPC、A2A envelope、事件、InterruptPayload、風險等級 | 0002、0004、0010、0011、0012 | P1／N | T01 | 可序列化且有執行期驗證；分離 Agent 與 renderer API；renderer 無讀取 secret 方法；鎖定風險預設值 |
| T03 | 測試與 CI 基線：Vitest、FakeModel、lint／typecheck、打包 smoke | 0014 | P1／E | T01 | FakeModel 可驅動 tool call；三平台 build／原生模組打包檢查及 macOS 空視窗 e2e；維持 packages 覆蓋率目標 80% |
| T04 | Persona／Provider 設定 schema、SKILL.md 解析與 Agent Card 產生 | 0003、0008、0009 | P1／N | T02、T03 | 全域／局部 binding、maxConcurrency 預設、skills 索引、MCP ref、非法設定皆可測 |
| T05 | A2A client／server／broker 完整傳輸 | 0004 | P1／N | T02、T03 | Node MessageChannel 驗證 send、stream、resubscribe、cancel、串流結束及錯誤清理；拒絕 Persona 直連 Persona；registry 更新 |
| T06 | main SQLite、migration、db RPC 與 state 事件 | 0011 | P1／E | T02、T03 | WAL、核心資料表／索引與重啟持久化；Agent 僅經 RPC 存取；run_states、delegations、notifications 先納入，P2 表可後續 migration |
| T07 | Provider adapter 與 Agent runner 基礎 | 0003、0014 | P1／N | T02、T03 | 三種 Provider 的建構設定與 streaming adapter；FakeModel 驗證工具／事件流；相容端點走 Chat Completions；不以 mock 宣稱真端點相容性 |
| T08 | Electron 視窗／browser host 基礎 | 0006、0007 | P1／E | T02、T03 | 延遲建立空白 Persona 視窗、hide 不銷毀、WebContentsView／partition／targetId 管理；loopback CDP、關閉背景節流 |
| T09 | secrets 與 Provider 設定服務 | 0003、0011 | P1／E | T04、T06、T07 | safeStorage 加密，無加密能力拒存；僅 main 解密；局部覆寫／全域繼承；金鑰經 Port 注入、下一 Run 套用設定 |
| T10 | Session／TaskStore 與 Thread 排隊引擎 | 0004、0009、0011 | P1／N | T04、T05、T06、T07 | IpcSession／IpcTaskStore；context 隔離、FIFO、submitted→working、並行上限、當前 Thread 介入、取消；最近 N 則＋系統摘要策略 |
| T11 | Workspace、Skills 與 MCP 載入 | 0008 | P1／N | T04、T07 | 漸進 load_skill、esbuild 轉譯 tools.ts、getWorkdir／延遲 getPage 介面、檔案／shell 工具；每 Persona 獨立 MCP；監看更新於下一 Run 生效；未確認外部 skill 不執行 |
| T12 | 最小事件／通知服務 | 0002、0010、0012 | P1 基礎／E | T06 | 持久通知、已讀／待處理狀態、actions 資料與查詢；Task／崩潰／HITL 事件入口；Toast 等級與關閉設定；不含完整 Action Center 畫面 |
| T13 | 本機 tracing、事件查詢與保留策略 | 0011 | P1／N | T06、T07 | 自訂 TracingProcessor／IpcTraceExporter，替換預設 OpenAI exporter；stream 狀態可訂閱；OTLP 可選；trace／messages 90 天、通知 30 天可配置 |
| T14 | Agent process manager 與啟動組裝 | 0002、0004、0008、0011 | P1／E | T05、T09、T10、T11、T12、T13 | 全部已啟用 Persona 與 Orchestrator 常駐；Port 註冊／設定推送；崩潰 Task failed，1／5／30 秒最多重啟三次、歷史還原；停用先 cancel 最多等 10 秒；MCP 清理 |
| T15 | Playwright 瀏覽器工具與 Run tab 配置 | 0006、0009 | P1／E | T07、T08、T10、T11 | 實作 ADR 全套 browser 工具、snapshot/ref、getPage；本機頁驗證跨 Persona session 隔離／重啟保留；每 Run 獨立 tab，共用 Persona cookies；刪除清理與 powerSaveBlocker |
| T16 | Orchestrator 委派與狀態聚合 | 0005、0009 | P1／N | T05、T07、T10、T11、T12 | delegate_to_* 動態更新、sync／async、30 分鐘可覆寫逾時、get／cancel／list；delegations 持久化；async 終態注入 Orchestrator 使用者 Thread 並續跑 |
| T17 | HITL 狀態機、權限與中斷儲存 | 0010 | P1／N | T07、T09、T10、T12 | low 自動；medium 可代答、直接使用者 Thread 則找人；high／auth／captcha 強制人工；RunState 保存恢復、拒絕／24 小時取消；tool_error 為重試或 failed，不掛起等待 |
| T18 | Agent＋瀏覽器實際跨行程接線 | 0002、0006、0007、0008 | P1／E | T14、T15 | utilityProcess 首次工具呼叫才建立 browser host；正確交付 targetId；隱藏／切換視窗不中斷；兩 Persona 並行及 getPage skill 實測 |
| T19 | 派發＋HITL 完整恢復流程 | 0005、0010 | P1／E | T14、T16、T17 | ask_orchestrator、escalate_to_user、同 taskId 回答／續跑；驗證回答者權限、雙 Thread 審批紀錄；真 utilityProcess 重啟後還原中斷 |
| T20 | renderer 白名單 API 與狀態訂閱 | 0007、0009、0010、0011 | P1／E | T08、T09、T10、T12、T13、T14、T16、T17 | 建立／停用／刪除 Persona、送訊息、派發／取消、回答、設定與狀態 snapshot／訂閱；隔離 renderer 權限；提供 UI 可用的契約及 fixtures |
| T21 | Cron 排程與模板引擎 | 0012 | P2／E | T14、T16 | croner 5／6 欄＋時區、全部模板變數、未知變數警告；schedule_runs、獨立／延續 Thread、立即執行；關機錯過記 skipped 不補跑 |
| T22 | 事件觸發與 inbound webhook | 0012 | P2／E | T14、T16 | triggers.events、payload 模板、來源 filter、鏈深度上限 5；loopback receiver、Bearer token 加密、webhook→Persona；用本機請求驗收 |
| T23 | 通知規則／Agent notify 服務 | 0012 | P2／E | T14、T16、T17 | notify 工具、系統事件通知、action_required 置頂與處理狀態、Toast 偏好；避免同一系統事件重複建立通知 |
| T24 | 語音後端：STT 與 ephemeral secret | 0013 | P3／E | T09、T10、T20 | Provider 能力判斷、檔案轉錄／大小限制與可選 ffmpeg 分段；短效 key 每次新取；voice metadata；用替身驗證路由，不需麥克風 UI |
| T25 | 無正式 UI 的 Phase 1 整合驗收 | 0002～0011、0014 | P1／E | T18、T19、T20 | FakeModel＋真 Electron＋本機頁：派發→排隊→browser tool→中斷→測試身份回答→續跑→落庫；另驗證 crash／cancel／重啟與背景執行 |
| T26 | 正式主視窗／Persona／設定 UI | 0001、0003、0007～0009、0011 | P1／U | T18、T20 | Chat、Thread、任務樹、Provider／Persona 設定、trace、tabs／導航、Agent 資源狀態與活動縮圖；首次外部 skill 確認、並行警告、視窗 show／focus／hide 與背景行為 |
| T27 | 人工 HITL 與 Action Center 核心 UI | 0007、0010、0012 | P1／U | T19、T20 | 人工回答／approve／reject／繼續、待辦徽章、跳到對應 Persona Thread；登入／captcha 在瀏覽器人工完成；驗證使用者實際恢復路徑 |
| T28 | Outbound webhook 與推播範本 | 0012 | P2／E | T23 | severity／source／type 篩選、URL／headers／body 模板、ntfy／Telegram 範本；退避重試三次，最終失敗通知不再轉發；用本機接收器驗收 |
| T29 | 排程／事件／通知管理 UI | 0012 | P2／U | T21、T22、T26、T27、T28 | 排程 CRUD／暫停／立即執行／歷史；webhook port／token 操作與轉發規則；完整 Action Center 設定與操作 |
| T30 | 語音 renderer 與麥克風體驗 | 0013 | P3／U | T24、T26 | 檔案選擇／文字回填、確認／直接送出；Realtime WebRTC transcription-only、PTT／VAD、能力開關與麥克風權限；正式 key 不進 renderer |
| T31 | 完整產品 e2e、發佈與更新流程 | 0014 | P1～P3／U | T25、T26、T27、T29、T30 | 三平台產物與原生依賴、macOS 功能 e2e；changesets／release workflow／更新通知與自願重啟；語音權限宣告；簽章憑證可後加，實際發佈另行操作 |

## 優先順序與里程碑

1. **現在開始：T01 → T02／T03。** 先把契約與測試入口做好，UI 和核心才可分開發展。
2. **先得到文字 Agent 閉環：T04–T07 → T09–T14 → T16／T17 → T19。** 不必等待 browser 工具或正式 renderer。用 FakeModel 與測試端注入使用者輸入即可證明派發、排隊、審批與恢復。
3. **再加瀏覽器：T08 → T15 → T18。** 這支線需要 Electron 與 Chromium，卻不需要聊天版面；T25 將兩條支線一起驗收。
4. **Phase 1 產品完成：T25＋T26＋T27，以及 T31 的 Phase 1 發佈驗收部分。** 不以 Phase 2／3 阻擋 Phase 1；T31 表中的全依赖代表三階段皆交付時的最終驗收。
5. **UI 尚未開始時繼續投入：T21／T22／T23／T24 → T28。** 這些服務可用 API／測試入口操作，待 T29／T30 補上產品互動。

不建議只按 ADR 號碼逐份完成：例如 0002 崩潰恢復先需要 0011 持久化；0005 派發需要 0009 Session／排隊；0010 HITL 需要 0012 的最小通知資料服務。此處因此將同一 ADR 拆成可獨立交付的 tasks。

## 開工前需釐清的接縫

以下是實作時的驗證／契約工作，不阻止其他獨立任務開工，也不在本文件擅自改 ADR：

- **T02／T05：broker 的服務呼叫權限。** ADR-0004 的星型 Agent 路由政策，需與 ADR-0011 的 `db/*`、以及排程／手動來源呼叫區分；不能讓 renderer 藉泛用 envelope 偽裝 Orchestrator。
- **T04／T16：schema 補齊。** ADR-0005 提到可在 yaml 覆寫委派逾時，但 ADR-0008 範例未命名該欄位；應定義欄位與預設並記錄。
- **T08／T18：CDP 相容性。** 以實際安裝的 Electron／Playwright 驗證 endpoint 綁定、origin 限制、targetId 對應與多 partition；mock 測試不足以證明此通道可用。
- **T11／T26：外部 skill 初次確認。** 無 UI 階段以內建 fixture 或明確的測試授權驗收；正式流程保留首次確認，不以「尚無 UI」繞過。
- **T17／T19：RunState 真正的可恢復範圍。** 以已安裝 SDK 驗證工具審批、question 與 auth/captcha 暫停如何序列化及重啟恢復；若與 ADR 假設不符，另提決策修訂。
- **T25：人工驗證的界線。** 測試身份回答可以證明協定與狀態機；不能取代 T27 的真實登入／captcha 操作，也不能把尚未授權的人工作業自動批准。

本文件僅建立開發 backlog，沒有建立 Codex 新 tasks、排程、自動執行或修改產品功能。

## 進度追蹤

| Task | 狀態 | 已完成 | 缺口（延後至後續 task） |
|---|---|---|---|
| T01 | 完成 | 新增 `apps/desktop/src/agent-host/`（utilityProcess 入口，載入 `@arlo/agent-runtime`）並接進 `electron.vite.config.ts`；main／preload／renderer／agent-host 皆可經 `pnpm --filter @arlo/desktop build` 建置；`packages/*` 仍為純 Node，不依賴 `electron` | Orchestrator／MessagePort handshake、Provider 金鑰注入等真正邏輯留給 T14；agent-host 目前只回報 `ready` |
| T02 | 完成 | `packages/shared` 以 zod 4 定義契約，每個型別都有執行期驗證，所有值皆為純 JSON（測試以 JSON 與 structuredClone 來回驗證）：`AgentId`／PersonaId、JSON-RPC 與 ADR-0004 envelope、Agent↔main 訊息（`agentServiceContract` 涵蓋 `db/session.*`、`db/tasks.*`、`db/runStates.*`、`trace/spans.export`、`registry/list`，以及 main→Agent 的 `provider/configure`／`registry/updated` control 訊息）、renderer 的 `rendererInvokeContract` 白名單與 `state/*` 事件、ADR-0012 的 8 種 event bus 事件、`InterruptPayload`／回答／回答權限、內建工具風險預設表與 `resolveToolRiskLevel`、`ProviderProfile`／`ModelBinding`；共 71 個測試，覆蓋率 100%。**接縫 T02／T05 的處理**：main 自行發起的 A2A 請求使用 `system:user`、`system:schedule`、`system:event` 作為 `from`；broker 以 `isEnvelopeFromPort` 要求 port 只能代表自己的 AgentId，因此 renderer 與 Persona 都無法冒充 Orchestrator；Agent 服務的參數不含 agentId，由 main 依 port 決定範圍。**ADR 未指定、由本 task 補上的決策**：PersonaId 限小寫 kebab-case、最長 48 字元，並保留 `orchestrator`；檔案工具命名為 `fs_read`／`fs_list`／`fs_write`／`fs_delete`；Skill `tools.ts` 工具預設 medium；`delegate_to_*` 為 low；寫入 workdir 以外一律 high，不受覆寫影響；envelope 欄位統一為 `payload`（ADR-0004 第 2 點寫 `event`，第 3 點寫 `payload`）；task 狀態使用 Arlo 自己的名稱，與 A2A 線路版本無關 | **需另提 ADR 修訂**：ADR-0004 將 `-32003` 定為 forbidden route，但 A2A 已將 `-32003` 用於 PushNotificationNotSupported；目前沿用 ADR，並以 `error.data.reason === 'forbidden_route'` 區分（`isForbiddenRouteError`）。**T05 需決定**：已安裝的 `@a2a-js/sdk` 1.1.0 預設為 A2A v1.0（`SendMessage`、`TASK_STATE_*`、`ClientFactory`＋`JsonRpcTransportFactory`，沒有 `A2AClient`），而 ADR-0004 描述的 `message/send`／`A2AClient` 屬於 v0.3（位於 `compat/v0_3`），所以 envelope 不檢查 A2A 方法名稱。renderer 契約目前只是起始集合，建立 Persona、Provider 設定、snapshot 與通知由 T20 補齊；Agent 服務方法由 T06／T10／T13／T16／T17 依實作擴充（例如重啟還原所需的 runStates 列表、delegations）；v1 schema 不接受 `external:<url>`；desktop 與其他 packages 尚未使用 `@arlo/shared`（T05／T20 接上） |
| T03 | 完成 | 根目錄新增 Vitest + `@vitest/coverage-v8`（`vitest.config.ts`，80% 門檻）；`packages/agent-runtime/testing` 提供 `FakeModel`／`runFakeAgentLoop`（可腳本化 text／tool_call 並驅動假工具）及對應單元測試；`apps/desktop` 新增 Playwright `_electron` 冒煙測試（啟動 App、驗證視窗內容）；CI 新增 `pnpm test` 與僅 macOS 執行的 `pnpm --filter @arlo/desktop test:e2e` 步驟 | 尚無 `better-sqlite3` 等原生模組，因此「原生模組打包檢查」要等 T06 導入 SQLite 後才能驗證；80% 覆蓋率門檻目前只涵蓋已有測試的檔案（`coverage.all: false`），隨每個 task 落地程式碼需一併補測試以維持門檻 |
| T04 | 完成 | `packages/persona-schema`：`personaConfigSchema`／`parsePersonaYaml`（YAML core schema、拒絕重複鍵與 alias 爆炸；未知欄位一律報錯）、`globalSettingsSchema`（`providers`、`defaultBinding`、`orchestrator.modelBinding`、`mcpServerTemplates`）與 `resolveModelBinding`（Agent 覆寫優先，否則繼承全域）、`resolveMcpServers`（`ref` 展開成各 Persona 自己的定義）、`parseSkillMarkdown`／`selectSkills`／`buildSkillIndex`（`load_skill` 漸進揭露的索引）、`loadPersonaWorkspace`（讀 persona.yaml 與 skills/，只有會用到的壞 skill 才讓載入失敗）、`personaAgentCard`／`buildAgentCard`（A2A v1.0 card）；所有錯誤以 `{ path, message }` 一次回報全部。40 個測試。**接縫 T04／T16 的處理**：委派逾時欄位定為 `delegation.timeoutMinutes`，預設 30、範圍 1–1440（上限對齊 24 小時中斷逾時）。**ADR 未指定、由本 task 補上的決策**：`maxConcurrency` 範圍 1–16；`tools.builtin` 預設 `[]`、`browser.enabled` 預設 false，且 `browser` 工具群組必須搭配 `browser.enabled: true`；`alwaysOn` 只接受 true；MCP 內嵌定義支援 `stdio`（`command`／`args`／`env`／`cwd`）與 `streamable_http`（`url`／`headers`），server 名稱不可含 `.`（風險鍵為 `<server>.<tool>`）；SKILL.md 依 Agent Skills 規則驗證 `name`（須等於目錄名）與 `description`，其他 frontmatter 鍵保留不報錯以相容社群 skill；Persona id 必須等於 workspace 目錄名；Agent Card 只宣告一個 JSON-RPC 介面 `arlo://agents/<agentId>`，`streaming: true`、`pushNotifications: false`，skill id 即 skill 名稱 | `triggers.events` 目前只接受空陣列，事件觸發欄位由 T22 定義；yaml 中的 MCP `env`／`headers` 為明文，機密引用機制尚未設計；全域設定存放位置（DB 或檔案）由 T09 決定；檔案監看、`tools.ts` 轉譯、`load_skill` 工具與 workdir 建立屬 T11 |
| T05 | 完成 | `packages/a2a-transport`：`AgentChannel`（Agent 端單一 port，分流 A2A、`service-request`／`service-response` 與 control 訊息）、`MessagePortA2AServer`（SDK `JsonRpcTransportHandler`＋`DefaultRequestHandler`；串流以 `stream-event`／`stream-end` 回傳，首個事件前的錯誤以 `a2a-response` 回傳）、`createMessagePortFetch`／`createA2AClient`（注入 SDK `JsonRpcTransportFactory` 的 `fetchImpl`）、`A2ABroker`（星型路由、port 身分檢查、回應必須對應進行中的請求、Agent Card registry 與 `registry/updated` 廣播、`registry/list` 內建、依 port 決定 agentId 的服務分派、`system:*` 來源的 client）、`summarizeTaskJson` 等 task state 對應。36 個測試以 Node `MessageChannel` 驗證 send、stream、resubscribe、cancel、執行失敗、串流中途失敗、Persona 直連 Persona 被拒、冒充來源被丟棄、偽造回應被丟棄、目標行程斷線時進行中的 unary／stream 都收到錯誤、呼叫端 abort 後 Task 仍在 Persona 端完成、registry 更新與服務範圍。**T02 遺留決策**：採用 SDK 原生 A2A v1.0（`SendMessage`、`SendStreamingMessage`、`SubscribeToTask`、`CancelTask`、`ClientFactory`），不走 `compat/v0_3`；ADR-0004／0005 的 `message/send`、`message/stream`、`tasks/resubscribe`、`tasks/cancel` 分別對應上述方法。**接縫 T02／T05 的處理**：`system:*` 可送達任何 Agent，Agent 之間仍只允許 Orchestrator↔Persona；broker 只轉送能對上「請求者→目標→requestId」的回應。**ADR 未指定、由本 task 補上的決策**：fetch 只接受 `arlo://agents/<agentId>` URL，且 card 的端點必須等於目標 Agent，card 無法讓 Agent 連外；broker 產生的錯誤使用 `-32050` 並以 `data.reason`（`agent_unavailable`、`agent_disconnected`、`duplicate_request`）區分；Task 不依呼叫者分隔（使用者須能續答 Orchestrator 發起的 Task），呼叫者以 `callerOf(context)` 取得；envelope 維持 ADR 的四種 kind，沒有取消串流的 frame：呼叫端 abort 只停止讀取，Persona 端會繼續消化串流，因為 SDK 在消費串流時才寫入 TaskStore；服務 handler 丟出 `ServiceError` 才會把錯誤內容傳給 Agent，其他例外只回通用錯誤 | 請求逾時由呼叫端處理（T16 的 30 分鐘）；broker 對沒有回應也沒有斷線的請求不會清除紀錄；Electron `MessagePortMain`／`parentPort` 轉接成 `PortEndpoint`、main 端實際接線屬 T14；Agent 端 `IpcTaskStore`／`IpcSession` 屬 T10 |
| T06 | 完成 | `apps/desktop/src/main/db`：drizzle-orm schema＋drizzle-kit migration `0000_init`（`personas`、`provider_profiles`、`secrets`、`threads`、`messages`、`run_states`、`a2a_tasks`、`delegations`、`notifications`、`trace_spans` 與索引）、`openDatabase`（WAL、`foreign_keys`、`busy_timeout`、套用 migration，失敗時關閉連線；檔案已有資料表卻沒有 migration 紀錄時，不寫入並以 `UnmanagedDatabaseError` 提示移開舊檔）、`AgentStore`（Thread 歷程、Task、RunState）、`registerDbServices` 把 `db/*` 掛到 broker、`state/task` 與新增的 `state/thread` 事件；main 啟動時開啟 `<userData>/arlo.db`，打不開就顯示錯誤並結束，結束時關閉。11 個單元測試（含經 broker＋`MessageChannel` 的 RPC 與 Agent 範圍隔離）；Electron e2e 驗證 App 建立 WAL 資料庫且重啟後資料保留；手動確認 macOS 打包後的 App 能開啟資料庫。**ADR 未指定、由本 task 補上的決策**：時間欄位為 Unix 毫秒；Agent 寫入的表（含 `trace_spans`）以 `agent_id` 為主鍵一部分，同一 id 由別的 Agent 查詢得不到資料；`better-sqlite3` 13 內建 N-API prebuild，Node 測試與 Electron 44 共用同一份二進位，因此 `npmRebuild: false` 並以 `asarUnpack` 解出；`ARLO_USER_DATA_DIR` 可覆寫 userData（測試用，e2e 冒煙測試也改用暫存目錄）；migration 由 electron-vite 複製到 `out/main/migrations`。**T01 遺留問題的修正**：`@arlo/*` 改為 desktop 的 devDependencies，讓 electron-vite 打包進 bundle；先前會被 externalize，`out/main/agent-host/index.js` 執行時會去 import TS 原始碼 | 三平台 prebuild 只在 macOS 實測，Windows／Linux 需 CI 確認；main 尚未建立 broker 與 Agent 行程（T14）；`trace/spans.export` handler 與 90／30 天保留策略屬 T13；`threads.source` 由 T10 建立 Thread 時寫入；`delegations`、`notifications` 只建表，邏輯屬 T16／T12；P2 表（`schedules`、`schedule_runs`、`events`）由 T21／T22 以新 migration 加入；改 schema 後需執行 `pnpm --filter @arlo/desktop db:generate` |
| T07 | 完成 | `packages/agent-runtime`：`createModelProvider`／`createOpenAIClient`（`openai` 走 Responses；`openai_compatible` 與 `azure_openai` 走 Chat Completions）、`ModelConfig`（接收 `provider/configure`，每個 Run 開始時擷取 Provider，設定變更只影響下一個 Run）、`AgentRunner`（串流執行並回傳 completed／interrupted（含序列化 RunState）／canceled／failed）、`toAgentRunEvents` 與 `@arlo/shared` 的 `agentRunEventSchema`（JSON 化的串流事件）；`FakeModel` 改為在 SDK `ScriptedModel` 上實作 SDK `Model`，新增 `FakeModelProvider` 與 `error` turn，保留 `runFakeAgentLoop`。新增 23 個測試：FakeModel 驅動真 SDK 迴圈完成 tool call、事件可序列化、`needsApproval` 中斷後以 JSON 保存的 RunState 核准續跑、session 歷程、模型錯誤、abort、執行中改設定不影響本次 Run；另以本機 HTTP stub 鎖定三種 apiType 的請求形狀（路徑、`Authorization` 或 `api-key`、`api-version`、串流、Chat Completions tool call 往返）。**ADR 未指定、由本 task 補上的決策**：依賴 `@openai/agents-core`＋`@openai/agents-openai`（0.18.0）而非 `@openai/agents`，因為後者在 import 時就註冊 OpenAI trace 上傳與讀環境變數的預設 Provider，違反 ADR-0011 §9；每個 Run 建立自己的 `Runner({ modelProvider })`，不呼叫全域 `setDefaultModelProvider`；`azure_openai` 的 `baseUrl` 是資源端點（程式補上 `/openai`），`binding.model` 是 deployment 名稱；建立 client 時明確傳入 baseURL、organization、project 等，`OPENAI_*`／`AZURE_OPENAI_*` 環境變數無法把金鑰導向別處 | 本機 stub 只證明請求形狀，未對真實 OpenAI、相容端點或 Azure 驗證；`binding.settings` 直接當成 SDK `ModelSettings` 使用，未逐欄驗證；`IpcSession` 屬 T10，TracingProcessor 屬 T13，Agent 組裝（instructions、skills、工具）屬 T11／T14，e2e 用的 `apiType: 'fake'` 屬 T14／T25 |
| T08 | 暫緩 | — | 依使用者指示，等 UI design 提供後再開始 |

wave1（T01）與 wave2（T02、T03）已完成；wave3 的 T04–T07 已完成，T08 暫緩等待 UI design。wave4 的 T09–T13 前置皆已完成，可以開工；T15 仍需 T08。
