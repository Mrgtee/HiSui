import * as navi from '@naviprotocol/lending';

console.log("MARKETS:", JSON.stringify(navi.MARKETS, null, 2));
console.log("getConfig testnet:", JSON.stringify(navi.getConfig('testnet'), null, 2));
console.log("getConfig dev:", JSON.stringify(navi.getConfig('dev'), null, 2));
console.log("getConfig mainnet:", JSON.stringify(navi.getConfig('mainnet'), null, 2));
