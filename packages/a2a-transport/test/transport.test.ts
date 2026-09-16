import { Task, type StreamResponse } from '@a2a-js/sdk';
import { ServerCallContext } from '@a2a-js/sdk/server';
import { isForbiddenRouteError } from '@arlo/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMessagePortFetch,
  isTransportError,
  jsonRpcErrorOf,
  TRANSPORT_ERROR_REASONS,
} from '../src/index.js';
import {
  artifactText,
  collect,
  delay,
  describeEvent,
  TestNetwork,
  userMessage,
  waitUntil,
} from './harness.js';

let network: TestNetwork;

afterEach(() => {
  network.close();
});

function setup() {
  network = new TestNetwork();
  const orchestrator = network.connect('orchestrator');
  const persona = network.connect('persona:research-analyst');
  return { orchestrator, persona };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to fail.');
}

describe('A2A over MessagePort', () => {
  it('sends a blocking message and returns the completed task', async () => {
    const { orchestrator, persona } = setup();
    const client = await network.client(orchestrator, persona.agentId);

    const result = await client.sendMessage(userMessage('find sources'));

    expect('id' in result).toBe(true);
    const task = result as Task;
    expect(describeEvent({ payload: { $case: 'task', value: task } })).toBe('task:completed');
    expect(artifactText(task)).toBe('echo: find sources');
    expect(persona.executor.callers).toEqual(['orchestrator']);
    // The Task landed in the Persona's store, not the caller's.
    expect(await persona.taskStore.load(task.id, new ServerCallContext())).toBeDefined();
  });

  it('streams task events in order and ends the stream', async () => {
    const { orchestrator, persona } = setup();
    const client = await network.client(orchestrator, persona.agentId);

    const events = await collect(client.sendMessageStream(userMessage('stream it')));

    expect(events.map(describeEvent)).toEqual([
      'task:submitted',
      'status:working',
      'artifact:echo: stream it',
      'status:completed',
    ]);
    expect(network.brokerErrors).toEqual([]);
  });

  it('resubscribes to a running task and follows it to completion', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);

    const started = (await client.sendMessage(
      userMessage('long job', { returnImmediately: true }),
    )) as Task;
    const [, gate] = await persona.executor.waitForGate();

    const events: string[] = [];
    const resubscribed = (async () => {
      for await (const event of client.resubscribeTask({ tenant: '', id: started.id })) {
        events.push(describeEvent(event));
      }
    })();
    // The snapshot arrives only after the subscription is attached, so no update is missed.
    await waitUntil(() => events.length === 1, 'the resubscribe snapshot');
    gate.open();
    await resubscribed;

    expect(events).toEqual(['task:working', 'artifact:echo: long job', 'status:completed']);
    const stored = await client.getTask({ tenant: '', id: started.id, historyLength: undefined });
    expect(artifactText(stored)).toBe('echo: long job');
  });

  it('cancels a running task and ends every open stream', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);

    const stream = collect(client.sendMessageStream(userMessage('cancel me')));
    const [taskId] = await persona.executor.waitForGate();
    const canceled = await client.cancelTask({ tenant: '', id: taskId, metadata: undefined });

    expect(describeEvent({ payload: { $case: 'task', value: canceled } })).toBe('task:canceled');
    expect((await stream).map(describeEvent)).toEqual([
      'task:submitted',
      'status:working',
      'status:canceled',
    ]);
  });

  it('turns an executor failure into a failed status at the end of the stream', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.fail = true;
    const client = await network.client(orchestrator, persona.agentId);

    const events = await collect(client.sendMessageStream(userMessage('boom')));

    expect(events.map(describeEvent).at(-1)).toBe('status:failed');
  });

  it('returns A2A errors such as an unknown task to the caller', async () => {
    const { orchestrator, persona } = setup();
    const client = await network.client(orchestrator, persona.agentId);

    const error = await rejection(
      client.getTask({ tenant: '', id: 'missing', historyLength: undefined }),
    );

    expect(jsonRpcErrorOf(error)).toMatchObject({ code: -32001 });
  });

  it('delivers a pre-stream error as a JSON response instead of a stream', async () => {
    const { orchestrator, persona } = setup();
    const client = await network.client(orchestrator, persona.agentId);

    const error = await rejection(
      collect(client.resubscribeTask({ tenant: '', id: 'no-such-task' })),
    );

    expect(jsonRpcErrorOf(error)?.code).toBe(-32001);
  });

  it('lets main send as a system origin', async () => {
    const { persona } = setup();
    const client = await network.broker.createSystemClient('system:user', persona.agentId);

    const task = (await client.sendMessage(userMessage('from the panel'))) as Task;

    expect(artifactText(task)).toBe('echo: from the panel');
    expect(persona.executor.callers).toEqual(['system:user']);
  });
});

describe('broker routing policy', () => {
  it('rejects a Persona calling another Persona directly', async () => {
    const { persona } = setup();
    const other = network.connect('persona:writer');
    const client = await network.client(persona, other.agentId);

    const error = await rejection(client.sendMessage(userMessage('psst')));
    const streamError = await rejection(collect(client.sendMessageStream(userMessage('psst'))));

    for (const failure of [error, streamError]) {
      const rpcError = jsonRpcErrorOf(failure);
      expect(rpcError).toBeDefined();
      expect(isForbiddenRouteError(rpcError!)).toBe(true);
    }
    expect(other.executor.callers).toEqual([]);
  });

  it('lets a Persona reach the Orchestrator but not itself', async () => {
    const { orchestrator, persona } = setup();

    const up = await (
      await network.client(persona, orchestrator.agentId)
    ).sendMessage(userMessage('question'));
    const self = await rejection(
      (await network.client(orchestrator, orchestrator.agentId)).sendMessage(userMessage('loop')),
    );

    expect(artifactText(up as Task)).toBe('echo: question');
    expect(isForbiddenRouteError(jsonRpcErrorOf(self)!)).toBe(true);
  });

  it('drops envelopes whose sender is not the port owner', async () => {
    const { orchestrator, persona } = setup();
    // A compromised Persona tries to pose as the Orchestrator and as the user.
    for (const from of ['orchestrator', 'system:user']) {
      persona.agentPort.postMessage({
        kind: 'a2a-request',
        requestId: `spoof-${from}`,
        from,
        to: 'persona:writer',
        payload: { jsonrpc: '2.0', id: 1, method: 'SendMessage', params: {} },
      });
    }
    persona.agentPort.postMessage({ kind: 'a2a-request', nonsense: true });
    await waitUntil(() => network.brokerErrors.length === 3, 'three dropped messages');

    expect(network.brokerErrors).toEqual([
      'persona:research-analyst: Dropped a a2a-request claiming to be from orchestrator.',
      'persona:research-analyst: Dropped a a2a-request claiming to be from system:user.',
      'persona:research-analyst: Dropped a malformed message.',
    ]);
    expect(orchestrator.protocolErrors).toEqual([]);
  });

  it('drops response frames for requests that are not in flight', async () => {
    const { orchestrator, persona } = setup();
    const answers: unknown[] = [];
    orchestrator.channel.onResponse('forged', (frame) => answers.push(frame));

    persona.agentPort.postMessage({
      kind: 'a2a-response',
      requestId: 'forged',
      from: persona.agentId,
      to: 'orchestrator',
      payload: { jsonrpc: '2.0', id: 1, result: { approved: true } },
    });
    await waitUntil(() => network.brokerErrors.length === 1, 'the dropped response');

    expect(answers).toEqual([]);
    expect(network.brokerErrors).toEqual([
      'persona:research-analyst: Dropped a a2a-response for no request in flight.',
    ]);
  });

  it('reports an Agent that is not running', async () => {
    const { orchestrator } = setup();
    const client = await network.client(orchestrator, 'persona:offline');

    const error = await rejection(client.sendMessage(userMessage('hello?')));

    expect(isTransportError(jsonRpcErrorOf(error)!, TRANSPORT_ERROR_REASONS.agentUnavailable)).toBe(
      true,
    );
  });

  it('rejects a reused request id while the first is in flight', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const frames: { kind: string; payload?: unknown }[] = [];
    orchestrator.channel.onResponse('same-id', (frame) => frames.push(frame));
    const request = {
      kind: 'a2a-request' as const,
      requestId: 'same-id',
      from: 'orchestrator' as const,
      to: persona.agentId,
      payload: {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'SendMessage',
        params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'x' }] } },
      },
    };

    orchestrator.channel.sendRequest(request);
    orchestrator.channel.sendRequest(request);
    await waitUntil(() => frames.length === 1, 'the duplicate rejection');

    expect(frames).toHaveLength(1);
    expect(
      isTransportError(
        (frames[0]?.payload as { error: never }).error,
        TRANSPORT_ERROR_REASONS.duplicateRequest,
      ),
    ).toBe(true);
    (await persona.executor.waitForGate())[1].open();
  });
});

describe('cleanup', () => {
  it('fails an open stream when the target Agent disconnects', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);

    const events: StreamResponse[] = [];
    const consumed = (async () => {
      for await (const event of client.sendMessageStream(userMessage('crash soon')))
        events.push(event);
    })();
    await persona.executor.waitForGate();
    await waitUntil(() => events.length === 2, 'the first two stream events');
    // The Persona's utilityProcess dies: its port closes.
    persona.agentPort.close();

    const error = await rejection(consumed);

    expect(events.map(describeEvent)).toEqual(['task:submitted', 'status:working']);
    expect(
      isTransportError(jsonRpcErrorOf(error)!, TRANSPORT_ERROR_REASONS.agentDisconnected),
    ).toBe(true);
    expect(network.broker.isAttached(persona.agentId)).toBe(false);
  });

  it('fails a pending unary call when the target Agent disconnects', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);

    const pending = rejection(client.sendMessage(userMessage('never answered')));
    await persona.executor.waitForGate();
    persona.mainPort.close();

    expect(
      isTransportError(jsonRpcErrorOf(await pending)!, TRANSPORT_ERROR_REASONS.agentDisconnected),
    ).toBe(true);
  });

  it('stops reading when the caller aborts, while the task still completes', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);
    const abort = new AbortController();

    const events: string[] = [];
    const consumed = (async () => {
      for await (const event of client.sendMessageStream(userMessage('abort me'), {
        signal: abort.signal,
      })) {
        events.push(describeEvent(event));
      }
    })();
    const [taskId, gate] = await persona.executor.waitForGate();
    await waitUntil(() => events.length === 2, 'the first two stream events');
    abort.abort(new Error('caller gave up'));

    expect(await rejection(consumed)).toMatchObject({ message: 'caller gave up' });
    gate.open();

    let state = '';
    await waitUntil(
      () => state === 'task:completed',
      'the Persona to finish the task',
      async () => {
        const stored = await client.getTask({ tenant: '', id: taskId, historyLength: undefined });
        state = describeEvent({ payload: { $case: 'task', value: stored } });
      },
    );
    expect(events).toEqual(['task:submitted', 'status:working']);
    expect(network.brokerErrors).toEqual([]);
    expect(orchestrator.protocolErrors).toEqual([]);
  });

  it('drops frames for a requester whose port closed', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);

    const pending = rejection(collect(client.sendMessageStream(userMessage('orphan'))));
    const [, gate] = await persona.executor.waitForGate();
    orchestrator.agentPort.close();
    await pending;
    gate.open();
    await delay(30);

    expect(network.brokerErrors).toEqual([]);
  });

  it('fails in-flight calls on the Agent side when its port to main closes', async () => {
    const { orchestrator, persona } = setup();
    persona.executor.holdTasks = true;
    const client = await network.client(orchestrator, persona.agentId);

    const pending = rejection(client.sendMessage(userMessage('main went away')));
    await persona.executor.waitForGate();
    orchestrator.channel.close();

    expect(jsonRpcErrorOf(await pending)?.message).toBe('The Agent port to main closed.');
    expect(await rejection(client.sendMessage(userMessage('after close')))).toBeDefined();
  });
});

describe('MessagePort fetch', () => {
  it('only accepts JSON-RPC POSTs to Arlo Agent URLs', async () => {
    const { orchestrator } = setup();
    const fetchOverPort = createMessagePortFetch(orchestrator.channel);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: 'x' } });

    await expect(
      fetchOverPort('https://example.com/a2a', { method: 'POST', body }),
    ).rejects.toThrow('Not an Arlo Agent endpoint');
    await expect(fetchOverPort('arlo://agents/persona:x', { method: 'GET' })).rejects.toThrow(
      'Only JSON-RPC POST',
    );
    await expect(
      fetchOverPort('arlo://agents/persona:x', { method: 'POST', body: '{not json' }),
    ).rejects.toThrow('not a JSON-RPC request');
    await expect(
      fetchOverPort(new URL('arlo://agents/persona:x'), {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'GetTask' }),
      }),
    ).rejects.toThrow('notifications are not supported');

    const aborted = new AbortController();
    aborted.abort(new Error('already aborted'));
    await expect(
      fetchOverPort('arlo://agents/persona:x', { method: 'POST', body, signal: aborted.signal }),
    ).rejects.toThrow('already aborted');
  });

  it('refuses a card whose endpoint points at a different Agent', async () => {
    const { orchestrator } = setup();
    const { createA2AClient } = await import('../src/index.js');
    const { testCard } = await import('./harness.js');

    await expect(
      createA2AClient(orchestrator.channel, 'persona:research-analyst', testCard('persona:writer')),
    ).rejects.toThrow('must declare only the JSON-RPC endpoint');
  });
});

describe('server stream errors', () => {
  it('sends an error event and stream-end when a stream fails midway', async () => {
    network = new TestNetwork();
    const orchestrator = network.connect('orchestrator');
    const { MessageChannel } = await import('node:worker_threads');
    const { StreamResponse } = await import('@a2a-js/sdk');
    const { AgentChannel, MessagePortA2AServer, nodeMessagePortEndpoint } =
      await import('../src/index.js');
    const { testCard } = await import('./harness.js');

    const agentId = 'persona:flaky' as const;
    const { port1, port2 } = new MessageChannel();
    network.broker.attach(agentId, nodeMessagePortEndpoint(port1));
    const channel = new AgentChannel(agentId, nodeMessagePortEndpoint(port2));
    const serverErrors: unknown[] = [];
    const card = testCard(agentId);
    const handler = {
      getAgentCard: async () => card,
      async *sendMessageStream() {
        yield StreamResponse.fromJSON({
          task: { id: 't', contextId: 'c', status: { state: 'TASK_STATE_WORKING' } },
        });
        throw new Error('model connection reset');
      },
    };
    new MessagePortA2AServer(channel, handler as never, {
      onError: (error) => serverErrors.push(error),
    });

    try {
      const client = await network.client(orchestrator, agentId);
      const events: string[] = [];
      const error = await rejection(
        (async () => {
          for await (const event of client.sendMessageStream(userMessage('go'))) {
            events.push(describeEvent(event));
          }
        })(),
      );

      expect(events).toEqual(['task:working']);
      expect(jsonRpcErrorOf(error)?.message).toContain('model connection reset');
      expect(serverErrors).toHaveLength(1);
      await delay();
      expect(network.brokerErrors).toEqual([]);
    } finally {
      channel.close();
    }
  });
});
