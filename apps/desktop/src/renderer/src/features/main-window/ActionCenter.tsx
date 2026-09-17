import type { AgentId } from '@arlo/shared';
import { useState } from 'react';
import { Icon } from '../../components/icon.js';
import { Badge } from '../../components/ui/badge.js';
import { ChipGroup } from '../../components/ui/segmented.js';
import { formatClock } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { Notification, PlatformState, Severity } from '../../state/model.js';
import {
  actionCenterSections,
  pendingInterrupts,
  type ActionCenterFilter,
} from '../../state/selectors.js';
import { useDispatch } from '../../state/store.js';
import { InterruptCard } from '../interrupts/InterruptCard.js';

const SEVERITY_DOT: Readonly<Record<Severity, string>> = {
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-danger',
  action_required: 'bg-warning',
};

interface ActionCenterProps {
  data: PlatformState;
  now: number;
  onOpenThread: (agentId: AgentId, threadId?: string) => void;
  /** Present when shown as a drawer in narrow windows. */
  onClose?: () => void;
  className?: string;
}

export function ActionCenter({ data, now, onOpenThread, onClose, className }: ActionCenterProps) {
  const dispatch = useDispatch();
  const [filter, setFilter] = useState<ActionCenterFilter>('all');
  const { pinned, earlier } = actionCenterSections(data, filter, now);
  const pendingCount = pendingInterrupts(data).length;
  const unread = data.notifications.some((n) => !n.read);

  const open = (n: Notification) => {
    if (!n.read) dispatch({ type: 'notifications/markRead', notificationId: n.id });
    onOpenThread(n.agentId, n.threadId);
  };

  return (
    <aside
      aria-label="Action center"
      className={cn(
        'flex w-[312px] shrink-0 flex-col border-l border-border bg-secondary',
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-body-sm font-semibold">Action center</span>
        {pendingCount > 0 ? (
          <Badge tone="warning-solid" size="xs" className="px-[7px] text-micro">
            {pendingCount}
          </Badge>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          disabled={!unread}
          onClick={() => dispatch({ type: 'notifications/markAllRead' })}
          className="text-caption text-primary hover:opacity-70 disabled:text-faint disabled:opacity-100"
        >
          Mark all read
        </button>
        {onClose ? (
          <button
            type="button"
            aria-label="Close action center"
            onClick={onClose}
            className="text-faint hover:text-foreground"
          >
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>
      <div className="shrink-0 border-b border-border px-3 py-[9px]">
        <ChipGroup
          aria-label="Filter notifications"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'action', label: 'Action required' },
            { value: 'errors', label: 'Errors' },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {pinned.length > 0 ? (
          <div className="px-0.5 text-micro text-faint">Pinned · needs you</div>
        ) : null}
        {pinned.map((n) => (
          <InterruptCard
            key={n.id}
            data={data}
            notification={n}
            layout="panel"
            now={now}
            onOpenPersona={() => open(n)}
          />
        ))}
        {earlier.length > 0 ? (
          <div className="px-0.5 pt-1.5 text-micro text-faint">Earlier</div>
        ) : null}
        {earlier.map((n) =>
          n.interrupt?.payload.type === 'tool_error' && !n.interrupt.resolution ? (
            <InterruptCard key={n.id} data={data} notification={n} layout="panel" now={now} />
          ) : (
            <button
              type="button"
              key={n.id}
              onClick={() => open(n)}
              className={cn(
                'flex gap-[9px] rounded-md border border-border bg-background px-[11px] py-2.5 text-left transition-[border-color,box-shadow] duration-250 hover:border-primary-glow hover:shadow-sm',
                n.read && 'opacity-80',
              )}
            >
              <span
                className={cn(
                  'mt-[5px] size-[6px] shrink-0 rounded-full',
                  SEVERITY_DOT[n.severity],
                )}
              />
              <div className="min-w-0 flex-1">
                <div className={cn('text-label', n.read ? 'font-medium' : 'font-semibold')}>
                  {n.title}
                </div>
                <div className="mt-[3px] text-caption leading-[1.55] text-muted-foreground">
                  {data.agents[n.agentId]?.name ?? n.agentId} ·{' '}
                  {n.interrupt?.resolution ? `已處理（${n.interrupt.resolution}）` : n.body}
                </div>
              </div>
              <span className="shrink-0 font-mono text-micro text-faint">
                {formatClock(n.at, now)}
              </span>
            </button>
          ),
        )}
        {pinned.length === 0 && earlier.length === 0 ? (
          <div className="px-2 py-8 text-center text-caption text-faint">沒有通知</div>
        ) : null}
      </div>
    </aside>
  );
}
