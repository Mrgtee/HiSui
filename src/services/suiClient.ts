import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const MAINNET_RPC_URL = (typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_SUI_MAINNET_RPC_URL : undefined) || process.env.VITE_SUI_MAINNET_RPC_URL || getFullnodeUrl('mainnet');
const TESTNET_RPC_URL = (typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_SUI_RPC_URL : undefined) || process.env.VITE_SUI_RPC_URL || getFullnodeUrl('testnet');

export const mainnetClient = new SuiClient({ url: MAINNET_RPC_URL });
export const testnetClient = new SuiClient({ url: TESTNET_RPC_URL });

// Keep suiClient export pointing to mainnetClient by default to maintain backward compatibility
export const suiClient = mainnetClient;

export const getSuiClient = (network: 'mainnet' | 'testnet'): SuiClient => {
  return network === 'mainnet' ? mainnetClient : testnetClient;
};

export const getCurrentEpoch = async (network: 'mainnet' | 'testnet' = 'mainnet'): Promise<number> => {
  const client = getSuiClient(network);
  const state = (await client.getLatestSuiSystemState()) as { epoch: string | number };
  return parseInt(state.epoch as string, 10);
};

