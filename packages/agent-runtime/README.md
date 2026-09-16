# @arlo/agent-runtime

OpenAI Agents SDK integration for Agent processes (T07, ADR-0003). Pure Node.

| Module            | Contents                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `provider.ts`     | `createModelProvider`, `createOpenAIClient`: one SDK provider per `ProviderProfile`            |
| `model-config.ts` | `ModelConfig`: applies `provider/configure` messages; each Run captures the current selection  |
| `runner.ts`       | `AgentRunner`: streaming run that returns completed / interrupted / canceled / failed          |
| `run-events.ts`   | `toAgentRunEvents`: SDK stream events → JSON `AgentRunEvent`s (schema in `@arlo/shared`)       |
| `testing/`        | `FakeModel` (an SDK `Model` built on `ScriptedModel`), `FakeModelProvider`, `runFakeAgentLoop` |

## Provider API types

| `apiType`           | Client                                                | API              |
| ------------------- | ----------------------------------------------------- | ---------------- |
| `openai`            | `OpenAI`, `baseUrl` optional                          | Responses        |
| `openai_compatible` | `OpenAI` with the required `baseUrl`                  | Chat Completions |
| `azure_openai`      | `AzureOpenAI`; `baseUrl` is the resource endpoint and | Chat Completions |
|                     | `binding.model` is the deployment name                |                  |

Every client option is passed explicitly, so `OPENAI_*` and `AZURE_OPENAI_*` environment
variables cannot redirect a key. Tests run these clients against a local HTTP stub, which checks
the request shape only. They do not show that a real endpoint is compatible.

## Notes

- This package depends on `@openai/agents-core` and `@openai/agents-openai`, not `@openai/agents`.
  Importing `@openai/agents` registers the OpenAI trace uploader and an environment-key default
  provider, which ADR-0011 §9 rules out.
- Each Run builds its own `Runner` with the selected provider. A `provider/configure` message that
  arrives mid-Run applies to the next Run.
- An interrupted outcome includes `RunState.toString()`. `AgentRunner.restore(agent, state)` loads
  it back so approvals can be applied and the Run resumed.
