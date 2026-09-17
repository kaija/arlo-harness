import type { AgentId, InterruptPayload } from '@arlo/shared';
import { Collapsible } from 'radix-ui';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { Icon } from '../../components/icon.js';
import { StatusDot } from '../../components/status-dot.js';
import { TONE_BORDER, TONE_RING, TONE_TEXT } from '../../components/tone.js';
import { Badge } from '../../components/ui/badge.js';
import { formatDurationCompact, formatElapsed, formatElapsedShort } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { Agent, ChatItem, PlatformState, Task } from '../../state/model.js';
import {
  childTasks,
  taskProgress,
  TASK_STATE_LABEL,
  toneOfTask,
  type Tone,
} from '../../state/selectors.js';

export function UserBubble({
  text,
  deferred,
  compact,
}: {
  text: string;
  deferred?: boolean | undefined;
  compact?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          'max-w-[70%] self-end rounded-[14px_14px_4px_14px] bg-primary px-[13px] py-[9px] leading-[1.55] whitespace-pre-wrap text-white',
          compact ? 'text-body-sm' : 'text-body',
        )}
      >
        {text}
      </div>
      {deferred ? (
        <div className="-mt-1.5 self-end text-micro text-faint">
          將於下一輪處理 · Agent 正在執行中
        </div>
      ) : null}
    </>
  );
}

export function AgentMessage({
  agent,
  text,
  incoming,
}: {
  agent: Agent;
  text: string;
  incoming: boolean;
}) {
  return (
    <div className="flex gap-[9px]">
      <AgentAvatar agent={agent} size={22} />
      <div
        className={cn(
          'min-w-0 flex-1 text-body-sm leading-[1.6] whitespace-pre-wrap',
          incoming && 'rounded-md border border-border bg-secondary px-3 py-[9px]',
        )}
      >
        {text}
      </div>
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return <span className="w-2 text-faint">{open ? '▾' : '▸'}</span>;
}

export function ReasoningBlock({ durationMs, text }: { durationMs: number; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="rounded-tile border border-border bg-secondary px-[11px] py-2"
    >
      <Collapsible.Trigger className="flex w-full items-center gap-[7px] text-left text-caption font-semibold text-muted-foreground">
        <Caret open={open} />
        Reasoning · {formatDurationCompact(durationMs)}
      </Collapsible.Trigger>
      <Collapsible.Content className="data-[state=open]:animate-reveal">
        <div className="mt-[7px] border-l-2 border-primary-glow pl-[9px] text-label leading-[1.6] text-muted-foreground">
          {text}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function ToolBlock({
  name,
  origin,
  ok,
  durationMs,
  defaultOpen = false,
  children,
}: {
  name: string;
  origin?: string;
  ok: boolean;
  durationMs: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-tile border border-border"
    >
      <Collapsible.Trigger className="flex w-full items-center gap-2 bg-secondary px-[11px] py-2 text-left text-caption">
        <Caret open={open} />
        <span className="truncate font-mono font-semibold">{name}</span>
        {origin ? <span className="shrink-0 text-faint">{origin}</span> : null}
        <span className="flex-1" />
        <span className={cn('font-semibold', ok ? 'text-success' : 'text-danger')}>
          {ok ? 'ok' : 'failed'}
        </span>
        <span className="font-mono text-faint">{formatDurationCompact(durationMs)}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="data-[state=open]:animate-reveal">
        <div className="border-t border-border bg-background px-[11px] py-[9px]">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function MonoLines({ lines }: { lines: string[] }) {
  return (
    <div className="font-mono text-label leading-[1.6] break-words text-muted-foreground">
      {lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}

/** Stand-in page thumbnail until browser actions carry real screenshots (T15). */
export function PageThumbnail({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative h-[60px] w-24 shrink-0 overflow-hidden rounded-[6px] border border-border-strong bg-gradient-to-b from-secondary to-[#eceaf4]',
        className,
      )}
    >
      <span className="absolute top-2 right-[30px] left-1.5 h-[3px] bg-primary-glow" />
      <span className="absolute top-[17px] right-3 left-1.5 h-0.5 bg-black/8" />
      <span className="absolute top-6 right-10 left-1.5 h-0.5 bg-black/8" />
      <span className="absolute bottom-1.5 left-1.5 h-3.5 w-[38px] rounded-[3px] bg-primary-soft" />
    </div>
  );
}

function pendingSummary(payload: InterruptPayload): string {
  switch (payload.type) {
    case 'tool_approval':
      return `Tool approval required · ${payload.toolName}`;
    case 'question':
      return `Question · ${payload.question}`;
    case 'auth_required':
      return `Auth required · ${payload.site}`;
    case 'captcha':
      return `Captcha · ${payload.site}`;
    case 'tool_error':
      return `Tool error · ${payload.toolName}`;
  }
}

function activate(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}

const DELEGATED_BADGE: Readonly<
  Record<Tone, 'primary' | 'warning' | 'success' | 'neutral' | 'danger'>
> = {
  accent: 'primary',
  warning: 'warning',
  success: 'success',
  danger: 'danger',
  idle: 'neutral',
};

export function DelegationCard({
  data,
  task,
  now,
  compact = false,
  onOpen,
}: {
  data: PlatformState;
  task: Task;
  now: number;
  compact?: boolean;
  onOpen: (agentId: AgentId, threadId: string) => void;
}) {
  const agent = data.agents[task.agentId];
  const tone = toneOfTask(task.state);
  const progress = taskProgress(task);
  const pending = data.notifications.find(
    (n) =>
      n.taskId === task.id &&
      n.severity === 'action_required' &&
      n.interrupt &&
      !n.interrupt.resolution,
  );
  const open = () => onOpen(task.agentId, task.threadId);

  let status: ReactNode;
  switch (task.state) {
    case 'running':
      status = (
        <span className="flex items-center gap-[5px] text-primary">
          <StatusDot tone="accent" pulse />
          running {task.startedAt ? formatElapsedShort(now - task.startedAt) : ''}
        </span>
      );
      break;
    case 'done':
      status = (
        <span className="text-success">
          done
          {task.startedAt && task.endedAt
            ? ` · ${formatElapsedShort(task.endedAt - task.startedAt)}`
            : ''}
        </span>
      );
      break;
    default:
      status = (
        <span className={cn('font-semibold', TONE_TEXT[tone])}>{TASK_STATE_LABEL[task.state]}</span>
      );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${agent?.name ?? task.agentId} thread: ${task.title}`}
      onClick={open}
      onKeyDown={activate(open)}
      className={cn(
        'rounded-md border bg-background px-3 py-[11px] text-left transition-[box-shadow,transform] duration-250 hover:-translate-y-0.5 hover:shadow-md',
        task.state === 'queued' || task.state === 'canceled' ? 'border-border' : TONE_BORDER[tone],
        task.state === 'waiting' ? TONE_RING.warning : 'shadow-sm',
        compact && 'p-2.5',
      )}
    >
      <div className="flex items-center gap-2">
        <Badge tone={DELEGATED_BADGE[tone]} size="md">
          Delegated
        </Badge>
        <span className="min-w-0 truncate text-body-sm font-semibold">
          {agent?.name ?? task.agentId}
        </span>
        {task.mode ? (
          <span className="shrink-0 font-mono text-tiny text-faint">{task.mode}</span>
        ) : null}
        <span className="flex-1" />
        <span className="shrink-0 text-caption">{status}</span>
      </div>
      <div className="mt-2 text-body-sm leading-[1.55] text-muted-foreground">{task.brief}</div>
      <div
        className={cn(
          'mt-[9px] flex items-center gap-2 border-t border-border pt-2 text-caption',
          pending ? 'text-warning' : 'text-faint',
        )}
      >
        {pending?.interrupt ? (
          <>
            <span className="min-w-0 truncate font-semibold">
              {pendingSummary(pending.interrupt.payload)}
            </span>
            <span className="flex-1" />
            <span className="shrink-0 font-semibold">Review →</span>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate">
              {task.state === 'done' && task.result
                ? `結果：${task.result}`
                : task.state === 'queued'
                  ? '排隊中 · 等待前一個任務完成'
                  : [progress.label, task.lastAction ? `最近動作：${task.lastAction.text}` : '']
                      .filter(Boolean)
                      .join(' · ')}
            </span>
            <span className="flex-1" />
            <span className="shrink-0 font-semibold text-primary">Open thread →</span>
          </>
        )}
      </div>
    </div>
  );
}

export function SystemEvent({
  tone,
  text,
}: {
  tone: 'info' | 'success' | 'warning' | 'error';
  text: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-[7px] self-start rounded-full px-[11px] py-[5px] text-tiny',
        tone === 'error'
          ? 'bg-danger-soft text-danger'
          : tone === 'warning'
            ? 'bg-warning-soft text-warning'
            : tone === 'success'
              ? 'bg-success-soft text-success'
              : 'bg-muted text-muted-foreground',
      )}
    >
      系統事件 · {text}
    </div>
  );
}

/** "Waiting for Google Ads 投放員 · 已等待 2m 10s" under the Orchestrator's latest turn. */
export function StreamStatus({
  data,
  threadId,
  now,
}: {
  data: PlatformState;
  threadId: string;
  now: number;
}) {
  const root = data.rootTaskIds
    .map((id) => data.tasks[id])
    .find(
      (task) =>
        task?.threadId === threadId && (task.state === 'running' || task.state === 'waiting'),
    );
  if (!root) return null;
  const children = childTasks(data, root.id);
  const waiting = children.find((task) => task.state === 'waiting');
  const running = children.filter((task) => task.state === 'running');
  let text: string;
  if (waiting) {
    const name = data.agents[waiting.agentId]?.name ?? waiting.agentId;
    text = `Waiting for ${name}${waiting.waitingSince ? ` · 已等待 ${formatElapsed(now - waiting.waitingSince)}` : ''}`;
  } else if (running.length > 0) {
    text = `Waiting for ${running.map((task) => data.agents[task.agentId]?.name ?? task.agentId).join('、')}`;
  } else {
    text = 'Thinking…';
  }
  return (
    <div className="flex items-center gap-2 self-start rounded-full bg-muted px-[11px] py-[7px] text-caption text-muted-foreground">
      <Icon name="waveform" size={13} />
      {text}
    </div>
  );
}

export function ChatItemView({
  data,
  item,
  ownerId,
  now,
  onOpenThread,
  renderInterrupt,
  compact = false,
}: {
  data: PlatformState;
  item: ChatItem;
  /** The Agent whose Thread this is; messages from anyone else render as incoming. */
  ownerId: AgentId;
  now: number;
  onOpenThread: (agentId: AgentId, threadId: string) => void;
  renderInterrupt: (notificationId: string) => ReactNode;
  compact?: boolean;
}) {
  switch (item.kind) {
    case 'user':
      return <UserBubble text={item.text} deferred={item.deferred} compact={compact} />;
    case 'agent': {
      const agent = data.agents[item.agentId];
      if (!agent) return null;
      return <AgentMessage agent={agent} text={item.text} incoming={item.agentId !== ownerId} />;
    }
    case 'reasoning':
      return <ReasoningBlock durationMs={item.durationMs} text={item.text} />;
    case 'tool':
      return (
        <ToolBlock name={item.name} origin={item.origin} ok={item.ok} durationMs={item.durationMs}>
          <MonoLines
            lines={[
              ...item.input.map((line) => `→ ${line}`),
              ...item.output.map((line) => `← ${line}`),
            ]}
          />
        </ToolBlock>
      );
    case 'browser':
      return (
        <ToolBlock name={item.name} ok={item.ok} durationMs={item.durationMs} defaultOpen>
          <div className="flex items-start gap-2.5">
            <PageThumbnail />
            <MonoLines lines={item.lines} />
          </div>
        </ToolBlock>
      );
    case 'delegation': {
      const task = data.tasks[item.taskId];
      return task ? (
        <DelegationCard data={data} task={task} now={now} compact={compact} onOpen={onOpenThread} />
      ) : null;
    }
    case 'system':
      return <SystemEvent tone={item.tone} text={item.text} />;
    case 'interrupt':
      return renderInterrupt(item.notificationId);
  }
}
