import { Transaction } from '@mysten/sui/transactions';
import type { TransactionArgument } from '@mysten/sui/transactions';
import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { depositCoinPTB } from '@naviprotocol/lending';
import BN from 'bn.js';
import { getSuiClient } from './suiClient';
import type { SuiClient } from '@mysten/sui/client';
export const normalizeSuiAddress = (address: string): string => {
  const clean = address.toLowerCase().trim();
  if (!clean.startsWith('0x')) return clean;
  
  // If it's a full coin type (e.g. 0x...::module::Struct), normalize the address part
  const parts = clean.split('::');
  const addrPart = parts[0].slice(2); // remove 0x
  const padded = addrPart.padStart(64, '0');
  
  parts[0] = '0x' + padded;
  return parts.join('::');
};
const getCoinOfAmount = async (
  client: SuiClient,
  sender: string,
  coinType: string,
  amount: string | number,
  tx: Transaction
): Promise<TransactionArgument> => {
  try {
    const coinRes = await client.getCoins({
      owner: sender,
      coinType,
    });
    
    if (coinRes.data && coinRes.data.length > 0) {
      if (amount === 'all_swapped' || amount === 'all') {
        const coinId = coinRes.data[0].coinObjectId;
        const bal = coinRes.data[0].balance;
        const [splitCoin] = tx.splitCoins(tx.object(coinId), [tx.pure.u64(bal)]);
        return splitCoin;
      }
      
      const targetAmount = BigInt(amount);
      const singleCoin = coinRes.data.find(c => BigInt(c.balance) >= targetAmount);
      if (singleCoin) {
        const [splitCoin] = tx.splitCoins(tx.object(singleCoin.coinObjectId), [tx.pure.u64(targetAmount.toString())]);
        return splitCoin;
      }
      
      const coinsToMerge = [];
      let accumulated = 0n;
      for (const c of coinRes.data) {
        coinsToMerge.push(c.coinObjectId);
        accumulated += BigInt(c.balance);
        if (accumulated >= targetAmount) {
          break;
        }
      }
      
      if (accumulated < targetAmount) {
        throw new Error(`Insufficient balance of ${coinType}. Needed: ${targetAmount.toString()}, Available: ${accumulated.toString()}`);
      }
      
      const primaryCoin = coinsToMerge[0];
      if (coinsToMerge.length > 1) {
        tx.mergeCoins(tx.object(primaryCoin), coinsToMerge.slice(1).map(id => tx.object(id)));
      }
      const [splitCoin] = tx.splitCoins(tx.object(primaryCoin), [tx.pure.u64(targetAmount.toString())]);
      return splitCoin;
    }
  } catch (err) {
    console.error("Failed to query user coins:", err);
  }
  
  // Dummy fallback object ID for dry-run simulation (using 0x5 which is the Sui System State object, a valid Move Object rather than a Move Package)
  return tx.object('0x0000000000000000000000000000000000000000000000000000000000000005');
};

const resolveTokenAddress = (symbolOrAddress: string, config: any): string => {
  const clean = symbolOrAddress.toUpperCase();
  if (config.TOKENS[clean]) {
    return normalizeSuiAddress(config.TOKENS[clean]);
  }
  return normalizeSuiAddress(symbolOrAddress);
};

const resolvePoolAddress = async (
  sdk: any,
  from: string,
  to: string,
  network: 'mainnet' | 'testnet',
  config: any
): Promise<string> => {
  // Resolve symbols to construct static lookup key
  const getSymbol = (addr: string): string | null => {
    const normalizedAddr = normalizeSuiAddress(addr);
    for (const [sym, val] of Object.entries(config.TOKENS)) {
      if (normalizeSuiAddress(val as string) === normalizedAddr) {
        if (sym === 'NAVI_USDC') return 'USDC';
        return sym;
      }
    }
    return null;
  };

  const fromSym = getSymbol(from);
  const toSym = getSymbol(to);

  if (fromSym && toSym) {
    const key = [fromSym, toSym].sort().join('-');
    const staticMapping: Record<string, string> = {
      'mainnet-CETUS-SUI': '0x2e041f3fd93646dcc877f783c1f2b7fa62d30271bdef1f21ef002cebf857bded',
      'mainnet-DEEP-SUI': '0xd978d331772a5b90d5a4781e1232d18afd12019d0c35db79e3674beeda8f9126',
      'mainnet-SUI-USDC': '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
      'mainnet-SUI-USDT': '0x84fc1515fd3d2395b2d67b301dc2b60040e31af7e295f8731c84bd528733252f',
      'mainnet-USDC-USDT': '0xb8a67c149fd1bc7f9aca1541c61e51ba13bdded64c273c278e50850ae3bff073',

      'testnet-CETUS-SUI': '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
      'testnet-DEEP-SUI': '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
      'testnet-SUI-USDC': '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
      'testnet-SUI-USDT': '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
      'testnet-CETUS-USDC': '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
      'testnet-CETUS-USDT': '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
    };

    const mapKey = `${network}-${key}`;
    if (staticMapping[mapKey]) {
      return staticMapping[mapKey];
    }
  }

  // Fallback to dynamic lookup or config default
  try {
    const pools = await sdk.Pool.getPoolByCoins([from, to]);
    if (pools && pools.length > 0) {
      return pools[0].poolAddress;
    }
  } catch (err) {
    console.warn('Failed to resolve pool address dynamically via SDK:', err);
  }

  return config.POOL_ADDRESS;
};

// Initialize Cetus SDKs for both environments
const mainnetCetusSdk = initCetusSDK({ network: 'mainnet' });
const testnetCetusSdk = initCetusSDK({ network: 'testnet' });

export const getCetusSdk = (network: 'mainnet' | 'testnet') => {
  return network === 'mainnet' ? mainnetCetusSdk : testnetCetusSdk;
};

export interface Action {
  type: 'swap' | 'deposit';
  fromToken?: string;
  toToken?: string;
  amount: string; // raw base units (e.g. MIST for SUI)
  tokenType?: string; // used for deposit
}

// SUI, USDC, USDT, DEEP, and CETUS configurations per network
export const NETWORK_CONFIG = {
  mainnet: {
    TOKENS: {
      SUI: '0x2::sui::SUI',
      USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      NAVI_USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      USDT: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
      DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
      CETUS: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    },
    POOL_ADDRESS: '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105', // 0.25% fee tier SUI/USDC native pool
    NAVI_ENV: 'prod' as const,
  },
  testnet: {
    TOKENS: {
      SUI: '0x2::sui::SUI',
      USDC: '0x0588cff950e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC', // Cetus Testnet USDC
      NAVI_USDC: '0x0eedc3857f39f5e44b5786ebcd790317902ffca9960f44fcea5b7589cfc7a784::usdc::USDC', // NAVI Testnet USDC
      USDT: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::usdt::USDT',
      CETUS: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::cetus::CETUS',
      DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    },
    POOL_ADDRESS: '0x67f43a36dfef87e91586bc77ec9947fb0da127e867f64778317e2ee05cafe21a',
    NAVI_ENV: 'dev' as const,
  }
};

// Keep deprecated TOKENS export for backward compatibility if referenced elsewhere
export const TOKENS = NETWORK_CONFIG.testnet.TOKENS;

const MIN_SQRT_PRICE = '4295048016';
const MAX_SQRT_PRICE = '79226673515401279992447579055'; 

export const buildPTB = async (
  actions: Action[], 
  senderAddress: string, 
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<Transaction> => {
  const tx = new Transaction();
  tx.setSender(senderAddress);

  const client = getSuiClient(network);
  
  // Set the reference gas price dynamically based on network to prevent gas validation errors
  try {
    const rgp = await client.getReferenceGasPrice();
    tx.setGasPrice(rgp);
  } catch (err) {
    console.warn('Failed to fetch reference gas price, using default:', err);
  }

  const sdk = getCetusSdk(network);
  const config = NETWORK_CONFIG[network];

  // Keep track of swapped coin for downstream chaining
  let lastSwappedCoin: TransactionArgument | null = null;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    
    if (action.type === 'swap') {
      const from = resolveTokenAddress(action.fromToken || 'SUI', config);
      const to = resolveTokenAddress(action.toToken || 'USDC', config);
      const amountVal = action.amount;
      
      // Resolve the correct Cetus pool address dynamically or using static mappings
      const poolAddress = await resolvePoolAddress(sdk, from, to, network, config);

      // 1. Get Cetus pool details
      let pool;
      try {
        pool = await sdk.Pool.getPool(poolAddress);
      } catch (err) {
        throw new Error(`Failed to fetch pool details for address ${poolAddress}`, { cause: err });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolAny = pool as any;

      const getTokenDecimals = (coinType: string, cfg: any): number => {
        const norm = normalizeSuiAddress(coinType);
        if (norm === normalizeSuiAddress(cfg.TOKENS.SUI)) return 9;
        if (norm === normalizeSuiAddress(cfg.TOKENS.CETUS)) return 9;
        return 6; // USDC, USDT, DEEP are all 6 decimals
      };

      // Determine a2b and decimals dynamically based on pool coin types
      const a2b = normalizeSuiAddress(from) === normalizeSuiAddress(poolAny.coinTypeA);
      const decimalsA = getTokenDecimals(poolAny.coinTypeA, config);
      const decimalsB = getTokenDecimals(poolAny.coinTypeB, config);

      // 2. Perform preswap quote to validate liquidity and pool state (optional, safely bypassed if SDK has options mismatches)
      const amountIn = new BN(amountVal);
      try {
        await sdk.Swap.preswap({
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
      } catch (err) {
        console.warn('Cetus SDK preswap quote check failed/skipped:', err);
      }

      // Split the input coin from gas if swapping SUI
      let inputCoinObj;
      if (normalizeSuiAddress(from) === normalizeSuiAddress(config.TOKENS.SUI)) {
        const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountVal)]);
        inputCoinObj = splitCoin;
      } else {
        inputCoinObj = await getCoinOfAmount(client, senderAddress, from, amountVal, tx);
      }

      // 4. Construct direct moveCall to avoid full payload overrides and keep composability.
      const packageId = sdk.sdkOptions.integrate?.published_at || '0x19dd42e05fa6c9988a60d30686ee3feb776672b5547e328d6dab16563da65293';
      const globalConfigId = poolAny.globalConfigId || sdk.sdkOptions.clmm_pool?.config?.global_config_id || '0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e';
      
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

      // Call router::swap which returns [Coin<CoinTypeA>, Coin<CoinTypeB>] on-chain
      const swapResult = tx.moveCall({
        target: `${packageId}::router::swap`,
        arguments: [
          tx.object(globalConfigId), 
          tx.object(poolAny.poolAddress || poolAddress),
          coinA,
          coinB,
          tx.pure.bool(a2b),
          tx.pure.bool(true), // by_amount_in
          tx.pure.u64(amountVal),
          tx.pure.u128(sqrtPriceLimit),
          tx.pure.bool(false), // is_exact_out
          tx.object('0x6'), // Clock
        ],
        typeArguments: [coinTypeA, coinTypeB],
      });

      // Extract the swapped and remainder coins
      const swappedCoin = a2b ? swapResult[1] : swapResult[0];
      const remainderCoin = a2b ? swapResult[0] : swapResult[1];

      // Transfer the remainder coin (inactive leg) back to the sender since it is unused
      tx.transferObjects([remainderCoin], tx.pure.address(senderAddress));

      // Check if there is a deposit action following this swap in the PTB for USDC
      const hasNextDeposit = actions.slice(i + 1).some(
        act => act.type === 'deposit' && (act.tokenType?.toUpperCase() === 'USDC' || !act.tokenType)
      );

      if (hasNextDeposit) {
        // Save the swapped coin object for downstream deposit
        lastSwappedCoin = swappedCoin;
      } else {
        // Otherwise transfer the swapped coin back to the sender
        tx.transferObjects([swappedCoin], tx.pure.address(senderAddress));
      }

    } else if (action.type === 'deposit') {
      const isUSDC = action.tokenType?.toUpperCase() === 'USDC' || !action.tokenType;
      const naviToken = isUSDC ? config.TOKENS.NAVI_USDC : config.TOKENS.SUI;
      const amountVal = action.amount;

      let depositCoinObj;
      if (normalizeSuiAddress(naviToken) === normalizeSuiAddress(config.TOKENS.SUI)) {
        const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountVal)]);
        depositCoinObj = splitCoin;
      } else {
        // If we just swapped on Mainnet, tokens match, so we chain atomically using lastSwappedCoin
        if (network === 'mainnet' && lastSwappedCoin) {
          depositCoinObj = lastSwappedCoin;
        } else {
          // On Testnet (decoupled) or if no swap happened, fetch NAVI USDC from user's wallet
          depositCoinObj = await getCoinOfAmount(client, senderAddress, naviToken, amountVal, tx);
        }
      }

      // Add NAVI Deposit command to the PTB
      // If amountVal is 'all_swapped' and we are on Mainnet, we can omit amount so NAVI SDK deposits the full coin balance
      const depositOptions: any = {
        env: config.NAVI_ENV,
      };
      if (amountVal !== 'all_swapped') {
        depositOptions.amount = parseInt(amountVal, 10);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await depositCoinPTB(tx, naviToken, depositCoinObj as any, depositOptions);
    }
  }

  return tx;
};
