import { MessageChannel, type MessagePort } from 'node:worker_threads';
import {
  AgentCard,
  Message,
  SendMessageRequest,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
  type StreamResponse,
} from '@a2a-js/sdk';
import type { Client } from '@a2a-js/sdk/client';
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type ServerCallContext,
} from '@a2a-js/sdk/server';
import { agentEndpointUrl, type AgentId } from '@arlo/shared';
import {
  A2ABroker,
  AgentChannel,
  arloTaskState,
  callerOf,
  createA2AClient,
  MessagePortA2AServer,
  nodeMessagePortEndpoint,
} from '../src/index.js';

export function testCard(agentId: AgentId): AgentCard {
  return AgentCard.fromJSON({
    name: agentId,
    description: `${agentId} test agent`,
    version: '1.0.0',
    supportedInterfaces: [
      { url: agentEndpointUrl(agentId), protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    ],
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  });
}

function textOfParts(parts: Message['parts'] | undefined): string {
  return (parts ?? [])
    .map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
    .join('');
}

export function userMessage(
  text: string,
  options: { taskId?: string; returnImmediately?: boolean } = {},
): SendMessageRequest {
  return SendMessageRequest.fromJSON({
    message: {
      messageId: crypto.randomUUID(),
      role: 'ROLE_USER',
      parts: [{ text }],
      ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    },
    ...(options.returnImmediately === true ? { configuration: { returnImmediately: true } } : {}),
  });
}

/** A promise the test resolves to let an executor continue. */
export class Gate {
  readonly promise: Promise<void>;
  open: () => void = () => {};

  constructor() {
    this.promise = new Promise((resolve) => {
      this.open = resolve;
    });
  }
}

function statusUpdate(taskId: string, contextId: string, state: string): TaskStatusUpdateEvent {
  return TaskStatusUpdateEvent.fromJSON({
    taskId,
    contextId,
    status: { state, timestamp: new Date().toISOString() },
  });
}

/**
 * Echoes the user's text as an artifact. With `holdTasks` each task waits in
 * `working` until its gate opens; with `fail` execution throws once working.
 */
export class EchoExecutor implements AgentExecutor {
  readonly gates = new Map<string, Gate>();
  readonly callers: unknown[] = [];
  readonly #contexts = new Map<string, string>();
  readonly #canceled = new Set<string>();
  holdTasks = false;
  fail = false;

  async execute(context: RequestContext, bus: ExecutionEventBus): Promise<void> {
    this.callers.push(callerOf(context.context as ServerCallContext));
    this.#contexts.set(context.taskId, context.contextId);
    bus.publish(
      AgentEvent.task(
        context.task ??
          Task.fromJSON({
            id: context.taskId,
            contextId: context.contextId,
            status: { state: 'TASK_STATE_SUBMITTED', timestamp: new Date().toISOString() },
            history: [Message.toJSON(context.userMessage)],
          }),
      ),
    );
    bus.publish(
      AgentEvent.statusUpdate(
        statusUpdate(context.taskId, context.contextId, 'TASK_STATE_WORKING'),
      ),
    );
    if (this.fail) throw new Error('executor exploded');
    if (this.holdTasks) {
      const gate = new Gate();
      this.gates.set(context.taskId, gate);
      await gate.promise;
      if (this.#canceled.has(context.taskId)) return;
    }
    bus.publish(
      AgentEvent.artifactUpdate(
        TaskArtifactUpdateEvent.fromJSON({
          taskId: context.taskId,
          contextId: context.contextId,
          artifact: {
            artifactId: 'echo',
            parts: [{ text: `echo: ${textOfParts(context.userMessage.parts)}` }],
          },
          lastChunk: true,
        }),
      ),
    );
    bus.publish(
      AgentEvent.statusUpdate(
        statusUpdate(context.taskId, context.contextId, 'TASK_STATE_COMPLETED'),
      ),
    );
  }

  async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    this.#canceled.add(taskId);
    bus.publish(
      AgentEvent.statusUpdate(
        statusUpdate(taskId, this.#contexts.get(taskId) ?? '', 'TASK_STATE_CANCELED'),
      ),
    );
    this.gates.get(taskId)?.open();
  }

  /** Resolves once `taskId` (or the only held task) is waiting at its gate. */
  async waitForGate(): Promise<[string, Gate]> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const entry = [...this.gates][0];
      if (entry !== undefined) return entry;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('No task reached its gate.');
  }
}

export interface ConnectedAgent {
  agentId: AgentId;
  mainPort: MessagePort;
  agentPort: MessagePort;
  channel: AgentChannel;
  server: MessagePortA2AServer;
  executor: EchoExecutor;
  taskStore: InMemoryTaskStore;
  protocolErrors: Error[];
}

/** A broker plus Agents joined by real Node MessageChannels, as main and utilityProcesses are. */
export class TestNetwork {
  readonly brokerErrors: string[] = [];
  readonly broker = new A2ABroker({
    onProtocolError: (error) => this.brokerErrors.push(`${error.agentId}: ${error.message}`),
  });
  readonly #ports: MessagePort[] = [];

  connect(agentId: AgentId): ConnectedAgent {
    const { port1: mainPort, port2: agentPort } = new MessageChannel();
    this.#ports.push(mainPort, agentPort);
    this.broker.attach(agentId, nodeMessagePortEndpoint(mainPort));

    const protocolErrors: Error[] = [];
    const channel = new AgentChannel(agentId, nodeMessagePortEndpoint(agentPort), {
      onProtocolError: (error) => protocolErrors.push(error),
    });
    const executor = new EchoExecutor();
    const taskStore = new InMemoryTaskStore();
    const card = testCard(agentId);
    const server = new MessagePortA2AServer(
      channel,
      new DefaultRequestHandler(card, taskStore, executor),
    );
    this.broker.setAgentCard(agentId, card);
    return { agentId, mainPort, agentPort, channel, server, executor, taskStore, protocolErrors };
  }

  client(from: ConnectedAgent, to: AgentId): Promise<Client> {
    return createA2AClient(from.channel, to, testCard(to));
  }

  close(): void {
    for (const port of this.#ports) port.close();
  }
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** `task:working`, `status:completed`, `artifact:echo: hi`, ... */
export function describeEvent(event: StreamResponse): string {
  const payload = event.payload;
  switch (payload?.$case) {
    case 'task':
      return `task:${payload.value.status === undefined ? '?' : arloTaskState(payload.value.status.state)}`;
    case 'statusUpdate':
      return `status:${payload.value.status === undefined ? '?' : arloTaskState(payload.value.status.state)}`;
    case 'artifactUpdate':
      return `artifact:${textOfParts(payload.value.artifact?.parts)}`;
    case 'message':
      return `message:${textOfParts(payload.value.parts)}`;
    default:
      return 'unknown';
  }
}

export function artifactText(task: Task): string {
  return task.artifacts.map((artifact) => textOfParts(artifact.parts)).join('');
}

export function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls until `condition` holds, running `refresh` before each check. Frames
 * cross two ports, so tests wait for what they expect instead of sleeping.
 */
export async function waitUntil(
  condition: () => boolean,
  what: string,
  refresh?: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await refresh?.();
    if (condition()) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}
