import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const cetusSdk = initCetusSDK({ network: 'testnet' });
const poolAddress = '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a';

async function run() {
  try {
    const pool = await cetusSdk.Pool.getPool(poolAddress);
    console.log("Fetched pool details");
    
    // Build swap transaction block using SDK
    const tx = await cetusSdk.Swap.buildSwapTransaction({
      pool: pool,
      a2b: false, // B (SUI) to A (USDC)
      byAmountIn: true,
      amount: '500000000', // 0.5 SUI
      slippage: 0.01,
      senderAddress: '0x17c0df61e7d0f19cdeaa5b7589cfc7ae85479b8ebd3fa068f11a5b7d2762281a',
    });
    
    console.log("Built Transaction Block:\n", JSON.stringify(tx.getData(), null, 2));
  } catch (err) {
    console.error("Error building swap:", err);
  }
}

run();
