import type {
  ContractParams,
  ContractResult,
  RendererInvokeChannel,
  rendererInvokeContract,
} from '@arlo/shared';

type Contract = typeof rendererInvokeContract;
type Call<C extends RendererInvokeChannel> = (
  params: ContractParams<Contract, C>,
) => Promise<ContractResult<Contract, C>>;

/**
 * `window.arlo`: the renderer's whole view of main. Only channels main already
 * handles are exposed; T20 adds the rest of `rendererInvokeContract`.
 */
export interface ArloBridge {
  platform: string;
  windows: {
    showPersona: Call<'windows/showPersona'>;
    showMain: Call<'windows/showMain'>;
  };
}
