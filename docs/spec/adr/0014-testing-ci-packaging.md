# ADR-0014：測試、CI 與打包發佈

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 1

## 背景

平台整合面多（Electron 多行程、CDP、A2A 傳輸、原生模組），且 LLM 呼叫不可在 CI 打真 API。需要可持續的測試與發佈流程。

## 決策

### 測試

1. **單元測試**：Vitest。`packages/*` 全部純 Node 可測：A2A MessagePort 傳輸（用 Node `MessageChannel` 模擬）、broker 路由、persona.yaml schema、SKILL.md 解析、模板變數替換、scheduler（假時鐘）、風險等級表、HITL payload 映射。
2. **Mock Model Provider**：`packages/agent-runtime/testing` 提供 `FakeModel`，可用腳本指定每輪回應（文字或 tool call），讓 Orchestrator 派發、HITL 中斷 / 恢復、Thread 排隊等流程在不打 API 的情況下端到端驗證。
3. **e2e**：Playwright 的 `_electron` 啟動 `apps/desktop`，覆蓋冒煙路徑：App 啟動、建立 Persona、Provider 設定（用 FakeModel 的 `apiType: 'fake'`，僅 test build 啟用）、派發一個任務並看到 Persona 視窗與 Thread 更新、HITL 升級到 Action Center 並回答。
4. **覆蓋率目標**：`packages/*` 80% 以上；`apps/desktop` 以 e2e 為主不設行覆蓋門檻。
5. **Lint / format**：ESLint + Prettier，pre-commit 以 lefthook 跑 lint-staged 與 typecheck。

### CI（GitHub Actions）

6. `ci.yml`：PR 與 main push 觸發。矩陣 `ubuntu / macos / windows`：安裝 pnpm、typecheck、vitest、`electron-builder --dir` 驗證可打包（含 better-sqlite3 rebuild）。e2e 只在 macOS runner 執行。
7. `release.yml`：tag `v*` 觸發。三平台 `electron-builder --publish always` 上傳到 GitHub Releases。v1 為未簽章 build；macOS 簽章與公證（Developer ID + notarytool）在取得憑證後於同一 workflow 加上 secrets 即啟用。
8. 依賴掃描：Dependabot 每週 + `pnpm audit` 在 CI 非阻塞警告。

### 打包與更新

9. **electron-builder**：產出 macOS dmg + zip、Windows nsis、Linux AppImage。asar 開啟；`better-sqlite3`、`playwright-core` 列入 `asarUnpack`。
10. **自動更新**：`electron-updater` 指向 GitHub Releases，App 啟動後背景檢查，下載完成在 Action Center 提示重啟安裝，不強制。
11. 版本以語意化版本管理，`CHANGELOG.md` 由 changesets 產生。

## 考慮過的替代方案

- **只做單元測試、e2e 人工**：Electron 整合層最易壞卻沒人守。
- **Electron Forge**：官方工具鏈，但 auto-update 要自接 update server。
- **v1 不打包**：asar / 原生模組問題會在最後爆。

## 後果

- e2e 在 CI 需要無頭環境的 Electron，macOS runner 可直接跑；Playwright Electron 對多視窗（Persona 視窗）的操作需以 `app.windows()` 定位。
- FakeModel 是測試策略核心，需與真實 Provider 的事件流保持同形（尤其 tool call 與 interruption），變更 SDK 版本時一併更新。

## 關聯

[ADR-0001](0001-runtime-and-repository-structure.md) 結構、[ADR-0011](0011-persistence-secrets-observability.md) 原生模組。
