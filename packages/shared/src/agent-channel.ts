import { z } from 'zod';
import { a2aEnvelopeSchema } from './a2a.js';
import type { MethodContracts } from './contract.js';
import { agentIdSchema } from './ids.js';
import { jsonObjectSchema, jsonValueSchema, opaqueIdSchema } from './json.js';
import { jsonRpcErrorSchema } from './jsonrpc.js';
import { modelBindingSchema, providerProfileSchema } from './provider.js';

const requestIdSchema = z.string().min(1).max(128);
const emptyParamsSchema = z.strictObject({});

/**
 * Services an Agent process may call on main over its MessagePort (ADR-0011
 * §2: Agents never open the database). Main scopes every call to the Agent
 * that owns the port, so params never name an agent; strict objects reject
 * one if a caller tries. SDK-owned shapes (session items, A2A Tasks, trace
 * spans) stay opaque JSON objects here and are validated by the SDK side.
 *
 * Nothing in this contract returns a secret: Provider keys only arrive via
 * the main → Agent `provider/configure` control message.
 */
export const agentServiceContract = {
  // IpcSession, one conversation history per Thread (ADR-0009).
  'db/session.getItems': {
    params: z.strictObject({ contextId: opaqueIdSchema, limit: z.int().positive().optional() }),
    result: z.strictObject({ items: z.array(jsonObjectSchema) }),
  },
  'db/session.addItems': {
    params: z.strictObject({ contextId: opaqueIdSchema, items: z.array(jsonObjectSchema).min(1) }),
    result: z.null(),
  },
  'db/session.popItem': {
    params: z.strictObject({ contextId: opaqueIdSchema }),
    result: z.strictObject({ item: jsonObjectSchema.nullable() }),
  },
  'db/session.clear': {
    params: z.strictObject({ contextId: opaqueIdSchema }),
    result: z.null(),
  },
  // IpcTaskStore (ADR-0004 §6).
  'db/tasks.save': {
    params: z.strictObject({ task: jsonObjectSchema }),
    result: z.null(),
  },
  'db/tasks.load': {
    params: z.strictObject({ taskId: opaqueIdSchema }),
    result: z.strictObject({ task: jsonObjectSchema.nullable() }),
  },
  // Serialized SDK RunState at an interruption (ADR-0010 §3).
  'db/runStates.save': {
    params: z.strictObject({ taskId: opaqueIdSchema, state: z.string().min(1) }),
    result: z.null(),
  },
  'db/runStates.load': {
    params: z.strictObject({ taskId: opaqueIdSchema }),
    result: z.strictObject({ state: z.string().nullable() }),
  },
  'db/runStates.delete': {
    params: z.strictObject({ taskId: opaqueIdSchema }),
    result: z.null(),
  },
  // IpcTraceExporter (ADR-0011 §9).
  'trace/spans.export': {
    params: z.strictObject({ spans: z.array(jsonObjectSchema).min(1) }),
    result: z.null(),
  },
  // Agent Card registry, re-read after `registry/updated` (ADR-0005 §1).
  'registry/list': {
    params: emptyParamsSchema,
    result: z.strictObject({
      cards: z.array(z.strictObject({ agentId: agentIdSchema, card: jsonObjectSchema })),
    }),
  },
} as const satisfies MethodContracts;

export type AgentServiceMethod = keyof typeof agentServiceContract;

export const serviceRequestSchema = z.strictObject({
  kind: z.literal('service-request'),
  requestId: requestIdSchema,
  method: z.string().min(1),
  params: jsonValueSchema,
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

export const serviceResponseSchema = z.union([
  z.strictObject({
    kind: z.literal('service-response'),
    requestId: requestIdSchema,
    result: jsonValueSchema,
  }),
  z.strictObject({
    kind: z.literal('service-response'),
    requestId: requestIdSchema,
    error: jsonRpcErrorSchema,
  }),
]);
export type ServiceResponse = z.infer<typeof serviceResponseSchema>;

/** Main → Agent only. Never accepted from an Agent, never forwarded to a renderer. */
export const controlMessageSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      kind: z.literal('control'),
      type: z.literal('provider/configure'),
      binding: modelBindingSchema,
      profile: providerProfileSchema,
      apiKey: z.string().min(1),
    })
    .refine((message) => message.binding.providerId === message.profile.id, {
      path: ['binding', 'providerId'],
      message: 'binding.providerId must match profile.id.',
    }),
  z.strictObject({ kind: z.literal('control'), type: z.literal('registry/updated') }),
]);
export type ControlMessage = z.infer<typeof controlMessageSchema>;

export const agentToMainMessageSchema = z.union([a2aEnvelopeSchema, serviceRequestSchema]);
export type AgentToMainMessage = z.infer<typeof agentToMainMessageSchema>;

export const mainToAgentMessageSchema = z.union([
  a2aEnvelopeSchema,
  serviceResponseSchema,
  controlMessageSchema,
]);
export type MainToAgentMessage = z.infer<typeof mainToAgentMessageSchema>;
