import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const poolsHandle = '0xd28736923703342b4752f5ed8c2f2a5c0cb2336c30e1fed42b387234ce8408ec';

async function run() {
  try {
    const response = await suiClient.getDynamicFields({ parentId: poolsHandle, limit: 10 });
    console.log("Registry dynamic fields list:", JSON.stringify(response.data, null, 2));

    if (response.data.length > 0) {
      const fieldObjectId = response.data[0].objectId;
      console.log(`\nFetching detail of registry wrapper field object: ${fieldObjectId}`);
      const fieldDetail = await suiClient.getObject({ id: fieldObjectId, options: { showContent: true } });
      console.log(JSON.stringify(fieldDetail, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
