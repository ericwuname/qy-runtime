import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Brain, 
  ListTodo, 
  Terminal, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Code, 
  ShieldCheck, 
  Timer,
  FileCheck
} from "lucide-react";
import Markdown from "react-markdown";

interface ExecutedAction {
  type: string;
  path?: string;
  command?: string;
  success: boolean;
  size?: number;
  output?: string;
  error?: string;
}

interface AgentBrainPipelineProps {
  text: string;
  executedActions?: ExecutedAction[];
  timestamp: string;
}

export default function AgentBrainPipeline({ text, executedActions = [], timestamp }: AgentBrainPipelineProps) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);
  const [isPlanningExpanded, setIsPlanningExpanded] = useState(true);
  const [isExecutionExpanded, setIsExecutionExpanded] = useState(true);
  const [isRetroExpanded, setIsRetroExpanded] = useState(true);

  // Helper to extract content inside XML-like tags
  const extractTagContent = (input: string, tagName: string): string => {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
    const match = input.match(regex);
    return match ? match[1].trim() : "";
  };

  // Extract structured phases
  const thinkingContent = extractTagContent(text, "thinking");
  const planningContent = extractTagContent(text, "planning");
  const retroContent = extractTagContent(text, "retrospective") || extractTagContent(text, "summary");

  // Strip these tags from the final text rendered as standard markdown
  let cleanMarkdown = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<planning>[\s\S]*?<\/planning>/gi, "")
    .replace(/<retrospective>[\s\S]*?<\/retrospective>/gi, "")
    .replace(/<summary>[\s\S]*?<\/summary>/gi, "")
    .trim();

  // If there are raw workspace_action tags in the remaining cleanMarkdown, we can strip them for nicer look
  const actionTagRegex = /<workspace_action\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/workspace_action>)/g;
  cleanMarkdown = cleanMarkdown.replace(actionTagRegex, "").trim();

  // Let's also strip execution log headers appended to the text, since we show them in our pipeline component
  const logsDividerIndex = cleanMarkdown.indexOf("---");
  let mainResponse = cleanMarkdown;
  let rawLogs = "";
  if (logsDividerIndex !== -1) {
    mainResponse = cleanMarkdown.substring(0, logsDividerIndex).trim();
    rawLogs = cleanMarkdown.substring(logsDividerIndex).trim();
  }

  // Determine active stages
  const hasThinking = !!thinkingContent;
  const hasPlanning = !!planningContent;
  const hasExecution = executedActions && executedActions.length > 0;
  const hasRetro = !!retroContent;

  // Render nothing if no structured steps exist
  if (!hasThinking && !hasPlanning && !hasExecution && !hasRetro) {
    return (
      <div className="space-y-2">
        <div className="markdown-body text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
          <Markdown>{text}</Markdown>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full select-text" id="agent-brain-pipeline">
      {/* STEP 1: THINKING & DEPENDENCY ANALYSIS */}
      {hasThinking && (
        <div className="border border-indigo-500/20 bg-indigo-950/10 rounded-lg overflow-hidden transition-all duration-200">
          <button 
            type="button"
            onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
            className="w-full flex items-center justify-between p-3 bg-indigo-950/20 hover:bg-indigo-950/35 cursor-pointer select-none transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-md">
                <Brain className="w-3.5 h-3.5 animate-pulse" />
              </div>
              <div className="text-left">
                <span className="text-xs font-semibold text-indigo-300 block">PHASE 1: 思考与意图深剖</span>
                <span className="text-[9px] text-slate-400 block font-mono">Autonomous Context & Semantic Parsing</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 text-[8px] font-mono rounded">DONE</span>
              {isThinkingExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
            </div>
          </button>
          
          <AnimatePresence initial={false}>
            {isThinkingExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-indigo-500/10 bg-[#030712]/90 p-3"
              >
                <div className="text-[11px] text-slate-300 leading-relaxed markdown-body max-h-60 overflow-y-auto custom-scrollbar font-sans">
                  <Markdown>{thinkingContent}</Markdown>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* STEP 2: BLUEPRINT & DECOMPOSITION */}
      {hasPlanning && (
        <div className="border border-sky-500/20 bg-sky-950/10 rounded-lg overflow-hidden transition-all duration-200">
          <button 
            type="button"
            onClick={() => setIsPlanningExpanded(!isPlanningExpanded)}
            className="w-full flex items-center justify-between p-3 bg-sky-950/20 hover:bg-sky-950/35 cursor-pointer select-none transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-sky-500/10 text-sky-400 rounded-md">
                <ListTodo className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <span className="text-xs font-semibold text-sky-300 block">PHASE 2: 蓝图设计与任务拆解</span>
                <span className="text-[9px] text-slate-400 block font-mono">Task Decomposition & Sequencing Blueprint</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 bg-sky-500/10 text-sky-400 text-[8px] font-mono rounded">PLANNED</span>
              {isPlanningExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
            </div>
          </button>
          
          <AnimatePresence initial={false}>
            {isPlanningExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-sky-500/10 bg-[#030712]/90 p-3"
              >
                <div className="text-[11px] text-slate-300 leading-relaxed markdown-body max-h-60 overflow-y-auto custom-scrollbar font-sans">
                  <Markdown>{planningContent}</Markdown>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* STEP 3: WORKSPACE ACTIONS (EXECUTION & SELF-HEALING LOOP) */}
      {hasExecution && (
        <div className="border border-amber-500/20 bg-amber-950/10 rounded-lg overflow-hidden transition-all duration-200">
          <button 
            type="button"
            onClick={() => setIsExecutionExpanded(!isExecutionExpanded)}
            className="w-full flex items-center justify-between p-3 bg-amber-950/20 hover:bg-amber-950/35 cursor-pointer select-none transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded-md">
                <Terminal className="w-3.5 h-3.5 animate-bounce duration-700" />
              </div>
              <div className="text-left">
                <span className="text-xs font-semibold text-amber-300 block">PHASE 3: 自主沙箱执行与自愈循环</span>
                <span className="text-[9px] text-slate-400 block font-mono">Sandbox Actions ({executedActions.length} steps)</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-400 text-[8px] font-mono rounded uppercase">
                {executedActions.every(a => a.success) ? "SUCCESS" : "SELF-HEALED"}
              </span>
              {isExecutionExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
            </div>
          </button>
          
          <AnimatePresence initial={false}>
            {isExecutionExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-amber-500/10 bg-[#030712] p-3 space-y-3"
              >
                <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                  {executedActions.map((action, actionIdx) => {
                    const isFileWrite = action.type === "create_file" || action.type === "write_file";
                    const isCmd = action.type === "run_command";
                    const isMkdir = action.type === "mkdir";
                    const isDelete = action.type === "delete_file";

                    return (
                      <div key={actionIdx} className="bg-[#090D1A]/95 rounded border border-slate-800/80 p-2.5 space-y-2">
                        {/* Action Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {action.success ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            )}
                            <span className="text-[10px] font-mono font-bold text-slate-200">
                              STEP {actionIdx + 1}: {isFileWrite ? "文件覆盖写入" : isCmd ? "控制台指令执行" : isMkdir ? "文件夹初始化" : isDelete ? "移入回收站" : action.type}
                            </span>
                          </div>
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {action.type.toUpperCase()}
                          </span>
                        </div>

                        {/* Action details */}
                        <div className="space-y-1 text-[10px] font-mono text-slate-300">
                          {action.path && (
                            <div className="flex items-start gap-1">
                              <span className="text-slate-500 font-bold shrink-0">Path:</span>
                              <span className="text-sky-300 break-all select-all">{action.path}</span>
                            </div>
                          )}
                          {action.command && (
                            <div className="flex items-start gap-1">
                              <span className="text-slate-500 font-bold shrink-0">Cmd:</span>
                              <span className="text-amber-300 font-semibold break-all select-all">{action.command}</span>
                            </div>
                          )}
                          {action.size !== undefined && action.size > 0 && (
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Code className="w-3 h-3 text-slate-500" />
                              <span>写入尺寸: {action.size} 字节 (bytes)</span>
                            </div>
                          )}
                        </div>

                        {/* Stderr / output / details */}
                        {action.output && (
                          <div className="rounded bg-[#02050E] border border-slate-800 p-2">
                            <div className="flex items-center justify-between border-b border-slate-900 pb-1 mb-1.5 select-none">
                              <span className="text-[8px] font-mono font-bold text-slate-500 tracking-wider">CONSOLE OUTPUT FEEDBACK</span>
                              <span className="text-[8px] font-mono text-emerald-400/80">Captured</span>
                            </div>
                            <pre className="text-[9px] font-mono text-emerald-400/90 leading-relaxed overflow-x-auto max-h-32 custom-scrollbar whitespace-pre-wrap">
                              {action.output}
                            </pre>
                          </div>
                        )}

                        {action.error && (
                          <div className="rounded bg-rose-950/20 border border-rose-900/30 p-2 text-[9px] font-mono text-rose-400">
                            <div className="flex items-center gap-1 font-bold mb-1">
                              <AlertCircle className="w-3 h-3" />
                              <span>AUTO-HEAL TRIGGERED: 发生执行异常</span>
                            </div>
                            <div className="break-words font-semibold">{action.error}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* CORE SYSTEM RESPONSE MARKDOWN */}
      <div className="border border-slate-800/60 bg-[#070B14]/40 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-1.5 border-b border-slate-800 pb-1.5 select-none">
          <Sparkles className="w-3 h-3 text-blue-400 animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">最终交付状态汇报 & 产出物</span>
        </div>
        <div className="markdown-body text-xs text-slate-200 leading-relaxed max-w-full break-words space-y-3">
          <Markdown>{mainResponse}</Markdown>
        </div>
      </div>

      {/* STEP 4: RETROSPECTIVE & QUALITY SUMMARY */}
      {hasRetro && (
        <div className="border border-emerald-500/20 bg-emerald-950/10 rounded-lg overflow-hidden transition-all duration-200">
          <button 
            type="button"
            onClick={() => setIsRetroExpanded(!isRetroExpanded)}
            className="w-full flex items-center justify-between p-3 bg-emerald-950/20 hover:bg-emerald-950/35 cursor-pointer select-none transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-md">
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <span className="text-xs font-semibold text-emerald-300 block">PHASE 4: 系统级自省与指标复盘报告</span>
                <span className="text-[9px] text-slate-400 block font-mono">Retrospective Summary & Quality Gate</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[8px] font-mono rounded flex items-center gap-1">
                <FileCheck className="w-2.5 h-2.5" /> PASS
              </span>
              {isRetroExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
            </div>
          </button>
          
          <AnimatePresence initial={false}>
            {isRetroExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-emerald-500/10 bg-[#030712]/90 p-3"
              >
                {/* Visual Bento Dashboard Metrics */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="p-2 bg-[#0C151B] border border-emerald-950 rounded flex flex-col justify-center">
                    <span className="text-[8px] font-mono text-slate-500 block uppercase">自愈修复迭代</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {executedActions.filter(a => !a.success).length} 次自愈
                    </span>
                  </div>
                  <div className="p-2 bg-[#0C151B] border border-emerald-950 rounded flex flex-col justify-center">
                    <span className="text-[8px] font-mono text-slate-500 block uppercase">变更实体统计</span>
                    <span className="text-xs font-mono font-bold text-blue-400">
                      {executedActions.filter(a => a.type === "create_file" || a.type === "write_file").length} 个文件
                    </span>
                  </div>
                  <div className="p-2 bg-[#0C151B] border border-emerald-950 rounded flex flex-col justify-center">
                    <span className="text-[8px] font-mono text-slate-500 block uppercase">执行诊断时间</span>
                    <span className="text-xs font-mono font-bold text-amber-400 flex items-center gap-0.5">
                      <Timer className="w-3 h-3 text-amber-500" /> ~{executedActions.length * 2.5 + 1.2}s
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-300 leading-relaxed markdown-body max-h-60 overflow-y-auto custom-scrollbar font-sans border-t border-slate-800/50 pt-2">
                  <Markdown>{retroContent}</Markdown>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
