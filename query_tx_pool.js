import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const poolAddress = '0xa9cbcfadcbc4fc235c3a6019100b9344cb35f5f91560f191c545ba2407d27622';

async function run() {
  try {
    console.log("Querying transaction blocks for pool:", poolAddress);
    const txBlocks = await suiClient.queryTransactionBlocks({
      filter: {
        InputObject: poolAddress
      },
      limit: 10,
      options: {
        showInput: true,
        showEffects: true
      }
    });

    console.log(`Found ${txBlocks.data.length} transactions.`);
    for (const tx of txBlocks.data) {
      console.log(`\nTx Digest: ${tx.digest}`);
      // Find move calls in the transaction transaction data
      const transaction = tx.transaction;
      if (transaction && transaction.data && transaction.data.transaction) {
        const kind = transaction.data.transaction;
        if (kind.transactions) {
          for (const command of kind.transactions) {
            if (command.MoveCall) {
              const mc = command.MoveCall;
              if (mc.package.startsWith('0x0868b7') || mc.package.startsWith('0xcee066')) {
                console.log(`MoveCall: ${mc.package}::${mc.module}::${mc.function}`);
                console.log(`Arguments:`, mc.arguments);
                console.log(`TypeArguments:`, mc.typeArguments);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Error querying transactions:", err);
  }
}

run();
