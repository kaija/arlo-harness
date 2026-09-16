import type { A2AEndpoint, A2AEnvelope, AgentId } from '@arlo/shared';

export type RequestEnvelope = Extract<A2AEnvelope, { kind: 'a2a-request' }>;
export type ResponseFrame = Exclude<A2AEnvelope, RequestEnvelope>;

/**
 * Something that can start A2A requests and receive their response frames:
 * an Agent's port on the Agent side, or a system origin inside main.
 */
export interface RequesterLink {
  readonly self: A2AEndpoint;
  sendRequest(request: RequestEnvelope): void;
  /** Routes frames for `requestId` to `handler` until the returned function is called. */
  onResponse(requestId: string, handler: (frame: ResponseFrame) => void): () => void;
}

/** The Agent side of a port, as seen by the A2A server. */
export interface ServerLink {
  readonly self: AgentId;
  sendFrame(frame: ResponseFrame): void;
  /** Receives requests addressed to this Agent. Returns a function that stops serving. */
  serve(handler: (request: RequestEnvelope) => void): () => void;
}
