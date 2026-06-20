import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0x19dd42e05fa6c9988a60d30686ee3feb776672b5547e328d6dab16563da65293';

async function run() {
  try {
    const res = await suiClient.getNormalizedMoveModulesByPackage({ package: pkg });
    console.log("Modules in new package:", Object.keys(res));
    
    // Check if there's any module with 'swap' or 'pool' and print its exposed functions
    for (const [moduleName, moduleInfo] of Object.entries(res)) {
      if (moduleName === 'pool' || moduleName.includes('script') || moduleName.includes('router') || moduleName.includes('swap')) {
        console.log(`\nModule: ${moduleName}`);
        for (const [funcName, funcData] of Object.entries(moduleInfo.exposedFunctions)) {
          console.log(`  Function: ${funcName} (Is Entry: ${funcData.isEntry})`);
        }
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
