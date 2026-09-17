import type { AgentId, InterruptAnswer, RiskLevel } from '@arlo/shared';
import type {
  Agent,
  AppLocale,
  ChatItem,
  ForwardRule,
  InterruptResolution,
  McpServer,
  Notification,
  PersonaConfig,
  PlatformState,
  Provider,
  Severity,
  Task,
  ToolSource,
} from './model.js';

/*
 * Every user action in the renderer is one of these JSON commands. Until the
 * renderer API (T20) exists they are applied locally by `applyCommand` and
 * mirrored to the other windows; afterwards each maps to an `invoke` call and
 * the resulting `state/*` push replaces the local update.
 */
export type Command =
  | { type: 'interrupt/answer'; notificationId: string; answer: InterruptAnswer; edited?: string }
  | { type: 'interrupt/skip'; notificationId: string }
  | { type: 'toolError/resolve'; notificationId: string; action: 'retry' | 'ignore' }
  | { type: 'notifications/markRead'; notificationId: string }
  | { type: 'notifications/markAllRead' }
  | { type: 'task/cancel'; taskId: string }
  | { type: 'agent/setPaused'; agentId: AgentId; paused: boolean }
  | { type: 'agent/retryNow'; agentId: AgentId }
  | { type: 'agent/setDriver'; agentId: AgentId; driver: 'agent' | 'user' }
  | { type: 'agent/selectTab'; agentId: AgentId; tabId: string }
  | {
      type: 'message/send';
      agentId: AgentId;
      threadId: string;
      text: string;
      mode: 'sync' | 'async';
    }
  | { type: 'persona/update'; agentId: AgentId; patch: PersonaPatch }
  | { type: 'persona/setToolRisk'; agentId: AgentId; toolKey: string; risk: RiskLevel }
  | { type: 'persona/setSourceRisk'; agentId: AgentId; sourceLabel: string; risk: RiskLevel }
  | { type: 'persona/setSkill'; agentId: AgentId; skill: string; enabled: boolean }
  | { type: 'persona/trustSkill'; agentId: AgentId; skill: string }
  | { type: 'persona/create'; persona: NewPersona }
  | { type: 'persona/setEnabled'; agentId: AgentId; enabled: boolean }
  | { type: 'persona/delete'; agentId: AgentId; removeWorkdir: boolean; removeBrowserData: boolean }
  | { type: 'persona/addMcpServer'; agentId: AgentId; server: McpServer }
  | { type: 'persona/removeMcpServer'; agentId: AgentId; name: string }
  | { type: 'persona/clearBrowserData'; agentId: AgentId }
  | { type: 'persona/rotateWebhookToken'; agentId: AgentId; tokenLast4: string }
  | { type: 'provider/add'; provider: Provider }
  | { type: 'provider/testResult'; providerId: string; ok: boolean; message?: string }
  | { type: 'defaults/set'; providerId: string; model: string }
  | { type: 'rule/add'; rule: ForwardRule }
  | { type: 'schedule/setEnabled'; scheduleId: string; enabled: boolean }
  | { type: 'schedule/setTemplate'; scheduleId: string; template: string }
  | { type: 'schedule/runNow'; scheduleId: string }
  | { type: 'rule/setEnabled'; ruleId: string; enabled: boolean }
  | { type: 'settings/toast'; enabled: boolean; minSeverity: Severity }
  | { type: 'settings/setLocale'; locale: AppLocale }
  | { type: 'settings/orchestratorPrompt'; prompt: string }
  | { type: 'onboarding/complete' };

export type PersonaPatch = Partial<
  Pick<Agent, 'name' | 'description' | 'initials'> &
    Pick<
      PersonaConfig,
      'systemPrompt' | 'maxConcurrency' | 'delegationTimeoutMinutes' | 'browserEnabled'
    > & {
      temperature: number;
      model: string;
      providerId: string;
      inheritModel: boolean;
    }
>;

export interface NewPersona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  browserEnabled: boolean;
}

export function toolSourceLabel(source: ToolSource): string {
  switch (source.kind) {
    case 'built-in':
      return 'built-in';
    case 'mcp':
      return `MCP · ${source.server}`;
    case 'skill':
      return `skill · ${source.skill}`;
  }
}

/** Initials for a new Persona: two Latin letters, or the first CJK character. */
export function initialsFor(name: string): string {
  const latin = name.match(/[A-Za-z0-9]+/g);
  if (latin && latin.length > 0) {
    const letters = latin.length > 1 ? `${latin[0]![0]}${latin[1]![0]}` : latin[0]!.slice(0, 2);
    return letters.toUpperCase();
  }
  return Array.from(name.trim())[0] ?? '?';
}

let sequence = 0;
function nextId(prefix: string, now: number): string {
  sequence += 1;
  return `${prefix}-${now.toString(36)}-${sequence}`;
}

// Small immutable helpers keep each case readable without an Immer dependency.
function patchAgent(
  state: PlatformState,
  agentId: AgentId,
  patch: (agent: Agent) => Agent,
): PlatformState {
  const agent = state.agents[agentId];
  if (!agent) return state;
  return { ...state, agents: { ...state.agents, [agentId]: patch(agent) } };
}

function patchConfig(
  state: PlatformState,
  agentId: AgentId,
  patch: (config: PersonaConfig) => PersonaConfig,
): PlatformState {
  return patchAgent(state, agentId, (agent) =>
    agent.config ? { ...agent, config: patch(agent.config) } : agent,
  );
}

function patchTask(
  state: PlatformState,
  taskId: string,
  patch: (task: Task) => Task,
): PlatformState {
  const task = state.tasks[taskId];
  if (!task) return state;
  return { ...state, tasks: { ...state.tasks, [taskId]: patch(task) } };
}

function patchNotification(
  state: PlatformState,
  notificationId: string,
  patch: (notification: Notification) => Notification,
): PlatformState {
  return {
    ...state,
    notifications: state.notifications.map((n) => (n.id === notificationId ? patch(n) : n)),
  };
}

function appendItem(state: PlatformState, threadId: string, item: ChatItem): PlatformState {
  const thread = state.threads[threadId];
  return {
    ...state,
    threads: thread
      ? { ...state.threads, [threadId]: { ...thread, lastActivityAt: item.at } }
      : state.threads,
    threadItems: {
      ...state.threadItems,
      [threadId]: [...(state.threadItems[threadId] ?? []), item],
    },
  };
}

function resolveInterrupt(
  state: PlatformState,
  notificationId: string,
  resolution: InterruptResolution,
  now: number,
  note?: string,
): { state: PlatformState; notification?: Notification } {
  const notification = state.notifications.find((n) => n.id === notificationId);
  if (!notification?.interrupt || notification.interrupt.resolution) return { state };
  const interrupt = { ...notification.interrupt, resolution, resolvedAt: now, note };
  const resolved = { ...notification, read: true, interrupt };
  return {
    state: patchNotification(state, notificationId, () => resolved),
    notification: resolved,
  };
}

/** A human answered: the waiting step completes and the Task and Agent run again. */
function resumeTask(
  state: PlatformState,
  taskId: string | undefined,
  stepLabel: string,
  now: number,
) {
  if (!taskId) return state;
  const task = state.tasks[taskId];
  if (!task || (task.state !== 'waiting' && task.state !== 'running')) return state;
  let next = patchTask(state, taskId, (t) => ({
    ...t,
    state: 'running',
    waitingSince: undefined,
    steps: t.steps.map((step) =>
      step.state === 'waiting' ? { label: stepLabel, state: 'done' } : step,
    ),
    lastAction: { text: stepLabel, at: now },
  }));
  const agent = next.agents[task.agentId];
  if (agent && agent.activity === 'waiting' && agent.currentTaskId === taskId) {
    next = patchAgent(next, task.agentId, (a) => ({ ...a, activity: 'working', activeSince: now }));
  }
  return next;
}

export function applyCommand(state: PlatformState, command: Command, now: number): PlatformState {
  switch (command.type) {
    case 'interrupt/answer': {
      const { answer } = command;
      const resolution: InterruptResolution =
        answer.type === 'approval'
          ? answer.decision === 'reject'
            ? 'rejected'
            : command.edited
              ? 'approved_with_edits'
              : 'approved'
          : answer.type === 'answer'
            ? 'answered'
            : 'resumed';
      const note = answer.type === 'answer' ? answer.text : command.edited;
      const { state: next, notification } = resolveInterrupt(
        state,
        command.notificationId,
        resolution,
        now,
        note,
      );
      if (!notification?.interrupt) return state;
      const payload = notification.interrupt.payload;
      let stepLabel: string;
      switch (payload.type) {
        case 'tool_approval':
          stepLabel = `${payload.toolName} ${resolution === 'rejected' ? '已拒絕' : '已批准'}`;
          break;
        case 'question':
          stepLabel = `已回答：${note ?? ''}`;
          break;
        case 'auth_required':
        case 'captcha':
          stepLabel = `${payload.type === 'captcha' ? '驗證碼' : '登入'}已完成 · ${payload.site}`;
          break;
        case 'tool_error':
          // Reports only; answered through `toolError/resolve`.
          return state;
      }
      return resumeTask(next, notification.taskId, stepLabel, now);
    }
    case 'interrupt/skip': {
      const { state: next, notification } = resolveInterrupt(
        state,
        command.notificationId,
        'skipped',
        now,
      );
      if (!notification) return state;
      return resumeTask(next, notification.taskId, '略過需要登入的步驟', now);
    }
    case 'toolError/resolve': {
      const resolution = command.action === 'retry' ? 'retried' : 'ignored';
      return resolveInterrupt(state, command.notificationId, resolution, now).state;
    }
    case 'notifications/markRead':
      return patchNotification(state, command.notificationId, (n) => ({ ...n, read: true }));
    case 'notifications/markAllRead':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };
    case 'task/cancel': {
      const task = state.tasks[command.taskId];
      if (!task || ['done', 'failed', 'canceled'].includes(task.state)) return state;
      let next = patchTask(state, command.taskId, (t) => ({
        ...t,
        state: 'canceled',
        endedAt: now,
        waitingSince: undefined,
        steps: t.steps.map((step) =>
          step.state === 'done' || step.state === 'error' ? step : { ...step, state: 'queued' },
        ),
      }));
      for (const n of state.notifications) {
        if (n.taskId === command.taskId && n.interrupt && !n.interrupt.resolution) {
          next = resolveInterrupt(next, n.id, 'canceled', now).state;
        }
      }
      const agent = next.agents[task.agentId];
      if (agent?.currentTaskId === command.taskId) {
        next = patchAgent(next, task.agentId, (a) => ({
          ...a,
          activity: a.activity === 'error' ? a.activity : 'idle',
          currentTaskId: undefined,
          activeSince: undefined,
        }));
      }
      return appendItem(next, task.threadId, {
        id: nextId('item', now),
        kind: 'system',
        tone: 'warning',
        at: now,
        text: `已取消 · ${task.title}`,
      });
    }
    case 'agent/setPaused':
      return patchAgent(state, command.agentId, (a) => ({ ...a, paused: command.paused }));
    case 'agent/retryNow':
      return patchAgent(state, command.agentId, (a) =>
        a.restart ? { ...a, restart: { ...a.restart, nextRetryAt: now } } : a,
      );
    case 'agent/setDriver':
      return patchAgent(state, command.agentId, (a) =>
        a.browser ? { ...a, browser: { ...a.browser, driver: command.driver } } : a,
      );
    case 'agent/selectTab':
      return patchAgent(state, command.agentId, (a) =>
        a.browser ? { ...a, browser: { ...a.browser, activeTabId: command.tabId } } : a,
      );
    case 'message/send': {
      const text = command.text.trim();
      const thread = state.threads[command.threadId];
      if (!text || !thread) return state;
      const agent = state.agents[command.agentId];
      // ADR-0009: a message typed while the Agent runs is handled on its next turn.
      const deferred = agent?.activity === 'working' || agent?.activity === 'waiting';
      let next = appendItem(state, command.threadId, {
        id: nextId('item', now),
        kind: 'user',
        at: now,
        text,
        deferred,
      });
      if (command.mode === 'async') {
        next = appendItem(next, command.threadId, {
          id: nextId('item', now),
          kind: 'system',
          tone: 'info',
          at: now,
          text: '已派發為背景任務 · 完成時會出現在 Action center',
        });
      }
      return next;
    }
    case 'persona/update': {
      const { patch } = command;
      return patchAgent(state, command.agentId, (a) => {
        const model =
          patch.inheritModel === true
            ? {
                providerId: state.defaults.providerId,
                model: state.defaults.model,
                inherited: true,
              }
            : {
                ...a.model,
                inherited: patch.inheritModel === false ? false : a.model.inherited,
                ...(patch.providerId !== undefined && { providerId: patch.providerId }),
                ...(patch.model !== undefined && { model: patch.model }),
                ...(patch.temperature !== undefined && { temperature: patch.temperature }),
              };
        return {
          ...a,
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.initials !== undefined && { initials: patch.initials }),
          model,
          config: a.config && {
            ...a.config,
            ...(patch.systemPrompt !== undefined && { systemPrompt: patch.systemPrompt }),
            ...(patch.maxConcurrency !== undefined && { maxConcurrency: patch.maxConcurrency }),
            ...(patch.delegationTimeoutMinutes !== undefined && {
              delegationTimeoutMinutes: patch.delegationTimeoutMinutes,
            }),
            ...(patch.browserEnabled !== undefined && { browserEnabled: patch.browserEnabled }),
          },
        };
      });
    }
    case 'persona/setToolRisk':
      return patchConfig(state, command.agentId, (c) => ({
        ...c,
        tools: c.tools.map((t) => (t.key === command.toolKey ? { ...t, risk: command.risk } : t)),
      }));
    case 'persona/setSourceRisk':
      return patchConfig(state, command.agentId, (c) => ({
        ...c,
        tools: c.tools.map((t) =>
          toolSourceLabel(t.source) === command.sourceLabel ? { ...t, risk: command.risk } : t,
        ),
      }));
    case 'persona/setSkill':
      return patchConfig(state, command.agentId, (c) => ({
        ...c,
        // Code-carrying skills stay off until trusted (ADR-0008).
        skills: c.skills.map((s) =>
          s.name === command.skill && (s.trusted || !command.enabled)
            ? { ...s, enabled: command.enabled }
            : s,
        ),
      }));
    case 'persona/trustSkill':
      return patchConfig(state, command.agentId, (c) => ({
        ...c,
        skills: c.skills.map((s) =>
          s.name === command.skill ? { ...s, trusted: true, enabled: true } : s,
        ),
      }));
    case 'persona/create': {
      const { persona } = command;
      const agentId = `persona:${persona.id}` as AgentId;
      if (state.agents[agentId]) return state;
      const threadId = `user:${persona.id}`;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: {
            id: agentId,
            name: persona.name,
            initials: initialsFor(persona.name),
            description: persona.description,
            activity: 'idle',
            paused: false,
            model: {
              providerId: state.defaults.providerId,
              model: state.defaults.model,
              inherited: true,
            },
            queuedTasks: 0,
            config: {
              enabled: true,
              systemPrompt: persona.systemPrompt,
              workdir: `~/Library/Application Support/Arlo Harness/personas/${persona.id}/workdir`,
              maxConcurrency: 1,
              delegationTimeoutMinutes: 30,
              browserEnabled: persona.browserEnabled,
              signedInSites: [],
              skills: [],
              mcpServers: [],
              tools: [],
              eventTriggers: [],
              webhook: {
                url: `http://127.0.0.1:${state.advanced.webhookPort}/hooks/${persona.id}`,
                tokenLast4: '',
              },
            },
          },
        },
        agentOrder: [...state.agentOrder, agentId],
        threads: {
          ...state.threads,
          [threadId]: {
            id: threadId,
            agentId,
            source: 'user',
            title: '直接對話',
            createdAt: now,
            lastActivityAt: now,
          },
        },
        threadItems: { ...state.threadItems, [threadId]: [] },
      };
    }
    case 'persona/setEnabled':
      return patchAgent(state, command.agentId, (a) => ({
        ...a,
        activity: command.enabled ? 'idle' : 'offline',
        config: a.config && { ...a.config, enabled: command.enabled },
      }));
    case 'persona/delete': {
      if (!state.agents[command.agentId] || command.agentId === 'orchestrator') return state;
      const agents = { ...state.agents };
      delete agents[command.agentId];
      return {
        ...state,
        agents,
        agentOrder: state.agentOrder.filter((id) => id !== command.agentId),
      };
    }
    case 'persona/addMcpServer':
      return patchConfig(state, command.agentId, (c) =>
        c.mcpServers.some((s) => s.name === command.server.name)
          ? c
          : { ...c, mcpServers: [...c.mcpServers, command.server] },
      );
    case 'persona/removeMcpServer':
      return patchConfig(state, command.agentId, (c) => ({
        ...c,
        mcpServers: c.mcpServers.filter((s) => s.name !== command.name),
        tools: c.tools.filter(
          (t) => !(t.source.kind === 'mcp' && t.source.server === command.name),
        ),
      }));
    case 'persona/clearBrowserData':
      return patchConfig(state, command.agentId, (c) => ({ ...c, signedInSites: [] }));
    case 'persona/rotateWebhookToken':
      return patchConfig(state, command.agentId, (c) => ({
        ...c,
        webhook: { ...c.webhook, tokenLast4: command.tokenLast4 },
      }));
    case 'provider/add':
      return state.providers.some((p) => p.id === command.provider.id)
        ? state
        : { ...state, providers: [...state.providers, command.provider] };
    case 'provider/testResult':
      return {
        ...state,
        providers: state.providers.map((p) =>
          p.id !== command.providerId
            ? p
            : command.ok
              ? { ...p, status: 'connected', lastError: undefined }
              : {
                  ...p,
                  status:
                    p.status === 'connected' || p.status === 'untested' ? 'unreachable' : p.status,
                  lastError: {
                    message: command.message ?? p.lastError?.message ?? 'failed',
                    at: now,
                  },
                },
        ),
      };
    case 'defaults/set':
      return {
        ...state,
        defaults: { providerId: command.providerId, model: command.model },
        agents: Object.fromEntries(
          Object.entries(state.agents).map(([id, agent]) => [
            id,
            agent.model.inherited
              ? {
                  ...agent,
                  model: { ...agent.model, providerId: command.providerId, model: command.model },
                }
              : agent,
          ]),
        ),
      };
    case 'rule/add':
      return {
        ...state,
        notificationSettings: {
          ...state.notificationSettings,
          rules: [...state.notificationSettings.rules, command.rule],
        },
      };
    case 'schedule/setEnabled':
      return {
        ...state,
        schedules: state.schedules.map((s) =>
          s.id === command.scheduleId ? { ...s, enabled: command.enabled } : s,
        ),
      };
    case 'schedule/setTemplate':
      return {
        ...state,
        schedules: state.schedules.map((s) =>
          s.id === command.scheduleId ? { ...s, template: command.template } : s,
        ),
      };
    case 'schedule/runNow':
      return {
        ...state,
        schedules: state.schedules.map((s) =>
          s.id === command.scheduleId
            ? { ...s, lastRun: { at: now, status: 'done', note: '手動執行' } }
            : s,
        ),
      };
    case 'rule/setEnabled':
      return {
        ...state,
        notificationSettings: {
          ...state.notificationSettings,
          rules: state.notificationSettings.rules.map((r) =>
            r.id === command.ruleId ? { ...r, enabled: command.enabled } : r,
          ),
        },
      };
    case 'settings/toast':
      return {
        ...state,
        notificationSettings: {
          ...state.notificationSettings,
          toastEnabled: command.enabled,
          toastMinSeverity: command.minSeverity,
        },
      };
    case 'settings/setLocale':
      return { ...state, locale: command.locale };
    case 'settings/orchestratorPrompt':
      return { ...state, orchestratorPrompt: command.prompt };
    case 'onboarding/complete':
      return { ...state, onboarded: true };
  }
}
