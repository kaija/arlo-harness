# Handoff：產生 Repo Scaffold

> 用途：在新的對話（Claude Opus 5）中貼上本文件，讓對方在不需要先前對話脈絡的情況下產生專案骨架。

---

## 你的任務

為 `arlo-harness` 產生 **Phase 1 的 monorepo scaffold**。這是一個基於 Electron 的泛用型桌面端 AI Agent 平台：一個 Orchestrator Agent 拆解任務並派發給多個 Persona Agent，每個 Persona 跑在獨立行程、有自己的內嵌瀏覽器、Workspace、MCP 與 Skills。

架構決策已全部定案並寫在 `docs/spec/`，**請先完整閱讀** `docs/spec/README.md` 與 `docs/spec/adr/0001` 到 `0014`，再動手。不要重新討論或更改已定案的決策；若發現決策之間有矛盾或實作上不可行，停下來說明，不要自行改設計。

## 產出範圍

**要做的**：可安裝、可 typecheck、可跑測試、可啟動出空視窗的骨架，每個 package 有正確的邊界、公開介面型別、與最小可執行實作或 stub。

**不要做的**：不實作完整功能邏輯（LLM 呼叫、真實瀏覽器工具、HITL 流程、排程、語音）。介面先立、內部以 `TODO(phase1)` 註解與拋 `NotImplementedError` 或回傳假資料的 stub 代替。Phase 2 / 3 的模組（scheduler、notifications 轉發、voice）只留目錄與 README，不寫程式碼。

## 技術棧（摘自 ADR，不可更動）

| 項目 | 決策 | ADR |
|---|---|---|
| 應用框架 | Electron 最新穩定版 + electron-vite | 0001 |
| UI | React 19 + TypeScript + Tailwind CSS + shadcn/ui + Zustand + TanStack Router | 0001 |
| 套件管理 | pnpm workspace monorepo | 0001 |
| Agent 行程 | 每個 Agent 一個 Electron `utilityProcess`，MessagePort IPC | 0002 |
| Agent SDK | `@openai/agents`；Provider 支援 openai / openai_compatible / azure_openai | 0003 |
| Agent 間通訊 | `@a2a-js/sdk` JSON-RPC，傳輸層自訂為 MessagePort，main 作 broker | 0004 |
| 瀏覽器控制 | `playwright-core` `connectOverCDP`，Electron 開 loopback remote-debugging-port | 0006 |
| 視窗 | 主視窗一個 + 每個 Persona 一個獨立 BrowserWindow | 0007 |
| Workspace | `<userData>/personas/<id>/persona.yaml` + `skills/<name>/SKILL.md` (+ `tools.ts`) + `workdir/` | 0008 |
| 持久化 | main 持有單一 SQLite（`better-sqlite3` + `drizzle-orm`），Agent 行程經 IPC 寫入 | 0011 |
| 機密 | Electron `safeStorage` 加密後存 SQLite | 0011 |
| 測試 | Vitest + `FakeModel` + Playwright `_electron` e2e | 0014 |
| 打包 / CI | electron-builder + electron-updater；GitHub Actions 三平台 build | 0014 |
| Lint | ESLint + Prettier + lefthook | 0014 |

## 目錄結構（必須符合 ADR-0001）

```
arlo-harness/
├── apps/desktop/
│   ├── src/main/          # 視窗管理、A2A broker、SQLite、IPC handlers、utilityProcess spawn
│   ├── src/preload/       # contextBridge 白名單
│   ├── src/renderer/      # React；hash route #/main 與 #/persona/:id 共用同一 bundle
│   └── src/agent-host/    # utilityProcess 入口，載入 @arlo/agent-runtime
├── packages/
│   ├── shared/            # 事件型別、IPC 契約、A2A envelope 型別、內建工具風險等級表
│   ├── persona-schema/    # persona.yaml zod schema、SKILL.md frontmatter 解析
│   ├── a2a-transport/     # MessagePortA2AServer / MessagePortA2AClient / A2ABroker
│   ├── agent-runtime/     # Agent 建立、createModelProvider、IpcSession、IpcTaskStore、TracingProcessor、Skill loader、testing/FakeModel
│   └── browser-tools/     # Playwright 工具集（v1 先 stub）
├── docs/spec/             # 已存在，勿動
├── .github/workflows/     # ci.yml、release.yml
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, .eslintrc, .prettierrc, lefthook.yml
└── README.md              # 專案說明與本機開發步驟
```

Package 命名空間用 `@arlo/*`。`packages/*` **不得依賴 `electron`**，必須能在純 Node 下跑 vitest。

## 必須落地的具體內容

1. **`packages/shared`**：
   - `AgentId` 型別（`'orchestrator' | \`persona:${string}\``）。
   - A2A envelope 型別（ADR-0004 第 3 點）。
   - 內部 event bus 事件型別（ADR-0012 第 7 點的清單，型別先定義）。
   - `InterruptPayload` 聯合型別與 `RiskLevel`（ADR-0010）。
   - 內建工具預設風險等級表 + 一個鎖定它的測試。
2. **`packages/persona-schema`**：ADR-0008 的 persona.yaml zod schema、`loadPersona(dir)`、SKILL.md frontmatter 解析，各附測試與一個範例 persona 目錄（`examples/research-analyst/`）。
3. **`packages/a2a-transport`**：以 Node `MessageChannel` 可測的 `MessagePortA2AServer`、`MessagePortA2AClient`（注入自訂 `fetchImpl` 到 `@a2a-js/sdk` client）、`A2ABroker`（星型路由規則 + registry）。至少一個整合測試：client 經 broker 對 server 送 `message/send` 並收到回應；一個測試驗證 persona→persona 被拒。streaming 可先 stub 但介面要在。
4. **`packages/agent-runtime`**：
   - `createModelProvider(profile)` 支援三種 apiType（openai 直接用 SDK；openai_compatible 設 baseURL 並 `useResponses:false`；azure 用 `AzureOpenAI` client）。
   - `IpcSession`、`IpcTaskStore` 介面與經 MessagePort 的 stub 實作。
   - `TracingProcessor` 把 span 以訊息送出，並關閉預設 OpenAI exporter。
   - `testing/FakeModel`：可腳本化回應的 `Model` 實作，附測試證明能驅動一個 Agent 完成一次 tool call。
   - `agent-host` 用的 `bootPersona(config)` / `bootOrchestrator(config)` 入口。
5. **`apps/desktop`**：
   - main：啟動時建立主視窗；`AgentProcessManager` 能 spawn 一個 utilityProcess 並與它建立 MessagePort（先跑 orchestrator 一個即可）；SQLite 初始化與 drizzle migration 骨架（至少 `personas`、`provider_profiles`、`secrets`、`threads`、`messages`、`a2a_tasks` 表）；safeStorage 包裝；IPC handler 骨架。
   - preload：型別安全的 `window.arlo` API（用 `packages/shared` 的契約）。
   - renderer：主視窗骨架（Agent 側欄、Orchestrator 對話區、Action Center 三個空面板）與 Persona 視窗骨架（Thread 列表、對話區、瀏覽器區佔位）。UI 功能細節見 `docs/ui-design-prompt.md`，scaffold 只需版面與路由。
   - `remote-debugging-port` 開在隨機 loopback port 並記錄。
   - 一個 Playwright `_electron` 冒煙測試：App 啟動、主視窗出現、標題正確。
6. **CI**：`ci.yml` 三平台矩陣（install、typecheck、vitest、`electron-builder --dir`），e2e 只在 macOS。`release.yml` tag 觸發、未簽章。
7. **根 README**：先決條件（Node LTS、pnpm）、`pnpm install`、`pnpm dev`、`pnpm test`、`pnpm build` 步驟。

## 完成標準

以下指令在 macOS 上全部通過才算完成，請實際執行並貼出結果：

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test          # vitest，全部 packages
pnpm -C apps/desktop build
pnpm -C apps/desktop test:e2e
```

## 工作方式

- 使用**最新穩定版**的所有依賴，安裝前用 `npm view <pkg> version` 確認，不要憑記憶寫版本號。
- `@openai/agents` 與 `@a2a-js/sdk` 的 API 請以安裝後的 `node_modules` 型別定義為準，不確定的用法先讀型別再寫。
- 進度以小步 commit，每個 commit 可獨立 typecheck 通過。Commit message 用 conventional commits，結尾加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 不要 push。
- 遇到 ADR 未涵蓋的決策，選最保守的做法並在 `docs/spec/README.md` 底部「Scaffold 期間補充決策」段落記錄一行。

## 目前 repo 狀態

- 分支 `main`，最近 commit 為 ADR 文件。
- 除 `docs/`、`LICENSE`、`.gitignore` 外沒有任何程式碼。
- 工作樹乾淨，`docs/ui-design-prompt.md` 與本文件皆已 commit。
