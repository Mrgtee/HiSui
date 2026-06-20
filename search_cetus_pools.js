import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const poolsHandle = '0xd28736923703342b4752f5ed8c2f2a5c0cb2336c30e1fed42b387234ce8408ec';
const naviUsdcType = '0x0eedc3857f39f5e44b5786ebcd790317902ffca9960f44fcea5b7589cfc7a784::usdc::USDC';

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

    console.log(`Found ${allPoolAddresses.length} pools. Searching for pools matching SUI and NAVI USDC...`);

    const chunk = 50;
    let found = false;
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
        if (fields) {
          const coinA = fields.coin_a || '';
          const coinB = fields.coin_b || '';
          if (
            (coinA.includes(naviUsdcType) || coinB.includes(naviUsdcType))
          ) {
            console.log(`Found pool: ${id}`);
            console.log(`  Type: ${type}`);
            console.log(`  Coin A: ${coinA}`);
            console.log(`  Coin B: ${coinB}`);
            found = true;
          }
        }
      }
    }
    if (!found) {
      console.log("No pool containing SUI and NAVI USDC found in Cetus registry.");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
