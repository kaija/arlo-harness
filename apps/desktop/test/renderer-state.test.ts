import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  initialsFor,
  toolSourceLabel,
  type Command,
} from '../src/renderer/src/state/commands.js';
import {
  ADS,
  createFixtureState,
  FINANCE,
  ORCHESTRATOR,
  REPORTS,
  STOCK,
} from '../src/renderer/src/state/fixtures.js';
import type { PlatformState } from '../src/renderer/src/state/model.js';
import {
  actionCenterSections,
  activityCounts,
  agentBadge,
  agentStatusLine,
  displayModel,
  filterPersonas,
  modelLabel,
  pendingInterrupts,
  RESOLVED_PIN_MS,
  runsFor,
  spansFor,
  taskProgress,
  threadsFor,
  threadStatus,
  toneOfAgent,
  toneOfTask,
  unreadCount,
  userThreadId,
} from '../src/renderer/src/state/selectors.js';
import { createPlatformStore } from '../src/renderer/src/state/store.js';
import { connectWindowSync, type SyncPort } from '../src/renderer/src/state/window-sync.js';

const NOW = new Date(2026, 8, 16, 10, 0, 0).getTime();

function fresh(): PlatformState {
  return createFixtureState(NOW);
}

function run(state: PlatformState, ...commands: Command[]): PlatformState {
  return commands.reduce((next, command) => applyCommand(next, command, NOW + 1_000), state);
}

describe('fixture state', () => {
  it('is plain JSON so windows can hand it to each other', () => {
    const state = fresh();
    expect(structuredClone(state)).toEqual(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('points every thread, task and notification at an existing agent', () => {
    const state = fresh();
    for (const thread of Object.values(state.threads))
      expect(state.agents[thread.agentId]).toBeDefined();
    for (const task of Object.values(state.tasks)) {
      expect(state.agents[task.agentId]).toBeDefined();
      expect(state.threads[task.threadId]).toBeDefined();
    }
    for (const n of state.notifications) expect(state.agents[n.agentId]).toBeDefined();
  });

  it('keeps the selected interface language in the state shared by every window', () => {
    const state = run(fresh(), { type: 'settings/setLocale', locale: 'ja' });
    expect(state.locale).toBe('ja');
  });
});

describe('interrupt answers', () => {
  it('approving a tool resumes the waiting task and agent', () => {
    const state = run(fresh(), {
      type: 'interrupt/answer',
      notificationId: 'n-ads-approval',
      answer: { type: 'approval', decision: 'approve' },
    });
    const notification = state.notifications.find((n) => n.id === 'n-ads-approval')!;
    expect(notification.interrupt?.resolution).toBe('approved');
    expect(notification.read).toBe(true);
    expect(state.tasks['task-ads-budget']!.state).toBe('running');
    expect(state.tasks['task-ads-budget']!.steps.every((s) => s.state === 'done')).toBe(true);
    expect(state.agents[ADS]!.activity).toBe('working');
    expect(pendingInterrupts(state, ADS)).toHaveLength(0);
  });

  it('records rejections, edited approvals, answers and resumes', () => {
    const rejected = run(fresh(), {
      type: 'interrupt/answer',
      notificationId: 'n-ads-approval',
      answer: { type: 'approval', decision: 'reject' },
    });
    expect(rejected.notifications[0]!.interrupt?.resolution).toBe('rejected');
    expect(rejected.tasks['task-ads-budget']!.lastAction?.text).toContain('已拒絕');

    const edited = run(fresh(), {
      type: 'interrupt/answer',
      notificationId: 'n-ads-approval',
      answer: { type: 'approval', decision: 'approve' },
      edited: '{"daily_budget":1800}',
    });
    expect(edited.notifications[0]!.interrupt).toMatchObject({
      resolution: 'approved_with_edits',
      note: '{"daily_budget":1800}',
    });

    const resumed = run(fresh(), {
      type: 'interrupt/answer',
      notificationId: 'n-stock-auth',
      answer: { type: 'resume' },
    });
    expect(resumed.notifications.find((n) => n.id === 'n-stock-auth')!.interrupt?.resolution).toBe(
      'resumed',
    );

    const withQuestion = fresh();
    withQuestion.notifications.push({
      id: 'n-q',
      severity: 'action_required',
      agentId: STOCK,
      title: 'q',
      body: '',
      at: NOW,
      read: false,
      taskId: 'task-stock-q3',
      interrupt: {
        payload: { type: 'question', question: '合併還是單月？', options: ['合併', '單月'] },
      },
    });
    const answered = run(withQuestion, {
      type: 'interrupt/answer',
      notificationId: 'n-q',
      answer: { type: 'answer', text: '合併' },
    });
    expect(answered.notifications.find((n) => n.id === 'n-q')!.interrupt).toMatchObject({
      resolution: 'answered',
      note: '合併',
    });
  });

  it('ignores a second answer and answers to non-interrupts', () => {
    const answer: Command = {
      type: 'interrupt/answer',
      notificationId: 'n-ads-approval',
      answer: { type: 'approval', decision: 'approve' },
    };
    const once = run(fresh(), answer);
    expect(applyCommand(once, answer, NOW + 5_000)).toBe(once);
    const plain = fresh();
    expect(applyCommand(plain, { ...answer, notificationId: 'n-movers-done' }, NOW)).toBe(plain);
    // tool_error only reports; it is resolved through toolError/resolve.
    expect(
      applyCommand(
        plain,
        { type: 'interrupt/answer', notificationId: 'n-reports-error', answer: { type: 'resume' } },
        NOW,
      ),
    ).toBe(plain);
  });

  it('skips a browser hand-off and resolves tool errors', () => {
    const skipped = run(fresh(), { type: 'interrupt/skip', notificationId: 'n-stock-auth' });
    expect(skipped.notifications.find((n) => n.id === 'n-stock-auth')!.interrupt?.resolution).toBe(
      'skipped',
    );
    const retried = run(fresh(), {
      type: 'toolError/resolve',
      notificationId: 'n-reports-error',
      action: 'retry',
    });
    expect(
      retried.notifications.find((n) => n.id === 'n-reports-error')!.interrupt?.resolution,
    ).toBe('retried');
    const ignored = run(fresh(), {
      type: 'toolError/resolve',
      notificationId: 'n-reports-error',
      action: 'ignore',
    });
    expect(
      ignored.notifications.find((n) => n.id === 'n-reports-error')!.interrupt?.resolution,
    ).toBe('ignored');
    expect(run(fresh(), { type: 'interrupt/skip', notificationId: 'missing' })).toEqual(fresh());
  });
});

describe('tasks, agents and messages', () => {
  it('cancels a task, closes its pending requests and frees the agent', () => {
    const state = run(fresh(), { type: 'task/cancel', taskId: 'task-ads-budget' });
    expect(state.tasks['task-ads-budget']).toMatchObject({
      state: 'canceled',
      endedAt: NOW + 1_000,
    });
    expect(state.notifications.find((n) => n.id === 'n-ads-approval')!.interrupt?.resolution).toBe(
      'canceled',
    );
    expect(state.agents[ADS]).toMatchObject({ activity: 'idle', currentTaskId: undefined });
    expect(state.threadItems['ctx-ads-budget']!.at(-1)).toMatchObject({
      kind: 'system',
      tone: 'warning',
    });
    // Finished tasks and unknown ids are left alone.
    expect(applyCommand(state, { type: 'task/cancel', taskId: 'task-ads-budget' }, NOW)).toBe(
      state,
    );
    expect(applyCommand(state, { type: 'task/cancel', taskId: 'nope' }, NOW)).toBe(state);
  });

  it('keeps a crashed agent in error when its task is canceled', () => {
    const state = run(fresh(), { type: 'task/cancel', taskId: 'task-reports-export' });
    expect(state.agents[REPORTS]!.activity).toBe('error');
  });

  it('marks messages typed while the agent runs as deferred and notes background dispatch', () => {
    const state = run(
      fresh(),
      {
        type: 'message/send',
        agentId: STOCK,
        threadId: 'ctx-stock-q3',
        text: '  先略過三星 ',
        mode: 'sync',
      },
      {
        type: 'message/send',
        agentId: FINANCE,
        threadId: 'user:financial-reports',
        text: '整理週報',
        mode: 'async',
      },
      {
        type: 'message/send',
        agentId: FINANCE,
        threadId: 'user:financial-reports',
        text: '   ',
        mode: 'sync',
      },
      { type: 'message/send', agentId: FINANCE, threadId: 'missing', text: 'x', mode: 'sync' },
    );
    expect(state.threadItems['ctx-stock-q3']!.at(-1)).toMatchObject({
      kind: 'user',
      text: '先略過三星',
      deferred: true,
    });
    const finance = state.threadItems['user:financial-reports']!;
    expect(finance).toHaveLength(2);
    expect(finance[0]).toMatchObject({ kind: 'user', deferred: false });
    expect(finance[1]).toMatchObject({ kind: 'system', tone: 'info' });
    expect(state.threads['user:financial-reports']!.lastActivityAt).toBe(NOW + 1_000);
  });

  it('pauses, retries restarts, switches browser driver and tab', () => {
    const state = run(
      fresh(),
      { type: 'agent/setPaused', agentId: STOCK, paused: true },
      { type: 'agent/retryNow', agentId: REPORTS },
      { type: 'agent/retryNow', agentId: STOCK },
      { type: 'agent/setDriver', agentId: STOCK, driver: 'user' },
      { type: 'agent/selectTab', agentId: STOCK, tabId: 'st-2' },
      { type: 'agent/setDriver', agentId: FINANCE, driver: 'user' },
      { type: 'agent/selectTab', agentId: FINANCE, tabId: 'x' },
      { type: 'agent/setPaused', agentId: 'persona:missing', paused: true },
    );
    expect(state.agents[STOCK]).toMatchObject({
      paused: true,
      browser: { driver: 'user', activeTabId: 'st-2' },
    });
    expect(state.agents[REPORTS]!.restart!.nextRetryAt).toBe(NOW + 1_000);
    expect(state.agents[FINANCE]!.browser).toBeUndefined();
  });
});

describe('persona configuration', () => {
  it('updates profile, model binding and execution limits', () => {
    const state = run(
      fresh(),
      {
        type: 'persona/update',
        agentId: STOCK,
        patch: {
          name: '研究員',
          description: 'd',
          initials: 'RS',
          systemPrompt: 'p',
          maxConcurrency: 1,
          delegationTimeoutMinutes: 45,
          browserEnabled: false,
        },
      },
      {
        type: 'persona/update',
        agentId: STOCK,
        patch: { providerId: 'lm-studio', model: 'qwen2.5-32b-instruct', temperature: 0.7 },
      },
    );
    expect(state.agents[STOCK]).toMatchObject({
      name: '研究員',
      initials: 'RS',
      model: {
        providerId: 'lm-studio',
        model: 'qwen2.5-32b-instruct',
        temperature: 0.7,
        inherited: false,
      },
      config: {
        systemPrompt: 'p',
        maxConcurrency: 1,
        delegationTimeoutMinutes: 45,
        browserEnabled: false,
      },
    });
    const inherited = run(state, {
      type: 'persona/update',
      agentId: STOCK,
      patch: { inheritModel: true },
    });
    expect(inherited.agents[STOCK]!.model).toEqual({
      providerId: 'openai',
      model: 'gpt-4o',
      inherited: true,
    });
    const overridden = run(inherited, {
      type: 'persona/update',
      agentId: STOCK,
      patch: { inheritModel: false },
    });
    expect(overridden.agents[STOCK]!.model.inherited).toBe(false);
  });

  it('sets risk levels per tool and per source', () => {
    const state = run(
      fresh(),
      { type: 'persona/setToolRisk', agentId: STOCK, toolKey: 'fs_write', risk: 'high' },
      { type: 'persona/setSourceRisk', agentId: STOCK, sourceLabel: 'MCP · docs', risk: 'medium' },
    );
    const tools = state.agents[STOCK]!.config!.tools;
    expect(tools.find((t) => t.key === 'fs_write')!.risk).toBe('high');
    expect(tools.find((t) => t.key === 'docs.fetch_pdf')!.risk).toBe('medium');
    expect(tools.find((t) => t.key === 'browser_navigate')!.risk).toBe('low');
    expect(
      run(fresh(), {
        type: 'persona/setToolRisk',
        agentId: ORCHESTRATOR,
        toolKey: 'x',
        risk: 'low',
      }),
    ).toEqual(fresh());
  });

  it('keeps code-carrying skills off until trusted (ADR-0008)', () => {
    const blocked = run(fresh(), {
      type: 'persona/setSkill',
      agentId: STOCK,
      skill: 'tw-market-scraper',
      enabled: true,
    });
    expect(
      blocked.agents[STOCK]!.config!.skills.find((s) => s.name === 'tw-market-scraper')!.enabled,
    ).toBe(false);
    const trusted = run(blocked, {
      type: 'persona/trustSkill',
      agentId: STOCK,
      skill: 'tw-market-scraper',
    });
    expect(
      trusted.agents[STOCK]!.config!.skills.find((s) => s.name === 'tw-market-scraper'),
    ).toMatchObject({
      trusted: true,
      enabled: true,
    });
    const disabled = run(trusted, {
      type: 'persona/setSkill',
      agentId: STOCK,
      skill: 'valuation-compare',
      enabled: false,
    });
    expect(
      disabled.agents[STOCK]!.config!.skills.find((s) => s.name === 'valuation-compare')!.enabled,
    ).toBe(false);
  });

  it('adds and removes MCP servers with their tools, clears browser data, rotates webhook tokens', () => {
    const server = {
      name: 'news',
      transport: 'stdio' as const,
      target: 'node news.js',
      from: 'custom' as const,
      status: 'connecting' as const,
      toolCount: 0,
    };
    const added = run(
      fresh(),
      { type: 'persona/addMcpServer', agentId: STOCK, server },
      { type: 'persona/addMcpServer', agentId: STOCK, server },
    );
    expect(added.agents[STOCK]!.config!.mcpServers.map((s) => s.name)).toEqual(['docs', 'news']);
    const removed = run(
      added,
      { type: 'persona/removeMcpServer', agentId: STOCK, name: 'docs' },
      { type: 'persona/clearBrowserData', agentId: STOCK },
      { type: 'persona/rotateWebhookToken', agentId: STOCK, tokenLast4: 'beef' },
    );
    const config = removed.agents[STOCK]!.config!;
    expect(config.mcpServers.map((s) => s.name)).toEqual(['news']);
    expect(config.tools.some((t) => t.key === 'docs.fetch_pdf')).toBe(false);
    expect(config.signedInSites).toEqual([]);
    expect(config.webhook.tokenLast4).toBe('beef');
  });

  it('creates, disables and deletes personas', () => {
    const persona = {
      id: 'web-researcher',
      name: 'Web Researcher',
      description: 'd',
      systemPrompt: 'p',
      browserEnabled: true,
    };
    const created = run(fresh(), { type: 'persona/create', persona });
    const agentId = 'persona:web-researcher';
    expect(created.agents[agentId]).toMatchObject({
      initials: 'WR',
      activity: 'idle',
      model: { inherited: true },
    });
    expect(created.agentOrder.at(-1)).toBe(agentId);
    expect(created.threads['user:web-researcher']).toMatchObject({ source: 'user', agentId });
    expect(applyCommand(created, { type: 'persona/create', persona }, NOW)).toBe(created);

    const disabled = run(created, { type: 'persona/setEnabled', agentId, enabled: false });
    expect(disabled.agents[agentId]).toMatchObject({
      activity: 'offline',
      config: { enabled: false },
    });
    expect(agentStatusLine(disabled, disabled.agents[agentId]!, NOW)).toBe('offline · disabled');
    const enabled = run(disabled, { type: 'persona/setEnabled', agentId, enabled: true });
    expect(enabled.agents[agentId]!.activity).toBe('idle');

    const deleted = run(enabled, {
      type: 'persona/delete',
      agentId,
      removeWorkdir: true,
      removeBrowserData: true,
    });
    expect(deleted.agents[agentId]).toBeUndefined();
    expect(deleted.agentOrder).not.toContain(agentId);
    const orchestrator = run(deleted, {
      type: 'persona/delete',
      agentId: ORCHESTRATOR,
      removeWorkdir: false,
      removeBrowserData: false,
    });
    expect(orchestrator.agents[ORCHESTRATOR]).toBeDefined();
  });

  it('derives initials from Latin or CJK names', () => {
    expect(initialsFor('Google Ads')).toBe('GA');
    expect(initialsFor('research')).toBe('RE');
    expect(initialsFor('股票研究員')).toBe('股');
    expect(initialsFor('  ')).toBe('?');
  });
});

describe('global settings', () => {
  it('adds providers, records connection tests and switches the default model', () => {
    const provider = {
      id: 'azure-1',
      name: 'Azure',
      type: 'azure_openai' as const,
      baseUrl: 'https://x.openai.azure.com',
      keyPreview: 'abc··1234',
      status: 'untested' as const,
      capabilities: { realtimeVoice: false, speechToText: true },
      models: ['gpt-4o-prod'],
    };
    const state = run(
      fresh(),
      { type: 'provider/add', provider },
      { type: 'provider/add', provider },
      { type: 'provider/testResult', providerId: 'azure-1', ok: false, message: 'timeout' },
      { type: 'provider/testResult', providerId: 'lm-studio', ok: false },
      { type: 'defaults/set', providerId: 'azure-1', model: 'gpt-4o-prod' },
    );
    expect(state.providers.filter((p) => p.id === 'azure-1')).toHaveLength(1);
    expect(state.providers.find((p) => p.id === 'azure-1')).toMatchObject({
      status: 'unreachable',
      lastError: { message: 'timeout' },
    });
    expect(state.providers.find((p) => p.id === 'lm-studio')).toMatchObject({
      status: 'invalid_key',
      lastError: { message: '401 Unauthorized' },
    });
    expect(state.agents[ORCHESTRATOR]!.model).toMatchObject({
      providerId: 'azure-1',
      model: 'gpt-4o-prod',
    });
    expect(state.agents[STOCK]!.model.providerId).toBe('openai');
    const fixed = run(state, { type: 'provider/testResult', providerId: 'azure-1', ok: true });
    expect(fixed.providers.find((p) => p.id === 'azure-1')).toMatchObject({
      status: 'connected',
      lastError: undefined,
    });
  });

  it('edits schedules, forwarding rules, toast preferences and onboarding', () => {
    const state = run(
      fresh(),
      { type: 'schedule/setEnabled', scheduleId: 'sch-premarket', enabled: false },
      { type: 'schedule/setTemplate', scheduleId: 'sch-premarket', template: '{{date}}' },
      { type: 'schedule/runNow', scheduleId: 'sch-ads-weekly' },
      { type: 'rule/setEnabled', ruleId: 'rule-ntfy', enabled: true },
      { type: 'rule/add', rule: { id: 'r', name: 'n', target: 't', detail: 'd', enabled: false } },
      { type: 'settings/toast', enabled: false, minSeverity: 'error' },
      { type: 'settings/orchestratorPrompt', prompt: 'split tasks' },
      { type: 'notifications/markRead', notificationId: 'n-reports-error' },
      { type: 'onboarding/complete' },
    );
    expect(state.schedules[0]).toMatchObject({ enabled: false, template: '{{date}}' });
    expect(state.schedules[1]!.lastRun).toMatchObject({ status: 'done', at: NOW + 1_000 });
    expect(state.notificationSettings).toMatchObject({
      toastEnabled: false,
      toastMinSeverity: 'error',
    });
    expect(state.notificationSettings.rules.map((r) => [r.id, r.enabled])).toEqual([
      ['rule-telegram', true],
      ['rule-ntfy', true],
      ['r', false],
    ]);
    expect(state.orchestratorPrompt).toBe('split tasks');
    expect(unreadCount(state)).toBe(2);
    expect(unreadCount(run(state, { type: 'notifications/markAllRead' }))).toBe(0);
  });
});

describe('selectors', () => {
  it('counts and filters agents', () => {
    const state = fresh();
    expect(activityCounts(state)).toEqual({ running: 2, waiting: 1, errors: 1 });
    expect(filterPersonas(state, 'all', '').map((a) => a.id)).toEqual([
      ADS,
      STOCK,
      FINANCE,
      REPORTS,
    ]);
    expect(filterPersonas(state, 'waiting', '').map((a) => a.id)).toEqual([ADS]);
    expect(filterPersonas(state, 'all', 'q3').map((a) => a.id)).toEqual([STOCK]);
    expect(filterPersonas(state, 'error', 'ga4').map((a) => a.id)).toEqual([REPORTS]);
  });

  it('describes agent status, tone, badge and model', () => {
    const state = fresh();
    const now = NOW + 60_000;
    expect(agentStatusLine(state, state.agents[ORCHESTRATOR]!, now)).toBe(
      'planning · 2 delegations',
    );
    expect(agentStatusLine(state, state.agents[STOCK]!, now)).toBe('working · 15m');
    expect(agentStatusLine(state, state.agents[ADS]!, now)).toBe('waiting for input');
    expect(agentStatusLine(state, state.agents[FINANCE]!, now)).toBe('idle');
    expect(agentStatusLine(state, state.agents[REPORTS]!, now)).toBe('restarting · retry 3 / 3');
    const paused = run(state, { type: 'agent/setPaused', agentId: STOCK, paused: true });
    expect(agentStatusLine(paused, paused.agents[STOCK]!, now)).toBe('paused');
    expect(toneOfAgent(paused.agents[STOCK]!)).toBe('idle');
    const idleOrchestrator = run(
      state,
      { type: 'task/cancel', taskId: 'task-stock-q3' },
      { type: 'task/cancel', taskId: 'task-ads-budget' },
    );
    expect(agentStatusLine(idleOrchestrator, idleOrchestrator.agents[ORCHESTRATOR]!, now)).toBe(
      'thinking',
    );

    expect(agentBadge(state, state.agents[ADS]!, now)).toEqual({
      kind: 'action',
      text: '1 action',
    });
    expect(agentBadge(state, state.agents[REPORTS]!, NOW)).toEqual({
      kind: 'countdown',
      text: '0:30',
    });
    expect(agentBadge(state, state.agents[FINANCE]!, now)).toEqual({ kind: 'queued', text: '+1' });
    expect(agentBadge(state, { ...state.agents[FINANCE]!, queuedTasks: 0 }, now)).toBeUndefined();

    expect(modelLabel(state.agents[ORCHESTRATOR]!)).toBe('GPT-4o · 全域預設');
    expect(modelLabel(state.agents[STOCK]!)).toBe('GPT-4o · temp 0.3');
    expect(
      modelLabel({
        ...state.agents[STOCK]!,
        model: { providerId: 'openai', model: 'gpt-4o-mini', inherited: false },
      }),
    ).toBe('GPT-4o mini');
    expect(displayModel('qwen2.5')).toBe('qwen2.5');
    expect(
      ['running', 'waiting', 'failed', 'done', 'queued', 'canceled'].map((s) =>
        toneOfTask(s as never),
      ),
    ).toEqual(['accent', 'warning', 'danger', 'success', 'idle', 'idle']);
  });

  it('computes progress by steps or counters', () => {
    const state = fresh();
    expect(taskProgress(state.tasks['task-stock-q3']!)).toMatchObject({
      done: 3,
      total: 5,
      label: '3 / 5 steps',
      percent: 60,
    });
    expect(taskProgress(state.tasks['task-fin-weekly']!)).toMatchObject({
      total: 0,
      percent: 0,
      label: '',
    });
    expect(
      taskProgress({ ...state.tasks['task-fin-weekly']!, counter: { done: 206, total: 500 } })
        .label,
    ).toBe('206 / 500');
  });

  it('orders threads with the user thread pinned and reports their status', () => {
    const state = fresh();
    const threads = threadsFor(state, STOCK);
    expect(threads[0]!.source).toBe('user');
    expect(threads.slice(1).map((t) => t.lastActivityAt)).toEqual(
      [...threads.slice(1).map((t) => t.lastActivityAt)].sort((a, b) => b - a),
    );
    expect(threads.map((t) => threadStatus(state, t))).toEqual([
      'pinned',
      'running',
      'done',
      'done',
      'failed',
      'queued',
    ]);
    expect(threadsFor(state, STOCK, 'webhook').map((t) => t.id)).toEqual(['ctx-stock-webhook']);
    expect(threadStatus(state, state.threads['ctx-ads-budget']!)).toBe('waiting');
    expect(userThreadId(ORCHESTRATOR)).toBe('user:orchestrator');
    expect(userThreadId(STOCK)).toBe('user:stock-research');
  });

  it('pins unresolved and recently resolved requests in the action center', () => {
    const state = fresh();
    expect(actionCenterSections(state, 'all', NOW).pinned.map((n) => n.id)).toEqual([
      'n-ads-approval',
      'n-stock-auth',
    ]);
    expect(actionCenterSections(state, 'errors', NOW).earlier.map((n) => n.id)).toEqual([
      'n-reports-error',
    ]);
    expect(actionCenterSections(state, 'action', NOW).earlier).toEqual([]);
    const approved = run(state, {
      type: 'interrupt/answer',
      notificationId: 'n-ads-approval',
      answer: { type: 'approval', decision: 'approve' },
    });
    expect(actionCenterSections(approved, 'all', NOW + 2_000).pinned.map((n) => n.id)).toContain(
      'n-ads-approval',
    );
    expect(
      actionCenterSections(approved, 'all', NOW + 2_000 + RESOLVED_PIN_MS).pinned.map((n) => n.id),
    ).toEqual(['n-stock-auth']);
  });

  it('lists runs and spans for a thread', () => {
    const state = fresh();
    expect(runsFor(state, 'ctx-stock-q3').map((r) => r.index)).toEqual([1, 2, 3]);
    expect(spansFor(state, 'run-st-3').map((s) => s.name)).toEqual([
      'model.call',
      'browser_navigate',
      'docs.fetch_pdf',
      'browser_extract',
      'model.call',
    ]);
    expect(toolSourceLabel({ kind: 'skill', skill: 'x' })).toBe('skill · x');
  });
});

describe('store and window sync', () => {
  function pair(): [SyncPort, SyncPort] {
    const listeners: [((m: never) => void)[], ((m: never) => void)[]] = [[], []];
    const port = (self: 0 | 1): SyncPort => ({
      postMessage: (message) =>
        listeners[self === 0 ? 1 : 0].forEach((listener) =>
          listener(structuredClone(message) as never),
        ),
      onMessage: (listener) => listeners[self].push(listener as never),
      close: () => (listeners[self].length = 0),
    });
    return [port(0), port(1)];
  }

  it('confirms the user’s own actions with a toast', () => {
    const store = createPlatformStore(fresh(), () => NOW);
    store.getState().dispatch({
      type: 'interrupt/answer',
      notificationId: 'n-ads-approval',
      answer: { type: 'approval', decision: 'approve' },
    });
    store
      .getState()
      .dispatch({
        type: 'message/send',
        agentId: FINANCE,
        threadId: 'user:financial-reports',
        text: 'hi',
        mode: 'async',
      });
    store.getState().dispatch({ type: 'task/cancel', taskId: 'task-stock-q3' });
    store.getState().dispatch({ type: 'notifications/markAllRead' });
    const toasts = store.getState().toasts;
    expect(toasts.map((t) => [t.tone, t.title])).toEqual([
      ['success', '已批准 update_campaign_budget，任務繼續'],
      ['info', '已派發給 財報整理員'],
      ['warning', '已取消任務'],
    ]);
    store.getState().dismissToast(toasts[0]!.id);
    expect(store.getState().toasts).toHaveLength(2);
  });

  it('hands a later window the current state and mirrors commands both ways', () => {
    const [first, second] = pair();
    const a = createPlatformStore(fresh(), () => NOW);
    const disconnectA = connectWindowSync(a, first);
    a.getState().dispatch({
      type: 'interrupt/answer',
      notificationId: 'n-stock-auth',
      answer: { type: 'resume' },
    });

    const b = createPlatformStore(createFixtureState(NOW + 99_000), () => NOW);
    connectWindowSync(b, second);
    expect(b.getState().data).toEqual(a.getState().data);

    b.getState().dispatch({ type: 'agent/setPaused', agentId: STOCK, paused: true });
    expect(a.getState().data.agents[STOCK]!.paused).toBe(true);
    // Toasts stay in the window where the user acted.
    expect(b.getState().toasts).toHaveLength(0);

    disconnectA();
    b.getState().dispatch({ type: 'agent/setPaused', agentId: STOCK, paused: false });
    expect(a.getState().data.agents[STOCK]!.paused).toBe(true);
    expect(connectWindowSync(a, undefined)()).toBeUndefined();
  });
});
