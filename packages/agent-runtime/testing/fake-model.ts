export interface FakeToolCallTurn {
  type: 'tool_call';
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface FakeTextTurn {
  type: 'text';
  text: string;
}

export type FakeModelTurn = FakeToolCallTurn | FakeTextTurn;

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
 * Scriptable stand-in for a real Provider model (ADR-0014). Tests supply a
 * fixed sequence of turns so Orchestrator/Persona flows can be driven without
 * calling a live API; `runFakeAgentLoop` shapes the interaction the same way
 * a real tool-calling loop would (tool_call turns until a text turn ends it).
 */
export class FakeModel {
  private readonly script: FakeModelTurn[];
  private cursor = 0;

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
}

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

    const tool = toolsByName.get(turn.toolName);
    if (!tool) {
      throw new Error(`FakeModel requested unknown tool "${turn.toolName}".`);
    }
    const result = await tool.execute(turn.arguments);
    toolCalls.push({ toolName: turn.toolName, arguments: turn.arguments, result });
  }
}
