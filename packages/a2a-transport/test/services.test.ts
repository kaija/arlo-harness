import { MessageChannel } from 'node:worker_threads';
import { Task } from '@a2a-js/sdk';
import { JSON_RPC_ERROR_CODES, type ControlMessage } from '@arlo/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentChannel,
  arloTaskState,
  nodeMessagePortEndpoint,
  ServiceCallError,
  ServiceError,
  summarizeTaskJson,
} from '../src/index.js';
import { delay, TestNetwork, testCard, waitUntil } from './harness.js';

let network: TestNetwork;

afterEach(() => {
  network.close();
});

async function serviceError(promise: Promise<unknown>): Promise<ServiceCallError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceCallError) return error;
    throw error;
  }
  throw new Error('Expected the service call to fail.');
}

describe('Agent Card registry', () => {
  it('announces card changes and serves the registry to Agents', async () => {
    network = new TestNetwork();
    const orchestrator = network.connect('orchestrator');
    const controls: ControlMessage[] = [];
    orchestrator.channel.onControl((message) => controls.push(message));
    // The Orchestrator's own card was the first update.
    await waitUntil(() => controls.length === 1, "the Orchestrator's card update");
    controls.length = 0;

    const persona = network.connect('persona:research-analyst');
    await waitUntil(() => controls.length === 1, "the Persona's card update");

    expect(controls).toEqual([{ kind: 'control', type: 'registry/updated' }]);
    const { cards } = await orchestrator.channel.callService('registry/list', {});
    expect(cards.map((entry) => entry.agentId)).toEqual([
      'orchestrator',
      'persona:research-analyst',
    ]);
    expect(cards[1]?.card).toMatchObject({
      supportedInterfaces: [{ url: 'arlo://agents/persona:research-analyst' }],
    });

    network.broker.removeAgentCard(persona.agentId);
    network.broker.removeAgentCard(persona.agentId);
    await waitUntil(() => controls.length === 2, 'the removal update');
    await delay();

    expect(controls).toHaveLength(2);
    expect(network.broker.getAgentCard(persona.agentId)).toBeUndefined();
    expect((await orchestrator.channel.callService('registry/list', {})).cards).toHaveLength(1);
  });

  it('requires a registered card for system clients', async () => {
    network = new TestNetwork();
    await expect(
      network.broker.createSystemClient('system:schedule', 'persona:missing'),
    ).rejects.toThrow('No Agent Card registered');
  });

  it('refuses to attach an Agent twice or with an invalid id', () => {
    network = new TestNetwork();
    network.connect('orchestrator');
    const { port1 } = new MessageChannel();
    try {
      expect(() => network.broker.attach('orchestrator', nodeMessagePortEndpoint(port1))).toThrow(
        'already attached',
      );
      expect(() =>
        network.broker.attach('persona:Bad' as never, nodeMessagePortEndpoint(port1)),
      ).toThrow('Invalid agent id');
    } finally {
      port1.close();
    }
    expect(
      network.broker.sendControl('persona:absent', { kind: 'control', type: 'registry/updated' }),
    ).toBe(false);
  });
});

describe('main services', () => {
  it('scopes each call to the Agent that owns the port', async () => {
    network = new TestNetwork();
    const orchestrator = network.connect('orchestrator');
    const persona = network.connect('persona:research-analyst');
    const calls: unknown[] = [];
    network.broker.handleService('db/runStates.load', ({ agentId, params }) => {
      calls.push({ agentId, params });
      return { state: agentId === 'orchestrator' ? null : 'serialized' };
    });

    expect(await persona.channel.callService('db/runStates.load', { taskId: 't1' })).toEqual({
      state: 'serialized',
    });
    expect(await orchestrator.channel.callService('db/runStates.load', { taskId: 't1' })).toEqual({
      state: null,
    });
    expect(calls).toEqual([
      { agentId: 'persona:research-analyst', params: { taskId: 't1' } },
      { agentId: 'orchestrator', params: { taskId: 't1' } },
    ]);
  });

  it('rejects params that name another agent before they leave the Agent', async () => {
    network = new TestNetwork();
    const persona = network.connect('persona:research-analyst');

    const error = await serviceError(
      persona.channel.callService('db/runStates.load', {
        taskId: 't1',
        agentId: 'orchestrator',
      } as never),
    );

    expect(error.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it('validates calls that bypass the client-side check', async () => {
    network = new TestNetwork();
    const persona = network.connect('persona:research-analyst');
    const responses: unknown[] = [];
    persona.agentPort.on('message', (message) => {
      if ((message as { kind: string }).kind === 'service-response') responses.push(message);
    });

    persona.agentPort.postMessage({
      kind: 'service-request',
      requestId: 'raw-1',
      method: 'secrets/list',
      params: {},
    });
    persona.agentPort.postMessage({
      kind: 'service-request',
      requestId: 'raw-2',
      method: 'db/tasks.load',
      params: { taskId: '' },
    });
    await waitUntil(() => responses.length === 2, 'both service responses');

    expect(responses).toEqual([
      {
        kind: 'service-response',
        requestId: 'raw-1',
        error: {
          code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          message: 'Unknown method "secrets/list".',
        },
      },
      expect.objectContaining({
        requestId: 'raw-2',
        error: expect.objectContaining({ code: JSON_RPC_ERROR_CODES.INVALID_PARAMS }),
      }),
    ]);
  });

  it('reports services that are not wired, handler errors, and bad results', async () => {
    network = new TestNetwork();
    const broker = network.broker;
    const persona = network.connect('persona:research-analyst');

    const missing = await serviceError(
      persona.channel.callService('db/tasks.load', { taskId: 't' }),
    );
    expect(missing.error).toEqual({
      code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
      message: 'Service "db/tasks.load" is not available.',
    });

    broker.handleService('db/tasks.load', () => {
      throw new ServiceError(-32001, 'Task not found', { taskId: 't' });
    });
    expect(
      (await serviceError(persona.channel.callService('db/tasks.load', { taskId: 't' }))).error,
    ).toEqual({
      code: -32001,
      message: 'Task not found',
      data: { taskId: 't' },
    });

    broker.handleService('db/tasks.load', () => {
      throw new Error('SQLITE_CORRUPT: /Users/someone/arlo.db');
    });
    const hidden = await serviceError(
      persona.channel.callService('db/tasks.load', { taskId: 't' }),
    );
    expect(hidden.error).toEqual({
      code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      message: 'Service "db/tasks.load" failed.',
    });
    expect(hidden.message).not.toContain('SQLITE');

    broker.handleService('db/tasks.load', () => ({ task: 'not an object' }) as never);
    expect(
      (await serviceError(persona.channel.callService('db/tasks.load', { taskId: 't' }))).error
        .code,
    ).toBe(JSON_RPC_ERROR_CODES.INTERNAL_ERROR);
    expect(() => broker.handleService('secrets/get' as never, () => null as never)).toThrow(
      'Unknown service',
    );
  });

  it('passes unexpected handler errors to onServiceError', async () => {
    const seen: string[] = [];
    const { A2ABroker } = await import('../src/index.js');
    const broker = new A2ABroker({
      onServiceError: (_error, method, agentId) => seen.push(`${agentId} ${method}`),
    });
    const { port1, port2 } = new MessageChannel();
    broker.attach('orchestrator', nodeMessagePortEndpoint(port1));
    const channel = new AgentChannel('orchestrator', nodeMessagePortEndpoint(port2));
    broker.handleService('db/session.clear', () => {
      throw new Error('disk full');
    });
    try {
      await serviceError(channel.callService('db/session.clear', { contextId: 'user:x' }));
      expect(seen).toEqual(['orchestrator db/session.clear']);
    } finally {
      channel.close();
    }
  });

  it('rejects pending and later service calls once the port closes', async () => {
    network = new TestNetwork();
    const persona = network.connect('persona:research-analyst');
    network.broker.handleService('db/session.getItems', () => new Promise(() => {}));

    const pending = serviceError(
      persona.channel.callService('db/session.getItems', { contextId: 'c' }),
    );
    await delay();
    persona.mainPort.close();

    expect((await pending).message).toContain('The Agent port to main closed.');
    expect(persona.channel.closed).toBe(true);
    expect(
      (await serviceError(persona.channel.callService('db/session.clear', { contextId: 'c' })))
        .message,
    ).toContain('closed');
  });

  it('drops malformed main messages and control messages after close', async () => {
    const { port1, port2 } = new MessageChannel();
    const errors: Error[] = [];
    const channel = new AgentChannel('persona:x', nodeMessagePortEndpoint(port2), {
      onProtocolError: (error) => errors.push(error),
    });
    const controls: unknown[] = [];
    channel.onControl((message) => controls.push(message));

    port1.postMessage({ kind: 'control', type: 'provider/configure' });
    port1.postMessage({
      kind: 'a2a-request',
      requestId: 'r',
      from: 'orchestrator',
      to: 'persona:x',
      payload: { jsonrpc: '2.0', id: 1, method: 'GetTask' },
    });
    port1.postMessage({ kind: 'control', type: 'registry/updated' });
    port1.postMessage({ kind: 'service-response', requestId: 'unknown', result: null });
    await waitUntil(
      () => controls.length === 1 && errors.length === 2,
      'the channel to process all',
    );
    channel.close();

    expect(errors.map((error) => error.message)).toEqual([
      'Dropped a malformed message from main.',
      'Dropped an A2A request for persona:x with no server on persona:x.',
    ]);
    expect(controls).toEqual([{ kind: 'control', type: 'registry/updated' }]);
    expect(() => channel.serve(() => {})).not.toThrow();
  });

  it('allows only one A2A server per channel', () => {
    network = new TestNetwork();
    const persona = network.connect('persona:research-analyst');
    expect(() => persona.channel.serve(() => {})).toThrow('already has an A2A server');
    persona.server.close();
    expect(() => persona.channel.serve(() => {})).not.toThrow();
  });
});

describe('task state helpers', () => {
  it('maps every A2A v1.0 state and ignores unspecified ones', () => {
    const json = (state: string) => Task.fromJSON({ id: 't', contextId: 'c', status: { state } });
    expect(
      [
        'TASK_STATE_SUBMITTED',
        'TASK_STATE_WORKING',
        'TASK_STATE_INPUT_REQUIRED',
        'TASK_STATE_AUTH_REQUIRED',
        'TASK_STATE_COMPLETED',
        'TASK_STATE_FAILED',
        'TASK_STATE_CANCELED',
        'TASK_STATE_REJECTED',
        'TASK_STATE_UNSPECIFIED',
        'SOMETHING_NEW',
      ].map((state) => arloTaskState(json(state).status!.state)),
    ).toEqual([
      'submitted',
      'working',
      'input-required',
      'auth-required',
      'completed',
      'failed',
      'canceled',
      'rejected',
      undefined,
      undefined,
    ]);
  });

  it('summarizes stored Task JSON and extracts the HITL payload', () => {
    const inputRequired = {
      id: 'task-1',
      contextId: 'ctx-1',
      status: {
        state: 'TASK_STATE_INPUT_REQUIRED',
        message: {
          messageId: 'm',
          role: 'ROLE_AGENT',
          parts: [
            { text: 'Need a decision' },
            { data: { unrelated: true } },
            { data: { type: 'question', question: 'Which date range?' } },
          ],
        },
      },
    };

    expect(summarizeTaskJson(inputRequired)).toEqual({
      taskId: 'task-1',
      contextId: 'ctx-1',
      state: 'input-required',
      interrupt: { type: 'question', question: 'Which date range?' },
    });
    expect(summarizeTaskJson({ id: 'task-2', contextId: 'ctx-2' })).toEqual({
      taskId: 'task-2',
      contextId: 'ctx-2',
      state: undefined,
      interrupt: undefined,
    });
    expect(
      summarizeTaskJson({
        ...inputRequired,
        status: { state: 'TASK_STATE_WORKING', message: inputRequired.status.message },
      }).interrupt,
    ).toBeUndefined();
  });

  it('keeps the test card helper consistent with the endpoint rule', () => {
    expect(testCard('orchestrator').supportedInterfaces[0]?.url).toBe('arlo://agents/orchestrator');
  });
});
