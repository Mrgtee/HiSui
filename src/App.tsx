import { useState, useEffect, useCallback } from 'react';
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClientContext } from '@mysten/dapp-kit';
import { 
  Bot, 
  Send, 
  Wallet, 
  ShieldCheck, 
  Sparkles, 
  AlertTriangle, 
  Loader2, 
  LogOut, 
  ArrowRight,
  Coins
} from 'lucide-react';
import { getGoogleOAuthUrl, extractIdTokenFromUrl } from './services/oauth';
import { 
  getOrGenerateSalt, 
  setupZkLoginSession, 
  getStoredSession, 
  deriveZkAddress, 
  getZkProof,
} from './services/zkLogin';
import type { ZkLoginSession } from './services/zkLogin';
import { getCurrentEpoch, getSuiClient } from './services/suiClient';
import { parseUserIntent } from './services/intentParser';
import type { ParsedIntent } from './services/intentParser';
import { buildPTB } from './services/ptbBuilder';
import { runGuardianChecks } from './services/guardian';
import type { GuardianReport } from './services/guardian';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
  intent?: ParsedIntent;
  txDigest?: string;
  error?: boolean;
}

const getTokenDecimals = (symbol: string): number => {
  const clean = symbol?.toUpperCase();
  if (clean === 'SUI' || clean === 'CETUS') return 9;
  return 6; // USDC, USDT, DEEP
};

function App() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTxb } = useSignAndExecuteTransaction();

  // Network Switcher State from dApp Kit context
  const { network: activeNetwork, selectNetwork } = useSuiClientContext();
  const network = activeNetwork as 'mainnet' | 'testnet';

  // zkLogin States
  const [jwt, setJwt] = useState<string | null>(null);
  const [zkAddress, setZkAddress] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [zkProof, setZkProof] = useState<any | null>(null);
  const [zkSession, setZkSession] = useState<ZkLoginSession | null>(null);
  const [isZkLoading, setIsZkLoading] = useState(false);

  // App States
  const [balance, setBalance] = useState({ SUI: '0', USDC: '0', USDT: '0', DEEP: '0', CETUS: '0' });
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: 'bot',
      text: 'Hello! I am HiSui, your AI Web3 Intent Assistant. Tell me what you want to do on Sui (e.g. "Swap 5 SUI for USDC and deposit it in NAVI"), and I will compile the transaction block, verify it for slippage and oracle freshness, and help you sign it.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [activeIntent, setActiveIntent] = useState<ParsedIntent | null>(null);
  const [activeReport, setActiveReport] = useState<GuardianReport | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [executionTx, setExecutionTx] = useState<Transaction | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const activeWalletAddress = currentAccount?.address || zkAddress;

  // Handle zkLogin redirect callback on mount
  useEffect(() => {
    const handleCallback = async () => {
      const idToken = extractIdTokenFromUrl();
      if (idToken) {
        // Clear url hash
        window.location.hash = '';
        setJwt(idToken);
        sessionStorage.setItem('zklogin_jwt', idToken);
        
        setIsZkLoading(true);
        try {
          const salt = getOrGenerateSalt();
          const address = deriveZkAddress(idToken, salt);
          setZkAddress(address);

          const session = getStoredSession();
          if (session) {
            setZkSession(session);
            // Fetch ZK proof from prover
            const proof = await getZkProof(idToken, session, salt);
            setZkProof(proof);
          }
        } catch (err) {
          console.error('Failed to initialize zkLogin address/proof:', err);
        } finally {
          setIsZkLoading(false);
        }
      } else {
        // Check if session is already stored
        const storedJwt = sessionStorage.getItem('zklogin_jwt');
        const session = getStoredSession();
        if (storedJwt && session) {
          setJwt(storedJwt);
          setZkSession(session);
          setIsZkLoading(true);
          try {
            const salt = getOrGenerateSalt();
            const address = deriveZkAddress(storedJwt, salt);
            setZkAddress(address);
            
            const proof = await getZkProof(storedJwt, session, salt);
            setZkProof(proof);
          } catch (err) {
            console.error('Failed to load stored zkLogin details:', err);
          } finally {
            setIsZkLoading(false);
          }
        }
      }
    };

    handleCallback();
  }, []);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!activeWalletAddress) return;
    try {
      const client = getSuiClient(network);
      // Fetch SUI
      const suiBal = await client.getBalance({
        owner: activeWalletAddress,
        coinType: '0x2::sui::SUI',
      });

      // Configs per network
      const tokenConfigs = {
        mainnet: {
          USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          USDT: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
          DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
          CETUS: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
        },
        testnet: {
          USDC: '0x0588cff950e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC',
          USDT: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::usdt::USDT',
          CETUS: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::cetus::CETUS',
          DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
        }
      };

      const cfg = tokenConfigs[network];

      const [usdcBal, usdtBal, deepBal, cetusBal] = await Promise.all([
        client.getBalance({ owner: activeWalletAddress, coinType: cfg.USDC }),
        client.getBalance({ owner: activeWalletAddress, coinType: cfg.USDT }),
        client.getBalance({ owner: activeWalletAddress, coinType: cfg.DEEP }),
        client.getBalance({ owner: activeWalletAddress, coinType: cfg.CETUS }),
      ]);

      setBalance({
        SUI: (parseInt(suiBal.totalBalance, 10) / 1e9).toFixed(3),
        USDC: (parseInt(usdcBal.totalBalance, 10) / 1e6).toFixed(2),
        USDT: (parseInt(usdtBal.totalBalance, 10) / 1e6).toFixed(2),
        DEEP: (parseInt(deepBal.totalBalance, 10) / 1e6).toFixed(2),
        CETUS: (parseInt(cetusBal.totalBalance, 10) / 1e9).toFixed(2),
      });
    } catch (err) {
      console.warn('Failed to fetch wallet balance:', err);
    }
  }, [activeWalletAddress, network]);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 10000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  // Google Sign-In Trigger
  const handleGoogleLogin = async () => {
    setIsZkLoading(true);
    try {
      const clientId = (typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_GOOGLE_CLIENT_ID : undefined) || process.env.VITE_GOOGLE_CLIENT_ID || '';
      if (!clientId) {
        alert('Google OAuth Client ID is missing. Add it to VITE_GOOGLE_CLIENT_ID in your .env file.');
        setIsZkLoading(false);
        return;
      }
      const epoch = await getCurrentEpoch(network);
      const redirectUri = window.location.origin;
      
      const { nonce } = setupZkLoginSession(epoch);
      const googleAuthUrl = getGoogleOAuthUrl(clientId, redirectUri, nonce);
      
      window.location.href = googleAuthUrl;
    } catch (err) {
      console.error('Failed to initiate Google zkLogin:', err);
      setIsZkLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.clear();
    setJwt(null);
    setZkAddress(null);
    setZkProof(null);
    setZkSession(null);
    setBalance({ SUI: '0', USDC: '0', USDT: '0', DEEP: '0', CETUS: '0' });
  };

  // Submit plain English query
  const handleSend = async () => {
    if (!input.trim() || isParsing) return;
    const userQuery = input.trim();
    setInput('');

    setMessages((prev) => [...prev, { sender: 'user', text: userQuery }]);

    if (!activeWalletAddress) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: 'Please connect a wallet or log in via zkLogin before submitting queries.',
          error: true,
        },
      ]);
      return;
    }

    setIsParsing(true);
    setActiveIntent(null);
    setActiveReport(null);

    try {
      // 1. AI Intent Parsing (Gemini API)
      const parsedIntent = await parseUserIntent(userQuery);
      
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: `I have compiled your intent: "${parsedIntent.summary}". Generating simulated dry-run...`,
          intent: parsedIntent,
        },
      ]);

      setActiveIntent(parsedIntent);
      
      // 2. Build PTB and Run Guardian Simulation
      setIsSimulating(true);
      const tx = await buildPTB(parsedIntent.actions, activeWalletAddress, network);
      setExecutionTx(tx);
      
      const report = await runGuardianChecks(tx, network);
      setActiveReport(report);

      if (!report.success) {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: `⚠️ Guardian Alert: The transaction simulation failed with error: ${report.error}. Execution is blocked.`,
            error: true,
          },
        ]);
      }

    } catch (err: unknown) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: `Failed to compile intent: ${(err as Error).message || 'Unknown error'}`,
          error: true,
        },
      ]);
    } finally {
      setIsParsing(false);
      setIsSimulating(false);
    }
  };

  // Execute the compiled transaction block
  const handleExecute = async () => {
    if (!activeWalletAddress || !executionTx || isExecuting) return;
    setIsExecuting(true);

    try {
      let digest = '';

      if (zkAddress && zkProof && zkSession && jwt) {
        // Execute using zkLogin Session Key
        const keypair = Ed25519Keypair.fromSecretKey(zkSession.ephemeralPrivateKey);
        const client = getSuiClient(network);
        
        // Build transaction bytes
        const txBytes = await executionTx.build({ client });
        
        // Sign transaction with ephemeral keypair
        const { signature: userSignature } = await executionTx.sign({
          client,
          signer: keypair,
        });

        // Assemble the final zkLogin signature
        const zkSignature = getZkLoginSignature({
          inputs: {
            ...zkProof,
            addressSeed: zkProof.addressSeed,
          },
          maxEpoch: zkSession.maxEpoch,
          userSignature,
        });

        // Submit the transaction
        const response = await client.executeTransactionBlock({
          transactionBlock: txBytes,
          signature: zkSignature,
        });

        digest = response.digest;
      } else {
        // Execute using standard browser wallet
        const response = await signAndExecuteTxb({
          transaction: executionTx,
        });
        digest = response.digest;
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: `Success! Your transaction has been executed.`,
          txDigest: digest,
        },
      ]);

      // Reset
      setActiveIntent(null);
      setActiveReport(null);
      setExecutionTx(null);
      fetchBalances();

    } catch (err: unknown) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: `Execution failed: ${(err as Error).message || 'User rejected or network error'}`,
          error: true,
        },
      ]);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-dark text-zinc-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-border-dark px-6 py-4 flex justify-between items-center bg-card-dark/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-purple-600 p-2 rounded-xl flex items-center justify-center shadow-lg shadow-purple-600/30">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              HiSui
              <select
                value={network}
                onChange={(e) => selectNetwork(e.target.value as 'mainnet' | 'testnet')}
                className="bg-purple-600/20 text-purple-400 border border-purple-600/30 text-[10px] font-semibold px-2 py-0.5 rounded-full focus:outline-none cursor-pointer hover:bg-purple-600/30 transition-colors"
              >
                <option value="mainnet" className="bg-zinc-950 text-zinc-100">Mainnet</option>
                <option value="testnet" className="bg-zinc-950 text-zinc-100">Testnet</option>
              </select>
            </h1>
            <p className="text-xs text-zinc-500">AI Web3 Intent Engine & Guardian</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {activeWalletAddress && (
            <div className="hidden lg:flex items-center gap-4 bg-zinc-900 border border-border-dark px-4 py-2 rounded-xl">
              <div className="flex items-center gap-2 border-r border-border-dark pr-4">
                <Coins className="h-4 w-4 text-purple-400" />
                <span className="text-sm font-semibold">{balance.SUI} SUI</span>
              </div>
              <div className="flex items-center gap-2 border-r border-border-dark pr-4">
                <span className="text-sm font-semibold text-emerald-400">{balance.USDC} USDC</span>
              </div>
              <div className="flex items-center gap-2 border-r border-border-dark pr-4">
                <span className="text-sm font-semibold text-teal-400">{balance.USDT} USDT</span>
              </div>
              <div className="flex items-center gap-2 border-r border-border-dark pr-4">
                <span className="text-sm font-semibold text-blue-400">{balance.DEEP} DEEP</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-amber-400">{balance.CETUS} CETUS</span>
              </div>
            </div>
          )}

          {/* Connection Controls */}
          <div className="flex items-center gap-2">
            {!activeWalletAddress ? (
              <>
                <button
                  onClick={handleGoogleLogin}
                  disabled={isZkLoading}
                  className="flex items-center gap-2 bg-white text-zinc-950 font-semibold px-4 py-2 rounded-xl hover:bg-zinc-100 transition-colors text-sm shadow-sm"
                >
                  {isZkLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-950" />
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                  )}
                  Google Sign-In
                </button>
                <div className="theme-dapp-kit-connect">
                  <ConnectButton connectText="Connect Wallet" />
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                {zkAddress ? (
                  <div className="flex items-center gap-2 bg-zinc-900 border border-border-dark pl-4 pr-2 py-1.5 rounded-xl">
                    <span className="text-xs text-zinc-400 font-mono">
                      {zkAddress.slice(0, 6)}...{zkAddress.slice(-4)}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="text-zinc-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
                      title="Log Out zkLogin"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="theme-dapp-kit-connect">
                    <ConnectButton />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Side: Conversational Chat */}
        <section className="flex-1 flex flex-col border-r border-border-dark bg-zinc-950/20">
          {/* Messages Log */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-3 max-w-[85%] ${
                  msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''
                }`}
              >
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 shadow-md ${
                    msg.sender === 'user'
                      ? 'bg-purple-600/30 border border-purple-600/30'
                      : 'bg-zinc-900 border border-border-dark'
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <Wallet className="h-4 w-4 text-purple-400" />
                  ) : (
                    <Bot className="h-4 w-4 text-purple-400" />
                  )}
                </div>

                <div
                  className={`p-4 rounded-2xl border text-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-purple-600/10 border-purple-600/20 text-zinc-100 rounded-tr-none'
                      : msg.error
                      ? 'bg-red-500/10 border-red-500/25 text-red-300 rounded-tl-none'
                      : 'bg-card-dark border-border-dark text-zinc-300 rounded-tl-none'
                  }`}
                >
                  <p>{msg.text}</p>
                  
                  {msg.intent && (
                    <div className="mt-3 bg-zinc-950/40 border border-border-dark p-3 rounded-xl flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-purple-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Intent Compiled
                      </div>
                      <p className="text-xs text-zinc-400 font-semibold">{msg.intent.summary}</p>
                    </div>
                  )}

                  {msg.txDigest && (
                    <div className="mt-3 bg-emerald-500/5 border border-emerald-500/20 p-3 rounded-xl flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-emerald-400">Transaction Confirmed:</span>
                      <a
                        href={`https://suiscan.xyz/${network}/tx/${msg.txDigest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-purple-400 underline break-all font-mono"
                      >
                        {msg.txDigest}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isParsing && (
              <div className="flex gap-3 items-center text-xs text-zinc-500 italic">
                <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                HiSui is parsing your intent...
              </div>
            )}
          </div>

          {/* Typing Area */}
          <div className="p-4 border-t border-border-dark bg-card-dark/25">
            <div className="relative flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={
                  activeWalletAddress
                    ? 'e.g. Swap 5 SUI for USDC and deposit it in NAVI'
                    : 'Connect wallet or zkLogin to begin...'
                }
                disabled={!activeWalletAddress || isParsing}
                className="w-full bg-zinc-900 border border-border-dark rounded-xl pl-4 pr-12 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isParsing}
                className="absolute right-2 p-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg transition-colors flex items-center justify-center"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Right Side: Intent Preview & Guardian Risk Checklist */}
        <section className="w-[450px] flex flex-col bg-card-dark/30 p-6 overflow-y-auto space-y-6">
          <div className="flex items-center gap-2 pb-4 border-b border-border-dark">
            <ShieldCheck className="h-5 w-5 text-purple-400" />
            <h2 className="font-bold text-white tracking-tight">Intent & Guardian Preview</h2>
          </div>

          {!activeIntent ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-zinc-500 px-4 py-20">
              <Bot className="h-12 w-12 text-zinc-700 mb-3" />
              <p className="text-sm font-semibold">No active intent compiled yet.</p>
              <p className="text-xs text-zinc-600 mt-1">Submit a plain English goal in the chat, and the compiled block will appear here for verification.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Intent Summary Card */}
              <div className="bg-zinc-900 border border-border-dark p-5 rounded-2xl flex flex-col gap-3 shadow-md">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Proposed Flow</span>
                  <span className="text-[10px] bg-purple-600/20 text-purple-400 px-2.5 py-0.5 rounded-full font-semibold">PTB Block</span>
                </div>
                <p className="text-sm font-bold text-white">{activeIntent.summary}</p>

                {/* Steps Visualizer */}
                <div className="mt-2 space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[2px] before:bg-zinc-800">
                  {activeIntent.actions.map((act, index) => (
                    <div key={index} className="flex gap-4 items-start pl-6 relative">
                      <div className="absolute left-1.5 h-3.5 w-3.5 rounded-full bg-purple-600 border-4 border-zinc-900 flex items-center justify-center" />
                      <div className="flex-1 bg-zinc-950/50 border border-border-dark p-3 rounded-xl flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-zinc-500 uppercase">{act.type}</span>
                          <p className="text-xs text-zinc-200 mt-0.5">
                            {act.type === 'swap' 
                              ? `Swap ${parseFloat(act.amount) / Math.pow(10, getTokenDecimals(act.fromToken || 'SUI'))} ${act.fromToken} for ${act.toToken}` 
                              : `Deposit ${act.amount === 'all_swapped' ? 'all swapped assets' : parseFloat(act.amount) / Math.pow(10, getTokenDecimals(act.tokenType || 'USDC'))} ${act.tokenType || 'USDC'} into NAVI`
                            }
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-zinc-600" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Guardian Checks Panel */}
              <div className="bg-zinc-900 border border-border-dark p-5 rounded-2xl flex flex-col gap-4 shadow-md">
                <div className="flex items-center gap-2 border-b border-border-dark pb-3">
                  <ShieldCheck className="h-4 w-4 text-purple-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Guardian Simulation</span>
                </div>

                {isSimulating ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
                    <span className="text-xs text-zinc-500 italic">Running on-chain dry-run...</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Simulation Status */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Dry-run Simulation:</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        activeReport?.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {activeReport?.success ? 'COMPILING SUCCESS' : 'SIMULATION FAIL'}
                      </span>
                    </div>

                    {/* Dynamic Rates */}
                    {activeReport?.oraclePrice && (
                      <div className="flex justify-between items-center text-xs border-b border-border-dark pb-2">
                        <span className="text-zinc-400">Oracle SUI/USD Price:</span>
                        <span className="font-semibold text-white">${activeReport.oraclePrice.toFixed(4)}</span>
                      </div>
                    )}
                    {activeReport?.executionRate && (
                      <div className="flex justify-between items-center text-xs border-b border-border-dark pb-2">
                        <span className="text-zinc-400">Cetus Execution Rate:</span>
                        <span className="font-semibold text-white">{activeReport.executionRate.toFixed(4)} {activeReport.executionSymbol || 'USDC'}/SUI</span>
                      </div>
                    )}

                    {/* Warnings List */}
                    {activeReport?.warnings && activeReport.warnings.length > 0 && (
                      <div className="space-y-2">
                        {activeReport.warnings.map((warn, i) => (
                          <div
                            key={i}
                            className={`flex gap-2.5 p-3 rounded-xl border text-xs leading-relaxed ${
                              warn.level === 'danger'
                                ? 'bg-red-500/10 border-red-500/20 text-red-300'
                                : warn.level === 'warning'
                                ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
                                : 'bg-zinc-950/40 border-border-dark text-zinc-400'
                            }`}
                          >
                            <AlertTriangle className={`h-4 w-4 shrink-0 ${
                              warn.level === 'danger' ? 'text-red-400' : warn.level === 'warning' ? 'text-yellow-400' : 'text-zinc-500'
                            }`} />
                            <div>{warn.message}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Execution Action */}
              <button
                onClick={handleExecute}
                disabled={isExecuting || !activeReport?.success}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-600 font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-purple-600/15 disabled:shadow-none"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing & Executing Block...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Approve & Sign Transaction
                  </>
                )}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
