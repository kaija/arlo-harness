# ADR-0014：測試、CI 與打包發佈

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：新增隱私 canary 測試、偵測器語料、沙箱逃逸測試
- 適用階段：Phase 1

## 背景

平台整合面多（Electron 多行程、CDP、A2A 傳輸、原生模組），且 LLM 呼叫不可在 CI 打真 API。需要可持續的測試與發佈流程。

## 決策

### 測試

1. **單元測試**：Vitest。`packages/*` 全部純 Node 可測：A2A MessagePort 傳輸（用 Node `MessageChannel` 模擬）、broker 路由、persona.yaml schema、SKILL.md 解析、模板變數替換、scheduler（假時鐘）、風險等級表、HITL payload 映射。
2. **Mock Model Provider**：`packages/agent-runtime/testing` 提供 `FakeModel`，可用腳本指定每輪回應（文字或 tool call），讓 Privacy Agent 兩種 Flow、Planner 派發、HITL 中斷 / 恢復、Thread 排隊等流程在不打 API 的情況下端到端驗證。`FakeModel` 可宣告 `trustZone`，扮演本地 SLM（含 JSON schema 輸出）或雲端模型，並記錄收到的每個請求。
3. **隱私測試**（安全邊界，任何變更必須通過）：
   - **偵測器語料**：`packages/privacy` 以繁中與英文語料鎖定規則層的命中與不命中，涵蓋身分證檢查碼、統一編號、卡號 Luhn、IBAN、電話格式、API key。
   - **Canary 測試**：在使用者輸入、附件、工具輸出、MCP 結果、瀏覽器 snapshot、截圖 OCR 文字、腳本 stderr 中植入 canary 值；分別以 SLM Flow 與 LLM Flow 跑完整任務，斷言扮演雲端的 `FakeModel` 收到的任何請求都不含 canary 原值，且最終回覆正確還原。
   - **別名保真**：模擬雲端模型改寫別名（去括號、翻譯型別、全形），驗證修復或拒絕；驗證新網域外送觸發 `privacy_confirm`。
   - **Fail-closed**：偵測器 Provider 離線、OCR 不可用時，雲端請求必須被擋。
   - **沙箱逃逸**：每個 native 後端與 Pyodide 在各自平台的 CI 上嘗試連網、讀取 in 以外的檔案、寫入 out 以外的位置、fork bomb、超時與超量記憶體，全部都必須失敗。
4. **e2e**：Playwright 的 `_electron` 啟動 `apps/desktop`，覆蓋冒煙路徑：App 啟動、建立 Persona、Provider 設定（用 FakeModel 的 `apiType: 'fake'`，僅 test build 啟用）、在 Privacy Agent 輸入含個資的任務、看到隱私卡片與 Ledger 紀錄、派發到 Operator 並看到其視窗與 Thread 更新、`privacy_confirm` 與 HITL 升級到 Action Center 並回答。
5. **覆蓋率目標**：`packages/*` 80% 以上，`packages/privacy` 與 `packages/sandbox` 90% 以上；`apps/desktop` 以 e2e 為主不設行覆蓋門檻。
6. **Lint / format**：ESLint + Prettier，pre-commit 以 lefthook 跑 lint-staged 與 typecheck。

### CI（GitHub Actions）

7. `ci.yml`：PR 與 main push 觸發。矩陣 `ubuntu / macos / windows`：安裝 pnpm、typecheck、vitest、`electron-builder --dir` 驗證可打包（含 better-sqlite3 rebuild）。e2e 只在 macOS runner 執行。
8. `release.yml`：tag `v*` 觸發。三平台 `electron-builder --publish always` 上傳到 GitHub Releases。v1 為未簽章 build；macOS 簽章與公證（Developer ID + notarytool）在取得憑證後於同一 workflow 加上 secrets 即啟用。
9. 依賴掃描：Dependabot 每週 + `pnpm audit` 在 CI 非阻塞警告。

### 打包與更新

10. **electron-builder**：產出 macOS dmg + zip、Windows nsis、Linux AppImage。asar 開啟；`better-sqlite3`、`playwright-core`、Seatbelt 設定檔與 Pyodide 資產列入 `asarUnpack`。託管 Python 不打包，首次啟用時下載（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）。
11. **自動更新**：`electron-updater` 指向 GitHub Releases，App 啟動後背景檢查，下載完成在 Action Center 提示重啟安裝，不強制。
12. 版本以語意化版本管理，`CHANGELOG.md` 由 changesets 產生。

## 考慮過的替代方案

- **只做單元測試、e2e 人工**：Electron 整合層最易壞卻沒人守。
- **Electron Forge**：官方工具鏈，但 auto-update 要自接 update server。
- **v1 不打包**：asar / 原生模組問題會在最後爆。

## 後果

- e2e 在 CI 需要無頭環境的 Electron，macOS runner 可直接跑；Playwright Electron 對多視窗（Persona 視窗）的操作需以 `app.windows()` 定位。
- FakeModel 是測試策略核心，需與真實 Provider 的事件流保持同形（尤其 tool call 與 interruption），變更 SDK 版本時一併更新。

## 關聯

[ADR-0001](0001-runtime-and-repository-structure.md) 結構、[ADR-0011](0011-persistence-secrets-observability.md) 原生模組。
