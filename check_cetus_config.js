import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
const cetusSdk = initCetusSDK({ network: 'mainnet' });
console.log("Cetus SDK Mainnet Config:", JSON.stringify(cetusSdk.sdkOptions, null, 2));
