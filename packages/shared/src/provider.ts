import { z } from 'zod';
import { jsonObjectSchema } from './json.js';

export const PROVIDER_API_TYPES = ['openai', 'openai_compatible', 'azure_openai'] as const;
export type ProviderApiType = (typeof PROVIDER_API_TYPES)[number];

/**
 * ADR-0003 §3. `apiKeyRef` points at the `secrets` table; the key itself only
 * travels in the main → Agent `provider/configure` control message.
 */
export const providerProfileSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    apiType: z.enum(PROVIDER_API_TYPES),
    baseUrl: z.url({ protocol: /^https?$/ }).optional(),
    apiKeyRef: z.string().min(1),
    azure: z.strictObject({ apiVersion: z.string().min(1) }).optional(),
    capabilities: z.strictObject({ realtime: z.boolean(), transcription: z.boolean() }),
  })
  .superRefine((profile, ctx) => {
    // Without a baseUrl a compatible/Azure key would silently be sent to api.openai.com.
    if (profile.apiType !== 'openai' && profile.baseUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: `baseUrl is required for apiType "${profile.apiType}".`,
      });
    }
    if ((profile.apiType === 'azure_openai') !== (profile.azure !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['azure'],
        message: 'azure settings are required for, and only allowed with, apiType "azure_openai".',
      });
    }
  });
export type ProviderProfile = z.infer<typeof providerProfileSchema>;

export const modelBindingSchema = z.strictObject({
  providerId: z.string().min(1),
  model: z.string().min(1),
  settings: jsonObjectSchema.optional(),
});
export type ModelBinding = z.infer<typeof modelBindingSchema>;
