import type { InterruptPayload } from '@arlo/shared';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/icon.js';
import { TONE_BORDER, TONE_RING } from '../../components/tone.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input, Textarea } from '../../components/ui/input.js';
import { formatAgo, formatArgs, formatElapsed } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { InterruptResolution, Notification, PlatformState } from '../../state/model.js';
import type { Tone } from '../../state/selectors.js';
import { useDispatch } from '../../state/store.js';

export type InterruptLayout = 'panel' | 'inline';

interface InterruptCardProps {
  data: PlatformState;
  notification: Notification;
  layout: InterruptLayout;
  now: number;
  /** Opens the Persona window (Action center) or jumps to the Thread. */
  onOpenPersona?: (() => void) | undefined;
}

const MONO_BOX =
  'rounded-sm bg-secondary px-[9px] py-2 font-mono text-caption leading-[1.7] text-muted-foreground break-words';

function toneOf(payload: InterruptPayload): Tone {
  switch (payload.type) {
    case 'tool_approval':
      return payload.riskLevel === 'high' ? 'danger' : 'warning';
    case 'tool_error':
      return 'danger';
    case 'question':
      return 'idle';
    default:
      return 'warning';
  }
}

function Shell({
  tone,
  layout,
  ring = true,
  children,
}: {
  tone: Tone;
  layout: InterruptLayout;
  ring?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'animate-reveal rounded-md border bg-background',
        layout === 'panel' ? 'p-[11px]' : 'p-3',
        tone === 'idle' ? 'border-border-strong' : TONE_BORDER[tone],
        ring && TONE_RING[tone],
      )}
    >
      {children}
    </div>
  );
}

function Header({ badge, label, meta }: { badge: ReactNode; label?: ReactNode; meta: ReactNode }) {
  return (
    <div className="flex items-center gap-[7px]">
      {badge}
      {label ? <span className="min-w-0 truncate text-caption font-semibold">{label}</span> : null}
      <span className="flex-1" />
      <span className="shrink-0 font-mono text-micro text-faint">{meta}</span>
    </div>
  );
}

export function InterruptCard({
  data,
  notification,
  layout,
  now,
  onOpenPersona,
}: InterruptCardProps) {
  const interrupt = notification.interrupt;
  if (!interrupt) return null;
  if (interrupt.resolution) {
    return (
      <ResolvedCard
        data={data}
        notification={notification}
        resolution={interrupt.resolution}
        layout={layout}
        now={now}
        onOpenPersona={onOpenPersona}
      />
    );
  }
  const agentName = data.agents[notification.agentId]?.name ?? notification.agentId;
  const meta =
    layout === 'panel'
      ? formatAgo(notification.at, now)
      : `waiting ${formatElapsed(now - notification.at)}`;
  const { payload } = interrupt;
  switch (payload.type) {
    case 'tool_approval':
      return (
        <ToolApproval
          notification={notification}
          payload={payload}
          agentName={agentName}
          layout={layout}
          meta={meta}
          onOpenPersona={onOpenPersona}
        />
      );
    case 'question':
      return (
        <Question
          notification={notification}
          payload={payload}
          agentName={agentName}
          layout={layout}
          meta={meta}
        />
      );
    case 'auth_required':
    case 'captcha':
      return (
        <BrowserHandoff
          notification={notification}
          payload={payload}
          layout={layout}
          meta={meta}
          onOpenPersona={onOpenPersona}
        />
      );
    case 'tool_error':
      return (
        <ToolError
          notification={notification}
          payload={payload}
          agentName={agentName}
          layout={layout}
          meta={meta}
        />
      );
  }
}

function ToolApproval({
  notification,
  payload,
  agentName,
  layout,
  meta,
  onOpenPersona,
}: {
  notification: Notification;
  payload: Extract<InterruptPayload, { type: 'tool_approval' }>;
  agentName: string;
  layout: InterruptLayout;
  meta: string;
  onOpenPersona?: (() => void) | undefined;
}) {
  const dispatch = useDispatch();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(payload.args, null, 2));
  const [invalid, setInvalid] = useState(false);
  const high = payload.riskLevel === 'high';
  const tone = toneOf(payload);

  const approve = (edited?: string) =>
    dispatch({
      type: 'interrupt/answer',
      notificationId: notification.id,
      answer: { type: 'approval', decision: 'approve' },
      ...(edited !== undefined && { edited }),
    });
  const reject = () =>
    dispatch({
      type: 'interrupt/answer',
      notificationId: notification.id,
      answer: { type: 'approval', decision: 'reject' },
    });
  const approveEdited = () => {
    try {
      approve(JSON.stringify(JSON.parse(draft)));
    } catch {
      setInvalid(true);
    }
  };

  const badge = (
    <Badge tone={high ? 'danger-solid' : 'warning'} size="sm">
      {high ? 'High risk' : 'Medium risk'}
    </Badge>
  );

  return (
    <Shell tone={tone} layout={layout}>
      {layout === 'panel' ? (
        <>
          <Header badge={badge} label="Tool approval" meta={meta} />
          <div className="mt-2 text-body-sm leading-[1.45] font-semibold">
            {agentName} 想執行 {payload.toolName}
          </div>
        </>
      ) : (
        <>
          <Header badge={badge} label="Tool approval · 需要你批准" meta={meta} />
          <div className="mt-2 text-label font-semibold">{payload.toolName}</div>
        </>
      )}
      {editing ? (
        <div className="mt-[7px] flex flex-col gap-1.5">
          <Textarea
            aria-label="Edited tool parameters"
            aria-invalid={invalid}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            className="min-h-[88px] font-mono text-caption"
          />
          {invalid ? <span className="text-tiny text-danger">參數必須是有效的 JSON。</span> : null}
        </div>
      ) : (
        <div className={cn('mt-[7px]', MONO_BOX)}>
          {formatArgs(payload.args).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      {payload.rationale && layout === 'panel' ? (
        <div className="mt-2 text-caption leading-[1.6] text-muted-foreground">
          <span className="font-semibold text-foreground">理由：</span>
          {payload.rationale}
        </div>
      ) : null}
      {editing ? (
        <div className="mt-2.5 flex gap-1.5">
          <Button variant="primary" size="md" onClick={approveEdited}>
            Allow with these params
          </Button>
          <Button variant="outline" size="md" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : layout === 'panel' ? (
        <>
          <div className="mt-2.5 flex gap-1.5">
            <Button variant="primary" size="md" className="flex-1" onClick={() => approve()}>
              Allow
            </Button>
            <Button variant="reject" size="md" className="flex-1" onClick={reject}>
              Deny
            </Button>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              className="text-caption font-semibold text-primary hover:opacity-70"
              onClick={() => setEditing(true)}
            >
              Allow with edited params
            </button>
            <span className="flex-1" />
            {onOpenPersona ? (
              <button
                type="button"
                className="text-caption text-faint hover:text-primary"
                onClick={onOpenPersona}
              >
                Open persona →
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-[9px] flex flex-wrap gap-1.5">
          <Button variant="primary" size="md" onClick={() => approve()}>
            Allow
          </Button>
          <Button variant="reject" size="md" onClick={reject}>
            Deny
          </Button>
          <Button variant="soft" size="md" onClick={() => setEditing(true)}>
            Allow with edits
          </Button>
        </div>
      )}
    </Shell>
  );
}

function Question({
  notification,
  payload,
  agentName,
  layout,
  meta,
}: {
  notification: Notification;
  payload: Extract<InterruptPayload, { type: 'question' }>;
  agentName: string;
  layout: InterruptLayout;
  meta: string;
}) {
  const dispatch = useDispatch();
  const [text, setText] = useState('');
  const answer = (value: string) => {
    if (!value.trim()) return;
    dispatch({
      type: 'interrupt/answer',
      notificationId: notification.id,
      answer: { type: 'answer', text: value.trim() },
    });
  };
  return (
    <Shell tone="idle" layout={layout} ring={false}>
      <Header
        badge={
          <Badge tone="primary" size="sm">
            Question
          </Badge>
        }
        meta={meta}
      />
      <div className="mt-[7px] text-body-sm leading-[1.5] font-semibold">
        {layout === 'panel' ? `${agentName} · ` : ''}
        {payload.question}
      </div>
      {payload.options ? (
        <div className="mt-2 flex flex-wrap gap-[5px]">
          {payload.options.map((option) => (
            <Button key={option} variant="soft" size="xs" onClick={() => answer(option)}>
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          answer(text);
        }}
      >
        <Input
          aria-label="Answer"
          placeholder="自行回答…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" variant="primary" size="md" disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </Shell>
  );
}

function BrowserHandoff({
  notification,
  payload,
  layout,
  meta,
  onOpenPersona,
}: {
  notification: Notification;
  payload: Extract<InterruptPayload, { type: 'auth_required' | 'captcha' }>;
  layout: InterruptLayout;
  meta: string;
  onOpenPersona?: (() => void) | undefined;
}) {
  const dispatch = useDispatch();
  const captcha = payload.type === 'captcha';
  const resume = () =>
    dispatch({
      type: 'interrupt/answer',
      notificationId: notification.id,
      answer: { type: 'resume' },
    });
  const badge = (
    <Badge tone="warning" size="sm">
      {captcha ? 'Captcha' : 'Auth required'}
    </Badge>
  );
  const preview = captcha ? (
    <div className="flex h-[46px] w-[74px] shrink-0 items-center justify-center rounded-[6px] border border-border-strong bg-gradient-to-b from-secondary to-skeleton text-nano text-faint">
      screenshot
    </div>
  ) : null;

  if (layout === 'panel') {
    return (
      <Shell tone="warning" layout={layout} ring={false}>
        <Header badge={badge} meta={meta} />
        <div className="mt-2 flex items-center gap-[9px]">
          {preview}
          <div className="text-body-sm leading-[1.45] font-semibold">{notification.title}</div>
        </div>
        <div className="mt-1.5 text-caption leading-[1.6] text-muted-foreground">
          請到該 Persona 視窗的瀏覽器{captcha ? '完成驗證' : '完成登入'}後按「繼續」。
        </div>
        <div className="mt-[9px] flex gap-1.5">
          {onOpenPersona ? (
            <Button variant="primary" size="md" className="flex-1" onClick={onOpenPersona}>
              Open browser
            </Button>
          ) : null}
          <Button variant="outline" size="md" onClick={resume}>
            Continue
          </Button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell tone="warning" layout={layout}>
      <Header badge={badge} label={captcha ? '需要你完成驗證碼' : '需要你親自登入'} meta={meta} />
      <div className="mt-2 flex items-start gap-[9px]">
        {preview}
        <div className="text-label leading-[1.6] text-muted-foreground">{notification.body}</div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {onOpenPersona ? (
          <Button variant="primary" size="md" onClick={onOpenPersona}>
            開啟瀏覽器
          </Button>
        ) : null}
        <Button variant={onOpenPersona ? 'outline' : 'primary'} size="md" onClick={resume}>
          繼續
        </Button>
        <Button
          variant="outline"
          size="md"
          onClick={() => dispatch({ type: 'interrupt/skip', notificationId: notification.id })}
        >
          跳過這個步驟
        </Button>
        <span className="flex-1" />
        <span className="text-tiny text-faint">也可在 Action center 或桌面通知處理</span>
      </div>
    </Shell>
  );
}

function ToolError({
  notification,
  payload,
  agentName,
  layout,
  meta,
}: {
  notification: Notification;
  payload: Extract<InterruptPayload, { type: 'tool_error' }>;
  agentName: string;
  layout: InterruptLayout;
  meta: string;
}) {
  const dispatch = useDispatch();
  const resolve = (action: 'retry' | 'ignore') =>
    dispatch({ type: 'toolError/resolve', notificationId: notification.id, action });
  const actions = (
    <div className="mt-[7px] flex gap-1.5">
      {payload.retryable ? (
        <Button variant="soft" size="xs" onClick={() => resolve('retry')}>
          Retry
        </Button>
      ) : null}
      <Button variant="outline" size="xs" className="text-faint" onClick={() => resolve('ignore')}>
        Ignore
      </Button>
    </div>
  );
  if (layout === 'panel') {
    return (
      <div className="flex gap-[9px] rounded-md border border-border bg-background px-[11px] py-2.5">
        <span className="mt-[5px] size-[6px] shrink-0 rounded-full bg-danger" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-label font-semibold">
              {notification.title}
            </span>
            <span className="shrink-0 font-mono text-micro text-faint">{meta}</span>
          </div>
          <div className="mt-[3px] text-caption leading-[1.55] text-muted-foreground">
            {agentName} · {notification.body}
          </div>
          {actions}
        </div>
      </div>
    );
  }
  return (
    <Shell tone="danger" layout={layout} ring={false}>
      <Header
        badge={
          <Badge tone="danger-solid" size="sm">
            Tool error
          </Badge>
        }
        label={payload.toolName}
        meta={meta}
      />
      <div className={cn('mt-[7px]', MONO_BOX)}>
        {payload.toolName} · {payload.error}
      </div>
      {actions}
    </Shell>
  );
}

const RESOLUTION_TITLE: Readonly<Record<InterruptResolution, string>> = {
  approved: 'Approved',
  approved_with_edits: 'Approved with edits',
  rejected: 'Denied',
  answered: 'Answered',
  resumed: 'Continued',
  skipped: 'Skipped',
  retried: 'Retrying',
  ignored: 'Ignored',
  canceled: 'Canceled',
};

function subjectOf(payload: InterruptPayload): string {
  switch (payload.type) {
    case 'tool_approval':
    case 'tool_error':
      return payload.toolName;
    case 'question':
      return payload.question;
    case 'auth_required':
    case 'captcha':
      return payload.site;
  }
}

function ResolvedCard({
  data,
  notification,
  resolution,
  layout,
  now,
  onOpenPersona,
}: {
  data: PlatformState;
  notification: Notification;
  resolution: InterruptResolution;
  layout: InterruptLayout;
  now: number;
  onOpenPersona?: (() => void) | undefined;
}) {
  const interrupt = notification.interrupt!;
  const agentName = data.agents[notification.agentId]?.name ?? notification.agentId;
  const task = notification.taskId ? data.tasks[notification.taskId] : undefined;
  const remaining = task ? task.steps.filter((step) => step.state !== 'done').length : 0;
  const positive = ['approved', 'approved_with_edits', 'answered', 'resumed', 'retried'].includes(
    resolution,
  );
  const body = (() => {
    switch (resolution) {
      case 'rejected':
        return `${agentName} 會收到拒絕結果並調整做法。`;
      case 'ignored':
        return '已忽略，任務不會重試這個工具。';
      case 'canceled':
        return '任務已取消，這個請求不再需要回應。';
      case 'skipped':
        return `${agentName} 會略過這個步驟繼續。`;
      case 'answered':
        return `你的回答：${interrupt.note ?? ''}`;
      default:
        return remaining > 0
          ? `${agentName} 繼續執行剩餘 ${remaining} 個步驟。`
          : `${agentName} 繼續執行。`;
    }
  })();
  return (
    <div
      className={cn(
        'animate-reveal rounded-md border bg-background',
        layout === 'panel' ? 'p-[11px]' : 'p-3',
        positive
          ? 'border-success shadow-[0_0_0_3px_var(--color-success-soft)]'
          : 'border-border-strong',
      )}
    >
      <div className="flex items-center gap-[7px]">
        <span className={positive ? 'text-success' : 'text-faint'}>
          <Icon name={positive ? 'check' : 'close'} size={14} />
        </span>
        <span className="min-w-0 truncate text-caption font-semibold">
          {RESOLUTION_TITLE[resolution]} · {subjectOf(interrupt.payload)}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 font-mono text-micro text-faint">
          {interrupt.resolvedAt ? formatAgo(interrupt.resolvedAt, now) : ''}
        </span>
      </div>
      <div className="mt-[7px] text-caption leading-[1.6] text-muted-foreground">{body}</div>
      {resolution === 'approved_with_edits' && interrupt.note ? (
        <div className={cn('mt-1.5', MONO_BOX)}>{interrupt.note}</div>
      ) : null}
      {onOpenPersona ? (
        <button
          type="button"
          className="mt-2 text-caption font-semibold text-primary hover:opacity-70"
          onClick={onOpenPersona}
        >
          View in persona thread →
        </button>
      ) : null}
    </div>
  );
}
