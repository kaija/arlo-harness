# ADR-0003：Agent SDK 與 Model Provider 配置

- 狀態：Accepted
- 日期：2026-09-15
- 修訂：2026-09-25：新增 `trustZone`、Privacy Agent 綁定規則、本地模型端點（盤問第 8、23、23b、24 題）
- 適用階段：Phase 1

## 背景

規格第 11 點指定 Agent 核心採用 OpenAI Agents SDK（JavaScript/TypeScript）。規格第 7 點要求全域與局部的 LLM 連線設定（API Base URL、API Type、API Key），且每個 Agent 可各自綁定模型端點與型號。2026-09-25 修訂後，Privacy Agent 要能綁定使用者選擇的自架 LLM 或 AI PC 本地 SLM，平台也要知道每個 Provider 是否「出了這台電腦／這個組織」。

## 決策

1. **Agent 執行期**：`@openai/agents`（最新穩定版）。每個 Agent 行程內建立一個 `Agent` 實例，透過 `run()` / `Runner` 執行，以 streaming 模式取得即時事件。
2. **v1 支援的 Provider 類型**（`apiType` 欄位）：
   - `openai`：官方端點，使用 `OpenAIProvider`，預設 Responses API。
   - `openai_compatible`：自訂 `baseURL` 的 OpenAI 相容端點（Ollama、vLLM、LiteLLM、OpenRouter 等）。強制 `useResponses: false`，走 Chat Completions。
   - `azure_openai`：使用 `AzureOpenAI` client（需 `endpoint`、`apiVersion`、`deployment`）。
   Anthropic / Gemini 等經 `@openai/agents-extensions` aisdk adapter 的支援列為後續擴充，schema 預留 `apiType: "aisdk"`。
3. **Provider 設定資料模型**：
   ```ts
   interface ProviderProfile {
     id: string; name: string;
     apiType: 'openai' | 'openai_compatible' | 'azure_openai';
     baseUrl?: string; apiKeyRef: string;      // apiKeyRef 指向 secrets 表
     azure?: { apiVersion: string };
     trustZone: 'local' | 'private' | 'cloud'; // 由 baseUrl 推導，規則見 ADR-0015
     structuredOutput?: 'json_schema' | 'json_mode' | 'none'; // SLM Flow 用，可在測試連線時偵測
     capabilities: { realtime: boolean; transcription: boolean }; // 由 apiType 推導，可覆寫
   }
   interface ModelBinding { providerId: string; model: string; settings?: ModelSettings }
   ```
   全域設定含 `defaultBinding`（Operator 的預設）；`planner.modelBinding` 與每個 Persona 的 `modelBinding` 可覆寫，未覆寫則繼承 `defaultBinding`。
   Privacy Agent 的綁定是獨立欄位 `privacy.modelBinding`，**不繼承** `defaultBinding`：
   - 未設定時 App 無法派發任務，首次啟動精靈會引導設定。
   - 可以綁定 `cloud` Provider，但設定頁要先顯示警告並取得確認，之後主視窗常駐警告。此時 Privacy Agent 自身的請求不經 Gate，原始資料會送達該 Provider（[ADR-0015](0015-privacy-gate-aliasing-and-vault.md)）。
   - 同一個綁定也作為 Gate 語意層偵測器的模型。
4. **本地模型端點**：不內建推論 runtime。本地與自架模型一律以 `openai_compatible` 接入，例如 Ollama、LM Studio、llama.cpp server、vLLM、Foundry Local、OpenVINO Model Server、Lemonade。NPU／GPU 加速交給各廠商 runtime。首次啟動精靈偵測常見的本機 port（11434、1234、8080、5272 等），列出可用模型供選擇。
5. **注入方式**：Agent 行程不讀設定檔；main 在 spawn 與設定變更時把已解密的 `ProviderProfile + apiKey` 以 MessagePort 訊息推送，agent-runtime 據此建立 `ModelProvider` 並 `setDefaultModelProvider`。設定變更即時生效於下一個 Run。
6. **Realtime 語音**只在目標 Agent 的 Provider `capabilities.realtime === true`（v1 即 `apiType === 'openai'`）時於 UI 啟用，並受隱私預設等級限制，詳見 [ADR-0013](0013-voice-input.md)。

## 考慮過的替代方案

- **v1 就納入 aisdk adapter**：可讓 Planner 或 Operator 用 Claude，但多一層依賴且 adapter 的 tool calling 行為需另行驗證。延後。
- **只支援官方 OpenAI**：違反規格第 7 點。否決。
- **內建 node-llama-cpp 並下載模型**：零設定，但安裝包與模型下載龐大，也用不到 NPU。否決。
- **禁止 Privacy Agent 綁雲端**：保證最強，但使用者要保留彈性，改為警告並記錄。

## 後果

- OpenAI 相容端點走 Chat Completions，不支援 Responses 專屬功能（hosted tools、內建 web search）。文件需明示。
- Provider 抽象集中在 agent-runtime 的 `createModelProvider(profile)`，新增 apiType 只需擴充該處與 schema。`trustZone === 'cloud'` 的 Provider 由 `createModelProvider` 回傳 `GuardedModel` 包裝後的模型（Privacy Agent 本身除外），讓 Gate 無法被呼叫端略過。
- 本地 SLM 對 structured output 的支援不一，SLM Flow 需同時處理 `json_schema` 與 `json_mode`。

## 關聯

[ADR-0005](0005-privacy-agent-and-task-dispatch.md) Privacy Agent、[ADR-0011](0011-persistence-secrets-observability.md) 機密儲存、[ADR-0013](0013-voice-input.md) 語音輸入、[ADR-0015](0015-privacy-gate-aliasing-and-vault.md) Gate。
