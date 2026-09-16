import { z } from 'zod';
import { agentIdSchema } from './ids.js';
import { awaitingInterruptPayloadSchema } from './interrupt.js';
import { isoDateTimeSchema, jsonValueSchema, opaqueIdSchema } from './json.js';

export const NOTIFICATION_SEVERITIES = [
  'info',
  'success',
  'warning',
  'error',
  'action_required',
] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);

/** ADR-0012 §8: an event may trigger at most this many follow-up hops. */
export const MAX_EVENT_CHAIN_DEPTH = 5;
/** ADR-0002 §4: restarts back off 1s, 5s, 30s and then give up. */
export const MAX_AGENT_RESTARTS = 3;

const restartAttemptSchema = z.int().min(0).max(MAX_AGENT_RESTARTS);

const taskRef = {
  agentId: agentIdSchema,
  taskId: opaqueIdSchema,
  contextId: opaqueIdSchema,
};

function busEvent<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    type: z.literal(type),
    id: opaqueIdSchema,
    occurredAt: isoDateTimeSchema,
    /** 0 for a root event; each trigger-started follow-up adds one. */
    chainDepth: z.int().min(0).max(MAX_EVENT_CHAIN_DEPTH),
    causedBy: opaqueIdSchema.optional(),
    payload,
  });
}

/**
 * Main-process event bus (ADR-0012 §7). `persona.*` events use `agentId` so
 * the Orchestrator's own start and crash are reported the same way.
 */
export const busEventSchema = z.discriminatedUnion('type', [
  busEvent('task.completed', z.strictObject(taskRef)),
  busEvent('task.failed', z.strictObject({ ...taskRef, error: z.string() })),
  busEvent(
    'task.input_required',
    z.strictObject({ ...taskRef, interrupt: awaitingInterruptPayloadSchema }),
  ),
  busEvent(
    'persona.started',
    z.strictObject({ agentId: agentIdSchema, restartAttempt: restartAttemptSchema }),
  ),
  busEvent(
    'persona.crashed',
    z.strictObject({
      agentId: agentIdSchema,
      exitCode: z.int().nullable(),
      restartAttempt: restartAttemptSchema,
      willRestart: z.boolean(),
    }),
  ),
  busEvent(
    'notification.created',
    z.strictObject({
      notificationId: opaqueIdSchema,
      severity: notificationSeveritySchema,
      source: z.union([agentIdSchema, z.literal('system')]),
      title: z.string().min(1),
    }),
  ),
  busEvent(
    'schedule.fired',
    z.strictObject({
      scheduleId: opaqueIdSchema,
      runId: opaqueIdSchema,
      agentId: agentIdSchema,
      contextId: opaqueIdSchema,
    }),
  ),
  busEvent('webhook.received', z.strictObject({ agentId: agentIdSchema, body: jsonValueSchema })),
]);

export type BusEvent = z.infer<typeof busEventSchema>;
export type BusEventType = BusEvent['type'];
export type BusEventOf<T extends BusEventType> = Extract<BusEvent, { type: T }>;

export const BUS_EVENT_TYPES: readonly BusEventType[] = Object.freeze(
  busEventSchema.options.map((option) => option.shape.type.value),
);
