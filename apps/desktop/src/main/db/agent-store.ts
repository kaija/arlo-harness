import { ServiceError, summarizeTaskJson } from '@arlo/a2a-transport';
import {
  JSON_RPC_ERROR_CODES,
  opaqueIdSchema,
  parseRendererEvent,
  type AgentId,
  type JsonObject,
  type RendererEventChannel,
  type RendererEventPayload,
} from '@arlo/shared';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import type { ArloDatabase, ArloDb } from './database.js';
import { a2aTasks, messages, runStates, threads } from './schema.js';

/** Receives `state/*` changes for renderers (ADR-0011 §2); wired to windows by the renderer API (T20). */
export type StateEventSink = <C extends RendererEventChannel>(
  channel: C,
  payload: RendererEventPayload<C>,
) => void;

export interface AgentStoreOptions {
  emit?: StateEventSink;
  now?: () => number;
  /** A saved Task that cannot be reported to renderers, e.g. input-required without a payload. */
  onWarning?: (message: string) => void;
}

type Transaction = Parameters<Parameters<ArloDb['transaction']>[0]>[0];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The storage behind the Agent service contract: Thread history for
 * `IpcSession`, A2A Tasks for `IpcTaskStore`, and RunStates for HITL
 * (ADR-0009, ADR-0004 §6, ADR-0010 §3). Every method takes the calling
 * Agent's id from the port, never from the request, so an Agent only sees
 * its own rows.
 */
export class AgentStore {
  readonly #db: ArloDb;
  readonly #emit: StateEventSink;
  readonly #now: () => number;
  readonly #onWarning: (message: string) => void;

  constructor(database: ArloDatabase, options: AgentStoreOptions = {}) {
    this.#db = database.db;
    this.#emit = options.emit ?? (() => {});
    this.#now = options.now ?? Date.now;
    this.#onWarning = options.onWarning ?? (() => {});
  }

  getSessionItems(agentId: AgentId, contextId: string, limit?: number): JsonObject[] {
    const thread = and(eq(messages.agentId, agentId), eq(messages.contextId, contextId));
    const query = this.#db.select({ itemJson: messages.itemJson }).from(messages).where(thread);
    const rows =
      limit === undefined
        ? query.orderBy(asc(messages.seq)).all()
        : query.orderBy(desc(messages.seq)).limit(limit).all().reverse();
    return rows.map((row) => JSON.parse(row.itemJson) as JsonObject);
  }

  addSessionItems(agentId: AgentId, contextId: string, items: readonly JsonObject[]): void {
    const now = this.#now();
    this.#db.transaction((tx) => {
      const last =
        tx
          .select({ seq: max(messages.seq) })
          .from(messages)
          .where(and(eq(messages.agentId, agentId), eq(messages.contextId, contextId)))
          .get()?.seq ?? 0;
      tx.insert(messages)
        .values(
          items.map((item, index) => ({
            agentId,
            contextId,
            seq: last + index + 1,
            itemJson: JSON.stringify(item),
            createdAt: now,
          })),
        )
        .run();
      this.#touchThread(tx, agentId, contextId, now);
    });
    this.#emitThread(agentId, contextId, now);
  }

  popSessionItem(agentId: AgentId, contextId: string): JsonObject | null {
    const now = this.#now();
    const item = this.#db.transaction((tx) => {
      const row = tx
        .select({ id: messages.id, itemJson: messages.itemJson })
        .from(messages)
        .where(and(eq(messages.agentId, agentId), eq(messages.contextId, contextId)))
        .orderBy(desc(messages.seq))
        .limit(1)
        .get();
      if (row === undefined) return null;
      tx.delete(messages).where(eq(messages.id, row.id)).run();
      this.#touchThread(tx, agentId, contextId, now);
      return JSON.parse(row.itemJson) as JsonObject;
    });
    if (item !== null) this.#emitThread(agentId, contextId, now);
    return item;
  }

  clearSession(agentId: AgentId, contextId: string): void {
    const now = this.#now();
    this.#db.transaction((tx) => {
      tx.delete(messages)
        .where(and(eq(messages.agentId, agentId), eq(messages.contextId, contextId)))
        .run();
      this.#touchThread(tx, agentId, contextId, now);
    });
    this.#emitThread(agentId, contextId, now);
  }

  saveTask(agentId: AgentId, task: JsonObject): void {
    const summary = summarizeTaskJson(task);
    if (
      !opaqueIdSchema.safeParse(summary.taskId).success ||
      !opaqueIdSchema.safeParse(summary.contextId).success
    ) {
      throw new ServiceError(
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'A Task needs an id and a contextId.',
      );
    }
    const now = this.#now();
    const values = {
      contextId: summary.contextId,
      state: summary.state ?? null,
      taskJson: JSON.stringify(task),
      updatedAt: now,
    };
    this.#db
      .insert(a2aTasks)
      .values({ agentId, taskId: summary.taskId, createdAt: now, ...values })
      .onConflictDoUpdate({ target: [a2aTasks.agentId, a2aTasks.taskId], set: values })
      .run();

    if (summary.state === undefined) return;
    if (summary.state === 'input-required' && summary.interrupt === undefined) {
      this.#onWarning(
        `Task ${summary.taskId} of ${agentId} is input-required without an interrupt payload.`,
      );
      return;
    }
    this.#emit(
      'state/task',
      parseRendererEvent('state/task', {
        agentId,
        taskId: summary.taskId,
        contextId: summary.contextId,
        state: summary.state,
        ...(summary.interrupt === undefined ? {} : { interrupt: summary.interrupt }),
        updatedAt: iso(now),
      }),
    );
  }

  loadTask(agentId: AgentId, taskId: string): JsonObject | null {
    const row = this.#db
      .select({ taskJson: a2aTasks.taskJson })
      .from(a2aTasks)
      .where(and(eq(a2aTasks.agentId, agentId), eq(a2aTasks.taskId, taskId)))
      .get();
    return row === undefined ? null : (JSON.parse(row.taskJson) as JsonObject);
  }

  saveRunState(agentId: AgentId, taskId: string, state: string): void {
    const now = this.#now();
    this.#db
      .insert(runStates)
      .values({ agentId, taskId, state, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [runStates.agentId, runStates.taskId],
        set: { state, updatedAt: now },
      })
      .run();
  }

  loadRunState(agentId: AgentId, taskId: string): string | null {
    const row = this.#db
      .select({ state: runStates.state })
      .from(runStates)
      .where(and(eq(runStates.agentId, agentId), eq(runStates.taskId, taskId)))
      .get();
    return row?.state ?? null;
  }

  deleteRunState(agentId: AgentId, taskId: string): void {
    this.#db
      .delete(runStates)
      .where(and(eq(runStates.agentId, agentId), eq(runStates.taskId, taskId)))
      .run();
  }

  #touchThread(tx: Transaction, agentId: AgentId, contextId: string, now: number): void {
    tx.insert(threads)
      .values({ agentId, contextId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [threads.agentId, threads.contextId], set: { updatedAt: now } })
      .run();
  }

  #emitThread(agentId: AgentId, contextId: string, now: number): void {
    this.#emit(
      'state/thread',
      parseRendererEvent('state/thread', { agentId, contextId, updatedAt: iso(now) }),
    );
  }
}
