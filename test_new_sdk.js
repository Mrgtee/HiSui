import { CetusClmmSDK } from '@cetusprotocol/sui-clmm-sdk';

try {
  const sdk = CetusClmmSDK.createSDK({ env: 'testnet' });
  console.log("New SDK Config Options:\n", JSON.stringify(sdk.sdkOptions, null, 2));
} catch (err) {
  console.error("Error creating SDK:", err);
}
