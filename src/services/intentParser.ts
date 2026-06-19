import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

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
   - SUI type: "SUI".
   - USDC type: "USDC".
2. DEPOSIT:
   - Must specify: type="deposit", tokenType, and amount.

Important decimal conversions:
- SUI has 9 decimals. If the user specifies SUI (e.g. "10 SUI", "5.5 SUI"), you MUST multiply the amount by 1,000,000,000 to convert to base MIST units (represented as a string integer. E.g., "10" -> "10000000000").
- USDC has 6 decimals. If the user specifies USDC (e.g. "5 USDC"), you MUST multiply the amount by 1,000,000 to convert to base units (represented as a string integer. E.g., "5" -> "5000000").
- If the user says "swap half my SUI and deposit that USDC", the second action (deposit) should specify the amount as "all_swapped" or you can compute the equivalent base units if a specific value is known.

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
