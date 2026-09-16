import { z } from 'zod';
import { joinPath, type ConfigIssue, type ParseResult } from './issues.js';

/**
 * MCP tools are named `<server>.<tool>` in `tools.riskLevels` (ADR-0010 §6),
 * so a server name cannot contain a dot.
 */
export const mcpServerNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,64}$/,
    'MCP server names use letters, digits, "_" and "-" only, up to 64 characters.',
  );

const stdioFields = {
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().min(1).optional(),
};

const streamableHttpFields = {
  transport: z.literal('streamable_http'),
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).default({}),
};

/**
 * A reusable definition in global settings (ADR-0008 "MCP 歸屬"). Referencing
 * it from persona.yaml does not share a process: each Persona still starts
 * its own copy.
 */
export const mcpServerTemplateSchema = z.discriminatedUnion('transport', [
  z.strictObject(stdioFields),
  z.strictObject(streamableHttpFields),
]);
export type McpServerTemplate = z.infer<typeof mcpServerTemplateSchema>;

export const inlineMcpServerSchema = z.discriminatedUnion('transport', [
  z.strictObject({ name: mcpServerNameSchema, ...stdioFields }),
  z.strictObject({ name: mcpServerNameSchema, ...streamableHttpFields }),
]);
/** A server a Persona will start, after template references are resolved. */
export type McpServerDefinition = z.infer<typeof inlineMcpServerSchema>;

export const mcpServerRefSchema = z.strictObject({ ref: mcpServerNameSchema });
export type McpServerRef = z.infer<typeof mcpServerRefSchema>;

/**
 * A persona.yaml `mcpServers` entry: `{ ref }` or an inline definition. The
 * branch is picked by the presence of `ref`, so errors describe the form the
 * author meant instead of listing both alternatives.
 */
export const personaMcpServerSchema = z
  .unknown()
  .transform((value, ctx): McpServerRef | McpServerDefinition => {
    const isRef = typeof value === 'object' && value !== null && Object.hasOwn(value, 'ref');
    const parsed = (isRef ? mcpServerRefSchema : inlineMcpServerSchema).safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
      return z.NEVER;
    }
    return parsed.data;
  });
export type PersonaMcpServer = z.output<typeof personaMcpServerSchema>;

export function isMcpServerRef(entry: PersonaMcpServer): entry is McpServerRef {
  return Object.hasOwn(entry, 'ref');
}

export function mcpServerEntryName(entry: PersonaMcpServer): string {
  return isMcpServerRef(entry) ? entry.ref : entry.name;
}

/** Replaces `{ ref }` entries with the named global template. */
export function resolveMcpServers(
  entries: readonly PersonaMcpServer[],
  templates: Readonly<Record<string, McpServerTemplate>>,
): ParseResult<McpServerDefinition[]> {
  const issues: ConfigIssue[] = [];
  const resolved: McpServerDefinition[] = [];
  entries.forEach((entry, index) => {
    if (!isMcpServerRef(entry)) {
      resolved.push(entry);
      return;
    }
    if (!Object.hasOwn(templates, entry.ref)) {
      issues.push({
        path: joinPath('mcpServers', index, 'ref'),
        message: `No global MCP server template named "${entry.ref}".`,
      });
      return;
    }
    resolved.push({ name: entry.ref, ...(templates[entry.ref] as McpServerTemplate) });
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: resolved };
}
