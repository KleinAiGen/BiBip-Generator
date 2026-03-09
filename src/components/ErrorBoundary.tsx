import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050505] text-[#00ff41] font-mono flex items-center justify-center p-4">
          <div className="max-w-md w-full border border-red-900/50 bg-[#0a0a0a] rounded-lg p-6 shadow-[0_0_15px_rgba(255,0,0,0.1)]">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <AlertTriangle size={32} />
              <h1 className="text-xl font-bold">System Failure</h1>
            </div>
            
            <p className="text-sm text-red-400/80 mb-4">
              A critical error occurred in the XAI Control Layer. The sandbox has been halted to prevent state corruption.
            </p>
            
            <div className="bg-black p-3 rounded border border-red-900/30 text-xs text-red-400/60 mb-6 overflow-x-auto">
              {this.state.error?.message || 'Unknown error'}
            </div>
            
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 bg-red-950/30 hover:bg-red-900/50 text-red-500 border border-red-900/50 py-2 rounded transition-colors"
            >
              <RefreshCw size={16} />
              Reboot System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
