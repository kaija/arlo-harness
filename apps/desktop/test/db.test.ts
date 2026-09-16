import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { Task } from '@a2a-js/sdk';
import {
  A2ABroker,
  AgentChannel,
  nodeMessagePortEndpoint,
  ServiceCallError,
} from '@arlo/a2a-transport';
import { JSON_RPC_ERROR_CODES, type RendererEventChannel } from '@arlo/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentStore,
  DATABASE_FILE_NAME,
  openDatabase,
  registerDbServices,
  UnmanagedDatabaseError,
  type ArloDatabase,
} from '../src/main/db/index.js';

const migrationsFolder = join(import.meta.dirname, '../src/main/db/migrations');

let dir: string;
const opened: ArloDatabase[] = [];

function open(path = join(dir, DATABASE_FILE_NAME)): ArloDatabase {
  const database = openDatabase(path, { migrationsFolder });
  opened.push(database);
  return database;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arlo-db-'));
});

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
  rmSync(dir, { recursive: true, force: true });
});

function taskJson(id: string, contextId: string, state: string, parts?: unknown[]) {
  return Task.toJSON(
    Task.fromJSON({
      id,
      contextId,
      status: {
        state,
        timestamp: '2026-09-16T10:00:00.000Z',
        ...(parts === undefined ? {} : { message: { messageId: 'm1', role: 'ROLE_AGENT', parts } }),
      },
    }),
  ) as Record<string, never>;
}

describe('opening the database', () => {
  it('uses WAL and creates the core tables and indexes', () => {
    const { sqlite } = open(join(dir, 'nested', 'profile', DATABASE_FILE_NAME));

    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    const names = (type: string) =>
      (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
          )
          .all(type) as {
          name: string;
        }[]
      ).map((row) => row.name);
    expect(names('table')).toEqual([
      '__drizzle_migrations',
      'a2a_tasks',
      'delegations',
      'messages',
      'notifications',
      'personas',
      'provider_profiles',
      'run_states',
      'secrets',
      'threads',
      'trace_spans',
    ]);
    expect(names('index')).toEqual(
      expect.arrayContaining([
        'a2a_tasks_context_idx',
        'messages_thread_seq_idx',
        'messages_created_idx',
        'notifications_pending_idx',
        'threads_recent_idx',
        'trace_spans_created_idx',
      ]),
    );
  });

  it('keeps data across restarts and does not re-run applied migrations', () => {
    const first = open();
    new AgentStore(first).addSessionItems('persona:research-analyst', 'user:research-analyst', [
      { role: 'user', content: 'remember me' },
    ]);
    first.close();

    const second = open();
    const migrations = second.sqlite
      .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
      .get() as {
      count: number;
    };

    expect(migrations.count).toBe(1);
    expect(
      new AgentStore(second).getSessionItems('persona:research-analyst', 'user:research-analyst'),
    ).toEqual([{ role: 'user', content: 'remember me' }]);
  });

  it('closes the connection when migrations cannot be read', () => {
    expect(() =>
      openDatabase(join(dir, 'broken.db'), { migrationsFolder: join(dir, 'missing') }),
    ).toThrow();
    // The file is not left locked: it can be reopened normally.
    expect(open(join(dir, 'broken.db')).sqlite.open).toBe(true);
  });

  it('refuses a database with tables but no migration history, without changing it', () => {
    const path = join(dir, 'prototype.db');
    const prototype = new Database(path);
    prototype.exec('CREATE TABLE a2a_tasks (id TEXT PRIMARY KEY); CREATE TABLE personas (id TEXT)');
    prototype.close();

    expect(() => open(path)).toThrow(UnmanagedDatabaseError);
    expect(() => open(path)).toThrow(
      `${path} already has tables (a2a_tasks, personas) but no migration history`,
    );
    const after = new Database(path, { readonly: true });
    try {
      const tables = after.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      expect(tables).toEqual([{ name: 'a2a_tasks' }, { name: 'personas' }]);
    } finally {
      after.close();
    }

    // A failed migration run can leave an empty history table behind; that is still unmanaged.
    const halfMigrated = new Database(path);
    halfMigrated.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT)');
    halfMigrated.close();
    expect(() => open(path)).toThrow(UnmanagedDatabaseError);
  });
});

describe('AgentStore', () => {
  let database: ArloDatabase;
  let clock: number;
  let events: [RendererEventChannel, unknown][];
  let warnings: string[];
  let store: AgentStore;

  beforeEach(() => {
    database = open(':memory:');
    clock = Date.parse('2026-09-16T10:00:00.000Z');
    events = [];
    warnings = [];
    store = new AgentStore(database, {
      now: () => clock,
      emit: (channel, payload) => events.push([channel, payload]),
      onWarning: (message) => warnings.push(message),
    });
  });

  it('appends, limits, pops, and clears Thread history in order', () => {
    const agent = 'persona:research-analyst';
    const thread = 'user:research-analyst';
    store.addSessionItems(agent, thread, [{ n: 1 }, { n: 2 }]);
    clock += 1000;
    store.addSessionItems(agent, thread, [{ n: 3 }]);

    expect(store.getSessionItems(agent, thread)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(store.getSessionItems(agent, thread, 2)).toEqual([{ n: 2 }, { n: 3 }]);
    expect(store.popSessionItem(agent, thread)).toEqual({ n: 3 });
    store.addSessionItems(agent, thread, [{ n: 4 }]);
    expect(store.getSessionItems(agent, thread)).toEqual([{ n: 1 }, { n: 2 }, { n: 4 }]);

    store.clearSession(agent, thread);
    expect(store.getSessionItems(agent, thread)).toEqual([]);
    expect(store.popSessionItem(agent, thread)).toBeNull();

    const threadEvents = events.filter(([channel]) => channel === 'state/thread');
    expect(threadEvents).toHaveLength(5);
    expect(threadEvents[1]).toEqual([
      'state/thread',
      { agentId: agent, contextId: thread, updatedAt: '2026-09-16T10:00:01.000Z' },
    ]);
    const row = database.sqlite.prepare('SELECT created_at, updated_at FROM threads').get();
    expect(row).toEqual({ created_at: Date.parse('2026-09-16T10:00:00.000Z'), updated_at: clock });
  });

  it('keeps each Agent and Thread separate', () => {
    store.addSessionItems('persona:a', 'shared-context', [{ from: 'a' }]);
    store.addSessionItems('persona:b', 'shared-context', [{ from: 'b' }]);
    store.addSessionItems('persona:a', 'other-context', [{ from: 'a2' }]);
    store.saveTask('persona:a', taskJson('task-1', 'ctx', 'TASK_STATE_WORKING'));
    store.saveRunState('persona:a', 'task-1', 'state-a');

    expect(store.getSessionItems('persona:b', 'shared-context')).toEqual([{ from: 'b' }]);
    expect(store.getSessionItems('persona:a', 'shared-context')).toEqual([{ from: 'a' }]);
    expect(store.loadTask('persona:b', 'task-1')).toBeNull();
    expect(store.loadRunState('orchestrator', 'task-1')).toBeNull();
    store.deleteRunState('persona:b', 'task-1');
    expect(store.loadRunState('persona:a', 'task-1')).toBe('state-a');
  });

  it('upserts Tasks, indexes their state, and reports changes', () => {
    const agent = 'persona:research-analyst';
    const working = taskJson('task-1', 'ctx-1', 'TASK_STATE_WORKING');
    store.saveTask(agent, working);
    clock += 500;
    const waiting = taskJson('task-1', 'ctx-1', 'TASK_STATE_INPUT_REQUIRED', [
      { text: 'Need to log in' },
      { data: { type: 'auth_required', site: 'github.com', reason: 'login' } },
    ]);
    store.saveTask(agent, waiting);

    expect(store.loadTask(agent, 'task-1')).toEqual(waiting);
    expect(
      database.sqlite.prepare('SELECT state, created_at, updated_at FROM a2a_tasks').all(),
    ).toEqual([{ state: 'input-required', created_at: clock - 500, updated_at: clock }]);
    expect(events).toEqual([
      [
        'state/task',
        {
          agentId: agent,
          taskId: 'task-1',
          contextId: 'ctx-1',
          state: 'working',
          updatedAt: '2026-09-16T10:00:00.000Z',
        },
      ],
      [
        'state/task',
        {
          agentId: agent,
          taskId: 'task-1',
          contextId: 'ctx-1',
          state: 'input-required',
          interrupt: { type: 'auth_required', site: 'github.com', reason: 'login' },
          updatedAt: '2026-09-16T10:00:00.500Z',
        },
      ],
    ]);
  });

  it('stores Tasks it cannot report and says why', () => {
    store.saveTask(
      'persona:x',
      taskJson('task-2', 'ctx', 'TASK_STATE_INPUT_REQUIRED', [{ text: 'no payload' }]),
    );
    store.saveTask('persona:x', { id: 'task-3', contextId: 'ctx' });

    expect(store.loadTask('persona:x', 'task-2')).not.toBeNull();
    expect(store.loadTask('persona:x', 'task-3')).toEqual({ id: 'task-3', contextId: 'ctx' });
    expect(events).toEqual([]);
    expect(warnings).toEqual([
      'Task task-2 of persona:x is input-required without an interrupt payload.',
    ]);
  });

  it('rejects a Task without ids', () => {
    expect(() => store.saveTask('persona:x', { contextId: 'ctx' })).toThrow(
      'A Task needs an id and a contextId.',
    );
    expect(() => store.saveTask('persona:x', { id: 't', contextId: 'c'.repeat(513) })).toThrow(
      'A Task needs an id and a contextId.',
    );
  });

  it('replaces and deletes RunStates', () => {
    store.saveRunState('persona:x', 'task-1', 'v1');
    clock += 10;
    store.saveRunState('persona:x', 'task-1', 'v2');

    expect(store.loadRunState('persona:x', 'task-1')).toBe('v2');
    store.deleteRunState('persona:x', 'task-1');
    expect(store.loadRunState('persona:x', 'task-1')).toBeNull();
  });
});

describe('db/* over the Agent port', () => {
  it('lets an Agent persist only through service calls scoped to its own port', async () => {
    const database = open();
    const events: string[] = [];
    const store = new AgentStore(database, { emit: (channel) => events.push(channel) });
    const broker = new A2ABroker();
    registerDbServices(broker, store);

    const channels: AgentChannel[] = [];
    const connect = (agentId: 'orchestrator' | `persona:${string}`) => {
      const { port1, port2 } = new MessageChannel();
      broker.attach(agentId, nodeMessagePortEndpoint(port1));
      const channel = new AgentChannel(agentId, nodeMessagePortEndpoint(port2));
      channels.push(channel);
      return channel;
    };

    try {
      const persona = connect('persona:research-analyst');
      const orchestrator = connect('orchestrator');
      const task = taskJson('task-9', 'orchestrator:ctx-1', 'TASK_STATE_COMPLETED');

      await persona.callService('db/session.addItems', {
        contextId: 'orchestrator:ctx-1',
        items: [{ role: 'user', content: 'Collect sources' }],
      });
      await persona.callService('db/tasks.save', { task });
      await persona.callService('db/runStates.save', { taskId: 'task-9', state: '{"v":1}' });

      expect(
        await persona.callService('db/session.getItems', {
          contextId: 'orchestrator:ctx-1',
          limit: 5,
        }),
      ).toEqual({
        items: [{ role: 'user', content: 'Collect sources' }],
      });
      expect(
        await persona.callService('db/session.popItem', { contextId: 'orchestrator:ctx-1' }),
      ).toEqual({
        item: { role: 'user', content: 'Collect sources' },
      });
      expect(await persona.callService('db/tasks.load', { taskId: 'task-9' })).toEqual({ task });
      expect(await persona.callService('db/runStates.load', { taskId: 'task-9' })).toEqual({
        state: '{"v":1}',
      });
      // The same ids from another Agent's port find nothing.
      expect(await orchestrator.callService('db/tasks.load', { taskId: 'task-9' })).toEqual({
        task: null,
      });
      expect(await orchestrator.callService('db/runStates.load', { taskId: 'task-9' })).toEqual({
        state: null,
      });

      await persona.callService('db/runStates.delete', { taskId: 'task-9' });
      await persona.callService('db/session.clear', { contextId: 'orchestrator:ctx-1' });
      expect(await persona.callService('db/runStates.load', { taskId: 'task-9' })).toEqual({
        state: null,
      });

      const invalid = await persona
        .callService('db/tasks.save', { task: { status: {} } })
        .catch((error: unknown) => error);
      expect(invalid).toBeInstanceOf(ServiceCallError);
      expect((invalid as ServiceCallError).error).toEqual({
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        message: 'A Task needs an id and a contextId.',
      });

      expect(events).toEqual(['state/thread', 'state/task', 'state/thread', 'state/thread']);
      const rows = database.sqlite.prepare('SELECT agent_id FROM a2a_tasks').all();
      expect(rows).toEqual([{ agent_id: 'persona:research-analyst' }]);
    } finally {
      for (const channel of channels) channel.close();
    }
  });
});
