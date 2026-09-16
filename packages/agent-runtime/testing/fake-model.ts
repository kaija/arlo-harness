import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from '@openai/agents-core';
import {
  assistantMessage,
  functionCall,
  modelError,
  modelResponse,
  ScriptedModel,
  type RecordedModelCall,
} from '@openai/agents-core/testing';

export interface FakeToolCallTurn {
  type: 'tool_call';
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface FakeTextTurn {
  type: 'text';
  text: string;
}

/** The model request fails, like a network or Provider error. */
export interface FakeErrorTurn {
  type: 'error';
  message: string;
}

export type FakeModelTurn = FakeToolCallTurn | FakeTextTurn | FakeErrorTurn;

export interface FakeModelTool {
  name: string;
  execute(args: Record<string, unknown>): Promise<string> | string;
}

export interface FakeToolCallRecord {
  toolName: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface FakeAgentRunResult {
  toolCalls: FakeToolCallRecord[];
  finalText: string;
}

/**
 * Scriptable stand-in for a real Provider model (ADR-0014 §2). Tests supply a
 * fixed sequence of turns. It implements the Agents SDK `Model` on top of the
 * SDK's own `ScriptedModel`, so the real `run()` loop drives tool calls,
 * approvals, sessions, and the same normalized stream events a Provider
 * produces (ADR-0014 consequences). Each model call consumes one turn.
 */
export class FakeModel implements Model {
  private readonly script: FakeModelTurn[];
  private cursor = 0;
  private readonly scripted = new ScriptedModel();

  constructor(script: FakeModelTurn[]) {
    if (script.length === 0) {
      throw new Error('FakeModel requires at least one scripted turn.');
    }
    this.script = script;
  }

  next(): FakeModelTurn {
    const turn = this.script[this.cursor];
    if (turn === undefined) {
      throw new Error('FakeModel script exhausted: no more scripted turns.');
    }
    this.cursor += 1;
    return turn;
  }

  get remaining(): number {
    return this.script.length - this.cursor;
  }

  /** Requests the SDK sent, for asserting on instructions, tools, and history. */
  get calls(): readonly RecordedModelCall[] {
    return this.scripted.calls;
  }

  getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.enqueueNextTurn();
    return this.scripted.getResponse(request);
  }

  getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    this.enqueueNextTurn();
    return this.scripted.getStreamedResponse(request);
  }

  private enqueueNextTurn(): void {
    const turnIndex = this.cursor;
    const turn = this.next();
    switch (turn.type) {
      case 'text':
        this.scripted.enqueue(modelResponse([assistantMessage(turn.text)]));
        return;
      case 'tool_call':
        this.scripted.enqueue(
          modelResponse([
            functionCall(turn.toolName, turn.arguments, { callId: `call_${turnIndex + 1}` }),
          ]),
        );
        return;
      case 'error':
        this.scripted.enqueue(modelError(new Error(turn.message)));
        return;
    }
  }
}

/** Serves one FakeModel for every model name, in place of a Provider. */
export class FakeModelProvider implements ModelProvider {
  readonly requestedModels: (string | undefined)[] = [];
  private readonly model: FakeModel;

  constructor(model: FakeModel) {
    this.model = model;
  }

  getModel(modelName?: string): Model {
    this.requestedModels.push(modelName);
    return this.model;
  }
}

/** Minimal tool-calling loop without the SDK, for tests that only need scripted turns. */
export async function runFakeAgentLoop(
  model: FakeModel,
  tools: FakeModelTool[],
): Promise<FakeAgentRunResult> {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolCalls: FakeToolCallRecord[] = [];

  for (;;) {
    const turn = model.next();
    if (turn.type === 'text') {
      return { toolCalls, finalText: turn.text };
    }
    if (turn.type === 'error') {
      throw new Error(turn.message);
    }

    const tool = toolsByName.get(turn.toolName);
    if (!tool) {
      throw new Error(`FakeModel requested unknown tool "${turn.toolName}".`);
    }
    const result = await tool.execute(turn.arguments);
    toolCalls.push({ toolName: turn.toolName, arguments: turn.arguments, result });
  }
}
