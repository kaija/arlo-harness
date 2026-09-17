import type { AgentId, InterruptPayload, RiskLevel } from '@arlo/shared';

/*
 * Renderer view model. Everything here is plain JSON so a window can hand its
 * state to another window, and so T20's `state/*` subscriptions can fill the
 * same shapes. Times are Unix milliseconds.
 */

export type AgentActivity = 'idle' | 'working' | 'waiting' | 'error' | 'offline';

/** UI language. Keep this in the shared renderer state so every app window agrees. */
export type AppLocale = 'en' | 'zh-TW' | 'ja';

export interface ModelBinding {
  providerId: string;
  model: string;
  temperature?: number | undefined;
  /** True when the Agent has no binding of its own and uses the global default. */
  inherited: boolean;
}

export interface ResourceUsage {
  memoryMb: number;
  cpuPercent: number;
}

/** ADR-0002: crashed Agent processes restart after 1 / 5 / 30 s. */
export interface RestartState {
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number;
  queuedTasks: number;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
}

export interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Who drives the page. `user` pauses the Agent until it is handed back. */
  driver: 'agent' | 'user';
  /** What the Agent is about to act on; drawn as a non-invasive highlight. */
  focus?: { label: string; action: string } | undefined;
  /** Low-resolution activity preview for the Agent list (ADR-0007 §6). */
  thumbnail: number[];
}

export type SkillSource = 'built-in' | 'local folder';

export interface Skill {
  name: string;
  description: string;
  source: SkillSource;
  hasCode: boolean;
  /** Non-built-in skills with code need a one-time trust confirmation (ADR-0008). */
  trusted: boolean;
  enabled: boolean;
}

export interface McpServer {
  name: string;
  transport: 'stdio' | 'streamable_http';
  target: string;
  from: 'template' | 'custom';
  status: 'connected' | 'connecting' | 'error';
  toolCount: number;
  error?: string | undefined;
}

export type ToolSource =
  { kind: 'built-in' } | { kind: 'mcp'; server: string } | { kind: 'skill'; skill: string };

export interface ToolEntry {
  /** Risk key: built-in name, `<server>.<tool>` for MCP, or the skill tool name. */
  key: string;
  description: string;
  source: ToolSource;
  risk: RiskLevel;
}

export interface EventTrigger {
  event: string;
  template: string;
}

export interface PersonaConfig {
  enabled: boolean;
  systemPrompt: string;
  workdir: string;
  maxConcurrency: number;
  /** persona.yaml `delegation.timeoutMinutes` (T04): default 30, 1–1440. */
  delegationTimeoutMinutes: number;
  browserEnabled: boolean;
  signedInSites: string[];
  skills: Skill[];
  mcpServers: McpServer[];
  tools: ToolEntry[];
  eventTriggers: EventTrigger[];
  webhook: { url: string; tokenLast4: string };
}

export interface Agent {
  id: AgentId;
  name: string;
  initials: string;
  /** What the Orchestrator reads when choosing whom to delegate to. */
  description: string;
  activity: AgentActivity;
  paused: boolean;
  model: ModelBinding;
  currentTaskId?: string | undefined;
  queuedTasks: number;
  /** When the current activity started, for "working · 14m". */
  activeSince?: number | undefined;
  resources?: ResourceUsage | undefined;
  browser?: BrowserState | undefined;
  restart?: RestartState | undefined;
  /** Personas only; the Orchestrator is configured in global settings. */
  config?: PersonaConfig | undefined;
}

export type TaskState = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'canceled';
export type StepState = 'done' | 'running' | 'waiting' | 'error' | 'queued';

export interface TaskStep {
  label: string;
  state: StepState;
}

export interface Task {
  id: string;
  agentId: AgentId;
  /** The Orchestrator task that delegated this one. */
  parentId?: string | undefined;
  threadId: string;
  title: string;
  /** Instruction text as delegated or typed. */
  brief: string;
  state: TaskState;
  mode?: 'sync' | 'async' | undefined;
  createdAt: number;
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  /** Set while the task waits for a human, for "已等待 2m 10s". */
  waitingSince?: number | undefined;
  steps: TaskStep[];
  lastAction?: { text: string; at: number } | undefined;
  result?: string | undefined;
  /** Item-based progress for long batch jobs ("206 / 500"). */
  counter?: { done: number; total: number } | undefined;
}

export type ThreadSource = 'user' | 'orchestrator' | 'schedule' | 'event' | 'webhook';

export interface Thread {
  id: string;
  agentId: AgentId;
  source: ThreadSource;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  taskId?: string | undefined;
}

interface ItemBase {
  id: string;
  at: number;
}

export type ChatItem =
  | (ItemBase & { kind: 'user'; text: string; deferred?: boolean | undefined })
  | (ItemBase & { kind: 'agent'; agentId: AgentId; text: string })
  | (ItemBase & { kind: 'reasoning'; durationMs: number; text: string })
  | (ItemBase & {
      kind: 'tool';
      name: string;
      origin: string;
      ok: boolean;
      durationMs: number;
      input: string[];
      output: string[];
    })
  | (ItemBase & {
      kind: 'browser';
      name: string;
      ok: boolean;
      durationMs: number;
      lines: string[];
    })
  | (ItemBase & { kind: 'delegation'; taskId: string })
  | (ItemBase & { kind: 'system'; tone: 'info' | 'success' | 'warning' | 'error'; text: string })
  | (ItemBase & { kind: 'interrupt'; notificationId: string });

export type ChatItemKind = ChatItem['kind'];

export type Severity = 'info' | 'success' | 'warning' | 'error' | 'action_required';

export type InterruptResolution =
  | 'approved'
  | 'approved_with_edits'
  | 'rejected'
  | 'answered'
  | 'resumed'
  | 'skipped'
  | 'retried'
  | 'ignored'
  | 'canceled';

export interface InterruptState {
  payload: InterruptPayload;
  resolution?: InterruptResolution | undefined;
  resolvedAt?: number | undefined;
  /** Answer text or edited parameters, shown on the resolved card. */
  note?: string | undefined;
}

export interface Notification {
  id: string;
  severity: Severity;
  agentId: AgentId;
  title: string;
  body: string;
  at: number;
  read: boolean;
  taskId?: string | undefined;
  threadId?: string | undefined;
  interrupt?: InterruptState | undefined;
}

export type ProviderType = 'openai' | 'openai_compatible' | 'azure_openai';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  keyPreview: string;
  status: 'connected' | 'invalid_key' | 'unreachable' | 'untested';
  lastError?: { message: string; at: number } | undefined;
  capabilities: { realtimeVoice: boolean; speechToText: boolean };
  models: string[];
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  cronText: string;
  timezone: string;
  agentId: AgentId;
  enabled: boolean;
  template: string;
  lastRun?:
    { at: number; status: 'done' | 'failed' | 'skipped'; note?: string | undefined } | undefined;
  nextRunAt: number;
  continueThread: boolean;
}

export interface ForwardRule {
  id: string;
  name: string;
  target: string;
  detail: string;
  enabled: boolean;
}

export interface NotificationSettings {
  toastEnabled: boolean;
  toastMinSeverity: Severity;
  rules: ForwardRule[];
}

export interface AdvancedSettings {
  otlpEnabled: boolean;
  otlpEndpoint: string;
  traceRetentionDays: number;
  notificationRetentionDays: number;
  cdpPort: number;
  webhookPort: number;
  databasePath: string;
  version: string;
}

export interface Span {
  id: string;
  runId: string;
  name: string;
  kind: 'model' | 'tool' | 'mcp' | 'browser';
  /** Offset from run start. */
  startMs: number;
  durationMs: number;
  tokens?: number | undefined;
  detail: string;
}

export interface Run {
  id: string;
  agentId: AgentId;
  threadId: string;
  index: number;
  startedAt: number;
}

export interface GlobalDefaults {
  providerId: string;
  model: string;
}

export interface PlatformState {
  /** Interface language selected in Global settings. */
  locale: AppLocale;
  agents: Record<string, Agent>;
  /** Orchestrator first, then Personas in list order. */
  agentOrder: AgentId[];
  tasks: Record<string, Task>;
  /** User-level Orchestrator tasks, newest first. */
  rootTaskIds: string[];
  threads: Record<string, Thread>;
  threadItems: Record<string, ChatItem[]>;
  notifications: Notification[];
  providers: Provider[];
  defaults: GlobalDefaults;
  orchestratorPrompt: string;
  mcpTemplates: McpServer[];
  schedules: Schedule[];
  notificationSettings: NotificationSettings;
  advanced: AdvancedSettings;
  runs: Run[];
  spans: Span[];
  onboarded: boolean;
}
