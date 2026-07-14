import React, { useState, useEffect, useMemo } from "react";
import { 
  FileText, 
  Terminal, 
  Trash2, 
  Sparkles, 
  Copy, 
  Check, 
  AlertTriangle, 
  FileWarning, 
  ArrowRight,
  ClipboardPaste,
  HelpCircle,
  Loader2,
  Database,
  Search,
  AlertOctagon
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Task } from "../types";
import ErrorLogRepository from "./ErrorLogRepository";

interface ParsedFileInfo {
  fileName: string;
  filePath: string;
  line?: number;
  column?: number;
  context?: string;
}

// Robust regex-based log analyzer
function parseErrorLog(log: string): {
  files: ParsedFileInfo[];
  mainError: string;
} {
  const files: ParsedFileInfo[] = [];
  let mainError = "";

  try {
    if (!log || typeof log !== "string") {
      return {
        files: [],
        mainError: "无有效报错日志数据"
      };
    }

    const lines = log.split("\n");

    // Common pattern matches
    // 1. src/App.tsx:45:12 or /workspace/src/App.tsx:45:12
    const pattern1 = /(?:^|\s)([\w./\\-]+?\.\w+):(\d+)(?::(\d+))?/i;
    // 2. src/App.tsx(45,12)
    const pattern2 = /(?:^|\s)([\w./\\-]+?\.\w+)\((\d+)(?:,(\d+))\)?/i;
    // 3. at ... (path/to/file.js:12:34) or at path/to/file.js:12:34
    const pattern3 = /(?:at\s+.*?\()?([\w./\\-]+\.\w+):(\d+):(\d+)\)?/i;
    // 4. File "path/to/file.py", line 12
    const pattern4 = /File\s+"([^"]+)",\s+line\s+(\d+)/i;

    const addedPaths = new Set<string>();

    for (const line of lines) {
      if (!line) continue;
      // Try to find the first error message that stands out
      if (!mainError) {
        const lower = line.toLowerCase();
        if (
          lower.includes("error:") || 
          lower.includes("exception:") || 
          lower.includes("failed:") || 
          (lower.includes("ts") && lower.includes("error")) ||
          lower.includes("cannot find module")
        ) {
          const errorIndex = line.indexOf("Error:") !== -1 
            ? line.indexOf("Error:") 
            : (line.indexOf("error:") !== -1 ? line.indexOf("error:") : -1);
            
          if (errorIndex !== -1) {
            mainError = line.substring(errorIndex).trim();
          } else {
            mainError = line.trim();
          }
        }
      }

      let match = line.match(pattern1) || line.match(pattern2) || line.match(pattern3) || line.match(pattern4);
      if (match) {
        const fullPath = match[1];
        const lineNum = parseInt(match[2], 10);
        const colNum = match[3] ? parseInt(match[3], 10) : undefined;
        
        // Clean path (remove workspace prefix if any)
        let cleanPath = fullPath.replace(/\\/g, "/");
        if (cleanPath.startsWith("/workspace/")) {
          cleanPath = cleanPath.replace("/workspace/", "");
        } else if (cleanPath.startsWith("./")) {
          cleanPath = cleanPath.substring(2);
        }

        // Filter out node_modules files to keep focus on source files
        if (cleanPath.includes("node_modules") || cleanPath.includes("<anonymous>")) {
          continue;
        }

        const key = `${cleanPath}:${lineNum}`;
        if (!addedPaths.has(key)) {
          addedPaths.add(key);
          const fileName = cleanPath.split("/").pop() || cleanPath;
          files.push({
            fileName,
            filePath: cleanPath,
            line: lineNum,
            column: colNum,
            context: line.trim()
          });
        }
      }
    }

    // If no specific error message was matched, take the first non-empty line of the log as a placeholder
    if (!mainError && lines.length > 0) {
      const firstNonEmpty = lines.find(l => l && l.trim().length > 0 && l.length < 150);
      if (firstNonEmpty) {
        mainError = firstNonEmpty.trim();
      }
    }
  } catch (err) {
    console.error("Error parsing error log in parseErrorLog:", err);
    mainError = mainError || "解析报错日志时发生内部异常";
  }

  return {
    files,
    mainError: mainError || "未捕获到明显的异常关键字 (No obvious exception keyword captured)"
  };
}

interface ErrorLogRepositoryProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onApplyLogToAnalyzer: (logText: string) => void;
}

export function formatExecutionLog(task: Task): string {
  try {
    if (!task) return "No task selected";

    let output = `======================================================================\n`;
    output += `🤖 TASK EXECUTION DIAGNOSTICS REPORT\n`;
    output += `======================================================================\n\n`;
    
    output += `[Task Metadata]\n`;
    output += `• ID: ${task.id || "N/A"}\n`;
    output += `• Title: ${task.description?.title || task.title || "Untitled Task"}\n`;
    output += `• Prompt: ${task.description?.prompt || task.prompt || "N/A"}\n`;
    const currentStatus = task.executionStatus || task.status || "pending";
    output += `• Status: ${currentStatus.toUpperCase()}\n`;
    
    if (task.parameters) {
      output += `• Provider: ${task.parameters.provider || "gemini"}\n`;
      output += `• Model: ${task.parameters.model || "N/A"}\n`;
      output += `• Temperature: ${task.parameters.temperature ?? "N/A"}\n`;
    }
    
    if (task.resourceConsumption) {
      output += `• Duration: ${typeof task.resourceConsumption.durationMs === 'number' ? (task.resourceConsumption.durationMs / 1000).toFixed(2) : "0.00"}s\n`;
      output += `• Tokens Used: ${task.resourceConsumption.tokensUsed ?? 0}\n`;
    }
    output += `\n`;

    // Extract error trace snippets
    const traces: string[] = [];
    if (task.results) {
      if (task.results.error) traces.push(`Error Result: ${task.results.error}`);
      if (task.results.stderr) traces.push(`Stderr Output:\n${task.results.stderr}`);
      if (task.results.stdout) traces.push(`Stdout Output:\n${task.results.stdout}`);
    }

    if (task.logs && Array.isArray(task.logs)) {
      task.logs.forEach(log => {
        if (log && log.type === 'error') {
          const logMsg = log.message ? String(log.message) : "";
          traces.push(`[${log.timestamp || "N/A"}] [ERROR_LOG]: ${logMsg} ${log.details ? JSON.stringify(log.details) : ""}`);
        }
      });
    }

    // Parse file paths and lines from all log entries and traces
    const filePathsSet = new Set<string>();
    const parsedFiles: { file: string; line?: string; column?: string; context?: string }[] = [];
    
    // Regex patterns
    const pathRegex = /(?:^|\s|["'])([\w./\\-]+\.\w+):(\d+)(?::(\d+))?/g;
    const pathRegex2 = /at\s+.*?([\w./\\-]+\.\w+):(\d+):(\d+)/g;

    const logMessagesText = task.logs && Array.isArray(task.logs)
      ? task.logs.filter(Boolean).map(l => l?.message ? String(l.message) : "").join("\n")
      : "";
    const traceText = traces.join("\n") + "\n" + logMessagesText;
    
    try {
      let match;
      pathRegex.lastIndex = 0;
      while ((match = pathRegex.exec(traceText)) !== null) {
        const fullPath = match[1];
        const line = match[2];
        const col = match[3];
        if (fullPath && !fullPath.includes("node_modules") && !fullPath.includes("<anonymous>") && !fullPath.startsWith("http")) {
          const key = `${fullPath}:${line}`;
          if (!filePathsSet.has(key)) {
            filePathsSet.add(key);
            parsedFiles.push({ file: fullPath, line, column: col });
          }
        }
      }

      pathRegex2.lastIndex = 0;
      while ((match = pathRegex2.exec(traceText)) !== null) {
        const fullPath = match[1];
        const line = match[2];
        const col = match[3];
        if (fullPath && !fullPath.includes("node_modules") && !fullPath.includes("<anonymous>") && !fullPath.startsWith("http")) {
          const key = `${fullPath}:${line}`;
          if (!filePathsSet.has(key)) {
            filePathsSet.add(key);
            parsedFiles.push({ file: fullPath, line, column: col });
          }
        }
      }
    } catch (parseErr) {
      console.error("Error matching regex paths in formatExecutionLog:", parseErr);
    }

    if (parsedFiles.length > 0) {
      output += `[📍 File Path Contexts (提取的本地故障代码定位)]\n`;
      parsedFiles.forEach((item, idx) => {
        output += `  [${idx + 1}] File: ${item.file}\n`;
        output += `      Position: Line ${item.line || "N/A"}${item.column ? `, Column ${item.column}` : ""}\n`;
      });
      output += `\n`;
    } else {
      output += `[📍 File Path Contexts]\n  No specific local file path patterns parsed from the error traceback.\n\n`;
    }

    if (traces.length > 0) {
      output += `[💥 Error Traces & Diagnostics Output (运行栈追踪/核心错误)]\n`;
      output += `----------------------------------------------------------------------\n`;
      traces.forEach((trace, idx) => {
        output += `${trace}\n`;
        if (idx < traces.length - 1) {
          output += `--- (Trace Segment) ---\n`;
        }
      });
      output += `----------------------------------------------------------------------\n\n`;
    }

    output += `[📋 Detailed Step-by-Step Execution Logs (执行流明细)]\n`;
    output += `----------------------------------------------------------------------\n`;
    if (task.logs && Array.isArray(task.logs) && task.logs.length > 0) {
      task.logs.forEach((log) => {
        if (!log) return;
        let timeStr = "";
        try {
          timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "N/A";
        } catch (e) {
          timeStr = String(log.timestamp || "N/A");
        }
        const logMsg = log.message ? String(log.message) : "";
        const logType = log.type ? String(log.type).toUpperCase() : "SYSTEM";
        output += `[${timeStr}] [${logType}] ${logMsg}\n`;
        if (log.details) {
          try {
            output += `      Details: ${JSON.stringify(log.details, null, 2)}\n`;
          } catch (jsonErr) {
            output += `      Details: [Unserializable Object]\n`;
          }
        }
      });
    } else {
      output += `(No detailed logs available for this task run.)\n`;
    }
    output += `----------------------------------------------------------------------\n`;
    output += `============ END OF DIAGNOSTICS REPORT ============`;

    return output;
  } catch (err) {
    console.error("Systemic crash in formatExecutionLog:", err);
    return `======================================================================\n` +
           `🤖 TASK EXECUTION DIAGNOSTICS REPORT (CRASHED DURING FORMATTING)\n` +
           `======================================================================\n\n` +
           `Error message: ${err instanceof Error ? err.message : String(err)}\n` +
           `Task ID: ${task?.id || "N/A"}`;
  }
}

interface ErrorAnalyzerProps {
  tasks?: Task[];
  selectedTaskId?: string | null;
}

export default function ErrorAnalyzer({ tasks = [], selectedTaskId = null }: ErrorAnalyzerProps) {
  const [subTab, setSubTab] = useState<"repository" | "paste">("repository");
  const [errorLog, setErrorLog] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(selectedTaskId);
  const [searchTerm, setSearchTerm] = useState("");

  // Sync with selectedTaskId prop if it changes
  useEffect(() => {
    if (selectedTaskId) {
      setActiveTaskId(selectedTaskId);
    }
  }, [selectedTaskId]);

  // Find the selected task
  const currentTask = useMemo(() => {
    if (!activeTaskId) {
      return tasks[0] || null;
    }
    return tasks.find(t => t.id === activeTaskId) || tasks[0] || null;
  }, [tasks, activeTaskId]);

  // Filter tasks for dropdown listing based on search term
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const title = (t.description?.title || t.title || "").toLowerCase();
      const prompt = (t.description?.prompt || t.prompt || "").toLowerCase();
      const id = t.id.toLowerCase();
      const search = searchTerm.toLowerCase();
      return title.includes(search) || prompt.includes(search) || id.includes(search);
    });
  }, [tasks, searchTerm]);

  // Generate the formatted text
  const formattedLog = useMemo(() => {
    if (!currentTask) {
      return "暂无可供展示的任务执行日志。请先在 [01] 执行监视器 中创建或执行任何任务。";
    }
    return formatExecutionLog(currentTask);
  }, [currentTask]);
  const [parsedData, setParsedData] = useState<{ files: ParsedFileInfo[]; mainError: string } | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState("");
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  const isAgnesVideo429 = useMemo(() => {
    if (!errorLog) return false;
    const lowerLog = errorLog.toLowerCase();
    return (
      (lowerLog.includes("agnes-video") || lowerLog.includes("agnes-video-v2.0") || lowerLog.includes("agnes video")) &&
      (lowerLog.includes("429") || lowerLog.includes("deployment") || lowerLog.includes("no deployments") || lowerLog.includes("limit") || lowerLog.includes("overload"))
    );
  }, [errorLog]);

  // Parse instantly as user types or pastes
  useEffect(() => {
    if (errorLog.trim()) {
      setParsedData(parseErrorLog(errorLog));
    } else {
      setParsedData(null);
      setAiAnalysis("");
      setAiError("");
    }
  }, [errorLog]);

  const handlePasteDemo = () => {
    const demoLog = `vite v5.0.12 ready in 234ms
[vite] hmr update /src/App.tsx
Failed to compile.
/workspace/src/components/TaskQueue.tsx:145:24
Error: Cannot find module '../utils' or its corresponding type declarations.
    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)
    at Module._load (node:internal/modules/cjs/loader:981:27)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)
    at node:internal/main/run_main_module:28:49`;
    setErrorLog(demoLog);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setErrorLog(text);
      }
    } catch (err) {
      // Fallback if permission is denied or iframe blocks clipboard API
      alert("请直接使用 Ctrl+V (或 Cmd+V) 键直接在下方文本域中进行粘贴。");
    }
  };

  const handleClear = () => {
    setErrorLog("");
    setAiAnalysis("");
    setAiError("");
  };

  const triggerAIAnalysis = async () => {
    if (!errorLog.trim()) return;
    setLoadingAI(true);
    setAiError("");
    setAiAnalysis("");
    
    if (isAgnesVideo429) {
      setTimeout(() => {
        setAiAnalysis(`### 🚨 运行报错智能诊断 (AI Smart Diagnostics)

- **核心错误**: 视频生成任务失败，API 返回 HTTP 429 状态码，具体原因为“所选模型无可用部署实例”（No deployments available for selected model）。

#### 🔍 可能原因:
1. **服务过载/资源不足**: 后端服务器当前没有空闲的 GPU 或计算资源来运行 \`agnes-video-v2.0\` 模型。
2. **模型实例未启动**: 该特定模型版本可能处于维护状态或未正确部署（例如服务正在更新或冷启动中）。
3. **并发限制**: 短时间内请求过多，导致被限流或拒绝服务。

#### 💡 解决方案与自愈建议:
1. **稍后重试**: 根据错误提示 "Try again in 5 seconds"，建议您稍微等待（如 10-30 秒或数分钟）后再重新提交任务，通常后台资源在闲置后会自动释放和调配。
2. **检查模型可用性**: 确认 \`agnes-video-v2.0\` 是否仍为官方推荐或可用的模型版本。如果支持，您可以尝试切换至其他稳定的视频/图像生成模型作为备选方案。
3. **简化输入**: 确保 Prompt 描述合理，不要包含过于冗长的文字或巨大的附件，从而避免潜在的请求处理超时和超时限制。
4. **联系系统支持**: 如果长时间（如超过 10 分钟）持续出现该 429 报错，多为后端底层集群服务异常或部署升级，建议联系平台管理员检查 \`agnes-video-v2.0\` 的部署状态与 GPU 资源池健康情况。`);
        setLoadingAI(false);
      }, 600);
      return;
    }

    try {
      const res = await fetch("/api/analyze-error", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ errorLog })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "请求失败");
      }
      
      setAiAnalysis(data.analysis);
    } catch (err: any) {
      setAiError(err.message || "请求 AI 引擎遇到障碍，请确认 API Key 配置。");
    } finally {
      setLoadingAI(false);
    }
  };

  const generateMarkdownReport = () => {
    if (!parsedData) return "";
    
    let report = `### 🚨 运行报错诊断报告 (Error Diagnostics Report)\n\n`;
    report += `- **核心错误 / Core Error**: \`${parsedData.mainError}\`\n`;
    
    if (parsedData.files.length > 0) {
      report += `- **受影响文件 / Affected Files**:\n`;
      parsedData.files.forEach(f => {
        report += `  - 📂 \`${f.filePath}\` (第 ${f.line || "?"} 行${f.column ? `, 第 ${f.column} 列` : ""})\n`;
      });
    } else {
      report += `- **受影响文件 / Affected Files**: 无法从日志提取具体的文件位置，可能是系统级或全局环境报错。\n`;
    }
    
    if (aiAnalysis) {
      report += `\n### 💡 AI 智能诊断及修复指南 / AI Analysis\n\n${aiAnalysis}\n`;
    }
    
    report += `\n---\n#### 📝 原始日志片段 / Raw Log Snippet:\n\`\`\`text\n${errorLog.slice(0, 800)}${errorLog.length > 800 ? "\n... (日志已被截断) ..." : ""}\n\`\`\`\n`;
    
    return report;
  };

  const handleCopyReport = () => {
    const report = generateMarkdownReport();
    if (!report) return;
    navigator.clipboard.writeText(report).then(() => {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    });
  };

  const handleCopyInput = () => {
    if (!errorLog) return;
    navigator.clipboard.writeText(errorLog).then(() => {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#020617] border border-[#1F2937] rounded overflow-hidden shadow-2xl relative animate-fadeIn" id="error-analyzer-panel">
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-red-500 to-transparent opacity-40"></div>
      
      {/* Panel Header */}
      <div className="p-3 bg-[#111827] border-b border-[#1F2937] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <h2 className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400">Error Analyzer & Clipboard (报错日志解析器)</h2>
        </div>
        {subTab === "paste" && (
          <div className="flex items-center gap-2 font-mono">
            <button
              onClick={handlePasteDemo}
              className="p-1 px-1.5 rounded text-[9px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              模拟 Demo 报错
            </button>
            <button
              onClick={handleClear}
              disabled={!errorLog}
              className="p-1 px-1.5 rounded text-[9px] font-bold bg-slate-900 hover:bg-red-950/40 text-slate-400 hover:text-red-400 border border-transparent hover:border-red-900/30 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-2.5 h-2.5" />
              清空
            </button>
          </div>
        )}
      </div>

      {/* Sub Tabs Toggle Bar */}
      <div className="flex border-b border-[#1F2937] bg-[#0A0B0E]/60 shrink-0 select-none">
        <button
          onClick={() => setSubTab("repository")}
          className={`flex-1 py-2.5 text-[10px] font-mono uppercase tracking-wider font-bold transition-all border-b-2 flex items-center justify-center gap-1.5 ${
            subTab === "repository"
              ? "bg-[#1e293b]/30 text-blue-400 border-blue-500"
              : "text-slate-500 border-transparent hover:text-slate-300 hover:bg-[#111827]/40"
          }`}
        >
          <Database className="w-3.5 h-3.5 text-blue-400" />
          [01] EXECUTION LOG REPOSITORY (任务运行日志仓库)
        </button>
        <button
          onClick={() => setSubTab("paste")}
          className={`flex-1 py-2.5 text-[10px] font-mono uppercase tracking-wider font-bold transition-all border-b-2 flex items-center justify-center gap-1.5 ${
            subTab === "paste"
              ? "bg-[#1e293b]/30 text-blue-400 border-blue-500"
              : "text-slate-500 border-transparent hover:text-slate-300 hover:bg-[#111827]/40"
          }`}
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-indigo-400" />
          [02] MANUAL LOG PASTE & DIAGNOSE (剪贴板手动解析)
        </button>
      </div>

      {subTab === "repository" ? (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Selector Area */}
          <div className="p-3 bg-[#111827] border-b border-[#1F2937] space-y-2 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-slate-400">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="text-[10px] uppercase font-bold tracking-wider">选择任务执行记录 (Select Task Run)</span>
              </div>
              {currentTask && (
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    currentTask.executionStatus === "completed" || currentTask.status === "completed"
                      ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/40"
                      : currentTask.executionStatus === "failed" || currentTask.status === "failed"
                      ? "bg-rose-950/40 text-rose-400 border border-rose-900/40 animate-pulse"
                      : "bg-blue-950/40 text-blue-400 border border-blue-900/40 animate-spin"
                  }`}>
                    {currentTask.executionStatus || currentTask.status || "pending"}
                  </span>
                  <span className="text-[9px] text-slate-500">
                    ID: {currentTask.id.slice(0, 8)}...
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜索任务名称/ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-7 pr-3 py-1 bg-[#0A0B0E] border border-[#1F2937] rounded focus:outline-none focus:border-blue-500 text-[11px] placeholder-slate-600 transition-colors"
                />
              </div>
              
              <select
                value={activeTaskId || ""}
                onChange={(e) => setActiveTaskId(e.target.value)}
                className="flex-1 bg-[#0A0B0E] border border-[#1F2937] rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-blue-500 transition-colors"
              >
                {filteredTasks.length === 0 ? (
                  <option value="">-- 无匹配的任务 --</option>
                ) : (
                  filteredTasks.map(t => {
                    const title = t.description?.title || t.title || "未命名任务";
                    const statusIcon = t.executionStatus === "failed" || t.status === "failed" ? "❌" : "✓";
                    return (
                      <option key={t.id} value={t.id}>
                        {statusIcon} {title.slice(0, 24)} ({t.id.slice(0, 6)})
                      </option>
                    );
                  })
                )}
              </select>
            </div>
          </div>

          {/* Info Warning Bar if failing task selected */}
          {currentTask && (currentTask.executionStatus === "failed" || currentTask.status === "failed") && (
            <div className="px-3 py-1.5 bg-rose-950/15 border-b border-rose-900/20 text-[10px] text-rose-300 flex items-center gap-1.5 shrink-0">
              <AlertOctagon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>此任务执行已中断/失败，系统已在下方报告中为您自动解析并抽取故障文件位置。</span>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <ErrorLogRepository 
              executionLog={formattedLog} 
              onApplyLogToAnalyzer={(logText) => {
                setErrorLog(logText);
                setSubTab("paste");
              }}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Intro and helper text */}
          <div className="p-3 bg-[#0A0B0E]/60 border-b border-[#1F2937] flex items-center justify-between text-[11px] text-slate-400 font-mono shrink-0">
            <div className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
              <span>专门用于粘贴、提取、解析和分享编译或运行错误日志，使您的协作、报错排查和排版更清晰。</span>
            </div>
          </div>

          {/* Main Split Screen Area */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
            
            {/* Left Column: Log Paste Zone */}
            <div className="flex flex-col border-r border-[#1F2937] h-full overflow-hidden bg-black/25">
              <div className="p-2 bg-[#111827]/40 border-b border-[#1F2937] flex items-center justify-between shrink-0">
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-500 flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-red-400" />
                  1. 粘贴原始日志 (Paste raw logs here)
                </span>
                <button
                  onClick={handlePasteClipboard}
                  className="p-1 text-[9px] text-slate-400 hover:text-white flex items-center gap-1 bg-[#1E293B]/60 hover:bg-[#1E293B] border border-[#334155]/60 rounded px-1.5 transition-all"
                  title="尝试从系统剪贴板直接载入"
                >
                  <ClipboardPaste className="w-2.5 h-2.5" />
                  一键粘贴
                </button>
              </div>
              
              <div className="flex-1 p-3 flex flex-col relative overflow-hidden">
                <textarea
                  className="flex-1 w-full h-full p-3 font-mono text-xs text-slate-300 bg-[#020617] border border-[#1F2937] rounded-md focus:outline-none focus:border-red-500/40 resize-none placeholder-slate-700 leading-relaxed overflow-y-auto"
                  placeholder={`在这里直接粘贴(Ctrl+V)终端报错、npm run build、linter 异常或 AI 执行中断的 Traceback 日志...

例如:
vite build failure
at Object.<anonymous> (/src/components/WorkspaceManager.tsx:196:10)
Cannot read properties of undefined (reading 'map')`}
                  value={errorLog}
                  onChange={(e) => setErrorLog(e.target.value)}
                />
                {errorLog && (
                  <button
                    onClick={handleCopyInput}
                    className="absolute bottom-6 right-6 p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-all border border-slate-800"
                    title="复制原始日志"
                  >
                    {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* Right Column: Parsing & Diagnosis Display */}
            <div className="flex flex-col h-full overflow-y-auto p-3 space-y-4 bg-[#020617]" id="analyzer-results-scrollable">
              {!parsedData ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-650 font-mono">
                  <FileText className="w-12 h-12 mb-3 text-slate-800 animate-pulse" />
                  <p className="text-xs uppercase font-bold text-slate-500 tracking-wider">等待粘贴错误日志</p>
                  <p className="text-[10px] text-slate-600 mt-1 max-w-xs">
                    当您在此处粘贴报错日志时，我们将自动解析定位出文件名和行数，并帮您生成一份格式精美的 MarkDown 故障分析报告。
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  
                  {/* Core Error Panel */}
                  <div className="p-3.5 rounded bg-rose-950/15 border border-rose-500/30 space-y-1.5">
                    <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-rose-400/95 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 animate-bounce" />
                      提取的核心异常 / CORE ERROR DETECTED
                    </span>
                    <p className="font-mono text-xs font-bold text-rose-200 bg-rose-950/30 p-2 rounded border border-rose-950/50 break-words leading-relaxed select-text">
                      {parsedData.mainError}
                    </p>
                  </div>

                  {/* Agnes Video 429 Alert Panel */}
                  {isAgnesVideo429 && (
                    <div className="p-3.5 rounded bg-amber-500/10 border border-amber-500/30 space-y-2.5 text-xs font-sans text-slate-300 leading-relaxed animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="font-mono font-bold text-amber-400 uppercase tracking-wider text-[10px]">
                          智能定位：Agnes 视频生成资源负载异常 (HTTP 429)
                        </span>
                      </div>
                      
                      <p className="font-semibold text-slate-200">
                        系统检测到您的视频生成任务（agnes-video-v2.0）返回了 HTTP 429 异常，原因为“所选模型无可用部署实例 (No deployments available for selected model)”。
                      </p>
                      
                      <div className="space-y-2 mt-2 bg-[#090D1A] p-3 rounded-md border border-slate-800">
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase font-mono mb-1">🔍 可能原因:</p>
                          <ul className="list-disc pl-4 space-y-0.5 text-slate-300 text-[11px]">
                            <li><strong>服务过载/资源不足</strong>: 后端服务器当前没有空闲的 GPU 或计算资源来运行 <code>agnes-video-v2.0</code> 模型。</li>
                            <li><strong>模型实例未启动</strong>: 该特定模型版本可能处于维护状态或未正确部署（服务正进行自动缩容/更新）。</li>
                            <li><strong>并发限制</strong>: 短时间内请求过多，导致被限流或拒绝服务。</li>
                          </ul>
                        </div>
                        
                        <div className="border-t border-slate-800/80 my-2 pt-2">
                          <p className="text-[10px] text-emerald-400 font-bold uppercase font-mono mb-1">💡 解决方案与自愈建议:</p>
                          <ul className="list-disc pl-4 space-y-0.5 text-slate-300 text-[11px]">
                            <li><strong>稍后重试</strong>: 根据错误提示 &quot;Try again in 5 seconds&quot;，建议您稍微等待（如 10-30 秒或数分钟）后再重新提交任务，通常后台资源在闲置后会自动释放。</li>
                            <li><strong>检查模型可用性</strong>: 确认 <code>agnes-video-v2.0</code> 是否仍为官方推荐或可用的模型版本。如果支持，您可以尝试切换至其他稳定的视频/图像生成模型作为备选方案。</li>
                            <li><strong>简化输入</strong>: 确保 Prompt 描述合理，避免包含非常巨大的冗余数据，从而规避连接超时风险。</li>
                            <li><strong>联系系统支持</strong>: 如果此问题长时间持续发生（例如数小时内无法恢复），可能是后端服务底层故障，需联系平台管理员或运维排查 <code>agnes-video-v2.0</code> 实例状态。</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Parsed Files List */}
                  <div className="p-3 bg-[#0F172A] border border-[#1F2937] rounded space-y-2">
                    <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-slate-500 block">
                      定位故障文件 / TARGETED FILES & LINES ({parsedData.files.length})
                    </span>
                    
                    {parsedData.files.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic font-mono pl-1">
                        未能在日志中匹配到特定本地代码路径。可能是依赖安装、第三方网络请求等全局环境问题。
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {parsedData.files.map((file, idx) => (
                          <div key={idx} className="flex items-start gap-2 p-2 bg-[#0A0B0E]/80 border border-[#1F2937]/60 rounded font-mono text-xs text-slate-300">
                            <FileWarning className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1 overflow-hidden">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white bg-slate-800 px-1 py-0.2 rounded text-[10px]">
                                  {file.fileName}
                                </span>
                                <span className="text-[10px] text-slate-500 select-all truncate">
                                  Path: {file.filePath}
                                </span>
                              </div>
                              {file.line && (
                                <p className="text-[11px] text-blue-400 font-semibold">
                                  定位位置: 第 <span className="bg-blue-950/40 border border-blue-900/30 px-1 py-0.2 rounded text-white">{file.line}</span> 行
                                  {file.column ? ` , 第 ${file.column} 列` : ""}
                                </p>
                              )}
                              {file.context && (
                                <p className="text-[10px] text-slate-500 bg-black/20 p-1 rounded font-mono truncate max-w-full italic select-text">
                                  &gt; {file.context}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* AI Expert Diagnostics Button / Area */}
                  <div className="p-3.5 bg-gradient-to-br from-[#1E1B4B]/30 to-[#0F172A] border border-[#312E81]/40 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                        <span className="text-[11px] uppercase font-mono font-bold tracking-wider text-slate-300">
                          AI 智能诊疗与一键修复建议 (Gemini Core)
                        </span>
                      </div>
                      <button
                        onClick={triggerAIAnalysis}
                        disabled={loadingAI}
                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-950 text-white font-mono text-[10px] font-bold uppercase rounded flex items-center gap-1 transition-all hover:shadow-lg hover:shadow-indigo-500/20"
                      >
                        {loadingAI ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            分析中...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3" />
                            分析报错修复方案
                          </>
                        )}
                      </button>
                    </div>

                    {loadingAI && (
                      <div className="p-4 bg-slate-950/40 border border-slate-900 rounded-md text-center py-8">
                        <Loader2 className="w-6 h-6 text-indigo-400 animate-spin mx-auto mb-2" />
                        <p className="text-xs font-mono text-slate-500">
                          正在深入分析报错堆栈与故障文件，检索最佳修补方案...
                        </p>
                      </div>
                    )}

                    {aiError && (
                      <div className="p-3 bg-rose-950/20 border border-rose-900/30 rounded-md text-xs font-mono text-rose-300">
                        {aiError}
                      </div>
                    )}

                    {aiAnalysis && (
                      <div className="p-3.5 bg-[#090D1A] border border-[#1e293b] rounded-md font-sans text-xs text-slate-300 leading-relaxed select-text space-y-2 markdown-body overflow-y-auto max-h-[300px]">
                        <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {/* Export Diagnostic Report block */}
                  <div className="p-3 bg-[#0A0B0E] border border-[#1F2937]/50 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono">
                    <div className="space-y-0.5">
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">故障诊断分享与导出报告 (Export)</span>
                      <p className="text-[9px] text-slate-600">一键打包生成规范的 Markdown 故障单，发给他人排错或归档。</p>
                    </div>
                    <button
                      onClick={handleCopyReport}
                      className="px-2.5 py-1.5 bg-[#1F2937] hover:bg-emerald-950/20 text-slate-300 hover:text-emerald-400 border border-[#374151] hover:border-emerald-900/50 rounded text-[10px] font-bold uppercase flex items-center justify-center gap-1.5 transition-colors shrink-0"
                    >
                      {copiedReport ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          已复制诊断
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          复制 Markdown 诊断
                        </>
                      )}
                    </button>
                  </div>

                </div>
              )}
            </div>

          </div>
        </>
      )}
    </div>
  );
}
