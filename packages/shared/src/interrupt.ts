import { z } from 'zod';
import { jsonValueSchema } from './json.js';

const questionSchema = z.strictObject({
  type: z.literal('question'),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(1).optional(),
});

const toolApprovalSchema = z.strictObject({
  type: z.literal('tool_approval'),
  toolName: z.string().min(1),
  args: jsonValueSchema,
  riskLevel: z.enum(['medium', 'high']),
  rationale: z.string(),
});

const authRequiredSchema = z.strictObject({
  type: z.literal('auth_required'),
  site: z.string().min(1),
  reason: z.enum(['login', 'mfa', 'session_expired']),
});

const captchaSchema = z.strictObject({
  type: z.literal('captcha'),
  site: z.string().min(1),
  screenshotRef: z.string().min(1).optional(),
});

const toolErrorSchema = z.strictObject({
  type: z.literal('tool_error'),
  toolName: z.string().min(1),
  error: z.string(),
  retryable: z.boolean(),
});

/** ADR-0010 payload, carried as a DataPart in an `input-required` status message. */
export const interruptPayloadSchema = z.discriminatedUnion('type', [
  questionSchema,
  toolApprovalSchema,
  authRequiredSchema,
  captchaSchema,
  toolErrorSchema,
]);
export type InterruptPayload = z.infer<typeof interruptPayloadSchema>;

/** Interrupts that pause the Task for an answer; `tool_error` only reports and never waits. */
export const awaitingInterruptPayloadSchema = z.discriminatedUnion('type', [
  questionSchema,
  toolApprovalSchema,
  authRequiredSchema,
  captchaSchema,
]);
export type AwaitingInterruptPayload = z.infer<typeof awaitingInterruptPayloadSchema>;

export const interruptAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('answer'), text: z.string().min(1) }),
  z.strictObject({
    type: z.literal('approval'),
    decision: z.enum(['approve', 'reject']),
    note: z.string().optional(),
  }),
  /** Human finished login / captcha in the Persona browser and pressed "continue". */
  z.strictObject({ type: z.literal('resume') }),
]);
export type InterruptAnswer = z.infer<typeof interruptAnswerSchema>;

/**
 * Who answered. Main stamps this from the channel the answer arrived on; it is
 * never read from renderer or Agent input.
 */
export type InterruptResponder = 'orchestrator' | 'user';

const ANSWER_TYPE_FOR: Readonly<Record<AwaitingInterruptPayload['type'], InterruptAnswer['type']>> =
  Object.freeze({
    question: 'answer',
    tool_approval: 'approval',
    auth_required: 'resume',
    captcha: 'resume',
  });

export function isAwaitingInterrupt(
  payload: InterruptPayload,
): payload is AwaitingInterruptPayload {
  return payload.type !== 'tool_error';
}

/** ADR-0010 answer-permission table: high approvals, auth, and captcha need a human. */
export function requiresHuman(payload: AwaitingInterruptPayload): boolean {
  switch (payload.type) {
    case 'question':
      return false;
    case 'tool_approval':
      return payload.riskLevel === 'high';
    case 'auth_required':
    case 'captcha':
      return true;
  }
}

/**
 * Who is asked first. The Orchestrator gets the first chance when it
 * delegated the Task; in a Thread the user started directly, everything goes
 * to the user (ADR-0010 §7).
 */
export function firstResponder(
  payload: AwaitingInterruptPayload,
  context: { delegatedByOrchestrator: boolean },
): InterruptResponder {
  return context.delegatedByOrchestrator && !requiresHuman(payload) ? 'orchestrator' : 'user';
}

export type InterruptAnswerCheck =
  | { ok: true }
  | { ok: false; reason: 'not_awaiting_answer' | 'human_required' | 'answer_type_mismatch' };

export function checkInterruptAnswer(
  payload: InterruptPayload,
  answer: InterruptAnswer,
  responder: InterruptResponder,
): InterruptAnswerCheck {
  if (!isAwaitingInterrupt(payload)) return { ok: false, reason: 'not_awaiting_answer' };
  if (responder === 'orchestrator' && requiresHuman(payload)) {
    return { ok: false, reason: 'human_required' };
  }
  if (answer.type !== ANSWER_TYPE_FOR[payload.type]) {
    return { ok: false, reason: 'answer_type_mismatch' };
  }
  return { ok: true };
}
