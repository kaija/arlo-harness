import { describe, expect, it } from 'vitest';
import {
  a2aEnvelopeSchema,
  isEnvelopeFromPort,
  isTerminalTaskState,
  TASK_STATES,
} from '../src/a2a.js';
import {
  agentToMainMessageSchema,
  controlMessageSchema,
  mainToAgentMessageSchema,
  serviceResponseSchema,
} from '../src/agent-channel.js';
import { BUS_EVENT_TYPES, busEventSchema, MAX_EVENT_CHAIN_DEPTH } from '../src/events.js';
import {
  agentIdSchema,
  isAgentId,
  isPersonaId,
  personaAgentId,
  personaIdOf,
  personaIdSchema,
} from '../src/ids.js';
import { jsonObjectSchema, jsonValueSchema } from '../src/json.js';
import {
  forbiddenRouteError,
  isForbiddenRouteError,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
} from '../src/jsonrpc.js';
import { providerProfileSchema } from '../src/provider.js';
import { busEventFixtures, controlFixtures, envelopeFixtures } from './fixtures.js';

describe('JSON values', () => {
  it('rejects values that do not survive JSON or structured clone', () => {
    class Point {
      x = 1;
    }
    for (const value of [
      undefined,
      Number.NaN,
      Infinity,
      new Date(),
      new Map(),
      () => 1,
      new Point(),
    ]) {
      expect(jsonValueSchema.safeParse(value).success).toBe(false);
    }
    expect(jsonValueSchema.safeParse({ nested: { list: [1, 'a', null, true] } }).success).toBe(
      true,
    );
    expect(jsonObjectSchema.safeParse({ a: undefined }).success).toBe(false);
  });
});

describe('ids', () => {
  it('accepts lowercase kebab-case persona ids up to 48 characters', () => {
    expect(isPersonaId('research-analyst')).toBe(true);
    expect(isPersonaId('a1')).toBe(true);
    expect(isPersonaId('a'.repeat(48))).toBe(true);
    for (const bad of [
      '',
      'Research',
      'a_b',
      '-a',
      'a-',
      'a--b',
      'a:b',
      'a'.repeat(49),
      'orchestrator',
      7,
    ]) {
      expect(isPersonaId(bad)).toBe(false);
    }
    expect(personaIdSchema.safeParse('orchestrator').success).toBe(false);
  });

  it('accepts only the Orchestrator and persona:<id> as agent ids', () => {
    expect(isAgentId('orchestrator')).toBe(true);
    expect(isAgentId('persona:research-analyst')).toBe(true);
    for (const bad of [
      'persona:',
      'persona:orchestrator',
      'persona:Bad',
      'system:user',
      'external:https://x',
      null,
    ]) {
      expect(isAgentId(bad)).toBe(false);
    }
    expect(agentIdSchema.safeParse('persona:x').success).toBe(true);
  });

  it('converts between persona ids and agent ids', () => {
    expect(personaAgentId('research-analyst')).toBe('persona:research-analyst');
    expect(personaIdOf('persona:research-analyst')).toBe('research-analyst');
    expect(personaIdOf('orchestrator')).toBeUndefined();
    expect(() => personaAgentId('Not Valid')).toThrow('Invalid persona id');
  });
});

describe('JSON-RPC', () => {
  it('distinguishes success from error responses and rejects ambiguous ones', () => {
    expect(jsonRpcResponseSchema.safeParse({ jsonrpc: '2.0', id: 1, result: null }).success).toBe(
      true,
    );
    expect(
      jsonRpcResponseSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        result: {},
        error: { code: 1, message: 'x' },
      }).success,
    ).toBe(false);
    expect(jsonRpcResponseSchema.safeParse({ jsonrpc: '2.0', id: 1 }).success).toBe(false);
    expect(jsonRpcRequestSchema.safeParse({ jsonrpc: '1.0', method: 'x' }).success).toBe(false);
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: '2.0', method: 'x', params: 'y' }).success,
    ).toBe(false);
  });

  it('marks forbidden routes so they are not confused with A2A -32003', () => {
    const error = forbiddenRouteError('persona:a', 'persona:b');
    expect(error.code).toBe(-32003);
    expect(isForbiddenRouteError(error)).toBe(true);
    expect(
      isForbiddenRouteError({ code: -32003, message: 'Push notification not supported' }),
    ).toBe(false);
    expect(isForbiddenRouteError({ code: -32003, message: 'x', data: ['forbidden_route'] })).toBe(
      false,
    );
    expect(
      isForbiddenRouteError({ code: -32001, message: 'x', data: { reason: 'forbidden_route' } }),
    ).toBe(false);
  });
});

describe('A2A envelope', () => {
  it('only lets requests target an Agent', () => {
    const request = envelopeFixtures['a2a-request'];
    expect(a2aEnvelopeSchema.safeParse({ ...request, to: 'system:user' }).success).toBe(false);
    expect(a2aEnvelopeSchema.safeParse({ ...request, from: 'system:schedule' }).success).toBe(true);
  });

  it('only lets Agents send responses and stream frames', () => {
    for (const kind of ['a2a-response', 'stream-event', 'stream-end'] as const) {
      const envelope = envelopeFixtures[kind];
      expect(a2aEnvelopeSchema.safeParse({ ...envelope, from: 'system:user' }).success).toBe(false);
    }
  });

  it('rejects unknown kinds, extra fields, a payload on stream-end, and external targets', () => {
    const request = envelopeFixtures['a2a-request'];
    expect(a2aEnvelopeSchema.safeParse({ ...request, kind: 'a2a-notify' }).success).toBe(false);
    expect(a2aEnvelopeSchema.safeParse({ ...request, trusted: true }).success).toBe(false);
    expect(
      a2aEnvelopeSchema.safeParse({
        ...envelopeFixtures['stream-end'],
        payload: { jsonrpc: '2.0' },
      }).success,
    ).toBe(false);
    expect(
      a2aEnvelopeSchema.safeParse({ ...request, to: 'external:https://agent.example' }).success,
    ).toBe(false);
  });

  it('binds the sender to the port it arrived on', () => {
    const request = envelopeFixtures['a2a-request'];
    expect(isEnvelopeFromPort('orchestrator', request)).toBe(true);
    expect(isEnvelopeFromPort('persona:research-analyst', request)).toBe(false);
    expect(isEnvelopeFromPort('orchestrator', { ...request, from: 'system:user' })).toBe(false);
  });
});

describe('task states', () => {
  it('treats completed, failed, canceled, and rejected as terminal', () => {
    expect(TASK_STATES.filter(isTerminalTaskState)).toEqual([
      'completed',
      'failed',
      'canceled',
      'rejected',
    ]);
  });
});

describe('Agent port messages', () => {
  it('accepts envelopes and service requests from an Agent', () => {
    expect(agentToMainMessageSchema.safeParse(envelopeFixtures['a2a-request']).success).toBe(true);
    expect(
      agentToMainMessageSchema.safeParse({
        kind: 'service-request',
        requestId: 'svc-1',
        method: 'db/tasks.load',
        params: { taskId: 'task-1' },
      }).success,
    ).toBe(true);
  });

  it('keeps service responses and control messages main → Agent only', () => {
    const response = { kind: 'service-response', requestId: 'svc-1', result: null };
    expect(mainToAgentMessageSchema.safeParse(response).success).toBe(true);
    expect(agentToMainMessageSchema.safeParse(response).success).toBe(false);
    expect(agentToMainMessageSchema.safeParse(controlFixtures['registry/updated']).success).toBe(
      false,
    );
  });

  it('rejects a service response that is both result and error', () => {
    expect(
      serviceResponseSchema.safeParse({
        kind: 'service-response',
        requestId: 'svc-1',
        result: null,
        error: { code: -32603, message: 'x' },
      }).success,
    ).toBe(false);
  });

  it('requires the pushed binding to use the pushed profile', () => {
    const configure = controlFixtures['provider/configure'];
    expect(
      controlMessageSchema.safeParse({
        ...configure,
        binding: { ...configure.binding, providerId: 'openai-main' },
      }).success,
    ).toBe(false);
  });
});

describe('provider profile', () => {
  const openai = {
    id: 'openai-main',
    name: 'OpenAI',
    apiType: 'openai',
    apiKeyRef: 'openai-main',
    capabilities: { realtime: true, transcription: true },
  };

  it('accepts each API type with its required settings', () => {
    expect(providerProfileSchema.safeParse(openai).success).toBe(true);
    expect(
      providerProfileSchema.safeParse({
        ...openai,
        apiType: 'azure_openai',
        baseUrl: 'https://example.openai.azure.com',
        azure: { apiVersion: '2025-04-01-preview' },
      }).success,
    ).toBe(true);
    expect(
      providerProfileSchema.safeParse(controlFixtures['provider/configure'].profile).success,
    ).toBe(true);
  });

  it('refuses profiles that would send a non-OpenAI key to the default endpoint', () => {
    expect(
      providerProfileSchema.safeParse({ ...openai, apiType: 'openai_compatible' }).success,
    ).toBe(false);
    expect(
      providerProfileSchema.safeParse({
        ...openai,
        apiType: 'azure_openai',
        azure: { apiVersion: 'v1' },
      }).success,
    ).toBe(false);
  });

  it('rejects misplaced Azure settings, non-http URLs, and unsupported API types', () => {
    expect(
      providerProfileSchema.safeParse({
        ...openai,
        apiType: 'azure_openai',
        baseUrl: 'https://example.openai.azure.com',
      }).success,
    ).toBe(false);
    expect(
      providerProfileSchema.safeParse({ ...openai, azure: { apiVersion: 'v1' } }).success,
    ).toBe(false);
    expect(
      providerProfileSchema.safeParse({ ...openai, baseUrl: 'file:///etc/passwd' }).success,
    ).toBe(false);
    expect(providerProfileSchema.safeParse({ ...openai, apiType: 'aisdk' }).success).toBe(false);
  });
});

describe('bus events', () => {
  it('lists the ADR-0012 event types', () => {
    expect(BUS_EVENT_TYPES).toEqual([
      'task.completed',
      'task.failed',
      'task.input_required',
      'persona.started',
      'persona.crashed',
      'notification.created',
      'schedule.fired',
      'webhook.received',
    ]);
  });

  it('caps the trigger chain depth at 5', () => {
    const event = busEventFixtures['webhook.received'];
    expect(MAX_EVENT_CHAIN_DEPTH).toBe(5);
    expect(busEventSchema.safeParse({ ...event, chainDepth: 5 }).success).toBe(true);
    expect(busEventSchema.safeParse({ ...event, chainDepth: 6 }).success).toBe(false);
    expect(busEventSchema.safeParse({ ...event, chainDepth: -1 }).success).toBe(false);
  });

  it('rejects mismatched payloads, bad timestamps, and restart attempts past the limit', () => {
    const completed = busEventFixtures['task.completed'];
    expect(
      busEventSchema.safeParse({
        ...completed,
        payload: busEventFixtures['schedule.fired'].payload,
      }).success,
    ).toBe(false);
    expect(busEventSchema.safeParse({ ...completed, occurredAt: 'yesterday' }).success).toBe(false);
    const started = busEventFixtures['persona.started'];
    expect(
      busEventSchema.safeParse({ ...started, payload: { ...started.payload, restartAttempt: 4 } })
        .success,
    ).toBe(false);
  });

  it('rejects tool_error as an input_required interrupt', () => {
    const event = busEventFixtures['task.input_required'];
    expect(
      busEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          interrupt: { type: 'tool_error', toolName: 'fs_read', error: 'x', retryable: false },
        },
      }).success,
    ).toBe(false);
  });
});
