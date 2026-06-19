import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const RPC_URL = (typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_SUI_RPC_URL : undefined) || process.env.VITE_SUI_RPC_URL || getFullnodeUrl('testnet');

export const suiClient = new SuiClient({ url: RPC_URL });

export const getCurrentEpoch = async (): Promise<number> => {
  const state = (await suiClient.getLatestSuiSystemState()) as { epoch: string | number };
  return parseInt(state.epoch as string, 10);
};
