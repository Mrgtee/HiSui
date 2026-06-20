import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0xc7ae833c220aa73a3643a0d508afa4ac5d50d97312ea4584e35f9eb21b9df12';

async function run() {
  try {
    const moduleInfo = await suiClient.getNormalizedMoveModule({
      package: pkg,
      module: 'pool'
    });
    console.log("Functions in old pool module:");
    for (const [funcName, funcData] of Object.entries(moduleInfo.exposedFunctions)) {
      if (funcName.includes('swap')) {
        console.log(`  Function: ${funcName}`);
        console.log(`    Parameters:`, JSON.stringify(funcData.parameters, null, 2));
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
