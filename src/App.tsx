import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { Terminal, Shield, Activity, Database, Key, ChevronRight, AlertTriangle, Cpu, ExternalLink } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SplashScreen } from './components/SplashScreen';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

type LogEntry = { time: string; text: string; type: 'info' | 'success' | 'error' | 'command' | 'warning' };
type Wallet = { 
  id: string;
  mnemonic: string;
  addressIndex: number; 
  eth: string; 
  btc: string; 
  btcSegwit: string;
  ethBalance?: string; 
  btcMainnetBalance?: string; 
  btcTestnetBalance?: string; 
};

function AppContent() {
  const [isBooting, setIsBooting] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [command, setCommand] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // State
  const [entropy, setEntropy] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [mnemonics, setMnemonics] = useState<string[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [systemHealth, setSystemHealth] = useState<{ status: string; uptime: number; memoryUsage: any } | null>(null);

  const getScanSummary = () => {
    const checkedWallets = wallets.filter(w => w.ethBalance !== undefined && w.ethBalance !== 'asking...');
    const checkedBtc = checkedWallets.filter(w => w.btcMainnetBalance !== undefined && w.btcMainnetBalance !== 'asking...').length;
    const checkedEth = checkedWallets.filter(w => w.ethBalance !== undefined && w.ethBalance !== 'asking...').length;
    
    const nonZeroWallets = wallets.filter(w => {
      const eth = parseFloat(w.ethBalance || '0');
      const btcM = parseFloat(w.btcMainnetBalance || '0');
      const btcT = parseFloat(w.btcTestnetBalance || '0');
      return (!isNaN(eth) && eth > 0) || (!isNaN(btcM) && btcM > 0) || (!isNaN(btcT) && btcT > 0);
    });

    if (checkedWallets.length === 0) {
      return { status: 'idle', count: 0, indices: [], checkedBtc: 0, checkedEth: 0 };
    }

    if (nonZeroWallets.length === 0) {
      return { status: 'zero', count: 0, indices: [], checkedBtc, checkedEth };
    }

    const mnemonicIndices = Array.from(new Set(nonZeroWallets.map(w => mnemonics.indexOf(w.mnemonic))));
    return { status: 'found', count: nonZeroWallets.length, indices: mnemonicIndices, checkedBtc, checkedEth };
  };

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    // Periodic Health Check
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setSystemHealth(data);
        } else {
          console.error(`Health check failed with status: ${res.status}`);
        }
      } catch (e: any) {
        console.error("Health check failed", e.message || e);
      }
    };
    
    if (!isBooting) {
      checkHealth();
      const interval = setInterval(checkHealth, 30000); // Check every 30s
      return () => clearInterval(interval);
    }
  }, [isBooting]);

  const addLog = (text: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text, type }]);
  };

  /**
   * Helper function for API calls with retry logic
   */
  const fetchWithRetry = async (url: string, options: RequestInit, retries = 5): Promise<Response> => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        if (res.status === 429) throw new Error("Rate limit exceeded. Please wait.");
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${res.status}`);
      }
      return res;
    } catch (error: any) {
      if (retries > 0 && error.message !== "Rate limit exceeded. Please wait.") {
        addLog(`Retrying ${url}... (${retries} left)`, 'warning');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }
  };

  const runPreset = async (cmd: string, action: () => Promise<void> | void) => {
    if (isProcessing) return;
    addLog(cmd, 'command');
    setIsProcessing(true);
    try {
      await action();
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const executeCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    setCommand('');
    addLog(`> ${cmd}`, 'command');
    setIsProcessing(true);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `You are XAI Ag3nt, a Crypto DevOps command parser. Parse the user's command into a structured JSON action.
        Command: "${cmd}"
        Current State:
        - Mnemonic in state: ${mnemonic ? 'Yes' : 'No'}
        - Wallets derived: ${wallets.length}
        - Mnemonics generated: ${mnemonics.length}
        `,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "One of: 'generate', 'derive', 'check_balance', 'clear', 'generate_100x', 'generate_sequence'" },
              count: { type: Type.INTEGER, description: "Number of addresses to derive (default 1)" },
              mnemonic: { type: Type.STRING, description: "Mnemonic provided by user, if any" }
            },
            required: ["action"]
          },
          systemInstruction: "Extract intent. If user wants to generate a wallet, action is 'generate'. If they want to derive addresses, action is 'derive' and extract 'count'. If they want to check balances, action is 'check_balance'. If they want to generate 100 mnemonics, action is 'generate_100x'. If they want to generate multiple wallets in a sequence (like 50x), action is 'generate_sequence'. If they provide a mnemonic, include it."
        }
      });

      const intent = JSON.parse(response.text || '{}');
      
      switch (intent.action) {
        case 'generate':
          await handleGenerate();
          if (intent.count && intent.count > 0) {
            await handleDerive(intent.count);
          }
          break;
        case 'generate_sequence':
          await handleGenerateSequence();
          break;
        case 'generate_100x':
          await handleGenerate100Sequence();
          break;
        case 'derive':
          if (intent.mnemonic) setMnemonic(intent.mnemonic);
          await handleDerive(intent.count || 1, intent.mnemonic || mnemonic);
          break;
        case 'check_balance':
          await handleCheckBalances();
          break;
        case 'clear':
          setEntropy(null);
          setMnemonic(null);
          setWallets([]);
          setMnemonics([]);
          setLogs([]);
          addLog('Sandbox cleared.', 'success');
          break;
        default:
          addLog(`Unrecognized action: ${intent.action}`, 'error');
      }
    } catch (error: any) {
      addLog(`XAI Error: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateSequence = async () => {
    addLog('Initiating 50x generation sequence...', 'info');
    setWallets([]); 
    setMnemonics([]);

    for (let i = 0; i < 50; i++) {
      try {
        addLog(`Iteration ${i+1}/50: Generating...`, 'info');
        const res = await fetchWithRetry('/api/generate', { method: 'POST' });
        const data = await res.json();
        
        addLog(`Iteration ${i+1}/50: Mnemonic generated.`, 'info');
        setMnemonics(prev => [...prev, data.mnemonic]);
        
        // Wait for mnemonic to be visible before deriving
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Derive 3
        await handleDerive(3, data.mnemonic, true);
        addLog(`Iteration ${i+1}/50: Derived 3 addresses.`, 'success');
      } catch (error: any) {
        addLog(`Iteration ${i+1}/50 failed: ${error.message}`, 'error');
        // Continue to next iteration even if one fails
      }
    }
    addLog('50x generation sequence complete.', 'success');
  };

  const handleGenerate100Sequence = async () => {
    addLog('Initiating 100x address generation for a single mnemonic...', 'info');
    setWallets([]); 
    setMnemonics([]);

    try {
      addLog(`Generating master mnemonic...`, 'info');
      const res = await fetchWithRetry('/api/generate', { method: 'POST' });
      const data = await res.json();
      
      setMnemonics([data.mnemonic]);
      setMnemonic(data.mnemonic);
      setEntropy(data.entropy);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Derive 100 addresses
      addLog(`Deriving 100 addresses (indices 0-99)...`, 'info');
      await handleDerive(100, data.mnemonic, true);
      addLog(`100x generation sequence complete.`, 'success');
    } catch (error: any) {
      addLog(`100x sequence failed: ${error.message}`, 'error');
    }
  };

  const handleGenerate = async () => {
    addLog('Initiating entropy generation...', 'info');
    const res = await fetchWithRetry('/api/generate', { method: 'POST' });
    const data = await res.json();
    
    setEntropy(data.entropy);
    setMnemonic(data.mnemonic);
    setWallets([]);
    addLog('BIP-39 mnemonic generated successfully.', 'success');
  };

  const handleDerive = async (count: number, targetMnemonic: string | null = mnemonic, append: boolean = false) => {
    if (!targetMnemonic) {
      addLog('No mnemonic available for derivation. Generate or provide one.', 'error');
      return;
    }

    // Calculate start index based on existing wallets for this mnemonic
    // We use a functional state update approach to ensure we get the latest count
    let startIndex = 0;
    setWallets(prev => {
      const existingWallets = prev.filter(w => w.mnemonic === targetMnemonic);
      startIndex = append ? existingWallets.length : 0;
      return prev;
    });

    addLog(`Deriving ${count} wallet paths starting at index ${startIndex}...`, 'info');
    const res = await fetchWithRetry('/api/derive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mnemonic: targetMnemonic, count, startIndex })
    });
    const data = await res.json();
    
    let newlyAddedWallets: Wallet[] = [];
    
    setWallets(prev => {
        newlyAddedWallets = data.wallets.map((w: any) => ({
          id: `${targetMnemonic}-${w.index}-${Date.now()}-${Math.random()}`,
          mnemonic: targetMnemonic,
          addressIndex: w.index,
          eth: w.eth,
          btc: w.btc,
          btcSegwit: w.btcSegwit,
          ethBalance: 'asking...',
          btcMainnetBalance: 'asking...',
          btcTestnetBalance: 'asking...'
        }));
        return append ? [...prev, ...newlyAddedWallets] : newlyAddedWallets;
    });
    
    addLog(`Successfully derived ${count} addresses. Fetching balances...`, 'success');

    // Fetch balances
    for (const w of newlyAddedWallets) {
      try {
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between balance checks
        const balRes = await fetchWithRetry('/api/get-balances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eth: w.eth, btc: w.btc })
        });
        const balData = await balRes.json();
        
        setWallets(prev => prev.map(wallet => 
          wallet.id === w.id ? { 
            ...wallet, 
            ethBalance: balData.ethBalance,
            btcMainnetBalance: balData.btcMainnetBalance,
            btcTestnetBalance: balData.btcTestnetBalance
          } : wallet
        ));
      } catch (e) {
        addLog(`Balance fetch failed for index ${w.addressIndex}`, 'error');
        setWallets(prev => prev.map(wallet => 
          wallet.id === w.id ? { 
            ...wallet, 
            ethBalance: 'Failed',
            btcMainnetBalance: 'Failed',
            btcTestnetBalance: 'Failed'
          } : wallet
        ));
      }
    }
  };

  const handleCheckBalances = async () => {
    addLog(`Initiating balance check for all mnemonics...`, 'info');
    for (const m of mnemonics) {
        await handleCheckBalancesForGroup(m);
    }
    addLog('All balance checks complete.', 'success');
  };

  const handleCheckBalancesForGroup = async (targetMnemonic: string) => {
    const groupWallets = wallets.filter(w => w.mnemonic === targetMnemonic);
    if (groupWallets.length === 0) return;
    
    // Set to 'asking...'
    setWallets(prev => prev.map(wallet => 
      wallet.mnemonic === targetMnemonic ? { 
        ...wallet, 
        ethBalance: 'asking...',
        btcMainnetBalance: 'asking...',
        btcTestnetBalance: 'asking...'
      } : wallet
    ));

    addLog(`Querying balances for mnemonic...`, 'info');
    
    for (const w of groupWallets) {
      try {
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between balance checks
        const balRes = await fetchWithRetry('/api/get-balances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eth: w.eth, btc: w.btc })
        });
        const balData = await balRes.json();
        
        setWallets(prev => prev.map(wallet => 
          wallet.id === w.id ? { 
            ...wallet, 
            ethBalance: balData.ethBalance,
            btcMainnetBalance: balData.btcMainnetBalance,
            btcTestnetBalance: balData.btcTestnetBalance
          } : wallet
        ));
      } catch (e: any) {
        addLog(`Balance fetch failed for index ${w.addressIndex}: ${e.message}`, 'error');
        setWallets(prev => prev.map(wallet => 
          wallet.id === w.id ? { 
            ...wallet, 
            ethBalance: 'Failed',
            btcMainnetBalance: 'Failed',
            btcTestnetBalance: 'Failed'
          } : wallet
        ));
      }
    }
    addLog(`Balance check complete for mnemonic.`, 'success');
  };

  if (isBooting) {
    return <SplashScreen onComplete={() => setIsBooting(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#00ff41] font-mono p-4 md:p-8 selection:bg-[#00ff41] selection:text-black">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-[#00ff41]/30 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter flex items-center gap-2">
            <Terminal size={24} />
            XAI_AG3NT // CRYPTO_DEVOPS
          </h1>
          <p className="text-[#00ff41]/60 text-sm mt-1">Automated BIP-39 Workflow & Verification Sandbox</p>
        </div>
        <div className="mt-4 md:mt-0 flex items-center gap-2 bg-red-950/30 text-red-500 border border-red-900/50 px-3 py-1.5 rounded text-xs">
          <AlertTriangle size={14} />
          <span>EDUCATIONAL UTILITY ONLY. DO NOT USE FOR HIGH-VALUE ASSETS.</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Terminal */}
        <div className="lg:col-span-5 flex flex-col h-[80vh] border border-[#00ff41]/20 bg-[#0a0a0a] rounded-lg overflow-hidden shadow-[0_0_15px_rgba(0,255,65,0.05)]">
          <div className="bg-[#111] border-b border-[#00ff41]/20 p-2 flex items-center gap-2 text-xs text-[#00ff41]/70">
            <Terminal size={14} />
            <span>XAI_CONTROL_LAYER</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm">
            <div className="text-[#00ff41]/50 mb-4">
              System initialized. Gemini 3.1 Pro connected.<br/>
              Try commands like:<br/>
              - "Generate a new wallet"<br/>
              - "Derive 3 addresses"<br/>
              - "Check balances"<br/>
              - "Run test sequence 100 times"<br/>
              - "Clear sandbox"
            </div>
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 ${
                log.type === 'command' ? 'text-white' : 
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'warning' ? 'text-yellow-400' :
                log.type === 'success' ? 'text-[#00ff41]' : 'text-[#00ff41]/70'
              }`}>
                <span className="opacity-50 shrink-0">[{log.time}]</span>
                <span className="break-words">{log.text}</span>
              </div>
            ))}
            {isProcessing && (
              <div className="flex gap-3 text-[#00ff41]/70 animate-pulse">
                <span className="opacity-50">[{new Date().toLocaleTimeString()}]</span>
                <span>XAI processing intent...</span>
              </div>
            )}
            <div ref={logsEndRef} />
          </div>

          <div className="p-3 border-t border-[#00ff41]/20 bg-[#0f0f0f] flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <button 
                onClick={() => runPreset('Generate 50x wallets', handleGenerateSequence)}
                disabled={isProcessing}
                className="text-xs bg-[#00ff41]/10 hover:bg-[#00ff41]/20 border border-[#00ff41]/30 px-3 py-1.5 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Key size={12} /> Generate 50x
              </button>
              <button 
                onClick={() => runPreset('Derive 3 addresses', () => handleDerive(3))}
                disabled={!mnemonic || isProcessing}
                className="text-xs bg-[#00ff41]/10 hover:bg-[#00ff41]/20 border border-[#00ff41]/30 px-3 py-1.5 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Database size={12} /> Derive (3)
              </button>
              <button 
                onClick={() => runPreset('Check balances', handleCheckBalances)}
                disabled={wallets.length === 0 || isProcessing}
                className="text-xs bg-[#00ff41]/10 hover:bg-[#00ff41]/20 border border-[#00ff41]/30 px-3 py-1.5 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Activity size={12} /> Check Balances
              </button>
              <button 
                onClick={() => runPreset('Generate 100x mnemonics', handleGenerate100Sequence)}
                disabled={isProcessing}
                className="text-xs bg-blue-900/30 hover:bg-blue-900/50 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Cpu size={12} /> Generate 100x mnemonic
              </button>
              <button 
                onClick={() => runPreset('Clear sandbox', () => {
                  setEntropy(null); setMnemonic(null); setWallets([]); setMnemonics([]); setLogs([]); addLog('Sandbox cleared.', 'success');
                })}
                disabled={isProcessing}
                className="text-xs bg-red-900/20 hover:bg-red-900/40 border border-red-500/30 text-red-400 px-3 py-1.5 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
              >
                <Shield size={12} /> Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <ChevronRight size={16} className="text-[#00ff41]/50" />
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && executeCommand(command)}
                placeholder="Enter natural language command..."
                className="flex-1 bg-transparent border-none outline-none text-[#00ff41] placeholder-[#00ff41]/30 text-sm"
                disabled={isProcessing}
                autoFocus
              />
            </div>
          </div>
        </div>

        {/* Right Column: Dashboards */}
        <div className="lg:col-span-7 flex flex-col gap-6 h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Mnemonic Cards */}
          {mnemonics.length > 0 && (
            <div className="border border-[#00ff41]/20 bg-[#0a0a0a] rounded-lg p-5">
              <h2 className="text-sm font-bold flex items-center gap-2 mb-4 text-[#00ff41]/80 border-b border-[#00ff41]/20 pb-2">
                <Key size={16} />
                GENERATED_MNEMONICS
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {mnemonics.map((m, i) => (
                  <div key={i} className="p-3 bg-black border border-[#00ff41]/10 rounded text-xs font-mono text-[#00ff41]/70 break-words">
                    <span className="text-[#00ff41]/40 mr-2">#{i+1}</span>
                    {m}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System Health Dashboard */}
          {systemHealth && (
            <div className="border border-[#00ff41]/20 bg-[#0a0a0a] rounded-lg p-5">
              <h2 className="text-sm font-bold flex items-center gap-2 mb-4 text-[#00ff41]/80 border-b border-[#00ff41]/20 pb-2">
                <Cpu size={16} />
                SYSTEM_HEALTH
              </h2>
              <div className="flex gap-6 text-xs text-[#00ff41]/70">
                <div>
                  <span className="opacity-50 uppercase mr-2">Status:</span>
                  <span className="text-[#00ff41]">{systemHealth.status}</span>
                </div>
                <div>
                  <span className="opacity-50 uppercase mr-2">Uptime:</span>
                  <span>{(systemHealth.uptime / 60).toFixed(2)} min</span>
                </div>
                <div>
                  <span className="opacity-50 uppercase mr-2">Memory:</span>
                  <span>{(systemHealth.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>
            </div>
          )}

          {/* Transparency Dashboard */}
          <div className="border border-[#00ff41]/20 bg-[#0a0a0a] rounded-lg p-5">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4 text-[#00ff41]/80 border-b border-[#00ff41]/20 pb-2">
              <Shield size={16} />
              TRANSPARENCY_DASHBOARD
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#00ff41]/50 uppercase tracking-wider">Raw Entropy (Hex)</label>
                <div className="mt-1 p-3 bg-black border border-[#00ff41]/10 rounded font-mono text-sm break-all text-[#00ff41]/80">
                  {entropy || 'No entropy generated. Sandbox empty.'}
                </div>
              </div>
              
              <div>
                <label className="text-xs text-[#00ff41]/50 uppercase tracking-wider">BIP-39 Mnemonic</label>
                <div className="mt-1 p-3 bg-black border border-[#00ff41]/10 rounded font-mono text-sm text-white">
                  {mnemonic || 'Awaiting generation...'}
                </div>
              </div>
            </div>
          </div>

          {/* Wallet Checker */}
          <div className="border border-[#00ff41]/20 bg-[#0a0a0a] rounded-lg p-5 flex-1">
            <h2 className="text-sm font-bold flex items-center justify-between mb-4 text-[#00ff41]/80 border-b border-[#00ff41]/20 pb-2">
              <div className="flex items-center gap-2">
                <Database size={16} />
                DERIVED_WALLETS
              </div>
              {getScanSummary().status !== 'idle' && (
                <div className="flex items-center gap-2">
                  <div className="text-[10px] text-[#00ff41]/50 bg-black px-2 py-0.5 rounded border border-[#00ff41]/20">
                    BTC: {getScanSummary().checkedBtc} | ETH: {getScanSummary().checkedEth}
                  </div>
                  <div className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 transition-all duration-500 ${
                    getScanSummary().status === 'found' 
                    ? 'bg-green-500/20 border-green-500 text-green-500 shadow-[0_0_10px_rgba(34,197,94,0.2)]' 
                    : 'bg-red-500/20 border-red-500 text-red-500'
                  }`}>
                    {getScanSummary().status === 'found' ? (
                      <>
                        <Activity size={10} className="animate-pulse" />
                        Found: Seed #{getScanSummary().indices.map((i: any) => (i as number) + 1).join(', #')}
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={10} />
                        All Zero
                      </>
                    )}
                  </div>
                </div>
              )}
            </h2>
            
            {wallets.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-[#00ff41]/30 text-sm border border-dashed border-[#00ff41]/20 rounded">
                No wallets derived. Use XAI terminal to derive addresses.
              </div>
            ) : (
              <div className="space-y-6">
                {mnemonics.map((m, mnemonicIndex) => {
                  const groupWallets = wallets.filter(w => w.mnemonic === m);
                  if (groupWallets.length === 0) return null;
                  return (
                  <div key={mnemonicIndex} className="border border-[#00ff41]/10 rounded-lg p-4 bg-[#050505]">
                    <div className="mb-3 p-2 bg-black border border-[#00ff41]/10 rounded text-xs font-mono text-[#00ff41]/70 break-words flex justify-between items-center">
                      <span><span className="text-[#00ff41]/40 mr-2">Mnemonic #{mnemonicIndex + 1}:</span> {m}</span>
                      <button 
                        onClick={() => runPreset(`Check balances for group ${mnemonicIndex + 1}`, () => handleCheckBalancesForGroup(m))}
                        disabled={isProcessing}
                        className="text-[10px] bg-[#00ff41]/10 hover:bg-[#00ff41]/20 border border-[#00ff41]/30 px-2 py-1 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Activity size={10} /> Check
                      </button>
                    </div>
                    <div className="space-y-4">
                      {groupWallets.map((w) => (
                        <div key={w.id} className="p-4 bg-black border border-[#00ff41]/10 rounded-lg relative overflow-hidden group">
                          <div className="absolute top-0 left-0 w-1 h-full bg-[#00ff41]/30 group-hover:bg-[#00ff41] transition-colors" />
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-xs bg-[#00ff41]/10 text-[#00ff41] px-2 py-1 rounded">index {w.addressIndex}:</span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* BTC */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1 text-xs text-[#00ff41]/60">
                                  <Key size={12} /> BTC SegWit (m/84'/0'/0'/0/{w.addressIndex})
                                </div>
                                <button 
                                  onClick={() => window.open(`https://www.blockchain.com/btc/address/${w.btcSegwit}`, '_blank')}
                                  className="text-[#00ff41]/50 hover:text-[#00ff41] transition-colors"
                                >
                                  <ExternalLink size={12} />
                                </button>
                              </div>
                              <div className="text-sm break-all text-white/90">
                                {w.btcSegwit}
                              </div>
                              <div className="text-[10px] text-[#00ff41]/50 font-mono">
                                <div className="text-[10px] font-mono">
                                  <span className="text-yellow-500">Mainnet: </span>
                                  <span className={parseFloat(w.btcMainnetBalance || '0') > 0 ? 'text-green-500' : 'text-red-500'}>
                                    {w.btcMainnetBalance || '0'} BTC
                                  </span>
                                  <span className="text-yellow-500"> | </span>
                                  <span className="text-blue-500">Testnet: </span>
                                  <span className={parseFloat(w.btcTestnetBalance || '0') > 0 ? 'text-green-500' : 'text-red-500'}>
                                    {w.btcTestnetBalance || '0'} BTC
                                  </span>
                                </div>                              </div>
                            </div>
                            
                            {/* ETH */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1 text-xs text-[#00ff41]/60">
                                  <Key size={12} /> ETH (m/44'/60'/0'/0/{w.addressIndex})
                                </div>
                                <button 
                                  onClick={() => window.open(`https://etherscan.io/address/${w.eth}`, '_blank')}
                                  className="text-[#00ff41]/50 hover:text-[#00ff41] transition-colors"
                                >
                                  <ExternalLink size={12} />
                                </button>
                              </div>
                              <div className="text-sm break-all text-white/90">{w.eth}</div>
                              <div className="text-[10px] text-[#00ff41]/50 font-mono">
                                <span className={parseFloat(w.ethBalance || '0') > 0 ? 'text-green-500' : 'text-red-500'}>
                                  {w.ethBalance || '0'} ETH
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 255, 65, 0.2); border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0, 255, 65, 0.4); }
      `}} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

