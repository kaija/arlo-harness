import { z } from 'zod';

const toolCallFields = {
  callId: z.string().min(1),
  toolName: z.string().min(1),
  /** The model's raw JSON argument string. */
  arguments: z.string(),
};

/**
 * One step of a Run as the Agent streams it to main for the panel (ADR-0011
 * §10), normalized from the Agents SDK stream so it is plain JSON and stable
 * across SDK versions. Main adds which Agent, Thread, and Task it belongs to.
 */
export const agentRunEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('message.delta'), delta: z.string() }),
  z.strictObject({ type: z.literal('message.completed'), text: z.string() }),
  /** Only when the Provider returns reasoning summaries. */
  z.strictObject({ type: z.literal('reasoning.completed'), text: z.string() }),
  z.strictObject({ type: z.literal('tool.called'), ...toolCallFields }),
  z.strictObject({
    type: z.literal('tool.output'),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    output: z.string(),
  }),
  z.strictObject({ type: z.literal('tool.approval_requested'), ...toolCallFields }),
  z.strictObject({ type: z.literal('agent.updated'), agentName: z.string().min(1) }),
  z.strictObject({
    type: z.literal('usage'),
    inputTokens: z.int().min(0),
    outputTokens: z.int().min(0),
    totalTokens: z.int().min(0),
  }),
]);
export type AgentRunEvent = z.infer<typeof agentRunEventSchema>;
export type AgentRunEventType = AgentRunEvent['type'];
