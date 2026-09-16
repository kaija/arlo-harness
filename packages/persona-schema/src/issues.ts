import type { z } from 'zod';

/** One problem in a config file, located by a dotted path the UI can show next to the field. */
export interface ConfigIssue {
  path: string;
  message: string;
}

/**
 * Config parsing reports every problem at once instead of throwing on the
 * first, so a settings screen can mark all invalid fields together.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: ConfigIssue[] };

export function joinPath(...segments: readonly (string | number)[]): string {
  return segments
    .map(String)
    .filter((segment) => segment !== '')
    .join('.');
}

export function issuesFromZod(error: z.ZodError, prefix = ''): ConfigIssue[] {
  return error.issues.map((issue) => ({
    path: joinPath(prefix, ...issue.path.map(String)),
    message: issue.message,
  }));
}
