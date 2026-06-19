import { Transaction } from '@mysten/sui/transactions';
import { initCetusSDK, Percentage, d } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { depositCoinPTB } from '@naviprotocol/lending';
import BN from 'bn.js';

// Initialize Cetus SDK on Testnet
const cetusSdk = initCetusSDK({ network: 'testnet' });

export interface Action {
  type: 'swap' | 'deposit';
  fromToken?: string;
  toToken?: string;
  amount: string; // raw base units (e.g. MIST for SUI)
  tokenType?: string; // used for deposit
}

// SUI and USDC token types on Testnet
export const TOKENS = {
  SUI: '0x2::sui::SUI',
  USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
};

// Cetus SUI/USDC Testnet Pool Address (v4 CLMM Pool)
const TESTNET_POOL_ADDRESS = '0xcf39cbb87a6d8d9753df1821037bd7117e2906494428cf252621037bd7117e29'; 

export const buildPTB = async (actions: Action[], senderAddress: string): Promise<Transaction> => {
  const tx = new Transaction();
  tx.setSender(senderAddress);

  // Keep track of any dynamic coins created/swapped during the PTB
  let lastSwappedCoin: any = null;

  for (const action of actions) {
    if (action.type === 'swap') {
      const from = action.fromToken === 'SUI' ? TOKENS.SUI : action.fromToken || TOKENS.SUI;
      const to = action.toToken === 'USDC' ? TOKENS.USDC : action.toToken || TOKENS.USDC;
      const amountVal = action.amount;
      
      const a2b = from === TOKENS.SUI;
      const poolAddress = TESTNET_POOL_ADDRESS;

      // 1. Get Cetus pool details
      let pool;
      try {
        pool = await cetusSdk.Pool.getPool(poolAddress);
      } catch (err) {
        // Fallback or dynamic lookup
        const pools = await cetusSdk.Pool.getPoolsWithPage({
          coinTypeA: a2b ? from : to,
          coinTypeB: a2b ? to : from,
        });
        if (pools && pools.length > 0) {
          pool = pools[0];
        } else {
          throw new Error('No Cetus pool found for swap pair');
        }
      }

      // 2. Perform preswap quote
      const amountIn = new BN(amountVal);
      const preswapResult = await cetusSdk.Swap.preswap({
        pool,
        current_sqrt_price: pool.current_sqrt_price,
        coinTypeA: pool.coinTypeA,
        coinTypeB: pool.coinTypeB,
        decimalsA: 9, // SUI
        decimalsB: 6, // USDC
        a2b,
        by_amount_in: true,
        amount: amountIn,
      });

      // 3. Adjust for slippage (1% default)
      const slippage = Percentage.fromDecimal(d(1)); 
      const amountLimit = cetusSdk.Swap.calculateAmountLimit(preswapResult, slippage);

      // Split the input coin from gas if swapping SUI
      let inputCoinObj;
      if (from === TOKENS.SUI) {
        const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountVal)]);
        inputCoinObj = splitCoin;
      } else {
        // For non-SUI input, we expect the user has USDCs in their account.
        // In a real PTB, we would query the user's USDC objects and pass the target object.
        // For simplicity, we split from a pure object ID or pass a placeholder.
        inputCoinObj = tx.object(action.fromToken || '');
      }

      // 4. Construct direct moveCall to avoid full payload overrides and keep composability.
      // This is crucial because it lets us capture the return value of the swap!
      const packageId = pool.packageId;
      const swapResult = tx.moveCall({
        target: `${packageId}::pool_script::swap_a2b`, // Target swap_a2b or swap_b2a
        arguments: [
          tx.object(pool.globalConfigId || '0xcee0662fe38685002fe38685002fe38685002fe38685002fe38685002fe38685'), 
          tx.object(pool.poolAddress),
          tx.makeMoveVec({ elements: [inputCoinObj] }),
          tx.pure.bool(a2b),
          tx.pure.u64(amountVal),
          tx.pure.u64(amountLimit.toString()),
          tx.pure.u128(pool.current_sqrt_price),
          tx.object('0x6'), // Clock
        ],
        typeArguments: [pool.coinTypeA, pool.coinTypeB],
      });

      // Capture the swapped coin result for downstream chaining
      lastSwappedCoin = swapResult;

    } else if (action.type === 'deposit') {
      const token = action.tokenType === 'USDC' ? TOKENS.USDC : TOKENS.SUI;
      const amountVal = action.amount;

      let depositCoinObj;
      if (token === TOKENS.SUI) {
        const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountVal)]);
        depositCoinObj = splitCoin;
      } else {
        // If we just swapped in the previous step, deposit the swapped coin directly!
        if (lastSwappedCoin) {
          depositCoinObj = lastSwappedCoin;
        } else {
          // Fallback to splitting/inputting from wallet
          depositCoinObj = tx.object(action.tokenType || '');
        }
      }

      // Add NAVI Deposit command to the PTB
      await depositCoinPTB(tx, token, depositCoinObj, {
        amount: parseInt(amountVal, 10),
        env: 'dev', // Testnet
      });
    }
  }

  return tx;
};
