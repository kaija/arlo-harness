# @arlo/shared

Cross-process data contracts (T02). Pure Node: no `electron` dependency. Every type has a
[zod](https://zod.dev) schema for checking values at runtime, and every value is plain JSON, so
it can cross a MessagePort and be stored in SQLite.

| Module             | Contents                                                                                          | ADR              |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------- |
| `ids.ts`           | `PersonaId` rules, `AgentId` (`orchestrator` \| `persona:<id>`)                                   | 0002, 0004       |
| `jsonrpc.ts`       | JSON-RPC 2.0 framing, error codes, forbidden-route error                                          | 0004             |
| `a2a.ts`           | A2A envelope, system origins, port-origin check, task states                                      | 0004, 0009       |
| `agent-channel.ts` | Agent ↔ main messages: `agentServiceContract` (`db/*`, `trace/*`, `registry/*`), control messages | 0002, 0003, 0011 |
| `renderer-api.ts`  | Renderer → main `rendererInvokeContract` whitelist and main → renderer `state/*` events           | 0007, 0009, 0011 |
| `contract.ts`      | `validateCall` / `parseResult` for either contract                                                | —                |
| `interrupt.ts`     | `InterruptPayload`, answers, who may answer                                                       | 0010             |
| `tool-risk.ts`     | `RiskLevel`, built-in tool default table, `resolveToolRiskLevel`                                  | 0010             |
| `provider.ts`      | `ProviderProfile`, `ModelBinding`                                                                 | 0003             |
| `events.ts`        | Main event bus events, notification severities, chain-depth limit                                 | 0012             |

## Security invariants (locked by tests)

- The Agent and renderer APIs are separate contracts that share no method names. The renderer
  cannot call `db/*`, cannot send A2A envelopes, and has no channel that returns a secret.
- A Provider key only travels in the main → Agent `provider/configure` control message.
- Agent service params never name an agent. Main scopes each call to the agent that owns the
  port.
- An envelope from an Agent port must set `from` to that port's agent. `system:*` origins are
  created only inside main.
- The answering side of an interrupt is stamped by main. Orchestrator answers are rejected for
  high-risk approvals, `auth_required`, and `captcha`.
- Changing any built-in tool's default risk level makes a test fail.

## Test

```sh
pnpm test
```

Tests live in `test/`. `test/fixtures.ts` has one valid sample for every method, channel, event
type, and envelope kind. The tests require the set to be complete.
