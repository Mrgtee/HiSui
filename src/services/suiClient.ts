import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta.env !== 'undefined' && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
};

const MAINNET_RPC_URL = getEnvVar('VITE_SUI_MAINNET_RPC_URL') || getFullnodeUrl('mainnet');
const TESTNET_RPC_URL = getEnvVar('VITE_SUI_RPC_URL') || getEnvVar('VITE_SUI_TESTNET_RPC_URL') || getFullnodeUrl('testnet');

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

