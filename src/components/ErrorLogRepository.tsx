import React, { useState, useMemo } from "react";
import { Terminal, Copy, Check, FileText, HelpCircle, Sparkles } from "lucide-react";

interface ErrorLogRepositoryProps {
  executionLog: string;
  onApplyLogToAnalyzer?: (logText: string) => void;
}

export default function ErrorLogRepository({
  executionLog,
  onApplyLogToAnalyzer
}: ErrorLogRepositoryProps) {
  const [copied, setCopied] = useState(false);

  // Parse file paths, error traces, and execution logs from the executionLog prop
  const formattedDiagnostics = useMemo(() => {
    if (!executionLog) {
      return "暂无执行日志内容。请在执行监视器或输入框中载入日志。";
    }

    // If it's already a formatted report, return it as is
    if (executionLog.includes("TASK EXECUTION DIAGNOSTICS REPORT")) {
      return executionLog;
    }

    let output = `======================================================================\n`;
    output += `🤖 TASK EXECUTION DIAGNOSTICS REPORT (AUTO-FORMATTED)\n`;
    output += `======================================================================\n\n`;

    // 1. Error Traces extraction
    const lines = executionLog.split("\n");
    const errorLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes("error:") ||
        lower.includes("exception:") ||
        lower.includes("failed") ||
        lower.includes("rejected") ||
        lower.includes("err ") ||
        lower.includes("traceback") ||
        lower.includes("stack")
      );
    });

    if (errorLines.length > 0) {
      output += `[💥 Error Traces & Diagnostics Output (核心错误/异常片段)]\n`;
      output += `----------------------------------------------------------------------\n`;
      errorLines.forEach((errLine, idx) => {
        output += `  [Trace ${idx + 1}] ${errLine.trim()}\n`;
      });
      output += `----------------------------------------------------------------------\n\n`;
    } else {
      output += `[💥 Error Traces & Diagnostics Output]\n  No specific error lines detected.\n\n`;
    }

    // 2. File Path Contexts extraction
    const filePathsSet = new Set<string>();
    const pathRegex = /(?:^|\s|["'])([\w./\\-]+\.\w+):(\d+)(?::(\d+))?/g;
    const pathRegex2 = /at\s+.*?([\w./\\-]+\.\w+):(\d+):(\d+)/g;
    const parsedFiles: { file: string; line: string; col?: string }[] = [];

    let match;
    pathRegex.lastIndex = 0;
    while ((match = pathRegex.exec(executionLog)) !== null) {
      const fullPath = match[1];
      const line = match[2];
      const col = match[3];
      if (
        fullPath &&
        !fullPath.includes("node_modules") &&
        !fullPath.includes("<anonymous>") &&
        !fullPath.startsWith("http")
      ) {
        const key = `${fullPath}:${line}`;
        if (!filePathsSet.has(key)) {
          filePathsSet.add(key);
          parsedFiles.push({ file: fullPath, line, col });
        }
      }
    }

    pathRegex2.lastIndex = 0;
    while ((match = pathRegex2.exec(executionLog)) !== null) {
      const fullPath = match[1];
      const line = match[2];
      const col = match[3];
      if (
        fullPath &&
        !fullPath.includes("node_modules") &&
        !fullPath.includes("<anonymous>") &&
        !fullPath.startsWith("http")
      ) {
        const key = `${fullPath}:${line}`;
        if (!filePathsSet.has(key)) {
          filePathsSet.add(key);
          parsedFiles.push({ file: fullPath, line, col });
        }
      }
    }

    if (parsedFiles.length > 0) {
      output += `[📍 File Path Contexts (故障代码定位)]\n`;
      parsedFiles.forEach((item, idx) => {
        output += `  [${idx + 1}] File: ${item.file}\n`;
        output += `      Position: Line ${item.line}${item.col ? `, Column ${item.col}` : ""}\n`;
      });
      output += `\n`;
    } else {
      output += `[📍 File Path Contexts]\n  No local file paths parsed from the logs.\n\n`;
    }

    // 3. Execution Logs
    output += `[📋 Detailed Step-by-Step Execution Logs]\n`;
    output += `----------------------------------------------------------------------\n`;
    output += executionLog;
    output += `\n----------------------------------------------------------------------\n`;
    output += `============ END OF DIAGNOSTICS REPORT ============`;

    return output;
  }, [executionLog]);

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedDiagnostics).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#020617] text-slate-300 font-mono text-xs overflow-hidden" id="error-log-repository">
      {/* Selector / Fixed Header Area */}
      <div className="p-3 bg-[#111827] border-b border-[#1F2937] flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-1.5 text-slate-400">
          <FileText className="w-4 h-4 text-blue-400" />
          <span className="text-[10px] uppercase font-bold tracking-wider">执行日志档案 (Execution Log Repository)</span>
        </div>
        {onApplyLogToAnalyzer && (
          <button
            onClick={() => onApplyLogToAnalyzer(executionLog)}
            className="p-1 px-2 rounded text-[9px] font-bold bg-indigo-950/40 hover:bg-indigo-900 text-indigo-300 border border-indigo-900/30 hover:border-indigo-800 transition-all flex items-center gap-1"
          >
            <Sparkles className="w-2.5 h-2.5" />
            载入 AI 智能诊断
          </button>
        )}
      </div>

      {/* Log Display Content Area */}
      <div className="flex-1 p-3 flex flex-col min-h-0 bg-black/10">
        <div className="p-2 bg-[#0A0B0E] border border-b-0 border-[#1F2937] rounded-t flex items-center justify-between shrink-0">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-1">
            <Terminal className="w-3 h-3 text-blue-400" />
            2. 格式化日志归档与调试文件 (Formatted Diagnostics)
          </span>
          <button
            onClick={handleCopy}
            className="p-1 px-2 rounded text-[9px] font-bold bg-[#1e293b] hover:bg-[#334155] text-slate-200 border border-slate-700 hover:border-slate-600 transition-all flex items-center gap-1"
            title="一键格式化并复制诊断报告"
          >
            {copied ? (
              <>
                <Check className="w-2.5 h-2.5 text-emerald-400" />
                已复制到剪贴板
              </>
            ) : (
              <>
                <Copy className="w-2.5 h-2.5" />
                复制 formatted 日志
              </>
            )}
          </button>
        </div>

        <textarea
          readOnly
          value={executionLog || "暂无可供展示的任务执行日志。"}
          className="flex-1 w-full h-full p-4 font-mono text-[11px] leading-relaxed text-slate-300 bg-[#020617] border border-[#1F2937] rounded-b focus:outline-none resize-none overflow-y-auto custom-scrollbar select-text tracking-wide whitespace-pre"
          placeholder="暂无可供渲染的日志堆栈"
        />
      </div>

      {/* Footer Area */}
      <div className="p-2.5 bg-[#111827] border-t border-[#1F2937] flex items-center justify-between text-[10px] text-slate-500 shrink-0">
        <span className="flex items-center gap-1">
          <HelpCircle className="w-3 h-3 text-slate-600" />
          使用此报告，外部专家便可以非常高效、精准地定位任何报错。
        </span>
      </div>
    </div>
  );
}
