import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0x0868b71c0cba55bf0faf6c40df8c179c67a4d0ba0e79965b68b3d72d7dfbf666';

async function run() {
  try {
    const moduleInfo = await suiClient.getNormalizedMoveModule({
      package: pkg,
      module: 'pool'
    });
    const funcData = moduleInfo.exposedFunctions['calculate_swap_result'];
    console.log("Function calculate_swap_result parameters:\n", JSON.stringify(funcData, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
