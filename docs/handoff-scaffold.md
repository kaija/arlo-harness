# Handoff：Repo Scaffold（Privacy Agent + Operator 架構）

> 用途：在新的對話中貼上本文件，讓對方在沒有先前對話脈絡的情況下，產生或補齊專案骨架。
>
> 2026-09-25 更新：架構改為 Privacy Agent + Operator（見 `docs/spec/README.md` 的「2026-09-25 盤問決策」與 `docs/DESIGN.md`）。原 scaffold 已完成，T01–T07 也已實作；本文件現在描述**新架構的目標骨架**，用於補齊新 packages 與改名重工，而不是從零開始。

---

## 你的任務

為 `arlo-harness` 補齊 **Phase 1 骨架**，使其符合 2026-09-25 修訂後的架構。

`arlo-harness` 是一個基於 Electron、以隱私為核心的泛用型桌面端 AI Agent 平台：

- **Privacy Agent**：唯一入口，綁定使用者選擇的本地 SLM 或自架 LLM。它偵測敏感資料並決定處理方式：別名化後交給雲端、只給 schema 由雲端寫腳本在本機沙箱執行、純本地處理，或詢問使用者。
- **兩種模式**，由使用者手動選擇：
  - **SLM 模式**：Privacy Agent 是程式驅動的狀態機，任務規劃交給雲端 **Planner**；
  - **LLM 模式**：Privacy Agent 本身就是 Orchestrator。
- **Operator**：每個由一個 Persona workspace 定義，跑在獨立行程，有自己的內嵌瀏覽器、Workspace、MCP 與 Skills，通常使用雲端模型。
- **Privacy Gate**：所有送往 `trustZone === 'cloud'` Provider 的模型請求都必經，隱私保證由程式強制。

架構決策已全部定案並寫在 `docs/spec/`，**請先完整閱讀** `docs/spec/README.md`、`docs/spec/adr/0001`～`0018`、`docs/spec/task-waves.md`（特別是「2026-09-25 架構修訂」一節）與 `docs/DESIGN.md`，再動手。不要重新討論或更改已定案的決策；若發現決策之間有矛盾或實作上不可行，停下來說明，不要自行改設計。

## 產出範圍

**要做的**：
- 可安裝、可 typecheck、可跑測試、可啟動視窗的骨架。
- 新 packages 有正確的邊界、公開介面型別，以及最小可執行實作或 stub。
- 既有程式完成改名重工（task-waves 表中 T02／T04／T05／T06／T07 的重工項目）。

**不要做的**：
- 不實作完整功能邏輯：語意偵測、真實沙箱後端、SLM／LLM Flow 狀態機、computer use。
- 介面先立，內部以 `TODO(<task id>)` 註解（例如 `TODO(T35)`），以及拋 `NotImplementedError` 或回傳假資料的 stub 代替。
- Phase 2／3 模組（`computer-use`、scheduler、通知轉發、voice）只留目錄與 README，不寫程式碼。
- 不改動 `apps/desktop/src/renderer` 已完成的 UI，UI 改版屬 T26／T27／T42。

## 技術棧（摘自 ADR，不可更動）

| 項目 | 決策 | ADR |
|---|---|---|
| 應用框架 | Electron 最新穩定版 + electron-vite | 0001 |
| UI | React 19 + TypeScript + Tailwind CSS + shadcn/ui + Zustand + TanStack Router | 0001 |
| 套件管理 | pnpm workspace monorepo | 0001 |
| Agent 行程 | 每個 Agent 一個 `utilityProcess`：`privacy`、`planner`（僅 SLM 模式）、`operator:<personaId>`；MessagePort IPC | 0002 |
| Agent SDK | `@openai/agents-core` + `@openai/agents-openai`；Provider 為 openai / openai_compatible / azure_openai，加上 `trustZone` | 0003 |
| 本地模型 | 外部 OpenAI 相容端點（Ollama、LM Studio、llama.cpp、vLLM、Foundry Local 等），不內建推論 runtime | 0003 |
| Agent 間通訊 | `@a2a-js/sdk` JSON-RPC，傳輸層為 MessagePort，main 作 broker，以 Privacy Agent 為入口的路由政策 | 0004 |
| 派發 | SLM Flow／LLM Flow 兩套編排，共用安全元件；Planner 與 LLM Flow 共用委派 runtime | 0005 |
| 瀏覽器控制 | `playwright-core` `connectOverCDP`，Electron 開 loopback remote-debugging-port | 0006 |
| 視窗 | 主視窗（Privacy Agent 對話、隱私卡片、Ledger）＋ 每個 Operator 一個 BrowserWindow | 0007 |
| Workspace | `<userData>/personas/<id>/persona.yaml` + `skills/<name>/SKILL.md`（+ `tools.ts`）+ `workdir/`；全域設定含 `privacy` | 0008 |
| 持久化 | main 持有單一 SQLite（`better-sqlite3` + `drizzle-orm`），含 `privacy_vault`、`privacy_ledger`、`sandbox_runs` | 0011 |
| 機密 | Electron `safeStorage` 加密後存 SQLite；Vault 的值同樣加密 | 0011、0015 |
| 隱私 | Gate 位於模型請求邊界（`GuardedModel`）；規則層 + 語意層偵測；別名 `⟦TYPE_n⟧`；政策類別與三段預設 | 0015、0016 |
| 腳本沙箱 | 託管 Python（uv）+ Electron 內建 Node；Seatbelt / bwrap+Landlock+seccomp / Windows restricted token，降級 Pyodide | 0017 |
| 測試 | Vitest + `FakeModel`（可宣告 trustZone）+ Playwright `_electron` e2e + 隱私 canary 測試 | 0014 |
| 打包 / CI | electron-builder + electron-updater；GitHub Actions 三平台 build | 0014 |
| Lint | ESLint + Prettier + lefthook | 0014 |

## 目錄結構（必須符合 ADR-0001）

```
arlo-harness/
├── apps/desktop/
│   ├── src/main/
│   │   ├── db/            # SQLite、drizzle migration（已存在）
│   │   ├── privacy/       # Vault、Ledger 服務（privacy/vault.*、privacy/ledger.*）
│   │   ├── sandbox/       # sandbox/* 服務、run 目錄管理
│   │   └── …              # 視窗管理、A2A broker 接線、IPC handlers、utilityProcess spawn
│   ├── src/preload/       # contextBridge 白名單
│   ├── src/renderer/      # React；hash route #/main 與 #/persona/:id 共用同一 bundle（已存在，勿改）
│   └── src/agent-host/    # utilityProcess 入口，依 role 組裝 @arlo/agent-runtime
├── packages/
│   ├── shared/            # AgentId、A2A envelope、事件、InterruptPayload（含 privacy_confirm）、風險表、ProviderProfile（含 trustZone）
│   ├── persona-schema/    # persona.yaml 與全域設定（含 privacy、planner）zod schema、SKILL.md 解析
│   ├── a2a-transport/     # MessagePortA2AServer / Client / A2ABroker（路由政策依 ADR-0004）
│   ├── agent-runtime/     # createModelProvider、GuardedModel、IpcSession、IpcTaskStore、TracingProcessor、testing/FakeModel
│   │   └── src/roles/     # privacy-slm/、privacy-llm/、planner/、operator/
│   ├── privacy/           # detectors/、semantic/、policy/、alias/、gate/、egress/、dataset/、image/
│   ├── sandbox/           # SandboxRunner、backends/（seatbelt、linux-bwrap、windows-restricted、pyodide）、runtimes/、static-check/
│   ├── browser-tools/     # Playwright 工具集
│   └── computer-use/      # Phase 2：只留 README
├── docs/                  # spec/、DESIGN.md、ui-design-prompt.md（勿動）
└── .github/workflows/     # ci.yml、release.yml
```

Package 命名空間用 `@arlo/*`。`packages/*` **不得依賴 `electron`**，必須能在純 Node 下跑 vitest。安全元件（`privacy`、`sandbox`）與編排（`agent-runtime/src/roles/*`）分開：兩套 Flow 只能透過安全元件的公開介面使用去敏與沙箱，不得各自實作。

## 必須落地的具體內容

1. **`packages/shared`**（T02 重工，T32）：
   - `AgentId` 改為 `'privacy' | 'planner' | \`operator:${string}\``。保留 id 為 `privacy`、`planner`。`system:*` 來源新增 `system:webhook`。
   - `ask_orchestrator` 改名為 `ask_delegator`；`InterruptResponder` 改為 `'delegator' | 'user'`。
   - `InterruptPayload` 新增 `privacy_confirm`（ADR-0010），並列為強制人工。
   - `ProviderProfile` 新增 `trustZone`、`structuredOutput`，以及從 `baseUrl` 推導 trustZone 的純函式（loopback、RFC1918、`fc00::/7`、`*.local`、Tailscale `100.64.0.0/10`），附測試。
   - 風險表新增 `submit_compute_script`（low）與「沙箱結果寫回原檔」（high），以測試鎖定。
   - A2A metadata 鍵常數 `arlo.privacyScope`、`arlo.targetOperator`。
2. **`packages/persona-schema`**（T04 重工）：
   - 全域設定新增 `privacy`（`mode`、`modelBinding`、`preset`、`categoryOverrides`、`customTerms`、`compute`）與 `planner.modelBinding`，移除 `orchestrator.modelBinding`。
   - persona.yaml 新增 `tools.egress`、`computerUse`（P2 欄位，僅驗證）。
   - Agent Card URL 為 `arlo://agents/operator:<id>`。
3. **`packages/a2a-transport`**（T05 重工）：
   - broker 路由政策改為 ADR-0004 第 5 點的表。
   - 移除 Operator 送出的 `arlo.*` 隱私 metadata。
   - 測試涵蓋：`system:*` 只能到 `privacy`（`system:user` 另可到 Operator 使用者 Thread）；Operator 之間被拒；LLM 模式下送往 `planner` 得到 `agent_unavailable`。
4. **`packages/privacy`**（T33 介面）：
   - 政策類別表與三段預設，`credential` 不可覆寫，以測試鎖定。
   - 規則層偵測器介面，至少實作 email 與信用卡（Luhn）作為樣板，附繁中與英文語料測試。
   - 別名編碼：`⟦TYPE_n⟧`、保留指令、回應驗證與修復的介面，編碼與解碼要實作並測試。
   - `gate` 的 `sanitizeInput`／`restoreOutput` 介面、`egress` 網域集合、`dataset` 的 `DatasetDescriptor` 型別；語意層、OCR、合成樣本先 stub。
5. **`packages/sandbox`**（T36 介面）：
   - `SandboxRunner` 介面、`SandboxPolicy`（唯讀輸入、只寫 out、無網路、清空 env、時間與記憶體上限）與 `selectBackend()`。
   - 各後端先 stub，`selectBackend()` 在無 native 後端時回傳 `pyodide`。
   - 靜態檢查介面。
6. **`packages/agent-runtime`**（T07 重工，T35／T38／T39 介面）：
   - `createModelProvider` 對 `trustZone === 'cloud'` 回傳 `GuardedModel` 包裝；Gate 內部先直通並標 `TODO(T35)`。
   - `FakeModel` 可宣告 trustZone，並記錄收到的每個請求，供日後 canary 測試使用。
   - `src/roles/` 建立 `privacy-slm`、`privacy-llm`、`planner`、`operator` 四個角色的組裝入口；兩個 Flow 實作同一個 `PrivacyFlow` 介面，先 stub。
7. **`apps/desktop`**（T06 重工 + 接線骨架）：
   - 新 migration：`privacy_vault`、`privacy_ledger`、`sandbox_runs`；`threads.source` 增加 `privacy`、`planner`、`webhook`。改 schema 後執行 `pnpm --filter @arlo/desktop db:generate` 並提交 migration。
   - `src/main/privacy/`、`src/main/sandbox/` 服務骨架，註冊到 broker 的 `privacy/*`、`sandbox/*` 方法，先回傳 stub。
   - `agent-host` 依 spawn 參數 `role` 組裝對應角色。
8. **`packages/computer-use`**：只建立 package 與 README，說明屬 Phase 2（ADR-0018）。

## 完成標準

以下指令全部通過才算完成，請實際執行並貼出結果：

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test          # vitest，全部 packages；packages/privacy 與 packages/sandbox 覆蓋率 90%
pnpm build
pnpm --filter @arlo/desktop test:e2e   # macOS
```

另外更新 `docs/spec/task-waves.md` 的「進度追蹤」表，記錄 T32 與各重工項目的完成範圍與缺口。

## 工作方式

- 使用**最新穩定版**的依賴，安裝前用 `npm view <pkg> version` 確認，不要憑記憶寫版本號。
- `@openai/agents-*` 與 `@a2a-js/sdk` 的 API 以安裝後的 `node_modules` 型別定義為準，不確定的用法先讀型別再寫。
- 以小步 commit 推進，每個 commit 都要能獨立通過 typecheck。Commit message 用 conventional commits。
- 遇到 ADR 未涵蓋的決策，選最保守的做法，並在 `task-waves.md` 對應 task 的「進度追蹤」列中記錄為「ADR 未指定、由本 task 補上的決策」。

## 目前 repo 狀態

- 已有：monorepo scaffold、`apps/desktop`（main／preload／renderer／agent-host）、`packages/shared`、`persona-schema`、`a2a-transport`、`agent-runtime`、`browser-tools`（placeholder）。
- 已完成的任務：T01–T07；T08 完成視窗管理部分；T26／T27 renderer UI 以範例資料完成。這些程式碼仍使用 `orchestrator`／`persona:<id>` 命名，本次要改名。
- 尚無 `packages/privacy`、`packages/sandbox`、`packages/computer-use`。
- ADR 已於 2026-09-25 就地改寫，`docs/DESIGN.md` 與 `docs/ui-design-prompt.md` 已同步更新。
