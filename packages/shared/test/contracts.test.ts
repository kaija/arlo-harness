import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { a2aEnvelopeSchema } from '../src/a2a.js';
import {
  agentServiceContract,
  agentToMainMessageSchema,
  controlMessageSchema,
  mainToAgentMessageSchema,
} from '../src/agent-channel.js';
import { parseResult, validateCall, type MethodContracts } from '../src/contract.js';
import { BUS_EVENT_TYPES, busEventSchema } from '../src/events.js';
import { JSON_RPC_ERROR_CODES } from '../src/jsonrpc.js';
import {
  parseRendererEvent,
  rendererEventContract,
  rendererInvokeContract,
} from '../src/renderer-api.js';
import {
  agentServiceFixtures,
  busEventFixtures,
  controlFixtures,
  envelopeFixtures,
  rendererEventFixtures,
  rendererInvokeFixtures,
} from './fixtures.js';

function expectSerializable(schema: z.ZodType, value: unknown): void {
  const parsed = schema.parse(value);
  expect(parsed).toStrictEqual(value);
  expect(JSON.parse(JSON.stringify(parsed))).toStrictEqual(value);
  expect(structuredClone(parsed)).toStrictEqual(value);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('every contract entry has a serializable fixture', () => {
  const methodContracts: [
    string,
    MethodContracts,
    Record<string, { params: unknown; result: unknown }>,
  ][] = [
    ['agent service', agentServiceContract, agentServiceFixtures],
    ['renderer invoke', rendererInvokeContract, rendererInvokeFixtures],
  ];

  for (const [label, contract, fixtures] of methodContracts) {
    it(`${label}: params and results round-trip through JSON and structured clone`, () => {
      expect(sortedKeys(fixtures)).toEqual(sortedKeys(contract));
      for (const [method, { params, result }] of Object.entries(fixtures)) {
        const entry = contract[method];
        if (entry === undefined) throw new Error(`No contract for ${method}`);
        expectSerializable(entry.params, params);
        expectSerializable(entry.result, result);
      }
    });
  }

  it('renderer events', () => {
    expect(sortedKeys(rendererEventFixtures)).toEqual(sortedKeys(rendererEventContract));
    for (const [channel, payload] of Object.entries(rendererEventFixtures)) {
      expectSerializable(
        rendererEventContract[channel as keyof typeof rendererEventContract],
        payload,
      );
    }
  });

  it('bus events', () => {
    expect(sortedKeys(busEventFixtures)).toEqual([...BUS_EVENT_TYPES].sort());
    for (const event of Object.values(busEventFixtures)) {
      expectSerializable(busEventSchema, event);
    }
  });

  it('A2A envelopes and control messages', () => {
    for (const envelope of Object.values(envelopeFixtures)) {
      expectSerializable(a2aEnvelopeSchema, envelope);
    }
    for (const message of Object.values(controlFixtures)) {
      expectSerializable(controlMessageSchema, message);
    }
  });
});

describe('agent and renderer APIs are separate surfaces', () => {
  it('locks the renderer whitelist', () => {
    expect(sortedKeys(rendererInvokeContract)).toEqual([
      'interrupts/answer',
      'messages/send',
      'personas/delete',
      'personas/setEnabled',
      'secrets/delete',
      'secrets/list',
      'secrets/set',
      'tasks/cancel',
      'windows/showPersona',
    ]);
    expect(sortedKeys(rendererEventContract)).toEqual(['state/agentStatus', 'state/task']);
  });

  it('shares no method names between the two contracts', () => {
    const agentMethods = new Set(Object.keys(agentServiceContract));
    expect(Object.keys(rendererInvokeContract).filter((m) => agentMethods.has(m))).toEqual([]);
  });

  it('rejects database and A2A calls from the renderer', () => {
    for (const method of ['db/session.getItems', 'registry/list', 'message/send', 'a2a-request']) {
      const call = validateCall(rendererInvokeContract, method, {});
      expect(call.ok).toBe(false);
    }
  });

  it('never lets a caller name the agent whose data a service call touches', () => {
    const call = validateCall(agentServiceContract, 'db/session.getItems', {
      contextId: 'user:other-persona',
      agentId: 'persona:other-persona',
    });
    expect(call).toMatchObject({ ok: false, error: { code: JSON_RPC_ERROR_CODES.INVALID_PARAMS } });
  });
});

describe('secrets never flow back out of main', () => {
  const SECRET_KEYS = new Set(['apiKey', 'value', 'secret', 'plaintext', 'token', 'password']);

  function propertyNames(schema: z.ZodType): string[] {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (typeof node === 'object' && node !== null) {
        for (const [key, child] of Object.entries(node)) {
          if (key === 'properties' && typeof child === 'object' && child !== null) {
            names.push(...Object.keys(child));
          }
          walk(child);
        }
      }
    };
    walk(z.toJSONSchema(schema, { io: 'output' }));
    return names;
  }

  it('has no renderer channel for reading a secret', () => {
    const secretChannels = Object.keys(rendererInvokeContract).filter((channel) =>
      channel.startsWith('secrets/'),
    );
    expect(secretChannels.sort()).toEqual(['secrets/delete', 'secrets/list', 'secrets/set']);
  });

  it('exposes no secret-shaped field in any renderer result or event', () => {
    const schemas = [
      ...Object.values(rendererInvokeContract).map((entry) => entry.result),
      ...Object.values(rendererEventContract),
    ];
    for (const schema of schemas) {
      expect(propertyNames(schema).filter((name) => SECRET_KEYS.has(name))).toEqual([]);
    }
  });

  it('exposes no secret-shaped field in any agent service result', () => {
    for (const entry of Object.values(agentServiceContract)) {
      expect(propertyNames(entry.result).filter((name) => SECRET_KEYS.has(name))).toEqual([]);
    }
  });

  it('rejects secret metadata that carries a value instead of silently stripping it', () => {
    const result = rendererInvokeContract['secrets/list'].result.safeParse({
      secrets: [
        { ref: 'openai-main', last4: '1234', updatedAt: '2026-09-16T09:30:00Z', value: 'sk-x' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('only accepts provider keys in the main → Agent direction', () => {
    const configure = controlFixtures['provider/configure'];
    expect(mainToAgentMessageSchema.safeParse(configure).success).toBe(true);
    expect(agentToMainMessageSchema.safeParse(configure).success).toBe(false);
  });
});

describe('validateCall', () => {
  it('returns typed params for a known method', () => {
    const call = validateCall(rendererInvokeContract, 'tasks/cancel', {
      agentId: 'persona:research-analyst',
      taskId: 'task-1',
    });
    expect(call).toEqual({
      ok: true,
      method: 'tasks/cancel',
      params: { agentId: 'persona:research-analyst', taskId: 'task-1' },
    });
  });

  it('reports unknown methods, including inherited object keys', () => {
    for (const method of ['secrets/get', 'toString', '__proto__']) {
      expect(validateCall(rendererInvokeContract, method, {})).toMatchObject({
        ok: false,
        error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND },
      });
    }
  });

  it('reports invalid params with JSON-serializable issue paths', () => {
    const call = validateCall(rendererInvokeContract, 'messages/send', {
      agentId: 'persona:Bad Id',
      contextId: 'user:x',
      text: '',
      mode: 'later',
    });
    expect(call.ok).toBe(false);
    if (call.ok) return;
    expect(call.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
    const issues = (call.error.data as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path).sort()).toEqual(['agentId', 'mode', 'text']);
    expect(JSON.parse(JSON.stringify(call.error))).toStrictEqual(call.error);
  });
});

describe('parseResult', () => {
  it('passes a conforming result and throws on drift', () => {
    expect(parseResult(agentServiceContract, 'db/runStates.load', { state: 'x' })).toEqual({
      state: 'x',
    });
    expect(() => parseResult(agentServiceContract, 'db/runStates.load', { state: 1 })).toThrow();
  });
});

describe('renderer events', () => {
  it('requires an interrupt exactly when the task is input-required', () => {
    const base = rendererEventFixtures['state/task'] as Record<string, unknown>;
    const withoutInterrupt = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== 'interrupt'),
    );

    expect(() => parseRendererEvent('state/task', withoutInterrupt)).toThrow();
    expect(() => parseRendererEvent('state/task', { ...base, state: 'working' })).toThrow();
    expect(
      parseRendererEvent('state/task', { ...withoutInterrupt, state: 'working' }),
    ).toMatchObject({
      state: 'working',
    });
  });

  it('rejects tool_error as a pending interrupt', () => {
    expect(() =>
      parseRendererEvent('state/task', {
        ...(rendererEventFixtures['state/task'] as object),
        interrupt: { type: 'tool_error', toolName: 'fs_read', error: 'x', retryable: true },
      }),
    ).toThrow();
  });
});
