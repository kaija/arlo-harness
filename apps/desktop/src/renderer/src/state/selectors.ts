import type { AgentId } from '@arlo/shared';
import { formatCountdown, formatElapsedShort } from '../lib/format.js';
import type { Agent, Notification, PlatformState, Task, Thread, TaskState } from './model.js';

export type Tone = 'accent' | 'warning' | 'danger' | 'idle' | 'success';
export type AgentFilter = 'all' | 'working' | 'waiting' | 'error';

export const ORCHESTRATOR_ID: AgentId = 'orchestrator';

export function isPersona(agentId: AgentId): boolean {
  return agentId !== ORCHESTRATOR_ID;
}

export function personaIdOf(agentId: AgentId): string {
  return agentId.slice('persona:'.length);
}

export function agentIdOf(personaId: string): AgentId {
  return `persona:${personaId}`;
}

export function personas(state: PlatformState): Agent[] {
  return state.agentOrder
    .filter(isPersona)
    .map((id) => state.agents[id])
    .filter((agent): agent is Agent => agent !== undefined);
}

export function filterPersonas(state: PlatformState, filter: AgentFilter, query: string): Agent[] {
  const needle = query.trim().toLowerCase();
  return personas(state).filter((agent) => {
    if (filter !== 'all' && agent.activity !== filter) return false;
    if (!needle) return true;
    const task = agent.currentTaskId ? state.tasks[agent.currentTaskId] : undefined;
    return [agent.name, agent.description, task?.title ?? ''].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });
}

/** "3 running · 1 waiting" for the Agent list header. */
export function activityCounts(state: PlatformState): {
  running: number;
  waiting: number;
  errors: number;
} {
  let running = 0;
  let waiting = 0;
  let errors = 0;
  for (const id of state.agentOrder) {
    const agent = state.agents[id];
    if (!agent) continue;
    if (agent.activity === 'working') running += 1;
    else if (agent.activity === 'waiting') waiting += 1;
    else if (agent.activity === 'error') errors += 1;
  }
  return { running, waiting, errors };
}

export function toneOfAgent(agent: Agent): Tone {
  if (agent.paused) return 'idle';
  switch (agent.activity) {
    case 'working':
      return 'accent';
    case 'waiting':
      return 'warning';
    case 'error':
      return 'danger';
    default:
      return 'idle';
  }
}

export function toneOfTask(state: TaskState): Tone {
  switch (state) {
    case 'running':
      return 'accent';
    case 'waiting':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'done':
      return 'success';
    default:
      return 'idle';
  }
}

export const TASK_STATE_LABEL: Readonly<Record<TaskState, string>> = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting for input',
  done: 'done',
  failed: 'failed',
  canceled: 'canceled',
};

/** Child tasks the Orchestrator delegated for a root task. */
export function childTasks(state: PlatformState, parentId: string): Task[] {
  return Object.values(state.tasks)
    .filter((task) => task.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function activeDelegations(state: PlatformState): Task[] {
  return Object.values(state.tasks).filter(
    (task) => task.parentId !== undefined && (task.state === 'running' || task.state === 'waiting'),
  );
}

/** One-line status under an Agent's name. */
export function agentStatusLine(state: PlatformState, agent: Agent, now: number): string {
  if (agent.config && !agent.config.enabled) return 'offline · disabled';
  if (agent.restart) {
    return `restarting · retry ${agent.restart.attempt} / ${agent.restart.maxAttempts}`;
  }
  if (agent.paused) return 'paused';
  if (agent.id === ORCHESTRATOR_ID && agent.activity === 'working') {
    const count = activeDelegations(state).length;
    return count > 0 ? `planning · ${count} delegation${count === 1 ? '' : 's'}` : 'thinking';
  }
  switch (agent.activity) {
    case 'working':
      return agent.activeSince
        ? `working · ${formatElapsedShort(now - agent.activeSince)}`
        : 'working';
    case 'waiting':
      return 'waiting for input';
    case 'error':
      return 'error';
    case 'offline':
      return 'offline';
    default:
      return 'idle';
  }
}

export function pendingInterrupts(state: PlatformState, agentId?: AgentId): Notification[] {
  return state.notifications.filter(
    (n) =>
      n.severity === 'action_required' &&
      n.interrupt !== undefined &&
      n.interrupt.resolution === undefined &&
      (agentId === undefined || n.agentId === agentId),
  );
}

/** The badge at the right of an Agent card: pending actions, a restart countdown, or queued work. */
export function agentBadge(
  state: PlatformState,
  agent: Agent,
  now: number,
): { kind: 'action' | 'countdown' | 'queued'; text: string } | undefined {
  const actions = pendingInterrupts(state, agent.id).length;
  if (actions > 0) return { kind: 'action', text: `${actions} action${actions === 1 ? '' : 's'}` };
  if (agent.restart)
    return { kind: 'countdown', text: formatCountdown(agent.restart.nextRetryAt - now) };
  if (agent.queuedTasks > 0) return { kind: 'queued', text: `+${agent.queuedTasks}` };
  return undefined;
}

export function taskProgress(task: Task): {
  done: number;
  total: number;
  percent: number;
  label: string;
} {
  if (task.counter) {
    const { done, total } = task.counter;
    return { done, total, percent: total ? (done / total) * 100 : 0, label: `${done} / ${total}` };
  }
  const total = task.steps.length;
  const done = task.steps.filter((step) => step.state === 'done').length;
  return {
    done,
    total,
    percent: total ? (done / total) * 100 : 0,
    label: total ? `${done} / ${total} steps` : '',
  };
}

export type ThreadStatus = 'pinned' | 'queued' | 'running' | 'waiting' | 'done' | 'failed';

export function threadStatus(state: PlatformState, thread: Thread): ThreadStatus {
  if (thread.source === 'user') return 'pinned';
  const task = thread.taskId ? state.tasks[thread.taskId] : undefined;
  switch (task?.state) {
    case 'running':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'queued':
      return 'queued';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'done';
  }
}

/** ADR-0009 §4: the user Thread stays on top; the rest sort by latest activity. */
export function threadsFor(state: PlatformState, agentId: AgentId, query = ''): Thread[] {
  const needle = query.trim().toLowerCase();
  return Object.values(state.threads)
    .filter((thread) => thread.agentId === agentId)
    .filter(
      (thread) =>
        !needle || thread.title.toLowerCase().includes(needle) || thread.source.includes(needle),
    )
    .sort((a, b) => {
      if (a.source === 'user' && b.source !== 'user') return -1;
      if (b.source === 'user' && a.source !== 'user') return 1;
      return b.lastActivityAt - a.lastActivityAt;
    });
}

export function userThreadId(agentId: AgentId): string {
  return agentId === ORCHESTRATOR_ID ? 'user:orchestrator' : `user:${personaIdOf(agentId)}`;
}

export function providerById(state: PlatformState, providerId: string) {
  return state.providers.find((provider) => provider.id === providerId);
}

/** "GPT-4o · temp 0.3" or "GPT-4o · 全域預設". */
export function modelLabel(agent: Agent): string {
  const name = displayModel(agent.model.model);
  if (agent.model.inherited) return `${name} · 全域預設`;
  return agent.model.temperature === undefined ? name : `${name} · temp ${agent.model.temperature}`;
}

export function displayModel(model: string): string {
  return model.replace(/^gpt/, 'GPT').replace(/-mini$/, ' mini');
}

export function isResolved(notification: Notification): boolean {
  return notification.interrupt?.resolution !== undefined;
}

/** Action center order: unresolved action-required first, then everything else newest first. */
export type ActionCenterFilter = 'all' | 'action' | 'errors';

/** A resolved request stays pinned this long so the user sees the outcome where they acted. */
export const RESOLVED_PIN_MS = 10 * 60 * 1_000;

export function actionCenterSections(
  state: PlatformState,
  filter: ActionCenterFilter,
  now: number,
): { pinned: Notification[]; earlier: Notification[] } {
  const matches = (n: Notification) =>
    filter === 'all' ||
    (filter === 'action' && n.severity === 'action_required') ||
    (filter === 'errors' && (n.severity === 'error' || n.severity === 'warning'));
  const pinnedNow = (n: Notification) =>
    n.severity === 'action_required' &&
    n.interrupt !== undefined &&
    (n.interrupt.resolvedAt === undefined || now - n.interrupt.resolvedAt < RESOLVED_PIN_MS);
  const sorted = [...state.notifications].filter(matches).sort((a, b) => b.at - a.at);
  return { pinned: sorted.filter(pinnedNow), earlier: sorted.filter((n) => !pinnedNow(n)) };
}

export function unreadCount(state: PlatformState): number {
  return state.notifications.filter((n) => !n.read).length;
}

export function runsFor(state: PlatformState, threadId: string) {
  return state.runs.filter((run) => run.threadId === threadId).sort((a, b) => a.index - b.index);
}

export function spansFor(state: PlatformState, runId: string) {
  return state.spans.filter((span) => span.runId === runId).sort((a, b) => a.startMs - b.startMs);
}
