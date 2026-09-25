# ADR-0015：Privacy Gate、別名化與 Vault

- 狀態：Accepted
- 日期：2026-09-25
- 適用階段：Phase 1（圖片遮罩隨 T15 進 Phase 1；桌面截圖屬 Phase 2，見 [ADR-0018](0018-computer-use.md)）

## 背景

平台改為「Privacy Agent 規劃、Operator 在雲端執行」（[ADR-0005](0005-privacy-agent-and-task-dispatch.md)）。目標使用者不知道哪些內容可以交給雲端 LLM，因此隱私保證必須由程式碼強制，不能依賴模型判斷：本地 SLM 會誤判，雲端 Operator 會遇到 prompt injection。

盤問確認的威脅模型（範圍內）：

1. 雲端 LLM Provider（模型、日誌、訓練資料）看到可識別使用者的敏感資料。
2. Prompt injection 誘使 Operator 把真實資料送到第三方。
3. Operator 產生的惡意或錯誤腳本（[ADR-0017](0017-compute-to-data-and-script-sandbox.md)）。

範圍外：本機惡意軟體、其他 OS 使用者讀取 SQLite 或行程記憶體（與 [ADR-0008](0008-persona-workspace-and-skills.md) 的本機信任模型一致）。

## 決策

### 1. 強制點：模型請求邊界

1. agent-runtime 以 `GuardedModel` 包裝 SDK `Model`。**凡是送往 `trustZone === 'cloud'` Provider 的模型請求**，送出前都經過 Gate，不論發出者是 Planner 還是 Operator，也不論內容來自使用者輸入、工具輸出、MCP、skill、檔案或截圖。
2. 唯一例外：Privacy Agent 本身綁定雲端 Provider 時，其請求**不經 Gate**（盤問第 23b 題的決定，見 [ADR-0003](0003-agent-sdk-and-model-providers.md)）。UI 常駐顯示「隱私代理使用雲端模型，原始資料會送達該 Provider」。
3. Gate 在 A2A 或工具邊界都不做過濾：main broker 看不到 Operator 行程內的工具輸出，逐一包裝工具也容易漏掉新工具。單一強制點讓「新增工具、MCP 或 skill 會不會繞過去」這個問題不存在。
4. 效能：Gate 以內容 hash 快取每個 input item 的偵測結果，每輪只掃描新增內容；別名化後的 item 同樣以 hash 快取，確保同一 Thread 每輪送出的前綴相同，不破壞 Provider 端的 prompt cache。

### 2. 信任區（trustZone）

5. `ProviderProfile.trustZone: 'local' | 'private' | 'cloud'`，由 `baseUrl` 推導預設值：
   - loopback（`127.0.0.0/8`、`::1`、`localhost`）為 `local`；
   - RFC1918、`fc00::/7`、`*.local`、Tailscale `100.64.0.0/10` 為 `private`；
   - 其他一律為 `cloud`，`apiType: 'openai' | 'azure_openai'` 永遠是 `cloud`。
   使用者可以把推導為 `cloud` 的端點改標為 `private`（例如公司自架在公網的 vLLM），須明確確認並寫入 Ledger；把 `local`／`private` 改為更嚴格的 `cloud` 不需確認。
6. 只有 `cloud` 需要經過 Gate。綁在本地模型的 Operator 不做別名化，但仍寫入 Ledger（`route: 'local'`）。

### 3. 偵測：規則層 + 語意層

7. **規則層**（`packages/privacy/detectors`，純函式、可單元測試）：regex 加檢查碼，涵蓋中華民國身分證與居留證、統一編號、健保卡號、信用卡（Luhn）、IBAN、銀行帳號格式、台灣與國際電話、email、URL 中的 token 參數、常見 API key／JWT／私鑰格式、IP、精確座標。
8. **語意層**：以 Privacy Agent 的模型綁定，對新增文字做 JSON schema 限制輸出的實體標註（人名、組織、地址、健康、財務、公司機密等，類別見 [ADR-0016](0016-privacy-policy-ledger-and-transparency.md)）。偵測請求直接由呼叫 Gate 的行程送往 Privacy Agent 的 Provider（main 注入該綁定），不經 Privacy Agent 行程，避免它成為瓶頸。
9. 兩層結果**取聯集**，寧可多遮。規則層命中的值一定處理，語意層無法推翻。
10. **Fail-closed**：語意層 Provider 無法連線或逾時，Gate 拒絕送出，當前 Task 轉 `input-required`（`privacy_confirm`，`reason: 'detector_unavailable'`）並發通知。使用者可逐任務授權「本任務只用規則層去敏後送出」，授權寫入 Ledger，不跨任務沿用。

### 4. 別名化

11. **資料最小化優先**：Privacy Agent 派發任務時先判斷每個敏感值是否真的需要送出（[ADR-0005](0005-privacy-agent-and-task-dispatch.md)）。不需要的直接移除或泛化（生日改為年齡區間、精確地址改為城市），需要的才別名化。Gate 處理 Operator 自行取得的工具輸出時，無法得知是否需要，因此一律別名化，不刪除。
12. **格式**：帶標記的型別化別名 `⟦TYPE_n⟧`，例如 `⟦PERSON_1⟧`、`⟦ORG_2⟧`、`⟦EMAIL_1⟧`。`TYPE` 取自固定的英文列舉（ASCII 在翻譯與改寫中最容易被保留），`n` 在同一個 privacy scope 內遞增。`⟦⟧`（U+27E6／U+27E7）幾乎不會出現在一般文字中，還原因此是精確的字串替換，不會誤換原文。
13. 政策為 `block` 的類別改寫為不可還原的 `⟦REDACTED:<category>⟧`，Vault 不保存對應。
14. **保留指令**：Gate 在 system prompt 前加上固定段落，說明別名語意並要求原樣保留（不翻譯、不去括號、不改序號、不猜測真值）。
15. **回應驗證**：雲端回應進來後，Gate 找出所有類似別名的片段。
    - 完整且存在於 Vault：通過。
    - 被改寫（去掉括號、全形半形互換、`TYPE` 被翻譯、大小寫改變）：以 Vault 清單做確定性修復。
    - 無法修復或出現 Vault 沒有的別名：先以一則更正訊息要求模型重寫一次，仍失敗就把該輪視為 `tool_error`（工具呼叫）或回報失敗（最終文字），不猜測。

### 5. 還原與外送規則

16. 還原發生在**本機工具邊界**：Operator 的工具參數含別名時，在工具執行前向 Vault 還原真值。工具輸出以真值進入本機歷程（SQLite `messages`），下一次送往雲端時由 Gate 重新別名化。雲端模型永遠只看到別名；本機歷程與 UI 顯示真值。
17. **預設允許還原**（填表、寫本機檔、在同一網域操作都不打擾），唯一例外是「外送型參數」：還原後的值會被送往**本 Task 尚未出現過的網域**時，改為 `privacy_confirm`（`reason: 'new_domain_egress'`，強制人工，見 [ADR-0010](0010-hitl-and-risk-levels.md)）。
    - 外送型工具：`browser_navigate` 的 URL、`browser_type`／`browser_click` 所在頁面的網域、MCP 與 skill 工具中標記為 `egress` 的參數，以及 [ADR-0018](0018-computer-use.md) 中會連網的桌面動作。
    - Task 網域集合：Task 內使用者輸入提到的網域、Operator 已導航過的網域，以及使用者核准過的網域；集合存於該 Task 的 privacy scope。
    - 寄信、發訊息、付款本來就是 `high` 風險，仍依 ADR-0010 強制人工。

### 6. Vault

18. **privacy scope**：Vault 以 scope 為單位，同一 scope 內同一個值永遠對應同一個別名，不同 scope 的別名互不相關，雲端因此難以跨任務拼出個人畫像。
    - 使用者對 Privacy Agent 發起的每條 Thread 是一個 scope（`scopeId = contextId`）。
    - 委派出去的 Planner／Operator Task Thread **繼承**發起端的 scope（A2A message metadata `arlo.privacyScope`），別名在整個任務樹中才能一致。
    - 使用者直接在 Operator 使用者 Thread 介入時，使用該 Thread 自己的 scope（`user:<personaId>`）。
19. 儲存：main SQLite `privacy_vault`，值以 `safeStorage` 加密；Agent 行程只能經 `privacy/vault.*` 服務，按自己被授權的 scope 別名化與還原（broker 依 port 與 Task 關聯驗證 scope）。保留期與 `messages` 相同（預設 90 天），Thread 刪除時一併刪除。

### 7. 圖片

20. Gate 對 input 中的圖片（`browser_screenshot`、captcha 截圖、Phase 2 的桌面截圖）先做本地 OCR：P1 以 tesseract.js（WASM）為跨平台基線，macOS Vision 與 Windows.Media.Ocr 作為可選加速。OCR 文字以同一組偵測器處理，敏感區塊塗黑並在區塊上繪製別名標籤。圖片尺寸與座標不變，點擊不受影響。OCR 無法執行時一樣 fail-closed。

## 程式結構

- `packages/privacy`（純 Node，不依賴 Electron）：`detectors/`（規則層）、`semantic/`（語意層請求與 schema）、`alias/`（編碼、保留指令、回應驗證與修復）、`gate/`（`sanitizeInput`、`restoreOutput`、hash 快取，與 SDK 無關的純邏輯）、`egress/`（網域集合與外送判斷）、`image/`（OCR 介面與塗黑）。
- `packages/agent-runtime`：`GuardedModel` 只負責把 SDK `Model` 的請求與回應接到 `packages/privacy/gate`；工具包裝器在工具執行前呼叫還原與 egress 判斷。
- `apps/desktop/src/main/privacy/`：Vault 與 Ledger 服務（`privacy/vault.*`、`privacy/ledger.*`）。

## 考慮過的替代方案

- **A2A／工具邊界過濾**：要逐一包裝，新工具容易漏。
- **只在 main broker 過濾**：看不到 Operator 行程內的工具輸出。
- **不可逆遮罩**：Operator 無法代為填表或寄信。
- **擬真替身值**：可能與真實資料撞名，還原不可靠。
- **依來源綁定目的地／每次還原都確認**：比「只擋外送型參數」多很多摩擦，使用者選擇較順暢的規則。
- **全域一致別名**：雲端可長期累積畫像。

## 後果

- 每個送往雲端的請求多一次本地偵測延遲；hash 快取讓穩態延遲只與新增內容成正比。
- 規則層偵測器是安全邊界的核心，需有以繁中與英文語料組成的回歸測試集（[ADR-0014](0014-testing-ci-packaging.md)）。
- 預設允許還原是刻意的取捨：同網域或本機動作仍可能被 prompt injection 濫用（例如把真值填進同網站的公開欄位）。已知並接受，靠 Ledger 事後追查。
- Privacy Agent 綁雲端時，原始資料會送達該 Provider；這是使用者接受警告後的選擇，Gate 對其他雲端 Agent 仍有效。

## 關聯

[ADR-0003](0003-agent-sdk-and-model-providers.md) Provider 與 trustZone、[ADR-0005](0005-privacy-agent-and-task-dispatch.md) Privacy Agent、[ADR-0010](0010-hitl-and-risk-levels.md) HITL、[ADR-0011](0011-persistence-secrets-observability.md) 持久化、[ADR-0016](0016-privacy-policy-ledger-and-transparency.md) 政策與 Ledger。
