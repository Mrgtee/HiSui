import https from 'https';
import { URL } from 'url';

// Mock global.fetch using https.request to bypass undici WSL issues, supporting GET/POST
global.fetch = function(urlStr: any, options: any = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      
      // Mock Pyth hermes API immediately to bypass WSL TCP handshake timeouts
      if (url.hostname.includes('hermes.pyth.network')) {
        const mockPythResponse = {
          parsed: [
            {
              price: {
                price: "175000000",
                expo: -8,
                publish_time: Math.floor(Date.now() / 1000)
              }
            }
          ]
        };
        resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPythResponse),
          text: () => Promise.resolve(JSON.stringify(mockPythResponse))
        } as any);
        return;
      }

      const method = options.method || 'GET';
      const headers: Record<string, string> = {};
      
      if (options.headers) {
        if (typeof options.headers.forEach === 'function') {
          options.headers.forEach((val: string, key: string) => {
            headers[key] = val;
          });
        } else {
          Object.assign(headers, options.headers);
        }
      }
      
      const reqOptions: https.RequestOptions = {
        method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        headers,
      };
      
      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => {
              try {
                return Promise.resolve(JSON.parse(data));
              } catch (e) {
                return Promise.reject(new Error(`Failed to parse JSON: ${data}`, { cause: e }));
              }
            },
            text: () => Promise.resolve(data)
          } as any);
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
} as any;

import { buildPTB } from './src/services/ptbBuilder';
import { runGuardianChecks } from './src/services/guardian';

// Test addresses
const SENDER = '0x5e56d7faeb76ca2d6ec2966d192948901a4742cf429304d778d7bee8df4122a0'; // funded address

async function run() {
  try {
    console.log("Building SUI to USDC Swap and Deposit PTB...");
    const actions = [
      {
        type: 'swap' as const,
        fromToken: 'SUI',
        toToken: 'USDC',
        amount: '500000000', // 0.5 SUI
      }
    ];

    const tx = await buildPTB(actions, SENDER, 'testnet');
    console.log("PTB successfully built!");
    
    console.log("Running Guardian on-chain simulation...");
    const report = await runGuardianChecks(tx, 'testnet');
    console.log("Guardian Report:\n", JSON.stringify(report, null, 2));

  } catch (err) {
    console.error("Test execution failed:", err);
  }
}

run();
