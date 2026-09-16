# @arlo/a2a-transport

A2A JSON-RPC over MessagePorts, with main as the broker (T05, ADR-0004). Pure Node: tests use
`node:worker_threads` MessageChannels, and the desktop app adapts Electron ports to `PortEndpoint`.

It uses `@a2a-js/sdk` 1.1.0 and its native A2A v1.0 methods: `SendMessage`,
`SendStreamingMessage`, `SubscribeToTask`, `CancelTask`, `GetTask`. The names in ADR-0004 and
ADR-0005 (`message/send`, `message/stream`, `tasks/resubscribe`, `tasks/cancel`) are the v0.3
equivalents.

| Module             | Contents                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `agent-channel.ts` | `AgentChannel`: the Agent side of its one port. It splits A2A traffic, service calls, and control. |
| `server.ts`        | `MessagePortA2AServer`: SDK `JsonRpcTransportHandler` over a port; `callerOf(context)`             |
| `client.ts`        | `createMessagePortFetch`, `createA2AClient`: the SDK client with a port-backed `fetchImpl`         |
| `broker.ts`        | `A2ABroker`: routing policy, Agent Card registry, service dispatch, system-origin clients          |
| `task-state.ts`    | A2A v1.0 task state → Arlo task state, HITL payload extraction, `summarizeTaskJson`                |
| `errors.ts`        | Broker error codes (`-32050` + `data.reason`), `jsonRpcErrorOf`, `ServiceError`                    |
| `port.ts`          | `PortEndpoint` and the Node MessagePort adapter                                                    |

```text
Agent process                        main                                   Agent process
SDK Client ─ fetchImpl ─ AgentChannel ═ port ═ A2ABroker ═ port ═ AgentChannel ─ MessagePortA2AServer ─ DefaultRequestHandler
                         (a2a-request)          route + check     (stream-event … stream-end)
```

## Guarantees (locked by tests)

- Star topology: the Orchestrator talks to Personas, and Personas talk only to the Orchestrator.
  `system:user`, `system:schedule`, and `system:event` can reach any Agent. Any other route gets
  the forbidden-route error.
- The broker drops envelopes whose `from` is not the Agent that owns the port. It also drops
  response frames that do not match a request in flight from that requester to that Agent.
- When an Agent's port closes, waiting callers get `agent_disconnected`: an error response for
  unary calls, or an error event plus `stream-end` for streams. A call to an Agent that is not
  attached gets `agent_unavailable`.
- The client only sends to `arlo://agents/<agentId>`, and the card must name that same Agent.
- When a caller aborts, it stops reading. The target keeps draining the stream, because the SDK
  writes Task updates to the TaskStore while it consumes the stream.
- Service calls are checked against `agentServiceContract` on both sides. Handlers receive the
  port's `agentId`. Unexpected exceptions reach the Agent only as a generic error.
