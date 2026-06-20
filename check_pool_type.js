import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const poolsHandle = '0xd28736923703342b4752f5ed8c2f2a5c0cb2336c30e1fed42b387234ce8408ec';

async function run() {
  try {
    let hasMore = true;
    let cursor = null;
    const allPoolAddresses = [];

    while (hasMore) {
      const response = await suiClient.getDynamicFields({ 
        parentId: poolsHandle,
        cursor,
        limit: 100
      });
      
      for (const field of response.data) {
        allPoolAddresses.push(field.name.value);
      }
      hasMore = response.hasNextPage;
      cursor = response.nextCursor;
    }

    console.log(`Found ${allPoolAddresses.length} pools in registry. Fetching types...`);

    // Fetch details of all pool objects
    const chunk = 50;
    for (let i = 0; i < allPoolAddresses.length; i += chunk) {
      const addresses = allPoolAddresses.slice(i, i + chunk);
      const objects = await suiClient.multiGetObjects({
        ids: addresses,
        options: { showType: true, showContent: true }
      });

      for (const obj of objects) {
        const id = obj.data?.objectId;
        const type = obj.data?.type;
        const fields = obj.data?.content?.fields;
        console.log(`Pool: ${id}`);
        console.log(`  Type: ${type}`);
        if (fields) {
          console.log(`  Coin A: ${fields.coin_a || 'N/A'}`);
          console.log(`  Coin B: ${fields.coin_b || 'N/A'}`);
        }
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
