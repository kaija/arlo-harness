# Arlo Harness 架構決策紀錄（ADR）

本目錄記錄「基於 Electron 的泛用型桌面端 AI Agent 平台」的架構決策。每份 ADR 對應一組相關決策，含背景、決策、替代方案與後果。決策變更時新增 ADR 並在舊 ADR 標記 `Superseded by`，不直接改寫歷史。

所有 ADR 於 2026-09-15 經需求盤問（grilling）確認後建立。

## 系統總覽

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│  A2A Broker / Agent Card Registry   SQLite (better-sqlite3)   Scheduler (croner)│
│  Window Manager (Main + Persona windows)   Event Bus   Action Center   Secrets  │
│  CDP port (127.0.0.1)   Webhook receiver (127.0.0.1)   Outbound webhooks        │
└───────┬───────────────┬───────────────┬───────────────────────┬────────────────┘
        │ MessagePort   │ MessagePort   │ MessagePort           │ IPC
┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼────────┐     ┌────────▼────────────────┐
│ Orchestrator │ │ Persona A    │ │ Persona B    │ ... │ Renderers               │
│ utilityProc  │ │ utilityProc  │ │ utilityProc  │     │  Main window (React)    │
│ OpenAI Agents│ │ OpenAI Agents│ │ OpenAI Agents│     │  Persona A window       │
│ SDK          │ │ SDK + MCP    │ │ SDK + MCP    │     │   ├ Chat / Threads      │
│ delegate_to_*│ │ + Playwright │ │ + Playwright │     │   └ WebContentsView(s)  │
│ tools        │ │ over CDP     │ │ over CDP     │     │  Persona B window ...   │
└──────────────┘ └──────────────┘ └──────────────┘     └─────────────────────────┘
```

- Orchestrator 與每個 Persona 各一個 utilityProcess，App 啟動時全部常駐。
- Agent 間通訊走 A2A JSON-RPC，傳輸層為 MessagePort，main 作 broker，v1 星型拓撲。
- 每個 Persona 一個獨立可隱藏的 BrowserWindow，內含該 Persona 的 Chat panel 與瀏覽器。
- 瀏覽器由 Persona 行程以 Playwright `connectOverCDP` 控制，session partition 持久化。
- 資料、機密、trace 全部由 main 持有的單一 SQLite 管理。

## ADR 索引

| 編號 | 主題 | 階段 |
|---|---|---|
| [0001](adr/0001-runtime-and-repository-structure.md) | 執行環境與程式碼庫結構：Electron、electron-vite、React 19、pnpm monorepo、macOS 優先 | 1 |
| [0002](adr/0002-process-model.md) | 行程模型：每個 Agent 一個 utilityProcess，啟動時全部常駐，崩潰自動重啟 | 1 |
| [0003](adr/0003-agent-sdk-and-model-providers.md) | OpenAI Agents SDK；Provider 支援 OpenAI / OpenAI 相容 / Azure；全域與 Agent 層級綁定 | 1 |
| [0004](adr/0004-a2a-over-messageport.md) | A2A JSON-RPC over MessagePort，main 為 broker，v1 星型拓撲 | 1 |
| [0005](adr/0005-orchestrator-task-dispatch.md) | Orchestrator 派發：Persona 動態生成為 `delegate_to_*` 工具，sync / async 模式 | 1 |
| [0006](adr/0006-browser-automation.md) | 瀏覽器：Playwright connectOverCDP、persist partition、背景不節流、標準工具集 | 1 |
| [0007](adr/0007-window-and-viewport-model.md) | 視窗：每個 Persona 一個獨立 BrowserWindow，切換即 show/focus，視窗延遲建立 | 1 |
| [0008](adr/0008-persona-workspace-and-skills.md) | Workspace：persona.yaml、SKILL.md + TS tool 模組、本機信任模型、MCP 各自啟動 | 1 |
| [0009](adr/0009-conversation-threads-and-concurrency.md) | Thread 以 A2A contextId 為單位；maxConcurrency 可設，預設 1 | 1 |
| [0010](adr/0010-hitl-and-risk-levels.md) | HITL：Orchestrator 先代答 question / medium approval；auth、captcha、high 強制人工；三級風險 | 1 |
| [0011](adr/0011-persistence-secrets-observability.md) | main 持有 SQLite；safeStorage 加密機密；自訂 TracingProcessor，預設不上傳 OpenAI | 1 |
| [0012](adr/0012-scheduler-events-notifications.md) | croner 排程、模板變數、內部事件 + webhook 接收器、Action Center、outbound webhook | 2 |
| [0013](adr/0013-voice-input.md) | 語音：Renderer 以 ephemeral key 直連 Realtime（WebRTC）；檔案 STT 走 transcription API | 3 |
| [0014](adr/0014-testing-ci-packaging.md) | Vitest + FakeModel + Playwright Electron e2e；GitHub Actions；electron-builder + electron-updater | 1 |

## 實作任務排程

[ADR Tasks Waves 與任務簡述表](task-waves.md)：依前置依賴拆解 31 個任務，區分純 Node、最小 Electron 容器與正式 UI，提供 UI 完成前可先構建的順序。此為實作計畫，不變更 Accepted ADR。

## 交付階段

| 階段 | 範圍 | 對應規格 |
|---|---|---|
| Phase 1 核心骨架 | 行程模型、A2A 傳輸、Orchestrator + Persona、瀏覽器自動化、視窗與面板、Provider 設定、Workspace / Skills / MCP、Thread、HITL、持久化、測試與打包 | 1–11、13 |
| Phase 2 觸發與通知 | Cron 排程、模板變數、事件觸發、webhook 接收、Action Center、外部推播 | 12、15、16 |
| Phase 3 語音 | 檔案 STT、Realtime 串流 | 14 |

## 規格對照

| 規格條目 | ADR |
|---|---|
| 1 內建瀏覽器與自動化 | 0006 |
| 2 Session 持久化與隔離 | 0006 |
| 3 多 Agent 並行與 Persona 實例 | 0002、0009 |
| 4 視口切換與即時監控 | 0007 |
| 5 Orchestrator 與任務派發 | 0005 |
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

## 已知張力

1. **全部常駐 + 每 Persona 一視窗**的記憶體成本：以「行程常駐、視窗延遲建立」緩解（0002、0007）。
2. **maxConcurrency > 1 共用瀏覽器 session**：每個 Run 獨立 tab，但 cookie 共用，設定 UI 顯示警告（0006、0009）。
3. **本機 CDP port 與 webhook port**：皆僅綁 loopback、隨機 port、token / origin 限制（0006、0012）。
4. **Skill 程式碼無沙箱**：信任模型等同 CLI agent，隔離單位是行程（0008）。
