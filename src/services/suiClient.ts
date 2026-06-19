import { SuiClient } from '@mysten/sui/client';

const RPC_URL = import.meta.env.VITE_SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';

export const suiClient = new SuiClient({ url: RPC_URL });

export const getCurrentEpoch = async (): Promise<number> => {
  const state = await suiClient.getLatestSuiSystemState();
  return parseInt(state.epoch, 10);
};
