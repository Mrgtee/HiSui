import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const API_KEY = (typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_GEMINI_API_KEY : undefined) || process.env.VITE_GEMINI_API_KEY || '';

export interface ParsedIntent {
  actions: {
    type: 'swap' | 'deposit' | 'transfer';
    fromToken?: string;
    toToken?: string;
    amount: string; // raw base units (e.g. MIST for SUI) as string integer, or "all_swapped"
    tokenType?: string; // used for deposit/transfer
    recipient?: string; // used for transfer SUI address
  }[];
  summary: string;
  clarificationRequired: boolean;
  clarificationMessage?: string;
}

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
   - Supported tokens: "SUI", "USDC", "USDT", "DEEP", "CETUS".

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
`;

export const parseUserIntent = async (
  query: string,
  balancesContext?: { SUI: string; USDC: string; USDT: string; DEEP: string; CETUS: string },
  walletAddress?: string
): Promise<ParsedIntent> => {
  if (!API_KEY) {
    throw new Error('Gemini API key is not configured in .env. Please copy your key to VITE_GEMINI_API_KEY.');
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
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
  
  try {
    const result = await model.generateContent(prompt, { timeout: 15000 });
    const responseText = result.response.text();
    try {
      return JSON.parse(responseText) as ParsedIntent;
    } catch (parseErr) {
      console.error('Failed to parse Gemini JSON response:', responseText, parseErr);
      throw new Error('AI returned an invalid JSON response structure. Please try again.');
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.includes('aborted') || err?.message?.includes('timeout')) {
      throw new Error('AI parsing request timed out. Please check your internet connection to the Gemini API and try again.');
    }
    throw err;
  }
};
