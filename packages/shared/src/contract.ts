import type { z } from 'zod';
import { JSON_RPC_ERROR_CODES, type JsonRpcError } from './jsonrpc.js';

export interface MethodContract {
  params: z.ZodType;
  result: z.ZodType;
}

export type MethodContracts = Readonly<Record<string, MethodContract>>;

export type ContractParams<C extends MethodContracts, M extends keyof C> = z.output<C[M]['params']>;
export type ContractResult<C extends MethodContracts, M extends keyof C> = z.output<C[M]['result']>;

/** A validated call, narrowed by `method` so handlers can switch on it. */
export type ValidatedCall<C extends MethodContracts> = {
  [M in keyof C & string]: { ok: true; method: M; params: ContractParams<C, M> };
}[keyof C & string];

export type CallValidation<C extends MethodContracts> =
  ValidatedCall<C> | { ok: false; error: JsonRpcError };

function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Whitelist check for an incoming call: unknown methods (including inherited
 * object keys such as `toString`) are rejected before params are parsed.
 */
export function validateCall<C extends MethodContracts>(
  contract: C,
  method: string,
  params: unknown,
): CallValidation<C> {
  if (!Object.hasOwn(contract, method)) {
    return {
      ok: false,
      error: {
        code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: `Unknown method "${method}".`,
      },
    };
  }
  const parsed = (contract[method] as MethodContract).params.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        message: `Invalid params for "${method}".`,
        data: { issues: issuesOf(parsed.error) },
      },
    };
  }
  return { ok: true, method, params: parsed.data } as ValidatedCall<C>;
}

/** Validates a handler's result before it leaves main; throws on contract drift. */
export function parseResult<C extends MethodContracts, M extends keyof C & string>(
  contract: C,
  method: M,
  result: unknown,
): ContractResult<C, M> {
  return (contract[method] as MethodContract).result.parse(result) as ContractResult<C, M>;
}
