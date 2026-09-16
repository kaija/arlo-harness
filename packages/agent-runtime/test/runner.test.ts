import { Agent, MemorySession, tool } from '@openai/agents-core';
import { agentRunEventSchema, type AgentRunEvent, type ProviderProfile } from '@arlo/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentRunner,
  ModelConfig,
  type ModelSelector,
  type ProviderConfigureMessage,
} from '../src/index.js';
import { FakeModel, FakeModelProvider, type FakeModelTurn } from '../testing/index.js';

const profile: ProviderProfile = {
  id: 'fake',
  name: 'Fake',
  apiType: 'openai',
  apiKeyRef: 'fake',
  capabilities: { realtime: false, transcription: false },
};

function configureMessage(model: string): ProviderConfigureMessage {
  return {
    kind: 'control',
    type: 'provider/configure',
    binding: { providerId: 'fake', model, settings: { temperature: 0 } },
    profile,
    apiKey: 'sk-test',
  };
}

function fakeModels(turns: FakeModelTurn[]): {
  model: FakeModel;
  provider: FakeModelProvider;
  config: ModelConfig;
} {
  const model = new FakeModel(turns);
  const provider = new FakeModelProvider(model);
  const config = new ModelConfig({ createProvider: () => provider });
  config.configure(configureMessage('fake-model'));
  return { model, provider, config };
}

const lookup = tool({
  name: 'lookup',
  description: 'Look up a fact.',
  parameters: z.object({ query: z.string() }),
  execute: ({ query }) => `result for ${query}`,
});

const sendEmail = tool({
  name: 'send_email',
  description: 'Send an email.',
  parameters: z.object({ to: z.string() }),
  needsApproval: true,
  execute: ({ to }) => `sent to ${to}`,
});

function agentWith(tools: Agent['tools'] = []): Agent {
  return new Agent({ name: 'Research Analyst', instructions: 'You research.', tools });
}

async function runCollecting(runner: AgentRunner, request: Parameters<AgentRunner['run']>[0]) {
  const events: AgentRunEvent[] = [];
  const outcome = await runner.run({ ...request, onEvent: (event) => events.push(event) });
  return { outcome, events };
}

describe('AgentRunner with FakeModel', () => {
  it('streams a text answer', async () => {
    const { config, provider, model } = fakeModels([{ type: 'text', text: 'Hello there.' }]);

    const { outcome, events } = await runCollecting(new AgentRunner(config), {
      agent: agentWith(),
      input: 'hi',
    });

    expect(outcome).toEqual({ status: 'completed', finalOutput: 'Hello there.' });
    expect(events.map((event) => event.type)).toContain('message.completed');
    expect(
      events
        .filter((event) => event.type === 'message.delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe('Hello there.');
    expect(provider.requestedModels).toEqual(['fake-model']);
    expect(model.calls[0]?.request.modelSettings).toMatchObject({ temperature: 0 });
  });

  it('drives a tool call and reports it as JSON events', async () => {
    const { config, model } = fakeModels([
      { type: 'tool_call', toolName: 'lookup', arguments: { query: 'weather' } },
      { type: 'text', text: 'It is sunny.' },
    ]);

    const { outcome, events } = await runCollecting(new AgentRunner(config), {
      agent: agentWith([lookup]),
      input: 'weather?',
    });

    expect(outcome).toEqual({ status: 'completed', finalOutput: 'It is sunny.' });
    const steps = events.filter(
      (event) => event.type !== 'message.delta' && event.type !== 'usage',
    );
    expect(steps).toEqual([
      {
        type: 'tool.called',
        callId: 'call_1',
        toolName: 'lookup',
        arguments: '{"query":"weather"}',
      },
      { type: 'tool.output', callId: 'call_1', toolName: 'lookup', output: 'result for weather' },
      { type: 'message.completed', text: 'It is sunny.' },
    ]);
    // Events cross a MessagePort to main: every one must be plain, schema-valid JSON.
    for (const event of events) {
      expect(agentRunEventSchema.parse(structuredClone(event))).toEqual(event);
    }
    expect(model.calls).toHaveLength(2);
    expect(
      model.calls[0]?.request.tools.map((definition) =>
        'name' in definition ? definition.name : '',
      ),
    ).toEqual(['lookup']);
  });

  it('interrupts for approval and resumes from the serialized state', async () => {
    const { config } = fakeModels([
      { type: 'tool_call', toolName: 'send_email', arguments: { to: 'boss@example.com' } },
      { type: 'text', text: 'Email sent.' },
    ]);
    const runner = new AgentRunner(config);
    const agent = agentWith([sendEmail]);

    const first = await runCollecting(runner, { agent, input: 'email the boss' });

    expect(first.outcome).toMatchObject({
      status: 'interrupted',
      approvals: [
        { callId: 'call_1', toolName: 'send_email', arguments: '{"to":"boss@example.com"}' },
      ],
    });
    expect(first.events).toContainEqual({
      type: 'tool.approval_requested',
      callId: 'call_1',
      toolName: 'send_email',
      arguments: '{"to":"boss@example.com"}',
    });
    if (first.outcome.status !== 'interrupted') return;

    // The state survives a round trip through JSON storage (run_states, ADR-0010 §3).
    const saved = JSON.parse(JSON.stringify(first.outcome.state)) as string;
    const state = await AgentRunner.restore(agent, saved);
    for (const approval of state.getInterruptions()) state.approve(approval);

    const resumed = await runCollecting(runner, { agent, input: state });

    expect(resumed.outcome).toEqual({ status: 'completed', finalOutput: 'Email sent.' });
    expect(resumed.events).toContainEqual({
      type: 'tool.output',
      callId: 'call_1',
      toolName: 'send_email',
      output: 'sent to boss@example.com',
    });
  });

  it('keeps a Thread history in the session across runs', async () => {
    const { config, model } = fakeModels([
      { type: 'text', text: 'Noted: blue.' },
      { type: 'text', text: 'You said blue.' },
    ]);
    const runner = new AgentRunner(config);
    const session = new MemorySession();

    await runner.run({ agent: agentWith(), input: 'My favorite color is blue.', session });
    const second = await runner.run({ agent: agentWith(), input: 'What did I say?', session });

    expect(second).toEqual({ status: 'completed', finalOutput: 'You said blue.' });
    expect(JSON.stringify(model.calls[1]?.request.input)).toContain('My favorite color is blue.');
  });

  it('returns model failures as a failed outcome', async () => {
    const { config } = fakeModels([{ type: 'error', message: 'upstream 503' }]);

    const outcome = await new AgentRunner(config).run({ agent: agentWith(), input: 'hi' });

    expect(outcome).toEqual({ status: 'failed', error: 'upstream 503' });
  });

  it('cancels when the signal aborts', async () => {
    const { config } = fakeModels([{ type: 'text', text: 'never' }]);
    const aborted = new AbortController();
    aborted.abort();

    expect(
      await new AgentRunner(config).run({
        agent: agentWith(),
        input: 'hi',
        signal: aborted.signal,
      }),
    ).toEqual({
      status: 'canceled',
    });

    const slow = tool({
      name: 'slow',
      description: 'Takes a while.',
      parameters: z.object({}),
      execute: async () => {
        controller.abort();
        return 'done';
      },
    });
    const controller = new AbortController();
    const { config: config2 } = fakeModels([
      { type: 'tool_call', toolName: 'slow', arguments: {} },
      { type: 'text', text: 'after' },
    ]);
    const outcome = await new AgentRunner(config2).run({
      agent: agentWith([slow]),
      input: 'go',
      signal: controller.signal,
    });
    expect(outcome).toEqual({ status: 'canceled' });
  });

  it('fails a Run before main has configured a Provider', async () => {
    const outcome = await new AgentRunner(new ModelConfig()).run({
      agent: agentWith(),
      input: 'hi',
    });
    expect(outcome).toEqual({
      status: 'failed',
      error: 'No model provider configured: main has not sent provider/configure.',
    });
  });
});

describe('ModelConfig', () => {
  it('applies provider/configure from the next Run, never mid-Run', async () => {
    const firstModel = new FakeModel([
      { type: 'tool_call', toolName: 'reconfigure', arguments: {} },
      { type: 'text', text: 'from first' },
    ]);
    const secondModel = new FakeModel([{ type: 'text', text: 'from second' }]);
    const providers = new Map([
      ['first', new FakeModelProvider(firstModel)],
      ['second', new FakeModelProvider(secondModel)],
    ]);
    const config = new ModelConfig({
      createProvider: (_profile, apiKey) => providers.get(apiKey) as FakeModelProvider,
    });
    config.configure({ ...configureMessage('m1'), apiKey: 'first' });
    const reconfigure = tool({
      name: 'reconfigure',
      description: 'Main pushes new settings while this Run is busy.',
      parameters: z.object({}),
      execute: () => {
        config.configure({ ...configureMessage('m2'), apiKey: 'second' });
        return 'ok';
      },
    });
    const runner = new AgentRunner(config);

    const busy = await runner.run({ agent: agentWith([reconfigure]), input: 'go' });
    const next = await runner.run({ agent: agentWith(), input: 'again' });

    expect(busy).toEqual({ status: 'completed', finalOutput: 'from first' });
    expect(next).toEqual({ status: 'completed', finalOutput: 'from second' });
    expect(config.select()).toMatchObject({ model: 'm2', providerId: 'fake', apiType: 'openai' });
  });

  it('listens for provider/configure on a channel and validates it', () => {
    let listener: ((message: never) => void) | undefined;
    const channel = {
      onControl: (callback: (message: never) => void) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    };
    const config = new ModelConfig({
      createProvider: () => new FakeModelProvider(new FakeModel([{ type: 'text', text: '' }])),
    });

    const stop = config.listen(channel as never);
    listener?.({ kind: 'control', type: 'registry/updated' } as never);
    expect(config.configured).toBe(false);
    listener?.(configureMessage('gpt-5-mini') as never);
    expect(config.select().model).toBe('gpt-5-mini');
    stop();
    expect(listener).toBeUndefined();

    expect(() =>
      config.configure({ ...configureMessage('x'), binding: { providerId: 'other', model: 'x' } }),
    ).toThrow();
  });
});

describe('runner selection hook', () => {
  it('uses whatever selector it is given', async () => {
    const model = new FakeModel([{ type: 'text', text: 'custom' }]);
    const selector: ModelSelector = {
      select: () => ({
        provider: new FakeModelProvider(model),
        model: 'x',
        settings: undefined,
        providerId: 'p',
        apiType: 'openai_compatible',
      }),
    };
    expect(
      await new AgentRunner(selector, { workflowName: 'test' }).run({
        agent: agentWith(),
        input: 'hi',
      }),
    ).toEqual({
      status: 'completed',
      finalOutput: 'custom',
    });
  });
});
