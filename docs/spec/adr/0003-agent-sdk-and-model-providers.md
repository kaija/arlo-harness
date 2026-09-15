# ADR-0003：Agent SDK 與 Model Provider 配置

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 1

## 背景

規格第 11 點指定 Agent 核心採用 OpenAI Agents SDK（JavaScript/TypeScript）。規格第 7 點要求全域與局部的 LLM 連線設定（API Base URL、API Type、API Key），且 Orchestrator 與各 Persona 可各自綁定模型端點與型號。

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
     capabilities: { realtime: boolean; transcription: boolean }; // 由 apiType 推導，可覆寫
   }
   interface ModelBinding { providerId: string; model: string; settings?: ModelSettings }
   ```
   全域設定含 `defaultBinding`；Orchestrator 與每個 Persona 各有可選的 `modelBinding` 覆寫。未覆寫則繼承全域。
4. **注入方式**：Agent 行程不讀設定檔；main 在 spawn 與設定變更時把已解密的 `ProviderProfile + apiKey` 以 MessagePort 訊息推送，agent-runtime 據此建立 `ModelProvider` 並 `setDefaultModelProvider`。設定變更即時生效於下一個 Run。
5. **Realtime 語音**只在目標 Agent 的 Provider `capabilities.realtime === true`（v1 即 `apiType === 'openai'`）時於 UI 啟用，詳見 [ADR-0013](0013-voice-input.md)。

## 考慮過的替代方案

- **v1 就納入 aisdk adapter**：可讓 Orchestrator 用 Claude，但多一層依賴且 adapter 的 tool calling 行為需另行驗證。延後。
- **只支援官方 OpenAI**：違反規格第 7 點。否決。

## 後果

- OpenAI 相容端點走 Chat Completions，不支援 Responses 專屬功能（hosted tools、內建 web search）。文件需明示。
- Provider 抽象集中在 agent-runtime 的 `createModelProvider(profile)`，新增 apiType 只需擴充該處與 schema。

## 關聯

[ADR-0011](0011-persistence-secrets-observability.md) 機密儲存、[ADR-0013](0013-voice-input.md) 語音輸入。
