import type { AgentId } from '@arlo/shared';
import { getRouteApi, Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { Icon } from '../../components/icon.js';
import { StatusDot } from '../../components/status-dot.js';
import { Button } from '../../components/ui/button.js';
import { Segmented } from '../../components/ui/segmented.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import { WindowTitleBar } from '../../components/window-title-bar.js';
import { showPersonaWindow } from '../../lib/bridge.js';
import { useNow, useWindowWidth } from '../../lib/hooks.js';
import { cn } from '../../lib/utils.js';
import {
  agentIdOf,
  modelLabel,
  ORCHESTRATOR_ID,
  pendingInterrupts,
  personaIdOf,
  personas,
  providerById,
  userThreadId,
  type AgentFilter,
} from '../../state/selectors.js';
import { useData, useDispatch } from '../../state/store.js';
import { Composer } from '../chat/Composer.js';
import { ThreadView } from '../chat/ThreadView.js';
import { InterruptCard } from '../interrupts/InterruptCard.js';
import { ActionCenter } from './ActionCenter.js';
import { AgentRail, AgentSidebar } from './AgentSidebar.js';
import { PersonaOverview } from './PersonaOverview.js';
import { TaskTree } from './TaskTree.js';
import { ToastStack } from './ToastStack.js';

const route = getRouteApi('/main');

/** Widths where the layout degrades (design "Narrow"): navigation collapses before content does. */
const DOCKED_ACTION_CENTER_MIN = 1120;
const FULL_SIDEBAR_MIN = 860;

export function MainWindow() {
  const data = useData();
  const dispatch = useDispatch();
  const now = useNow();
  const width = useWindowWidth();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const requested: AgentId =
    search.agent && search.agent !== ORCHESTRATOR_ID ? agentIdOf(search.agent) : ORCHESTRATOR_ID;
  const selectedId: AgentId = data.agents[requested] ? requested : ORCHESTRATOR_ID;
  const selected = data.agents[selectedId];
  const panel = search.panel ?? 'chat';
  const docked = width >= DOCKED_ACTION_CENTER_MIN;
  const fullSidebar = width >= FULL_SIDEBAR_MIN;
  const pendingCount = pendingInterrupts(data).length;

  const select = useCallback(
    (agentId: AgentId) =>
      void navigate({
        search: (prev) => ({
          ...prev,
          agent: agentId === ORCHESTRATOR_ID ? undefined : personaIdOf(agentId),
          task: undefined,
        }),
        replace: true,
      }),
    [navigate],
  );
  const openWindow = (agentId: AgentId, threadId?: string) => {
    if (agentId === ORCHESTRATOR_ID) {
      select(ORCHESTRATOR_ID);
      void navigate({ search: (prev) => ({ ...prev, agent: undefined, panel: 'chat' }) });
      return;
    }
    showPersonaWindow(personaIdOf(agentId), threadId);
  };
  const openPersonaSettings = (agentId: AgentId) =>
    void navigate({
      to: '/main/personas/$personaId/settings',
      params: { personaId: personaIdOf(agentId) },
      search: (prev) => ({ ...prev, tab: undefined }),
    });
  const openGlobalSettings = (tab?: string) =>
    void navigate({ to: '/main/settings', search: (prev) => ({ ...prev, tab }) });
  const newPersona = () => void navigate({ to: '/welcome', search: { step: 2, from: 'main' } });

  // ⌘1–5 jumps to an Agent in list order; [ and ] cycle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const ids = data.agentOrder;
      if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        const id = ids[Number(event.key) - 1];
        if (id) {
          event.preventDefault();
          select(id);
        }
      } else if (event.key === '[' || event.key === ']') {
        const index = Math.max(0, ids.indexOf(selectedId));
        const next = ids[(index + (event.key === ']' ? 1 : ids.length - 1)) % ids.length];
        if (next) select(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data.agentOrder, select, selectedId]);

  if (!selected) return null;
  const orchestratorSelected = selectedId === ORCHESTRATOR_ID;
  const threadId = userThreadId(selectedId);
  const noPersonas = personas(data).length === 0;
  const provider = providerById(data, selected.model.providerId);

  const renderInterrupt = (notificationId: string) => {
    const notification = data.notifications.find((n) => n.id === notificationId);
    return notification ? (
      <InterruptCard data={data} notification={notification} layout="inline" now={now} />
    ) : null;
  };

  let content;
  if (panel === 'tree') {
    content = (
      <TaskTree data={data} now={now} focusTaskId={search.task} onOpenThread={openWindow} />
    );
  } else if (orchestratorSelected) {
    content = (
      <ThreadView
        data={data}
        threadId={threadId}
        now={now}
        grouped
        onOpenThread={openWindow}
        renderInterrupt={renderInterrupt}
        empty={
          noPersonas ? (
            <div className="m-auto flex max-w-[360px] flex-col items-center gap-[11px] p-6 text-center">
              <span className="flex size-10 items-center justify-center rounded-md bg-primary-soft text-primary">
                <Icon name="chat" size={20} />
              </span>
              <div className="text-title font-semibold tracking-[-0.01em]">
                Orchestrator 現在只能自己做事
              </div>
              <div className="text-label leading-[1.7] text-muted-foreground">
                建立 Persona 之後，它就能把任務拆開派發，並在背景持續執行。
              </div>
              <Button variant="primary" size="md" onClick={newPersona}>
                建立第一個 Persona
              </Button>
            </div>
          ) : (
            <div className="m-auto text-caption text-faint">對 Orchestrator 下達第一個任務。</div>
          )
        }
      />
    );
  } else {
    content = (
      <PersonaOverview
        key={selectedId}
        data={data}
        agent={selected}
        now={now}
        onOpenWindow={(thread) => openWindow(selectedId, thread)}
        onOpenSettings={() => openPersonaSettings(selectedId)}
        onOpenGlobalSettings={() => openGlobalSettings('providers')}
      />
    );
  }

  const sidebarProps = {
    data,
    now,
    selected: selectedId,
    onSelect: select,
    onOpenWindow: openWindow,
    onNewPersona: newPersona,
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <WindowTitleBar title="Arlo Harness">
        <span className="font-mono text-caption text-faint">local · 127.0.0.1</span>
        <Tooltip content="Global settings" side="bottom">
          <button
            type="button"
            aria-label="Global settings"
            onClick={() => openGlobalSettings()}
            className="flex text-faint transition-colors duration-150 hover:text-foreground"
          >
            <Icon name="settings" size={14} />
          </button>
        </Tooltip>
      </WindowTitleBar>

      <div className="relative flex min-h-0 flex-1">
        {fullSidebar ? (
          <AgentSidebar
            {...sidebarProps}
            filter={filter}
            query={query}
            onFilter={setFilter}
            onQuery={setQuery}
            onOpenSettings={openPersonaSettings}
          />
        ) : (
          <AgentRail {...sidebarProps} />
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-border px-3.5">
            <div className="flex min-w-0 items-center gap-[7px]">
              <AgentAvatar agent={selected} size={22} />
              <span className="truncate text-body-sm font-semibold">{selected.name}</span>
              {!orchestratorSelected ? (
                <button
                  type="button"
                  onClick={() => select(ORCHESTRATOR_ID)}
                  className="shrink-0 rounded-full border border-border-strong px-2 py-[2px] text-tiny text-faint transition-colors duration-150 hover:border-primary-glow hover:text-primary"
                >
                  ← Orchestrator
                </button>
              ) : null}
            </div>
            <span className="h-[18px] w-px shrink-0 bg-border" />
            <Segmented
              aria-label="Main panel"
              value={panel}
              size={width < 640 ? 'sm' : 'md'}
              onValueChange={(next) =>
                void navigate({ search: (prev) => ({ ...prev, panel: next }), replace: true })
              }
              options={[
                { value: 'chat', label: 'Chat' },
                { value: 'tree', label: width < 640 ? 'Tree' : 'Task tree' },
              ]}
            />
            <span className="flex-1" />
            {width >= 760 ? (
              <span className="flex shrink-0 items-center gap-[5px] text-caption text-muted-foreground">
                <StatusDot
                  tone={provider && provider.status !== 'connected' ? 'danger' : 'accent'}
                  pulse={selected.activity === 'working'}
                />
                {modelLabel(selected)}
              </span>
            ) : null}
            {!docked ? (
              <button
                type="button"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((open) => !open)}
                className={cn(
                  'flex shrink-0 items-center gap-[5px] rounded-full px-[9px] py-1 text-tiny font-semibold',
                  pendingCount > 0
                    ? 'bg-warning text-white'
                    : 'border border-border-strong text-muted-foreground',
                )}
              >
                {pendingCount > 0 ? `${pendingCount} · needs you` : 'Action center'}
              </button>
            ) : null}
          </div>

          {content}

          <Composer
            key={`${selectedId}:${search.draft ?? ''}`}
            placeholder={`指派新任務給 ${selected.name}…`}
            initialText={search.draft ?? ''}
            variant={width < 640 ? 'compact' : 'full'}
            realtimeVoice={provider?.capabilities.realtimeVoice ?? false}
            onSend={(text, mode) => {
              dispatch({ type: 'message/send', agentId: selectedId, threadId, text, mode });
              if (search.draft)
                void navigate({ search: (prev) => ({ ...prev, draft: undefined }), replace: true });
            }}
          />
        </main>

        {docked ? (
          <ActionCenter data={data} now={now} onOpenThread={openWindow} />
        ) : drawerOpen ? (
          <>
            <button
              type="button"
              aria-label="Close action center"
              className="absolute inset-0 z-20 bg-scrim/40"
              onClick={() => setDrawerOpen(false)}
            />
            <ActionCenter
              data={data}
              now={now}
              onOpenThread={openWindow}
              onClose={() => setDrawerOpen(false)}
              className="absolute top-0 right-0 bottom-0 z-30 animate-reveal shadow-xl"
            />
          </>
        ) : null}

        <ToastStack />
      </div>

      <Outlet />
    </div>
  );
}
