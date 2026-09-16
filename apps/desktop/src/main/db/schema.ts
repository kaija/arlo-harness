import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/*
 * Main-process SQLite schema (ADR-0011 §3). Timestamps are Unix epoch
 * milliseconds. Rows an Agent writes through `db/*` are keyed by `agent_id`
 * so one Agent can never read or overwrite another's data. JSON columns hold
 * SDK-owned shapes as text. persona.yaml and skills stay the source of truth
 * on disk (ADR-0008); `personas` only caches them.
 *
 * Phase 2 tables (`schedules`, `schedule_runs`, `events`) arrive in a later
 * migration with the scheduler (ADR-0012). After changing this file run
 * `pnpm --filter @arlo/desktop db:generate` and commit the new migration.
 */

const timestamps = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
};

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** Last successfully parsed persona.yaml, as JSON. */
  configJson: text('config_json'),
  ...timestamps,
});

export const providerProfiles = sqliteTable('provider_profiles', {
  id: text('id').primaryKey(),
  /** A `ProviderProfile`; the key itself lives in `secrets` (ADR-0003 §3). */
  profileJson: text('profile_json').notNull(),
  ...timestamps,
});

export const secrets = sqliteTable('secrets', {
  ref: text('ref').primaryKey(),
  /** `safeStorage.encryptString` output; never plaintext (ADR-0011 §5, §8). */
  ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
  last4: text('last4').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const threads = sqliteTable(
  'threads',
  {
    agentId: text('agent_id').notNull(),
    contextId: text('context_id').notNull(),
    /** user / orchestrator / schedule / event (ADR-0009 §4); set by whoever starts the Thread. */
    source: text('source'),
    title: text('title'),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.contextId] }),
    index('threads_recent_idx').on(table.agentId, table.updatedAt),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: text('agent_id').notNull(),
    contextId: text('context_id').notNull(),
    /** Position within the Thread, starting at 1 (ADR-0009 consequences). */
    seq: integer('seq').notNull(),
    /** One SDK session item. */
    itemJson: text('item_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('messages_thread_seq_idx').on(table.agentId, table.contextId, table.seq),
    index('messages_created_idx').on(table.createdAt),
  ],
);

export const runStates = sqliteTable(
  'run_states',
  {
    agentId: text('agent_id').notNull(),
    taskId: text('task_id').notNull(),
    /** Serialized SDK RunState at an interruption (ADR-0010 §3). */
    state: text('state').notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.agentId, table.taskId] })],
);

export const a2aTasks = sqliteTable(
  'a2a_tasks',
  {
    agentId: text('agent_id').notNull(),
    taskId: text('task_id').notNull(),
    contextId: text('context_id').notNull(),
    /** Arlo task state derived from the stored Task; null if the Task had none. */
    state: text('state'),
    /** The A2A Task as saved by the Agent's TaskStore (`Task.toJSON`). */
    taskJson: text('task_json').notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.taskId] }),
    index('a2a_tasks_context_idx').on(table.agentId, table.contextId),
    index('a2a_tasks_state_idx').on(table.state),
  ],
);

export const delegations = sqliteTable(
  'delegations',
  {
    id: text('id').primaryKey(),
    /** The Orchestrator Thread that delegated (ADR-0005 §4). */
    orchestratorContextId: text('orchestrator_context_id').notNull(),
    personaAgentId: text('persona_agent_id').notNull(),
    taskId: text('task_id'),
    contextId: text('context_id').notNull(),
    mode: text('mode', { enum: ['sync', 'async'] }).notNull(),
    state: text('state').notNull(),
    request: text('request').notNull(),
    result: text('result'),
    timeoutAt: integer('timeout_at'),
    ...timestamps,
  },
  (table) => [
    index('delegations_orchestrator_idx').on(table.orchestratorContextId),
    index('delegations_task_idx').on(table.personaAgentId, table.taskId),
    index('delegations_state_idx').on(table.state),
  ],
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    severity: text('severity', {
      enum: ['info', 'success', 'warning', 'error', 'action_required'],
    }).notNull(),
    /** An AgentId or `system` (ADR-0012 §11). */
    source: text('source').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    actionsJson: text('actions_json').notNull().default('[]'),
    /** The Task an `action_required` notification waits on, if any. */
    agentId: text('agent_id'),
    taskId: text('task_id'),
    readAt: integer('read_at'),
    handledAt: integer('handled_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('notifications_created_idx').on(table.createdAt),
    index('notifications_pending_idx').on(table.severity, table.handledAt),
    index('notifications_task_idx').on(table.agentId, table.taskId),
  ],
);

export const traceSpans = sqliteTable(
  'trace_spans',
  {
    agentId: text('agent_id').notNull(),
    spanId: text('span_id').notNull(),
    traceId: text('trace_id').notNull(),
    parentId: text('parent_id'),
    spanType: text('span_type').notNull(),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    dataJson: text('data_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.spanId] }),
    index('trace_spans_trace_idx').on(table.traceId),
    index('trace_spans_created_idx').on(table.createdAt),
  ],
);
