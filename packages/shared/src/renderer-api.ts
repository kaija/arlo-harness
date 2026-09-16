import { z } from 'zod';
import { taskStateSchema } from './a2a.js';
import type { MethodContracts } from './contract.js';
import { agentIdSchema, personaIdSchema } from './ids.js';
import { awaitingInterruptPayloadSchema, interruptAnswerSchema } from './interrupt.js';
import { isoDateTimeSchema, opaqueIdSchema } from './json.js';

const secretRefSchema = z.string().min(1).max(128);

/** What the UI may know about a stored secret (ADR-0011 §7): never the value. */
export const secretMetadataSchema = z.strictObject({
  ref: secretRefSchema,
  last4: z.string().max(4),
  updatedAt: isoDateTimeSchema,
});
export type SecretMetadata = z.infer<typeof secretMetadataSchema>;

/**
 * Renderer → main `invoke` whitelist, deliberately separate from
 * `agentServiceContract`: the renderer cannot reach `db/*`, cannot send A2A
 * envelopes, and has no way to read a secret back. Answers submitted here are
 * always recorded with responder `user`. T20 extends this list.
 */
export const rendererInvokeContract = {
  'personas/setEnabled': {
    params: z.strictObject({ personaId: personaIdSchema, enabled: z.boolean() }),
    result: z.null(),
  },
  'personas/delete': {
    params: z.strictObject({ personaId: personaIdSchema }),
    result: z.null(),
  },
  // ADR-0009 §9: "send" waits for the reply; "dispatch as task" returns at once.
  'messages/send': {
    params: z.strictObject({
      agentId: agentIdSchema,
      contextId: opaqueIdSchema,
      text: z.string().min(1),
      mode: z.enum(['sync', 'async']),
    }),
    result: z.strictObject({ taskId: opaqueIdSchema, contextId: opaqueIdSchema }),
  },
  'tasks/cancel': {
    params: z.strictObject({ agentId: agentIdSchema, taskId: opaqueIdSchema }),
    result: z.null(),
  },
  'interrupts/answer': {
    params: z.strictObject({
      agentId: agentIdSchema,
      taskId: opaqueIdSchema,
      answer: interruptAnswerSchema,
    }),
    result: z.null(),
  },
  'secrets/set': {
    params: z.strictObject({ ref: secretRefSchema, value: z.string().min(1) }),
    result: secretMetadataSchema,
  },
  'secrets/list': {
    params: z.strictObject({}),
    result: z.strictObject({ secrets: z.array(secretMetadataSchema) }),
  },
  'secrets/delete': {
    params: z.strictObject({ ref: secretRefSchema }),
    result: z.null(),
  },
  // ADR-0007 §3: switching view is show() + focus() on the Persona window.
  'windows/showPersona': {
    params: z.strictObject({ personaId: personaIdSchema }),
    result: z.null(),
  },
} as const satisfies MethodContracts;

export type RendererInvokeChannel = keyof typeof rendererInvokeContract;

export const AGENT_STATUSES = ['starting', 'running', 'restarting', 'crashed', 'stopped'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Main → renderer `state/*` pushes (ADR-0011 §2). */
export const rendererEventContract = {
  'state/agentStatus': z.strictObject({
    agentId: agentIdSchema,
    status: z.enum(AGENT_STATUSES),
  }),
  'state/task': z
    .strictObject({
      agentId: agentIdSchema,
      taskId: opaqueIdSchema,
      contextId: opaqueIdSchema,
      state: taskStateSchema,
      interrupt: awaitingInterruptPayloadSchema.optional(),
      updatedAt: isoDateTimeSchema,
    })
    .refine((event) => (event.state === 'input-required') === (event.interrupt !== undefined), {
      path: ['interrupt'],
      message: 'interrupt is required for, and only allowed with, state "input-required".',
    }),
} as const satisfies Readonly<Record<string, z.ZodType>>;

export type RendererEventChannel = keyof typeof rendererEventContract;
export type RendererEventPayload<C extends RendererEventChannel> = z.output<
  (typeof rendererEventContract)[C]
>;

export function parseRendererEvent<C extends RendererEventChannel>(
  channel: C,
  payload: unknown,
): RendererEventPayload<C> {
  return rendererEventContract[channel].parse(payload) as RendererEventPayload<C>;
}
