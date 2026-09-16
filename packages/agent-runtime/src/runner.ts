import {
  Runner,
  RunState,
  type Agent,
  type AgentInputItem,
  type RunToolApprovalItem,
  type Session,
} from '@openai/agents-core';
import type { AgentRunEvent } from '@arlo/shared';
import type { ModelSelector } from './model-config.js';
import { toAgentRunEvents } from './run-events.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<any, any>;

export interface ToolApprovalRequest {
  callId: string;
  toolName: string;
  arguments: string;
}

export type AgentRunOutcome =
  | { status: 'completed'; finalOutput: string }
  /** Tools waiting for approval. `state` is the serialized RunState to resume from (ADR-0010 §3). */
  | { status: 'interrupted'; approvals: ToolApprovalRequest[]; state: string }
  | { status: 'canceled' }
  | { status: 'failed'; error: string };

export interface AgentRunRequest<TAgent extends AnyAgent> {
  agent: TAgent;
  /** New input, or a RunState restored with {@link AgentRunner.restore} after approvals. */
  input: string | AgentInputItem[] | RunState<unknown, TAgent>;
  /** The Thread's history (ADR-0009 §1). */
  session?: Session;
  signal?: AbortSignal;
  maxTurns?: number;
  onEvent?: (event: AgentRunEvent) => void;
}

function approvalOf(item: RunToolApprovalItem): ToolApprovalRequest {
  const rawItem = item.rawItem as {
    callId?: unknown;
    id?: unknown;
    name?: unknown;
    arguments?: unknown;
  };
  return {
    callId: typeof rawItem.callId === 'string' ? rawItem.callId : String(rawItem.id ?? ''),
    toolName: item.toolName ?? (typeof rawItem.name === 'string' ? rawItem.name : 'unknown'),
    arguments:
      typeof rawItem.arguments === 'string'
        ? rawItem.arguments
        : JSON.stringify(rawItem.arguments ?? {}),
  };
}

function finalOutputText(output: unknown): string {
  if (output === undefined || output === null) return '';
  return typeof output === 'string' ? output : JSON.stringify(output);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs an Agent in streaming mode with the Provider selected when the Run
 * starts (ADR-0003 §1, §4) and reports each step as a normalized event. Every
 * outcome is returned rather than thrown, so the caller can map it onto the
 * A2A Task (completed, input-required, canceled, failed).
 *
 * Tracing stays on; spans go to whatever processors are registered. This
 * package imports `@openai/agents-core` and `@openai/agents-openai` directly
 * because the `@openai/agents` entry point registers the OpenAI trace uploader
 * on import (ADR-0011 §9).
 */
export class AgentRunner {
  readonly #models: ModelSelector;
  readonly #workflowName: string;

  constructor(models: ModelSelector, options: { workflowName?: string } = {}) {
    this.#models = models;
    this.#workflowName = options.workflowName ?? 'Arlo Agent run';
  }

  /** Rebuilds a RunState saved from an interrupted outcome so it can be approved and resumed. */
  static restore<TAgent extends AnyAgent>(
    agent: TAgent,
    state: string,
  ): Promise<RunState<unknown, TAgent>> {
    return RunState.fromString(agent, state);
  }

  async run<TAgent extends AnyAgent>(request: AgentRunRequest<TAgent>): Promise<AgentRunOutcome> {
    const { signal } = request;
    if (signal?.aborted) return { status: 'canceled' };
    let selection;
    try {
      selection = this.#models.select();
    } catch (error) {
      return { status: 'failed', error: errorMessage(error) };
    }
    const runner = new Runner({
      modelProvider: selection.provider,
      model: selection.model,
      ...(selection.settings === undefined ? {} : { modelSettings: selection.settings }),
      workflowName: this.#workflowName,
    });

    try {
      const result = await runner.run(request.agent, request.input, {
        stream: true,
        ...(request.session === undefined ? {} : { session: request.session }),
        ...(signal === undefined ? {} : { signal }),
        ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }),
      });
      for await (const event of result) {
        for (const normalized of toAgentRunEvents(event)) request.onEvent?.(normalized);
      }
      await result.completed;
      if (result.cancelled || signal?.aborted) return { status: 'canceled' };
      if (result.error !== undefined && result.error !== null) {
        return { status: 'failed', error: errorMessage(result.error) };
      }
      if (result.interruptions.length > 0) {
        return {
          status: 'interrupted',
          approvals: result.interruptions.map(approvalOf),
          state: result.state.toString(),
        };
      }
      return { status: 'completed', finalOutput: finalOutputText(result.finalOutput) };
    } catch (error) {
      if (signal?.aborted) return { status: 'canceled' };
      return { status: 'failed', error: errorMessage(error) };
    }
  }
}
