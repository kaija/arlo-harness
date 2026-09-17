import type { Provider } from './model.js';

/**
 * Connection test for a provider. The real check runs in main with the stored
 * key (T09); until then the result is derived from the sample state so the UI
 * flow can be exercised: known-bad providers keep failing, others succeed.
 */
export async function testProviderConnection(
  provider: Pick<Provider, 'status' | 'lastError' | 'models'>,
): Promise<{ ok: boolean; message: string; models: string[] }> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (provider.status === 'invalid_key' || provider.status === 'unreachable') {
    return { ok: false, message: provider.lastError?.message ?? provider.status, models: [] };
  }
  return {
    ok: true,
    message: `連線成功 · 找到 ${provider.models.length} 個模型`,
    models: provider.models,
  };
}
