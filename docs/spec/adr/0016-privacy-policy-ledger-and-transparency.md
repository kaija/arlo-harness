# ADR-0016：隱私政策、Privacy Ledger 與透明度

- 狀態：Accepted
- 日期：2026-09-25
- 適用階段：Phase 1

## 背景

產品目標是讓「不知道哪些問題可以交給雲端 LLM」的使用者安心使用。使用者不需要懂偵測細節，但要有合理的預設、看得到每次外送了什麼，並在真正敏感時被詢問。

## 決策

### 敏感類別與處理動作

1. 內建類別表定義於 `packages/privacy/policy`，每類對應一個動作：
   - `allow`：原樣送出；
   - `alias`：別名化（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）；
   - `confirm`：別名化，且該 Task 第一次外送此類別前需人工確認；
   - `schema_only`：不外送內容，強制走 compute-to-data（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）；
   - `block`：改寫為不可還原的 `⟦REDACTED:<category>⟧`。
2. 三段預設，**預設「平衡」**：

   | 類別 | 嚴格 | 平衡（預設） | 寬鬆 |
   |---|---|---|---|
   | `credential`：密碼、API key、token、私鑰 | block | block | block |
   | `gov_id`：身分證、居留證、護照、健保卡 | block | confirm | alias |
   | `financial_account`：卡號、帳號、IBAN | block | confirm | alias |
   | `health`：病歷、診斷、用藥 | block | confirm | alias |
   | `person`：人名 | alias | alias | alias |
   | `contact`：email、電話 | alias | alias | alias |
   | `location`：地址、精確位置 | alias | alias | alias |
   | `org_confidential`：公司機密、內部代號、未公開財務 | block | confirm | alias |
   | `dataset`：結構化或大量資料（CSV、XLSX、SQLite、log 等） | schema_only | schema_only | alias |
   | `public`：公開網頁內容 | allow | allow | allow |

3. `credential` 在任何預設下都是 `block`，而且不可覆寫。其他類別進階使用者可以逐類覆寫，覆寫存在全域設定 `privacy.categoryOverrides`，變更寫入 Ledger。
4. 使用者可以新增自訂詞彙（例如公司名、專案代號），指定類別與動作；比對屬於規則層，大小寫不敏感。

### Privacy Ledger

5. 每一次跨出信任區的外送都寫入 main SQLite `privacy_ledger`：時間、`scopeId`、`taskId`、發出的 Agent、目的 Provider 與 `trustZone`、route、各類別命中數、別名化後實際送出的內容（或其 blob 參照）、還原事件（別名、目的網域、是否經人工核准）、使用者授權（規則層降級、新網域、`private` 標記）。
6. 原文不另存於 Ledger：原文就在本機 `messages` 中，Ledger 以參照對照顯示。
7. 保留期與 `trace_spans` 相同（預設 90 天，可調）。Ledger 可匯出，方便使用者或公司稽核。

### 使用者看得到什麼

8. **隱私卡片**：Privacy Agent 對話中，每個任務顯示一張可展開的卡片，內容包括所選 route、送到哪個 Provider、各類別處理數量，以及「原文與送出內容對照」（別名以色塊標示，滑過可看真值，真值只在本機 renderer 還原）。
9. **只在高敏感時確認**：只有下列情況以 `privacy_confirm` 中斷請使用者確認（強制人工，見 [ADR-0010](0010-hitl-and-risk-levels.md)）：
   - 命中 `confirm` 類別；
   - SLM Flow 對 route 的判斷不確定（[ADR-0005](0005-privacy-agent-and-task-dispatch.md)）；
   - 偵測器離線；
   - 還原值要送往新網域。

   其他情況自動處理，只留紀錄。確認卡片顯示的是別名化後即將送出的內容，使用者可以選「允許」「改為純本地處理」或「取消」。
10. **Ledger 面板**：主視窗提供時間軸檢視，可依任務、Provider、類別篩選。
11. **狀態提示**：主視窗常駐顯示目前的 Privacy 模式（SLM／LLM）、預設等級、Privacy Agent 的 trustZone。Privacy Agent 綁雲端時，以警告色常駐顯示。

## 考慮過的替代方案

- **預設嚴格**：最安心，但雲端能力大打折扣，多數任務只剩純本地處理。
- **首次啟動問卷**：目標使用者正是不知道該如何回答的人。
- **每次外送都確認**：造成確認疲勞，使用者很快會不看內容直接按「允許」。
- **全自動只留紀錄**：不符合「安心」的產品目標。

## 後果

- 類別表與預設等級是產品行為的一部分，需以測試鎖定（與 [ADR-0010](0010-hitl-and-risk-levels.md) 的風險表相同做法）。
- Ledger 保存別名化後的外送內容，資料量與 trace 同級，保留策略一併處理。
- 「平衡」預設下，醫療、證件等類別第一次外送時會打斷一次；這是刻意設計的摩擦。

## 關聯

[ADR-0005](0005-privacy-agent-and-task-dispatch.md) Privacy Agent、[ADR-0011](0011-persistence-secrets-observability.md) 持久化、[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) Gate、[ADR-0017](0017-compute-to-data-and-script-sandbox.md) compute-to-data。
