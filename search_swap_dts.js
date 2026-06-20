import fs from 'fs';

const content = fs.readFileSync('node_modules/@cetusprotocol/cetus-sui-clmm-sdk/dist/index.d.ts', 'utf8');
const lines = content.split('\n');

console.log("Searching for swap methods...");
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(' swap') || lines[i].includes('Swap') || lines[i].includes('swapTransaction')) {
    console.log(`${i + 1}: ${lines[i].trim()}`);
  }
}
