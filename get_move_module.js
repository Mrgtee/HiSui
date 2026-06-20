import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

// We will try to fetch the module 'pool_script' from the package IDs we've encountered
const packages = [
  '0xcee0662fe38685002fe38685002fe38685002fe38685002fe38685002fe38685',
  '0x0868b71c0cba55bf0faf6c40df8c179c67a4d0ba0e79965b68b3d72d7dfbf666',
  '0x2918cf39850de6d5d94d8196dc878c8c722cd79db659318e00bff57fbb4e2ede',
  '0xf5ff7d5ba73b581bca6b4b9fa0049cd320360abd154b809f8700a8fd3cfaf7ca'
];

async function run() {
  for (const pkg of packages) {
    try {
      console.log(`\nFetching pool_script module for package: ${pkg}`);
      const moduleInfo = await suiClient.getNormalizedMoveModule({
        package: pkg,
        module: 'pool_script'
      });
      console.log(`Successfully fetched! Functions in pool_script:`);
      for (const [funcName, funcData] of Object.entries(moduleInfo.exposedFunctions)) {
        if (funcName.includes('swap')) {
          console.log(`\n  Function: ${funcName}`);
          console.log(`    Is Entry: ${funcData.isEntry}`);
          console.log(`    Parameters:`, JSON.stringify(funcData.parameters, null, 2));
        }
      }
    } catch (err) {
      console.error(`Failed to fetch for ${pkg}:`, err.message);
    }
  }
}

run();
