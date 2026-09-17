import type { AgentId } from '@arlo/shared';
import { getRouteApi, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { Icon } from '../../components/icon.js';
import { StatusDot } from '../../components/status-dot.js';
import { TONE_TEXT } from '../../components/tone.js';
import { Button } from '../../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { WindowTitleBar } from '../../components/window-title-bar.js';
import { showMainWindow, showPersonaWindow } from '../../lib/bridge.js';
import { formatClock, formatElapsed } from '../../lib/format.js';
import { useNow, useWindowWidth } from '../../lib/hooks.js';
import { cn } from '../../lib/utils.js';
import type { Agent, PlatformState, Thread } from '../../state/model.js';
import {
  agentIdOf,
  agentStatusLine,
  modelLabel,
  ORCHESTRATOR_ID,
  personaIdOf,
  providerById,
  threadsFor,
  toneOfAgent,
} from '../../state/selectors.js';
import { useData, useDispatch } from '../../state/store.js';
import { Composer } from '../chat/Composer.js';
import { ThreadView } from '../chat/ThreadView.js';
import { InterruptCard } from '../interrupts/InterruptCard.js';
import { ProviderErrorCard, RestartCard } from '../main-window/PersonaOverview.js';
import { BrowserPane, BrowserStrip } from './BrowserPane.js';
import { ExecutionLog } from './ExecutionLog.js';
import { ThreadList } from './ThreadList.js';

const route = getRouteApi('/persona/$personaId');

const THREAD_LIST_MIN = 860;
const DOCKED_BROWSER_MIN = 1024;

function statusText(data: PlatformState, agent: Agent, now: number) {
  if (agent.activity === 'working' && agent.activeSince && !agent.paused && !agent.restart) {
    return `working · ${formatElapsed(now - agent.activeSince)}`;
  }
  return agentStatusLine(data, agent, now);
}

function OriginBanner({ data, thread, now }: { data: PlatformState; thread: Thread; now: number }) {
  const task = thread.taskId ? data.tasks[thread.taskId] : undefined;
  if (thread.source === 'user' || !task) return null;
  const when = formatClock(task.createdAt, now);
  return (
    <div className="flex items-center gap-[7px] self-center rounded-full bg-muted px-[11px] py-1 text-tiny text-faint">
      {thread.source === 'orchestrator' ? (
        <>
          由 Orchestrator 於 {when} 派發 ·
          <button
            type="button"
            className="font-semibold text-primary hover:opacity-70"
            onClick={() => showMainWindow(task.parentId)}
          >
            回到來源任務 ↑
          </button>
        </>
      ) : thread.source === 'schedule' ? (
        `排程觸發 · ${when}`
      ) : thread.source === 'event' ? (
        `事件觸發 · ${when}`
      ) : (
        `Webhook 觸發 · ${when}`
      )}
    </div>
  );
}

export function PersonaWindow() {
  const { personaId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const data = useData();
  const dispatch = useDispatch();
  const now = useNow();
  const width = useWindowWidth();
  const [threadQuery, setThreadQuery] = useState('');
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [browserCollapsed, setBrowserCollapsed] = useState(false);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState(470);
  // Narrow windows start with the log folded to a bar (design "Narrow").
  const [logOpen, setLogOpen] = useState(() => window.innerWidth >= THREAD_LIST_MIN);

  const agentId = agentIdOf(personaId);
  const agent = data.agents[agentId];
  const narrow = width < THREAD_LIST_MIN;

  useEffect(() => {
    document.title = agent ? `${agent.name} — Persona` : 'Persona';
  }, [agent]);

  // Shrinking into the narrow layout folds the log too; widening leaves the user's choice alone.
  useEffect(() => {
    if (narrow) setLogOpen(false);
  }, [narrow]);

  if (!agent) {
    return (
      <div className="flex h-full flex-col">
        <WindowTitleBar title="Persona" />
        <div className="m-auto flex flex-col items-center gap-2 text-center">
          <div className="text-body font-semibold">這個 Persona 已不存在</div>
          <div className="text-caption text-muted-foreground">
            它可能已被刪除。關閉這個視窗即可。
          </div>
        </div>
      </div>
    );
  }

  const threads = threadsFor(data, agentId, threadQuery);
  const allThreads = threadsFor(data, agentId);
  const currentTask = agent.currentTaskId ? data.tasks[agent.currentTaskId] : undefined;
  const threadId =
    (search.thread && data.threads[search.thread]?.agentId === agentId
      ? search.thread
      : undefined) ??
    currentTask?.threadId ??
    allThreads[0]?.id;
  const thread = threadId ? data.threads[threadId] : undefined;
  const tone = toneOfAgent(agent);
  const browserDocked = width >= DOCKED_BROWSER_MIN && !browserCollapsed;
  const browserOverlay = browserFullscreen || (!browserDocked && browserExpanded);
  const provider = providerById(data, agent.model.providerId);

  const selectThread = (id: string) => {
    setThreadsOpen(false);
    void navigate({ search: { thread: id }, replace: true });
  };
  const openSettings = () =>
    void navigate({
      to: '/persona/$personaId/settings',
      params: { personaId },
      search: (prev) => ({ ...prev, tab: undefined }),
    });
  const cancelTask = () => currentTask && dispatch({ type: 'task/cancel', taskId: currentTask.id });
  const togglePause = () => dispatch({ type: 'agent/setPaused', agentId, paused: !agent.paused });
  const expandBrowser = () => {
    if (width >= DOCKED_BROWSER_MIN) setBrowserCollapsed(false);
    else setBrowserExpanded(true);
  };
  const openThread = (target: AgentId, targetThread: string) => {
    if (target === agentId) selectThread(targetThread);
    else if (target === ORCHESTRATOR_ID) showMainWindow();
    else showPersonaWindow(personaIdOf(target), targetThread);
  };

  const renderInterrupt = (notificationId: string) => {
    const notification = data.notifications.find((n) => n.id === notificationId);
    if (!notification) return null;
    const needsBrowser =
      notification.interrupt?.payload.type === 'auth_required' ||
      notification.interrupt?.payload.type === 'captcha';
    return (
      <InterruptCard
        data={data}
        notification={notification}
        layout="inline"
        now={now}
        onOpenPersona={needsBrowser && !browserDocked ? expandBrowser : undefined}
      />
    );
  };

  const pane = (
    <BrowserPane
      agent={agent}
      width={browserOverlay ? undefined : browserWidth}
      onResize={setBrowserWidth}
      fullscreen={browserOverlay}
      onToggleFullscreen={() => {
        if (browserFullscreen || browserExpanded) {
          setBrowserFullscreen(false);
          setBrowserExpanded(false);
        } else {
          setBrowserFullscreen(true);
        }
      }}
      onCollapse={() => {
        setBrowserFullscreen(false);
        setBrowserExpanded(false);
        setBrowserCollapsed(true);
      }}
      className={browserOverlay ? 'absolute inset-0 z-30 border-l-0' : undefined}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <WindowTitleBar title={`${agent.name} — Persona`}>
        {width >= 700 ? (
          <span className="text-tiny text-faint">關閉視窗只會隱藏，任務在背景繼續</span>
        ) : null}
      </WindowTitleBar>

      {narrow ? (
        <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border px-[11px]">
          <button
            type="button"
            aria-label="Threads"
            aria-expanded={threadsOpen}
            onClick={() => setThreadsOpen((open) => !open)}
            className="text-title text-faint hover:text-foreground"
          >
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-label font-semibold">{thread?.title ?? agent.name}</div>
            <div className={cn('text-micro', TONE_TEXT[tone])}>{statusText(data, agent, now)}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              className="flex text-faint hover:text-foreground"
            >
              <Icon name="more" size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={togglePause}>
                {agent.paused ? 'Resume' : 'Pause'}
              </DropdownMenuItem>
              <DropdownMenuItem destructive disabled={!currentTask} onSelect={cancelTask}>
                Cancel task
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openSettings}>Settings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <div className="flex h-[42px] shrink-0 items-center gap-[9px] border-b border-border px-[13px]">
          <AgentAvatar agent={agent} size={24} />
          <span className="truncate text-body font-semibold">{agent.name}</span>
          <span
            className={cn('flex shrink-0 items-center gap-[5px] text-caption', TONE_TEXT[tone])}
          >
            <StatusDot tone={tone} pulse={agent.activity === 'working' && !agent.paused} />
            {statusText(data, agent, now)}
          </span>
          <span className="shrink-0 rounded-full border border-border-strong px-[9px] py-[3px] font-mono text-caption text-faint">
            {modelLabel(agent)}
          </span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={togglePause}>
            {agent.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="danger" size="sm" disabled={!currentTask} onClick={cancelTask}>
            Cancel task
          </Button>
          <Button variant="outline" size="sm" onClick={openSettings}>
            <Icon name="settings" size={13} />
            Settings
          </Button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {!narrow ? (
          <ThreadList
            data={data}
            threads={threads}
            selectedId={threadId}
            query={threadQuery}
            now={now}
            onQuery={setThreadQuery}
            onSelect={selectThread}
          />
        ) : threadsOpen ? (
          <>
            <button
              type="button"
              aria-label="Close threads"
              className="absolute inset-0 z-20 bg-scrim/40"
              onClick={() => setThreadsOpen(false)}
            />
            <ThreadList
              data={data}
              threads={threads}
              selectedId={threadId}
              query={threadQuery}
              now={now}
              onQuery={setThreadQuery}
              onSelect={selectThread}
              className="absolute top-0 bottom-0 left-0 z-30 animate-reveal shadow-xl"
            />
          </>
        ) : null}

        <section className="flex min-w-0 flex-1 flex-col">
          {thread ? (
            <ThreadView
              key={thread.id}
              data={data}
              threadId={thread.id}
              now={now}
              compact
              onOpenThread={openThread}
              renderInterrupt={renderInterrupt}
              header={
                <>
                  <OriginBanner data={data} thread={thread} now={now} />
                  {provider && provider.status !== 'connected' && provider.status !== 'untested' ? (
                    <ProviderErrorCard
                      data={data}
                      agent={agent}
                      onOpenSettings={() => showMainWindow()}
                    />
                  ) : null}
                  {agent.restart && thread.taskId === agent.currentTaskId ? (
                    <RestartCard agent={agent} now={now} onViewLog={() => setLogOpen(true)} />
                  ) : null}
                </>
              }
              empty={
                <div className="m-auto max-w-[280px] text-center text-caption leading-[1.7] text-faint">
                  在這裡直接跟 {agent.name} 對話。它正在忙時，訊息會在下一輪處理。
                </div>
              }
            />
          ) : (
            <div className="m-auto text-caption text-faint">沒有 Thread</div>
          )}
          {thread ? (
            <Composer
              key={thread.id}
              variant="compact"
              placeholder={thread.source === 'user' ? `跟 ${agent.name} 對話…` : '介入這個 Thread…'}
              realtimeVoice={provider?.capabilities.realtimeVoice ?? false}
              onSend={(text, mode) =>
                dispatch({ type: 'message/send', agentId, threadId: thread.id, text, mode })
              }
            />
          ) : null}
          {!browserDocked ? <BrowserStrip agent={agent} onExpand={expandBrowser} /> : null}
          {thread ? (
            <ExecutionLog
              key={`log:${thread.id}`}
              data={data}
              threadId={thread.id}
              open={logOpen}
              onToggle={() => setLogOpen((open) => !open)}
            />
          ) : null}
        </section>

        {browserDocked || browserOverlay ? pane : null}
      </div>

      <Outlet />
    </div>
  );
}
