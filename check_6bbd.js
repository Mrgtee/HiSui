import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0x6bbdf09f9fa0baa1524080a5b8991042e95061c4e1206217279aec51ba08edf7';

async function run() {
  try {
    const res = await suiClient.getNormalizedMoveModulesByPackage({ package: pkg });
    console.log("Modules in package 0x6bbd:", Object.keys(res));
    if (res.pool_script) {
      console.log("pool_script module exists! Exposed Functions:");
      for (const [funcName, funcData] of Object.entries(res.pool_script.exposedFunctions)) {
        if (funcName.includes('swap')) {
          console.log(`  Function: ${funcName}`);
          console.log(`    Parameters:`, JSON.stringify(funcData.parameters, null, 2));
        }
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
