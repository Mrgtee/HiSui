import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from './suiClient';
import { TOKENS } from './ptbBuilder';

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
  oraclePrice?: number;
  oracleAge?: number;
}

// SUI/USD Pyth price feed ID
const PYTH_SUI_FEED_ID = 'e62dd6b59b08bc1680e57c33b4d96a01f64859a0fcf67f0f09b521037bd7117e';

export const runGuardianChecks = async (
  tx: Transaction,
  slippageTolerancePercent = 2.0
): Promise<GuardianReport> => {
  const warnings: GuardianReport['warnings'] = [];
  let success = false;
  let errorMsg: string | undefined;
  let balanceChangesParsed: GuardianReport['balanceChanges'] = [];
  let executionRate: number | undefined;
  let oraclePrice: number | undefined;
  let oracleAge: number | undefined;

  try {
    // 1. Build the transaction to fetch bytes for dry-run
    const txBytes = await tx.build({ client: suiClient });

    // 2. Perform on-chain dry-run via Sui RPC
    const dryRunResult = await suiClient.dryRunTransactionBlock({
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
      const response = await fetch(
        `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SUI_FEED_ID}`
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
    if (success && oraclePrice) {
      // Find SUI and USDC balance changes
      const suiChange = dryRunResult.balanceChanges.find(
        (change: { coinType: string; amount: string }) => change.coinType === TOKENS.SUI
      );
      const usdcChange = dryRunResult.balanceChanges.find(
        (change: { coinType: string; amount: string }) => change.coinType === TOKENS.USDC
      );

      if (suiChange && usdcChange) {
        const suiAmount = Math.abs(parseFloat(suiChange.amount)) / 1e9; // 9 decimals
        const usdcAmount = Math.abs(parseFloat(usdcChange.amount)) / 1e6; // 6 decimals

        if (suiAmount > 0) {
          executionRate = usdcAmount / suiAmount;
          
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
    oraclePrice,
    oracleAge,
  };
};
