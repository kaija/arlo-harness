import { z } from 'zod';
import { agentIdSchema, isAgentId, type AgentId } from './ids.js';
import { jsonRpcRequestSchema, jsonRpcResponseSchema } from './jsonrpc.js';

/**
 * Senders that are not Agent processes. Main mints these when it starts an
 * A2A request itself: a user action from the renderer, a schedule firing, or
 * an event trigger (ADR-0009 thread sources, ADR-0012). They are never
 * accepted from an Agent MessagePort; see {@link isEnvelopeFromPort}.
 */
export const SYSTEM_ORIGINS = ['system:user', 'system:schedule', 'system:event'] as const;
export type SystemOrigin = (typeof SYSTEM_ORIGINS)[number];
export type A2AEndpoint = AgentId | SystemOrigin;

const endpointSchema = z.union([agentIdSchema, z.enum(SYSTEM_ORIGINS)]);
const requestIdSchema = z.string().min(1).max(128);

/**
 * ADR-0004 §3 envelope. Requests always target an Agent; responses and stream
 * frames always come from one. A2A method names and payload shapes are left to
 * the protocol binding chosen in `@arlo/a2a-transport`, so only the JSON-RPC
 * framing is checked here. A `stream-event` carries one JSON-RPC response per
 * SSE frame; `stream-end` closes the stream.
 */
export const a2aEnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('a2a-request'),
    requestId: requestIdSchema,
    from: endpointSchema,
    to: agentIdSchema,
    payload: jsonRpcRequestSchema,
  }),
  z.strictObject({
    kind: z.literal('a2a-response'),
    requestId: requestIdSchema,
    from: agentIdSchema,
    to: endpointSchema,
    payload: jsonRpcResponseSchema,
  }),
  z.strictObject({
    kind: z.literal('stream-event'),
    requestId: requestIdSchema,
    from: agentIdSchema,
    to: endpointSchema,
    payload: jsonRpcResponseSchema,
  }),
  z.strictObject({
    kind: z.literal('stream-end'),
    requestId: requestIdSchema,
    from: agentIdSchema,
    to: endpointSchema,
  }),
]);
export type A2AEnvelope = z.infer<typeof a2aEnvelopeSchema>;

/**
 * Agent Cards must list a `supportedInterfaces[].url`, but Agents have no HTTP
 * address: requests travel over MessagePorts (ADR-0004 §2). This URL only
 * names the target Agent so the transport can route a request to it.
 */
export const AGENT_ENDPOINT_URL_PREFIX = 'arlo://agents/';

export function agentEndpointUrl(agentId: AgentId): string {
  return `${AGENT_ENDPOINT_URL_PREFIX}${agentId}`;
}

/** Returns the Agent named by {@link agentEndpointUrl}, or `undefined` for any other URL. */
export function agentIdFromEndpointUrl(url: string): AgentId | undefined {
  if (!url.startsWith(AGENT_ENDPOINT_URL_PREFIX)) return undefined;
  const agentId = url.slice(AGENT_ENDPOINT_URL_PREFIX.length);
  return isAgentId(agentId) ? agentId : undefined;
}

/**
 * An Agent port may only speak for its own Agent. The broker checks this
 * before routing so a Persona cannot pose as the Orchestrator, and system
 * origins (never an AgentId) cannot arrive from any port.
 */
export function isEnvelopeFromPort(portAgentId: AgentId, envelope: A2AEnvelope): boolean {
  return envelope.from === portAgentId;
}

/**
 * Arlo's task states, independent of the A2A wire version (v0.3 uses
 * `input-required`, v1.0 JSON uses `TASK_STATE_INPUT_REQUIRED`). Every HITL
 * interrupt maps to `input-required` (ADR-0010).
 */
export const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'auth-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const taskStateSchema = z.enum(TASK_STATES);

const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}
