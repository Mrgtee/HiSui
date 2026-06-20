import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';

const cetusSdk = initCetusSDK({ network: 'testnet' });
cetusSdk.senderAddress = '0xdbf4cb94558679ef5e257a83f6e7d5d999432b7295f9d599e11ce7ed27f639b5';

async function run() {
  try {
    const oldPoolMock = {
      poolAddress: '0xcf39cbb87a6d8d9753df1821037bd7117e2906494428cf252621037bd7117e29',
      objectId: '0xcf39cbb87a6d8d9753df1821037bd7117e29',
      coinTypeA: '0x2::sui::SUI',
      coinTypeB: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::usdc::USDC',
      current_sqrt_price: '4294967296',
      fee_rate: '2500',
      is_pause: false,
      liquidity: '100000000',
      tickSpacing: 60,
    };

    console.log("Building swap payload using SDK...");
    const payload = await cetusSdk.Swap.createSwapTransactionPayload({
      pool: oldPoolMock,
      a2b: true,
      byAmountIn: true,
      amount: '100000000',
      amountLimit: '0',
    });

    console.log("Payload:", JSON.stringify(payload, null, 2));

  } catch (err) {
    console.error("Error building swap:", err);
  }
}

run();
