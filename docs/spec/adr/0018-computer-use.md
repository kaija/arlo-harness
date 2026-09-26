# ADR-0018：Computer use（桌面操作）

- 狀態：Accepted
- 日期：2026-09-25
- 適用階段：Phase 2

## 背景

平台目標是類似 OpenManus 的「可以代理任何事」的 Agent，除了內嵌瀏覽器（[ADR-0006](0006-browser-automation.md)），Operator 也要能操作使用者的桌面 App。桌面截圖是最大的隱私風險：畫面上可能同時有信件、聊天與財務資料，且都會送往雲端視覺模型。

## 決策

1. **操作真實桌面，但限定 App 白名單**。
   - Operator 只能操作使用者授權的 App：persona.yaml 的 `computerUse.apps` 列出 bundle id 或執行檔，首次使用時在 UI 逐一確認。
   - 截圖時，白名單以外的所有視窗區域一律塗黑；這在截圖產生時就做，早於 Gate。
2. **工具**（`packages/computer-use` 定義介面與風險預設，native 實作在 `apps/desktop/src/main/computer-use/`，Operator 經 `computer/*` 服務呼叫）：
   - `computer_screenshot`：low；
   - `computer_click(x, y)`、`computer_type(text)`、`computer_key`、`computer_scroll`：medium；
   - `computer_open_app(appId)`：medium，只限白名單。
3. **平台**：macOS 優先。需要「輔助使用」與「螢幕錄製」權限，由 main 引導授權；未授權時工具回報結構化錯誤，不中斷其他工具。Windows／Linux 保持介面可建置，行為留待後續。
4. **截圖隱私**：截圖進入模型 input 時，由 Gate 的圖片處理做本地 OCR、偵測、塗黑，並標註別名（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) 第 20 點）。座標不變，點擊照常可用。
5. **輸入真值**：`computer_type` 的參數含別名時，在本機還原後輸入，輸入目標是白名單 App。要輸入到有網址列的瀏覽器類 App 時，套用新網域外送規則。
6. **獨佔與接管**：桌面同時只允許一個 Operator 持有，由 main 管理鎖。偵測到使用者自己移動滑鼠或按鍵時立即暫停，並提示「使用者接管中」；使用者按「繼續」後才恢復。
7. 若有 [ADR-0005](0005-privacy-agent-and-task-dispatch.md) 的 route 需要，Privacy Agent 可指定某任務禁止使用 computer use，例如 SLM Flow 判斷資料屬 `confirm` 類別時。

## 考慮過的替代方案

- **隔離 VM／容器桌面**：畫面上沒有個資，但操作不到使用者自己的 App 與登入狀態，也失去「什麼都能做」的價值。
- **本地視覺模型執行 computer use**：截圖不出本機，但本地 VLM 在 AI PC 上又慢又弱。
- **只送 a11y 文字**：許多 App（Canvas、圖片）沒有可用的 a11y tree。

## 後果

- 需要 native 輸入注入與截圖模組；打包時要處理 macOS 權限描述與 entitlements。
- OCR 漏抓的敏感文字會送上雲；白名單遮罩與類別政策可降低暴露面，但不能歸零。這是已知風險。
- Phase 1 已把圖片遮罩用在瀏覽器截圖上，Phase 2 可以沿用同一條管線。

## 關聯

[ADR-0006](0006-browser-automation.md) 瀏覽器、[ADR-0010](0010-hitl-and-risk-levels.md) 風險等級、[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) Gate。
