import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = (typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_GEMINI_API_KEY : undefined) || process.env.VITE_GEMINI_API_KEY || '';

export interface ParsedIntent {
  actions: {
    type: 'swap' | 'deposit';
    fromToken?: string;
    toToken?: string;
    amount: string; // base units (e.g. MIST for SUI)
    tokenType?: string; // used for deposit
  }[];
  summary: string;
}

const SYSTEM_PROMPT = `
You are HiSui, a precise Web3 natural language compiler. Your job is to translate plain English user intents into a structured JSON payload representing on-chain actions on the Sui blockchain.

Available Actions:
1. SWAP:
   - Must specify: type="swap", fromToken, toToken, and amount.
   - Supported tokens: "SUI", "USDC", "USDT", "DEEP", "CETUS".
2. DEPOSIT:
   - Must specify: type="deposit", tokenType, and amount.
   - Supported tokens: "SUI", "USDC", "USDT", "DEEP", "CETUS".

Important decimal conversions:
- SUI has 9 decimals. If SUI is specified (e.g., "10 SUI"), multiply the amount by 1,000,000,000 (1e9) to convert to base units (represented as a string integer. E.g. "10" -> "10000000000").
- CETUS has 9 decimals. If CETUS is specified (e.g., "10 CETUS"), multiply the amount by 1,000,000,000 (1e9) to convert to base units (represented as a string integer. E.g. "10" -> "10000000000").
- USDC has 6 decimals. If USDC is specified (e.g., "5 USDC"), multiply the amount by 1,000,000 (1e6) to convert to base units (represented as a string integer. E.g. "5" -> "5000000").
- USDT has 6 decimals. If USDT is specified (e.g., "5 USDT"), multiply the amount by 1,000,000 (1e6) to convert to base units (represented as a string integer. E.g. "5" -> "5000000").
- DEEP has 6 decimals. If DEEP is specified (e.g., "5 DEEP"), multiply the amount by 1,000,000 (1e6) to convert to base units (represented as a string integer. E.g. "5" -> "5000000").
- If the user says "swap half my SUI and deposit that USDC", the second action (deposit) should specify the amount as "all_swapped".

You MUST respond with a valid JSON object matching this schema:
{
  "actions": [
    {
      "type": "swap",
      "fromToken": "SUI",
      "toToken": "USDC",
      "amount": "10000000000"
    },
    {
      "type": "deposit",
      "tokenType": "USDC",
      "amount": "all_swapped"
    }
  ],
  "summary": "Swap 10 SUI to USDC and deposit the USDC into NAVI"
}

Do not include any explanation or markdown formatting (no backticks). Return raw JSON.
`;

export const parseUserIntent = async (query: string): Promise<ParsedIntent> => {
  if (!API_KEY) {
    throw new Error('Gemini API key is not configured in .env. Please copy your key to VITE_GEMINI_API_KEY.');
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const prompt = `System Instructions:\n${SYSTEM_PROMPT}\n\nUser Query:\n"${query}"`;
  
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  
  try {
    return JSON.parse(responseText) as ParsedIntent;
  } catch (err) {
    console.error('Failed to parse Gemini response:', responseText, err);
    throw new Error('AI returned an invalid JSON response structure. Please try again.', { cause: err });
  }
};
