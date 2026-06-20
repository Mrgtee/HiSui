import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const ids = [
  '0x26c85500f5dd2983bf35123918a144de24e18936d0b234ef2b49fbb2d3d6307d',
  '0xe1f3db327e75f7ec30585fa52241edf66f7e359ef550b533f89aa1528dd1be52'
];

async function run() {
  for (const id of ids) {
    try {
      const res = await suiClient.getObject({ id, options: { showContent: true } });
      console.log(`ID: ${id}`);
      console.log(`Type: ${res.data?.content?.type || 'Not Found'}`);
      console.log(`Fields:`, JSON.stringify(res.data?.content?.fields, null, 2));
    } catch (err) {
      console.error(`Error for ${id}:`, err.message);
    }
  }
}

run();
