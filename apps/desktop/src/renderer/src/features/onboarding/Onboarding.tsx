import { isPersonaId } from '@arlo/shared';
import { getRouteApi } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button.js';
import { Field } from '../../components/ui/field.js';
import { OptionTile } from '../../components/ui/form-controls.js';
import { Input, Textarea } from '../../components/ui/input.js';
import { WindowTitleBar } from '../../components/window-title-bar.js';
import { cn } from '../../lib/utils.js';
import type { ProviderType } from '../../state/model.js';
import { testProviderConnection } from '../../state/provider-test.js';
import { agentIdOf } from '../../state/selectors.js';
import { useData, useDispatch } from '../../state/store.js';
import { PROVIDER_TYPE_LABEL } from '../settings/GlobalSettings.js';

const route = getRouteApi('/welcome');

const DEFAULT_MODELS: Readonly<Record<ProviderType, string[]>> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
  openai_compatible: [],
  azure_openai: [],
};

const TEMPLATES = [
  {
    id: 'web-researcher',
    name: '網路研究員',
    description: '內建瀏覽器工具、擷取與引用來源。適合市場、財報、競品調查。',
    systemPrompt:
      '你是網路研究員。每個結論都附上來源網址與日期；遇到需要登入的頁面，請求使用者協助，不要嘗試繞過。',
    browserEnabled: true,
  },
  {
    id: 'data-organizer',
    name: '資料整理員',
    description: '把雜亂資料整理成表格與摘要，不需要瀏覽器。',
    systemPrompt: '你把雜亂資料整理成表格與摘要。先給三行結論，再附細節表格。',
    browserEnabled: false,
  },
  {
    id: 'code-assistant',
    name: '程式助手',
    description: '讀寫工作目錄檔案、執行指令，預設工具風險為 high。',
    systemPrompt: '你是程式助手，只在工作目錄內讀寫檔案。執行指令前說明目的與影響。',
    browserEnabled: false,
  },
] as const;

const FIRST_TASK = '幫我查台積電最近一季毛利率，並跟聯電比較';

/** Persona ids are lowercase kebab-case (packages/shared ids.ts); non-Latin names get a generated id. */
function personaIdFor(name: string, taken: (id: string) => boolean): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  let base = isPersonaId(slug) ? slug : `persona-${Date.now().toString(36)}`;
  let suffix = 2;
  while (taken(base)) base = `${slug || 'persona'}-${suffix++}`;
  return base;
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex gap-1.5" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn('h-[3px] flex-1 rounded-full', n <= step ? 'bg-primary' : 'bg-muted')}
        />
      ))}
    </div>
  );
}

export function Onboarding() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const data = useData();
  const step = search.step ?? (data.providers.length > 0 ? 2 : 1);
  const fromMain = search.from === 'main';
  const [createdName, setCreatedName] = useState<string | undefined>(undefined);

  const title =
    step === 1
      ? 'Welcome — step 1 of 3'
      : step === 2
        ? fromMain
          ? 'New persona'
          : 'Welcome — step 2 of 3 · 建立第一個 Persona'
        : 'Step 3 · 第一個任務';

  return (
    <div className="flex h-full flex-col bg-secondary">
      <WindowTitleBar title={title} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {step === 1 ? <ProviderStep onDone={() => void navigate({ search: { step: 2 } })} /> : null}
        {step === 2 ? (
          <PersonaStep
            fromMain={fromMain}
            onCancel={() => void navigate({ to: '/main', search: {} })}
            onCreated={(personaId, name) => {
              if (fromMain) {
                void navigate({ to: '/main', search: { agent: personaId } });
              } else {
                setCreatedName(name);
                void navigate({ search: { step: 3 } });
              }
            }}
          />
        ) : null}
        {step === 3 ? <FirstTaskStep personaName={createdName} /> : null}
      </div>
    </div>
  );
}

function Card({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div
      style={{ width: `min(${width}px, 100%)` }}
      className="flex animate-swap-in flex-col gap-4 rounded-md border border-black/10 bg-background px-[34px] py-[30px] shadow-xl"
    >
      {children}
    </div>
  );
}

function ProviderStep({ onDone }: { onDone: () => void }) {
  const dispatch = useDispatch();
  const [type, setType] = useState<ProviderType>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [status, setStatus] = useState<
    { ok: boolean; message: string; models: string[] } | undefined
  >(undefined);
  const [testing, setTesting] = useState(false);
  const needsUrl = type !== 'openai';

  const test = () => {
    if (!apiKey.trim() || (needsUrl && !baseUrl.trim())) {
      setStatus({
        ok: false,
        message: needsUrl ? '請輸入 API key 與網址。' : '請輸入 API key。',
        models: [],
      });
      return;
    }
    setTesting(true);
    void testProviderConnection({
      status: 'untested',
      lastError: undefined,
      models: DEFAULT_MODELS[type],
    }).then((result) => {
      setStatus(result);
      setTesting(false);
    });
  };

  const finish = () => {
    const key = apiKey.trim();
    const id = `${type}-${Date.now().toString(36)}`;
    const models = status?.models.length ? status.models : DEFAULT_MODELS[type];
    dispatch({
      type: 'provider/add',
      provider: {
        id,
        name: PROVIDER_TYPE_LABEL[type],
        type,
        baseUrl: needsUrl ? baseUrl.trim() : 'api.openai.com/v1',
        keyPreview: `${key.slice(0, 3)}··········${key.slice(-4)}`,
        status: 'connected',
        capabilities: {
          realtimeVoice: type === 'openai',
          speechToText: type !== 'openai_compatible',
        },
        models,
      },
    });
    if (models[0]) dispatch({ type: 'defaults/set', providerId: id, model: models[0] });
    onDone();
  };

  return (
    <Card width={560}>
      <Progress step={1} />
      <div>
        <h1 className="text-[20px] font-bold tracking-[-0.02em]">先連上一個模型供應商</h1>
        <p className="mt-[7px] max-w-[400px] text-body leading-[1.65] text-muted-foreground">
          金鑰只存在這台電腦上，不會離開你的機器。之後可以再新增其他供應商。
        </p>
      </div>
      <div role="radiogroup" aria-label="Provider type" className="grid grid-cols-3 gap-2">
        {(Object.keys(PROVIDER_TYPE_LABEL) as ProviderType[]).map((value) => (
          <OptionTile
            key={value}
            selected={type === value}
            onSelect={() => {
              setType(value);
              setStatus(undefined);
            }}
            title={value === 'openai_compatible' ? 'OpenAI 相容' : PROVIDER_TYPE_LABEL[value]}
            className="p-[11px]"
          />
        ))}
      </div>
      {needsUrl ? (
        <Field label={type === 'azure_openai' ? 'Endpoint' : 'Base URL'}>
          <Input
            value={baseUrl}
            className="font-mono"
            placeholder={
              type === 'azure_openai'
                ? 'https://my-res.openai.azure.com'
                : 'http://127.0.0.1:1234/v1'
            }
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>
      ) : null}
      <Field label="API key">
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          className="font-mono"
          onChange={(event) => {
            setApiKey(event.target.value);
            setStatus(undefined);
          }}
        />
      </Field>
      <div className="flex items-center gap-[9px]">
        <Button variant="soft" size="md" disabled={testing} onClick={test}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {status ? (
          <span
            role="status"
            className={cn('text-caption font-semibold', status.ok ? 'text-success' : 'text-danger')}
          >
            {status.message}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-[9px] pt-2">
        <span className="text-caption text-faint">
          預設模型 {(status?.models[0] ?? DEFAULT_MODELS[type][0]) || '測試後選擇'}
        </span>
        <span className="flex-1" />
        <Button variant="primary" size="lg" disabled={!status?.ok} onClick={finish}>
          繼續
        </Button>
      </div>
    </Card>
  );
}

function PersonaStep({
  fromMain,
  onCancel,
  onCreated,
}: {
  fromMain: boolean;
  onCancel: () => void;
  onCreated: (personaId: string, name: string) => void;
}) {
  const data = useData();
  const dispatch = useDispatch();
  const [templateId, setTemplateId] = useState<string>(TEMPLATES[0].id);
  const [custom, setCustom] = useState(false);
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const [name, setName] = useState<string>(template.name);
  const [description, setDescription] = useState<string>(template.description);
  const [systemPrompt, setSystemPrompt] = useState<string>(template.systemPrompt);

  const pick = (id: string) => {
    const next = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
    setTemplateId(id);
    setName(next.name);
    setDescription(next.description);
    setSystemPrompt(next.systemPrompt);
  };

  const create = () => {
    if (!name.trim() || !description.trim() || !systemPrompt.trim()) return;
    const id = personaIdFor(name, (candidate) => data.agents[agentIdOf(candidate)] !== undefined);
    dispatch({
      type: 'persona/create',
      persona: {
        id,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        browserEnabled: custom ? false : template.browserEnabled,
      },
    });
    onCreated(id, name.trim());
  };

  return (
    <Card width={560}>
      {!fromMain ? <Progress step={2} /> : null}
      <h1 className="text-[17px] font-bold tracking-[-0.02em]">
        {custom ? '自己寫一個 Persona' : '從範本開始，或自己寫'}
      </h1>
      {!custom ? (
        <div role="radiogroup" aria-label="Persona template" className="flex flex-col gap-[7px]">
          {TEMPLATES.map((t) => (
            <OptionTile
              key={t.id}
              selected={templateId === t.id}
              onSelect={() => pick(t.id)}
              title={t.name}
              description={t.description}
            />
          ))}
        </div>
      ) : null}
      <Field label="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      {custom ? (
        <>
          <Field
            label="Description"
            hint="Orchestrator 依這段描述決定派工 — 寫清楚專長與不擅長的事。"
          >
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Persona system prompt">
            <Textarea
              value={systemPrompt}
              className="min-h-[120px] font-mono text-label"
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </Field>
        </>
      ) : null}
      <div className="flex items-center gap-[9px] pt-2">
        <Button
          variant="outline"
          size="md"
          onClick={() => {
            if (custom) pick(templateId);
            else {
              setDescription('');
              setSystemPrompt('');
            }
            setCustom(!custom);
          }}
        >
          {custom ? '改用範本' : '自己寫'}
        </Button>
        <span className="flex-1" />
        {fromMain ? (
          <Button variant="ghost" size="md" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          disabled={!name.trim() || !description.trim() || !systemPrompt.trim()}
          onClick={create}
        >
          {fromMain ? '建立 Persona' : '建立並進入主視窗'}
        </Button>
      </div>
    </Card>
  );
}

function FirstTaskStep({ personaName }: { personaName: string | undefined }) {
  const navigate = route.useNavigate();
  const dispatch = useDispatch();
  const start = (draft?: string) => {
    dispatch({ type: 'onboarding/complete' });
    void navigate({ to: '/main', search: draft ? { draft } : {} });
  };
  return (
    <div className="flex w-[min(400px,100%)] animate-swap-in flex-col gap-3 rounded-md border border-black/10 bg-background p-[22px] shadow-xl">
      <Progress step={3} />
      <h1 className="text-[14px] font-bold tracking-[-0.02em]">準備好了。試著下第一個任務。</h1>
      <p className="text-label leading-[1.7] text-muted-foreground">
        Orchestrator 會判斷要不要派給 {personaName ?? '你的 Persona'}，或直接自己回答。
      </p>
      <button
        type="button"
        onClick={() => start(FIRST_TASK)}
        className="rounded-[11px] border border-dashed border-primary-glow bg-primary-soft p-[11px] text-left text-label leading-[1.6] text-primary hover:border-primary"
      >
        「{FIRST_TASK}」
      </button>
      <Button variant="primary" size="md" className="self-start" onClick={() => start()}>
        開始使用
      </Button>
    </div>
  );
}
