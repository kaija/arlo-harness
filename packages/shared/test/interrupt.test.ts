import { describe, expect, it } from 'vitest';
import {
  awaitingInterruptPayloadSchema,
  checkInterruptAnswer,
  firstResponder,
  interruptAnswerSchema,
  interruptPayloadSchema,
  isAwaitingInterrupt,
  requiresHuman,
  type AwaitingInterruptPayload,
  type InterruptPayload,
} from '../src/interrupt.js';

const question: AwaitingInterruptPayload = {
  type: 'question',
  question: 'Which region?',
  options: ['EU', 'US'],
};
const mediumApproval: AwaitingInterruptPayload = {
  type: 'tool_approval',
  toolName: 'browser_click',
  args: { ref: 'e12' },
  riskLevel: 'medium',
  rationale: 'Submit the search form',
};
const highApproval: AwaitingInterruptPayload = { ...mediumApproval, riskLevel: 'high' };
const auth: AwaitingInterruptPayload = {
  type: 'auth_required',
  site: 'github.com',
  reason: 'session_expired',
};
const captcha: AwaitingInterruptPayload = { type: 'captcha', site: 'example.com' };
const toolError: InterruptPayload = {
  type: 'tool_error',
  toolName: 'fs_read',
  error: 'ENOENT',
  retryable: false,
};

describe('interruptPayloadSchema', () => {
  it('accepts every ADR-0010 payload type', () => {
    for (const payload of [question, mediumApproval, highApproval, auth, captcha, toolError]) {
      expect(interruptPayloadSchema.parse(payload)).toStrictEqual(payload);
    }
  });

  it('rejects low-risk approvals, unknown types, extra keys, and non-JSON args', () => {
    expect(interruptPayloadSchema.safeParse({ ...mediumApproval, riskLevel: 'low' }).success).toBe(
      false,
    );
    expect(interruptPayloadSchema.safeParse({ type: 'payment', amount: 1 }).success).toBe(false);
    expect(interruptPayloadSchema.safeParse({ ...captcha, answeredBy: 'user' }).success).toBe(
      false,
    );
    expect(interruptPayloadSchema.safeParse({ ...mediumApproval, args: new Date() }).success).toBe(
      false,
    );
  });

  it('keeps tool_error out of the awaiting schema', () => {
    expect(awaitingInterruptPayloadSchema.safeParse(toolError).success).toBe(false);
    expect(isAwaitingInterrupt(toolError)).toBe(false);
    expect(isAwaitingInterrupt(question)).toBe(true);
  });
});

describe('answer permissions (ADR-0010 table)', () => {
  it('requires a human for high approvals, auth, and captcha only', () => {
    expect(requiresHuman(question)).toBe(false);
    expect(requiresHuman(mediumApproval)).toBe(false);
    expect(requiresHuman(highApproval)).toBe(true);
    expect(requiresHuman(auth)).toBe(true);
    expect(requiresHuman(captcha)).toBe(true);
  });

  it('asks the Orchestrator first only for delegated Tasks it may answer', () => {
    const delegated = { delegatedByOrchestrator: true };
    const direct = { delegatedByOrchestrator: false };

    expect(firstResponder(question, delegated)).toBe('orchestrator');
    expect(firstResponder(mediumApproval, delegated)).toBe('orchestrator');
    expect(firstResponder(highApproval, delegated)).toBe('user');
    expect(firstResponder(auth, delegated)).toBe('user');
    expect(firstResponder(mediumApproval, direct)).toBe('user');
    expect(firstResponder(question, direct)).toBe('user');
  });

  it('refuses Orchestrator answers that need a human', () => {
    const approve = { type: 'approval', decision: 'approve' } as const;
    expect(checkInterruptAnswer(highApproval, approve, 'orchestrator')).toEqual({
      ok: false,
      reason: 'human_required',
    });
    expect(checkInterruptAnswer(highApproval, approve, 'user')).toEqual({ ok: true });
    expect(checkInterruptAnswer(mediumApproval, approve, 'orchestrator')).toEqual({ ok: true });
    expect(checkInterruptAnswer(captcha, { type: 'resume' }, 'orchestrator')).toEqual({
      ok: false,
      reason: 'human_required',
    });
  });

  it('requires the answer type that matches the interrupt', () => {
    expect(checkInterruptAnswer(question, { type: 'answer', text: 'EU' }, 'orchestrator')).toEqual({
      ok: true,
    });
    expect(checkInterruptAnswer(auth, { type: 'resume' }, 'user')).toEqual({ ok: true });
    expect(checkInterruptAnswer(question, { type: 'resume' }, 'user')).toEqual({
      ok: false,
      reason: 'answer_type_mismatch',
    });
  });

  it('has nothing to answer for tool_error', () => {
    expect(checkInterruptAnswer(toolError, { type: 'resume' }, 'user')).toEqual({
      ok: false,
      reason: 'not_awaiting_answer',
    });
  });

  it('does not let an answer claim its own responder', () => {
    expect(
      interruptAnswerSchema.safeParse({ type: 'answer', text: 'EU', responder: 'user' }).success,
    ).toBe(false);
  });
});
