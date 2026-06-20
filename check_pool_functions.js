import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0x0868b71c0cba55bf0faf6c40df8c179c67a4d0ba0e79965b68b3d72d7dfbf666';

async function run() {
  try {
    const moduleInfo = await suiClient.getNormalizedMoveModule({
      package: pkg,
      module: 'pool'
    });
    console.log("Functions in pool module:");
    for (const [funcName, funcData] of Object.entries(moduleInfo.exposedFunctions)) {
      console.log(`  Function: ${funcName}`);
      console.log(`    Parameters:`, JSON.stringify(funcData.parameters, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
