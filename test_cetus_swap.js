import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClient } from '@mysten/sui/client';
import BN from 'bn.js';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const cetusSdk = initCetusSDK({ network: 'testnet' });
const poolAddress = '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a';

async function run() {
  try {
    // 1. Fetch raw pool object fields
    const response = await suiClient.getObject({
      id: poolAddress,
      options: { showContent: true }
    });

    if (!response.data || !response.data.content) {
      throw new Error("Pool object not found or no content");
    }

    const content = response.data.content;
    const fields = content.fields;
    const typeStr = content.type; // e.g. 0x...::pool::Pool<CoinA, CoinB>

    // Extract type arguments from Pool<CoinA, CoinB>
    const match = typeStr.match(/Pool<(.+),\s*(.+)>/);
    if (!match) {
      throw new Error("Could not parse type arguments from pool type: " + typeStr);
    }
    const coinTypeA = match[1].trim();
    const coinTypeB = match[2].trim();

    console.log("Coin A:", coinTypeA);
    console.log("Coin B:", coinTypeB);

    // Construct the pool object expected by the SDK
    const poolMock = {
      poolAddress: poolAddress,
      objectId: poolAddress,
      coinTypeA: coinTypeA,
      coinTypeB: coinTypeB,
      current_sqrt_price: fields.current_sqrt_price,
      fee_rate: fields.fee_rate,
      is_pause: fields.is_pause,
      liquidity: fields.liquidity,
      tickSpacing: fields.position_manager?.fields?.tick_spacing || 60,
      // For cetusSdk, other properties might be needed or populated
      ...fields
    };

    console.log("Mocked Pool object for SDK:\n", JSON.stringify(poolMock, null, 2));

    // Try a SUI -> USDC swap (amount: 0.5 SUI = 500,000,000 MIST)
    const amountVal = '500000000'; // 0.5 SUI
    const a2b = false; // B (SUI) to A (USDC)

    const preswapResult = await cetusSdk.Swap.preswap({
      pool: poolMock,
      currentSqrtPrice: poolMock.current_sqrt_price,
      coinTypeA: poolMock.coinTypeA,
      coinTypeB: poolMock.coinTypeB,
      decimalsA: 6, // USDC
      decimalsB: 9, // SUI
      a2b,
      byAmountIn: true,
      amount: amountVal,
    });

    console.log("\nPreswap result:", preswapResult);

  } catch (err) {
    console.error("Error running test:", err);
  }
}

run();
