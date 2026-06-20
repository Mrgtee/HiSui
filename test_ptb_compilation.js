import { buildPTB } from './src/services/ptbBuilder.js';
import { runGuardianChecks } from './src/services/guardian.js';

// Test addresses
const SENDER = '0x17c0df61e7d0f19cdeaa5b7589cfc7ae85479b8ebd3fa068f11a5b7d2762281a'; // mock address

async function run() {
  try {
    console.log("Building SUI to USDC Swap and Deposit PTB...");
    const actions = [
      {
        type: 'swap',
        fromToken: 'SUI',
        toToken: 'USDC',
        amount: '500000000', // 0.5 SUI
      },
      {
        type: 'deposit',
        tokenType: 'USDC',
        amount: '10000', // 0.01 USDC
      }
    ];

    const tx = await buildPTB(actions, SENDER);
    console.log("PTB successfully built!");
    
    console.log("Running Guardian on-chain simulation...");
    const report = await runGuardianChecks(tx);
    console.log("Guardian Report:\n", JSON.stringify(report, null, 2));

  } catch (err) {
    console.error("Test execution failed:", err);
  }
}

run();
