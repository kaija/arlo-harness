import type { AgentId } from '@arlo/shared';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { Icon } from '../../components/icon.js';
import { StatusDot } from '../../components/status-dot.js';
import { TONE_TEXT } from '../../components/tone.js';
import { Button } from '../../components/ui/button.js';
import { SearchInput } from '../../components/ui/input.js';
import { ChipGroup } from '../../components/ui/segmented.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import { cn } from '../../lib/utils.js';
import type { Agent, PlatformState } from '../../state/model.js';
import {
  activityCounts,
  agentBadge,
  agentStatusLine,
  filterPersonas,
  ORCHESTRATOR_ID,
  pendingInterrupts,
  personas,
  toneOfAgent,
  type AgentFilter,
} from '../../state/selectors.js';

interface SidebarProps {
  data: PlatformState;
  now: number;
  selected: AgentId;
  filter: AgentFilter;
  query: string;
  onFilter: (filter: AgentFilter) => void;
  onQuery: (query: string) => void;
  onSelect: (agentId: AgentId) => void;
  onOpenWindow: (agentId: AgentId) => void;
  onOpenSettings: (agentId: AgentId) => void;
  onNewPersona: () => void;
}

function cardClass(agent: Agent, selected: boolean) {
  return cn(
    'relative w-full rounded-tile border bg-background text-left transition-[transform,box-shadow,border-color] duration-250 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md),0_0_0_1px_var(--color-primary-glow)] active:translate-y-0',
    selected
      ? 'border-primary shadow-[var(--shadow-md),0_0_0_3px_var(--color-primary-glow)]'
      : agent.activity === 'waiting'
        ? 'border-warning shadow-[0_0_0_3px_var(--color-warning-soft)]'
        : agent.activity === 'error'
          ? 'border-border-strong'
          : 'border-border',
  );
}

function SelectionBar({ on }: { on: boolean }) {
  return on ? (
    <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] origin-center animate-bar-in rounded-full bg-primary" />
  ) : null;
}

function StatusLine({ data, agent, now }: { data: PlatformState; agent: Agent; now: number }) {
  const tone = toneOfAgent(agent);
  return (
    <div className={cn('flex items-center gap-[5px] text-caption font-semibold', TONE_TEXT[tone])}>
      <StatusDot tone={tone} pulse={agent.activity === 'working' && !agent.paused} />
      <span className="truncate">{agentStatusLine(data, agent, now)}</span>
    </div>
  );
}

export function AgentSidebar({
  data,
  now,
  selected,
  filter,
  query,
  onFilter,
  onQuery,
  onSelect,
  onOpenWindow,
  onOpenSettings,
  onNewPersona,
}: SidebarProps) {
  const counts = activityCounts(data);
  const orchestrator = data.agents[ORCHESTRATOR_ID];
  const list = filterPersonas(data, filter, query);
  const hasPersonas = personas(data).length > 0;

  return (
    <nav
      aria-label="Agents"
      className="flex w-[252px] shrink-0 flex-col border-r border-border bg-secondary"
    >
      <div className="flex flex-col gap-[9px] px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-semibold">Agents</span>
          <span className="flex-1" />
          <span className="text-caption text-faint">
            {counts.running} running · {counts.waiting} waiting
          </span>
        </div>
        <SearchInput
          placeholder="Search agents"
          aria-label="Search agents"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <ChipGroup
          aria-label="Filter agents by status"
          value={filter}
          onValueChange={onFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'working', label: 'Working' },
            { value: 'waiting', label: counts.waiting ? `Waiting ${counts.waiting}` : 'Waiting' },
            { value: 'error', label: 'Error' },
          ]}
        />
      </div>

      {orchestrator ? (
        <div className="px-2 pt-1">
          <button
            type="button"
            aria-current={selected === ORCHESTRATOR_ID}
            onClick={() => onSelect(ORCHESTRATOR_ID)}
            className={cn(
              cardClass(orchestrator, selected === ORCHESTRATOR_ID),
              'flex items-center gap-[9px] bg-primary-soft py-[9px] pr-2.5 pl-[13px]',
              selected !== ORCHESTRATOR_ID && 'border-primary-glow',
            )}
          >
            <SelectionBar on={selected === ORCHESTRATOR_ID} />
            <AgentAvatar agent={orchestrator} />
            <div className="min-w-0 flex-1">
              <div className="text-body font-semibold">Orchestrator</div>
              <div className="flex items-center gap-[5px] text-caption text-primary">
                <StatusDot tone="accent" pulse={orchestrator.activity === 'working'} />
                <span className="truncate">{agentStatusLine(data, orchestrator, now)}</span>
              </div>
            </div>
          </button>
        </div>
      ) : null}

      <div className="px-[18px] pt-3.5 pb-1.5 text-tiny tracking-[0.02em] text-faint">
        Personas · {list.length}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pt-0.5 pb-2">
        {!hasPersonas ? (
          <div className="rounded-tile border border-dashed border-border-strong px-[11px] py-3.5 text-center text-caption leading-[1.6] text-faint">
            還沒有 Persona
          </div>
        ) : list.length === 0 ? (
          <div className="px-2 py-3 text-center text-caption text-faint">沒有符合的 Persona</div>
        ) : null}
        {list.map((agent) => {
          const on = agent.id === selected;
          const badge = agentBadge(data, agent, now);
          const task = agent.currentTaskId ? data.tasks[agent.currentTaskId] : undefined;
          return (
            <div key={agent.id} className={cn(cardClass(agent, on), 'py-[9px] pr-2.5 pl-[13px]')}>
              <SelectionBar on={on} />
              <button
                type="button"
                aria-current={on}
                aria-label={`${agent.name}, ${agentStatusLine(data, agent, now)}`}
                onClick={() => onSelect(agent.id)}
                onDoubleClick={() => onOpenWindow(agent.id)}
                className="absolute inset-0 rounded-tile"
              />
              <div className="pointer-events-none relative flex items-center gap-[9px]">
                <AgentAvatar agent={agent} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-semibold">{agent.name}</div>
                  <StatusLine data={data} agent={agent} now={now} />
                </div>
                {badge ? (
                  <span
                    className={cn(
                      'shrink-0',
                      badge.kind === 'action'
                        ? 'rounded-full bg-warning px-[7px] py-[3px] text-micro font-semibold text-white'
                        : 'font-mono text-micro text-faint',
                    )}
                  >
                    {badge.text}
                  </span>
                ) : null}
              </div>
              {task ? (
                <div className="pointer-events-none relative mt-[7px] text-caption leading-[1.45] text-muted-foreground">
                  {task.title}
                </div>
              ) : null}
              {on && agent.browser ? (
                <div className="pointer-events-none relative mt-[7px] flex animate-reveal items-center gap-[7px]">
                  <div className="flex h-[33px] w-[52px] shrink-0 items-end gap-0.5 rounded-xs border border-border-strong bg-gradient-to-b from-muted to-skeleton p-[3px]">
                    {agent.browser.thumbnail.map((height, index) => (
                      <span
                        key={index}
                        className="flex-1 rounded-[1px] bg-primary-glow"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                  <div className="font-mono text-micro leading-[1.5] text-faint">
                    {
                      agent.browser.tabs
                        .find((tab) => tab.id === agent.browser?.activeTabId)
                        ?.url.split('/')[0]
                    }
                    {agent.resources ? (
                      <>
                        <br />
                        mem {agent.resources.memoryMb} MB · CPU {agent.resources.cpuPercent}%
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {on ? (
                <div className="relative mt-2 flex animate-reveal gap-1.5">
                  <Button variant="primary" size="xs" onClick={() => onOpenWindow(agent.id)}>
                    Open window
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => onOpenSettings(agent.id)}>
                    Settings
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <Button
          variant="dashed"
          size="md"
          className="w-full py-2 text-body-sm"
          onClick={onNewPersona}
        >
          + New persona
        </Button>
        <div className="mt-[7px] text-center font-mono text-tiny text-faint">
          ⌘1–5 切換 · [ ] 循環
        </div>
      </div>
    </nav>
  );
}

/** Narrow windows: the list collapses to an icon rail; badges stay visible. */
export function AgentRail({
  data,
  now,
  selected,
  onSelect,
  onOpenWindow,
  onNewPersona,
}: Pick<SidebarProps, 'data' | 'now' | 'selected' | 'onSelect' | 'onOpenWindow' | 'onNewPersona'>) {
  return (
    <nav
      aria-label="Agents"
      className="flex w-[46px] shrink-0 flex-col items-center gap-[7px] overflow-y-auto border-r border-border bg-secondary py-[9px]"
    >
      {data.agentOrder.map((id) => {
        const agent = data.agents[id];
        if (!agent) return null;
        const waiting = pendingInterrupts(data, id).length > 0;
        return (
          <Tooltip key={id} content={`${agent.name} · ${agentStatusLine(data, agent, now)}`}>
            <button
              type="button"
              aria-label={agent.name}
              aria-current={id === selected}
              onClick={() => onSelect(id)}
              onDoubleClick={() => id !== ORCHESTRATOR_ID && onOpenWindow(id)}
              className={cn(
                'relative rounded-sm transition-shadow duration-150',
                id === selected && 'shadow-[0_0_0_2px_var(--color-primary)]',
                id !== selected && waiting && 'shadow-[0_0_0_2px_var(--color-warning)]',
              )}
            >
              <AgentAvatar agent={agent} size={28} />
              {waiting ? (
                <span className="absolute -top-[3px] -right-[3px] size-[9px] rounded-full border-2 border-secondary bg-warning" />
              ) : null}
            </button>
          </Tooltip>
        );
      })}
      <span className="flex-1" />
      <Tooltip content="New persona">
        <button
          type="button"
          aria-label="New persona"
          onClick={onNewPersona}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-primary-glow text-primary"
        >
          <Icon name="new-chat" size={13} />
        </button>
      </Tooltip>
    </nav>
  );
}
