# ADR-0006：內嵌瀏覽器與自動化通道

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：Persona 改稱 Operator；瀏覽器內容進入雲端模型前經 Gate，navigate／type 為外送型工具
- 適用階段：Phase 1

## 背景

規格第 1、2 點要求內嵌 Chromium 實例作為 Operator 的標準工具，支援 DOM 選取、事件、導航、生命週期控制，並要求 Session 持久化與各 Persona 隔離。瀏覽器 `WebContentsView` 由 main process 持有，但 Operator 在 utilityProcess，沒有 `webContents` API。

## 決策

1. **控制通道：Playwright `connectOverCDP`**。
   - Electron 以 `app.commandLine.appendSwitch('remote-debugging-port', port)` 開啟 CDP，port 隨機、僅綁 `127.0.0.1`，並以 `--remote-allow-origins=<none>` 限制 WebSocket origin。
   - main 建立 Persona 的 `WebContentsView` 後，透過 `webContents.debugger` 取得 targetId，把 `{ wsEndpoint, targetId }` 交給 Operator 行程。
   - Operator 行程用 `playwright-core` 的 `chromium.connectOverCDP(wsEndpoint)`，從 `browser.contexts()` 找到對應 targetId 的 `Page`。
2. **Session 隔離與持久化**：每個 Persona 的 webContents 使用 `session.fromPartition('persist:persona-<id>')`。Cookie、LocalStorage、IndexedDB、cache 由 Electron 存於 userData，跨重啟保留。刪除 Persona 時呼叫 `session.clearStorageData()` 並移除 partition 目錄。
3. **背景執行**：Persona webContents 設 `backgroundThrottling: false`；有進行中 Task 時 main 持有 `powerSaveBlocker.start('prevent-app-suspension')`。
4. **標準工具集**（`packages/browser-tools`，註冊為 SDK function tools）：`browser_navigate`、`browser_snapshot`（a11y tree + 可互動元素 ref）、`browser_click(ref)`、`browser_type(ref, text)`、`browser_press_key`、`browser_scroll`、`browser_screenshot`、`browser_extract(selector|ref)`、`browser_wait_for`、`browser_tabs(list|new|close|switch)`、`browser_evaluate(js)`（riskLevel: high）。工具透過 ref 而非 CSS selector 操作，降低 LLM 出錯率。
5. **多 tab**：一個 Operator 視窗可含多個 `WebContentsView`（tab），共用同一 partition。`maxConcurrency > 1` 時每個 Run 開自己的 tab，但 cookie / storage 仍共用，Persona 設定文件需明示此限制。
6. **隱私**（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）：
   - `browser_snapshot`、`browser_extract`、`browser_screenshot` 的輸出以真值留在本機歷程，Operator 綁雲端模型時，由 Gate 在送出前別名化；截圖走 Gate 的 OCR 塗黑。
   - `browser_navigate`（URL）、`browser_type`、`browser_click` 屬外送型工具：參數中的別名在執行前還原，若還原值會送往不在可信網域集合內的網域，則以 `privacy_confirm` 中斷。導航本身不會讓網域變成可信：可信網域只來自使用者輸入、使用者核准與全域信任清單。
   - `browser_evaluate` 的 JS 字串同樣會還原別名，因此維持 `high`。
7. **Skill 可直接用 Playwright**：Persona 的 TS tool 模組可透過 agent-runtime 提供的 `getPage()` 取得 Playwright `Page`，撰寫自訂自動化。

## 考慮過的替代方案

- **自建 CDP proxy over MessagePort**：不開 port、最安全，但要自己實作 locator / auto-wait / a11y snapshot，工程量大。
- **main 提供高階 browser RPC**：集中審計，但 Skill 無法直接寫 Playwright。
- **兩者並存**：維護兩套。

## 後果

- 本機多一個 CDP port。緩解：隨機 port、僅 loopback、限制 origin；UI 設定頁顯示目前 port 供稽核。
- Playwright 版本需與 Electron 內建 Chromium 版本相容；升級 Electron 時一併驗證。
- 登入態隨 partition 持久，意味 Operator 可長期保持網站登入；這是功能也是風險，配合 [ADR-0010](0010-hitl-and-risk-levels.md) 的 `auth_required` 流程與 [ADR-0011](0011-persistence-secrets-observability.md) 的本機加密。
- 已登入頁面（例如信箱）上的個資會經由 snapshot 流向雲端 Operator；Gate 會別名化，但偵測漏抓時仍會外洩。政策「平衡」以上建議不要讓雲端 Operator 長期保持高敏感網站的登入。

## 關聯

[ADR-0007](0007-window-and-viewport-model.md) 視窗模型、[ADR-0008](0008-persona-workspace-and-skills.md) Skill、[ADR-0010](0010-hitl-and-risk-levels.md) HITL、[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) Gate、[ADR-0018](0018-computer-use.md) 桌面操作。
