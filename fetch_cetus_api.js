async function run() {
  try {
    const url = 'https://api-sui.cetus.zone/v2/sui/pools_info';
    console.log("Fetching Cetus pools info from:", url);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    console.log("Successfully fetched! Total pools in API response:", data.data?.pools?.length);
    
    // Filter for SUI/USDC pools
    const suiUsdcPools = (data.data?.pools || []).filter(p => 
      (p.coin_a.symbol === 'SUI' && p.coin_b.symbol === 'USDC') ||
      (p.coin_a.symbol === 'USDC' && p.coin_b.symbol === 'SUI')
    );

    console.log("\nSUI/USDC Pools:");
    console.log(JSON.stringify(suiUsdcPools, null, 2));

  } catch (err) {
    console.error("Error fetching Cetus API:", err);
  }
}

run();
