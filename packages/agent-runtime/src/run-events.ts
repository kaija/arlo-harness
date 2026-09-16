import type { RunItem, RunStreamEvent } from '@openai/agents-core';
import type { AgentRunEvent } from '@arlo/shared';

type ToolCallRawItem = { callId?: unknown; name?: unknown; arguments?: unknown };

function toolCallFields(
  rawItem: unknown,
): { callId: string; toolName: string; arguments: string } | undefined {
  const item = rawItem as ToolCallRawItem | undefined;
  if (typeof item?.callId !== 'string' || typeof item.name !== 'string') return undefined;
  return {
    callId: item.callId,
    toolName: item.name,
    arguments:
      typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
  };
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

function messageText(item: RunItem): string {
  const content = (item.rawItem as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: { type?: unknown; text?: unknown; refusal?: unknown }) => {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
      if (part.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
      return '';
    })
    .join('');
}

function reasoningText(item: RunItem): string {
  const rawItem = item.rawItem as { content?: unknown; rawContent?: unknown } | undefined;
  const parts = [rawItem?.content, rawItem?.rawContent].find(Array.isArray) as
    { text?: unknown }[] | undefined;
  return (parts ?? []).map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n');
}

/**
 * Normalizes one Agents SDK stream event into zero or more JSON events for
 * the panel (ADR-0011 §10). Raw provider events other than text deltas and
 * the final usage are dropped; the run items carry the same information in a
 * provider-neutral form.
 */
export function toAgentRunEvents(event: RunStreamEvent): AgentRunEvent[] {
  switch (event.type) {
    case 'raw_model_stream_event': {
      const data = event.data;
      if (data.type === 'output_text_delta') return [{ type: 'message.delta', delta: data.delta }];
      if (data.type === 'response_done') {
        const { inputTokens, outputTokens, totalTokens } = data.response.usage;
        return [{ type: 'usage', inputTokens, outputTokens, totalTokens }];
      }
      return [];
    }
    case 'agent_updated_stream_event':
      return [{ type: 'agent.updated', agentName: event.agent.name }];
    case 'run_item_stream_event': {
      const { item } = event;
      switch (event.name) {
        case 'message_output_created':
          return [{ type: 'message.completed', text: messageText(item) }];
        case 'reasoning_item_created': {
          const text = reasoningText(item);
          return text === '' ? [] : [{ type: 'reasoning.completed', text }];
        }
        case 'tool_called': {
          const fields = toolCallFields(item.rawItem);
          return fields === undefined ? [] : [{ type: 'tool.called', ...fields }];
        }
        case 'tool_approval_requested': {
          const fields = toolCallFields(item.rawItem);
          return fields === undefined ? [] : [{ type: 'tool.approval_requested', ...fields }];
        }
        case 'tool_output': {
          const rawItem = item.rawItem as { callId?: unknown; name?: unknown } | undefined;
          if (typeof rawItem?.callId !== 'string') return [];
          return [
            {
              type: 'tool.output',
              callId: rawItem.callId,
              toolName: typeof rawItem.name === 'string' ? rawItem.name : 'unknown',
              output: textOf((item as { output?: unknown }).output),
            },
          ];
        }
        default:
          return [];
      }
    }
  }
}
