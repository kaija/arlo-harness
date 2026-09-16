import { randomUUID } from 'node:crypto';
import {
  agentServiceContract,
  JSON_RPC_ERROR_CODES,
  mainToAgentMessageSchema,
  parseResult,
  validateCall,
  type AgentId,
  type AgentServiceMethod,
  type ContractParams,
  type ContractResult,
  type ControlMessage,
  type JsonRpcError,
} from '@arlo/shared';
import type { RequestEnvelope, RequesterLink, ResponseFrame, ServerLink } from './link.js';
import type { PortEndpoint } from './port.js';

type Service = typeof agentServiceContract;

/** A main-side service call that failed; carries the JSON-RPC error main sent. */
export class ServiceCallError extends Error {
  readonly error: JsonRpcError;

  constructor(method: string, error: JsonRpcError) {
    super(`${method} failed: ${error.message}`);
    this.name = 'ServiceCallError';
    this.error = error;
  }
}

export interface AgentChannelOptions {
  /** Reports messages that break the protocol; they are dropped. */
  onProtocolError?: (error: Error) => void;
}

interface PendingServiceCall {
  method: AgentServiceMethod;
  resolve(result: unknown): void;
  reject(error: Error): void;
}

const CHANNEL_CLOSED: JsonRpcError = {
  code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
  message: 'The Agent port to main closed.',
};

/**
 * The Agent side of its single MessagePort to main (ADR-0002 §2). It splits
 * traffic by kind: A2A requests go to the served A2A server, A2A response
 * frames to the client that sent the request, `service-response` to pending
 * `callService` calls (ADR-0011 §2), and control messages to listeners.
 */
export class AgentChannel implements RequesterLink, ServerLink {
  readonly self: AgentId;
  readonly #port: PortEndpoint;
  readonly #options: AgentChannelOptions;
  readonly #responseHandlers = new Map<string, (frame: ResponseFrame) => void>();
  readonly #serviceCalls = new Map<string, PendingServiceCall>();
  readonly #controlListeners = new Set<(message: ControlMessage) => void>();
  readonly #dispose: (() => void)[];
  #requestHandler: ((request: RequestEnvelope) => void) | undefined;
  #closed = false;

  constructor(agentId: AgentId, port: PortEndpoint, options: AgentChannelOptions = {}) {
    this.self = agentId;
    this.#port = port;
    this.#options = options;
    this.#dispose = [
      port.onMessage((message) => this.#receive(message)),
      port.onClose(() => this.#shutdown()),
    ];
  }

  get closed(): boolean {
    return this.#closed;
  }

  sendRequest(request: RequestEnvelope): void {
    this.#post(request);
  }

  onResponse(requestId: string, handler: (frame: ResponseFrame) => void): () => void {
    if (this.#closed) {
      queueMicrotask(() => handler(this.#closedResponse(requestId)));
      return () => {};
    }
    this.#responseHandlers.set(requestId, handler);
    return () => {
      if (this.#responseHandlers.get(requestId) === handler)
        this.#responseHandlers.delete(requestId);
    };
  }

  sendFrame(frame: ResponseFrame): void {
    this.#post(frame);
  }

  serve(handler: (request: RequestEnvelope) => void): () => void {
    if (this.#requestHandler !== undefined) {
      throw new Error(`${this.self} already has an A2A server.`);
    }
    this.#requestHandler = handler;
    return () => {
      if (this.#requestHandler === handler) this.#requestHandler = undefined;
    };
  }

  onControl(listener: (message: ControlMessage) => void): () => void {
    this.#controlListeners.add(listener);
    return () => this.#controlListeners.delete(listener);
  }

  /** Calls a main service such as `db/session.addItems`; params are checked before sending. */
  callService<M extends AgentServiceMethod>(
    method: M,
    params: ContractParams<Service, M>,
  ): Promise<ContractResult<Service, M>> {
    if (this.#closed) return Promise.reject(new ServiceCallError(method, CHANNEL_CLOSED));
    const call = validateCall(agentServiceContract, method, params);
    if (!call.ok) return Promise.reject(new ServiceCallError(method, call.error));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.#serviceCalls.set(requestId, {
        method,
        resolve: resolve as (result: unknown) => void,
        reject,
      });
      this.#post({ kind: 'service-request', requestId, method, params: call.params });
    });
  }

  close(): void {
    this.#port.close();
    this.#shutdown();
  }

  #post(message: unknown): void {
    if (!this.#closed) this.#port.postMessage(message);
  }

  #receive(raw: unknown): void {
    const parsed = mainToAgentMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.#options.onProtocolError?.(new Error('Dropped a malformed message from main.'));
      return;
    }
    const message = parsed.data;
    switch (message.kind) {
      case 'a2a-request':
        if (message.to !== this.self || this.#requestHandler === undefined) {
          this.#options.onProtocolError?.(
            new Error(`Dropped an A2A request for ${message.to} with no server on ${this.self}.`),
          );
          return;
        }
        this.#requestHandler(message);
        return;
      case 'a2a-response':
      case 'stream-event':
      case 'stream-end': {
        // Frames for an aborted request arrive until the target finishes; drop them quietly.
        this.#responseHandlers.get(message.requestId)?.(message);
        return;
      }
      case 'service-response': {
        const call = this.#serviceCalls.get(message.requestId);
        if (call === undefined) return;
        this.#serviceCalls.delete(message.requestId);
        if ('error' in message) {
          call.reject(new ServiceCallError(call.method, message.error));
          return;
        }
        try {
          call.resolve(parseResult(agentServiceContract, call.method, message.result));
        } catch {
          call.reject(
            new ServiceCallError(call.method, {
              code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
              message: 'Main returned a result that does not match the contract.',
            }),
          );
        }
        return;
      }
      case 'control':
        for (const listener of this.#controlListeners) listener(message);
        return;
    }
  }

  #closedResponse(requestId: string): ResponseFrame {
    return {
      kind: 'a2a-response',
      requestId,
      // Delivered locally only; the Agent answers for itself because main is gone.
      from: this.self,
      to: this.self,
      payload: { jsonrpc: '2.0', id: null, error: CHANNEL_CLOSED },
    };
  }

  #shutdown(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const dispose of this.#dispose) dispose();
    for (const [requestId, handler] of this.#responseHandlers) {
      handler(this.#closedResponse(requestId));
    }
    this.#responseHandlers.clear();
    for (const call of this.#serviceCalls.values()) {
      call.reject(new ServiceCallError(call.method, CHANNEL_CLOSED));
    }
    this.#serviceCalls.clear();
    this.#requestHandler = undefined;
    this.#controlListeners.clear();
  }
}
