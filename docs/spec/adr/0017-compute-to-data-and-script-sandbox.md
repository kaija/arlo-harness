# ADR-0017：Compute-to-data 與腳本沙箱

- 狀態：Accepted
- 日期：2026-09-25
- 修訂：2026-09-26：dataset 限表格格式；雲端腳本不得帶敏感參數，改由本地 compute；outputSpec 結構性強制（設計缺口盤問 2、2b、3、6）
- 適用階段：Phase 1

## 背景

結構化或大量的使用者資料（報表、帳務、名單、log）不適合逐值別名化後整份送上雲：量太大，而且每一列都是個資。改為「資料不動、程式移動」：只把 schema 交給雲端 Operator，由它寫處理腳本，Privacy 端在本機沙箱中對真實資料執行，結果再回給使用者。

威脅模型（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）把「Operator 產生的惡意或錯誤腳本」列在範圍內：腳本可能連網外傳、刪檔，或把原始資料印出後流回雲端。

## 決策

### 何時使用

1. 觸發依**資料型態與政策類別**：
   - `dataset` 類別**只涵蓋表格或紀錄格式**：CSV、TSV、XLSX、JSON、JSONL、SQLite、Parquet、每行一筆的 log。判定依確定性的格式解析，不看列數。
   - 政策為 `schema_only` 的類別強制走此路徑（[ADR-0016](0016-privacy-policy-ledger-and-transparency.md)）。
   - 非結構化內容（郵件匯出、Word／PDF 文件、對話匯出）不論多大，都走 R1 別名化；量大時分批處理，見 [ADR-0005](0005-privacy-agent-and-task-dispatch.md) 第 4 點。
   SLM Flow 以此規則決定；LLM Flow 以此為預設，可自行判斷改走其他 route，選擇寫入 Ledger。

### Schema 交付

2. Schema 由 `packages/privacy/dataset` 以**確定性解析器**在本機抽取，不經 LLM：
   - 檔名（別名化）、欄位名（經 Gate，敏感欄位名同樣別名化）、推斷型別；
   - 空值比例、值的格式樣式（例如 `A123456789` 描述為「1 大寫字母 + 9 位數字」）；
   - 列數，以級距表示（`1k–10k`）；
   - 本地生成的**合成樣本列**：格式相符的假值，不含任何真實值。
3. 描述物件（`DatasetDescriptor`）送出前仍經過 Gate，作為第二道防線。

### 腳本提交與執行

4. Operator 或 Planner 以工具 `submit_compute_script({ language, code, inputs, outputSpec })` 提交腳本，`inputs` 使用資料集別名。
   - **雲端撰寫的腳本不接受敏感參數**：`code` 與 `outputSpec` 若含 Vault 別名（`⟦TYPE_n⟧`），或 `code` 內嵌規則層會命中的字面值，提交即被拒絕並回報原因，不會在本機還原。
   - 需要以敏感值為參數的計算（例如以新案件關係人姓名比對客戶資料庫），改走第 13 點的本地 compute。執行者是 Privacy 端：main 的 `sandbox/*` 服務啟動沙箱行程，Agent 行程不直接接觸真實資料檔。
5. **語言**：
   - **託管 Python**：首次啟用 compute-to-data 時，以 `uv` 在 `<userData>/runtimes/python` 建立固定版本的 Python 與預裝套件（pandas、numpy、openpyxl、pyarrow、matplotlib）。這是首選語言。
   - **JavaScript**：使用 Electron 內建 Node（`ELECTRON_RUN_AS_NODE=1`），永遠可用。
   - 不開放 shell。沙箱內斷網，執行時不能安裝套件；缺少的套件回報為錯誤，由 Operator 改寫腳本。
6. **沙箱（參考 Codex 的 OS 原生沙箱）**：以 OS 機制包裝整個腳本行程，而不是限制語言：
   - macOS：Seatbelt（`sandbox-exec` 設定檔）；
   - Linux：bubblewrap + Landlock + seccomp；
   - Windows：restricted token + ACL（參照 Codex Windows sandbox 的做法）。

   共同政策：
   - 輸入檔複製到 `<userData>/sandbox-runs/<runId>/in`，唯讀；
   - 只能寫入 `<runId>/out`；
   - 無網路；
   - 清空環境變數，HOME 指向 run 目錄；
   - 預設 CPU 時間 120 秒、記憶體 2 GB、輸出總量 50 MB，可在設定調整。
7. **降級**：啟動時對 native 沙箱做自我檢查，例如 Linux 未安裝 bwrap 或 user namespace 被停用時，改用 **Pyodide（WASM Python）** 執行：它天生無網路，只掛載 in／out 目錄，時間與記憶體受 worker 限制。降級期間只接受 Python 腳本，JavaScript 腳本回報錯誤並請 Operator 改寫。設定頁顯示目前的沙箱後端與補裝說明。
8. **靜態檢查**（執行前，由程式碼強制，非 LLM）：
   - Python 以 AST 檢查 import 白名單（在沙箱內先跑檢查器）；
   - JavaScript 以 acorn 檢查，禁止 `child_process`、`net`、`http(s)`、`dgram`、`worker_threads`、`vm`、動態 `import()`／`require` 字串拼接。
   不通過就不執行，回報原因給提交者。
9. **不需人工審核**：隔離由沙箱與靜態檢查在程式碼層強制，因此預設自動執行；腳本全文記入 Ledger 與 `sandbox_runs`，可事後檢視。例外：腳本輸出要**寫回使用者原始檔案**時（預設只寫到 `out`，另存到 workdir），屬 `high` 風險，強制人工確認（[ADR-0010](0010-hitl-and-risk-levels.md)）。

### 結果去向

10. **預設給使用者**：Privacy Agent 讀取 `out`，以本地模型或模板組成回覆，還原別名後呈現；圖表或檔案作為附件。
11. **回給 Operator 需經 Gate**：任務需要 Operator 繼續推理時（例如依統計結果寫報告、依錯誤修正腳本），`out` 的內容與 stderr 都經過 Gate，並套用：
    - **列數上限**：預設 50 列，超過就只給使用者，Operator 只收到結構摘要；
    - **只有宣告過的輸出能回 Operator**：`outputSpec` 逐檔宣告 `kind`：
      - `aggregate`：必須標出計數欄位，小格抑制強制套用，計數小於 k（預設 5）的分組以 `<k` 取代；
      - `rows`：受列數上限限制，逐值經 Gate；
      - `chart`：圖檔經 Gate 的圖片處理。

      未宣告的檔案，或內容不符宣告（例如宣告 `aggregate` 卻沒有計數欄、欄位型別不符）的檔案，一律只給使用者，Operator 只收到「某檔案未回傳，原因」。這是結構性的強制，不靠猜測哪一欄是計數；
    - Traceback 同樣經 Gate，錯誤訊息中常會帶出資料值。
12. 失敗重試由 Operator 主導，每個 Task 預設最多 5 次，超過則轉 `failed`。

### 本地 compute（R3 的子模式）

13. 需要以真實敏感值為參數的計算，由 Privacy 端**自己**產生程式，全程不外送：
    - **LLM Flow**：工具 `compute_local({ language, code, inputs, params, outputSpec })`，由 Privacy Agent 的模型撰寫腳本，`params` 可含真值。腳本在同一個沙箱中以同樣的政策執行，也做相同的靜態檢查。
    - **SLM Flow**：本地 SLM 不寫任意程式，改呼叫內建的**確定性資料工具**（`packages/privacy/local-ops`）。工具以固定程式實作，參數由 SLM 以 JSON schema 填入：
      - `match_names`：精確比對與模糊比對，涵蓋同音字、全半形、公司簡稱與常見後綴（股份有限公司、Inc.）、姓名順序；
      - `filter_rows`、`count_by`、`join`、`dedupe`。
      工具在同一沙箱中執行。
    - 輸出只給使用者與 Privacy Agent，不經任何雲端 Agent；需要雲端後續處理時，照一般 route 由 Privacy Agent 重新決定（例如把彙總結果以 R1 交出）。
    - 典型情境：利益衝突檢查、以病患名單篩選資料、以特定帳號過濾交易紀錄。

## 程式結構

- `packages/privacy/dataset`：解析器、`DatasetDescriptor`、合成樣本。
- `packages/privacy/local-ops`：SLM Flow 用的確定性資料工具（名稱比對、篩選、計數、join、去重）。
- `packages/sandbox`（純 Node，不依賴 Electron）：`SandboxRunner` 介面與後端 `seatbelt`、`linux-bwrap`、`windows-restricted`、`pyodide`；`runtimes/`（uv 託管 Python、Electron Node 路徑解析）；`static-check/`。後端自我檢查與選擇在 `selectBackend()`。
- `apps/desktop/src/main/sandbox/`：`sandbox/*` 服務、run 目錄管理與 `sandbox_runs` 落庫。

## 考慮過的替代方案

- **只用 Pyodide**：跨平台一致，但效能與套件受限；改為 native 沙箱的降級選項。
- **完全照 Codex：任何直譯器 + shell**：執行環境因人而異、攻擊面大，一般使用者的電腦也多半沒裝 Python。
- **Docker／VM**：隔離最強，但要求使用者安裝。
- **每次人工審核腳本**：多數使用者看不懂腳本，審核流於形式。
- **本地模型審查腳本**：SLM 審程式碼不可靠，只會給人虛假的安全感。
- **雲端腳本的參數在沙箱前還原**：能力最完整，但會讓雲端撰寫的程式直接處理指定的敏感值；使用者選擇把這類計算留在本地。
- **啟發式偵測計數欄位**：對 Operator 較寬鬆，但會漏判也會誤判；改為以 `outputSpec` 結構性強制。

## 後果

- 三個平台各一套 native 沙箱，需要在 CI 各自跑逃逸測試（[ADR-0014](0014-testing-ci-packaging.md)）；Windows 後端參考 Codex，實作成本最高。
- 託管 Python 首次啟用需要下載（約百 MB 等級），設定頁要有進度與離線說明。
- 合成樣本讓 Operator 能寫出正確腳本，但對格式特殊的資料仍可能多輪重試。

## 關聯

[ADR-0005](0005-privacy-agent-and-task-dispatch.md) Privacy Agent、[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) Gate、[ADR-0016](0016-privacy-policy-ledger-and-transparency.md) 政策。
