import { useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { formatMs, formatSeconds } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import type { PlatformState, Span } from '../../state/model.js';
import { runsFor, spansFor } from '../../state/selectors.js';

const SPAN_COLOR: Readonly<Record<Span['kind'], string>> = {
  model: 'bg-primary',
  tool: 'bg-faint',
  browser: 'bg-faint',
  mcp: 'bg-success',
};

function exportTrace(threadId: string, payload: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `trace-${threadId.replace(/[^a-z0-9-]/gi, '_')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** ADR-0011 trace timeline for one Thread: spans per Run with duration and token use. */
export function ExecutionLog({
  data,
  threadId,
  open,
  onToggle,
}: {
  data: PlatformState;
  threadId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const runs = runsFor(data, threadId);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const run = runs.find((r) => r.id === runId) ?? runs[runs.length - 1];
  const spans = run ? spansFor(data, run.id) : [];
  const total = spans.reduce((max, span) => Math.max(max, span.startMs + span.durationMs), 0);
  const tokens = spans.reduce((sum, span) => sum + (span.tokens ?? 0), 0);

  return (
    <section aria-label="Execution log" className="shrink-0 border-t border-border">
      <div className="flex h-[34px] items-center gap-[9px] bg-secondary px-3.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-[9px] text-left"
        >
          <span className="w-2 text-caption text-faint">{open ? '▾' : '▸'}</span>
          <span className="shrink-0 text-label font-semibold">Execution log</span>
          <span className="truncate font-mono text-tiny text-faint">
            {run
              ? `run ${run.index} · ${spans.length} spans · ${formatSeconds(total)} · ${tokens.toLocaleString('en-US')} tokens`
              : '尚無執行紀錄'}
          </span>
        </button>
        {runs.length > 1 ? (
          <select
            aria-label="Filter by run"
            value={run?.id}
            onChange={(event) => setRunId(event.target.value)}
            className="rounded-full border border-border-strong bg-background px-2 py-[1px] text-tiny font-semibold text-primary focus:outline-none"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                Run {r.index}
              </option>
            ))}
          </select>
        ) : null}
        {run ? (
          <Button
            variant="link"
            size="xs"
            className="py-0 text-tiny"
            onClick={() =>
              exportTrace(threadId, { runs, spans: runs.flatMap((r) => spansFor(data, r.id)) })
            }
          >
            Export
          </Button>
        ) : null}
      </div>
      {open && run ? (
        <div className="flex max-h-[220px] animate-reveal flex-col gap-[5px] overflow-y-auto border-t border-border bg-background px-3.5 pt-2.5 pb-[13px]">
          <div className="flex items-center gap-[9px] font-mono text-tiny text-faint">
            <span className="w-[108px]">span</span>
            <span className="flex-1">timeline</span>
            <span className="w-[52px] text-right">ms</span>
            <span className="w-[60px] text-right">tokens</span>
          </div>
          {spans.map((span) => (
            <div key={span.id}>
              <button
                type="button"
                aria-expanded={expanded === span.id}
                onClick={() => setExpanded(expanded === span.id ? undefined : span.id)}
                className="flex w-full items-center gap-[9px] rounded-xs text-left text-caption hover:bg-secondary"
              >
                <span className="w-[108px] truncate font-mono">{span.name}</span>
                <span className="relative h-[7px] flex-1 rounded-full bg-muted">
                  <span
                    className={cn('absolute top-0 bottom-0 rounded-full', SPAN_COLOR[span.kind])}
                    style={{
                      left: `${total ? (span.startMs / total) * 100 : 0}%`,
                      width: `${total ? Math.max(1.5, (span.durationMs / total) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="w-[52px] text-right font-mono">{formatMs(span.durationMs)}</span>
                <span className="w-[60px] text-right font-mono">
                  {span.tokens ? formatMs(span.tokens) : '—'}
                </span>
              </button>
              {expanded === span.id ? (
                <div className="animate-reveal py-1 pl-[117px] font-mono text-tiny text-muted-foreground">
                  {span.kind} · +{formatMs(span.startMs)}ms · {span.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
