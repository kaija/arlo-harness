import {
  Agent,
  RunAgentUpdatedStreamEvent,
  RunItemStreamEvent,
  RunMessageOutputItem,
  RunRawModelStreamEvent,
  RunReasoningItem,
  RunToolApprovalItem,
  RunToolCallItem,
  RunToolCallOutputItem,
} from '@openai/agents-core';
import { agentRunEventSchema } from '@arlo/shared';
import { describe, expect, it } from 'vitest';
import { toAgentRunEvents } from '../src/index.js';

const agent = new Agent({ name: 'Writer', instructions: 'Write.' });

function itemEvent(name: RunItemStreamEvent['name'], item: unknown) {
  return toAgentRunEvents(new RunItemStreamEvent(name, item as never));
}

describe('toAgentRunEvents', () => {
  it('maps text deltas and usage from raw model events and ignores the rest', () => {
    expect(
      toAgentRunEvents(new RunRawModelStreamEvent({ type: 'output_text_delta', delta: 'Hi' })),
    ).toEqual([{ type: 'message.delta', delta: 'Hi' }]);
    expect(
      toAgentRunEvents(
        new RunRawModelStreamEvent({
          type: 'response_done',
          response: {
            id: 'r',
            output: [],
            usage: { requests: 1, inputTokens: 7, outputTokens: 2, totalTokens: 9 },
          },
        } as never),
      ),
    ).toEqual([{ type: 'usage', inputTokens: 7, outputTokens: 2, totalTokens: 9 }]);
    expect(toAgentRunEvents(new RunRawModelStreamEvent({ type: 'response_started' }))).toEqual([]);
    expect(
      toAgentRunEvents(new RunRawModelStreamEvent({ type: 'model', event: { anything: 1 } })),
    ).toEqual([]);
  });

  it('reports handoffs to another agent', () => {
    expect(toAgentRunEvents(new RunAgentUpdatedStreamEvent(agent))).toEqual([
      { type: 'agent.updated', agentName: 'Writer' },
    ]);
  });

  it('joins output text and refusals and skips other content', () => {
    const message = new RunMessageOutputItem(
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'output_text', text: 'Part one. ' },
          { type: 'refusal', refusal: 'I cannot do the rest.' },
          { type: 'audio', audio: 'base64' } as never,
        ],
      },
      agent,
    );
    expect(itemEvent('message_output_created', message)).toEqual([
      { type: 'message.completed', text: 'Part one. I cannot do the rest.' },
    ]);
    expect(itemEvent('message_output_created', { rawItem: { content: 'not a list' } })).toEqual([
      { type: 'message.completed', text: '' },
    ]);
  });

  it('includes reasoning only when the Provider returned text', () => {
    const withSummary = new RunReasoningItem(
      {
        type: 'reasoning',
        content: [
          { type: 'input_text', text: 'Step 1' },
          { type: 'input_text', text: 'Step 2' },
        ],
      },
      agent,
    );
    expect(itemEvent('reasoning_item_created', withSummary)).toEqual([
      { type: 'reasoning.completed', text: 'Step 1\nStep 2' },
    ]);
    expect(
      itemEvent('reasoning_item_created', {
        rawItem: {
          type: 'reasoning',
          content: [],
          rawContent: [{ type: 'reasoning_text', text: 'raw' }],
        },
      }),
    ).toEqual([]);
    expect(itemEvent('reasoning_item_created', { rawItem: { type: 'reasoning' } })).toEqual([]);
  });

  it('maps tool calls, approvals, and outputs, stringifying structured values', () => {
    const call = new RunToolCallItem(
      { type: 'function_call', callId: 'c1', name: 'lookup', arguments: '{"q":1}' },
      agent,
    );
    const approval = new RunToolApprovalItem(
      { type: 'function_call', callId: 'c2', name: 'send_email', arguments: '{}' },
      agent,
    );
    const output = new RunToolCallOutputItem(
      {
        type: 'function_call_result',
        callId: 'c1',
        name: 'lookup',
        status: 'completed',
        output: { type: 'text', text: 'ok' },
      },
      agent,
      { rows: 3 },
    );

    expect(itemEvent('tool_called', call)).toEqual([
      { type: 'tool.called', callId: 'c1', toolName: 'lookup', arguments: '{"q":1}' },
    ]);
    expect(itemEvent('tool_approval_requested', approval)).toEqual([
      { type: 'tool.approval_requested', callId: 'c2', toolName: 'send_email', arguments: '{}' },
    ]);
    expect(itemEvent('tool_output', output)).toEqual([
      { type: 'tool.output', callId: 'c1', toolName: 'lookup', output: '{"rows":3}' },
    ]);
  });

  it('skips tool items it cannot attribute and hosted tools without a name', () => {
    expect(itemEvent('tool_called', { rawItem: { type: 'hosted_tool_call', id: 'h1' } })).toEqual(
      [],
    );
    expect(itemEvent('tool_approval_requested', { rawItem: { name: 'x' } })).toEqual([]);
    expect(itemEvent('tool_output', { rawItem: { name: 'x' }, output: 'y' })).toEqual([]);
    expect(
      itemEvent('tool_called', {
        rawItem: { callId: 'c', name: 'shell', arguments: { cmd: 'ls' } },
      }),
    ).toEqual([{ type: 'tool.called', callId: 'c', toolName: 'shell', arguments: '{"cmd":"ls"}' }]);
    expect(itemEvent('tool_called', { rawItem: { callId: 'c', name: 'noargs' } })).toEqual([
      { type: 'tool.called', callId: 'c', toolName: 'noargs', arguments: '{}' },
    ]);
    expect(itemEvent('tool_output', { rawItem: { callId: 'c' }, output: undefined })).toEqual([
      { type: 'tool.output', callId: 'c', toolName: 'unknown', output: '' },
    ]);
    expect(itemEvent('handoff_requested', { rawItem: {} })).toEqual([]);
  });

  it('only produces schema-valid events', () => {
    const events = [
      ...toAgentRunEvents(new RunRawModelStreamEvent({ type: 'output_text_delta', delta: '' })),
      ...itemEvent('tool_output', { rawItem: { callId: 'c' }, output: 'plain' }),
    ];
    for (const event of events) expect(agentRunEventSchema.safeParse(event).success).toBe(true);
  });
});
