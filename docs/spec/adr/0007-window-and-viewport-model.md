# ADR-0007：視窗與視口模型

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：主視窗改為 Privacy Agent 對話，新增隱私卡片、Ledger 面板與隱私狀態列
- 適用階段：Phase 1

## 背景

規格第 4、9 點要求使用者可切換檢視特定 Operator 及其環境（瀏覽器畫面、日誌），將其拉到前景，且切換不得中斷背景任務；每個 Agent 都要有專屬 Chat panel。

## 決策

1. **主視窗（Main Window）**內容：
   - **Privacy Agent Chat panel**：所有任務的入口。每個任務附隱私卡片（route、目的 Provider、類別處理數、原文與送出內容對照，見 [ADR-0016](0016-privacy-policy-ledger-and-transparency.md)）。
   - **隱私狀態列**：模式 SLM／LLM、預設等級、Privacy Agent 的 trustZone；Privacy Agent 綁雲端時以警告色常駐。
   - **Agent 列表**：Privacy Agent 固定在最上方；SLM 模式下接著顯示 Planner；再來是各 Operator。每項顯示狀態、目前任務、資源用量、縮圖，綁雲端的 Agent 加上 ☁ 標記。
   - **任務樹**：Privacy → Planner → Operators。
   - **Action Center**、**Privacy Ledger 面板**。
   - **設定**：Provider（含 trustZone 與本地端點偵測）、隱私（模式、綁定、預設等級、類別覆寫、自訂詞彙、沙箱狀態）、排程、通知規則。
   - Planner 沒有自己的視窗，它的 Thread 在主視窗任務樹中以唯讀方式檢視（內容為別名化後的樣子）。
2. **每個 Operator 一個獨立 `BrowserWindow`**，可隱藏。內容：
   - 左：該 Operator 的 Thread 列表與 Chat panel（訊息、思維鏈、工具呼叫日誌）。訊息在本機以真值顯示，別名化的值以色塊標示，滑過可看「雲端看到的是 ⟦PERSON_1⟧」。
   - 右：瀏覽器區，以 `WebContentsView` 嵌入，頂部 tab 列與網址列（唯讀 + 手動導航按鈕）。
   - 底：執行日誌 / trace 時間軸（可摺疊）。
   Operator 視窗與主視窗共用同一個 renderer bundle，以 URL hash 區分 `#/main` 與 `#/persona/<id>`。
3. **切換檢視** = 主視窗 Agent 列表點擊 → main 對該 Operator 視窗 `show()` + `focus()`。關閉視窗 = `hide()`，不銷毀；行程與 WebContentsView 繼續存活。
4. **視窗建立時機**：Operator 行程在 App 啟動時常駐（[ADR-0002](0002-process-model.md)），但 Operator **視窗**延遲到第一次需要時建立：使用者首次點擊該 Operator，或該 Operator 首次呼叫任一 browser 工具。建立後保持隱藏 / 顯示狀態直到 App 關閉。
5. **背景不中斷**：視窗隱藏不影響 utilityProcess；webContents 已關閉節流（[ADR-0006](0006-browser-automation.md)）。切換視窗純粹是 UI 操作，不經過 Agent 行程。
6. **縮圖**：主視窗 Agent 列表的預覽縮圖由 main 每 5 秒對有活動的 Operator `webContents.capturePage()` 產生低解析度圖，經 IPC 送主視窗。無活動時不擷取。

## 考慮過的替代方案

- **單主視窗 + WebContentsView 換入換出**：UI 集中，但一次只能看一個 Operator，且使用者明確偏好獨立視窗。
- **Offscreen rendering + 截圖串流**：可在 React 內任意疊加，但 CPU 成本高、互動需轉發。

## 後果

- 每個已建立視窗的 Operator 多一個 renderer 行程（約 30–60 MB）。延遲建立視窗緩解「全部常駐」的記憶體壓力。
- 多視窗在 macOS 需處理 Dock / Cmd-Tab 行為：Operator 視窗設為主視窗的非 modal 子視窗以外的獨立視窗，App 退到背景時全部一起隱藏 / 顯示。
- 使用者可能同時開多個 Operator 視窗並排觀察，這是期望的行為。

## 關聯

[ADR-0002](0002-process-model.md) 行程模型、[ADR-0006](0006-browser-automation.md) 瀏覽器、[ADR-0009](0009-conversation-threads-and-concurrency.md) Thread 與面板。
