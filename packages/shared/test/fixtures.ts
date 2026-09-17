import type { A2AEnvelope } from '../src/a2a.js';
import type { AgentServiceMethod, ControlMessage } from '../src/agent-channel.js';
import type { BusEvent, BusEventType } from '../src/events.js';
import type { RendererEventChannel, RendererInvokeChannel } from '../src/renderer-api.js';

/**
 * One valid sample per contract entry. Tests require a fixture for every
 * method, channel, and event type, so adding a contract entry without a
 * sample (and therefore without a serialization check) fails CI.
 */

const now = '2026-09-16T09:30:00.000Z';

export const agentServiceFixtures: Record<
  AgentServiceMethod,
  { params: unknown; result: unknown }
> = {
  'db/session.getItems': {
    params: { contextId: 'user:research-analyst', limit: 20 },
    result: { items: [{ role: 'user', content: 'hi' }] },
  },
  'db/session.addItems': {
    params: {
      contextId: 'user:research-analyst',
      items: [{ role: 'assistant', content: 'hello' }],
    },
    result: null,
  },
  'db/session.popItem': {
    params: { contextId: 'user:research-analyst' },
    result: { item: null },
  },
  'db/session.clear': { params: { contextId: 'user:research-analyst' }, result: null },
  'db/tasks.save': {
    params: { task: { id: 'task-1', contextId: 'ctx-1', status: { state: 'working' } } },
    result: null,
  },
  'db/tasks.load': { params: { taskId: 'task-1' }, result: { task: null } },
  'db/runStates.save': {
    params: { taskId: 'task-1', state: '{"$schemaVersion":"1"}' },
    result: null,
  },
  'db/runStates.load': { params: { taskId: 'task-1' }, result: { state: null } },
  'db/runStates.delete': { params: { taskId: 'task-1' }, result: null },
  'trace/spans.export': {
    params: { spans: [{ spanId: 'span-1', traceId: 'trace-1', type: 'function' }] },
    result: null,
  },
  'registry/list': {
    params: {},
    result: {
      cards: [
        { agentId: 'persona:research-analyst', card: { name: 'Research Analyst', skills: [] } },
      ],
    },
  },
};

export const rendererInvokeFixtures: Record<
  RendererInvokeChannel,
  { params: unknown; result: unknown }
> = {
  'personas/setEnabled': {
    params: { personaId: 'research-analyst', enabled: false },
    result: null,
  },
  'personas/delete': { params: { personaId: 'research-analyst' }, result: null },
  'messages/send': {
    params: {
      agentId: 'persona:research-analyst',
      contextId: 'user:research-analyst',
      text: 'Summarize today’s news',
      mode: 'async',
    },
    result: { taskId: 'task-1', contextId: 'user:research-analyst' },
  },
  'tasks/cancel': {
    params: { agentId: 'persona:research-analyst', taskId: 'task-1' },
    result: null,
  },
  'interrupts/answer': {
    params: {
      agentId: 'persona:research-analyst',
      taskId: 'task-1',
      answer: { type: 'approval', decision: 'reject', note: 'Wrong recipient' },
    },
    result: null,
  },
  'secrets/set': {
    params: { ref: 'openai-main', value: 'sk-test-1234' },
    result: { ref: 'openai-main', last4: '1234', updatedAt: now },
  },
  'secrets/list': {
    params: {},
    result: { secrets: [{ ref: 'openai-main', last4: '1234', updatedAt: now }] },
  },
  'secrets/delete': { params: { ref: 'openai-main' }, result: null },
  'windows/showPersona': {
    params: { personaId: 'research-analyst', contextId: 'orchestrator:ctx-1' },
    result: null,
  },
  'windows/showMain': { params: { taskId: 'task-1' }, result: null },
};

export const rendererEventFixtures: Record<RendererEventChannel, unknown> = {
  'state/agentStatus': { agentId: 'orchestrator', status: 'running' },
  'state/task': {
    agentId: 'persona:research-analyst',
    taskId: 'task-1',
    contextId: 'orchestrator:ctx-1',
    state: 'input-required',
    interrupt: { type: 'auth_required', site: 'github.com', reason: 'login' },
    updatedAt: now,
  },
  'state/thread': {
    agentId: 'persona:research-analyst',
    contextId: 'user:research-analyst',
    updatedAt: now,
  },
};

const eventBase = { id: 'evt-1', occurredAt: now, chainDepth: 0 };

export const busEventFixtures: { [T in BusEventType]: Extract<BusEvent, { type: T }> } = {
  'task.completed': {
    ...eventBase,
    type: 'task.completed',
    payload: { agentId: 'persona:research-analyst', taskId: 'task-1', contextId: 'ctx-1' },
  },
  'task.failed': {
    ...eventBase,
    type: 'task.failed',
    payload: {
      agentId: 'persona:research-analyst',
      taskId: 'task-1',
      contextId: 'ctx-1',
      error: 'Agent process exited unexpectedly',
    },
  },
  'task.input_required': {
    ...eventBase,
    type: 'task.input_required',
    payload: {
      agentId: 'persona:research-analyst',
      taskId: 'task-1',
      contextId: 'ctx-1',
      interrupt: { type: 'question', question: 'Which date range?' },
    },
  },
  'persona.started': {
    ...eventBase,
    type: 'persona.started',
    payload: { agentId: 'persona:research-analyst', restartAttempt: 1 },
  },
  'persona.crashed': {
    ...eventBase,
    type: 'persona.crashed',
    payload: { agentId: 'orchestrator', exitCode: null, restartAttempt: 3, willRestart: false },
  },
  'notification.created': {
    ...eventBase,
    type: 'notification.created',
    payload: {
      notificationId: 'ntf-1',
      severity: 'action_required',
      source: 'persona:research-analyst',
      title: 'Approval needed',
    },
  },
  'schedule.fired': {
    ...eventBase,
    type: 'schedule.fired',
    payload: {
      scheduleId: 'daily-news',
      runId: 'run-7',
      agentId: 'persona:research-analyst',
      contextId: 'schedule:daily-news:run-7',
    },
  },
  'webhook.received': {
    ...eventBase,
    type: 'webhook.received',
    chainDepth: 2,
    causedBy: 'evt-0',
    payload: { agentId: 'persona:research-analyst', body: { ref: 'refs/heads/main', commits: 3 } },
  },
};

export const envelopeFixtures: { [K in A2AEnvelope['kind']]: Extract<A2AEnvelope, { kind: K }> } = {
  'a2a-request': {
    kind: 'a2a-request',
    requestId: 'req-1',
    from: 'orchestrator',
    to: 'persona:research-analyst',
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }] } },
    },
  },
  'a2a-response': {
    kind: 'a2a-response',
    requestId: 'req-1',
    from: 'persona:research-analyst',
    to: 'orchestrator',
    payload: { jsonrpc: '2.0', id: 1, result: { id: 'task-1', status: { state: 'submitted' } } },
  },
  'stream-event': {
    kind: 'stream-event',
    requestId: 'req-2',
    from: 'persona:research-analyst',
    to: 'system:schedule',
    payload: { jsonrpc: '2.0', id: 2, error: { code: -32001, message: 'Task not found' } },
  },
  'stream-end': {
    kind: 'stream-end',
    requestId: 'req-2',
    from: 'persona:research-analyst',
    to: 'system:schedule',
  },
};

export const controlFixtures: {
  [T in ControlMessage['type']]: Extract<ControlMessage, { type: T }>;
} = {
  'provider/configure': {
    kind: 'control',
    type: 'provider/configure',
    binding: { providerId: 'ollama', model: 'qwen3', settings: { temperature: 0.2 } },
    profile: {
      id: 'ollama',
      name: 'Local Ollama',
      apiType: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyRef: 'ollama-key',
      capabilities: { realtime: false, transcription: false },
    },
    apiKey: 'ollama',
  },
  'registry/updated': { kind: 'control', type: 'registry/updated' },
};
