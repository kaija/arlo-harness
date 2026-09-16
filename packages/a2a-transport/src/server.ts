import {
  JsonRpcTransportHandler,
  ServerCallContext,
  UnauthenticatedUser,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
import type { A2AEndpoint, JsonRpcError, JsonRpcResponse } from '@arlo/shared';
import type { RequestEnvelope, ServerLink } from './link.js';

const CALLER_STATE_KEY = 'arlo.a2a.caller';

/**
 * Who sent the request: the Orchestrator, a Persona, or a `system:*` origin.
 * Main stamps and verifies `from` before routing (ADR-0004 §4), so executors
 * can rely on it, for example to check who may answer an interrupt (ADR-0010).
 */
export function callerOf(context: ServerCallContext): A2AEndpoint | undefined {
  return context.state.get(CALLER_STATE_KEY) as A2AEndpoint | undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | null)?.[Symbol.asyncIterator] === 'function';
}

function errorResponse(request: RequestEnvelope, error: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: request.payload.id ?? null,
    // ErrorDetail entries are plain JSON objects.
    error: JsonRpcTransportHandler.mapToJSONRPCError(error) as JsonRpcError,
  };
}

export interface MessagePortA2AServerOptions {
  /** Called when a response cannot be produced, e.g. the handler threw mid-stream. */
  onError?: (error: unknown, request: RequestEnvelope) => void;
}

/**
 * Serves A2A JSON-RPC on an Agent's port with the SDK's
 * `JsonRpcTransportHandler` and the Agent's `DefaultRequestHandler`
 * (ADR-0004 §2). Unary results go back as one `a2a-response`. Streams go back
 * as `stream-event` frames closed by `stream-end`; an error before the first
 * event is sent as an `a2a-response`, like the SDK's HTTP binding does.
 *
 * Tasks are not scoped per caller: a user answering an interrupt must be able
 * to continue a Task the Orchestrator started (ADR-0010 §2).
 */
export class MessagePortA2AServer {
  readonly #link: ServerLink;
  readonly #handler: JsonRpcTransportHandler;
  readonly #options: MessagePortA2AServerOptions;
  readonly #stop: () => void;

  constructor(
    link: ServerLink,
    requestHandler: A2ARequestHandler,
    options: MessagePortA2AServerOptions = {},
  ) {
    this.#link = link;
    this.#handler = new JsonRpcTransportHandler(requestHandler);
    this.#options = options;
    this.#stop = link.serve((request) => {
      void this.#handle(request);
    });
  }

  close(): void {
    this.#stop();
  }

  async #handle(request: RequestEnvelope): Promise<void> {
    const link = this.#link;
    const frame = { requestId: request.requestId, from: link.self, to: request.from };
    const context = new ServerCallContext({
      user: new UnauthenticatedUser(),
      state: new Map([[CALLER_STATE_KEY, request.from]]),
    });

    let result: unknown;
    try {
      result = await this.#handler.handle(request.payload, context);
    } catch (error) {
      this.#options.onError?.(error, request);
      link.sendFrame({ ...frame, kind: 'a2a-response', payload: errorResponse(request, error) });
      return;
    }
    if (!isAsyncIterable(result)) {
      link.sendFrame({ ...frame, kind: 'a2a-response', payload: result as JsonRpcResponse });
      return;
    }

    const iterator = result[Symbol.asyncIterator]();
    let next: IteratorResult<unknown>;
    try {
      next = await iterator.next();
    } catch (error) {
      link.sendFrame({ ...frame, kind: 'a2a-response', payload: errorResponse(request, error) });
      return;
    }
    try {
      while (next.done !== true) {
        link.sendFrame({ ...frame, kind: 'stream-event', payload: next.value as JsonRpcResponse });
        next = await iterator.next();
      }
    } catch (error) {
      this.#options.onError?.(error, request);
      link.sendFrame({ ...frame, kind: 'stream-event', payload: errorResponse(request, error) });
    } finally {
      link.sendFrame({ ...frame, kind: 'stream-end' });
    }
  }
}
