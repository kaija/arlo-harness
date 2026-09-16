import {
  BUILTIN_TOOL_GROUPS,
  modelBindingSchema,
  personaIdSchema,
  riskLevelOverridesSchema,
  type BuiltinToolGroup,
} from '@arlo/shared';
import { z } from 'zod';
import { issuesFromZod, joinPath, type ParseResult } from './issues.js';
import { mcpServerEntryName, personaMcpServerSchema } from './mcp.js';
import { skillNameSchema } from './skill.js';
import { parseYaml } from './yaml.js';

/** ADR-0009 §6. */
export const DEFAULT_MAX_CONCURRENCY = 1;
export const MAX_CONCURRENCY_LIMIT = 16;

/**
 * ADR-0005 §2 lets persona.yaml override the 30-minute sync delegation
 * timeout without naming the field; it is `delegation.timeoutMinutes`. The
 * upper bound matches the 24-hour limit on waiting for input (ADR-0010 §4).
 */
export const DEFAULT_DELEGATION_TIMEOUT_MINUTES = 30;
export const MAX_DELEGATION_TIMEOUT_MINUTES = 24 * 60;

const BUILTIN_TOOL_GROUP_NAMES = Object.keys(BUILTIN_TOOL_GROUPS) as [
  BuiltinToolGroup,
  ...BuiltinToolGroup[],
];

function duplicatesOf(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

/**
 * persona.yaml (ADR-0008). Unknown keys are errors so a misspelled field such
 * as `maxConcurency` fails loudly instead of silently using the default.
 */
export const personaConfigSchema = z
  .strictObject({
    id: personaIdSchema,
    name: z.string().trim().min(1).max(100),
    /** Goes into the Agent Card and the Orchestrator's `delegate_to_*` tool description. */
    description: z.string().trim().min(1).max(1024),
    prompt: z.string().trim().min(1),
    /** Omitted: inherit the global default binding (ADR-0003 §3). */
    modelBinding: modelBindingSchema.optional(),
    /** Omitted: load every skill in skills/. */
    skills: z.array(skillNameSchema).optional(),
    mcpServers: z.array(personaMcpServerSchema).default([]),
    tools: z
      .strictObject({
        builtin: z.array(z.enum(BUILTIN_TOOL_GROUP_NAMES)).default([]),
        riskLevels: riskLevelOverridesSchema.default({}),
      })
      .default({ builtin: [], riskLevels: {} }),
    browser: z.strictObject({ enabled: z.boolean().default(false) }).default({ enabled: false }),
    maxConcurrency: z.int().min(1).max(MAX_CONCURRENCY_LIMIT).default(DEFAULT_MAX_CONCURRENCY),
    /** v1 always keeps Agents running (ADR-0002 §3); the field is reserved. */
    alwaysOn: z.literal(true).default(true),
    delegation: z
      .strictObject({
        timeoutMinutes: z
          .int()
          .min(1)
          .max(MAX_DELEGATION_TIMEOUT_MINUTES)
          .default(DEFAULT_DELEGATION_TIMEOUT_MINUTES),
      })
      .default({ timeoutMinutes: DEFAULT_DELEGATION_TIMEOUT_MINUTES }),
    triggers: z
      .strictObject({
        events: z
          .array(z.unknown())
          .max(0, 'Event triggers are not supported yet (Phase 2, ADR-0012).')
          .default([]),
      })
      .default({ events: [] }),
  })
  .superRefine((config, ctx) => {
    const lists: [string, readonly string[]][] = [
      ['skills', config.skills ?? []],
      ['tools.builtin', config.tools.builtin],
      ['mcpServers', config.mcpServers.map(mcpServerEntryName)],
    ];
    for (const [path, values] of lists) {
      for (const duplicate of duplicatesOf(values)) {
        ctx.addIssue({
          code: 'custom',
          path: path.split('.'),
          message: `"${duplicate}" is listed more than once.`,
        });
      }
    }
    if (config.tools.builtin.includes('browser') && !config.browser.enabled) {
      ctx.addIssue({
        code: 'custom',
        path: ['browser', 'enabled'],
        message: 'The browser tool group needs browser.enabled: true.',
      });
    }
  });

export type PersonaConfigInput = z.input<typeof personaConfigSchema>;
export type PersonaConfig = z.output<typeof personaConfigSchema>;

export interface ParsePersonaOptions {
  /** The workspace directory name, which `id` must match (ADR-0008 disk layout). */
  directoryName?: string;
}

export function parsePersonaConfig(
  value: unknown,
  options: ParsePersonaOptions = {},
): ParseResult<PersonaConfig> {
  const parsed = personaConfigSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) };
  if (options.directoryName !== undefined && parsed.data.id !== options.directoryName) {
    return {
      ok: false,
      issues: [
        {
          path: joinPath('id'),
          message: `Persona id "${parsed.data.id}" must match its directory "${options.directoryName}".`,
        },
      ],
    };
  }
  return { ok: true, value: parsed.data };
}

export function parsePersonaYaml(
  text: string,
  options: ParsePersonaOptions = {},
): ParseResult<PersonaConfig> {
  const yaml = parseYaml(text, '');
  return yaml.ok ? parsePersonaConfig(yaml.value, options) : yaml;
}
