# UI Design Prompt

以下內容可直接複製到 Claude Design 使用。此 prompt 只描述功能與資訊架構，不包含視覺風格、色彩、字體或元件規範（由 Claude Design 既有的 design system 決定）。

---

請為一個 **桌面端 AI Agent 平台（Electron 應用）** 設計 UI。這個平台讓使用者管理多個自治 AI Agent：一個 **Orchestrator（主控協調 Agent）** 負責拆解任務並派發給多個 **Persona Agent（角色 Agent）**，每個 Persona 有自己的人設、工具、內嵌瀏覽器與工作目錄，並且可以在背景持續執行任務。

應用有兩種視窗：**主視窗（Main Window）** 一個，**Persona 視窗（Persona Window）** 每個 Persona 各一個，可獨立開關與並排。請設計以下畫面與流程。

## 1. 主視窗（Main Window）

主視窗是全域控制台，包含四個區域：

### 1.1 Agent 側欄（Agent List）
- 最上方固定一項 **Orchestrator**。
- 下方列出所有 Persona，每項顯示：名稱、頭像或代號、目前狀態（idle / working / waiting for input / error / offline）、正在執行的任務標題（若有）、排隊中任務數、瀏覽器畫面的小縮圖（有活動時才顯示）、行程資源用量（記憶體、CPU，可折疊）。
- 狀態為 waiting for input 時顯示醒目徽章，表示有待處理的人工確認。
- 點擊 Persona 會開啟或聚焦該 Persona 的獨立視窗。
- 底部有「新增 Persona」入口。
- 支援依狀態篩選與搜尋。

### 1.2 Orchestrator 對話面板（Orchestrator Chat）
- 主視窗中央是與 Orchestrator 的對話。使用者在這裡下達高階任務。
- 對話訊息類型：使用者訊息、Orchestrator 回覆、**思維鏈（reasoning，可展開/收合）**、**工具呼叫紀錄**（工具名稱、輸入、輸出、耗時、成功/失敗，可展開）、**委派卡片**（Orchestrator 把任務派給某個 Persona 時出現：目標 Persona、任務摘要、同步/非同步模式、即時狀態、完成後的結果摘要，可點擊跳到該 Persona 的對應 Thread）、**系統事件**（某個非同步任務完成、失敗、或需要人工介入時插入的通知）。
- 輸入區：文字輸入、附件、**語音輸入按鈕**（麥克風：push-to-talk 與自動分段兩種模式；另有上傳音訊檔轉文字），語音轉文字結果先填入輸入框供使用者確認再送出。若目前選擇的模型不支援即時語音，麥克風按鈕隱藏、只保留上傳音訊檔。
- 支援「傳送」與「派發為背景任務」兩種送出方式。
- 顯示串流中的狀態（正在思考、正在呼叫工具、等待 Persona）。

### 1.3 任務樹（Task Tree）
- 可切換的面板，以樹狀顯示 Orchestrator 目前與歷史任務：根節點是使用者的任務，子節點是派發給各 Persona 的子任務，每個節點顯示狀態、Persona、開始時間、耗時、結果摘要。
- 節點可展開查看該子任務的訊息與工具呼叫，或跳轉到 Persona 視窗的對應 Thread。
- 可取消進行中的子任務。

### 1.4 Action Center（通知與待辦中心）
- 全域通知清單，每則有嚴重度（info / success / warning / error / action required）、來源 Agent、標題、內容、時間、已讀狀態。
- **action required** 類型置頂直到處理，這類通知是人工確認請求，共五種：
  1. **question**：Persona 提問，需要使用者以文字回答（可能附選項）。
  2. **tool approval**：Persona 想執行某個工具（顯示工具名稱、參數、風險等級、Persona 的理由），使用者可「允許」「拒絕」或「允許並修改參數」。
  3. **auth required**：Persona 在某網站遇到登入或 MFA，需要使用者親自到該 Persona 視窗的瀏覽器完成登入後按「繼續」。
  4. **captcha**：同上，附截圖預覽。
  5. **tool error**：工具執行失敗的結構化回報，可「重試」或「忽略」。
- 通知可直接在 Action Center 內回應，也可跳轉到對應 Persona 視窗。
- 有「全部標為已讀」與依嚴重度、來源篩選。
- 系統層級也會發桌面 Toast，請設計 Toast 的簡短版型。

## 2. Persona 視窗（Persona Window）

每個 Persona 一個獨立視窗，關閉只是隱藏，Persona 在背景繼續執行。視窗分三區：

### 2.1 Thread 列表（左側）
- 列出此 Persona 的對話 Thread，每條有來源標籤：**user**（使用者手動對話，固定置頂一條）、**orchestrator**（被派發的任務）、**schedule**（排程觸發）、**event**（事件觸發）、**webhook**。
- 每條顯示標題、最後活動時間、狀態（queued / running / waiting for input / done / failed）。
- 依最近活動排序，可搜尋。

### 2.2 對話面板（中央）
- 顯示選中 Thread 的完整歷程，訊息類型與主視窗相同（訊息、思維鏈、工具呼叫、系統事件），另加 **瀏覽器動作紀錄**（導航到某網址、點擊某元素、擷取內容，附小截圖）。
- 使用者可在任一 Thread 打字介入。Persona 正在執行時，介入訊息會標示為「將於下一輪處理」。
- 輸入區與主視窗相同（文字、附件、語音）。
- 頂部工具列：Persona 名稱與狀態、目前綁定的模型、「暫停 / 繼續」、「取消目前任務」、「開啟設定」。
- 當 Thread 處於 waiting for input 時，在對話底部以嵌入式卡片呈現待處理的確認請求（同 Action Center 的五種類型），可直接在此回答。

### 2.3 瀏覽器區（右側）
- 內嵌的瀏覽器畫面，頂部是分頁（tab）列與網址列。網址列可手動輸入導航，並有前進、後退、重新整理。
- 顯示「Agent 正在操作中」的狀態指示，以及 Agent 目前聚焦的元素高亮（設計一個非侵入式的視覺提示）。
- 使用者可隨時接管操作（例如完成登入、解驗證碼），接管時顯示「使用者操作中，Agent 暫停」的提示與「交還給 Agent」按鈕。
- 區塊可拖動調整寬度、可全螢幕、可摺疊。

### 2.4 執行日誌（底部，可摺疊）
- 時間軸形式的 trace 檢視：每個 Run 的 span（模型呼叫、工具呼叫、MCP 呼叫、瀏覽器動作），顯示耗時與 token 用量，可展開細節。
- 可依 Run 篩選、可匯出。

## 3. Persona 設定（Persona Settings）

從 Persona 視窗或主視窗進入，以分頁或分段呈現：

- **基本**：名稱、描述（會成為 Orchestrator 派發時的依據，請提示使用者寫清楚專長）、頭像或代號、人設 system prompt（大型文字編輯區）。
- **模型**：使用全域預設，或指定 Provider 與模型名稱、溫度等參數。
- **Skills**：列出工作目錄下已載入的 skill（名稱、描述、來源、是否包含可執行程式碼的標記），可啟用/停用，可開啟資料夾。首次載入含程式碼的非內建 skill 時需要一次性的信任確認對話框。
- **MCP 伺服器**：列出此 Persona 的 MCP 伺服器（來自全域範本引用或自訂），顯示連線狀態、提供的工具數；可新增（stdio 或 HTTP）、編輯、移除、重新連線。
- **工具與風險等級**：表格列出所有可用工具（內建、MCP、skill 提供），每個工具可設定風險等級：**low**（自動執行）、**medium**（Orchestrator 可代為批准）、**high**（必須由使用者批准）。未設定預設 medium。提供依來源分組與批次調整。
- **瀏覽器**：啟用/停用、清除此 Persona 的瀏覽資料（cookie、儲存）、檢視目前登入的網站。
- **執行**：最大並行數（預設 1，大於 1 時顯示「多個任務會共用同一個瀏覽器登入狀態」警告）、同步任務逾時。
- **觸發器**：訂閱的內部事件與對應 prompt 模板；此 Persona 的 webhook 網址與 token（可重新產生、複製）。
- **危險區**：停用、刪除（含是否一併刪除工作目錄與瀏覽資料）。

## 4. 全域設定（Global Settings）

- **Model Providers**：Provider 清單（名稱、類型：OpenAI / OpenAI 相容 / Azure OpenAI、Base URL、API Key 只顯示尾碼四碼、支援的能力如即時語音與語音轉文字），新增/編輯表單依類型顯示不同欄位，有「測試連線」。設定全域預設模型。
- **Orchestrator**：Orchestrator 的模型綁定與 system prompt。
- **MCP 範本**：全域可重複使用的 MCP 伺服器定義，供各 Persona 引用。
- **排程（Schedules）**：排程清單（名稱、cron 表達式與人類可讀翻譯、時區、目標 Persona、啟用狀態、上次執行、下次執行），新增/編輯表單含 prompt 模板編輯器，模板支援變數如 `{{current_time}}`、`{{date}}`、`{{timestamp}}`，提供變數插入器與預覽。每條排程可「立即執行」，並可查看執行歷史（含 App 未開啟而略過的紀錄）。
- **通知**：桌面 Toast 開關與嚴重度門檻；**外部轉發規則**清單（條件：嚴重度/來源/類型 → 目標 webhook URL、header、body 模板），內建 ntfy 與 Telegram 兩個快速範本，可「發送測試通知」。
- **進階**：Trace 匯出到 OTLP endpoint 的開關與設定、資料保留天數、本機 CDP port 與 webhook port 的顯示、資料庫位置、應用更新（檢查更新、目前版本、更新完成後提示重啟）。

## 5. 首次啟動與建立 Persona 流程

- **首次啟動**：引導設定第一個 Model Provider（輸入 API Key、測試連線）→ 建立第一個 Persona（可從幾個內建範本挑選，例如網路研究員、資料整理員、程式助手）→ 進入主視窗並提示可以對 Orchestrator 下第一個任務。
- **建立 Persona**：精靈式或單頁表單，至少填名稱、描述、人設 prompt；其餘採預設。

## 6. 關鍵狀態與空狀態

請為以下情境設計狀態畫面：
- 沒有任何 Persona 時的主視窗。
- Persona 離線或崩潰重啟中（顯示重啟倒數與重試次數）。
- Provider 連線失敗或 API Key 無效。
- Persona 視窗中瀏覽器尚未啟動（尚無任務用到瀏覽器）。
- 使用者接管瀏覽器中。
- 長時間執行的背景任務（顯示已執行時間與最近一個動作）。

## 7. 互動原則（功能層面）

- 任何在背景執行的任務不因視窗切換、隱藏、或使用者在其他 Persona 視窗操作而中斷；UI 需要讓使用者隨時知道「現在有多少東西在跑」與「有多少東西在等我」。
- 所有人工確認請求都要能在三個地方處理：Action Center、Persona 對話面板內嵌卡片、桌面 Toast 的快速動作。
- 委派關係要可追溯：從 Orchestrator 的委派卡片能跳到 Persona Thread，從 Persona Thread 能回到發起它的 Orchestrator 任務。
- 支援多個 Persona 視窗並排觀察。
- 主視窗與 Persona 視窗都需要適應較窄的寬度（側欄可收合、瀏覽器區可摺疊）。
