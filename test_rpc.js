import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const poolAddress = '0xa9cbcfadcbc4fc235c3a6019100b9344cb35f5f91560f191c545ba2407d27622';

async function run() {
  try {
    const response = await suiClient.getObject({
      id: poolAddress,
      options: { showContent: true }
    });
    console.log("Full Object Response:", JSON.stringify(response, null, 2));
  } catch (err) {
    console.error("Error fetching object:", err);
  }
}

run();
