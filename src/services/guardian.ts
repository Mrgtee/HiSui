import { Transaction } from '@mysten/sui/transactions';
import { getSuiClient } from './suiClient';
import { NETWORK_CONFIG } from './ptbBuilder';

export interface GuardianReport {
  success: boolean;
  error?: string;
  balanceChanges: {
    coinType: string;
    amount: string;
  }[];
  warnings: {
    type: 'slippage' | 'oracle';
    message: string;
    level: 'info' | 'warning' | 'danger';
  }[];
  executionRate?: number;
  executionSymbol?: string;
  oraclePrice?: number;
  oracleAge?: number;
}

const getSymbolFromCoinType = (coinType: string, network: 'mainnet' | 'testnet'): string => {
  const config = NETWORK_CONFIG[network];
  for (const [symbol, address] of Object.entries(config.TOKENS)) {
    if (address.toLowerCase() === coinType.toLowerCase()) {
      if (symbol === 'NAVI_USDC') return 'USDC';
      return symbol;
    }
  }
  if (coinType.endsWith('::sui::SUI')) return 'SUI';
  if (coinType.toLowerCase().includes('usdc')) return 'USDC';
  if (coinType.toLowerCase().includes('usdt')) return 'USDT';
  if (coinType.toLowerCase().includes('deep')) return 'DEEP';
  if (coinType.toLowerCase().includes('cetus')) return 'CETUS';
  
  const parts = coinType.split('::');
  return parts[parts.length - 1] || 'UNKNOWN';
};

const getDecimalsFromSymbol = (symbol: string): number => {
  const clean = symbol.toUpperCase();
  if (clean === 'SUI' || clean === 'CETUS') return 9;
  return 6; // USDC, USDT, DEEP
};

// SUI/USD Pyth configurations per network
const PYTH_CONFIGS = {
  mainnet: {
    endpoint: 'https://hermes.pyth.network',
    feedId: '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  },
  testnet: {
    endpoint: 'https://hermes-beta.pyth.network',
    feedId: '50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266',
  },
};

export const runGuardianChecks = async (
  tx: Transaction,
  network: 'mainnet' | 'testnet' = 'mainnet',
  slippageTolerancePercent = 2.0
): Promise<GuardianReport> => {
  const warnings: GuardianReport['warnings'] = [];
  let success = false;
  let errorMsg: string | undefined;
  let balanceChangesParsed: GuardianReport['balanceChanges'] = [];
  let executionRate: number | undefined;
  let executionSymbol: string | undefined;
  let oraclePrice: number | undefined;
  let oracleAge: number | undefined;

  const client = getSuiClient(network);

  try {
    // 1. Build the transaction to fetch bytes for dry-run
    const txBytes = await tx.build({ client });

    // 2. Perform on-chain dry-run via Sui RPC
    const dryRunResult = await client.dryRunTransactionBlock({
      transactionBlock: txBytes,
    });


    if (dryRunResult.effects.status.status === 'failure') {
      errorMsg = dryRunResult.effects.status.error || 'Transaction simulation failed';
    } else {
      success = true;
      // Parse balance changes
      balanceChangesParsed = dryRunResult.balanceChanges.map((change: { coinType: string; amount: string }) => ({
        coinType: change.coinType,
        amount: change.amount,
      }));
    }

    // 3. Fetch SUI/USD real-time price and timestamp from Pyth Hermes API
    let pythData;
    try {
      const pythConfig = PYTH_CONFIGS[network];
      const response = await fetch(
        `${pythConfig.endpoint}/v2/updates/price/latest?ids[]=${pythConfig.feedId}`
      );
      if (response.ok) {
        pythData = await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch Pyth oracle data:', err);
    }

    if (pythData && pythData.parsed && pythData.parsed.length > 0) {
      const feed = pythData.parsed[0];
      const rawPrice = parseFloat(feed.price.price);
      const expo = feed.price.expo;
      const publishTime = feed.price.publish_time;

      oraclePrice = rawPrice * Math.pow(10, expo);
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      oracleAge = currentTimeSeconds - publishTime;

      // Oracle Freshness Check (Risk Class 1)
      if (oracleAge > 60) {
        warnings.push({
          type: 'oracle',
          message: `Oracle price is stale by ${oracleAge} seconds (threshold: 60s). Execution rates might not reflect actual market conditions.`,
          level: 'warning',
        });
      } else {
        warnings.push({
          type: 'oracle',
          message: `Oracle price is fresh (${oracleAge}s old). SUI/USD = $${oraclePrice.toFixed(4)}.`,
          level: 'info',
        });
      }
    } else {
      warnings.push({
        type: 'oracle',
        message: 'Oracle data is unavailable. Proceed with extreme caution.',
        level: 'danger',
      });
    }

    // 4. Calculate actual execution slippage (Risk Class 2)
    if (success) {
      // Find SUI and non-SUI balance changes
      const suiChange = dryRunResult.balanceChanges.find(
        (change: { coinType: string; amount: string }) => change.coinType.toLowerCase().endsWith('::sui::sui')
      );
      
      const knownAddresses = new Set([
        ...Object.values(NETWORK_CONFIG.mainnet.TOKENS),
        ...Object.values(NETWORK_CONFIG.testnet.TOKENS)
      ].map(addr => addr.toLowerCase()));

      const otherChange = dryRunResult.balanceChanges.find(
        (change: { coinType: string; amount: string }) => {
          const lowerType = change.coinType.toLowerCase();
          return !lowerType.endsWith('::sui::sui') && knownAddresses.has(lowerType);
        }
      ) || dryRunResult.balanceChanges.find(
        (change: { coinType: string; amount: string }) => !change.coinType.toLowerCase().endsWith('::sui::sui')
      );

      if (suiChange && otherChange) {
        const otherSymbol = getSymbolFromCoinType(otherChange.coinType, network);
        const otherDecimals = getDecimalsFromSymbol(otherSymbol);
        
        executionSymbol = otherSymbol;

        const suiAmount = Math.abs(parseFloat(suiChange.amount)) / 1e9; // 9 decimals
        const otherAmount = Math.abs(parseFloat(otherChange.amount)) / Math.pow(10, otherDecimals);

        if (suiAmount > 0) {
          executionRate = otherAmount / suiAmount;
          
          const isStable = otherSymbol === 'USDC' || otherSymbol === 'USDT';
          
          if (isStable) {
            if (oraclePrice) {
              // Slippage ratio: compare execution rate with oracle price
              const priceImpact = ((oraclePrice - executionRate) / oraclePrice) * 100;

              if (priceImpact > slippageTolerancePercent) {
                warnings.push({
                  type: 'slippage',
                  message: `High Slippage Detected: Price impact is ${priceImpact.toFixed(2)}% (threshold: ${slippageTolerancePercent}%). You will lose $${(suiAmount * priceImpact * oraclePrice / 100).toFixed(2)} USD in output value.`,
                  level: 'danger',
                });
              } else {
                warnings.push({
                  type: 'slippage',
                  message: `Slippage is low (${priceImpact.toFixed(2)}% price impact).`,
                  level: 'info',
                });
              }
            } else {
              warnings.push({
                type: 'slippage',
                message: `Unable to verify slippage for stablecoin (${otherSymbol}) because SUI/USD oracle price is unavailable.`,
                level: 'warning',
              });
            }
          } else {
            warnings.push({
              type: 'slippage',
              message: `Slippage validation against SUI/USD oracle skipped for non-stablecoin (${otherSymbol}). Cetus execution rate: ${executionRate.toFixed(4)} ${otherSymbol}/SUI.`,
              level: 'info',
            });
          }
        }
      }
    }

  } catch (err: unknown) {
    errorMsg = (err as Error).message || 'Failed to complete transaction dry-run';
    warnings.push({
      type: 'slippage',
      message: `Guardian simulation error: ${errorMsg}`,
      level: 'danger',
    });
  }

  return {
    success,
    error: errorMsg,
    balanceChanges: balanceChangesParsed,
    warnings,
    executionRate,
    executionSymbol,
    oraclePrice,
    oracleAge,
  };
};
