# ADR-0008：Persona Workspace、Skills 與 MCP 歸屬

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：Persona 定義 Operator；新增 `computerUse`、`delegation`、MCP／skill 工具的 `egress` 標記、全域 `privacy` 設定
- 適用階段：Phase 1

## 背景

規格第 6 點要求每個 Persona 有隔離的 Workspace，可獨立配置 Persona Prompt、MCP 伺服器、自定義 Skills、外掛工具與工作目錄。需要決定磁碟格式、Skill 的定義方式、執行信任模型與 MCP server 的歸屬。

2026-09-25 修訂後，**每個 Operator 由一個 Persona 定義**：Persona 是設定與 workspace 的概念，Operator 是執行期角色，AgentId 為 `operator:<personaId>`。Privacy Agent 與 Planner 沒有 Persona workspace，它們的設定在全域設定的 `privacy`、`planner` 區段。

## 決策

### 磁碟結構

```
<userData>/personas/<persona-id>/
├── persona.yaml          # 設定（下方 schema）
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md      # Agent Skills 格式：frontmatter + 指令
│       ├── tools.ts      # 可選：導出 SDK function tool 的 TS 模組
│       └── scripts/      # 可選：SKILL.md 引用的腳本
└── workdir/              # Persona 的工作目錄（檔案工具的預設 cwd）
```
Session partition 資料由 Electron 管理於 `<userData>/Partitions/persona-<id>/`，不在此目錄內。

### persona.yaml schema（`packages/persona-schema`，zod 驗證）

```yaml
id: research-analyst
name: Research Analyst
description: 網路資料蒐集與摘要        # 進 Agent Card
prompt: |                              # system prompt
  你是一位...
modelBinding: { providerId: openai-main, model: gpt-5-mini }   # 可省略 → 繼承全域
skills: [web-research, report-writer]  # 對應 skills/ 子目錄；省略 = 全部載入
mcpServers:
  - ref: github            # 引用全域範本名稱
  - name: local-fs         # 或內嵌定義
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workdir"]
tools:
  builtin: [browser, filesystem, shell]
  riskLevels:              # 覆寫工具風險等級，詳見 ADR-0010
    shell_exec: high
    browser_evaluate: high
  egress:                  # 外送型參數標記，還原別名時套用新網域規則（ADR-0015）
    github.create_issue: [body, title]
browser: { enabled: true }
computerUse:               # Phase 2，詳見 ADR-0018
  enabled: false
  apps: []                 # bundle id / 執行檔白名單
delegation: { timeoutMinutes: 30 }
maxConcurrency: 1
alwaysOn: true             # v1 固定 true（ADR-0002），保留欄位
triggers:                  # Phase 2，詳見 ADR-0012
  events: []
```

### 全域 privacy 設定（存於全域設定，非 persona.yaml）

```yaml
privacy:
  mode: slm                        # slm | llm，手動選擇（ADR-0005）
  modelBinding: { providerId: ollama-local, model: qwen3:8b }
  preset: balanced                 # strict | balanced | permissive（ADR-0016）
  categoryOverrides: { org_confidential: alias }
  customTerms: [{ term: "Project Falcon", category: org_confidential }]
  compute:                         # ADR-0017
    timeoutSec: 120
    memoryMb: 2048
    outputRowCap: 50
    smallCellK: 5
planner:
  modelBinding: { providerId: openai-main, model: gpt-5 }   # 可省略 → defaultBinding
```

### Skills

1. **主要格式：Agent Skills（SKILL.md）**。frontmatter 含 `name`、`description`；正文為指令。載入時，所有 skill 的 `name + description` 併入 system prompt 的 skill 索引；正文以 `load_skill(name)` 工具按需讀入 context（漸進式揭露）。
2. **附帶 TS tool 模組**：`tools.ts` 以 ESM 導出 `tools: Tool[]`（使用 `@openai/agents` 的 `tool()` 建立）。agent-runtime 在 Persona 行程啟動時以動態 `import()` 載入，直接註冊到 Agent。模組可透過 `import { getPage, getWorkdir } from '@arlo/agent-runtime/skill-api'` 取得 Playwright Page 與工作目錄。
3. **scripts**：SKILL.md 可指示 Agent 以 `shell_exec` 工具在 `workdir` 執行 `scripts/` 內的腳本。這是 Operator 自己的本機工具，與 compute-to-data 的沙箱腳本（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）無關；`shell_exec` 維持 `high`。
4. **egress 宣告**：`tools.ts` 的工具可在 metadata 宣告外送型參數，效果與 yaml `tools.egress` 相同；未宣告的 MCP／skill 工具參數視為非外送。

### 信任模型

Workspace 內的 TS 模組與腳本視為**本機使用者程式碼**（不同於 compute-to-data 中由雲端 Operator 產生的腳本，後者一律進沙箱），與 CLI agent 相同信任等級，直接在該 Persona 的 utilityProcess 執行，不做 vm / isolate 沙箱。隔離單位是行程。UI 在首次載入非內建 skill 時顯示一次性警告並要求確認。

### MCP 歸屬

每個 Persona 在**自己的行程內**啟動與連線自己的 MCP server（`MCPServerStdio` / `MCPServerStreamableHttp`）。全域設定中的 MCP 定義只是**範本**，persona.yaml 以 `ref` 引用後仍由該 Persona 自行 spawn。生命週期隨 Persona 行程；Persona 重啟時 MCP 一併重啟。兩個 Persona 引用同一個 stdio 範本會跑兩份，這是刻意的隔離代價。

## 考慮過的替代方案

- **Skill 只有 TS 模組**：能力最強，但非工程師難寫。
- **Skill 只有 SKILL.md**：安全簡單，但複雜自動化只能靠腳本。
- **全部存 DB**：不能 git 版控、不能手編、不能套用社群 skills。
- **TS 模組跑額外 sandbox 行程**：需設計 capability API，工程量大且限制 skill 能力。
- **main 集中啟動 MCP 並代理**：省資源但 stdio MCP 多有狀態，共用會互相干擾。

## 後果

- 使用者可直接把社群現成的 SKILL.md 目錄放進 `skills/` 使用。
- 需要 chokidar 監看 `persona.yaml` 與 `skills/` 變更，變更後通知 Persona 行程重新載入（下一個 Run 生效）；Agent Card 同步更新到 broker。
- 動態 `import()` TS 需要先轉譯：v1 用 esbuild 在載入時即時轉譯到 `<userData>/cache/skills/`。

## 關聯

[ADR-0002](0002-process-model.md) 行程模型、[ADR-0006](0006-browser-automation.md) 瀏覽器、[ADR-0010](0010-hitl-and-risk-levels.md) 風險等級。
