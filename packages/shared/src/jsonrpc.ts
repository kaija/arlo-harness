import { z } from 'zod';
import { jsonObjectSchema, jsonValueSchema } from './json.js';

export const JSON_RPC_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

/**
 * Broker rejection of a route outside the v1 star topology (ADR-0004 §4).
 *
 * A2A itself also assigns -32003 (PushNotificationNotSupportedError), so a
 * receiver must check `error.data.reason === 'forbidden_route'` rather than
 * the numeric code alone.
 */
export const FORBIDDEN_ROUTE_ERROR_CODE = -32003;
export const FORBIDDEN_ROUTE_REASON = 'forbidden_route';

const jsonRpcIdSchema = z.union([z.string(), z.int(), z.null()]);

export const jsonRpcErrorSchema = z.strictObject({
  code: z.int(),
  message: z.string(),
  data: jsonValueSchema.optional(),
});
export type JsonRpcError = z.infer<typeof jsonRpcErrorSchema>;

export const jsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.union([z.array(jsonValueSchema), jsonObjectSchema]).optional(),
});
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const jsonRpcResponseSchema = z.union([
  z.strictObject({ jsonrpc: z.literal('2.0'), id: jsonRpcIdSchema, result: jsonValueSchema }),
  z.strictObject({ jsonrpc: z.literal('2.0'), id: jsonRpcIdSchema, error: jsonRpcErrorSchema }),
]);
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

export function forbiddenRouteError(from: string, to: string): JsonRpcError {
  return {
    code: FORBIDDEN_ROUTE_ERROR_CODE,
    message: `Route ${from} -> ${to} is not allowed.`,
    data: { reason: FORBIDDEN_ROUTE_REASON, from, to },
  };
}

export function isForbiddenRouteError(error: JsonRpcError): boolean {
  const { data } = error;
  return (
    error.code === FORBIDDEN_ROUTE_ERROR_CODE &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    data.reason === FORBIDDEN_ROUTE_REASON
  );
}
