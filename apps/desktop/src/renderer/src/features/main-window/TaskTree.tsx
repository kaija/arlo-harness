import type { AgentId } from '@arlo/shared';
import { useEffect, useRef, useState } from 'react';
import { TONE_TEXT } from '../../components/tone.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { formatClock, formatElapsed } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { PlatformState, Task } from '../../state/model.js';
import { childTasks, taskProgress, TASK_STATE_LABEL, toneOfTask } from '../../state/selectors.js';
import { useDispatch } from '../../state/store.js';
import { StepList } from './PersonaOverview.js';

const STATE_BADGE = {
  running: 'primary',
  waiting: 'warning',
  done: 'success',
  failed: 'danger',
  queued: 'neutral',
  canceled: 'neutral',
} as const;

function isActive(task: Task) {
  return task.state === 'running' || task.state === 'waiting' || task.state === 'queued';
}

function CancelButton({ taskId }: { taskId: string }) {
  const dispatch = useDispatch();
  const [confirming, setConfirming] = useState(false);
  return (
    <Button
      variant={confirming ? 'primary' : 'danger'}
      size="xs"
      className={cn('py-[2px]', confirming && 'bg-danger hover:bg-danger')}
      onBlur={() => setConfirming(false)}
      onClick={(event) => {
        event.stopPropagation();
        if (confirming) dispatch({ type: 'task/cancel', taskId });
        setConfirming(!confirming);
      }}
    >
      {confirming ? 'Confirm cancel' : 'Cancel'}
    </Button>
  );
}

function timing(task: Task, now: number): string {
  const start = task.startedAt ?? task.createdAt;
  const end = task.endedAt ?? now;
  return `${formatClock(start, now)} · ${formatElapsed(end - start)}`;
}

interface TaskTreeProps {
  data: PlatformState;
  now: number;
  focusTaskId?: string | undefined;
  onOpenThread: (agentId: AgentId, threadId: string) => void;
}

export function TaskTree({ data, now, focusTaskId, onOpenThread }: TaskTreeProps) {
  const roots = data.rootTaskIds
    .map((id) => data.tasks[id])
    .filter((task): task is Task => task !== undefined);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>();
    for (const task of Object.values(data.tasks)) {
      if (task.state === 'waiting' || (!task.parentId && isActive(task))) open.add(task.id);
    }
    if (focusTaskId) open.add(focusTaskId);
    return open;
  });
  const focused = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusTaskId) return;
    setExpanded((prev) => new Set(prev).add(focusTaskId));
    focused.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusTaskId]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const today = roots.filter(
    (task) => new Date(task.createdAt).toDateString() === new Date(now).toDateString(),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-[18px] py-4">
      <div className="mb-0.5 flex items-center gap-2">
        <span className="text-body-sm font-semibold">Task tree</span>
        <span className="text-caption text-faint">今天 · {today.length} 個根任務</span>
      </div>
      {roots.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-caption text-faint">
          還沒有任務。對 Orchestrator 下達第一個任務後會出現在這裡。
        </div>
      ) : null}
      {roots.map((root) => {
        const open = expanded.has(root.id);
        const children = childTasks(data, root.id);
        return (
          <div
            key={root.id}
            ref={root.id === focusTaskId ? focused : undefined}
            className={cn(
              'rounded-md border px-3 py-[11px] transition-shadow duration-250',
              isActive(root) ? 'border-border-strong' : 'border-border opacity-85',
              root.id === focusTaskId &&
                'border-primary opacity-100 shadow-[0_0_0_3px_var(--color-primary-glow)]',
            )}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(root.id)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span className="w-2 text-label text-faint">{open ? '▾' : '▸'}</span>
              <span className="min-w-0 truncate text-body-sm font-semibold">{root.title}</span>
              <Badge tone={STATE_BADGE[root.state]} size="xs" className="text-tiny">
                {TASK_STATE_LABEL[root.state]}
              </Badge>
              <span className="flex-1" />
              <span className="shrink-0 font-mono text-tiny text-faint">{timing(root, now)}</span>
            </button>
            {!open && root.result ? (
              <div className="mt-[7px] ml-[19px] text-caption text-muted-foreground">
                結果摘要：{root.result}
              </div>
            ) : null}
            {open ? (
              <div className="mt-[9px] ml-4 flex animate-reveal flex-col gap-[7px] border-l border-border-strong pl-3">
                {children.length === 0 ? <StepList task={root} /> : null}
                {children.map((child) => (
                  <ChildNode
                    key={child.id}
                    data={data}
                    task={child}
                    open={expanded.has(child.id)}
                    focused={child.id === focusTaskId}
                    onToggle={() => toggle(child.id)}
                    onOpenThread={onOpenThread}
                  />
                ))}
                {root.result ? (
                  <div className="text-caption text-muted-foreground">結果摘要：{root.result}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ChildNode({
  data,
  task,
  open,
  focused,
  onToggle,
  onOpenThread,
}: {
  data: PlatformState;
  task: Task;
  open: boolean;
  focused: boolean;
  onToggle: () => void;
  onOpenThread: (agentId: AgentId, threadId: string) => void;
}) {
  const tone = toneOfTask(task.state);
  const agent = data.agents[task.agentId];
  const progress = taskProgress(task);
  const pending = data.notifications.find(
    (n) =>
      n.taskId === task.id &&
      n.interrupt &&
      !n.interrupt.resolution &&
      n.severity === 'action_required',
  );
  const done = task.steps.filter((step) => step.state === 'done').map((step) => step.label);
  return (
    <div
      className={cn(
        'rounded-tile border px-[11px] py-[9px]',
        task.state === 'waiting'
          ? 'border-warning bg-warning-soft'
          : task.state === 'running'
            ? 'border-border bg-secondary'
            : 'border-border',
        focused && 'border-primary shadow-[0_0_0_3px_var(--color-primary-glow)]',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className="w-2 text-label text-faint">{open ? '▾' : '▸'}</span>
          <span className="truncate text-label font-semibold">{task.title}</span>
          <span className="shrink-0 text-tiny text-muted-foreground">
            {agent?.name ?? task.agentId}
          </span>
        </button>
        <span className="flex-1" />
        <span
          className={cn(
            'shrink-0 text-tiny',
            task.state === 'queued' ? 'text-faint' : ['font-semibold', TONE_TEXT[tone]],
          )}
        >
          {TASK_STATE_LABEL[task.state]}
          {task.state === 'running' && progress.total
            ? ` · ${progress.done}/${progress.total}`
            : ''}
        </span>
        {task.state === 'running' || task.state === 'queued' ? (
          <CancelButton taskId={task.id} />
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 ml-[19px] flex animate-reveal flex-col gap-2">
          {task.state === 'waiting' ? (
            <div className="text-caption leading-[1.6] text-muted-foreground">
              {done.length > 0 ? (
                <>
                  已完成：{done.join(' · ')}
                  <br />
                </>
              ) : null}
              待處理：
              {pending ? pending.title : task.steps.find((step) => step.state === 'waiting')?.label}
            </div>
          ) : task.steps.length > 0 ? (
            <StepList task={task} />
          ) : (
            <div className="text-caption text-muted-foreground">{task.brief}</div>
          )}
          {task.result ? (
            <div className="text-caption text-muted-foreground">結果摘要：{task.result}</div>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-caption font-semibold text-primary hover:opacity-70"
              onClick={() => onOpenThread(task.agentId, task.threadId)}
            >
              Jump to persona thread →
            </button>
            {task.state === 'waiting' ? <CancelButton taskId={task.id} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
