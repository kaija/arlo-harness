# Arlo Harness 架構決策紀錄（ADR）

本目錄記錄「基於 Electron、以隱私為核心的泛用型桌面端 AI Agent 平台」的架構決策。每份 ADR 對應一組相關決策，含背景、決策、替代方案與後果。

- 初版：所有 ADR 於 2026-09-15 經需求盤問（grilling）確認後建立。
- 2026-09-25 修訂：經第二次盤問，架構改為 **Privacy Agent + Operator**。依使用者決定，受影響的 ADR **就地改寫**，每份 ADR 標頭的「修訂」列記錄日期與變更範圍；新主題以 ADR-0015～0018 新增。盤問結論見下方「2026-09-25 盤問決策」。

## 產品定位

類似 OpenManus 的通用代理：Operator 可以瀏覽網頁、操作桌面（computer use）、呼叫 MCP 與 skills，做任何事。差別在於**所有任務都先經過 Privacy Agent**：

- Privacy Agent 綁定使用者選擇的 Provider 與模型，通常是自架 LLM 或 AI PC 本地 SLM。
- 它決定資料怎麼處理：
  - 最小化後以別名交給雲端 Operator；
  - 只給 schema，由 Operator 寫腳本、在本機沙箱跑真實資料；
  - 或完全在本地處理。
- 使用者不需要知道哪些內容可以交給雲端 LLM，也能安心使用。

## 系統總覽

```
                         使用者 / 排程 / 事件 / webhook
                                     │ (system:*)
┌──────────────────────── Electron main process ────────────────────────────────┐
│ A2A Broker + 路由政策   SQLite (vault / ledger / …)   Scheduler   Event Bus      │
│ Window Manager   Action Center   Secrets(safeStorage)   Sandbox service         │
│ CDP port (127.0.0.1)   Webhook receiver (127.0.0.1)   Outbound webhooks         │
└────┬──────────────────┬──────────────────┬──────────────────┬────────────────┬──┘
     │ MessagePort      │ MessagePort      │ MessagePort      │ spawn          │ IPC
┌────▼──────────┐ ┌─────▼─────────┐ ┌──────▼──────────┐ ┌─────▼──────────┐ ┌───▼──────────┐
│ Privacy Agent │ │ Planner       │ │ Operator A … N  │ │ Script sandbox │ │ Renderers    │
│ 本地/自架模型 │ │ 雲端（僅 SLM  │ │ 雲端或本地模型  │ │ Seatbelt/bwrap │ │ Main window  │
│ SLM Flow 或   │ │ 模式）        │ │ browser、MCP、  │ │ /Win token/    │ │ (Privacy 對話│
│ LLM Flow      │ │ delegate_to_* │ │ skills、        │ │ Pyodide        │ │  Ledger…)    │
│               │ │               │ │ computer use    │ │ 無網路、唯讀   │ │ Operator 視窗│
└───────────────┘ └───────┬───────┘ └───────┬─────────┘ └────────────────┘ └──────────────┘
                          │                  │
                ┌─────────▼──────────────────▼─────────┐
                │ Privacy Gate（GuardedModel）          │  ← 所有送往 trustZone=cloud
                │ 規則層 + 語意層偵測 → 別名化 → 驗證   │     的模型請求都必經
                └──────────────────┬───────────────────┘
                                   ▼
                              雲端 LLM Provider
```

- Privacy Agent 是唯一入口。
  - **SLM 模式**：程式驅動的隱私流程，任務規劃交給雲端 Planner；Planner 只看得到別名。
  - **LLM 模式**：Privacy Agent 本身就是 Orchestrator，以 route 工具外送資料。
  - 模式由使用者手動選擇。
- 隱私保證由程式強制，不依賴模型判斷。Gate 位於模型請求邊界，任何來源的資料都繞不過；別名在本機工具邊界還原，雲端永遠只看到別名。
- 每個 Agent 一個 utilityProcess、App 啟動時常駐。Agent 間走 A2A JSON-RPC over MessagePort，main 作 broker；每個 Operator 一個可隱藏的 BrowserWindow；資料、機密、Vault、Ledger、trace 全部由 main 持有的單一 SQLite 管理。

## ADR 索引

| 編號 | 主題 | 階段 |
|---|---|---|
| [0001](adr/0001-runtime-and-repository-structure.md) | 執行環境與程式碼庫結構：Electron、electron-vite、React 19、pnpm monorepo；`privacy`、`sandbox`、`computer-use` packages | 1 |
| [0002](adr/0002-process-model.md) | 行程模型：Privacy Agent、Planner（SLM 模式）、每個 Operator 各一個常駐 utilityProcess；短命的腳本沙箱行程 | 1 |
| [0003](adr/0003-agent-sdk-and-model-providers.md) | OpenAI Agents SDK；Provider 與 `trustZone`；Privacy Agent 獨立綁定（可雲端但警告）；本地模型走 OpenAI 相容端點 | 1 |
| [0004](adr/0004-a2a-over-messageport.md) | A2A over MessagePort；AgentId `privacy`／`planner`／`operator:<id>`；以 Privacy Agent 為入口的路由政策 | 1 |
| [0005](adr/0005-privacy-agent-and-task-dispatch.md) | Privacy Agent 的 SLM／LLM 兩種 Flow、Privacy Routes R0–R4、Planner 與委派 | 1 |
| [0006](adr/0006-browser-automation.md) | 瀏覽器：Playwright connectOverCDP、persist partition；瀏覽器內容經 Gate、navigate／type 為外送型工具 | 1 |
| [0007](adr/0007-window-and-viewport-model.md) | 視窗：主視窗為 Privacy Agent 對話＋隱私卡片＋Ledger；每個 Operator 一個獨立視窗 | 1 |
| [0008](adr/0008-persona-workspace-and-skills.md) | Workspace：Persona 定義 Operator；persona.yaml、SKILL.md、MCP；全域 `privacy` 設定 | 1 |
| [0009](adr/0009-conversation-threads-and-concurrency.md) | Thread 以 A2A contextId 為單位；privacy scope 繼承；maxConcurrency | 1 |
| [0010](adr/0010-hitl-and-risk-levels.md) | HITL：派發者先代答；`privacy_confirm`、auth、captcha、high 強制人工；三級風險 | 1 |
| [0011](adr/0011-persistence-secrets-observability.md) | main 持有 SQLite（含 vault、ledger、sandbox_runs）；safeStorage；OTLP 受 trustZone 限制 | 1 |
| [0012](adr/0012-scheduler-events-notifications.md) | 排程、事件、webhook 一律先到 Privacy Agent；Action Center；outbound webhook 內容去敏 | 2 |
| [0013](adr/0013-voice-input.md) | 語音：ephemeral key 直連 Realtime；檔案 STT；雲端語音受隱私預設等級限制 | 3 |
| [0014](adr/0014-testing-ci-packaging.md) | Vitest + FakeModel + Playwright e2e；隱私 canary 與沙箱逃逸測試；GitHub Actions；electron-builder | 1 |
| [0015](adr/0015-privacy-gate-aliasing-and-vault.md) | Privacy Gate：模型請求邊界、trustZone、雙層偵測、`⟦TYPE_n⟧` 別名與驗證、還原與新網域規則、Vault | 1 |
| [0016](adr/0016-privacy-policy-ledger-and-transparency.md) | 敏感類別與三段預設（預設平衡）、Privacy Ledger、隱私卡片、只在高敏感時確認 | 1 |
| [0017](adr/0017-compute-to-data-and-script-sandbox.md) | Compute-to-data：schema＋合成樣本、託管 Python＋內建 Node、OS 原生沙箱（參考 Codex），降級 Pyodide | 1 |
| [0018](adr/0018-computer-use.md) | Computer use：真實桌面＋App 白名單、截圖本地 OCR 塗黑、獨佔與接管 | 2 |

## 2026-09-25 盤問決策

| # | 題目 | 決定 | ADR |
|---|---|---|---|
| 1 | Privacy Agent 與 Orchestrator | 兩種模式：本地 SLM 能力不足時走固定流程、由 SLM 選路徑；自架 LLM 時 Privacy Agent 取代 Orchestrator | 0005 |
| 2 | 威脅模型 | 雲端 LLM 看到敏感資料、prompt injection 外洩、Operator 腳本惡意或錯誤；本機惡意軟體不在範圍 | 0015 |
| 3 | 雙模式架構 | 兩套獨立流程 | 0005 |
| 4 | 模式判定 | 使用者手動選擇 | 0005 |
| 5 | SLM 模式的規劃者 | 雲端 Planner + 多 Operator | 0005 |
| 6 | 安全元件 | 兩套流程共用 Gate、Vault、偵測器、沙箱 | 0001、0005 |
| 7 | Gate 強制點 | 模型請求邊界（GuardedModel） | 0015 |
| 8 | 哪些請求過 Gate | 依 Provider `trustZone`，只有 `cloud` | 0003、0015 |
| 9 | LLM Flow | 明確的 route 工具 + 自由規劃 | 0005 |
| 10 | 去敏方式 | Privacy Agent 先決定是否需要送出；需要的換成替代名稱，並要求 LLM 保持 | 0015 |
| 10b | 替代名稱格式 | 帶標記的型別化別名 `⟦TYPE_n⟧` + 回應驗證 | 0015 |
| 11／11b | 還原授權 | 預設允許還原；只有外送型參數送往新網域時要人工確認 | 0015 |
| 12 | Vault | 以 Thread（privacy scope）為範圍，加密落庫 | 0015 |
| 13 | 偵測 | 規則層 + 本地模型語意層，取聯集 | 0015 |
| 14 | 預設政策 | 類別表 + 嚴格／平衡／寬鬆，預設平衡 | 0016 |
| 15 | 透明度 | 高敏感才確認 + 全程 Ledger | 0016 |
| 16 | compute-to-data 觸發 | 依資料型態 + 政策類別 | 0017 |
| 17 | 腳本環境 | 參考 Codex 的 OS 原生沙箱；語言為託管 Python + 內建 Node | 0017 |
| 17a | 沙箱不可用 | 降級到 Pyodide | 0017 |
| 18 | 腳本輸出 | 預設給使用者；回 Operator 需過 Gate | 0017 |
| 19 | 腳本審核 | 沙箱 + 靜態檢查，不需人工 | 0017 |
| 20 | Computer use 範圍 | 真實桌面 + App 白名單 | 0018 |
| 21 | 截圖隱私 | Gate 內本地 OCR + 塗黑標註 | 0015、0018 |
| 22 | 入口 | 全部先到 Privacy Agent，Operator 仍可介入 | 0005、0009、0012 |
| 23／23b | Privacy Agent 綁雲端 | 可以，但要警告；此時它自身的請求不過 Gate | 0003、0015 |
| 24 | 本地模型 runtime | 外部 OpenAI 相容端點 | 0003 |
| 25 | 本地模型離線 | Fail-closed，可逐任務授權只用規則層 | 0015 |
| 26 | 命名 | 程式全面改名為 `privacy`／`planner`／`operator:<id>` | 0004 |
| 27 | 階段 | 隱私核心在 P1，computer use 在 P2 | 本文件 |
| 28 | ADR 修改方式 | 直接改寫既有 ADR | 本文件 |

**整理時補上、未經盤問的決策**（請確認）：

- 雲端語音（STT／Realtime）受預設等級限制，並改用獨立的「語音 Provider」（0013）。
- OTLP endpoint 為 `cloud` 時只送 metadata（0011）。
- outbound webhook 內容以不可還原的 `⟦REDACTED⟧` 去敏（0012）。
- `credential` 類別在任何預設下都是 block 且不可覆寫（0016）。
- 沙箱資源預設值 120 秒、2 GB、輸出 50 列、k=5（0017）。

## 交付階段

| 階段 | 範圍 | 對應規格 |
|---|---|---|
| Phase 1 核心骨架 | 行程模型、A2A 傳輸、Privacy Agent（兩種 Flow）＋ Planner ＋ Operator、Privacy Gate／Vault／政策／Ledger、compute-to-data 沙箱、瀏覽器自動化（含截圖遮罩）、視窗與面板、Provider 設定、Workspace／Skills／MCP、Thread、HITL、持久化、測試與打包 | 1–11、13、隱私 |
| Phase 2 觸發、通知與桌面 | Cron 排程、模板變數、事件觸發、webhook 接收、Action Center、外部推播、computer use | 12、15、16、computer use |
| Phase 3 語音 | 檔案 STT、Realtime 串流 | 14 |

## 實作任務排程

Agent 關係與處理流程的文字圖見 [docs/DESIGN.md](../DESIGN.md)；醫療與法律事務所的套用情境見 [docs/use-cases.md](../use-cases.md)。

[ADR Tasks Waves 與任務簡述表](task-waves.md)：依前置依賴拆解任務，區分純 Node、最小 Electron 容器與正式 UI。2026-09-25 修訂新增的隱私任務與既有任務的改名重工列在該文件的「2026-09-25 架構修訂」一節。

## 規格對照

| 規格條目 | ADR |
|---|---|
| 1 內建瀏覽器與自動化 | 0006 |
| 2 Session 持久化與隔離 | 0006 |
| 3 多 Agent 並行與 Persona 實例 | 0002、0009 |
| 4 視口切換與即時監控 | 0007 |
| 5 任務規劃與派發（Privacy Agent／Planner） | 0005 |
| 6 行程隔離與 Workspace 沙盒 | 0002、0008 |
| 7 LLM Provider 配置 | 0003、0011 |
| 8 Electron 執行環境 | 0001 |
| 9 獨立對話面板與可觀測性 | 0007、0009、0011 |
| 10 雙向通訊與例外上報 | 0004、0010 |
| 11 OpenAI Agents SDK | 0003 |
| 12 Persona 生命週期與多模式觸發 | 0002、0009、0012 |
| 13 A2A Protocol | 0004 |
| 14 語音輸入 | 0013 |
| 15 排程與模板變數 | 0012 |
| 16 通知與行動中心 | 0012 |
| 隱私：去敏、compute-to-data、透明度 | 0015、0016、0017 |
| Computer use | 0018 |

## 已知張力

1. **全部常駐 + 每 Operator 一視窗**的記憶體成本：以「行程常駐、視窗延遲建立」緩解（0002、0007）；SLM 模式多一個 Planner 行程。
2. **maxConcurrency > 1 共用瀏覽器 session**：每個 Run 獨立 tab，但 cookie 共用，設定 UI 顯示警告（0006、0009）。
3. **本機 CDP port 與 webhook port**：皆僅綁 loopback、隨機 port、token / origin 限制（0006、0012）。
4. **Skill 程式碼無沙箱**：信任模型等同 CLI agent，隔離單位是行程（0008）。雲端 Operator 產生的 compute-to-data 腳本則一律進沙箱（0017）。
5. **偵測不可能完美**：規則層與語意層取聯集、fail-closed 可以降低漏抓，但 OCR 與 SLM 漏抓的內容仍會送上雲（0015、0018）。
6. **預設允許還原**：只擋新網域外送，同網域或本機動作仍可能被 prompt injection 濫用，靠 Ledger 追查（0015）。
7. **Privacy Agent 可綁雲端**：這時原始資料會送達該 Provider，保證只剩對其他雲端 Agent 有效；UI 以警告常駐（0003、0015）。
8. **兩套 Flow**：隱私規則共用，但編排邏輯與測試要維護兩份（0005）。
9. **每次雲端請求多一次本地偵測**：以 hash 快取把延遲限制在新增內容上（0015）。
