import { useNavigate, useSearch } from '@tanstack/react-router';
import { useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Field } from '../../components/ui/field.js';
import {
  CommitTextarea,
  OptionTile,
  SectionHeader,
  SettingsCard,
} from '../../components/ui/form-controls.js';
import { Input, NativeSelect, Textarea } from '../../components/ui/input.js';
import { Switch } from '../../components/ui/switch.js';
import { formatClock, renderTemplate } from '../../lib/format.js';
import { useNow } from '../../lib/hooks.js';
import { useTheme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';
import { LOCALES, useLocaleSelection, useTranslation } from '../../i18n.js';
import type { PersonaPatch } from '../../state/commands.js';
import type { PlatformState, Provider, ProviderType, Severity } from '../../state/model.js';
import { testProviderConnection } from '../../state/provider-test.js';
import { displayModel, ORCHESTRATOR_ID, providerById } from '../../state/selectors.js';
import { useData, useDispatch } from '../../state/store.js';
import { SettingsShell } from './SettingsShell.js';

const SECTIONS = [
  { id: 'providers', labelKey: 'settings.providers' },
  { id: 'orchestrator', labelKey: 'settings.orchestrator' },
  { id: 'mcp', labelKey: 'settings.mcp' },
  { id: 'schedules', labelKey: 'settings.schedules' },
  { id: 'notifications', labelKey: 'settings.notifications' },
  { id: 'advanced', labelKey: 'settings.advanced' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export const PROVIDER_TYPE_LABEL: Readonly<Record<ProviderType, string>> = {
  openai: 'OpenAI',
  openai_compatible: 'OpenAI compatible',
  azure_openai: 'Azure OpenAI',
};

export function GlobalSettingsDialog() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const data = useData();
  const { t } = useTranslation();
  const initial = SECTIONS.some((s) => s.id === search.tab)
    ? (search.tab as SectionId)
    : 'providers';
  const [section, setSection] = useState<SectionId>(initial);
  const close = () =>
    void navigate({ to: '/main', search: (prev) => ({ ...prev, tab: undefined }) });

  return (
    <SettingsShell
      title={t('settings.title')}
      description={t('settings.description')}
      onClose={close}
    >
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('settings.sections')}
          className="flex w-[186px] shrink-0 flex-col gap-[3px] border-r border-border bg-secondary px-[9px] py-3"
        >
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              aria-current={section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'rounded-[9px] px-2.5 py-2 text-left text-body-sm transition-colors duration-150',
                section === s.id
                  ? 'bg-background font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {t(s.labelKey)}
            </button>
          ))}
          <span className="flex-1" />
          <div className="px-[9px] font-mono text-micro leading-[1.7] text-faint">
            v{data.advanced.version} · CDP {data.advanced.cdpPort}
            <br />
            webhook :{data.advanced.webhookPort}
          </div>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-[18px]">
          {section === 'providers' ? <ProvidersSection data={data} /> : null}
          {section === 'orchestrator' ? <OrchestratorSection data={data} /> : null}
          {section === 'mcp' ? <McpTemplatesSection data={data} /> : null}
          {section === 'schedules' ? <SchedulesSection data={data} /> : null}
          {section === 'notifications' ? <NotificationsSection data={data} /> : null}
          {section === 'advanced' ? <AdvancedSection data={data} /> : null}
        </div>
      </div>
    </SettingsShell>
  );
}

function Title({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span className="text-title font-semibold tracking-[-0.01em]">{children}</span>
      <span className="flex-1" />
      {action}
    </div>
  );
}

function ProviderCard({ data, provider }: { data: PlatformState; provider: Provider }) {
  const dispatch = useDispatch();
  const now = useNow();
  const [testing, setTesting] = useState(false);
  const failing = provider.status === 'invalid_key' || provider.status === 'unreachable';
  const affected = Object.values(data.agents).filter((a) => a.model.providerId === provider.id);
  const test = () => {
    setTesting(true);
    void testProviderConnection(provider).then((result) => {
      dispatch({
        type: 'provider/testResult',
        providerId: provider.id,
        ok: result.ok,
        message: result.message,
      });
      setTesting(false);
    });
  };
  return (
    <div
      className={cn(
        'rounded-md border p-[13px]',
        failing ? 'border-danger shadow-[0_0_0_3px_var(--color-danger-soft)]' : 'border-border',
      )}
    >
      <div className="flex items-center gap-[9px]">
        <span className="text-body-sm font-semibold">{provider.name}</span>
        {provider.status === 'connected' ? (
          <Badge tone="success" size="lg">
            connected
          </Badge>
        ) : provider.status === 'untested' ? (
          <Badge tone="neutral" size="lg">
            untested
          </Badge>
        ) : (
          <Badge tone="danger-solid" size="lg">
            {provider.status === 'invalid_key' ? 'API key invalid' : 'unreachable'}
          </Badge>
        )}
        <span className="flex-1" />
        {data.defaults.providerId === provider.id ? (
          <span className="text-tiny text-faint">default</span>
        ) : null}
        <Button variant="soft" size="xs" disabled={testing} onClick={test}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-[18px] gap-y-1 text-caption text-muted-foreground">
        <span>Type · {PROVIDER_TYPE_LABEL[provider.type]}</span>
        <span className="font-mono">{provider.baseUrl}</span>
        <span className="font-mono">{provider.keyPreview}</span>
      </div>
      {provider.capabilities.realtimeVoice || provider.capabilities.speechToText ? (
        <div className="mt-[9px] flex flex-wrap gap-[5px]">
          {provider.capabilities.realtimeVoice ? (
            <Badge tone="primary" size="lg">
              realtime voice
            </Badge>
          ) : null}
          {provider.capabilities.speechToText ? (
            <Badge tone="primary" size="lg">
              speech to text
            </Badge>
          ) : null}
        </div>
      ) : null}
      {failing && provider.lastError ? (
        <div className="mt-[9px] rounded-[9px] bg-danger-soft px-2.5 py-[9px] font-mono text-caption leading-[1.6] text-danger">
          {provider.lastError.message} · 上次測試 {formatClock(provider.lastError.at, now)}
          {affected.length > 0
            ? ` · 使用此 provider 的 Agent 已暫停（${affected.map((a) => a.name).join('、')}）`
            : ''}
        </div>
      ) : null}
    </div>
  );
}

function ProvidersSection({ data }: { data: PlatformState }) {
  const dispatch = useDispatch();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ProviderType>('azure_openai');
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
    deployment: '',
    apiVersion: '2024-10-21',
  });
  const [result, setResult] = useState<string | undefined>(undefined);
  const defaultProvider = providerById(data, data.defaults.providerId);

  const add = () => {
    if (!form.apiKey.trim()) return setResult('需要 API key。');
    if (type !== 'openai' && !form.baseUrl.trim())
      return setResult(type === 'azure_openai' ? '需要 Endpoint。' : '需要 Base URL。');
    const key = form.apiKey.trim();
    const id = `${type}-${Date.now().toString(36)}`;
    // Only a preview is kept in renderer state; the key itself goes to main's safeStorage (T09).
    dispatch({
      type: 'provider/add',
      provider: {
        id,
        name: form.name.trim() || PROVIDER_TYPE_LABEL[type],
        type,
        baseUrl:
          type === 'openai' ? form.baseUrl.trim() || 'api.openai.com/v1' : form.baseUrl.trim(),
        keyPreview: `${key.slice(0, 3)}··········${key.slice(-4)}`,
        status: 'untested',
        capabilities: {
          realtimeVoice: type === 'openai',
          speechToText: type !== 'openai_compatible',
        },
        models: type === 'azure_openai' && form.deployment ? [form.deployment] : [],
      },
    });
    setAdding(false);
    setForm({ name: '', baseUrl: '', apiKey: '', deployment: '', apiVersion: '2024-10-21' });
    setResult(undefined);
  };

  return (
    <div className="flex flex-col gap-3">
      <Title
        action={
          <Button variant="primary" size="sm" onClick={() => setAdding((open) => !open)}>
            {adding ? 'Cancel' : 'Add provider'}
          </Button>
        }
      >
        Model providers
      </Title>
      {data.providers.map((provider) => (
        <ProviderCard key={provider.id} data={data} provider={provider} />
      ))}
      {adding ? (
        <div className="grid animate-reveal grid-cols-1 gap-3 rounded-md border border-border-strong p-[13px] sm:grid-cols-2">
          <Field label="Type">
            <NativeSelect
              value={type}
              onChange={(event) => setType(event.target.value as ProviderType)}
            >
              {Object.entries(PROVIDER_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Display name">
            <Input
              value={form.name}
              placeholder={PROVIDER_TYPE_LABEL[type]}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          {type === 'azure_openai' ? (
            <>
              <Field label="Deployment name">
                <Input
                  value={form.deployment}
                  placeholder="gpt-4o-prod"
                  onChange={(e) => setForm({ ...form, deployment: e.target.value })}
                />
              </Field>
              <Field label="Endpoint">
                <Input
                  value={form.baseUrl}
                  placeholder="https://my-res.openai.azure.com"
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </Field>
              <Field label="API version">
                <Input
                  value={form.apiVersion}
                  onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <Field label={type === 'openai' ? 'Base URL（選填）' : 'Base URL'}>
              <Input
                value={form.baseUrl}
                className="font-mono"
                placeholder={
                  type === 'openai' ? 'https://api.openai.com/v1' : 'http://127.0.0.1:1234/v1'
                }
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </Field>
          )}
          <Field label="API key" hint="金鑰只存在這台電腦上，這裡只會顯示末四碼。">
            <Input
              type="password"
              autoComplete="off"
              value={form.apiKey}
              className="font-mono"
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button variant="primary" size="md" onClick={add}>
              Save provider
            </Button>
            {result ? <span className="text-caption text-danger">{result}</span> : null}
          </div>
        </div>
      ) : null}
      <div className="rounded-md border border-border p-[13px]">
        <Field label="Default model for new personas">
          <NativeSelect
            value={`${data.defaults.providerId}::${data.defaults.model}`}
            onChange={(event) => {
              const [providerId, model] = event.target.value.split('::');
              if (providerId && model) dispatch({ type: 'defaults/set', providerId, model });
            }}
          >
            {data.providers.flatMap((provider) =>
              provider.models.map((model) => (
                <option key={`${provider.id}::${model}`} value={`${provider.id}::${model}`}>
                  {model} · {provider.name}
                </option>
              )),
            )}
          </NativeSelect>
        </Field>
        {defaultProvider && defaultProvider.status !== 'connected' ? (
          <div className="mt-2 text-tiny text-danger">預設 provider 目前無法連線。</div>
        ) : null}
      </div>
    </div>
  );
}

function OrchestratorSection({ data }: { data: PlatformState }) {
  const dispatch = useDispatch();
  const orchestrator = data.agents[ORCHESTRATOR_ID];
  const defaultProvider = providerById(data, data.defaults.providerId);
  const provider = orchestrator ? providerById(data, orchestrator.model.providerId) : undefined;
  const update = (patch: PersonaPatch) =>
    dispatch({ type: 'persona/update', agentId: ORCHESTRATOR_ID, patch });
  return (
    <div className="flex max-w-[680px] flex-col gap-3">
      <Title>Orchestrator</Title>
      <div role="radiogroup" aria-label="Orchestrator model" className="grid gap-2 sm:grid-cols-2">
        <OptionTile
          selected={orchestrator?.model.inherited ?? true}
          onSelect={() => update({ inheritModel: true })}
          title="使用全域預設"
          description={`${displayModel(data.defaults.model)} · ${defaultProvider?.name ?? data.defaults.providerId}`}
        />
        <OptionTile
          selected={orchestrator ? !orchestrator.model.inherited : false}
          onSelect={() => update({ inheritModel: false })}
          title="指定模型"
          description="Orchestrator 需要穩定的工具呼叫能力，建議用最強的模型。"
        />
      </div>
      {orchestrator && !orchestrator.model.inherited ? (
        <div className="grid animate-reveal gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <NativeSelect
              value={orchestrator.model.providerId}
              onChange={(event) => {
                const next = providerById(data, event.target.value);
                update({
                  providerId: event.target.value,
                  model: next?.models[0] ?? orchestrator.model.model,
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
              value={orchestrator.model.model}
              onChange={(event) => update({ model: event.target.value })}
            >
              {(provider?.models ?? [orchestrator.model.model]).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      ) : null}
      <Field label="System prompt" hint="描述拆解原則與批准政策；Persona 清單會自動附上。">
        <CommitTextarea
          value={data.orchestratorPrompt}
          onCommit={(prompt) => dispatch({ type: 'settings/orchestratorPrompt', prompt })}
          className="min-h-[200px] font-mono text-label"
        />
      </Field>
    </div>
  );
}

function McpTemplatesSection({ data }: { data: PlatformState }) {
  return (
    <div className="flex flex-col gap-3">
      <Title>MCP templates</Title>
      <div className="text-caption text-muted-foreground">
        全域可重複使用的 MCP 伺服器定義。Persona 以名稱引用，但每個 Persona 各自啟動一份連線。
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        {data.mcpTemplates.map((template) => {
          const users = Object.values(data.agents).filter((a) =>
            a.config?.mcpServers.some((s) => s.name === template.name && s.from === 'template'),
          );
          return (
            <div
              key={template.name}
              className="flex items-center gap-3 border-b border-border px-[13px] py-[11px] last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-label font-semibold">{template.name}</div>
                <div className="mt-0.5 truncate font-mono text-tiny text-muted-foreground">
                  {template.transport} · {template.target}
                </div>
              </div>
              <span className="text-caption text-faint">{template.toolCount} tools</span>
              <span className="text-caption text-muted-foreground">
                {users.length > 0 ? `被 ${users.map((u) => u.name).join('、')} 引用` : '未被引用'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TEMPLATE_VARIABLES = ['{{current_time}}', '{{date}}', '{{timestamp}}'] as const;

function SchedulesSection({ data }: { data: PlatformState }) {
  const dispatch = useDispatch();
  const now = useNow();
  const [selectedId, setSelectedId] = useState(data.schedules[0]?.id);
  const [showHistory, setShowHistory] = useState(false);
  const schedule = data.schedules.find((s) => s.id === selectedId) ?? data.schedules[0];
  const [draft, setDraft] = useState(schedule?.template ?? '');
  const [draftFor, setDraftFor] = useState(schedule?.id);
  const editor = useRef<HTMLTextAreaElement>(null);
  if (schedule && draftFor !== schedule.id) {
    setDraftFor(schedule.id);
    setDraft(schedule.template);
  }
  const preview = renderTemplate(draft, schedule?.nextRunAt ?? now);

  const insert = (variable: string) => {
    const node = editor.current;
    const start = node?.selectionStart ?? draft.length;
    const end = node?.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}${variable}${draft.slice(end)}`;
    setDraft(next);
    if (schedule)
      dispatch({ type: 'schedule/setTemplate', scheduleId: schedule.id, template: next });
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Title
        action={
          <Button
            variant="primary"
            size="sm"
            disabled
            title="新增排程需要 main process 的排程服務（T21）"
          >
            New schedule
          </Button>
        }
      >
        Schedules
      </Title>
      <div className="overflow-x-auto rounded-md border border-border">
        <div className="flex min-w-[620px] gap-2.5 border-b border-border bg-secondary px-[13px] py-2 text-tiny text-faint">
          <span className="flex-1">Name</span>
          <span className="w-[150px]">Cron</span>
          <span className="w-[120px]">Persona</span>
          <span className="w-[104px]">Next run</span>
          <span className="w-11" />
        </div>
        {data.schedules.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            aria-current={s.id === schedule?.id}
            onClick={() => setSelectedId(s.id)}
            onKeyDown={(event) => event.key === 'Enter' && setSelectedId(s.id)}
            className={cn(
              'flex min-w-[620px] items-center gap-2.5 border-b border-border px-[13px] py-2.5 last:border-b-0',
              s.id === schedule?.id && 'bg-primary-soft',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="text-body-sm font-semibold">{s.name}</div>
              {s.lastRun ? (
                <div
                  className={cn(
                    'text-tiny',
                    s.lastRun.status === 'skipped'
                      ? 'text-warning'
                      : s.lastRun.status === 'failed'
                        ? 'text-danger'
                        : 'text-faint',
                  )}
                >
                  上次 {formatClock(s.lastRun.at, now)} · {s.lastRun.status}
                  {s.lastRun.note ? `（${s.lastRun.note}）` : ''}
                </div>
              ) : null}
            </div>
            <div className="w-[150px]">
              <div className="font-mono text-caption">{s.cron}</div>
              <div className="text-tiny text-faint">
                {s.cronText} · {s.timezone}
              </div>
            </div>
            <span className="w-[120px] truncate text-caption">
              {data.agents[s.agentId]?.name ?? s.agentId}
            </span>
            <span className="w-[104px] font-mono text-caption text-muted-foreground">
              {formatClock(s.nextRunAt, now)}
            </span>
            <span className="w-11" onClick={(event) => event.stopPropagation()}>
              <Switch
                aria-label={`Enable ${s.name}`}
                checked={s.enabled}
                onCheckedChange={(enabled) =>
                  dispatch({ type: 'schedule/setEnabled', scheduleId: s.id, enabled })
                }
              />
            </span>
          </div>
        ))}
      </div>

      {schedule ? (
        <div className="flex flex-col gap-[11px] rounded-md border border-border-strong p-3.5">
          <SectionHeader title={`Prompt template · ${schedule.name}`}>
            <Button
              variant="soft"
              size="xs"
              onClick={() => dispatch({ type: 'schedule/runNow', scheduleId: schedule.id })}
            >
              Run now
            </Button>
            <Button variant="outline" size="xs" onClick={() => setShowHistory((open) => !open)}>
              History
            </Button>
          </SectionHeader>
          <div className="flex flex-wrap gap-[5px]">
            {TEMPLATE_VARIABLES.map((variable) => (
              <button
                type="button"
                key={variable}
                onClick={() => insert(variable)}
                className="rounded-full bg-primary-soft px-[9px] py-1 font-mono text-tiny font-semibold text-primary hover:bg-primary-glow"
              >
                {variable}
              </button>
            ))}
            <span className="self-center text-tiny text-faint">點擊插入變數</span>
          </div>
          <Textarea
            ref={editor}
            aria-label="Prompt template"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() =>
              draft !== schedule.template &&
              dispatch({ type: 'schedule/setTemplate', scheduleId: schedule.id, template: draft })
            }
            className="min-h-[86px] font-mono text-label"
          />
          <div className="rounded-[9px] border border-border bg-secondary px-[11px] py-2.5">
            <div className="text-micro text-faint">
              Preview · 下次執行 {formatClock(schedule.nextRunAt, now)}
            </div>
            <div className="mt-[5px] text-label leading-[1.6] text-muted-foreground">
              {preview.text}
            </div>
            {preview.unknown.length > 0 ? (
              <div className="mt-1 text-tiny text-warning">
                未知變數：{preview.unknown.join('、')}
              </div>
            ) : null}
          </div>
          {showHistory ? (
            <div className="animate-reveal rounded-[9px] border border-border px-[11px] py-2 text-caption">
              {schedule.lastRun ? (
                <div className="flex gap-3">
                  <span className="font-mono text-faint">
                    {formatClock(schedule.lastRun.at, now)}
                  </span>
                  <span>{schedule.lastRun.status}</span>
                  {schedule.lastRun.note ? (
                    <span className="text-muted-foreground">{schedule.lastRun.note}</span>
                  ) : null}
                </div>
              ) : (
                <span className="text-faint">還沒有執行紀錄。</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SEVERITIES: readonly { value: Severity; label: string }[] = [
  { value: 'info', label: 'info' },
  { value: 'success', label: 'success' },
  { value: 'warning', label: 'warning' },
  { value: 'error', label: 'error' },
  { value: 'action_required', label: 'action required' },
];

function NotificationsSection({ data }: { data: PlatformState }) {
  const dispatch = useDispatch();
  const settings = data.notificationSettings;
  return (
    <div className="flex flex-col gap-3">
      <Title>Notifications</Title>
      <SettingsCard>
        <label className="flex items-center gap-3">
          <Switch
            checked={settings.toastEnabled}
            onCheckedChange={(enabled) =>
              dispatch({ type: 'settings/toast', enabled, minSeverity: settings.toastMinSeverity })
            }
          />
          <span className="text-body-sm font-semibold">桌面 Toast</span>
        </label>
        <Field label="最低嚴重度門檻" hint="action required 一律發送，不受門檻限制。">
          <div role="radiogroup" aria-label="Minimum severity" className="flex flex-wrap gap-1">
            {SEVERITIES.map((s) => (
              <button
                type="button"
                role="radio"
                key={s.value}
                aria-checked={settings.toastMinSeverity === s.value}
                disabled={!settings.toastEnabled}
                onClick={() =>
                  dispatch({
                    type: 'settings/toast',
                    enabled: settings.toastEnabled,
                    minSeverity: s.value,
                  })
                }
                className={cn(
                  'rounded-full border px-[9px] py-[2px] text-tiny font-semibold disabled:opacity-50',
                  settings.toastMinSeverity === s.value
                    ? 'border-warning bg-warning-soft text-warning'
                    : 'border-border-strong bg-background text-faint hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>
      </SettingsCard>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-[9px] border-b border-border bg-secondary px-[13px] py-2.5">
          <span className="text-label font-semibold">外部轉發規則</span>
          <span className="flex-1" />
          <button
            type="button"
            className="text-tiny font-semibold text-primary hover:opacity-70"
            onClick={() =>
              dispatch({
                type: 'rule/add',
                rule: {
                  id: `rule-ntfy-${Date.now().toString(36)}`,
                  name: 'warning 以上 → ntfy',
                  target: 'ntfy.sh/<topic>',
                  detail: 'header: Priority: default',
                  enabled: false,
                },
              })
            }
          >
            + ntfy 範本
          </button>
          <button
            type="button"
            className="text-tiny font-semibold text-primary hover:opacity-70"
            onClick={() =>
              dispatch({
                type: 'rule/add',
                rule: {
                  id: `rule-tg-${Date.now().toString(36)}`,
                  name: 'action required → Telegram',
                  target: 'api.telegram.org/bot<token>/sendMessage',
                  detail: 'body: {{title}} — {{agent}}',
                  enabled: false,
                },
              })
            }
          >
            + Telegram 範本
          </button>
        </div>
        {settings.rules.map((rule) => (
          <div
            key={rule.id}
            className={cn(
              'flex items-center gap-3 border-b border-border px-[13px] py-[11px] last:border-b-0',
              !rule.enabled && 'opacity-65',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="text-label font-semibold">{rule.name}</div>
              <div className="mt-[3px] font-mono text-tiny leading-[1.6] break-all text-muted-foreground">
                {rule.target} · {rule.detail}
              </div>
            </div>
            {rule.enabled ? (
              <Button
                variant="soft"
                size="xs"
                disabled
                title="送出測試需要 main process 的通知服務（T28）"
              >
                Send test
              </Button>
            ) : null}
            <Switch
              aria-label={`Enable ${rule.name}`}
              checked={rule.enabled}
              onCheckedChange={(enabled) =>
                dispatch({ type: 'rule/setEnabled', ruleId: rule.id, enabled })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvancedSection({ data }: { data: PlatformState }) {
  const advanced = data.advanced;
  const { locale, t } = useTranslation();
  const setLocale = useLocaleSelection();
  const [theme, setTheme] = useTheme();
  const row = (label: string, value: string) => (
    <div className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <span className="flex-1 text-caption text-muted-foreground">{label}</span>
      <span className="font-mono text-caption">{value}</span>
    </div>
  );
  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <Title>{t('settings.advancedTitle')}</Title>
      <SettingsCard title={t('settings.language')}>
        <Field label={t('settings.interfaceLanguage')} hint={t('settings.languageDescription')}>
          <NativeSelect
            value={locale}
            onChange={(event) => setLocale(event.target.value as typeof locale)}
          >
            {LOCALES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </SettingsCard>
      <SettingsCard title={t('settings.appearance')}>
        <Field label={t('settings.colorScheme')} hint={t('settings.appearanceDescription')}>
          <NativeSelect
            value={theme}
            onChange={(event) => setTheme(event.target.value as typeof theme)}
          >
            <option value="light">{t('settings.light')}</option>
            <option value="dark">{t('settings.dark')}</option>
            <option value="system">{t('settings.system')}</option>
          </NativeSelect>
        </Field>
      </SettingsCard>
      <SettingsCard title={t('settings.traceExport')}>
        <label className="flex items-center gap-3">
          <Switch checked={advanced.otlpEnabled} disabled aria-label={t('settings.exportToOtlp')} />
          <span className="text-body-sm">{t('settings.exportToOtlp')}</span>
        </label>
        <Field label="Endpoint">
          <Input readOnly value={advanced.otlpEndpoint} className="font-mono" />
        </Field>
      </SettingsCard>
      <SettingsCard title={t('settings.retention')}>
        <div>
          {row(t('settings.traceAndMessages'), `${advanced.traceRetentionDays} 天`)}
          {row(t('settings.notificationsLabel'), `${advanced.notificationRetentionDays} 天`)}
        </div>
      </SettingsCard>
      <SettingsCard title={t('settings.localServices')}>
        <div>
          {row('CDP port（僅 127.0.0.1）', String(advanced.cdpPort))}
          {row('Webhook port（僅 127.0.0.1）', String(advanced.webhookPort))}
          {row(t('settings.database'), advanced.databasePath)}
        </div>
      </SettingsCard>
      <SettingsCard title={t('settings.appUpdates')}>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-caption text-muted-foreground">
            {t('settings.currentVersion')} v{advanced.version}
          </span>
          <Button variant="outline" size="sm" disabled title="自動更新在發佈流程（T31）完成後啟用">
            {t('settings.checkUpdates')}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}
