async function run() {
  const envs = ['dev', 'prod'];
  for (const env of envs) {
    try {
      const url = `https://open-api.naviprotocol.io/api/navi/pools?env=${env}`;
      console.log(`\nFetching NAVI pools for env=${env}...`);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const data = await res.json();
      console.log(`Total pools: ${data.data?.length || 0}`);
      
      for (const pool of (data.data || [])) {
        console.log(`Pool ${pool.id}: ${pool.token.symbol}`);
        console.log(`  suiCoinType: ${pool.suiCoinType}`);
        console.log(`  coinType: ${pool.coinType}`);
        console.log(`  Pool UID: ${pool.poolUid}`);
      }
    } catch (err) {
      console.error(`Failed for env=${env}:`, err.message);
    }
  }
}

run();
