import { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClientContext } from '@mysten/dapp-kit';
import { 
  Send, 
  Wallet, 
  ShieldCheck, 
  Sparkles, 
  AlertTriangle, 
  Loader2, 
  LogOut, 
  ArrowRight,
  Coins,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  X,
  Menu
} from 'lucide-react';
import { getGoogleOAuthUrl, extractIdTokenFromUrl } from './services/oauth';
import { 
  getOrGenerateSalt, 
  setupZkLoginSession, 
  getStoredSession, 
  deriveZkAddress, 
  getZkProof,
  decodeJwt,
} from './services/zkLogin';
import type { ZkLoginSession } from './services/zkLogin';
import { getCurrentEpoch, getSuiClient } from './services/suiClient';
import { parseUserIntent } from './services/intentParser';
import type { ParsedIntent } from './services/intentParser';
import { buildPTB, getCoinOfAmount, NETWORK_CONFIG } from './services/ptbBuilder';
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

const TokenLogo = ({ symbol, className = "h-5 w-5" }: { symbol: string; className?: string }) => {
  const [srcError, setSrcError] = useState(false);
  const clean = symbol?.toUpperCase();

  const logos: Record<string, string> = {
    SUI: 'https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png',
    USDC: 'https://coin-images.coingecko.com/coins/images/6319/large/USD_Coin_icon.png',
    USDT: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png',
    DEEP: 'https://coin-images.coingecko.com/coins/images/68257/large/deepbook_LOGO_200x200.jpg',
    CETUS: 'https://coin-images.coingecko.com/coins/images/30256/large/cetus.png',
  };

  const colors: Record<string, string> = {
    SUI: 'bg-sui-blue/20 text-sui-blue border-sui-blue/30',
    USDC: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    USDT: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    DEEP: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    CETUS: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };

  const fallbackColor = colors[clean] || 'bg-zinc-800 text-zinc-400 border-zinc-700';
  const logoUrl = logos[clean];

  useEffect(() => {
    setSrcError(false);
  }, [symbol]);

  if (logoUrl && !srcError) {
    return (
      <img
        src={logoUrl}
        alt={symbol}
        onError={() => setSrcError(true)}
        className={`${className} rounded-full object-cover border border-border-dark bg-sui-dark/40`}
      />
    );
  }

  return (
    <div className={`${className} rounded-full border flex items-center justify-center text-[9px] font-outfit font-extrabold uppercase tracking-tight select-none ${fallbackColor}`}>
      {clean.slice(0, 2)}
    </div>
  );
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
  const [zkProofError, setZkProofError] = useState<string | null>(null);
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
  const [isExecuted, setIsExecuted] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    const timer = setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isParsing]);

  // ZkLogin custom UI states
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showZkDropdown, setShowZkDropdown] = useState(false);
  const [copiedZk, setCopiedZk] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Withdraw Form states
  const [withdrawRecipient, setWithdrawRecipient] = useState('');
  const [withdrawAsset, setWithdrawAsset] = useState<'SUI' | 'USDC' | 'USDT' | 'DEEP' | 'CETUS'>('SUI');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccessTx, setWithdrawSuccessTx] = useState<string | null>(null);

  const activeWalletAddress = currentAccount?.address || zkAddress;

  // Handle zkLogin redirect callback on mount
  // Handle zkLogin redirect callback on mount
  useEffect(() => {
    const handleCallback = async () => {
      const idToken = extractIdTokenFromUrl();
      if (idToken) {
        // Clear url hash
        window.location.hash = '';
        setJwt(idToken);
        sessionStorage.setItem('zklogin_jwt', idToken);
        
        try {
          const decoded = decodeJwt(idToken);
          if (decoded.email && typeof decoded.email === 'string') {
            setUserEmail(decoded.email);
            sessionStorage.setItem('zklogin_email', decoded.email);
          }
        } catch (e) {
          console.warn("Failed to decode JWT email:", e);
        }

        setIsZkLoading(true);
        try {
          const salt = getOrGenerateSalt();
          const address = deriveZkAddress(idToken, salt);
          setZkAddress(address);

          const session = getStoredSession();
          if (session) {
            setZkSession(session);
          }
        } catch (err) {
          console.error('Failed to initialize zkLogin address:', err);
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
          
          const storedEmail = sessionStorage.getItem('zklogin_email');
          if (storedEmail) {
            setUserEmail(storedEmail);
          } else {
            try {
              const decoded = decodeJwt(storedJwt);
              if (decoded.email && typeof decoded.email === 'string') {
                setUserEmail(decoded.email);
                sessionStorage.setItem('zklogin_email', decoded.email);
              }
            } catch (e) {
              console.warn("Failed to decode stored JWT email:", e);
            }
          }

          setIsZkLoading(true);
          try {
            const salt = getOrGenerateSalt();
            const address = deriveZkAddress(storedJwt, salt);
            setZkAddress(address);
          } catch (err) {
            console.error('Failed to load stored zkLogin address:', err);
          } finally {
            setIsZkLoading(false);
          }
        }
      }
    };

    handleCallback();
  }, []);

  // Fetch ZK proof dynamically when network, jwt, or zkSession changes
  useEffect(() => {
    const fetchZkProofData = async () => {
      if (!jwt || !zkSession) return;
      setIsZkLoading(true);
      setZkProofError(null);
      try {
        const salt = getOrGenerateSalt();
        const proof = await getZkProof(jwt, zkSession, salt, network);
        setZkProof(proof);
      } catch (err) {
        console.error('Failed to fetch ZK Proof for network ' + network + ':', err);
        setZkProof(null);
        setZkProofError((err as Error).message || 'Unknown error');
      } finally {
        setIsZkLoading(false);
      }
    };

    fetchZkProofData();
  }, [jwt, zkSession, network]);

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
    setUserEmail(null);
    setShowZkDropdown(false);
    setBalance({ SUI: '0', USDC: '0', USDT: '0', DEEP: '0', CETUS: '0' });
  };

  const handleNewChat = () => {
    setMessages([
      {
        sender: 'bot',
        text: 'Hello! I am HiSui, your AI Web3 Intent Assistant. Tell me what you want to do on Sui (e.g. "Swap 5 SUI for USDC and deposit it in NAVI"), and I will compile the transaction block, verify it for slippage and oracle freshness, and help you sign it.',
      },
    ]);
    setInput('');
    setActiveIntent(null);
    setActiveReport(null);
    setExecutionTx(null);
    setIsExecuted(false);
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
    setIsExecuted(false);

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

      if (currentAccount) {
        // Execute using standard browser wallet
        const response = await signAndExecuteTxb({
          transaction: executionTx,
        });
        digest = response.digest;
      } else if (zkAddress) {
        // Execute using zkLogin Session Key
        if (!jwt || !zkSession) {
          throw new Error('zkLogin session or JWT is missing. Please log in again.');
        }
        if (!zkProof) {
          throw new Error(
            `ZK Proof is missing or failed to fetch. ${
              zkProofError ? `Details: ${zkProofError}` : 'Please wait for the proof to load or try logging in again.'
            }`
          );
        }

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
        throw new Error('No wallet or zkLogin account is connected.');
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
      setIsExecuted(true);
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

  const handleCopyZkAddress = () => {
    if (!zkAddress) return;
    navigator.clipboard.writeText(zkAddress);
    setCopiedZk(true);
    setTimeout(() => setCopiedZk(false), 2000);
  };

  const handleWithdrawSubmit = async () => {
    if (!zkAddress || !zkSession || !jwt) return;
    if (!zkProof) {
      setWithdrawError(
        `ZK Proof is missing or failed to fetch. ${
          zkProofError ? `Details: ${zkProofError}` : 'Please wait for the proof to load or try logging in again.'
        }`
      );
      return;
    }
    if (!withdrawRecipient.trim() || !withdrawAmount.trim()) {
      setWithdrawError('Recipient address and amount are required.');
      return;
    }
    
    setIsWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccessTx(null);
    
    try {
      const recipient = withdrawRecipient.trim();
      if (!recipient.startsWith('0x') || recipient.length !== 66) {
        throw new Error('Invalid recipient address format. It must be a 66-character hex string starting with 0x.');
      }
      
      const client = getSuiClient(network);
      const tx = new Transaction();
      tx.setSender(zkAddress);
      
      // Set reference gas price dynamically
      try {
        const rgp = await client.getReferenceGasPrice();
        tx.setGasPrice(rgp);
      } catch (err) {
        console.warn('Failed to fetch reference gas price, using default:', err);
      }
      
      const config = NETWORK_CONFIG[network];
      const isSui = withdrawAsset === 'SUI';
      
      if (isSui) {
        const balanceNum = parseFloat(balance.SUI);
        const amountNum = parseFloat(withdrawAmount);
        
        // Check if user is withdrawing MAX SUI or custom amount
        if (withdrawAmount.toUpperCase() === 'MAX' || amountNum >= balanceNum - 0.01) {
          // Sweep: transfer gas object directly to transfer 100% of remaining SUI after gas fee deduction
          tx.transferObjects([tx.gas], tx.pure.address(recipient));
        } else {
          // Convert amount to MIST
          const amountMist = Math.floor(amountNum * 1e9).toString();
          const [splitCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
          tx.transferObjects([splitCoin], tx.pure.address(recipient));
        }
      } else {
        // Non-SUI Token withdrawal
        const tokenAddress = config.TOKENS[withdrawAsset];
        if (!tokenAddress) {
          throw new Error(`Token address for ${withdrawAsset} not configured on ${network}.`);
        }
        
        const decimals = withdrawAsset === 'CETUS' ? 9 : 6;
        const amountNum = parseFloat(withdrawAmount);
        const amountRaw = Math.floor(amountNum * Math.pow(10, decimals)).toString();
        
        // Retrieve and split/merge user's token coins
        const coinObj = await getCoinOfAmount(client, zkAddress, tokenAddress, amountRaw, tx);
        tx.transferObjects([coinObj as any], tx.pure.address(recipient));
      }
      
      // Build transaction bytes
      const txBytes = await tx.build({ client });
      
      // Sign with ephemeral key
      const keypair = Ed25519Keypair.fromSecretKey(zkSession.ephemeralPrivateKey);
      const { signature: userSignature } = await tx.sign({
        client,
        signer: keypair,
      });
      
      // Assemble zkLogin signature
      const zkSignature = getZkLoginSignature({
        inputs: {
          ...zkProof,
          addressSeed: zkProof.addressSeed,
        },
        maxEpoch: zkSession.maxEpoch,
        userSignature,
      });
      
      // Execute the transaction
      const response = await client.executeTransactionBlock({
        transactionBlock: txBytes,
        signature: zkSignature,
      });
      
      setWithdrawSuccessTx(response.digest);
      setWithdrawAmount('');
      
      // Update balances immediately
      setTimeout(fetchBalances, 3000);
      
    } catch (err: any) {
      console.error('Withdrawal failed:', err);
      setWithdrawError(err.message || 'Transaction failed or rejected.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const renderSidebarContents = () => (
    <div className="flex flex-col justify-between h-full font-sans">
      <div className="flex flex-col gap-6 flex-1 overflow-y-auto pr-1">
        {/* Logo and Network Selector */}
        <div className="flex items-center gap-2.5 select-none px-2 pt-2 shrink-0">
          <img 
            src="/logo.png" 
            alt="HiSui Logo" 
            className="h-10 w-auto object-contain hover:scale-[1.06] active:scale-[0.98] transition-transform duration-300 cursor-pointer" 
          />
          <div>
            <h1 className="text-lg font-outfit font-extrabold tracking-tight text-[#F5F9FF] flex items-center gap-2">
              <span className="bg-gradient-to-r from-[#59C8FF] via-[#F5F9FF] to-[#A78BFA] bg-clip-text text-transparent">
                HiSui
              </span>
              <div className="relative flex items-center select-none">
                <span className="absolute left-2.5 w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                <select
                  value={network}
                  onChange={(e) => selectNetwork(e.target.value as 'mainnet' | 'testnet')}
                  className="bg-[rgba(89,200,255,0.10)] text-[#7EE7FF] border border-[rgba(89,200,255,0.28)] text-[9px] font-bold pl-5 pr-2.5 py-0.5 rounded-full focus:outline-none cursor-pointer hover:bg-[rgba(89,200,255,0.15)] transition-all font-sans appearance-none"
                >
                  <option value="mainnet" className="bg-[#030f1c] text-zinc-100">Mainnet</option>
                  <option value="testnet" className="bg-[#030f1c] text-zinc-100">Testnet</option>
                </select>
              </div>
            </h1>
            <p className="text-[8px] text-[#9CB2C9] font-extrabold uppercase tracking-wider">AI INTENT ENGINE FOR SUI</p>
          </div>
        </div>

        {/* Action Button: New Intent */}
        <button
          onClick={() => {
            handleNewChat();
            setMobileMenuOpen(false);
          }}
          className="flex items-center justify-center gap-2.5 w-full bg-gradient-to-b from-[#163A5A] to-[#10263D] border border-[rgba(89,200,255,0.10)] hover:border-[#2E6EA6] text-[#59C8FF] px-4 py-3 rounded-xl transition-all text-xs font-bold cursor-pointer shadow-md shrink-0"
        >
          <Sparkles className="h-4 w-4 text-[#59C8FF]" />
          New Chat Intent
        </button>

        {/* Balances & Tokens Panel */}
        <div className="bg-[rgba(13,27,42,0.82)] border border-[rgba(89,200,255,0.12)] rounded-2xl p-4 flex flex-col gap-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.28)] shrink-0">
          <div className="flex items-center gap-2 text-[10px] text-[#9CB2C9] font-extrabold uppercase tracking-wider pb-1 border-b border-[rgba(89,200,255,0.10)]">
            <Coins className="h-4 w-4 text-[#59C8FF]" />
            <span>Balances & Tokens</span>
          </div>
          <div className="flex flex-col gap-1">
            {(['SUI', 'USDC', 'USDT', 'DEEP', 'CETUS'] as const).map((token) => (
              <div key={token} className="flex items-center justify-between p-1.5 rounded-xl hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2.5">
                  <TokenLogo symbol={token} className="h-7 w-7 shrink-0 opacity-85" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#F5F9FF]">{token}</span>
                    <span className="text-[7px] text-[#7C93A8] font-extrabold uppercase tracking-tight leading-none mt-0.5">
                      {token === 'SUI' 
                        ? 'SUI NETWORK' 
                        : token === 'CETUS' 
                        ? 'CETUS PROTOCOL' 
                        : token === 'DEEP' 
                        ? 'DEEPBOOK' 
                        : 'STABLECOIN'}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-[#DFF4FF]">{balance[token]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Profile / Connection */}
      <div className="border-t border-[rgba(89,200,255,0.10)] pt-4 flex flex-col gap-3 shrink-0">
        {!activeWalletAddress ? (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                handleGoogleLogin();
                setMobileMenuOpen(false);
              }}
              disabled={isZkLoading}
              className="flex items-center justify-center gap-2 w-full bg-[#0D1B2A] border border-[#18324D] hover:border-[#2E6EA6] text-[#F5F9FF] font-extrabold px-4 py-2.5 rounded-xl hover:bg-[#122338] transition-all text-xs shadow-sm hover:shadow-[0_0_36px_rgba(89,200,255,0.14)] cursor-pointer disabled:opacity-50"
            >
              {isZkLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#59C8FF]" />
              ) : (
                <svg className="h-4 w-4 text-[#59C8FF]" viewBox="0 0 24 24">
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
            <div className="theme-dapp-kit-connect w-full">
              <ConnectButton connectText="Connect Wallet" />
            </div>
          </div>
        ) : (
          <div className="relative">
            {zkAddress ? (
              <>
                <button
                  onClick={() => setShowZkDropdown(!showZkDropdown)}
                  className="flex items-center justify-between w-full bg-[#0D1B2A] border border-[#18324D] hover:border-[#2E6EA6] px-4 py-3 rounded-xl transition-all cursor-pointer shadow-sm text-xs"
                >
                  <div className="flex flex-col text-left truncate pr-2">
                    {userEmail && <span className="text-[10px] text-[#9CB2C9] font-semibold truncate">{userEmail}</span>}
                    <span className="text-[10px] text-[#6E8298] font-mono">
                      {zkAddress.slice(0, 8)}...{zkAddress.slice(-6)}
                    </span>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-[#6E8298] shrink-0 transition-transform duration-200" style={{ transform: showZkDropdown ? 'rotate(180deg)' : 'none' }} />
                </button>

                {showZkDropdown && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowZkDropdown(false)} 
                    />
                    <div className="absolute bottom-14 left-0 right-0 bg-[#0D1B2A] border border-[#18324D] backdrop-blur-2xl rounded-2xl shadow-xl p-4 flex flex-col gap-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                      {userEmail && (
                        <div className="flex flex-col border-b border-[rgba(89,200,255,0.10)] pb-3">
                          <span className="text-[9px] font-bold text-[#9CB2C9] uppercase tracking-wider">Google Session</span>
                          <span className="text-xs font-semibold text-[#F5F9FF] mt-1 truncate" title={userEmail}>
                            {userEmail}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-[#9CB2C9] uppercase tracking-wider">Wallet Address</span>
                        <div className="flex items-center justify-between bg-[#122338]/50 border border-[#18324D] rounded-xl px-3 py-2 mt-1">
                          <span className="text-[10px] font-mono text-[#D7E6F5] truncate w-40">
                            {zkAddress}
                          </span>
                          <button
                            onClick={handleCopyZkAddress}
                            className="text-[#9CB2C9] hover:text-[#59C8FF] p-1.5 rounded-lg hover:bg-[#122338]/70 transition-colors flex items-center justify-center shrink-0"
                            title="Copy address"
                          >
                            {copiedZk ? <Check className="h-4 w-4 text-[#6FFFD2]" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 border-t border-[rgba(89,200,255,0.10)] pt-3">
                        <span className="text-[9px] font-bold text-[#9CB2C9] uppercase tracking-wider">zkLogin Proof Status</span>
                        {isZkLoading ? (
                          <div className="flex items-center gap-2 text-[10px] text-[#F5B942] mt-1">
                            <Loader2 className="h-3 w-3 animate-spin text-[#F5B942]" />
                            <span>Generating ZK Proof...</span>
                          </div>
                        ) : zkProof ? (
                          <div className="flex items-center gap-1.5 text-[10px] text-[#6FFFD2] mt-1 font-bold">
                            <Check className="h-3.5 w-3.5 text-[#6FFFD2]" />
                            <span>Proof ready & synced</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 mt-1">
                            <div className="flex items-center gap-1.5 text-[10px] text-[#F25F5C] font-bold">
                              <AlertTriangle className="h-3.5 w-3.5 text-[#F25F5C]" />
                              <span>Proof generation failed</span>
                            </div>
                            {zkProofError && (
                              <p className="text-[9px] text-[#FF8A88]/90 font-mono break-words max-h-16 overflow-y-auto leading-tight bg-[#F25F5C]/10 border border-[#F25F5C]/20 p-1.5 rounded-lg mt-0.5">
                                {zkProofError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 pt-1.5 border-t border-[rgba(89,200,255,0.10)]">
                        <button
                          onClick={() => {
                            setShowZkDropdown(false);
                            setShowWithdrawModal(true);
                            setMobileMenuOpen(false);
                          }}
                          className="flex items-center gap-2.5 w-full text-left text-xs font-bold text-zinc-300 hover:text-sui-blue px-3 py-2.5 rounded-xl hover:bg-sui-blue/10 transition-colors cursor-pointer"
                        >
                          <ArrowRight className="h-4 w-4 text-sui-blue -rotate-45" />
                          Withdraw Assets
                        </button>

                        <button
                          onClick={() => {
                            handleLogout();
                            setMobileMenuOpen(false);
                          }}
                          className="flex items-center gap-2.5 w-full text-left text-xs font-bold text-red-400 hover:text-red-300 px-3 py-2.5 rounded-xl hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <LogOut className="h-4 w-4 text-red-400" />
                          Disconnect Wallet
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="theme-dapp-kit-connect w-full">
                <ConnectButton />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderPreviewContents = () => {
    if (!activeIntent) {
      if (isParsing) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-[#6E8298] px-4 py-20 h-full">
            <div className="relative mb-4 h-16 w-16 rounded-full overflow-hidden border border-[rgba(89,200,255,0.10)] shadow-lg flex items-center justify-center bg-[#0D1B2A] animate-pulse">
              <Loader2 className="h-7 w-7 animate-spin text-[#59C8FF]" />
            </div>
            <p className="text-xs font-bold text-[#F5F9FF]">Compiling Intent...</p>
            <p className="text-[10px] text-[#6E8298] mt-1 max-w-[280px]">HiSui is parsing your input and simulating the transaction block...</p>
          </div>
        );
      }
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-[#6E8298] px-4 py-20 h-full">
          <div className="relative mb-4 h-16 w-16 rounded-full overflow-hidden border border-[rgba(89,200,255,0.10)] shadow-lg animate-pulse">
            <img src="/mascot.jpg" alt="HiSui Mascot" className="h-full w-full object-cover" />
          </div>
          <p className="text-xs font-bold text-[#F5F9FF]">No active intent compiled yet.</p>
          <p className="text-[10px] text-[#6E8298] mt-1 max-w-[280px]">Submit a plain English goal in the chat, and the compiled block will appear here for verification.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Intent Summary Card */}
        <div className="bg-[#0D1B2A] border border-[rgba(89,200,255,0.10)] p-5 rounded-2xl flex flex-col gap-3 shadow-[0_12px_40px_rgba(0,0,0,0.28)] relative animate-in fade-in duration-200">
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-bold text-[#9CB2C9] uppercase tracking-wider">Proposed Flow</span>
            <span className="text-[10px] bg-[rgba(89,200,255,0.10)] text-[#7EE7FF] border border-[rgba(89,200,255,0.28)] px-2.5 py-0.5 rounded-full font-bold">PTB Block</span>
          </div>
          <p className="text-xs font-bold text-[#F5F9FF] leading-tight">{activeIntent.summary}</p>

          {/* Steps Visualizer */}
          <div className="mt-2 space-y-3.5 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[2px] before:bg-[rgba(89,200,255,0.10)]">
            {activeIntent.actions.map((act, index) => (
              <div key={index} className="flex gap-4 items-start pl-6 relative">
                <div className="absolute left-1.5 h-3.5 w-3.5 rounded-full bg-gradient-to-r from-[#59C8FF] to-[#3B82F6] border-4 border-[#030B14] flex items-center justify-center shadow-[0_0_8px_rgba(89,200,255,0.6)]" />
                <div className="flex-1 bg-[#122338]/40 border border-[#18324D] p-3 rounded-xl flex items-center justify-between hover:border-[#2E6EA6] transition-all hover:scale-[1.01]">
                  <div>
                    <span className="text-[9px] font-bold text-[#9CB2C9] uppercase tracking-wider">{act.type}</span>
                    <p className="text-xs text-[#D7E6F5] mt-0.5 font-medium">
                      {act.type === 'swap' 
                        ? `Swap ${parseFloat(act.amount) / Math.pow(10, getTokenDecimals(act.fromToken || 'SUI'))} ${act.fromToken} for ${act.toToken}` 
                        : `Deposit ${act.amount === 'all_swapped' ? 'all swapped assets' : parseFloat(act.amount) / Math.pow(10, getTokenDecimals(act.tokenType || 'USDC'))} ${act.tokenType || 'USDC'} into NAVI`
                      }
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[#6E8298] shrink-0" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Guardian Checks Panel */}
        <div className="bg-[#0D1B2A] border border-[rgba(89,200,255,0.10)] p-5 rounded-2xl flex flex-col gap-4 shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
          <div className="flex items-center gap-2 border-b border-[rgba(89,200,255,0.10)] pb-3">
            <ShieldCheck className="h-4.5 w-4.5 text-[#59C8FF]" />
            <span className="text-[9px] font-bold text-[#F5F9FF] uppercase tracking-wider">Guardian Simulation</span>
          </div>

          {isSimulating ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2 animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin text-[#59C8FF]" />
              <span className="text-[10px] text-[#6E8298] italic font-sans">Running on-chain dry-run...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Simulation Status */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#9CB2C9] uppercase tracking-wider">Dry-run Simulation:</span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  activeReport?.success 
                    ? 'bg-[rgba(111,255,210,0.10)] text-[#6FFFD2] border-[rgba(111,255,210,0.28)]' 
                    : 'bg-[rgba(242,95,92,0.10)] text-[#FF8A88] border-[rgba(242,95,92,0.35)]'
                }`}>
                  {activeReport?.success ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>

              {/* Dynamic Rates */}
              {activeReport?.oraclePrice && (
                <div className="flex justify-between items-center text-xs border-b border-[rgba(89,200,255,0.10)] pb-2">
                  <span className="text-[#9CB2C9] font-medium">Oracle SUI/USD Price:</span>
                  <span className="font-bold text-[#F5F9FF] font-mono">${activeReport.oraclePrice.toFixed(4)}</span>
                </div>
              )}
              {activeReport?.executionRate && (
                <div className="flex justify-between items-center text-xs border-b border-[rgba(89,200,255,0.10)] pb-2">
                  <span className="text-[#9CB2C9] font-medium">Cetus Execution Rate:</span>
                  <span className="font-bold text-[#F5F9FF] font-mono">{activeReport.executionRate.toFixed(4)} {activeReport.executionSymbol || 'USDC'}/SUI</span>
                </div>
              )}

              {/* Warnings List */}
              {activeReport?.warnings && activeReport.warnings.length > 0 && (
                <div className="space-y-2">
                  {activeReport.warnings.map((warn, i) => (
                    <div
                      key={i}
                      className={`flex gap-2.5 p-3 rounded-xl border text-[11px] leading-relaxed backdrop-blur-sm ${
                        warn.level === 'danger'
                          ? 'bg-[rgba(242,95,92,0.10)] border-[rgba(242,95,92,0.35)] text-[#FF8A88]'
                          : warn.level === 'warning'
                          ? 'bg-[rgba(245,185,66,0.10)] border-[rgba(245,185,66,0.25)] text-[#FFD47A]'
                          : 'bg-[#0D1B2A] border-[rgba(89,200,255,0.10)] text-[#9CB2C9]'
                      }`}
                    >
                      <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${warn.level === 'danger' ? 'text-[#F25F5C]' : warn.level === 'warning' ? 'text-[#F5B942]' : 'text-[#6E8298]'}`} />
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
          disabled={isExecuting || !activeReport?.success || isExecuted}
          className={`w-full flex items-center justify-center gap-2.5 border font-extrabold py-3.5 rounded-xl text-xs transition-all shadow-lg cursor-pointer ${
            isExecuted
              ? 'bg-[rgba(6,36,29,0.72)] border-[rgba(34,197,94,0.32)] text-[#4ADE80] shadow-[0_0_32px_rgba(34,197,94,0.12)]'
              : 'bg-gradient-to-b from-[#163A5A] to-[#10263D] border border-[rgba(89,200,255,0.10)] text-[#59C8FF] hover:border-[#2E6EA6] hover:scale-[1.01] active:scale-[0.99] disabled:from-[#0D1B2A] disabled:to-[#0D1B2A] disabled:text-[#465A70] disabled:border-transparent disabled:shadow-none'
          }`}
        >
          {isExecuting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-[#59C8FF]" />
              Signing & Executing Block...
            </>
          ) : isExecuted ? (
            <>
              <Check className="h-4.5 w-4.5 text-[#4ADE80]" />
              Transaction Executed
            </>
          ) : (
            <>
              <ShieldCheck className="h-4.5 w-4.5 text-[#59C8FF]" />
              Approve & Sign Transaction
            </>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#030B14] text-zinc-100 flex flex-col font-sans relative overflow-hidden select-none">
      {/* Ambient Nebula Glows */}
      <div className="absolute bottom-[-25%] right-[-20%] w-[65%] h-[65%] rounded-full bg-sui-pink/6 blur-[140px] animate-float-delayed pointer-events-none z-0" />

      {/* Mobile Top Header (hidden on md and up) */}
      <header className="flex md:hidden items-center justify-between px-4 py-3 border-b border-border-dark bg-sui-dark/30 backdrop-blur-xl sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-2 select-none">
          <img 
            src="/logo.png" 
            alt="HiSui Logo" 
            className="h-8 w-auto object-contain hover:scale-[1.06] active:scale-[0.98] transition-transform duration-300 cursor-pointer" 
          />
          <div>
            <h1 className="text-md font-outfit font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span className="bg-gradient-to-r from-sui-blue via-white to-sui-pink bg-clip-text text-transparent">
                HiSui
              </span>
              <select
                value={network}
                onChange={(e) => selectNetwork(e.target.value as 'mainnet' | 'testnet')}
                className="bg-sui-blue/10 text-sui-blue border border-sui-blue/20 text-[8px] font-bold px-1.5 py-0.2 rounded-full focus:outline-none cursor-pointer hover:bg-sui-blue/20 hover:border-sui-blue/40 transition-all font-sans"
              >
                <option value="mainnet" className="bg-[#030f1c] text-zinc-100">Mainnet</option>
                <option value="testnet" className="bg-[#030f1c] text-zinc-100">Testnet</option>
              </select>
            </h1>
          </div>
        </div>

        <button
          onClick={() => setMobileMenuOpen(true)}
          className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.05] transition-all"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Main Layout Containing Left Sidebar + Main Content Column + Right Sidebar */}
      <div className="flex-1 flex overflow-hidden h-screen z-10 relative">
        
        {/* Left Sidebar (Desktop: permanently visible, Mobile: hidden) */}
        <aside className="hidden md:flex w-72 bg-[#071321]/85 border border-[rgba(89,200,255,0.10)] backdrop-blur-2xl rounded-3xl p-4 my-4 ml-4 h-[calc(100vh-2rem)] flex-col justify-between shrink-0 select-none shadow-[0_24px_80px_rgba(0,0,0,0.36)]">
          {renderSidebarContents()}
        </aside>

        {/* Left Sidebar (Mobile Drawer slide-over) */}
        {mobileMenuOpen && (
          <>
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden animate-in fade-in duration-200" 
              onClick={() => setMobileMenuOpen(false)} 
            />
            <aside className="fixed inset-y-0 left-0 w-72 bg-gradient-to-b from-[#071321] to-[#071321]/95 border-r border-[rgba(89,200,255,0.10)] p-4 z-50 flex flex-col justify-between md:hidden animate-in slide-in-from-left duration-250 select-none shadow-2xl backdrop-blur-2xl">
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-[#9CB2C9] hover:text-white p-1.5 rounded-lg hover:bg-white/[0.05] transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {renderSidebarContents()}
              </div>
            </aside>
          </>
        )}

        {/* Middle Column: Chat and Floating Input Box */}
        <div className="flex-1 bg-gradient-to-b from-[#081423]/95 to-[#081423]/85 border border-[rgba(89,200,255,0.10)] backdrop-blur-2xl rounded-3xl my-4 mx-4 h-[calc(100vh-2rem)] flex flex-col overflow-hidden relative shadow-[0_24px_80px_rgba(0,0,0,0.36)]">
          
          {/* Moving Mascot Background */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 select-none overflow-hidden">
            <img 
              src="/mascot.jpg" 
              alt="Mascot Watermark" 
              className="w-80 h-80 object-contain opacity-[0.03] mix-blend-screen animate-float-slow filter grayscale contrast-125"
            />
          </div>

          {/* Top Gradient Fade to prevent hard cut-off */}
          <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-[#081423] via-[#081423]/80 to-transparent z-20 pointer-events-none rounded-t-3xl" />

          {/* Bottom Gradient Fade to prevent text clashing with input */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#081423] via-[#081423]/80 to-transparent z-15 pointer-events-none rounded-b-3xl" />

          {/* Messages Log */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-4 md:p-6 pt-10 pb-36 space-y-4 z-10 relative"
          >
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-3 w-full ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 shadow-md overflow-hidden ${msg.sender === 'user' ? 'bg-gradient-to-b from-[#14304a] to-[#0d233a] border border-[rgba(89,200,255,0.24)]' : 'bg-[#0D1B2A] border border-[rgba(89,200,255,0.12)]'}`}
                >
                  {msg.sender === 'user' ? (
                    <Wallet className="h-4 w-4 text-[#59C8FF]" />
                  ) : (
                    <img src="/mascot.jpg" alt="HiSui Mascot" className="h-full w-full object-cover" />
                  )}
                </div>

                <div
                  className={`p-4 text-xs leading-relaxed max-w-[85%] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur-md ${
                    msg.sender === 'user' 
                      ? 'bg-gradient-to-b from-[rgba(20,48,74,0.95)] to-[rgba(13,35,58,0.95)] border border-[rgba(89,200,255,0.24)] text-[#D7E6F5] rounded-tr-none' 
                      : msg.error 
                      ? 'bg-gradient-to-b from-[#F25F5C]/[0.12] to-[#F25F5C]/[0.03] border border-[#F25F5C]/0.35 text-[#FF8A88] rounded-tl-none' 
                      : 'bg-[rgba(16,30,46,0.88)] border border-[rgba(89,200,255,0.12)] text-[#D7E6F5] rounded-tl-none'
                  }`}
                >
                  <p className="font-medium whitespace-pre-wrap">{msg.text}</p>

                  {msg.intent && (
                    <div className="mt-3 bg-[#0D1B2A] border border-[#18324D] p-3.5 rounded-xl flex flex-col gap-2 shadow-md">
                      <div className="flex items-center gap-2">
                        <span className="bg-[rgba(167,139,250,0.10)] border border-[rgba(167,139,250,0.26)] text-[#C4B5FD] text-[8px] font-extrabold uppercase px-2 py-0.5 rounded-md tracking-wider flex items-center gap-1 select-none">
                          <Sparkles className="h-2.5 w-2.5 text-[#A78BFA] animate-pulse" />
                          AI Intent Compiled
                        </span>
                      </div>
                      <p className="text-[10px] text-[#9CB2C9] font-semibold">{msg.intent.summary}</p>
                    </div>
                  )}

                  {msg.txDigest && (
                    <div className="mt-3 bg-[rgba(6,36,29,0.72)] border border-[rgba(34,197,94,0.32)] p-3.5 rounded-xl flex flex-col gap-1.5 shadow-[0_0_32px_rgba(34,197,94,0.12)] animate-in fade-in duration-200">
                      <span className="text-[10px] font-bold text-[#4ADE80] uppercase tracking-wider">Transaction Confirmed:</span>
                      <a
                        href={`https://suiscan.xyz/${network}/tx/${msg.txDigest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#8FECC0] hover:text-[#59C8FF] underline break-all font-mono transition-colors"
                      >
                        {msg.txDigest}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isParsing && (
              <div className="flex gap-3 items-center text-xs text-[#9CB2C9] italic pl-11">
                <Loader2 className="h-4 w-4 animate-spin text-[#59C8FF]" />
                HiSui is parsing your intent...
              </div>
            )}

            {/* Inline Intent & Guardian Preview (Mobile/Tablet Only: visible only on screens smaller than lg) */}
            {activeIntent && (
              <div className="block lg:hidden max-w-xl mr-auto ml-11 p-1 animate-in fade-in duration-200">
                <div className="bg-[#06111C] border border-[rgba(89,200,255,0.10)] p-5 rounded-2xl flex flex-col gap-5 shadow-lg backdrop-blur-xl">
                  <div className="flex items-center justify-between border-b border-[rgba(89,200,255,0.10)] pb-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4.5 w-4.5 text-[#59C8FF]" />
                      <span className="text-[9px] font-bold text-[#F5F9FF] uppercase tracking-wider">Intent & Guardian Preview</span>
                    </div>
                    <span className="text-[9px] bg-[rgba(89,200,255,0.10)] text-[#7EE7FF] border border-[rgba(89,200,255,0.28)] px-2 py-0.5 rounded-full font-bold">PTB Block</span>
                  </div>
                  {renderPreviewContents()}
                </div>
              </div>
            )}

            {/* Spacer to prevent overlapping with the floating composer */}
            <div className="h-32 shrink-0 pointer-events-none" />
          </div>

          {/* Intent Composer */}
          <div className="absolute bottom-4 left-4 right-4 z-20">
            <div className="max-w-2xl mx-auto w-full relative flex items-center bg-[rgba(7,17,29,0.94)] backdrop-blur-2xl border border-[rgba(89,200,255,0.16)] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.28)] focus-within:border-[rgba(89,200,255,0.55)] focus-within:shadow-[0_0_0_4px_rgba(89,200,255,0.08),0_0_42px_rgba(89,200,255,0.14)] transition-all">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={
                  activeWalletAddress
                    ? 'e.g. Swap 0.5 SUI for USDC'
                    : 'Connect wallet or zkLogin to begin...'
                }
                disabled={!activeWalletAddress || isParsing}
                className="w-full bg-transparent pl-4 pr-12 py-3.5 md:py-4 text-xs text-[#F5F9FF] placeholder-[#5F7388] focus:outline-none disabled:opacity-50 font-sans"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isParsing}
                className="absolute right-2.5 p-2 md:p-2.5 bg-gradient-to-b from-[#163A5A] to-[#10263D] disabled:from-[#0D1B2A] disabled:to-[#0D1B2A] disabled:text-[#465A70] text-[#59C8FF] rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center cursor-pointer shadow-md"
              >
                <Send className="h-4 w-4 text-[#59C8FF]" />
              </button>
            </div>
          </div>

        </div>

        {/* Right Sidebar: Intent Preview & Guardian Risk Checklist (Desktop Only: hidden on screens smaller than lg) */}
        <section className="hidden lg:flex w-[400px] xl:w-[430px] flex-col bg-[#06111C] border border-[rgba(89,200,255,0.10)] backdrop-blur-2xl rounded-3xl p-6 my-4 mr-4 h-[calc(100vh-2rem)] overflow-y-auto shrink-0 shadow-[0_24px_80px_rgba(0,0,0,0.36)] select-none">
          <div className="flex items-center gap-2 pb-4 border-b border-white/[0.06]">
            <ShieldCheck className="h-5 w-5 text-sui-blue" />
            <h2 className="font-outfit font-extrabold text-sm text-white uppercase tracking-wider">Intent & Guardian Preview</h2>
          </div>
          {renderPreviewContents()}
        </section>

      </div>

      {/* Withdraw Modal Overlay */}
      {showWithdrawModal && (
        <div className="fixed inset-0 bg-sui-dark/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#030f1c] border border-white/[0.08] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in scale-in duration-200">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-5 border-b border-white/[0.04] bg-[#030f1c]/30">
              <div className="flex items-center gap-2.5">
                <div className="bg-sui-blue/15 p-2 rounded-xl text-sui-blue border border-sui-blue/20">
                  <ArrowRight className="h-5 w-5 -rotate-45" />
                </div>
                <div>
                  <h3 className="text-md font-outfit font-extrabold text-white tracking-tight">Withdraw Wallet Assets</h3>
                  <p className="text-[10px] text-zinc-500 font-semibold">Send assets from your zkLogin wallet to another address</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowWithdrawModal(false);
                  setWithdrawError(null);
                  setWithdrawSuccessTx(null);
                }}
                className="text-zinc-500 hover:text-white p-1.5 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 flex-1 overflow-y-auto">
              {withdrawSuccessTx ? (
                <div className="bg-emerald-500/5 border border-emerald-500/20 p-5 rounded-2xl flex flex-col items-center text-center gap-3 animate-in fade-in duration-150">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Check className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-emerald-400">Withdrawal Successful!</h4>
                    <p className="text-[10px] text-zinc-500 mt-1 font-semibold">Your transaction has been broadcast and executed on the blockchain.</p>
                  </div>
                  <div className="bg-[#030f1c]/60 border border-white/[0.06] p-3.5 rounded-xl w-full flex flex-col gap-2 mt-2">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Transaction Digest</span>
                    <a
                      href={`https://suiscan.xyz/${network}/tx/${withdrawSuccessTx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-sui-blue hover:text-sui-pink underline font-mono break-all flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {withdrawSuccessTx.slice(0, 12)}...{withdrawSuccessTx.slice(-12)}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                  <button
                    onClick={() => {
                      setShowWithdrawModal(false);
                      setWithdrawSuccessTx(null);
                    }}
                    className="w-full bg-gradient-to-r from-sui-blue to-sui-pink text-sui-dark font-extrabold py-3 rounded-xl text-xs transition-colors mt-4 cursor-pointer shadow-md"
                  >
                    Close Modal
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Asset Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Select Token</label>
                    <div className="grid grid-cols-5 gap-2 mt-1">
                      {(['SUI', 'USDC', 'USDT', 'DEEP', 'CETUS'] as const).map((token) => (
                        <button
                          key={token}
                          onClick={() => {
                            setWithdrawAsset(token);
                            setWithdrawError(null);
                          }}
                          className={`flex flex-col items-center p-3 rounded-xl border text-center transition-all cursor-pointer ${withdrawAsset === token ? 'bg-sui-blue/10 border-sui-blue/50 text-white font-bold ring-1 ring-sui-blue/20' : 'bg-white/[0.02] border border-white/[0.06] hover:border-zinc-800 text-zinc-400 hover:text-zinc-300'}`}
                        >
                          <TokenLogo symbol={token} className="h-5 w-5 shrink-0 mb-1" />
                          <span className="text-[10px] font-bold">{token}</span>
                          <span className={`text-[8px] mt-0.5 font-semibold ${withdrawAsset === token ? 'text-sui-blue font-bold' : 'text-zinc-500'}`}>
                            {balance[token]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recipient Address */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Recipient SUI Address</label>
                    <input
                      type="text"
                      placeholder="Enter 66-character destination address (0x...)"
                      value={withdrawRecipient}
                      onChange={(e) => {
                        setWithdrawRecipient(e.target.value);
                        setWithdrawError(null);
                      }}
                      className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-3 text-xs text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-sui-blue transition-colors"
                    />
                  </div>

                  {/* Amount Input */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Amount</label>
                    <div className="relative flex items-center mt-1">
                      <input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(e) => {
                          setWithdrawAmount(e.target.value);
                          setWithdrawError(null);
                        }}
                        className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl pl-4 pr-16 py-3 text-xs text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-sui-blue transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        onClick={() => {
                          setWithdrawAmount('MAX');
                          setWithdrawError(null);
                        }}
                        className="absolute right-2 px-3 py-1.5 bg-sui-blue/15 hover:bg-sui-blue/25 text-sui-blue hover:text-sui-blue/90 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                      >
                        MAX
                      </button>
                    </div>
                    {withdrawAsset === 'SUI' && (
                      <span className="text-[9px] text-zinc-500 mt-1 italic font-semibold leading-normal">
                        Note: Selecting MAX SUI will transfer all SUI in the wallet minus the required blockchain gas execution fee.
                      </span>
                    )}
                  </div>

                  {/* Error Notification */}
                  {withdrawError && (
                    <div className="bg-red-500/10 border border-red-500/20 p-3.5 rounded-xl flex gap-2 text-[10px] text-red-300 leading-relaxed items-start animate-in fade-in duration-150">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                      <div>{withdrawError}</div>
                    </div>
                  )}

                  {/* Withdraw Submit Action */}
                  <button
                    onClick={handleWithdrawSubmit}
                    disabled={isWithdrawing || !withdrawRecipient.trim() || !withdrawAmount.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sui-blue to-sui-pink text-sui-dark font-extrabold py-3.5 rounded-xl text-xs transition-all shadow-lg shadow-sui-blue/15 hover:shadow-sui-pink/25 hover:scale-[1.01] active:scale-[0.99] disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 disabled:shadow-none cursor-pointer mt-4"
                  >
                    {isWithdrawing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Signing & Executing Withdrawal...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 -rotate-45" />
                        Send Asset Withdrawal
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
