# ADR-0013：多模態語音輸入

- 狀態：Accepted
- 日期：2026-09-15
- 適用階段：Phase 3

## 背景

規格第 14 點要求音訊檔案上傳（STT 轉錄）與即時語音串流輸入，串流能力依 Provider 是否支援原生全雙工 API 動態啟用。

## 決策

1. **語音是輸入法，不是獨立 Agent**。語音轉出的文字送進目標 Agent（Orchestrator 或某個 Persona）目前 Thread 的輸入框，由使用者確認後送出，或在「免手動確認」模式下直接送出。工具執行仍由文字 Agent 在 utilityProcess 內完成。
2. **即時串流**：
   - Renderer 使用 `@openai/agents-realtime` 的 `RealtimeSession` + `OpenAIRealtimeWebRTC`，直接從麥克風連 OpenAI Realtime API，只啟用 transcription（`RealtimeAgent` 不掛工具）。
   - 金鑰不進 renderer：main 以 API key 向 `/v1/realtime/client_secrets` 換 **ephemeral client secret**，經 IPC 給 renderer；secret 有效期短且每次連線重新申請。
   - 啟用條件：目標 Agent 的 Provider `capabilities.realtime === true`（v1 即 `apiType === 'openai'`）。否則 UI 隱藏串流按鈕，只留檔案上傳。
   - 也提供對講機模式（push-to-talk）與 VAD 自動分段兩種。
3. **檔案上傳 STT**：renderer 選檔 → 經 IPC 把檔案路徑給 main → main 以 Provider 的 `audio/transcriptions` API（`gpt-4o-transcribe` 或 `whisper-1`，可設）轉錄 → 文字回填輸入框。OpenAI 與 Azure OpenAI 都支援；OpenAI 相容端點若有 `capabilities.transcription` 亦可。檔案大小上限依 API（25 MB），超過時 main 以 ffmpeg（可選依賴）切段。
4. 轉錄結果附 `source: 'voice'` 標記存入訊息 metadata，面板顯示麥克風圖示。

## 考慮過的替代方案

- **語音直接驅動 RealtimeAgent 執行工具**：可語音對話並由 Realtime 模型呼叫工具；但工具在 utilityProcess，需多一層代理，且與文字 Agent 的歷程分叉。
- **v1 只做檔案 STT**：範圍最小；串流列為同階段是因為 SDK 已提供現成 WebRTC 傳輸，成本低。

## 後果

- WebRTC 在 Electron renderer 需要麥克風權限；macOS 需在 Info.plist 宣告 `NSMicrophoneUsageDescription` 並在打包時處理 entitlements。
- Azure OpenAI Realtime 目前 API 形狀不同，v1 不啟用；schema 的 `capabilities.realtime` 可覆寫供進階使用者實驗。

## 關聯

[ADR-0003](0003-agent-sdk-and-model-providers.md) Provider、[ADR-0011](0011-persistence-secrets-observability.md) 機密。
