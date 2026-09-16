import { AgentCard } from '@a2a-js/sdk';
import type { Client } from '@a2a-js/sdk/client';
import {
  a2aEnvelopeSchema,
  agentServiceContract,
  agentToMainMessageSchema,
  controlMessageSchema,
  forbiddenRouteError,
  isAgentId,
  isEnvelopeFromPort,
  JSON_RPC_ERROR_CODES,
  jsonObjectSchema,
  ORCHESTRATOR_AGENT_ID,
  parseResult,
  SYSTEM_ORIGINS,
  validateCall,
  type A2AEndpoint,
  type AgentId,
  type AgentServiceMethod,
  type ContractParams,
  type ContractResult,
  type ControlMessage,
  type JsonObject,
  type JsonRpcError,
  type ServiceRequest,
  type SystemOrigin,
} from '@arlo/shared';
import { createA2AClient } from './client.js';
import { ServiceError, TRANSPORT_ERROR_REASONS, transportError } from './errors.js';
import type { RequestEnvelope, RequesterLink, ResponseFrame } from './link.js';
import type { PortEndpoint } from './port.js';

type Service = typeof agentServiceContract;

/** Decides whether `from` may send an A2A request to `to`. */
export type RoutePolicy = (from: A2AEndpoint, to: AgentId) => boolean;

function isSystemOrigin(endpoint: A2AEndpoint): endpoint is SystemOrigin {
  return (SYSTEM_ORIGINS as readonly string[]).includes(endpoint);
}

/**
 * v1 star topology (ADR-0004 §4): the Orchestrator talks to Personas and
 * Personas talk only to the Orchestrator. Main's own origins (user actions,
 * schedules, events) may reach any Agent (ADR-0009 §3).
 */
export const starTopologyPolicy: RoutePolicy = (from, to) => {
  if (isSystemOrigin(from)) return true;
  return from === ORCHESTRATOR_AGENT_ID
    ? to !== ORCHESTRATOR_AGENT_ID
    : to === ORCHESTRATOR_AGENT_ID;
};

export type ServiceHandler<M extends AgentServiceMethod> = (call: {
  /** The Agent that owns the port the call arrived on; params never name one. */
  agentId: AgentId;
  params: ContractParams<Service, M>;
}) => ContractResult<Service, M> | Promise<ContractResult<Service, M>>;

export interface BrokerProtocolError {
  agentId: AgentId;
  message: string;
}

export interface A2ABrokerOptions {
  routePolicy?: RoutePolicy;
  /** Messages dropped for breaking the protocol, such as a Persona posing as another Agent. */
  onProtocolError?: (error: BrokerProtocolError) => void;
  /** Unexpected exceptions from service handlers. The Agent only sees a generic error. */
  onServiceError?: (error: unknown, method: string, agentId: AgentId) => void;
}

interface PendingRequest {
  requester: A2AEndpoint;
  target: AgentId;
  requestId: string;
  jsonRpcId: string | number | null;
  streaming: boolean;
  /** The requester went away; later frames are dropped until the target finishes. */
  orphaned: boolean;
}

function pendingKey(target: AgentId, requester: A2AEndpoint, requestId: string): string {
  return `${target}\n${requester}\n${requestId}`;
}

class SystemLink implements RequesterLink {
  readonly self: SystemOrigin;
  readonly #route: (request: RequestEnvelope) => void;
  readonly #handlers = new Map<string, (frame: ResponseFrame) => void>();

  constructor(self: SystemOrigin, route: (request: RequestEnvelope) => void) {
    this.self = self;
    this.#route = route;
  }

  sendRequest(request: RequestEnvelope): void {
    if (request.from !== this.self)
      throw new Error(`A ${this.self} link cannot send as ${request.from}.`);
    this.#route(request);
  }

  onResponse(requestId: string, handler: (frame: ResponseFrame) => void): () => void {
    this.#handlers.set(requestId, handler);
    return () => {
      if (this.#handlers.get(requestId) === handler) this.#handlers.delete(requestId);
    };
  }

  deliver(frame: ResponseFrame): void {
    this.#handlers.get(frame.requestId)?.(frame);
  }
}

/**
 * Main's A2A broker (ADR-0004 §2). It owns one port per Agent process, routes
 * envelopes by `to` under the route policy, keeps the Agent Card registry,
 * and serves `agentServiceContract` calls scoped to the calling Agent.
 *
 * Every response frame must match a request in flight from the requester to
 * the sender, so an Agent cannot inject answers into someone else's call.
 * When a port closes, callers waiting on that Agent get an error (and open
 * streams an error event plus `stream-end`) instead of hanging.
 */
export class A2ABroker {
  readonly #options: A2ABrokerOptions;
  readonly #policy: RoutePolicy;
  readonly #agents = new Map<AgentId, { port: PortEndpoint; dispose: () => void }>();
  readonly #systemLinks = new Map<SystemOrigin, SystemLink>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #cards = new Map<AgentId, JsonObject>();
  readonly #services = new Map<string, ServiceHandler<AgentServiceMethod>>();

  constructor(options: A2ABrokerOptions = {}) {
    this.#options = options;
    this.#policy = options.routePolicy ?? starTopologyPolicy;
    this.handleService('registry/list', () => ({ cards: this.listAgentCards() }));
  }

  attach(agentId: AgentId, port: PortEndpoint): void {
    if (!isAgentId(agentId)) throw new Error(`Invalid agent id "${agentId}".`);
    if (this.#agents.has(agentId)) throw new Error(`${agentId} is already attached.`);
    const disposeMessage = port.onMessage((message) => this.#receive(agentId, message));
    const disposeClose = port.onClose(() => this.detach(agentId));
    this.#agents.set(agentId, {
      port,
      dispose: () => {
        disposeMessage();
        disposeClose();
      },
    });
  }

  isAttached(agentId: AgentId): boolean {
    return this.#agents.has(agentId);
  }

  /** Forgets an Agent's port (it is not closed here) and fails everything waiting on it. */
  detach(agentId: AgentId): void {
    const agent = this.#agents.get(agentId);
    if (agent === undefined) return;
    this.#agents.delete(agentId);
    agent.dispose();

    for (const [key, pending] of this.#pending) {
      if (pending.target === agentId) {
        this.#pending.delete(key);
        if (pending.orphaned) continue;
        const error = transportError(
          TRANSPORT_ERROR_REASONS.agentDisconnected,
          agentId,
          `${agentId} disconnected before answering.`,
        );
        const frame = { requestId: pending.requestId, from: agentId, to: pending.requester };
        const payload = { jsonrpc: '2.0' as const, id: pending.jsonRpcId, error };
        if (pending.streaming) {
          this.#deliver({ ...frame, kind: 'stream-event', payload });
          this.#deliver({ ...frame, kind: 'stream-end' });
        } else {
          this.#deliver({ ...frame, kind: 'a2a-response', payload });
        }
      } else if (pending.requester === agentId) {
        pending.orphaned = true;
      }
    }
  }

  handleService<M extends AgentServiceMethod>(method: M, handler: ServiceHandler<M>): void {
    if (!Object.hasOwn(agentServiceContract, method))
      throw new Error(`Unknown service "${method}".`);
    this.#services.set(method, handler as unknown as ServiceHandler<AgentServiceMethod>);
  }

  /** Sends a main → Agent control message. Returns false when the Agent is not attached. */
  sendControl(agentId: AgentId, message: ControlMessage): boolean {
    const agent = this.#agents.get(agentId);
    if (agent === undefined) return false;
    agent.port.postMessage(controlMessageSchema.parse(message));
    return true;
  }

  /** Publishes or replaces an Agent Card and tells every Agent to re-read the registry (ADR-0004 §5). */
  setAgentCard(agentId: AgentId, card: AgentCard): void {
    this.#cards.set(agentId, jsonObjectSchema.parse(AgentCard.toJSON(card)));
    this.#announceRegistryUpdate();
  }

  removeAgentCard(agentId: AgentId): void {
    if (this.#cards.delete(agentId)) this.#announceRegistryUpdate();
  }

  getAgentCard(agentId: AgentId): AgentCard | undefined {
    const json = this.#cards.get(agentId);
    return json === undefined ? undefined : AgentCard.fromJSON(json);
  }

  listAgentCards(): { agentId: AgentId; card: JsonObject }[] {
    return [...this.#cards].map(([agentId, card]) => ({ agentId, card }));
  }

  /** The link main uses to send requests as a `system:*` origin. */
  systemLink(origin: SystemOrigin): RequesterLink {
    let link = this.#systemLinks.get(origin);
    if (link === undefined) {
      link = new SystemLink(origin, (request) => this.#routeValidated(request));
      this.#systemLinks.set(origin, link);
    }
    return link;
  }

  /** An A2A client that sends as `origin` to an Agent with a registered card. */
  async createSystemClient(origin: SystemOrigin, agentId: AgentId): Promise<Client> {
    const card = this.getAgentCard(agentId);
    if (card === undefined) throw new Error(`No Agent Card registered for ${agentId}.`);
    return createA2AClient(this.systemLink(origin), agentId, card);
  }

  #announceRegistryUpdate(): void {
    for (const agentId of this.#agents.keys()) {
      this.sendControl(agentId, { kind: 'control', type: 'registry/updated' });
    }
  }

  #protocolError(agentId: AgentId, message: string): void {
    this.#options.onProtocolError?.({ agentId, message });
  }

  #receive(agentId: AgentId, raw: unknown): void {
    const parsed = agentToMainMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.#protocolError(agentId, 'Dropped a malformed message.');
      return;
    }
    const message = parsed.data;
    if (message.kind === 'service-request') {
      void this.#serveCall(agentId, message);
      return;
    }
    if (!isEnvelopeFromPort(agentId, message)) {
      this.#protocolError(
        agentId,
        `Dropped a ${message.kind} claiming to be from ${message.from}.`,
      );
      return;
    }
    if (message.kind === 'a2a-request') {
      this.#routeRequest(message);
    } else {
      this.#routeFrame(message);
    }
  }

  #routeValidated(request: RequestEnvelope): void {
    const parsed = a2aEnvelopeSchema.safeParse(request);
    if (!parsed.success || parsed.data.kind !== 'a2a-request') {
      throw new TypeError('Invalid A2A request envelope.');
    }
    this.#routeRequest(parsed.data);
  }

  #routeRequest(request: RequestEnvelope): void {
    const reply = (error: JsonRpcError): void =>
      this.#deliver({
        kind: 'a2a-response',
        requestId: request.requestId,
        from: request.to,
        to: request.from,
        payload: { jsonrpc: '2.0', id: request.payload.id ?? null, error },
      });

    if (!this.#policy(request.from, request.to)) {
      reply(forbiddenRouteError(request.from, request.to));
      return;
    }
    const target = this.#agents.get(request.to);
    if (target === undefined) {
      reply(
        transportError(
          TRANSPORT_ERROR_REASONS.agentUnavailable,
          request.to,
          `${request.to} is not running.`,
        ),
      );
      return;
    }
    const key = pendingKey(request.to, request.from, request.requestId);
    if (this.#pending.has(key)) {
      reply(
        transportError(
          TRANSPORT_ERROR_REASONS.duplicateRequest,
          request.to,
          `Request ${request.requestId} is already in flight.`,
        ),
      );
      return;
    }
    this.#pending.set(key, {
      requester: request.from,
      target: request.to,
      requestId: request.requestId,
      jsonRpcId: request.payload.id ?? null,
      streaming: false,
      orphaned: false,
    });
    target.port.postMessage(request);
  }

  #routeFrame(frame: ResponseFrame): void {
    const key = pendingKey(frame.from, frame.to, frame.requestId);
    const pending = this.#pending.get(key);
    if (pending === undefined) {
      this.#protocolError(frame.from, `Dropped a ${frame.kind} for no request in flight.`);
      return;
    }
    if (frame.kind === 'stream-event') {
      pending.streaming = true;
    } else {
      this.#pending.delete(key);
    }
    if (!pending.orphaned) this.#deliver(frame);
  }

  #deliver(frame: ResponseFrame): void {
    if (isAgentId(frame.to)) {
      this.#agents.get(frame.to)?.port.postMessage(frame);
    } else {
      this.#systemLinks.get(frame.to)?.deliver(frame);
    }
  }

  async #serveCall(agentId: AgentId, request: ServiceRequest): Promise<void> {
    const respond = (body: { result: unknown } | { error: JsonRpcError }): void => {
      this.#agents.get(agentId)?.port.postMessage({
        kind: 'service-response',
        requestId: request.requestId,
        ...body,
      });
    };
    const call = validateCall(agentServiceContract, request.method, request.params);
    if (!call.ok) {
      respond({ error: call.error });
      return;
    }
    const handler = this.#services.get(call.method);
    if (handler === undefined) {
      respond({
        error: {
          code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          message: `Service "${call.method}" is not available.`,
        },
      });
      return;
    }
    try {
      const result = await handler({ agentId, params: call.params });
      respond({ result: parseResult(agentServiceContract, call.method, result) });
    } catch (error) {
      if (error instanceof ServiceError) {
        respond({ error: error.toJsonRpcError() });
        return;
      }
      this.#options.onServiceError?.(error, call.method, agentId);
      respond({
        error: {
          code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          message: `Service "${call.method}" failed.`,
        },
      });
    }
  }
}
