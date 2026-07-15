import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Terminal } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div 
          className="flex flex-col items-center justify-center h-full p-6 bg-[#020617]/90 border border-rose-500/30 rounded-lg text-slate-300 shadow-2xl space-y-4 font-sans"
          id="error-boundary-container"
        >
          <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/30 text-rose-400 animate-pulse">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="text-center space-y-1 max-w-md">
            <h3 className="text-xs font-mono font-bold tracking-wider text-rose-400 uppercase">
              {this.props.fallbackTitle || "PANEL RENDER ERROR (组件加载崩溃)"}
            </h3>
            <p className="text-[11px] text-slate-400">
              沙箱内部渲染流中发生未捕获的运行时异常，已安全隔离此面板。
            </p>
          </div>

          <div className="w-full max-w-md bg-[#020617] rounded border border-[#1F2937] p-3 font-mono text-[10px] text-rose-400 overflow-auto max-h-40 custom-scrollbar select-text leading-relaxed">
            <div className="flex items-center gap-1.5 border-b border-[#1F2937] pb-1.5 mb-1.5 text-slate-500 text-[9px] uppercase font-bold">
              <Terminal className="w-3.5 h-3.5 text-rose-500" />
              <span>Diagnostic Stack Log</span>
            </div>
            <div className="font-bold">Error: {this.state.error?.message || "Unknown Error"}</div>
            {this.state.error?.stack && (
              <pre className="mt-1 text-slate-500 text-[9px] whitespace-pre-wrap leading-normal font-medium">
                {this.state.error.stack.split("\n").slice(0, 3).join("\n")}
              </pre>
            )}
          </div>

          <div className="flex gap-2 font-mono">
            <button
              onClick={this.handleReset}
              className="px-3 py-1.5 bg-[#111827] hover:bg-[#1E293B] border border-[#1F2937] hover:border-blue-500/40 text-[10px] font-bold uppercase text-slate-300 hover:text-blue-400 rounded transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Panel (重试恢复)
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-[10px] font-bold uppercase text-blue-400 rounded transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              Reload App (重载整个页面)
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
