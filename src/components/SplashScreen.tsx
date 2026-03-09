import React, { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

export const SplashScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing XAI Ag3nt...');

  const handleStart = async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen request denied:", err);
    }
    onComplete();
  };

  useEffect(() => {
    const sequence = [
      { p: 10, s: 'Loading cryptographic modules...' },
      { p: 30, s: 'Establishing secure sandbox...' },
      { p: 50, s: 'Connecting to Gemini 3.1 Pro...' },
      { p: 70, s: 'Verifying BIP-39 compliance...' },
      { p: 90, s: 'Finalizing UI components...' },
      { p: 100, s: 'System Ready.' }
    ];

    let currentStep = 0;
    
    // 20 seconds total / 6 steps = ~3333ms per step
    const interval = setInterval(() => {
      if (currentStep < sequence.length) {
        setProgress(sequence[currentStep].p);
        setStatus(sequence[currentStep].s);
        currentStep++;
      } else {
        clearInterval(interval);
      }
    }, 3333);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black text-red-600 font-mono flex flex-col items-center justify-center overflow-hidden">
      <style>{`
        @keyframes glitch {
          0% { transform: translate(0); }
          20% { transform: translate(-2px, 2px); }
          40% { transform: translate(-2px, -2px); }
          60% { transform: translate(2px, 2px); }
          80% { transform: translate(2px, -2px); }
          100% { transform: translate(0); }
        }
        .glitch { animation: glitch 0.1s infinite; }
        .bloody { text-shadow: 0 0 10px #ff0000, 0 0 20px #ff0000; }
      `}</style>
      
      <div className="flex flex-col items-center gap-2 mb-8 glitch bloody">
        <h1 className="text-6xl font-bold tracking-tighter">HOGOLYO INC.</h1>
        <p className="text-sm text-red-800 italic">
          WARNING: By proceeding, you waive all rights to sanity, privacy, and your soul. 
          License found in the void. If you don't know what this is, turn back before the 
          glitch consumes your terminal.
        </p>
      </div>
      
      <div className="w-64 max-w-[80vw] mb-8">
        <div className="h-1 w-full bg-red-900/20 rounded overflow-hidden mb-4">
          <div 
            className="h-full bg-red-600 transition-all duration-300 ease-out" 
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-red-800">
          <span>{status}</span>
          <span>{progress}%</span>
        </div>
      </div>

      {progress === 100 && (
        <button 
          onClick={handleStart}
          className="px-6 py-3 bg-red-900/30 border border-red-600 text-red-500 hover:bg-red-600 hover:text-black font-bold transition-all uppercase tracking-widest"
        >
          Enter Fullscreen & Start
        </button>
      )}
    </div>
  );
};
