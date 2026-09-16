import { OpenAIProvider } from '@openai/agents-openai';
import type { ProviderApiType, ProviderProfile } from '@arlo/shared';
import OpenAI, { AzureOpenAI } from 'openai';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * ADR-0003 §2: only the official OpenAI endpoint uses the Responses API.
 * Compatible endpoints must use Chat Completions; Azure does too, with the
 * binding's `model` as the deployment name, because deployment routing and
 * dated API versions are the Chat Completions path Azure supports broadly.
 */
export function usesResponsesApi(apiType: ProviderApiType): boolean {
  return apiType === 'openai';
}

/**
 * The client options that the `openai` package would otherwise read from
 * `OPENAI_*` / `AZURE_OPENAI_*` environment variables. Setting them all keeps
 * an Agent's requests on the configured endpoint whatever the process
 * environment holds, so a key is never sent somewhere else (ADR-0011 §6).
 */
const NO_ENV_FALLBACK = {
  adminAPIKey: null,
  organization: null,
  project: null,
  webhookSecret: null,
} as const;

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function createOpenAIClient(profile: ProviderProfile, apiKey: string): OpenAI {
  switch (profile.apiType) {
    case 'openai':
      return new OpenAI({
        ...NO_ENV_FALLBACK,
        apiKey,
        baseURL: profile.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
      });
    case 'openai_compatible':
      return new OpenAI({ ...NO_ENV_FALLBACK, apiKey, baseURL: profile.baseUrl as string });
    case 'azure_openai':
      // baseUrl is the resource endpoint, e.g. https://my-resource.openai.azure.com.
      return new AzureOpenAI({
        ...NO_ENV_FALLBACK,
        apiKey,
        baseURL: `${trimTrailingSlashes(profile.baseUrl as string)}/openai`,
        apiVersion: (profile.azure as { apiVersion: string }).apiVersion,
      });
  }
}

/**
 * `createModelProvider(profile)` from ADR-0003: the SDK model provider for a
 * pushed profile and its decrypted key. The shared schema has already
 * required `baseUrl` for compatible and Azure profiles.
 */
export function createModelProvider(profile: ProviderProfile, apiKey: string): OpenAIProvider {
  return new OpenAIProvider({
    openAIClient: createOpenAIClient(profile, apiKey),
    useResponses: usesResponsesApi(profile.apiType),
    useResponsesWebSocket: false,
  });
}
