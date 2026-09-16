import type { A2ABroker } from '@arlo/a2a-transport';
import type { AgentStore } from './agent-store.js';

/**
 * Serves the `db/*` part of the Agent service contract from the store
 * (ADR-0011 §2). The broker supplies `agentId` from the calling port.
 * `trace/spans.export` belongs to tracing (T13).
 */
export function registerDbServices(
  broker: Pick<A2ABroker, 'handleService'>,
  store: AgentStore,
): void {
  broker.handleService('db/session.getItems', ({ agentId, params }) => ({
    items: store.getSessionItems(agentId, params.contextId, params.limit),
  }));
  broker.handleService('db/session.addItems', ({ agentId, params }) => {
    store.addSessionItems(agentId, params.contextId, params.items);
    return null;
  });
  broker.handleService('db/session.popItem', ({ agentId, params }) => ({
    item: store.popSessionItem(agentId, params.contextId),
  }));
  broker.handleService('db/session.clear', ({ agentId, params }) => {
    store.clearSession(agentId, params.contextId);
    return null;
  });
  broker.handleService('db/tasks.save', ({ agentId, params }) => {
    store.saveTask(agentId, params.task);
    return null;
  });
  broker.handleService('db/tasks.load', ({ agentId, params }) => ({
    task: store.loadTask(agentId, params.taskId),
  }));
  broker.handleService('db/runStates.save', ({ agentId, params }) => {
    store.saveRunState(agentId, params.taskId, params.state);
    return null;
  });
  broker.handleService('db/runStates.load', ({ agentId, params }) => ({
    state: store.loadRunState(agentId, params.taskId),
  }));
  broker.handleService('db/runStates.delete', ({ agentId, params }) => {
    store.deleteRunState(agentId, params.taskId);
    return null;
  });
}
