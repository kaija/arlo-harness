import { randomUUID } from 'node:crypto';
import { formatSSEErrorEvent, formatSSEEvent, SSE_HEADERS, type AgentCard } from '@a2a-js/sdk';
import { Client, ClientFactory, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import {
  agentEndpointUrl,
  agentIdFromEndpointUrl,
  jsonRpcRequestSchema,
  type AgentId,
  type JsonRpcResponse,
} from '@arlo/shared';
import type { RequesterLink } from './link.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function acceptOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('Accept');
}

function sseChunk(payload: JsonRpcResponse): string {
  return 'error' in payload ? formatSSEErrorEvent(payload) : formatSSEEvent(payload);
}

/**
 * A `fetch` that carries the A2A SDK's JSON-RPC HTTP calls over a MessagePort
 * link (ADR-0004 §2). The request body becomes an `a2a-request` envelope; an
 * `a2a-response` becomes a JSON response; `stream-event` frames become an SSE
 * body that ends at `stream-end`. Only `arlo://agents/<agentId>` URLs are
 * accepted, so a card can never make an Agent open a network connection.
 *
 * Aborting stops reading and drops later frames, but does not stop the target:
 * the SDK persists task updates while it drains the stream, so the server
 * keeps draining until the task settles.
 */
export function createMessagePortFetch(link: RequesterLink): typeof fetch {
  return (input, init) => {
    const url = urlOf(input);
    const to = agentIdFromEndpointUrl(url);
    if (to === undefined) {
      return Promise.reject(new TypeError(`Not an Arlo Agent endpoint: ${url}`));
    }
    if (init?.method !== 'POST' || typeof init.body !== 'string') {
      return Promise.reject(new TypeError('Only JSON-RPC POST requests can be sent to an Agent.'));
    }
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      body = undefined;
    }
    const parsed = jsonRpcRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Promise.reject(new TypeError('Request body is not a JSON-RPC request.'));
    }
    const streaming = acceptOf(init) === SSE_HEADERS['Content-Type'];
    if (!streaming && parsed.data.id === undefined) {
      // A notification gets no response, so nothing would ever settle the fetch.
      return Promise.reject(new TypeError('JSON-RPC notifications are not supported.'));
    }
    const { signal } = init;
    if (signal?.aborted) return Promise.reject(signal.reason);

    const requestId = randomUUID();
    const encoder = new TextEncoder();

    return new Promise<Response>((resolve, reject) => {
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;

      const openStream = (): ReadableStreamDefaultController<Uint8Array> => {
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
        const body = new ReadableStream<Uint8Array>({
          start: (c) => {
            controller = c;
          },
          // The SDK stops reading after an error event or when its consumer breaks out.
          cancel: () => dispose(),
        });
        resolve(new Response(body, { status: 200, headers: SSE_HEADERS }));
        return controller as ReadableStreamDefaultController<Uint8Array>;
      };

      const onAbort = (): void => {
        dispose();
        if (stream === undefined) reject(signal?.reason);
        else stream.error(signal?.reason);
      };

      const unsubscribe = link.onResponse(requestId, (frame) => {
        switch (frame.kind) {
          case 'a2a-response':
            dispose();
            if (stream === undefined) {
              resolve(
                new Response(JSON.stringify(frame.payload), { status: 200, headers: JSON_HEADERS }),
              );
            } else {
              // Only the broker answers an open stream this way; surface its error.
              stream.enqueue(encoder.encode(sseChunk(frame.payload)));
              stream.close();
            }
            return;
          case 'stream-event':
            stream ??= openStream();
            stream.enqueue(encoder.encode(sseChunk(frame.payload)));
            return;
          case 'stream-end':
            dispose();
            (stream ?? openStream()).close();
            return;
        }
      });

      function dispose(): void {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      link.sendRequest({
        kind: 'a2a-request',
        requestId,
        from: link.self,
        to,
        payload: parsed.data,
      });
    });
  };
}

/**
 * The A2A SDK client for one Agent, speaking JSON-RPC over `link`
 * (ADR-0004 `MessagePortA2AClient`). The card must point at `agentId`, so a
 * registry entry cannot redirect requests to another Agent.
 */
export async function createA2AClient(
  link: RequesterLink,
  agentId: AgentId,
  card: AgentCard,
): Promise<Client> {
  const expected = agentEndpointUrl(agentId);
  const interfaces = card.supportedInterfaces.filter(
    (candidate) => candidate.protocolBinding === 'JSONRPC',
  );
  if (interfaces.length === 0 || interfaces.some((candidate) => candidate.url !== expected)) {
    throw new Error(
      `Agent Card for ${agentId} must declare only the JSON-RPC endpoint ${expected}.`,
    );
  }
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl: createMessagePortFetch(link) })],
    preferredTransports: ['JSONRPC'],
  });
  return factory.createFromAgentCard(card);
}
