import { Transaction } from '@mysten/sui/transactions';
import type { TransactionArgument } from '@mysten/sui/transactions';
import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { depositCoinPTB } from '@naviprotocol/lending';
import BN from 'bn.js';
import { suiClient } from './suiClient';

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
  USDC: '0x0588cff950e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC', // Cetus Testnet USDC
  NAVI_USDC: '0x0eedc3857f39f5e44b5786ebcd790317902ffca9960f44fcea5b7589cfc7a784::usdc::USDC', // NAVI Testnet USDC
};

// Cetus SUI/USDC Testnet Pool Address (v4 CLMM Pool matching the old package)
const TESTNET_POOL_ADDRESS = '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a'; 

const MIN_SQRT_PRICE = '4295048016';
const MAX_SQRT_PRICE = '79226673515401279992447579055'; 

export const buildPTB = async (actions: Action[], senderAddress: string): Promise<Transaction> => {
  const tx = new Transaction();
  tx.setSender(senderAddress);

  // Keep track of any dynamic coins created/swapped during the PTB
  let lastSwappedCoin: TransactionArgument | null = null;

  for (const action of actions) {
    if (action.type === 'swap') {
      const from = action.fromToken === 'SUI' ? TOKENS.SUI : action.fromToken || TOKENS.SUI;
      const to = action.toToken === 'USDC' ? TOKENS.USDC : action.toToken || TOKENS.USDC;
      const amountVal = action.amount;
      
      const poolAddress = TESTNET_POOL_ADDRESS;

      // 1. Get Cetus pool details
      let pool;
      try {
        pool = await cetusSdk.Pool.getPool(poolAddress);
      } catch (err) {
        // Fallback or dynamic lookup
        const pools = await cetusSdk.Pool.getPoolsWithPage([from, to]);
        if (pools && pools.length > 0) {
          pool = pools[0];
        } else {
          throw new Error('No Cetus pool found for swap pair', { cause: err });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolAny = pool as any;

      // Determine a2b and decimals dynamically based on pool coin types
      const a2b = from === poolAny.coinTypeA;
      const decimalsA = poolAny.coinTypeA === TOKENS.SUI ? 9 : 6;
      const decimalsB = poolAny.coinTypeB === TOKENS.SUI ? 9 : 6;

      // 2. Perform preswap quote
      const amountIn = new BN(amountVal);
      const preswapResult = await cetusSdk.Swap.preswap({
        pool: poolAny,
        currentSqrtPrice: poolAny.current_sqrt_price,
        coinTypeA: poolAny.coinTypeA,
        coinTypeB: poolAny.coinTypeB,
        decimalsA,
        decimalsB,
        a2b,
        byAmountIn: true,
        amount: amountIn.toString(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const preswapResultAny = preswapResult as any;

      // 3. Adjust for slippage (1% default) manually
      const amountLimit = Math.floor(parseInt(preswapResultAny.amountOut || '0', 10) * 0.99);

      // Split the input coin from gas if swapping SUI
      let inputCoinObj;
      if (from === TOKENS.SUI) {
        const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountVal)]);
        inputCoinObj = splitCoin;
      } else {
        inputCoinObj = tx.object(action.fromToken || '');
      }

      // 4. Construct direct moveCall to avoid full payload overrides and keep composability.
      const packageId = poolAny.packageId || cetusSdk.sdkOptions.integrate?.published_at || '0x19dd42e05fa6c9988a60d30686ee3feb776672b5547e328d6dab16563da65293';
      const globalConfigId = poolAny.globalConfigId || cetusSdk.sdkOptions.clmm_pool?.config?.global_config_id || '0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e';
      
      const coinTypeA = poolAny.coinTypeA || (a2b ? from : to);
      const coinTypeB = poolAny.coinTypeB || (a2b ? to : from);

      let coinA;
      let coinB;

      if (a2b) {
        coinA = inputCoinObj;
        coinB = tx.moveCall({
          target: '0x2::coin::zero',
          typeArguments: [coinTypeB],
        });
      } else {
        coinA = tx.moveCall({
          target: '0x2::coin::zero',
          typeArguments: [coinTypeA],
        });
        coinB = inputCoinObj;
      }

      const sqrtPriceLimit = a2b ? MIN_SQRT_PRICE : MAX_SQRT_PRICE;
      const swapTarget = a2b
        ? `${packageId}::pool_script_v2::swap_a2b`
        : `${packageId}::pool_script_v2::swap_b2a`;

      const swapResult = tx.moveCall({
        target: swapTarget,
        arguments: [
          tx.object(globalConfigId), 
          tx.object(poolAny.poolAddress || poolAddress),
          coinA,
          coinB,
          tx.pure.bool(true), // by_amount_in
          tx.pure.u64(amountVal),
          tx.pure.u64(amountLimit.toString()),
          tx.pure.u128(sqrtPriceLimit),
          tx.object('0x6'), // Clock
        ],
        typeArguments: [coinTypeA, coinTypeB],
      });

      // Capture the swapped coin result for downstream chaining
      lastSwappedCoin = swapResult;

    } else if (action.type === 'deposit') {
      const isUSDC = action.tokenType === 'USDC';
      const naviToken = isUSDC ? TOKENS.NAVI_USDC : TOKENS.SUI;
      const amountVal = action.amount;

      let depositCoinObj;
      if (naviToken === TOKENS.SUI) {
        const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountVal)]);
        depositCoinObj = splitCoin;
      } else {
        // On Testnet, Cetus USDC (0x0588...) and NAVI USDC (0x0eed...) are different coin types.
        // If we just swapped, the swapped coin is Cetus USDC.
        // Therefore, we decouple them on Testnet and fetch/split NAVI USDC from the user's wallet instead.
        // On Mainnet, the token types match, so we would use lastSwappedCoin directly.
        const typesMatch = TOKENS.USDC === TOKENS.NAVI_USDC;
        if (typesMatch && lastSwappedCoin) {
          depositCoinObj = lastSwappedCoin;
        } else {
          // Dynamic query for user's NAVI USDC coins in wallet
          try {
            const coinRes = await suiClient.getCoins({
              owner: senderAddress,
              coinType: naviToken,
            });
            if (coinRes.data && coinRes.data.length > 0) {
              const coinId = coinRes.data[0].coinObjectId;
              const [splitCoin] = tx.splitCoins(tx.object(coinId), [tx.pure.u64(amountVal)]);
              depositCoinObj = splitCoin;
            } else {
              // Dummy fallback to let simulation build and output a clean "Object not found" or balance error
              depositCoinObj = tx.object('0x0000000000000000000000000000000000000000000000000000000000000000');
            }
          } catch (err) {
            console.error("Failed to query user coins:", err);
            depositCoinObj = tx.object('0x0000000000000000000000000000000000000000000000000000000000000000');
          }
        }
      }

      // Add NAVI Deposit command to the PTB
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await depositCoinPTB(tx, naviToken, depositCoinObj as any, {
        amount: parseInt(amountVal, 10),
        env: 'dev', // Testnet
      });
    }
  }

  return tx;
};
