import {
  modelBindingSchema,
  providerProfileSchema,
  type ModelBinding,
  type ProviderProfile,
} from '@arlo/shared';
import { z } from 'zod';
import { issuesFromZod, joinPath, type ParseResult } from './issues.js';
import { mcpServerNameSchema, mcpServerTemplateSchema } from './mcp.js';

/**
 * Global settings (ADR-0003 §3, ADR-0008 "MCP 歸屬"). The Orchestrator has no
 * persona.yaml, so its optional binding override lives here. Where these
 * settings are stored is decided by the settings service (T09).
 */
export const globalSettingsSchema = z
  .strictObject({
    providers: z.array(providerProfileSchema).default([]),
    defaultBinding: modelBindingSchema.optional(),
    orchestrator: z.strictObject({ modelBinding: modelBindingSchema.optional() }).default({}),
    mcpServerTemplates: z.record(mcpServerNameSchema, mcpServerTemplateSchema).default({}),
  })
  .superRefine((settings, ctx) => {
    const ids = new Set<string>();
    settings.providers.forEach((profile, index) => {
      if (ids.has(profile.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['providers', index, 'id'],
          message: `Provider id "${profile.id}" is used more than once.`,
        });
      }
      ids.add(profile.id);
    });
    const bindings: [string[], ModelBinding | undefined][] = [
      [['defaultBinding'], settings.defaultBinding],
      [['orchestrator', 'modelBinding'], settings.orchestrator.modelBinding],
    ];
    for (const [path, binding] of bindings) {
      if (binding !== undefined && !ids.has(binding.providerId)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'providerId'],
          message: `No provider with id "${binding.providerId}".`,
        });
      }
    }
  });

export type GlobalSettingsInput = z.input<typeof globalSettingsSchema>;
export type GlobalSettings = z.output<typeof globalSettingsSchema>;

export function parseGlobalSettings(value: unknown): ParseResult<GlobalSettings> {
  const parsed = globalSettingsSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: issuesFromZod(parsed.error) };
}

export interface ResolvedModelBinding {
  binding: ModelBinding;
  profile: ProviderProfile;
  /** `agent`: the Orchestrator or Persona override; `global`: inherited default. */
  source: 'agent' | 'global';
}

/**
 * Picks the binding an Agent runs with: its own override when set, otherwise
 * the global default (ADR-0003 §3). Pass `persona.modelBinding` for a Persona
 * or `settings.orchestrator.modelBinding` for the Orchestrator.
 */
export function resolveModelBinding(
  override: ModelBinding | undefined,
  settings: GlobalSettings,
): ParseResult<ResolvedModelBinding> {
  const source = override === undefined ? 'global' : 'agent';
  const binding = override ?? settings.defaultBinding;
  if (binding === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: 'defaultBinding',
          message: 'No model binding: set a global default or an agent-level modelBinding.',
        },
      ],
    };
  }
  const profile = settings.providers.find((candidate) => candidate.id === binding.providerId);
  if (profile === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: joinPath(source === 'agent' ? 'modelBinding' : 'defaultBinding', 'providerId'),
          message: `No provider with id "${binding.providerId}".`,
        },
      ],
    };
  }
  return { ok: true, value: { binding, profile, source } };
}
