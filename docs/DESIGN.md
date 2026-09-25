# Arlo Harness 設計總覽：Agent 關係與處理流程

本文件以文字圖整理 Agent 之間的關係與主要處理流程。決策細節與理由以 [`docs/spec/`](spec/README.md) 的 ADR 為準，本文件不另立決策。

## 1. 角色

| 角色 | AgentId | 模型 | 何時存在 | 職責 |
|---|---|---|---|---|
| Privacy Agent | `privacy` | 使用者選擇的模型，通常是本地 SLM 或自架 LLM | 永遠常駐 | 唯一入口；偵測敏感資料、選擇處理路徑、最小化與別名化、組回覆並還原別名 |
| Planner | `planner` | 雲端 | 只在 SLM 模式 | 拆解任務、派發給 Operator；只看得到別名 |
| Operator | `operator:<personaId>` | 雲端或本地 | 每個已啟用的 Persona 一個 | 實際執行：瀏覽器、MCP、skills、computer use（P2）、撰寫腳本 |
| Script sandbox | （不是 Agent） | 無 | 每次執行一個短命行程 | 在本機對真實資料跑 Operator 寫的腳本 |

## 2. Agent 關係

### 2.1 SLM 模式（`privacy.mode = 'slm'`）

```
                    ┌─────────────────────────────────────────────┐
                    │ 入口：使用者 / 排程 / 事件 / webhook         │
                    │ (system:user · system:schedule · system:event│
                    │  · system:webhook)                           │
                    └──────────────────────┬──────────────────────┘
                                           │ A2A（經 main broker）
                                           ▼
                    ┌─────────────────────────────────────────────┐
                    │ Privacy Agent  [local / private]             │
                    │ 程式驅動狀態機，SLM 只做有界決策             │
                    │ Detect → Classify → Route → Compose          │
                    └───────┬──────────────────────────┬──────────┘
          R0/R1/R2：別名化後的任務                      │ R2：沙箱執行請求
                            │                          ▼
                            ▼                 ┌──────────────────┐
                    ┌───────────────────┐     │ Script sandbox   │
                    │ Planner  [cloud]  │     │ 無網路、輸入唯讀  │
                    │ delegate_to_*     │     └──────────────────┘
                    │ get/cancel/list   │
                    └──┬─────────┬──────┘
          delegate     │         │     delegate
                       ▼         ▼
             ┌──────────────┐ ┌──────────────┐
             │ Operator A   │ │ Operator B   │ …
             │ [cloud]      │ │ [cloud/local]│
             └──────┬───────┘ └──────┬───────┘
                    │ 所有送往 cloud 的模型請求
                    ▼                ▼
             ╔════════════════════════════════╗
             ║ Privacy Gate（GuardedModel）   ║──► 雲端 LLM Provider
             ╚════════════════════════════════╝
   （Planner 的模型請求同樣經 Gate；圖中省略）
```

### 2.2 LLM 模式（`privacy.mode = 'llm'`）

```
            入口：使用者 / 排程 / 事件 / webhook
                            │
                            ▼
        ┌─────────────────────────────────────────────┐
        │ Privacy Agent = Orchestrator  [local/private] │
        │ 自由規劃，外送只能經 route 工具：            │
        │  delegate_minimized · compute_to_data ·       │
        │  ask_user_privacy · get/cancel/list_tasks     │
        └──────┬──────────────┬─────────────┬──────────┘
               │              │             │ compute_to_data
               ▼              ▼             ▼
        ┌────────────┐ ┌────────────┐ ┌──────────────────┐
        │ Operator A │ │ Operator B │ │ Script sandbox   │
        └─────┬──────┘ └─────┬──────┘ └──────────────────┘
              ▼              ▼
        ╔═════════════════════════╗
        ║ Privacy Gate            ║──► 雲端 LLM Provider
        ╚═════════════════════════╝

  （不存在 Planner 行程）
```

### 2.3 A2A 路由政策（main broker 強制）

```
 from ＼ to        privacy      planner        operator:*
 ───────────────   ─────────    ───────────    ─────────────────────────────
 system:*          ✅           ❌             只有 system:user → 該 Operator 的使用者 Thread（介入）
 privacy           —            ✅（SLM）      ✅
 planner           ✅           —              ✅
 operator:*        回應 / ask_delegator         ❌（Operator 之間不可直連）
```

- 所有 Agent 間流量都經 main（星型）。
- `arlo.privacyScope`、`arlo.targetOperator` 兩個 metadata 只能由 `privacy`、`planner`、`system:*` 設定；Operator 送出的會被 broker 移除。

### 2.4 行程與元件

```
┌──────────────────────────── Electron main ─────────────────────────────┐
│ A2A Broker + 路由政策 │ SQLite: messages, vault, ledger, sandbox_runs… │
│ safeStorage 機密      │ sandbox/* 服務 │ privacy/vault.* · ledger.*     │
│ Scheduler · Event Bus · Webhook receiver · Action Center · 視窗管理     │
└──┬───────────┬───────────┬───────────────┬──────────────┬──────────────┘
   │MessagePort│MessagePort│MessagePort    │spawn         │IPC
   ▼           ▼           ▼               ▼              ▼
 privacy     planner     operator:*      sandbox 行程    renderer
 (utility)   (utility,   (utility,       (Seatbelt/      主視窗：Privacy 對話、
             SLM only)   Playwright      bwrap/Win/      隱私卡片、Ledger、任務樹
                         over CDP)       Pyodide)        Operator 視窗：Thread、瀏覽器
```

## 3. 處理路徑（Privacy Routes）

```
 R0 直通             無敏感資料 ───────────────────────────────► 規劃/執行者（仍經 Gate）
 R1 最小化+別名化    移除/泛化不需要的值 → 別名化 → 委派 → 驗證別名 → 還原 → 回覆
 R2 Compute-to-data  schema + 合成樣本 → Operator 寫腳本 → 本機沙箱執行 → 結果給使用者
 R3 純本地           Privacy Agent 自己回答，不外送
 R4 詢問使用者       privacy_confirm 中斷 → 使用者選 allow / local_only / rules_only / cancel
```

## 4. 流程

### 4.1 SLM Flow（Privacy Agent 狀態機）

```
[Intake] 使用者訊息 / 附件 / 觸發（含 arlo.targetOperator）
   │
   ▼
[Detect] 規則層（regex + 檢查碼）∪ 語意層（本地模型，JSON schema）
   │           └─ 偵測器離線 ──► R4（reason: detector_unavailable）
   ▼
[Classify] SLM → { intent, needsCloud, route, requiredEntities, dataShape }
   │   ├─ 輸出不符 schema → 重試 1 次 → 仍失敗 → R4（uncertain）
   │   └─ 政策優先：schema_only 類別 → R2；confirm 類別 → 先 R4
   ▼
[Route]
   ├─ R0/R1 ─► 最小化 + 別名化 ─► Planner ─► Operators ─► 結果（別名）
   ├─ R2 ────► 抽 schema ─► Planner/指定 Operator 寫腳本 ─► 沙箱 ─► 結果（真值，留在本機）
   ├─ R3 ────► SLM 直接回答
   └─ R4 ────► 等待使用者 ─► 依選擇回到 Route 或結束
   ▼
[Compose] 驗證別名 → 還原真值 → 回覆使用者 + 隱私卡片 + Ledger
```

### 4.2 LLM Flow

```
使用者任務 ─► Privacy Agent（LLM Run，看得到原始資料）
                │  自由規劃，可在同一任務組合多條 route
                ├─ 自己處理（R3）
                ├─ delegate_minimized(operator, task, keep=[必要的值]) ─► R0/R1
                ├─ compute_to_data(operator, datasets, question) ───────► R2
                ├─ ask_user_privacy(question, preview) ──────────────────► R4
                └─ get_task / cancel_task / list_tasks
                │  每次選擇 route 都寫入 Ledger
                ▼
              組回覆、還原別名、隱私卡片
```

### 4.3 Privacy Gate：一次雲端模型請求

```
Agent（Planner / Operator）準備送出模型請求
   │  provider.trustZone == 'cloud'?  ── 否 ──► 直接送出（Ledger 記 route: local）
   ▼ 是
[1] 取出 input items（使用者訊息、工具輸出、MCP 結果、截圖…）
[2] 以內容 hash 查快取，只處理新增 item
[3] 偵測：規則層 ∪ 語意層；圖片先做本地 OCR → 偵測 → 塗黑並標註別名
       └─ 偵測器 / OCR 不可用 ──► 擋下，Task 轉 input-required（privacy_confirm）
[4] 套用政策：alias → ⟦TYPE_n⟧（寫入 Vault，依 privacy scope）
               block → ⟦REDACTED:category⟧
               confirm 且本 Task 首次 → privacy_confirm
[5] 加上「別名保留指令」→ 送往雲端 Provider → 寫 Ledger
   │
   ▼
[6] 回應驗證：別名完整？ ── 被改寫 → 以 Vault 清單修復
                         └─ 無法修復 / 未知別名 → 要求重寫 1 次 → 仍失敗 → 報錯
   ▼
回應（仍是別名）進入 Agent 歷程
```

例外：Privacy Agent 自身綁雲端時，它的請求不經 Gate（UI 常駐警告）。

### 4.4 工具邊界：還原與外送判斷

```
雲端模型回應 tool call：browser_type(ref, "⟦EMAIL_1⟧")
   │
   ▼
[還原] 向 Vault（本 scope）取真值 → "alice@example.com"
   │
   ▼
[外送判斷] 工具是外送型（navigate URL、type/click 所在網域、egress 參數）？
   │   └─ 否 ──────────────────────────────► 執行
   ▼ 是
   目的網域 ∈ Task 網域集合（使用者提過 / 已導航過 / 已核准）？
   ├─ 是 ─► 執行
   └─ 否 ─► privacy_confirm（new_domain_egress，強制人工）─► 核准後加入集合並執行
   │
   ▼
工具輸出（真值）存入本機歷程 ─► 下次送雲端時由 Gate 重新別名化
```

### 4.5 Compute-to-data

```
Privacy 端                                   雲端 Operator/Planner
──────────                                   ─────────────────────
資料檔（CSV/XLSX/JSON/SQLite/log）
   │ 確定性解析器（不經 LLM）
   ▼
DatasetDescriptor：欄位（別名化）、型別、
格式樣式、列數級距、合成樣本列 ──(經 Gate)──►  理解 schema
                                                   │
                                   submit_compute_script(language, code,
                                   ◄──────────────  inputs, outputSpec)
   │
   ▼
靜態檢查（import 白名單 / 禁用模組）── 不通過 ──► 回報原因
   ▼
沙箱執行：in/ 唯讀、只寫 out/、無網路、清空 env、120s / 2GB
（native：Seatbelt · bwrap+Landlock+seccomp · Win restricted token；
  不可用 → Pyodide，僅 Python）
   │
   ├─ 預設：Privacy Agent 讀 out/ → 組回覆給使用者（真值不出本機）
   └─ 需 Operator 繼續（寫報告 / 修腳本）：
        out/ 與 stderr ──(列數上限 50、小格 <k=5 抑制、經 Gate)──► Operator
   寫回使用者原始檔案 → high 風險，強制人工確認
```

### 4.6 委派與向上請求（HITL）

```
派發者（SLM：Planner｜LLM：Privacy Agent）
   │ delegate（sync: message/stream｜async: message/send），帶 arlo.privacyScope
   ▼
Operator 執行 ── 需要輸入 ──► input-required
                               │
             ┌─────────────────┴───────────────────────┐
             │ question / tool_approval(medium)         │ tool_approval(high) / auth_required /
             ▼                                          │ captcha / privacy_confirm
      派發者代答（依原始任務脈絡）                        ▼
             │  無法回答 → escalate_to_user ─────►  使用者（Action Center / 視窗）
             ▼                                          │
      message/send 同 taskId 續跑 ◄─────────────────────┘
      （回答進入 Operator 前同樣經 Gate）
```

### 4.7 入口與觸發

```
主視窗輸入 ──────────┐
排程（croner）───────┤  targetOperator（可選）
事件（event bus）────┼──────────────────────────► Privacy Agent ─► 依 route 處理
webhook /hooks/<id> ─┘

Operator 視窗介入 ─► system:user ─► 該 Operator 使用者 Thread（經 Gate，自己的 privacy scope）

Outbound 推播（ntfy / Telegram）─► 偵測 + 政策 ─► ⟦REDACTED⟧ 取代 ─► 第三方
```

## 5. 資料與 scope

```
Privacy Agent Thread（scope = contextId）
   ├─ Planner Task Thread        ─┐
   ├─ Operator A Task Thread      ├─ 繼承同一 scope：同值同別名
   └─ Operator B Task Thread     ─┘
Operator 使用者 Thread (user:<id>) ─ 自己的 scope

本機（SQLite）：messages / run_states / trace_spans 存真值
               privacy_vault（safeStorage 加密）存 別名 ↔ 真值
               privacy_ledger 存別名化後的外送內容與授權事件
雲端：只收到別名化內容
```

## 6. 程式結構

```
packages/
├── privacy/          偵測器、政策、別名編碼與驗證、Gate 核心、egress、dataset、圖片遮罩
├── sandbox/          SandboxRunner 與各平台後端、託管 runtime、靜態檢查
├── agent-runtime/    GuardedModel、工具還原包裝
│   └── src/roles/    privacy-slm/ · privacy-llm/ · planner/ · operator/
├── a2a-transport/    broker 與路由政策
├── browser-tools/    Playwright 工具
├── computer-use/     （P2）桌面工具介面
├── persona-schema/   persona.yaml 與全域設定（含 privacy）
└── shared/           契約、AgentId、InterruptPayload、風險表
apps/desktop/src/main/
├── privacy/          Vault、Ledger 服務
└── sandbox/          sandbox/* 服務、run 目錄
```

兩套 Flow（`roles/privacy-slm`、`roles/privacy-llm`）只依賴 `privacy`、`sandbox` 的公開介面，不各自實作去敏或沙箱。
