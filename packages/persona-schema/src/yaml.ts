import { parseDocument } from 'yaml';
import type { ParseResult } from './issues.js';

/**
 * Parses YAML as plain data: the core schema only (no custom tags), duplicate
 * keys rejected, and the default alias limit so a small file cannot expand
 * into a huge object.
 */
export function parseYaml(text: string, path: string): ParseResult<unknown> {
  const document = parseDocument(text, { schema: 'core', uniqueKeys: true, prettyErrors: true });
  const errors = [...document.errors, ...document.warnings];
  if (errors.length > 0) {
    return {
      ok: false,
      issues: errors.map((error) => ({ path, message: error.message })),
    };
  }
  try {
    return { ok: true, value: document.toJS() };
  } catch (error) {
    // toJS throws when aliases exceed maxAliasCount.
    return { ok: false, issues: [{ path, message: (error as Error).message }] };
  }
}
