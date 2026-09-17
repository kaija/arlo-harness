import { StatusDot } from '../../components/status-dot.js';
import { Badge } from '../../components/ui/badge.js';
import { SearchInput } from '../../components/ui/input.js';
import { formatThreadStamp } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { PlatformState, Thread } from '../../state/model.js';
import { threadStatus, type ThreadStatus } from '../../state/selectors.js';

const STATUS: Readonly<Record<ThreadStatus, { label: string; className: string }>> = {
  pinned: { label: 'pinned', className: 'text-faint' },
  running: { label: 'running', className: 'text-primary' },
  waiting: { label: 'waiting for input', className: 'text-warning font-semibold' },
  queued: { label: 'queued', className: 'text-faint' },
  done: { label: 'done', className: 'text-success' },
  failed: { label: 'failed', className: 'text-danger' },
};

interface ThreadListProps {
  data: PlatformState;
  threads: Thread[];
  selectedId: string | undefined;
  query: string;
  now: number;
  onQuery: (query: string) => void;
  onSelect: (threadId: string) => void;
  className?: string;
}

export function ThreadList({
  data,
  threads,
  selectedId,
  query,
  now,
  onQuery,
  onSelect,
  className,
}: ThreadListProps) {
  return (
    <nav
      aria-label="Threads"
      className={cn(
        'flex w-[214px] shrink-0 flex-col border-r border-border bg-secondary',
        className,
      )}
    >
      <div className="px-2.5 pt-2.5 pb-2">
        <SearchInput
          placeholder="Search threads"
          aria-label="Search threads"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-[7px] pb-2">
        {threads.length === 0 ? (
          <div className="px-2 py-4 text-center text-caption text-faint">沒有符合的 Thread</div>
        ) : null}
        {threads.map((thread) => {
          const status = threadStatus(data, thread);
          const on = thread.id === selectedId;
          return (
            <button
              type="button"
              key={thread.id}
              aria-current={on}
              onClick={() => onSelect(thread.id)}
              className={cn(
                'rounded-[9px] border bg-background px-[9px] py-2 text-left transition-[border-color,box-shadow] duration-150',
                on
                  ? 'border-primary shadow-[0_0_0_3px_var(--color-primary-soft)]'
                  : 'border-border hover:border-primary-glow',
              )}
            >
              <div className="flex items-center gap-1.5">
                <Badge tone={thread.source === 'orchestrator' ? 'primary' : 'neutral'} size="xs">
                  {thread.source}
                </Badge>
                <span className="flex-1" />
                <span className="font-mono text-nano text-faint">
                  {formatThreadStamp(thread.lastActivityAt, now)}
                </span>
              </div>
              <div className="mt-[5px] text-label leading-[1.4] font-semibold">{thread.title}</div>
              <div
                className={cn(
                  'mt-[3px] flex items-center gap-[5px] text-tiny',
                  STATUS[status].className,
                )}
              >
                {status === 'running' ? <StatusDot tone="accent" pulse size={5} /> : null}
                {STATUS[status].label}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
