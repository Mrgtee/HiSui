import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
const cetusSdk = initCetusSDK({ network: 'testnet' });

function getMethods(obj) {
  let properties = new Set();
  let currentObj = obj;
  do {
    Object.getOwnPropertyNames(currentObj).map(item => properties.add(item));
  } while ((currentObj = Object.getPrototypeOf(currentObj)));
  return [...properties.keys()].filter(item => typeof obj[item] === 'function');
}

console.log("Swap methods:", getMethods(cetusSdk.Swap));
console.log("Pool methods:", getMethods(cetusSdk.Pool));
