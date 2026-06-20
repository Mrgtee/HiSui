import { depositCoinPTB } from '@naviprotocol/lending';
import { Transaction } from '@mysten/sui/transactions';

const oldUSDC = '0x0588cff9a50e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC';
const newUSDC = '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::usdc::USDC';

async function test(usdcType) {
  try {
    const tx = new Transaction();
    // Split SUI just as dummy input
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1000000)]);
    
    console.log(`\nTesting depositCoinPTB for USDC: ${usdcType}`);
    await depositCoinPTB(tx, usdcType, coin, {
      amount: 1000000,
      env: 'dev', // Testnet
    });
    console.log("Success! Move Calls created in PTB:");
    console.log(JSON.stringify(tx.getData(), null, 2));
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

async function run() {
  await test(oldUSDC);
  await test(newUSDC);
}

run();
