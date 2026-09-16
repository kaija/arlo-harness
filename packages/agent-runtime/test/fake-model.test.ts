import { describe, expect, it } from 'vitest';
import { FakeModel, runFakeAgentLoop } from '../testing/fake-model.js';

describe('FakeModel', () => {
  it('returns scripted turns in order and reports remaining count', () => {
    const model = new FakeModel([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]);

    expect(model.remaining).toBe(2);
    expect(model.next()).toEqual({ type: 'text', text: 'hello' });
    expect(model.remaining).toBe(1);
    expect(model.next()).toEqual({ type: 'text', text: 'world' });
  });

  it('throws when constructed with an empty script', () => {
    expect(() => new FakeModel([])).toThrow('at least one scripted turn');
  });

  it('throws once the script is exhausted', () => {
    const model = new FakeModel([{ type: 'text', text: 'done' }]);
    model.next();
    expect(() => model.next()).toThrow('script exhausted');
  });
});

describe('runFakeAgentLoop', () => {
  it('drives a tool call and feeds the result back before finishing', async () => {
    const model = new FakeModel([
      { type: 'tool_call', toolName: 'lookup', arguments: { query: 'weather' } },
      { type: 'text', text: 'It is sunny.' },
    ]);
    const lookup = {
      name: 'lookup',
      execute: (args: Record<string, unknown>) => `result for ${String(args.query)}`,
    };

    const result = await runFakeAgentLoop(model, [lookup]);

    expect(result.finalText).toBe('It is sunny.');
    expect(result.toolCalls).toEqual([
      { toolName: 'lookup', arguments: { query: 'weather' }, result: 'result for weather' },
    ]);
  });

  it('supports multiple chained tool calls before the final text turn', async () => {
    const model = new FakeModel([
      { type: 'tool_call', toolName: 'a', arguments: {} },
      { type: 'tool_call', toolName: 'b', arguments: {} },
      { type: 'text', text: 'done' },
    ]);
    const tools = [
      { name: 'a', execute: () => 'a-result' },
      { name: 'b', execute: async () => 'b-result' },
    ];

    const result = await runFakeAgentLoop(model, tools);

    expect(result.toolCalls.map((call) => call.result)).toEqual(['a-result', 'b-result']);
    expect(result.finalText).toBe('done');
  });

  it('throws when the model requests a tool that was not provided', async () => {
    const model = new FakeModel([{ type: 'tool_call', toolName: 'missing', arguments: {} }]);

    await expect(runFakeAgentLoop(model, [])).rejects.toThrow(
      'requested unknown tool "missing"',
    );
  });
});
