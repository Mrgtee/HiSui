import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0x19dd42e05fa6c9988a60d30686ee3feb776672b5547e328d6dab16563da65293';

async function run() {
  try {
    const mod = await suiClient.getNormalizedMoveModule({ package: pkg, module: 'pool_script' });
    console.log("swap_a2b signature:", JSON.stringify(mod.exposedFunctions.swap_a2b, null, 2));
    console.log("\nswap_b2a signature:", JSON.stringify(mod.exposedFunctions.swap_b2a, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
