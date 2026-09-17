import type { AgentId } from '@arlo/shared';
import { useState } from 'react';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { StatusDot } from '../../components/status-dot.js';
import { TONE_BG, TONE_TEXT } from '../../components/tone.js';
import { Button } from '../../components/ui/button.js';
import { Progress } from '../../components/ui/progress.js';
import { formatClock, formatCountdown, formatElapsed } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { Agent, PlatformState, StepState, Task } from '../../state/model.js';
import {
  agentStatusLine,
  modelLabel,
  pendingInterrupts,
  providerById,
  taskProgress,
  toneOfAgent,
  type Tone,
} from '../../state/selectors.js';
import { testProviderConnection } from '../../state/provider-test.js';
import { useDispatch } from '../../state/store.js';
import { InterruptCard } from '../interrupts/InterruptCard.js';

const STEP: Readonly<Record<StepState, { tone: Tone; label: string; text: string }>> = {
  done: { tone: 'success', label: 'done', text: 'text-muted-foreground' },
  running: { tone: 'accent', label: 'running', text: 'text-foreground' },
  waiting: { tone: 'warning', label: 'waiting', text: 'text-foreground' },
  error: { tone: 'danger', label: 'error', text: 'text-foreground' },
  queued: { tone: 'idle', label: 'queued', text: 'text-faint' },
};

export function StepList({ task }: { task: Task }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {task.steps.map((step, index) => {
        const meta = STEP[step.state];
        return (
          <li key={index} className="flex items-center gap-2">
            <StatusDot tone={meta.tone} pulse={step.state === 'running'} />
            <span className={cn('min-w-0 flex-1 text-caption leading-[1.5]', meta.text)}>
              {step.label}
            </span>
            <span
              className={cn('shrink-0 font-mono text-micro font-semibold', TONE_TEXT[meta.tone])}
            >
              {meta.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Crashed Agent process waiting for its next automatic restart (ADR-0002). */
export function RestartCard({
  agent,
  now,
  onViewLog,
}: {
  agent: Agent;
  now: number;
  onViewLog: () => void;
}) {
  const dispatch = useDispatch();
  const restart = agent.restart;
  if (!restart) return null;
  const remaining = restart.nextRetryAt - now;
  const restartDelayMs = 30_000;
  return (
    <div className="rounded-md border border-danger bg-background p-3.5 shadow-[0_0_0_3px_var(--color-danger-soft)]">
      <div className="flex items-center gap-[9px]">
        <AgentAvatar agent={agent} />
        <div className="flex-1">
          <div className="text-body-sm font-semibold">{agent.name}</div>
          <div className="text-caption font-semibold text-danger">process crashed · restarting</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-[9px]">
        <Progress
          value={remaining > 0 ? 100 - (remaining / restartDelayMs) * 100 : 100}
          className="h-[5px] flex-1"
          barClassName="bg-danger rounded-none"
        />
        <span className="font-mono text-caption font-semibold text-muted-foreground">
          {remaining > 0 ? formatCountdown(remaining) : 'retrying…'}
        </span>
      </div>
      <div className="mt-2 text-caption leading-[1.6] text-muted-foreground">
        retry {restart.attempt} / {restart.maxAttempts} ·{' '}
        {remaining > 0 ? `${Math.ceil(remaining / 1_000)} 秒後重試。` : '正在重新啟動。'}
        {restart.queuedTasks} 個佇列任務會保留，不會遺失。
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <Button
          variant="primary"
          size="sm"
          onClick={() => dispatch({ type: 'agent/retryNow', agentId: agent.id })}
        >
          立即重試
        </Button>
        <Button variant="outline" size="sm" onClick={onViewLog}>
          檢視 crash log
        </Button>
      </div>
    </div>
  );
}

export function ProviderErrorCard({
  data,
  agent,
  onOpenSettings,
}: {
  data: PlatformState;
  agent: Agent;
  onOpenSettings: () => void;
}) {
  const dispatch = useDispatch();
  const [testing, setTesting] = useState(false);
  const provider = providerById(data, agent.model.providerId);
  if (!provider || provider.status === 'connected' || provider.status === 'untested') return null;
  const affected = Object.values(data.agents).filter(
    (a) => a.model.providerId === provider.id,
  ).length;
  return (
    <div className="rounded-md border border-danger bg-background p-3.5">
      <div className="text-body-sm font-semibold text-danger">
        {provider.status === 'invalid_key' ? 'API key 無效' : '無法連線'} · {provider.name}
      </div>
      <div className="mt-[7px] font-mono text-caption leading-[1.6] text-muted-foreground">
        {provider.lastError?.message ?? provider.status} · {provider.baseUrl}
      </div>
      <div className="mt-2 text-caption leading-[1.6] text-muted-foreground">
        使用這個 provider 的 {affected} 個 Agent 已暫停，任務保留在佇列中。
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <Button variant="primary" size="sm" onClick={onOpenSettings}>
          前往設定
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={testing}
          onClick={() => {
            setTesting(true);
            void testProviderConnection(provider).then((result) => {
              dispatch({
                type: 'provider/testResult',
                providerId: provider.id,
                ok: result.ok,
                message: result.message,
              });
              setTesting(false);
            });
          }}
        >
          {testing ? 'Testing…' : 'Test again'}
        </Button>
      </div>
    </div>
  );
}

export function TaskCard({ task, agent, now }: { task: Task; agent: Agent; now: number }) {
  const dispatch = useDispatch();
  const [confirming, setConfirming] = useState(false);
  const progress = taskProgress(task);
  const tone = toneOfAgent(agent);
  const active = task.state === 'running' || task.state === 'waiting';
  return (
    <div className="rounded-md border border-border bg-background px-[13px] py-3">
      <div className="flex items-center gap-2">
        <span className="text-micro font-semibold tracking-[0.02em] text-faint">CURRENT TASK</span>
        <span className="flex-1" />
        <span className="font-mono text-tiny text-faint">{progress.label}</span>
      </div>
      <div className="mt-1.5 text-body-sm leading-[1.5] font-semibold">{task.title}</div>
      <Progress value={progress.percent} className="mt-[9px]" barClassName={TONE_BG[tone]} />
      <div className="mt-2.5">
        <StepList task={task} />
      </div>
      {active ? (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2.5">
          <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {task.startedAt ? `已執行 ${formatElapsed(now - task.startedAt)}` : ''}
            {task.lastAction
              ? ` · 最近動作：${task.lastAction.text}（${formatClock(task.lastAction.at, now)}）`
              : ''}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              dispatch({ type: 'agent/setPaused', agentId: agent.id, paused: !agent.paused })
            }
          >
            {agent.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            variant={confirming ? 'primary' : 'danger'}
            size="xs"
            className={confirming ? 'bg-danger hover:bg-danger' : undefined}
            onBlur={() => setConfirming(false)}
            onClick={() => {
              if (confirming) dispatch({ type: 'task/cancel', taskId: task.id });
              setConfirming(!confirming);
            }}
          >
            {confirming ? 'Confirm cancel' : 'Cancel'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface ActivityEntry {
  key: string;
  text: string;
  at: number;
}

function recentActivity(data: PlatformState, agentId: AgentId): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const thread of Object.values(data.threads)) {
    if (thread.agentId !== agentId) continue;
    for (const item of data.threadItems[thread.id] ?? []) {
      switch (item.kind) {
        case 'tool':
        case 'browser':
          entries.push({
            key: item.id,
            text: `${item.name} ${item.ok ? 'ok' : 'failed'} · ${(item.durationMs / 1_000).toFixed(1)}s`,
            at: item.at,
          });
          break;
        case 'system':
          entries.push({ key: item.id, text: item.text, at: item.at });
          break;
        case 'agent':
          if (item.agentId !== agentId)
            entries.push({
              key: item.id,
              text: `由 Orchestrator 指派：${thread.title}`,
              at: item.at,
            });
          break;
        default:
          break;
      }
    }
  }
  for (const n of data.notifications) {
    if (n.agentId === agentId) entries.push({ key: n.id, text: n.title, at: n.at });
  }
  return entries.sort((a, b) => b.at - a.at).slice(0, 5);
}

interface PersonaOverviewProps {
  data: PlatformState;
  agent: Agent;
  now: number;
  onOpenWindow: (threadId?: string) => void;
  onOpenSettings: () => void;
  onOpenGlobalSettings: () => void;
}

export function PersonaOverview({
  data,
  agent,
  now,
  onOpenWindow,
  onOpenSettings,
  onOpenGlobalSettings,
}: PersonaOverviewProps) {
  const tone = toneOfAgent(agent);
  const task = agent.currentTaskId ? data.tasks[agent.currentTaskId] : undefined;
  const pending = pendingInterrupts(data, agent.id);
  const activity = recentActivity(data, agent.id);
  return (
    <div className="flex min-h-0 flex-1 animate-swap-in flex-col gap-[11px] overflow-y-auto px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-border-strong bg-background px-[13px] py-3">
        <AgentAvatar agent={agent} size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold tracking-[-0.01em]">{agent.name}</div>
          <div
            className={cn(
              'mt-0.5 flex items-center gap-[5px] text-caption font-semibold',
              TONE_TEXT[tone],
            )}
          >
            <StatusDot tone={tone} pulse={agent.activity === 'working' && !agent.paused} />
            {agentStatusLine(data, agent, now)}
          </div>
        </div>
        <span className="rounded-full border border-border-strong px-[9px] py-[3px] font-mono text-tiny text-faint">
          {modelLabel(agent)}
        </span>
        <Button variant="primary" size="sm" onClick={() => onOpenWindow()}>
          Open window
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          Settings
        </Button>
      </div>

      <ProviderErrorCard data={data} agent={agent} onOpenSettings={onOpenGlobalSettings} />
      <RestartCard agent={agent} now={now} onViewLog={() => onOpenWindow(task?.threadId)} />
      {task ? <TaskCard task={task} agent={agent} now={now} /> : null}

      {pending.map((notification) => (
        <InterruptCard
          key={notification.id}
          data={data}
          notification={notification}
          layout="inline"
          now={now}
          onOpenPersona={() => onOpenWindow(notification.threadId)}
        />
      ))}

      {!task && !agent.restart ? (
        <div className="flex flex-col items-center gap-[9px] rounded-md border border-dashed border-border-strong px-[18px] py-[26px] text-center">
          <div className="text-body font-semibold">這個 Persona 目前沒有任務</div>
          <div className="max-w-[300px] text-caption leading-[1.7] text-muted-foreground">
            {agent.queuedTasks > 0 ? `佇列中有 ${agent.queuedTasks} 個任務。` : ''}
            從下方輸入框直接指派，或讓 Orchestrator 在拆解任務時派給它。
          </div>
        </div>
      ) : null}

      {activity.length > 0 ? (
        <section className="flex flex-col gap-1.5" aria-label="Recent activity">
          <div className="p-0.5 text-micro font-semibold tracking-[0.02em] text-faint">
            RECENT ACTIVITY
          </div>
          {activity.map((entry) => (
            <div
              key={entry.key}
              className="flex items-start gap-[9px] rounded-tile border border-border bg-background px-[11px] py-[9px] transition-all duration-250 hover:border-primary-glow hover:shadow-sm"
            >
              <span className={cn('mt-[5px] size-[6px] shrink-0 rounded-full', TONE_BG[tone])} />
              <div className="min-w-0 flex-1 text-caption leading-[1.55] text-muted-foreground">
                {entry.text}
              </div>
              <span className="shrink-0 font-mono text-micro text-faint">
                {formatClock(entry.at, now)}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
