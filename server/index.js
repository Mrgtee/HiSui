import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { genAddressSeed } from '@mysten/sui/zklogin';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Secret API Keys from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const SHINAMI_API_KEY = process.env.SHINAMI_API_KEY || process.env.VITE_SHINAMI_API_KEY || '';

// System instructions for the Gemini model
const SYSTEM_PROMPT = `
You are HiSui, a precise Web3 natural language compiler. Your job is to translate plain English user intents into a structured JSON payload representing on-chain actions on the SUI blockchain.

Available Actions:
1. SWAP:
   - Must specify: type="swap", fromToken, toToken, and amount.
   - Supported tokens: "SUI", "USDC", "USDT", "DEEP", "CETUS".
2. DEPOSIT:
   - Must specify: type="deposit", tokenType, and amount.
   - Supported tokens: "SUI", "USDC", "USDT", "DEEP", "CETUS".
3. TRANSFER:
   - Must specify: type="transfer", tokenType, recipient, and amount.
   - tokenType: The token symbol being transferred (e.g. "SUI", "USDC", "USDT", "DEEP", "CETUS"). Do NOT include or append destination address or other words in the tokenType field.
   - recipient: The destination SUI address (starting with "0x").
   - amount: The raw amount in base units (MIST for SUI).

Important decimal conversions:
- SUI has 9 decimals. If SUI is specified (e.g., "10 SUI"), multiply the amount by 1,000,000,000 (1e9) to convert to base units (represented as a string integer. E.g. "10" -> "10000000000").
- CETUS has 9 decimals. If CETUS is specified (e.g., "10 CETUS"), multiply the amount by 1,000,000,000 (1e9) to convert to base units (represented as a string integer. E.g. "10" -> "10000000000").
- USDC has 6 decimals. If USDC is specified (e.g., "5 USDC"), multiply the amount by 1,000,000 (1e6) to convert to base units (represented as a string integer. E.g. "5" -> "5000000").
- USDT has 6 decimals. If USDT is specified (e.g., "5 USDT"), multiply the amount by 1,000,000 (1e6) to convert to base units (represented as a string integer. E.g. "5" -> "5000000").
- DEEP has 6 decimals. If DEEP is specified (e.g., "5 DEEP"), multiply the amount by 1,000,000 (1e6) to convert to base units (represented as a string integer. E.g. "5" -> "5000000").

Resolving user balance keywords against context:
- If the user says "all my SUI" or "swap my entire SUI balance", check the Live SUI Balance in the context. Convert that entire SUI float amount to base units. (For example, if Live SUI Balance is "0.98", return "980000000" as the amount). NOTE: If the action is a SWAP or TRANSFER of "all" SUI, deduct a buffer of 0.05 SUI (50,000,000 MIST) for transaction gas fees, returning "930000000" instead of "980000000", to prevent out-of-gas errors.
- If the user says "half my SUI", check the SUI balance, divide by 2, and convert to base units.
- If the user says "swap half my SUI and deposit that USDC", the second action (deposit) should specify the amount as "all_swapped".
- If the user says "swap CETUS for SUI" without specifying an amount, or if they type general greetings/queries (e.g., "hi", "how are you", "what can you do?"), set clarificationRequired=true, and output a friendly clarification message asking them for the missing details.

Few-Shot Examples:
Example 1: "swap 0.5 SUI to CETUS"
Output:
{
  "actions": [{ "type": "swap", "fromToken": "SUI", "toToken": "CETUS", "amount": "500000000" }],
  "summary": "Swap 0.5 SUI to CETUS",
  "clarificationRequired": false
}

Example 2: "swap all my CETUS for USDC" (with Live CETUS Balance: 19.24)
Output:
{
  "actions": [{ "type": "swap", "fromToken": "CETUS", "toToken": "USDC", "amount": "19240000000" }],
  "summary": "Swap 19.24 CETUS for USDC",
  "clarificationRequired": false
}

Example 3: "swap SUI for USDT" (no amount)
Output:
{
  "actions": [],
  "summary": "Request SUI/USDT Swap clarification",
  "clarificationRequired": true,
  "clarificationMessage": "How much SUI would you like to swap for USDT?"
}

Example 4: "send 0.1 SUI to 0x154fb6dbd7af51b381a28907b2b2c0fa1a92f2553d147857e53e09d10d3e9612"
Output:
{
  "actions": [
    {
      "type": "transfer",
      "tokenType": "SUI",
      "recipient": "0x154fb6dbd7af51b381a28907b2b2c0fa1a92f2553d147857e53e09d10d3e9612",
      "amount": "100000000"
    }
  ],
  "summary": "Transfer 0.1 SUI to 0x154fb6dbd7af51b381a28907b2b2c0fa1a92f2553d147857e53e09d10d3e9612",
  "clarificationRequired": false
}
`;

// Helper function to decode JWT claims on the server
function decodeJwt(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  return JSON.parse(payloadJson);
}

// Helper to convert BigInt to base64 encoding (matching the SDK serialization requirements)
function bigIntToBase64(n) {
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  return Buffer.from(hex, 'hex').toString('base64');
}

// --- Endpoints ---

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// 1. AI Intent Parsing Endpoint
app.post('/api/parse', async (req, res) => {
  const { query, balancesContext, walletAddress } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            actions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  type: { type: SchemaType.STRING, format: 'enum', enum: ['swap', 'deposit', 'transfer'] },
                  fromToken: { type: SchemaType.STRING },
                  toToken: { type: SchemaType.STRING },
                  amount: { type: SchemaType.STRING },
                  tokenType: { type: SchemaType.STRING },
                  recipient: { type: SchemaType.STRING }
                },
                required: ['type', 'amount']
              }
            },
            summary: { type: SchemaType.STRING },
            clarificationRequired: { type: SchemaType.BOOLEAN },
            clarificationMessage: { type: SchemaType.STRING }
          },
          required: ['actions', 'summary', 'clarificationRequired']
        }
      }
    });

    let contextPrompt = '';
    if (balancesContext) {
      contextPrompt = `
User Wallet Context:
- Connected Address: ${walletAddress || 'Unknown'}
- Live SUI Balance: ${balancesContext.SUI} SUI (1 SUI = 1,000,000,000 MIST)
- Live USDC Balance: ${balancesContext.USDC} USDC (1 USDC = 1,000,000 base units)
- Live USDT Balance: ${balancesContext.USDT} USDT (1 USDT = 1,000,000 base units)
- Live DEEP Balance: ${balancesContext.DEEP} DEEP (1 DEEP = 1,000,000 base units)
- Live CETUS Balance: ${balancesContext.CETUS} CETUS (1 CETUS = 1,000,000,000 base units)
`;
    }

    const prompt = `System Instructions:
${SYSTEM_PROMPT}
${contextPrompt}
User Query:
"${query}"`;

    const result = await model.generateContent(prompt, { timeout: 15000 });
    const responseText = result.response.text();
    const parsed = JSON.parse(responseText);
    res.json(parsed);

  } catch (err) {
    console.error('Error in intent parsing:', err);
    res.status(500).json({ error: err.message || 'Failed to parse intent' });
  }
});

// 2. zkLogin Proving Endpoint
app.post('/api/prove', async (req, res) => {
  const { jwt, maxEpoch, ephemeralPublicKey, extendedEphemeralPublicKey, jwtRandomness, salt, network } = req.body;

  if (!jwt || !maxEpoch || !jwtRandomness || !salt) {
    return res.status(400).json({ error: 'Missing required zkLogin parameters (jwt, maxEpoch, jwtRandomness, salt)' });
  }

  try {
    // If Shinami API Key is provided, use Shinami
    if (SHINAMI_API_KEY) {
      const proverUrl = `https://api.us1.shinami.com/sui/zkprover/v1/${SHINAMI_API_KEY}`;
      
      const payload = {
        jsonrpc: '2.0',
        method: 'shinami_zkp_createZkLoginProof',
        params: [
          jwt,
          maxEpoch.toString(),
          ephemeralPublicKey,
          bigIntToBase64(BigInt(jwtRandomness)),
          bigIntToBase64(BigInt(salt)),
          'sub'
        ],
        id: 1,
      };

      const response = await fetch(proverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Shinami Prover returned HTTP ${response.status}: ${errText}`);
      }

      const resJson = await response.json();
      if (resJson.error) {
        throw new Error(`Shinami Prover error: ${resJson.error.message || JSON.stringify(resJson.error)}`);
      }

      if (!resJson.result || !resJson.result.zkProof) {
        throw new Error(`Shinami Prover returned invalid response: ${JSON.stringify(resJson.result)}`);
      }

      const decoded = decodeJwt(jwt);
      const sub = decoded.sub;
      const aud = Array.isArray(decoded.aud) ? decoded.aud[0] : decoded.aud;
      const addressSeed = genAddressSeed(salt, 'sub', sub, aud).toString();

      return res.json({
        ...resJson.result.zkProof,
        addressSeed,
      });
    }

    // Fallback to Mysten Labs Public Provers
    const proverUrl = network === 'mainnet'
      ? 'https://prover.mystenlabs.com/v1'
      : 'https://prover-dev.mystenlabs.com/v1';

    if (!extendedEphemeralPublicKey) {
      return res.status(400).json({ error: 'extendedEphemeralPublicKey is required for Mysten public prover fallback' });
    }

    const payload = {
      jwt,
      extendedEphemeralPublicKey,
      maxEpoch,
      jwtRandomness,
      salt,
      keyClaimName: 'sub',
    };

    const response = await fetch(proverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Mysten Prover returned HTTP ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    res.json(resJson);

  } catch (err) {
    console.error('Error in proof generation:', err);
    res.status(500).json({ error: err.message || 'Failed to generate ZK proof' });
  }
});

app.listen(PORT, () => {
  console.log(`HiSui Backend Proxy server running on port ${PORT}`);
});
