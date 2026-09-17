import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../../components/icon.js';
import { StatusDot } from '../../components/status-dot.js';
import { Button } from '../../components/ui/button.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import { cn } from '../../lib/utils.js';
import type { Agent } from '../../state/model.js';
import { useDispatch } from '../../state/store.js';

export const BROWSER_MIN_WIDTH = 320;
export const BROWSER_MAX_WIDTH = 760;

function activeTab(agent: Agent) {
  return agent.browser?.tabs.find((tab) => tab.id === agent.browser?.activeTabId);
}

export function BrowserEmpty({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 p-5 text-center">
      <span className="flex size-9 items-center justify-center rounded-tile bg-muted text-faint">
        <Icon name="globe" size={18} />
      </span>
      <div className="text-body-sm font-semibold">
        {enabled ? '尚無任務用到瀏覽器' : '這個 Persona 未啟用瀏覽器'}
      </div>
      <div className="max-w-[250px] text-caption leading-[1.7] text-muted-foreground">
        {enabled
          ? '第一個需要上網的任務會自動啟動瀏覽器，登入狀態會保留在這個 Persona。'
          : '在 Persona 設定的 Browser 分頁啟用後，任務才能使用瀏覽器工具。'}
      </div>
      {enabled ? (
        <Tooltip content="手動開啟瀏覽器 · 尚未提供" side="bottom">
          <span role="button" aria-disabled="true" tabIndex={0}>
            <Button variant="soft" size="sm" disabled>
              手動開啟
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * Placeholder for the Persona's WebContentsView (ADR-0006/0007), which main lays
 * over this rectangle. Nothing else may be drawn on top of it: native views
 * cover the DOM, so the focus highlight is injected into the page by the browser
 * tools and the driver bar sits below the viewport.
 */
function Viewport({ agent }: { agent: Agent }) {
  const browser = agent.browser!;
  const agentDriving = browser.driver === 'agent';
  return (
    <div data-browser-viewport className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <div className="absolute inset-0 flex flex-col gap-3 p-[18px]">
        <div className="flex items-center gap-2.5">
          <span className="size-[26px] rounded-[6px] bg-muted" />
          <span className="h-[9px] w-[120px] rounded-[3px] bg-muted" />
          <span className="flex-1" />
          <span className="h-[9px] w-[54px] rounded-[3px] bg-muted" />
        </div>
        <div className="h-4 w-[62%] rounded-[4px] bg-skeleton" />
        <div className="flex flex-col gap-1.5">
          <span className="h-[7px] rounded-[3px] bg-muted" />
          <span className="h-[7px] rounded-[3px] bg-muted" />
          <span className="h-[7px] w-[70%] rounded-[3px] bg-muted" />
        </div>
        <div className="relative mt-1 flex flex-col gap-2 rounded-tile border border-border p-3">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-20 rounded-[3px] bg-muted" />
            <span className="h-2 w-11 rounded-[3px] bg-muted" />
            <span className="h-2 w-[60px] rounded-[3px] bg-muted" />
          </div>
          {browser.focus && agentDriving ? (
            <div className="relative mt-5 self-start rounded-sm bg-primary-soft px-3 py-[7px] text-caption font-semibold text-primary outline-2 outline-offset-[3px] outline-primary outline-dashed">
              {browser.focus.label}
              <span className="absolute -top-6 -left-[3px] rounded-full bg-primary px-[7px] py-0.5 text-nano font-semibold whitespace-nowrap text-white">
                Agent focus · {browser.focus.action}
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5 opacity-55">
            <span className="h-2 w-24 rounded-[3px] bg-muted" />
            <span className="h-2 w-10 rounded-[3px] bg-muted" />
          </div>
        </div>
      </div>
      {agentDriving && agent.activity === 'working' && !agent.paused ? (
        <div className="absolute top-0 right-0 left-0 h-0.5 overflow-hidden bg-primary-soft">
          <span className="absolute top-0 bottom-0 w-[30%] animate-sweep bg-primary" />
        </div>
      ) : null}
    </div>
  );
}

function DriverBar({ agent }: { agent: Agent }) {
  const dispatch = useDispatch();
  const browser = agent.browser!;
  const setDriver = (driver: 'agent' | 'user') =>
    dispatch({ type: 'agent/setDriver', agentId: agent.id, driver });
  if (browser.driver === 'user') {
    return (
      <div className="flex items-center gap-[9px] rounded-full border border-warning bg-white/94 px-3 py-2 shadow-md">
        <StatusDot tone="warning" size={7} />
        <span className="shrink-0 text-caption font-semibold text-warning">
          使用者操作中，Agent 暫停
        </span>
        <span className="min-w-0 truncate text-tiny text-muted-foreground">
          完成後交還，Agent 會沿用這個登入狀態
        </span>
        <span className="flex-1" />
        <Button variant="primary" size="xs" onClick={() => setDriver('agent')}>
          交還給 Agent
        </Button>
      </div>
    );
  }
  const working = agent.activity === 'working' && !agent.paused;
  return (
    <div className="flex items-center gap-[9px] rounded-full border border-primary-glow bg-white/92 px-[11px] py-2 shadow-md">
      <StatusDot tone={working ? 'accent' : 'idle'} pulse={working} size={7} />
      <span className="shrink-0 text-caption font-semibold">
        {working ? 'Agent 正在操作中' : 'Agent 閒置'}
      </span>
      {browser.focus && working ? (
        <span className="min-w-0 truncate text-tiny text-muted-foreground">
          {browser.focus.action === 'click' ? '點擊' : browser.focus.action}「{browser.focus.label}
          」
        </span>
      ) : null}
      <span className="flex-1" />
      <Button variant="soft" size="xs" onClick={() => setDriver('user')}>
        Take over
      </Button>
    </div>
  );
}

interface BrowserPaneProps {
  agent: Agent;
  width?: number | undefined;
  onResize?: (width: number) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onCollapse: () => void;
  className?: string | undefined;
}

export function BrowserPane({
  agent,
  width,
  onResize,
  fullscreen,
  onToggleFullscreen,
  onCollapse,
  className,
}: BrowserPaneProps) {
  const dispatch = useDispatch();
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
  const browser = agent.browser;
  const tab = activeTab(agent);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onResize || width === undefined) return;
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !onResize) return;
    const next = drag.current.startWidth + (drag.current.startX - event.clientX);
    onResize(Math.max(BROWSER_MIN_WIDTH, Math.min(BROWSER_MAX_WIDTH, next)));
  };

  return (
    <aside
      aria-label="Browser"
      style={width !== undefined && !fullscreen ? { width } : undefined}
      className={cn(
        'relative flex shrink-0 flex-col border-l border-border bg-secondary',
        className,
      )}
    >
      {onResize && !fullscreen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize browser"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = undefined)}
          className="absolute top-0 bottom-0 -left-[3px] z-10 w-1.5 cursor-col-resize hover:bg-primary-glow"
        />
      ) : null}
      <div className="flex shrink-0 items-center gap-[5px] px-[9px] pt-[7px]">
        {browser?.tabs.map((t) => {
          const on = t.id === browser.activeTabId;
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => dispatch({ type: 'agent/selectTab', agentId: agent.id, tabId: t.id })}
              className={cn(
                '-mb-px flex max-w-[160px] items-center gap-1.5 rounded-t-sm px-2.5 py-1.5 text-caption',
                on
                  ? 'border border-border border-b-background bg-background'
                  : 'text-faint hover:text-foreground',
              )}
            >
              {on ? <span className="size-[5px] shrink-0 rounded-full bg-primary" /> : null}
              <span className="truncate">{t.title}</span>
            </button>
          );
        })}
        {!browser ? <span className="px-1 py-1.5 text-caption text-faint">Browser</span> : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="text-tiny text-faint hover:text-foreground"
        >
          {fullscreen ? '結束全螢幕' : '全螢幕'}
        </button>
        <span className="text-tiny text-faint">·</span>
        <button
          type="button"
          onClick={onCollapse}
          className="text-tiny text-faint hover:text-foreground"
        >
          摺疊
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-[7px] border-y border-border bg-background px-2.5 py-[7px]">
        <button
          type="button"
          aria-label="Back"
          disabled={!browser?.canGoBack}
          className="text-body text-faint disabled:text-border-strong"
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!browser?.canGoForward}
          className="text-body text-faint disabled:text-border-strong"
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reload"
          disabled={!browser}
          className="flex text-faint disabled:text-border-strong"
        >
          <Icon name="regenerate" size={13} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted px-[11px] py-[5px] font-mono text-caption text-muted-foreground">
          <Icon name="globe" size={12} />
          <span className="truncate">{tab?.url ?? 'about:blank'}</span>
        </div>
      </div>

      {browser ? (
        <>
          <Viewport agent={agent} />
          <div className="shrink-0 border-t border-border bg-background px-3 py-2">
            <DriverBar agent={agent} />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 bg-background">
          <BrowserEmpty enabled={agent.config?.browserEnabled ?? false} />
        </div>
      )}
    </aside>
  );
}

/** Folded browser: one line with the page and whether the Agent is driving. */
export function BrowserStrip({ agent, onExpand }: { agent: Agent; onExpand: () => void }) {
  const browser = agent.browser;
  const tab = activeTab(agent);
  const driving = browser?.driver === 'agent' && agent.activity === 'working' && !agent.paused;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex h-8 w-full shrink-0 items-center gap-2 border-t border-border bg-secondary px-3 text-left"
    >
      <span className="text-caption text-faint">▸</span>
      <span className="text-caption font-semibold">Browser</span>
      <span className="min-w-0 truncate font-mono text-tiny text-faint">
        {browser
          ? `${tab?.url.split('/')[0] ?? ''} · ${browser.tabs.length} 分頁 · ${browser.driver === 'user' ? '使用者操作中' : driving ? 'agent 操作中' : '摺疊中'}`
          : '尚未啟動'}
      </span>
      <span className="flex-1" />
      {driving ? <StatusDot tone="accent" pulse /> : null}
      <span className="text-tiny font-semibold text-primary">展開 ↔</span>
    </button>
  );
}
