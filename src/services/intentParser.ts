// Remote API parsing config
const getBackendUrl = (): string => {
  if (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }
  if (typeof process !== 'undefined' && process.env && process.env.VITE_BACKEND_URL) {
    return process.env.VITE_BACKEND_URL;
  }
  return 'http://localhost:3001';
};

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

export const parseUserIntent = async (
  query: string,
  balancesContext?: { SUI: string; USDC: string; USDT: string; DEEP: string; CETUS: string },
  walletAddress?: string
): Promise<ParsedIntent> => {
  const backendUrl = getBackendUrl();
  const url = `${backendUrl}/api/parse`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, balancesContext, walletAddress }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const errText = await response.text();
      try {
        const errJson = JSON.parse(errText);
        throw new Error(errJson.error || errText);
      } catch (e) {
        throw new Error(`Failed to parse intent (HTTP ${response.status}): ${errText}`);
      }
    }

    return await response.json() as ParsedIntent;
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.includes('aborted') || err?.message?.includes('timeout')) {
      throw new Error('AI parsing request timed out. Please check your connection to the proxy server and try again.');
    }
    throw err;
  }
};
