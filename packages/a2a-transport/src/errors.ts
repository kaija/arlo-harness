import type { AgentId, JsonRpcError, JsonValue } from '@arlo/shared';

/**
 * Broker-generated failures. Like the forbidden-route error, they use a code
 * outside A2A's -32001…-32009 range plus a `data.reason` so a caller never
 * mistakes them for an Agent's own answer.
 */
export const TRANSPORT_ERROR_CODE = -32050;

export const TRANSPORT_ERROR_REASONS = Object.freeze({
  /** The target Agent has no attached port (not started, crashed, or stopped). */
  agentUnavailable: 'agent_unavailable',
  /** The target Agent's port closed before it answered. */
  agentDisconnected: 'agent_disconnected',
  /** The requester reused a request id that is still in flight. */
  duplicateRequest: 'duplicate_request',
});
export type TransportErrorReason =
  (typeof TRANSPORT_ERROR_REASONS)[keyof typeof TRANSPORT_ERROR_REASONS];

export function transportError(
  reason: TransportErrorReason,
  agentId: AgentId,
  message: string,
): JsonRpcError {
  return { code: TRANSPORT_ERROR_CODE, message, data: { reason, agentId } };
}

export function isTransportError(error: JsonRpcError, reason?: TransportErrorReason): boolean {
  const { data } = error;
  return (
    error.code === TRANSPORT_ERROR_CODE &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    (reason === undefined ? typeof data.reason === 'string' : data.reason === reason)
  );
}

/**
 * The JSON-RPC error behind an exception thrown by the A2A SDK client, if any.
 * The SDK maps codes to its own classes (-32003 becomes
 * PushNotificationNotSupportedError) but keeps `envelopeCode` and `data`;
 * stream errors wrap that error in `cause`.
 */
export function jsonRpcErrorOf(error: unknown): JsonRpcError | undefined {
  for (let current = error; typeof current === 'object' && current !== null;) {
    const candidate = current as { envelopeCode?: unknown; message?: unknown; data?: unknown };
    if (typeof candidate.envelopeCode === 'number' && typeof candidate.message === 'string') {
      return {
        code: candidate.envelopeCode,
        message: candidate.message,
        ...(candidate.data === undefined ? {} : { data: candidate.data as JsonValue }),
      };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Thrown by a main-side service handler to send a specific JSON-RPC error to
 * the Agent. Any other exception becomes a generic internal error so storage
 * details (SQL, file paths) do not leak into Agent processes.
 */
export class ServiceError extends Error {
  readonly code: number;
  readonly data: JsonValue | undefined;

  constructor(code: number, message: string, data?: JsonValue) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.data = data;
  }

  toJsonRpcError(): JsonRpcError {
    return {
      code: this.code,
      message: this.message,
      ...(this.data === undefined ? {} : { data: this.data }),
    };
  }
}
