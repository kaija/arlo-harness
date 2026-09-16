import type { ModelProvider, ModelSettings } from '@openai/agents-core';
import {
  controlMessageSchema,
  type ControlMessage,
  type ProviderApiType,
  type ProviderProfile,
} from '@arlo/shared';
import { createModelProvider } from './provider.js';

export type ProviderConfigureMessage = Extract<ControlMessage, { type: 'provider/configure' }>;

/** What one Run uses, captured when the Run starts. */
export interface ModelSelection {
  provider: ModelProvider;
  model: string;
  settings: ModelSettings | undefined;
  providerId: string;
  apiType: ProviderApiType;
}

export interface ModelSelector {
  select(): ModelSelection;
}

export type ModelProviderFactory = (profile: ProviderProfile, apiKey: string) => ModelProvider;

export interface ModelConfigOptions {
  /** Replaced in tests, e.g. with a FakeModel provider. */
  createProvider?: ModelProviderFactory;
}

/**
 * Holds the Provider main pushed over the port (ADR-0003 §4). The Agent never
 * reads settings or keys from disk or the environment. A Run captures the
 * current selection when it starts, so `provider/configure` takes effect from
 * the next Run and never changes a Run midway. Each Run gets its own Runner
 * with this provider instead of a process-wide `setDefaultModelProvider`.
 */
export class ModelConfig implements ModelSelector {
  readonly #createProvider: ModelProviderFactory;
  #current: ModelSelection | undefined;

  constructor(options: ModelConfigOptions = {}) {
    this.#createProvider = options.createProvider ?? createModelProvider;
  }

  get configured(): boolean {
    return this.#current !== undefined;
  }

  configure(message: ProviderConfigureMessage): void {
    const { binding, profile, apiKey } = controlMessageSchema.parse(
      message,
    ) as ProviderConfigureMessage;
    this.#current = {
      provider: this.#createProvider(profile, apiKey),
      model: binding.model,
      settings: binding.settings as ModelSettings | undefined,
      providerId: profile.id,
      apiType: profile.apiType,
    };
  }

  select(): ModelSelection {
    if (this.#current === undefined) {
      throw new Error('No model provider configured: main has not sent provider/configure.');
    }
    return this.#current;
  }

  /** Applies every `provider/configure` control message from a channel. Returns the unsubscribe function. */
  listen(channel: {
    onControl(listener: (message: ControlMessage) => void): () => void;
  }): () => void {
    return channel.onControl((message) => {
      if (message.type === 'provider/configure') this.configure(message);
    });
  }
}
