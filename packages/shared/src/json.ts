import { z } from 'zod';

/**
 * A value that survives JSON and structured clone unchanged: no `undefined`,
 * functions, Dates, Maps, class instances, NaN, or Infinity. Every
 * cross-process contract is built from these so it can cross a MessagePort
 * (ADR-0002) and be stored as JSON in SQLite (ADR-0011) without loss.
 */
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
export type JsonObject = z.infer<typeof jsonObjectSchema>;

/** ISO 8601 timestamp; `Z` or an explicit offset. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Opaque identifier (task, context, request, notification, ...). */
export const opaqueIdSchema = z.string().min(1).max(512);
