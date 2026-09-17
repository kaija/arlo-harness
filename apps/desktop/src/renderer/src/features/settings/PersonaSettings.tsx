import type { AgentId } from '@arlo/shared';
import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Field } from '../../components/ui/field.js';
import {
  CommitInput,
  CommitTextarea,
  OptionTile,
  RiskChips,
  SectionHeader,
  SettingsCard,
  Stepper,
} from '../../components/ui/form-controls.js';
import { Input, NativeSelect } from '../../components/ui/input.js';
import { Switch } from '../../components/ui/switch.js';
import { cn } from '../../lib/utils.js';
import { toolSourceLabel, type PersonaPatch } from '../../state/commands.js';
import type { Agent, McpServer, PersonaConfig, PlatformState } from '../../state/model.js';
import { agentIdOf, displayModel, providerById } from '../../state/selectors.js';
import { useData, useDispatch } from '../../state/store.js';
import { SettingsShell } from './SettingsShell.js';

const TABS = [
  { id: 'basic', label: 'Basic' },
  { id: 'model', label: 'Model' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'tools', label: 'Tools & risk' },
  { id: 'browser', label: 'Browser' },
  { id: 'execution', label: 'Execution' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'danger', label: 'Danger zone' },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface TabProps {
  data: PlatformState;
  agent: Agent;
  config: PersonaConfig;
  update: (patch: PersonaPatch) => void;
}

export function PersonaSettingsDialog() {
  const { personaId } = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const location = useLocation();
  const navigate = useNavigate();
  const data = useData();
  const dispatch = useDispatch();
  const initialTab = TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : 'basic';
  const [tab, setTab] = useState<TabId>(initialTab);

  const inMain = location.pathname.startsWith('/main');
  const close = () => {
    if (inMain || !personaId)
      void navigate({ to: '/main', search: (prev) => ({ ...prev, tab: undefined }) });
    else
      void navigate({
        to: '/persona/$personaId',
        params: { personaId },
        search: (prev) => ({ thread: prev.thread }),
      });
  };

  const agentId: AgentId | undefined = personaId ? agentIdOf(personaId) : undefined;
  const agent = agentId ? data.agents[agentId] : undefined;
  if (!agent?.config || !agentId) {
    return (
      <SettingsShell title="Persona settings" description="Persona not found" onClose={close}>
        <div className="m-auto text-caption text-faint">這個 Persona 已不存在。</div>
      </SettingsShell>
    );
  }
  const update = (patch: PersonaPatch) => dispatch({ type: 'persona/update', agentId, patch });
  const props: TabProps = { data, agent, config: agent.config, update };

  return (
    <SettingsShell
      title={`${agent.name} — Settings`}
      description={`Settings for ${agent.name}`}
      onClose={close}
    >
      <div
        role="tablist"
        aria-label="Persona settings"
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-5 pt-3.5 pb-3"
      >
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-full border px-3.5 py-[5px] text-label font-semibold transition-colors duration-150',
              tab === t.id
                ? t.id === 'danger'
                  ? 'border-danger bg-danger text-white'
                  : 'border-primary bg-primary text-white'
                : t.id === 'danger'
                  ? 'border-danger bg-background text-danger'
                  : 'border-border-strong bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-5 py-[18px]">
        {tab === 'basic' ? <BasicTab {...props} /> : null}
        {tab === 'model' ? <ModelTab {...props} /> : null}
        {tab === 'skills' ? <SkillsTab {...props} /> : null}
        {tab === 'mcp' ? <McpTab {...props} /> : null}
        {tab === 'tools' ? <ToolsTab {...props} /> : null}
        {tab === 'browser' ? <BrowserTab {...props} /> : null}
        {tab === 'execution' ? <ExecutionTab {...props} /> : null}
        {tab === 'triggers' ? <TriggersTab {...props} /> : null}
        {tab === 'danger' ? (
          <DangerTab {...props} onDeleted={() => void navigate({ to: '/main', search: {} })} />
        ) : null}
      </div>
    </SettingsShell>
  );
}

function ConcurrencyControls({ config, update }: Pick<TabProps, 'config' | 'update'>) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex-1 text-caption text-muted-foreground">最大並行數</span>
        <Stepper
          label="max concurrency"
          value={config.maxConcurrency}
          min={1}
          max={16}
          onChange={(maxConcurrency) => update({ maxConcurrency })}
        />
      </div>
      {config.maxConcurrency > 1 ? (
        <div
          role="alert"
          className="rounded-[9px] border border-warning bg-warning-soft px-2.5 py-[9px] text-tiny leading-[1.55] font-semibold text-warning"
        >
          多個任務會共用同一個瀏覽器登入狀態，可能互相干擾。
        </div>
      ) : null}
      <div className="flex items-center gap-2.5">
        <span className="flex-1 text-caption text-muted-foreground">同步任務逾時</span>
        <Stepper
          label="delegation timeout"
          value={config.delegationTimeoutMinutes}
          min={1}
          max={1440}
          unit="m"
          onChange={(delegationTimeoutMinutes) => update({ delegationTimeoutMinutes })}
        />
      </div>
    </>
  );
}

function BasicTab({ agent, config, update }: TabProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-3.5">
        <Field label="Name">
          <CommitInput
            value={agent.name}
            onCommit={(name) => name.trim() && update({ name: name.trim() })}
          />
        </Field>
        <Field
          label="Description"
          hint="Orchestrator 依這段描述決定要不要把任務派給它 — 把專長、資料來源與不擅長的事寫清楚。"
        >
          <CommitTextarea
            value={agent.description}
            onCommit={(description) => update({ description })}
          />
        </Field>
        <Field label="Persona system prompt">
          <CommitTextarea
            value={config.systemPrompt}
            onCommit={(systemPrompt) => update({ systemPrompt })}
            className="min-h-[230px] font-mono text-label"
          />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <SettingsCard title="Avatar / 代號">
          <div className="flex items-center gap-2.5">
            <AgentAvatar agent={agent} size={44} />
            <Field
              label={<span className="text-tiny text-muted-foreground">代號（1–2 字）</span>}
              className="flex-1"
            >
              <CommitInput
                value={agent.initials}
                maxLength={2}
                onCommit={(initials) =>
                  initials.trim() && update({ initials: initials.trim().toUpperCase() })
                }
              />
            </Field>
          </div>
        </SettingsCard>
        <SettingsCard title="Working directory">
          <div className="font-mono text-caption leading-[1.6] break-all text-muted-foreground">
            {config.workdir}
          </div>
          <Button
            variant="soft"
            size="sm"
            className="self-start"
            disabled
            title="開啟資料夾需要 main process 支援"
          >
            Open folder
          </Button>
        </SettingsCard>
        <SettingsCard title="Execution">
          <ConcurrencyControls config={config} update={update} />
        </SettingsCard>
      </div>
    </div>
  );
}

function ModelTab({ data, agent, update }: TabProps) {
  const defaults = providerById(data, data.defaults.providerId);
  const provider = providerById(data, agent.model.providerId);
  return (
    <div className="flex max-w-[640px] flex-col gap-3.5">
      <SectionHeader title="Model" meta="下一次 Run 開始時套用" />
      <div role="radiogroup" aria-label="Model binding" className="grid gap-2 sm:grid-cols-2">
        <OptionTile
          selected={agent.model.inherited}
          onSelect={() => update({ inheritModel: true })}
          title="使用全域預設"
          description={`${displayModel(data.defaults.model)} · ${defaults?.name ?? data.defaults.providerId}`}
        />
        <OptionTile
          selected={!agent.model.inherited}
          onSelect={() => update({ inheritModel: false })}
          title="指定 Provider 與模型"
          description="覆寫全域設定，只影響這個 Persona。"
        />
      </div>
      {!agent.model.inherited ? (
        <SettingsCard>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <NativeSelect
                value={agent.model.providerId}
                onChange={(event) => {
                  const next = providerById(data, event.target.value);
                  update({
                    providerId: event.target.value,
                    model: next?.models[0] ?? agent.model.model,
                  });
                }}
              >
                {data.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Model">
              <NativeSelect
                value={agent.model.model}
                onChange={(event) => update({ model: event.target.value })}
              >
                {(provider?.models ?? [agent.model.model]).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label={`Temperature · ${agent.model.temperature ?? 1}`}>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={agent.model.temperature ?? 1}
              onChange={(event) => update({ temperature: Number(event.target.value) })}
              className="accent-primary"
            />
          </Field>
          {provider && provider.status !== 'connected' ? (
            <div className="rounded-sm bg-danger-soft px-2.5 py-2 font-mono text-caption text-danger">
              {provider.name} · {provider.lastError?.message ?? provider.status}
            </div>
          ) : null}
        </SettingsCard>
      ) : null}
    </div>
  );
}

function SkillsTab({ agent, config }: TabProps) {
  const dispatch = useDispatch();
  const [reviewing, setReviewing] = useState<string | undefined>(undefined);
  const review = config.skills.find((s) => s.name === reviewing);
  return (
    <div className="flex flex-col gap-[11px]">
      <SectionHeader title="Skills" meta={`從工作目錄 skills/ 載入 · ${config.skills.length} 個`}>
        <Button variant="soft" size="sm" disabled title="開啟資料夾需要 main process 支援">
          Open folder
        </Button>
      </SectionHeader>
      {config.skills.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-strong p-6 text-center text-caption text-faint">
          工作目錄的 skills/ 裡還沒有 skill。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {config.skills.map((skill) => {
            const needsTrust = skill.hasCode && !skill.trusted && skill.source !== 'built-in';
            return (
              <div
                key={skill.name}
                className={cn(
                  'flex items-center gap-3 border-b border-border px-[13px] py-[11px] last:border-b-0',
                  needsTrust && 'bg-warning-soft',
                  !skill.enabled && !needsTrust && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-body-sm font-semibold">{skill.name}</div>
                  <div className="mt-0.5 text-caption text-muted-foreground">
                    {skill.description} · 來源 {skill.source}
                  </div>
                </div>
                {skill.hasCode ? (
                  <Badge tone="warning-outline" size="xs" className="text-micro">
                    contains code
                  </Badge>
                ) : (
                  <span className="text-micro text-faint">
                    {skill.enabled ? 'no code' : 'disabled'}
                  </span>
                )}
                {needsTrust ? (
                  <Button variant="warning" size="xs" onClick={() => setReviewing(skill.name)}>
                    Review &amp; trust
                  </Button>
                ) : (
                  <Switch
                    aria-label={`Enable ${skill.name}`}
                    checked={skill.enabled}
                    onCheckedChange={(enabled) =>
                      dispatch({
                        type: 'persona/setSkill',
                        agentId: agent.id,
                        skill: skill.name,
                        enabled,
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {review ? (
        <div
          role="dialog"
          aria-label="Trust skill"
          className="max-w-[520px] animate-reveal rounded-md border border-border-strong bg-secondary p-3.5"
        >
          <div className="text-body-sm font-semibold">一次性信任確認</div>
          <div className="mt-[7px] text-label leading-[1.65] text-muted-foreground">
            {review.name} 含可執行程式碼，第一次載入需要你確認。啟用後它會以此 Persona
            的權限在本機執行。
          </div>
          <div className="mt-[11px] flex gap-1.5">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                dispatch({ type: 'persona/trustSkill', agentId: agent.id, skill: review.name });
                setReviewing(undefined);
              }}
            >
              信任並啟用
            </Button>
            <Button variant="outline" size="md" disabled title="檢視程式碼需要 main process 支援">
              檢視程式碼
            </Button>
            <Button variant="ghost" size="md" onClick={() => setReviewing(undefined)}>
              稍後
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MCP_STATUS = {
  connected: { tone: 'success', label: 'connected' },
  connecting: { tone: 'neutral', label: 'connecting' },
  error: { tone: 'danger', label: 'error' },
} as const;

function McpTab({ data, agent, config }: TabProps) {
  const dispatch = useDispatch();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    transport: McpServer['transport'];
    target: string;
    template: string;
  }>({
    name: '',
    transport: 'stdio',
    target: '',
    template: '',
  });
  const unusedTemplates = data.mcpTemplates.filter(
    (t) => !config.mcpServers.some((s) => s.name === t.name),
  );
  const add = () => {
    const template = data.mcpTemplates.find((t) => t.name === draft.template);
    const server: McpServer | undefined = template
      ? { ...template, from: 'template' }
      : draft.name.trim() && draft.target.trim()
        ? {
            name: draft.name.trim(),
            transport: draft.transport,
            target: draft.target.trim(),
            from: 'custom',
            status: 'connecting',
            toolCount: 0,
          }
        : undefined;
    if (!server) return;
    dispatch({ type: 'persona/addMcpServer', agentId: agent.id, server });
    setAdding(false);
    setDraft({ name: '', transport: 'stdio', target: '', template: '' });
  };
  return (
    <div className="flex flex-col gap-[11px]">
      <SectionHeader title="MCP servers" meta="每個 Persona 各自連線，互不共用">
        <Button variant="primary" size="sm" onClick={() => setAdding((open) => !open)}>
          {adding ? 'Cancel' : 'Add server'}
        </Button>
      </SectionHeader>
      {adding ? (
        <SettingsCard className="animate-reveal">
          {unusedTemplates.length > 0 ? (
            <Field label="From template">
              <NativeSelect
                value={draft.template}
                onChange={(event) => setDraft({ ...draft, template: event.target.value })}
              >
                <option value="">自訂伺服器</option>
                {unusedTemplates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} · {t.transport}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {!draft.template ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Field label="Name">
                <Input
                  value={draft.name}
                  placeholder="docs"
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value.replace(/\./g, '') })
                  }
                />
              </Field>
              <Field label="Transport">
                <NativeSelect
                  value={draft.transport}
                  onChange={(event) =>
                    setDraft({ ...draft, transport: event.target.value as McpServer['transport'] })
                  }
                >
                  <option value="stdio">stdio</option>
                  <option value="streamable_http">HTTP</option>
                </NativeSelect>
              </Field>
              <Field
                label={draft.transport === 'stdio' ? 'Command' : 'URL'}
                className="sm:col-span-2"
              >
                <Input
                  value={draft.target}
                  className="font-mono"
                  placeholder={
                    draft.transport === 'stdio'
                      ? 'node ~/mcp/server.js'
                      : 'http://127.0.0.1:8931/mcp'
                  }
                  onChange={(event) => setDraft({ ...draft, target: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
          <Button variant="primary" size="md" className="self-start" onClick={add}>
            Add
          </Button>
        </SettingsCard>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border">
        {config.mcpServers.length === 0 ? (
          <div className="p-6 text-center text-caption text-faint">還沒有 MCP 伺服器。</div>
        ) : null}
        {config.mcpServers.map((server) => (
          <div
            key={server.name}
            className="flex flex-wrap items-center gap-3 border-b border-border px-[13px] py-[11px] last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-label font-semibold">{server.name}</span>
                <Badge tone={server.from === 'template' ? 'primary' : 'neutral'} size="xs">
                  {server.from}
                </Badge>
              </div>
              <div className="mt-0.5 truncate font-mono text-tiny text-muted-foreground">
                {server.transport} · {server.target}
              </div>
              {server.error ? (
                <div className="mt-0.5 font-mono text-tiny text-danger">{server.error}</div>
              ) : null}
            </div>
            <span className="text-caption text-faint">{server.toolCount} tools</span>
            <Badge tone={MCP_STATUS[server.status].tone} size="md">
              {MCP_STATUS[server.status].label}
            </Badge>
            <Button
              variant="reject"
              size="xs"
              onClick={() =>
                dispatch({ type: 'persona/removeMcpServer', agentId: agent.id, name: server.name })
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolsTab({ agent, config }: TabProps) {
  const dispatch = useDispatch();
  const [grouped, setGrouped] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const sources = [...new Set(config.tools.map((t) => toolSourceLabel(t.source)))];
  const [bulkSource, setBulkSource] = useState(sources[0] ?? 'built-in');
  const tools = grouped
    ? [...config.tools].sort((a, b) =>
        toolSourceLabel(a.source).localeCompare(toolSourceLabel(b.source)),
      )
    : config.tools;
  return (
    <div className="flex flex-col gap-[11px]">
      <SectionHeader title="Tools & risk levels" meta="未設定者預設 medium">
        <label className="flex items-center gap-1.5 text-tiny text-muted-foreground">
          <Switch aria-label="Group by source" checked={grouped} onCheckedChange={setGrouped} />
          group by source
        </label>
        <Button variant="soft" size="sm" onClick={() => setBulkOpen((open) => !open)}>
          Bulk set…
        </Button>
      </SectionHeader>
      <div className="flex flex-wrap gap-3.5 text-tiny text-muted-foreground">
        <span>
          <span className="font-semibold text-success">low</span> 自動執行
        </span>
        <span>
          <span className="font-semibold text-warning">medium</span> Orchestrator 可代批准
        </span>
        <span>
          <span className="font-semibold text-danger">high</span> 必須由使用者批准
        </span>
      </div>
      {bulkOpen ? (
        <div className="flex animate-reveal flex-wrap items-center gap-2.5 rounded-md border border-border-strong bg-secondary px-3 py-2.5">
          <span className="text-caption text-muted-foreground">把來源</span>
          <div className="w-[180px]">
            <NativeSelect
              value={bulkSource}
              onChange={(event) => setBulkSource(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </NativeSelect>
          </div>
          <span className="text-caption text-muted-foreground">的所有工具設為</span>
          <RiskChips
            label="Bulk risk level"
            value={undefined}
            onChange={(risk) => {
              dispatch({
                type: 'persona/setSourceRisk',
                agentId: agent.id,
                sourceLabel: bulkSource,
                risk,
              });
              setBulkOpen(false);
            }}
          />
        </div>
      ) : null}
      <div
        className="overflow-hidden rounded-md border border-border"
        role="table"
        aria-label="Tools"
      >
        <div
          role="row"
          className="flex items-center gap-2.5 border-b border-border bg-secondary px-[13px] py-2 text-tiny text-faint"
        >
          <span role="columnheader" className="flex-1">
            Tool
          </span>
          <span role="columnheader" className="w-[110px]">
            Source
          </span>
          <span role="columnheader" className="w-[190px]">
            Risk
          </span>
        </div>
        {tools.map((tool) => (
          <div
            role="row"
            key={tool.key}
            className={cn(
              'flex items-center gap-2.5 border-b border-border px-[13px] py-2.5 last:border-b-0',
              tool.risk === 'high' && 'bg-danger-soft',
            )}
          >
            <div role="cell" className="min-w-0 flex-1">
              <span className="font-mono text-label font-semibold">{tool.key}</span>
              <div className="mt-0.5 text-tiny text-faint">{tool.description}</div>
            </div>
            <span role="cell" className="w-[110px] truncate text-caption text-muted-foreground">
              {toolSourceLabel(tool.source)}
            </span>
            <div role="cell" className="w-[190px]">
              <RiskChips
                label={`Risk level for ${tool.key}`}
                value={tool.risk}
                onChange={(risk) =>
                  dispatch({
                    type: 'persona/setToolRisk',
                    agentId: agent.id,
                    toolKey: tool.key,
                    risk,
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrowserTab({ agent, config, update }: TabProps) {
  const dispatch = useDispatch();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex max-w-[640px] flex-col gap-3.5">
      <SectionHeader title="Browser" />
      <SettingsCard>
        <label className="flex items-center gap-3">
          <Switch
            checked={config.browserEnabled}
            onCheckedChange={(browserEnabled) => update({ browserEnabled })}
          />
          <span className="text-body-sm font-semibold">啟用內嵌瀏覽器</span>
        </label>
        <div className="text-caption leading-[1.6] text-muted-foreground">
          瀏覽資料存在這個 Persona 專屬的 session，不與其他 Persona 共用。
        </div>
      </SettingsCard>
      <SettingsCard title="目前登入的網站">
        {config.signedInSites.length === 0 ? (
          <div className="text-caption text-faint">沒有保存的登入狀態。</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {config.signedInSites.map((site) => (
              <Badge key={site} tone="neutral" size="lg" className="font-mono font-medium">
                {site}
              </Badge>
            ))}
          </div>
        )}
      </SettingsCard>
      <SettingsCard title="清除瀏覽資料">
        <div className="text-caption leading-[1.6] text-muted-foreground">
          刪除 cookie 與網站儲存資料；{agent.name} 之後需要重新登入。
        </div>
        <div className="flex gap-1.5">
          <Button
            variant={confirming ? 'primary' : 'danger'}
            size="md"
            className={confirming ? 'bg-danger hover:bg-danger' : undefined}
            onClick={() => {
              if (confirming) dispatch({ type: 'persona/clearBrowserData', agentId: agent.id });
              setConfirming(!confirming);
            }}
          >
            {confirming ? '確認清除' : 'Clear browsing data'}
          </Button>
          {confirming ? (
            <Button variant="outline" size="md" onClick={() => setConfirming(false)}>
              取消
            </Button>
          ) : null}
        </div>
      </SettingsCard>
    </div>
  );
}

function ExecutionTab({ config, update }: TabProps) {
  return (
    <div className="flex max-w-[520px] flex-col gap-3.5">
      <SectionHeader title="Execution" />
      <SettingsCard>
        <ConcurrencyControls config={config} update={update} />
        <div className="text-caption leading-[1.6] text-muted-foreground">
          並行數決定同時可以跑幾個 Thread；超過的任務依先進先出排隊。同步委派超過逾時會回報
          Orchestrator。
        </div>
      </SettingsCard>
    </div>
  );
}

function TriggersTab({ agent, config }: TabProps) {
  const dispatch = useDispatch();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-[720px] flex-col gap-3.5">
      <SectionHeader title="Event triggers" meta="訂閱內部事件並以模板產生 prompt" />
      <div className="overflow-hidden rounded-md border border-border">
        {config.eventTriggers.length === 0 ? (
          <div className="p-5 text-center text-caption text-faint">沒有訂閱任何事件。</div>
        ) : null}
        {config.eventTriggers.map((trigger) => (
          <div
            key={trigger.event}
            className="border-b border-border px-[13px] py-2.5 last:border-b-0"
          >
            <div className="font-mono text-label font-semibold">{trigger.event}</div>
            <div className="mt-1 rounded-sm bg-secondary px-2.5 py-1.5 font-mono text-caption text-muted-foreground">
              {trigger.template}
            </div>
          </div>
        ))}
      </div>
      <SectionHeader title="Webhook" meta="只接受 127.0.0.1 的請求" />
      <SettingsCard>
        <Field label="URL">
          <div className="flex gap-1.5">
            <Input readOnly value={config.webhook.url} className="font-mono" />
            <Button
              variant="soft"
              size="md"
              onClick={() => {
                void navigator.clipboard?.writeText(config.webhook.url).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Field>
        <Field label="Bearer token" hint="Token 以加密方式存在本機，這裡只顯示末四碼。">
          <div className="flex gap-1.5">
            <Input
              readOnly
              value={
                config.webhook.tokenLast4 ? `··········${config.webhook.tokenLast4}` : '尚未產生'
              }
              className="font-mono"
            />
            <Button
              variant="outline"
              size="md"
              onClick={() =>
                dispatch({
                  type: 'persona/rotateWebhookToken',
                  agentId: agent.id,
                  tokenLast4: crypto
                    .getRandomValues(new Uint16Array(1))[0]!
                    .toString(16)
                    .padStart(4, '0'),
                })
              }
            >
              Regenerate
            </Button>
          </div>
        </Field>
      </SettingsCard>
    </div>
  );
}

function DangerTab({ agent, config, onDeleted }: TabProps & { onDeleted: () => void }) {
  const dispatch = useDispatch();
  const [confirmName, setConfirmName] = useState('');
  const [removeWorkdir, setRemoveWorkdir] = useState(false);
  const [removeBrowserData, setRemoveBrowserData] = useState(true);
  return (
    <div className="flex max-w-[600px] flex-col gap-3.5">
      <SettingsCard title="停用 Persona" className="border-border-strong">
        <div className="text-caption leading-[1.6] text-muted-foreground">
          停用後行程會先取消進行中的任務（最多等 10 秒）再關閉；Orchestrator 不會再派工給它。
        </div>
        <label className="flex items-center gap-3">
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) =>
              dispatch({ type: 'persona/setEnabled', agentId: agent.id, enabled })
            }
          />
          <span className="text-body-sm font-semibold">{config.enabled ? '啟用中' : '已停用'}</span>
        </label>
      </SettingsCard>
      <SettingsCard
        title={<span className="text-danger">刪除 Persona</span>}
        className="border-danger"
      >
        <div className="text-caption leading-[1.6] text-muted-foreground">
          刪除後無法復原。Thread 歷程會一併刪除。
        </div>
        <label className="flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            checked={removeWorkdir}
            onChange={(e) => setRemoveWorkdir(e.target.checked)}
            className="accent-danger"
          />
          一併刪除工作目錄 <span className="font-mono text-tiny text-faint">{config.workdir}</span>
        </label>
        <label className="flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            checked={removeBrowserData}
            onChange={(e) => setRemoveBrowserData(e.target.checked)}
            className="accent-danger"
          />
          一併刪除瀏覽資料
        </label>
        <Field label={`輸入「${agent.name}」確認`}>
          <Input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} />
        </Field>
        <Button
          variant="danger"
          size="md"
          className="self-start"
          disabled={confirmName !== agent.name}
          onClick={() => {
            dispatch({
              type: 'persona/delete',
              agentId: agent.id,
              removeWorkdir,
              removeBrowserData,
            });
            onDeleted();
          }}
        >
          Delete persona
        </Button>
      </SettingsCard>
    </div>
  );
}
