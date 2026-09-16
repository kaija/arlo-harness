import { Task, TaskState } from '@a2a-js/sdk';
import {
  awaitingInterruptPayloadSchema,
  type AwaitingInterruptPayload,
  type TaskState as ArloTaskState,
} from '@arlo/shared';

const ARLO_TASK_STATES: Readonly<Partial<Record<TaskState, ArloTaskState>>> = Object.freeze({
  [TaskState.TASK_STATE_SUBMITTED]: 'submitted',
  [TaskState.TASK_STATE_WORKING]: 'working',
  [TaskState.TASK_STATE_INPUT_REQUIRED]: 'input-required',
  [TaskState.TASK_STATE_AUTH_REQUIRED]: 'auth-required',
  [TaskState.TASK_STATE_COMPLETED]: 'completed',
  [TaskState.TASK_STATE_FAILED]: 'failed',
  [TaskState.TASK_STATE_CANCELED]: 'canceled',
  [TaskState.TASK_STATE_REJECTED]: 'rejected',
});

/** Maps an A2A v1.0 task state to Arlo's; `undefined` for unspecified or unknown states. */
export function arloTaskState(state: TaskState): ArloTaskState | undefined {
  return ARLO_TASK_STATES[state];
}

/**
 * The HITL payload of an `input-required` Task: the first DataPart of its
 * status message that is a valid awaiting interrupt (ADR-0010).
 */
export function interruptOfTask(task: Task): AwaitingInterruptPayload | undefined {
  for (const part of task.status?.message?.parts ?? []) {
    if (part.content?.$case !== 'data') continue;
    const parsed = awaitingInterruptPayloadSchema.safeParse(part.content.value);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

export interface TaskSummary {
  taskId: string;
  contextId: string;
  state: ArloTaskState | undefined;
  interrupt: AwaitingInterruptPayload | undefined;
}

/** Reads the fields main indexes from a Task stored as A2A JSON (`Task.toJSON`). */
export function summarizeTaskJson(json: unknown): TaskSummary {
  const task = Task.fromJSON(json);
  const state = task.status === undefined ? undefined : arloTaskState(task.status.state);
  return {
    taskId: task.id,
    contextId: task.contextId,
    state,
    interrupt: state === 'input-required' ? interruptOfTask(task) : undefined,
  };
}
