# ADR-0001：執行環境與程式碼庫結構

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 1

## 背景

平台需要內嵌完整 Chromium、跨平台桌面能力與多行程 IPC（規格第 1、8 點）。同時 Agent 核心（OpenAI Agents SDK、A2A、Playwright）都是 Node 生態，UI 需要現代前端框架。專案初期只有一位開發者，主要在 macOS 上開發。

## 決策

1. **應用框架**：Electron（最新穩定版）。
2. **建置工具**：electron-vite，一個工具同時建置 main / preload / renderer 與 utilityProcess 入口。
3. **UI**：React 19 + TypeScript，搭配 Tailwind CSS、shadcn/ui、Zustand（renderer 狀態）、TanStack Router（renderer 內路由）。不採用 Next.js。
4. **套件管理**：pnpm workspace monorepo。
5. **目標平台**：macOS 優先；Windows / Linux 保持可建置（CI 三平台跑 build），但 e2e 與簽章只在 macOS 做。避免使用 mac-only API。

### Monorepo 佈局

```
arlo-harness/
├── apps/
│   └── desktop/                 # Electron 應用（electron-vite）
│       ├── src/main/            # main process：視窗、broker、SQLite、scheduler、通知
│       ├── src/preload/         # contextBridge，僅暴露白名單 IPC
│       ├── src/renderer/        # React UI（主視窗 + Persona 視窗共用 bundle）
│       └── src/agent-host/      # utilityProcess 入口，載入 packages/agent-runtime
├── packages/
│   ├── agent-runtime/           # OpenAI Agents SDK 包裝、Session、TracingProcessor、Skill loader
│   ├── a2a-transport/           # MessagePort 上的 A2A JSON-RPC 傳輸與 broker
│   ├── browser-tools/           # Playwright connectOverCDP 工具集
│   ├── persona-schema/          # persona.yaml zod schema、SKILL.md 解析
│   └── shared/                  # 事件型別、IPC 契約、共用常數
├── docs/spec/                   # 本 ADR 集
└── .github/workflows/
```

`packages/*` 不得依賴 `electron` 套件，必須能在純 Node 下單元測試。與 Electron 相關的膠水碼只放在 `apps/desktop`。

## 考慮過的替代方案

- **Next.js static export + Electron**：符合開發者全域偏好，但 SSR 無意義、dynamic route 與 file:// 衝突、image optimizer 要關，且 main/preload 仍需另一套建置。否決。
- **Vue / Svelte**：與其他專案的 React 生態不一致。否決。
- **單一 package**：起步快但 agent-runtime 測試會被 Electron 依賴拖累。否決。
- **三平台同等支援**：CI 成本與 safeStorage / 簽章差異需各自驗證，v1 不值得。

## 後果

- 開發者需接受 electron-vite 的 HMR 與 React 無 SSR 模式。
- `packages/*` 純 Node 的約束讓 A2A 傳輸、scheduler、persona loader 可以在秒級單元測試中驗證。
- Windows / Linux 的行為差異（safeStorage 後端、視窗管理）在 v1 只保證能建置，不保證行為一致。

## 關聯

[ADR-0002](0002-process-model.md) 行程模型、[ADR-0014](0014-testing-ci-packaging.md) 測試、CI 與打包。
