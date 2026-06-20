import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const pkg = '0x0868b71c0cba55bf0faf6c40df8c179c67a4d0ba0e79965b68b3d72d7dfbf666';
const pool = '0xa9cbcfadcbc4fc235c3a6019100b9344cb35f5f91560f191c545ba2407d27622';

async function run() {
  const filters = [
    { ChangedObject: pkg },
    { ChangedObject: pool },
    { MoveFunction: { package: pkg, module: 'pool', function: 'create_pool' } }
  ];

  for (const filter of filters) {
    try {
      console.log(`\nQuerying transactions for filter:`, JSON.stringify(filter));
      const res = await suiClient.queryTransactionBlocks({
        filter,
        limit: 10,
        options: { showInput: true, showEffects: true, showEvents: true }
      });
      console.log(`Found ${res.data.length} transactions.`);
      for (const tx of res.data) {
        console.log(`  Tx: ${tx.digest}`);
        if (tx.events) {
          console.log(`  Events:`, JSON.stringify(tx.events, null, 2));
        }
      }
    } catch (err) {
      console.error(`Failed:`, err.message);
    }
  }
}

run();
