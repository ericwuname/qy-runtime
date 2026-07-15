import React, { useEffect, useRef, useState } from "react";
import { Task, LogEntry } from "../types";
import { calculateExpectedDurations, calculateActualDurations, analyzeExecutionEfficiency } from "../utils";
import { 
  Terminal, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Cpu, 
  Settings, 
  Eye, 
  ChevronRight, 
  ChevronDown,
  ArrowDown,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  BarChart2,
  Clock,
  Sparkles,
  TrendingUp
} from "lucide-react";

interface LiveLogsProps {
  task: Task | null;
  onQuickRetry?: (id: string) => void;
}

interface TreeLogEntry {
  log: LogEntry;
  index: number;
}

interface TreeStepNode {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'idle';
  entries: TreeLogEntry[];
}

interface TreePhaseNode {
  id: 'planning' | 'design' | 'execution' | 'summary';
  title: string;
  icon: React.ReactNode;
  status: 'running' | 'completed' | 'failed' | 'idle';
  steps: TreeStepNode[];
}

// Helper to determine the target logical phase based on log message content
function getPhaseForText(text: string, type?: string): 'planning' | 'design' | 'execution' | 'summary' {
  try {
    if (!text || typeof text !== "string") {
      return 'execution';
    }
    const lowercase = text.toLowerCase();
    
    if (
      lowercase.includes('编译') || 
      lowercase.includes('校验') || 
      lowercase.includes('linter') || 
      lowercase.includes('lint') || 
      lowercase.includes('restart') || 
      lowercase.includes('重启') || 
      lowercase.includes('总结') || 
      lowercase.includes('结果') || 
      lowercase.includes('完成') ||
      lowercase.includes('completed') ||
      lowercase.includes('success')
    ) {
      return 'summary';
    }
    
    if (
      lowercase.includes('执行') || 
      lowercase.includes('修改') || 
      lowercase.includes('写入') || 
      lowercase.includes('创建') || 
      lowercase.includes('修改代码') ||
      lowercase.includes('write') || 
      lowercase.includes('edit') || 
      lowercase.includes('create') || 
      lowercase.includes('run') || 
      lowercase.includes('command') || 
      lowercase.includes('tool_call') ||
      lowercase.includes('apply') ||
      lowercase.includes('post') ||
      lowercase.includes('send')
    ) {
      return 'execution';
    }
    
    if (
      lowercase.includes('设计') || 
      lowercase.includes('方案') || 
      lowercase.includes('视觉') || 
      lowercase.includes('ui') || 
      lowercase.includes('架构') || 
      lowercase.includes('design') || 
      lowercase.includes('layout') || 
      lowercase.includes('mock') ||
      lowercase.includes('schema') ||
      lowercase.includes('组件')
    ) {
      return 'design';
    }
    
    return 'planning';
  } catch (err) {
    console.error("Error in getPhaseForText:", err);
    return 'execution';
  }
}

export default function LiveLogs({ task, onQuickRetry }: LiveLogsProps) {
  const [autoScroll, setAutoScroll] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({});
  const [showGantt, setShowGantt] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  // Dynamic Expected Durations based on prompt content complexity & selected model
  const expectedDurations = React.useMemo(() => {
    if (!task) return { planning: 1.5, design: 2.0, execution: 5.0, summary: 1.5, total: 10.0 };
    return calculateExpectedDurations(task);
  }, [task?.prompt, task?.model]);

  // Group and parse flat logs list into standard hierarchical tree structure
  const parsedTree = React.useMemo(() => {
    if (!task || !task.logs || !Array.isArray(task.logs)) return [];

    // Initialize the 4 standard phases
    const phases: TreePhaseNode[] = [
      {
        id: 'planning',
        title: '1. 任务规划与分析 (Planning & Analysis)',
        icon: <Cpu className="w-4 h-4 text-indigo-400" />,
        status: 'idle',
        steps: []
      },
      {
        id: 'design',
        title: '2. 系统方案设计 (System Design & Layout)',
        icon: <Eye className="w-4 h-4 text-cyan-400" />,
        status: 'idle',
        steps: []
      },
      {
        id: 'execution',
        title: '3. 任务具体执行 (Task Execution & Implementation)',
        icon: <Terminal className="w-4 h-4 text-blue-400" />,
        status: 'idle',
        steps: []
      },
      {
        id: 'summary',
        title: '4. 结果验证与总结 (Validation & Delivery)',
        icon: <CheckCircle className="w-4 h-4 text-emerald-400" />,
        status: 'idle',
        steps: []
      }
    ];

    let currentPhaseId: 'planning' | 'design' | 'execution' | 'summary' = 'planning';
    
    // Helper to get or create the active step in a phase
    const getOrCreateActiveStep = (phaseId: typeof currentPhaseId, defaultTitle: string): TreeStepNode => {
      const phase = phases.find(p => p.id === phaseId)!;
      if (phase.steps.length === 0) {
        phase.steps.push({
          id: `${task.id}-${phaseId}-default`,
          title: defaultTitle,
          status: 'completed',
          entries: []
        });
      }
      return phase.steps[phase.steps.length - 1];
    };

    try {
      task.logs.forEach((log, index) => {
        try {
          if (!log) return;
          const msg = typeof log.message === 'string' ? log.message : (log.message ? String(log.message) : "");
          const isStepHeader = log.type === 'system' && (
            msg.match(/\[步骤\s*(\d+)/) || 
            msg.match(/步骤\s*(\d+)/) ||
            msg.startsWith('Starting step') ||
            msg.includes('Executing step')
          );

          if (isStepHeader) {
            // Classify which phase this step fits into
            const targetPhaseId = getPhaseForText(msg, log.type);
            currentPhaseId = targetPhaseId;

            const phase = phases.find(p => p.id === targetPhaseId);
            if (phase) {
              phase.steps.push({
                id: `${task.id}-step-${index}`,
                title: msg,
                status: 'completed',
                entries: [{ log, index }]
              });
            }
          } else {
            // General entry belongs to the currently active step of the active phase
            let defaultTitle = '初始化与环境配置准备';
            if (currentPhaseId === 'design') defaultTitle = '界面与架构设计准备';
            if (currentPhaseId === 'execution') defaultTitle = '工具调用与执行流';
            if (currentPhaseId === 'summary') defaultTitle = '编译与后置处理验证';

            const activeStep = getOrCreateActiveStep(currentPhaseId, defaultTitle);
            if (activeStep) {
              activeStep.entries.push({ log, index });

              if (log.type === 'error') {
                activeStep.status = 'failed';
              }
            }
          }
        } catch (innerErr) {
          console.error(`Error processing log entry at index ${index}:`, innerErr);
        }
      });
    } catch (outerErr) {
      console.error("Systemic error during log aggregation loop:", outerErr);
    }

    // Update phase statuses
    phases.forEach((phase) => {
      const hasSteps = phase.steps.length > 0;
      if (!hasSteps) {
        phase.status = 'idle';
        return;
      }

      const anyFailed = phase.steps.some(s => s.status === 'failed');
      if (anyFailed) {
        phase.status = 'failed';
        return;
      }

      phase.status = 'completed';
    });

    // Set running/failure dynamically on active nodes
    if (task.executionStatus === 'running') {
      const activePhases = phases.filter(p => p.steps.length > 0);
      if (activePhases.length > 0) {
        const lastActivePhase = activePhases[activePhases.length - 1];
        lastActivePhase.status = 'running';
        
        if (lastActivePhase.steps.length > 0) {
          lastActivePhase.steps[lastActivePhase.steps.length - 1].status = 'running';
        }
      }
    } else if (task.executionStatus === 'failed') {
      const failedPhase = phases.find(p => p.steps.some(s => s.status === 'failed'));
      if (failedPhase) {
        failedPhase.status = 'failed';
      } else {
        const activePhases = phases.filter(p => p.steps.length > 0);
        if (activePhases.length > 0) {
          const lastActivePhase = activePhases[activePhases.length - 1];
          lastActivePhase.status = 'failed';
          if (lastActivePhase.steps.length > 0) {
            lastActivePhase.steps[lastActivePhase.steps.length - 1].status = 'failed';
          }
        }
      }
    }

    return phases;
  }, [task?.logs, task?.executionStatus]);

  // Compute actual phase offsets and durations from audit log timestamps using the analytical utility
  const actualDurationsData = React.useMemo(() => {
    return calculateActualDurations(task || {} as Task);
  }, [task, task?.logs, task?.executionStatus]);

  const phaseDurations = React.useMemo(() => {
    return actualDurationsData.phases;
  }, [actualDurationsData]);

  // Absolute total wall-clock duration in seconds
  const totalActualDuration = React.useMemo(() => {
    return actualDurationsData.total;
  }, [actualDurationsData]);

  // Dynamic analysis and comments on expected vs actual durations using the analysis tool function
  const efficiencyEvaluation = React.useMemo(() => {
    return analyzeExecutionEfficiency(task || {} as Task);
  }, [task, totalActualDuration]);

  // Scroll to bottom when logging updates
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTo({
        top: logsContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [task?.logs, autoScroll]);

  // Intelligently auto-expand active/running and failed items as they appear
  useEffect(() => {
    if (!task || parsedTree.length === 0) return;

    setExpandedPhases(prev => {
      const next = { ...prev };
      parsedTree.forEach((phase) => {
        const isRunning = phase.status === 'running';
        const isFailed = phase.status === 'failed';
        const isLastPhaseWithSteps = phase.steps.length > 0 && 
          parsedTree.filter(p => p.steps.length > 0).pop()?.id === phase.id;

        if (next[phase.id] === undefined) {
          next[phase.id] = isRunning || isFailed || isLastPhaseWithSteps || phase.id === 'planning';
        } else if (isRunning || isFailed) {
          next[phase.id] = true;
        }
      });
      return next;
    });

    setExpandedSteps(prev => {
      const next = { ...prev };
      parsedTree.forEach((phase) => {
        phase.steps.forEach((step, idx) => {
          const isRunning = step.status === 'running';
          const isFailed = step.status === 'failed';
          const isLastStep = idx === phase.steps.length - 1;

          if (next[step.id] === undefined) {
            next[step.id] = isRunning || isFailed || isLastStep;
          } else if (isRunning || isFailed) {
            next[step.id] = true;
          }
        });
      });
      return next;
    });
  }, [task?.id, parsedTree, task?.executionStatus]);

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-950 border border-slate-900 rounded-xl p-8" id="no-task-logs">
        <Terminal className="w-10 h-10 text-slate-700 mb-2 animate-pulse" />
        <p className="text-sm">从左侧队列选择一个任务以查看其审计日志、规划步骤和执行结果</p>
      </div>
    );
  }

  const toggleExpand = (index: number) => {
    setExpandedLogs(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => ({
      ...prev,
      [phaseId]: !prev[phaseId]
    }));
  };

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => ({
      ...prev,
      [stepId]: !prev[stepId]
    }));
  };

  const expandAll = () => {
    const nextPhases: Record<string, boolean> = {};
    const nextSteps: Record<string, boolean> = {};
    parsedTree.forEach(phase => {
      nextPhases[phase.id] = true;
      phase.steps.forEach(step => {
        nextSteps[step.id] = true;
      });
    });
    setExpandedPhases(nextPhases);
    setExpandedSteps(nextSteps);
  };

  const collapseAll = () => {
    const nextPhases: Record<string, boolean> = {};
    const nextSteps: Record<string, boolean> = {};
    parsedTree.forEach(phase => {
      nextPhases[phase.id] = false;
      phase.steps.forEach(step => {
        nextSteps[step.id] = false;
      });
    });
    setExpandedPhases(nextPhases);
    setExpandedSteps(nextSteps);
  };

  const getLogStyles = (type: LogEntry["type"]) => {
    switch (type) {
      case "system":
        return {
          icon: <Settings className="w-3.5 h-3.5 text-blue-400" />,
          bg: "bg-blue-950/20 border-blue-900/30",
          text: "text-blue-200"
        };
      case "model_thought":
        return {
          icon: <Cpu className="w-3.5 h-3.5 text-indigo-400" />,
          bg: "bg-indigo-950/20 border-indigo-900/30",
          text: "text-slate-200"
        };
      case "tool_call":
        return {
          icon: <Terminal className="w-3.5 h-3.5 text-cyan-400" />,
          bg: "bg-cyan-950/20 border-cyan-900/30",
          text: "text-cyan-200"
        };
      case "tool_response":
        return {
          icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
          bg: "bg-emerald-950/20 border-emerald-900/30",
          text: "text-emerald-200"
        };
      case "error":
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />,
          bg: "bg-rose-950/25 border-rose-900/40",
          text: "text-rose-200"
        };
    }
  };

  const getGroupStatusBadge = (status: 'running' | 'completed' | 'failed' | 'idle') => {
    switch (status) {
      case "running":
        return (
          <span className="flex items-center gap-1 text-[8px] tracking-wider uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 animate-pulse">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            执行中
          </span>
        );
      case "failed":
        return (
          <span className="text-[8px] tracking-wider uppercase font-bold px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400">
            异常中断
          </span>
        );
      case "completed":
        return (
          <span className="text-[8px] tracking-wider uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            已完成
          </span>
        );
      default:
        return (
          <span className="text-[8px] tracking-wider uppercase font-bold px-1.5 py-0.5 rounded bg-slate-850 border border-slate-800 text-slate-500">
            未启动
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#020617] border border-[#1F2937] rounded overflow-hidden shadow-2xl relative" id="live-logs-panel">
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-blue-500 to-transparent opacity-40"></div>
      
      {/* Log Header */}
      <div className="p-3 bg-[#111827] border-b border-[#1F2937] flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            <h2 className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400">Agent Execution Chain (审计日志)</h2>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            ID: {task.id?.slice(0, 8) || "N/A"} | MODEL: {task.model || task.parameters?.model || "N/A"} | TEMP: {task.temperature ?? task.parameters?.temperature ?? "N/A"}
          </p>
        </div>
        
        <div className="flex items-center gap-2 font-mono">
          <button
            onClick={() => setShowGantt(!showGantt)}
            title="查看项目时间预估与甘特图效率评估分析"
            className={`p-1 px-2 rounded text-[9px] font-bold uppercase border transition-colors flex items-center gap-1 cursor-pointer ${
              showGantt 
                ? "bg-blue-500/20 text-blue-400 border-blue-500/40" 
                : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200"
            }`}
          >
            <BarChart2 className="w-2.5 h-2.5 animate-pulse" />
            <span>甘特图与效率 / Gantt Chart</span>
          </button>
          <span className="w-[1px] h-3.5 bg-slate-800"></span>
          <button
            onClick={expandAll}
            title="展开所有步骤"
            className="p-1 px-1.5 rounded text-[9px] font-bold uppercase bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-600 transition-colors flex items-center gap-1"
          >
            <Maximize2 className="w-2.5 h-2.5" />
            展开
          </button>
          <button
            onClick={collapseAll}
            title="折叠所有步骤"
            className="p-1 px-1.5 rounded text-[9px] font-bold uppercase bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-600 transition-colors flex items-center gap-1"
          >
            <Minimize2 className="w-2.5 h-2.5" />
            折叠
          </button>
          <span className="w-[1px] h-3.5 bg-slate-800"></span>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1 px-2 rounded text-[9px] font-bold uppercase border transition-colors ${
              autoScroll 
                ? "bg-blue-600/15 text-blue-400 border-blue-500/30" 
                : "bg-slate-800 text-slate-400 border-transparent"
            }`}
          >
            AUTO: {autoScroll ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Task Prompt Overview */}
      <div className="p-3 bg-[#0A0B0E]/60 border-b border-[#1F2937]">
        <div className="bg-[#111827] p-2.5 rounded border border-[#1F2937]">
          <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-slate-500 block mb-1">TASK OBJECTIVE & DIRECTIVE</span>
          <div className="max-h-36 overflow-y-auto custom-scrollbar pr-1">
            <p className="text-slate-300 text-xs font-mono leading-relaxed whitespace-pre-wrap">{task.prompt}</p>
          </div>
        </div>
      </div>

      {/* Gantt Chart & Efficiency Analysis Panel */}
      {showGantt && (
        <div className="p-3 bg-[#0A0B0E]/85 border-b border-[#1F2937] animate-in fade-in slide-in-from-top-2 duration-300 space-y-3.5" id="gantt-chart-section">
          {/* Header & Overall Metric */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 bg-[#111827] p-3 rounded border border-[#1F2937]/80">
            {/* Efficiency Score Ring/Gauge */}
            <div className="md:col-span-4 flex flex-col items-center justify-center p-2 bg-[#020617]/40 rounded border border-[#1F2937]/30 text-center">
              <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-slate-500 mb-1">EFFICIENCY INDEX (效率指数)</span>
              {efficiencyEvaluation.score !== null ? (
                <div className="relative flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full border-4 border-slate-800 flex flex-col items-center justify-center">
                    <span className="text-xl font-black font-mono text-blue-400">{efficiencyEvaluation.score}</span>
                    <span className="text-[7px] text-slate-500 font-bold -mt-1">SCORE</span>
                  </div>
                </div>
              ) : (
                <Clock className="w-10 h-10 text-slate-700 animate-pulse my-2" />
              )}
              <div className="mt-2 space-y-0.5">
                <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border ${efficiencyEvaluation.color}`}>
                  {efficiencyEvaluation.label}
                </span>
              </div>
            </div>

            {/* Efficiency Diagnostic comment & metrics */}
            <div className="md:col-span-8 flex flex-col justify-between space-y-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[9px] uppercase font-mono font-bold tracking-wider text-slate-500">
                  <Sparkles className="w-3 h-3 text-yellow-400 animate-bounce" />
                  <span>AI 执行链效率诊断分析</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed font-sans font-medium">
                  {efficiencyEvaluation.comment}
                </p>
              </div>

              {/* High-level metrics list */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1F2937]/60 text-[10px] font-mono text-slate-400">
                <div className="bg-[#020617]/30 p-1.5 rounded border border-[#1F2937]/20">
                  <span className="text-slate-500 block text-[8px] uppercase font-bold">系统预估总耗时</span>
                  <span className="text-blue-400 font-bold">{expectedDurations.total}s</span>
                </div>
                <div className="bg-[#020617]/30 p-1.5 rounded border border-[#1F2937]/20">
                  <span className="text-slate-500 block text-[8px] uppercase font-bold">实际整体耗时</span>
                  <span className="text-emerald-400 font-bold">{totalActualDuration}s</span>
                </div>
                <div className="bg-[#020617]/30 p-1.5 rounded border border-[#1F2937]/20">
                  <span className="text-slate-500 block text-[8px] uppercase font-bold">资源拟合效率比</span>
                  <span className="text-yellow-400 font-bold">
                    {totalActualDuration > 0 ? (expectedDurations.total / totalActualDuration).toFixed(2) : "0.00"}x
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Gantt Bar Chart Rendering */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[9px] uppercase font-mono font-bold tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                GANTT TIMELINE & TIME DRIFT (甘特图耗时对比分布)
              </span>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/50"></span> 预估 / Est</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80"></span> 实际 / Act</span>
              </div>
            </div>

            <div className="space-y-3 bg-[#111827] p-3 rounded border border-[#1F2937]/80">
              {parsedTree.map((phase) => {
                const est = expectedDurations[phase.id as keyof typeof expectedDurations] || 1.5;
                const act = phaseDurations[phase.id]?.duration || 0;
                const isRunning = phaseDurations[phase.id]?.isRunning;
                
                // Calculate dynamic scaling for Gantt layout
                const maxTime = Math.max(expectedDurations.total, totalActualDuration, 1);
                
                // Percentages for expected bar
                let seqEstOffset = 0;
                if (phase.id === 'design') seqEstOffset = expectedDurations.planning;
                else if (phase.id === 'execution') seqEstOffset = expectedDurations.planning + expectedDurations.design;
                else if (phase.id === 'summary') seqEstOffset = expectedDurations.planning + expectedDurations.design + expectedDurations.execution;
                
                const estWidthPct = Math.min(100, (est / maxTime) * 100);
                const estLeftPct = Math.min(95, (seqEstOffset / maxTime) * 100);
                
                // Percentages for actual bar
                const actInfo = phaseDurations[phase.id] || { startOffset: 0, duration: 0 };
                const actWidthPct = Math.min(100, (act / maxTime) * 100);
                const actLeftPct = Math.min(95, (actInfo.startOffset / maxTime) * 100);

                // Dynamically color actual bar based on efficiency
                let actColorClass = "bg-emerald-500/20 border-emerald-500/30 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.1)]";
                if (isRunning) {
                  actColorClass = "bg-blue-500/20 border-blue-500/30 text-blue-400 animate-pulse";
                } else if (phase.status === 'failed') {
                  actColorClass = "bg-rose-500/20 border-rose-500/30 text-rose-400";
                } else if (act > est * 1.3) {
                  actColorClass = "bg-rose-500/20 border-rose-500/30 text-rose-400";
                } else if (act > est) {
                  actColorClass = "bg-amber-500/20 border-amber-500/30 text-amber-400";
                }

                return (
                  <div key={phase.id} className="grid grid-cols-12 gap-2 items-center text-[10px] font-mono">
                    {/* Phase Name column */}
                    <div className="col-span-3 font-semibold text-slate-400 truncate flex items-center gap-1.5" title={phase.title}>
                      <span className="shrink-0">{phase.icon}</span>
                      <span className="truncate">{phase.id === 'planning' ? '1.规划 (Plan)' : phase.id === 'design' ? '2.设计 (Des)' : phase.id === 'execution' ? '3.执行 (Exec)' : '4.验证 (Sum)'}</span>
                    </div>

                    {/* Timeline bar columns */}
                    <div className="col-span-6 relative h-10 bg-slate-950/40 rounded border border-[#1F2937]/30 overflow-hidden flex flex-col justify-center space-y-1 px-1">
                      {/* Grid background markers */}
                      <div className="absolute inset-y-0 left-1/4 w-[1px] bg-[#1F2937]/15 pointer-events-none"></div>
                      <div className="absolute inset-y-0 left-2/4 w-[1px] bg-[#1F2937]/15 pointer-events-none"></div>
                      <div className="absolute inset-y-0 left-3/4 w-[1px] bg-[#1F2937]/15 pointer-events-none"></div>

                      {/* Estimated Bar */}
                      <div className="relative w-full h-3">
                        {est > 0 && (
                          <div 
                            style={{ width: `${estWidthPct}%`, left: `${estLeftPct}%` }}
                            className="absolute top-0 h-2.5 bg-blue-950/35 border border-blue-800/20 text-blue-500 rounded-sm text-[8px] flex items-center px-1 font-bold truncate transition-all duration-300"
                          >
                            {est}s
                          </div>
                        )}
                      </div>

                      {/* Actual Bar */}
                      <div className="relative w-full h-3">
                        {act > 0 ? (
                          <div 
                            style={{ width: `${actWidthPct}%`, left: `${actLeftPct}%` }}
                            className={`absolute top-0 h-2.5 border rounded-sm text-[8px] flex items-center px-1 font-bold truncate transition-all duration-300 ${actColorClass}`}
                          >
                            {act.toFixed(1)}s {isRunning && "⏳"}
                          </div>
                        ) : (
                          <span className="absolute top-0 left-0 text-[8px] text-slate-600 italic px-1">未启动</span>
                        )}
                      </div>
                    </div>

                    {/* Comparisons Text Column */}
                    <div className="col-span-3 text-right text-[9px] text-slate-500 space-y-0.5 whitespace-nowrap">
                      <div>预估: <span className="text-blue-400 font-bold">{est}s</span></div>
                      <div>实际: <span className={act > 0 ? (act > est ? "text-amber-400 font-bold" : "text-emerald-400 font-bold") : "text-slate-600"}>{act > 0 ? `${act.toFixed(1)}s` : "0.0s"}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tree Structured Logs Container */}
      <div ref={logsContainerRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 font-mono text-[11px] leading-relaxed">
        {parsedTree.map((phase) => {
          const isPhaseExpanded = !!expandedPhases[phase.id];
          const hasSteps = phase.steps.length > 0;
          
          return (
            <div key={phase.id} className="border border-[#1F2937] bg-[#0B0F19] rounded overflow-hidden">
              {/* Phase Row (Top Level Folder) */}
              <div 
                onClick={() => hasSteps && togglePhase(phase.id)}
                className={`sticky top-0 z-10 flex items-center justify-between p-3 select-none transition-colors ${
                  hasSteps ? "cursor-pointer hover:bg-[#1E293B]/30" : "opacity-40"
                } ${
                  isPhaseExpanded ? "bg-[#111827] border-b border-[#1F2937]" : "bg-[#0B0F19]"
                }`}
              >
                <div className="flex items-center gap-2.5 max-w-[80%]">
                  <div className="text-slate-500 shrink-0">
                    {hasSteps ? (
                      isPhaseExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                    ) : (
                      <span className="w-4 h-4 block" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 truncate">
                    {phase.icon}
                    <span className={`font-bold text-xs tracking-wider uppercase font-mono ${
                      phase.status === 'running' 
                        ? 'text-blue-400 font-extrabold' 
                        : phase.status === 'failed' 
                        ? 'text-rose-400' 
                        : 'text-slate-300'
                    }`}>
                      {phase.title}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 font-mono">
                  <span className="text-[9px] text-slate-500 font-semibold bg-[#111827] px-1.5 py-0.5 rounded border border-[#1F2937]">
                    {phase.steps.length} 个子单元
                  </span>
                  {getGroupStatusBadge(phase.status)}
                </div>
              </div>

              {/* Sub-steps List (Second Level Tree Node) */}
              {isPhaseExpanded && hasSteps && (
                <div className="p-2 bg-[#060A13] space-y-2 border-t border-[#1F2937]/50">
                  {phase.steps.map((step) => {
                    const isStepExpanded = !!expandedSteps[step.id];
                    const hasEntries = step.entries.length > 0;

                    return (
                      <div key={step.id} className="border border-[#1F2937]/50 bg-black/20 rounded overflow-hidden">
                        {/* Step Header */}
                        <div
                          onClick={() => hasEntries && toggleStep(step.id)}
                          className={`flex items-center justify-between p-2 cursor-pointer select-none transition-colors ${
                            isStepExpanded 
                              ? "bg-[#111827]/60 border-b border-[#1F2937]/40" 
                              : "hover:bg-[#111827]/30"
                          }`}
                        >
                          <div className="flex items-center gap-2 max-w-[80%]">
                            <div className="text-slate-500 shrink-0">
                              {isStepExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </div>
                            <div className="flex items-center gap-1.5 truncate">
                              {step.status === 'running' ? (
                                <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                              ) : step.status === 'failed' ? (
                                <AlertTriangle className="w-3 h-3 text-rose-500" />
                              ) : (
                                <CheckCircle className="w-3 h-3 text-emerald-500" />
                              )}
                              <span className="text-[11px] font-bold text-slate-400 truncate">
                                {step.title}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] text-slate-600 bg-black/40 px-1 py-0.5 rounded border border-[#1F2937]/20">
                              {step.entries.length} 审计项
                            </span>
                          </div>
                        </div>

                        {/* Detailed Logs & Thinking (Detail level - leaf nodes) */}
                        {isStepExpanded && hasEntries && (
                          <div className="p-2.5 bg-black/30 space-y-2 pl-4 border-l-2 border-l-[#1F2937]/60">
                            {step.entries.map(({ log, index: originalIndex }) => {
                              if (!log) return null;
                              const style = getLogStyles(log.type);
                              const isExpanded = !!expandedLogs[originalIndex];
                              const hasDetails = log.details && Object.keys(log.details).length > 0;
                              const logMessage = typeof log.message === 'string' ? log.message : (log.message ? String(log.message) : "");

                              if (log.type === "model_thought") {
                                const isThoughtExpanded = !!expandedLogs[originalIndex];
                                const isLong = logMessage.length > 300;
                                const displayThought = (isLong && !isThoughtExpanded) 
                                  ? logMessage.slice(0, 300) + "..." 
                                  : logMessage;

                                return (
                                  <div key={originalIndex} className="p-2 bg-[#111827]/30 border border-[#1F2937]/30 rounded relative group transition-all hover:bg-[#111827]/50">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex gap-2 w-full">
                                        <div className="mt-0.5 shrink-0">
                                          <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                                        </div>
                                        <div className="space-y-1 w-full">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-slate-500">
                                              {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "N/A"}
                                            </span>
                                            <span className="text-[8px] uppercase font-mono px-1 rounded bg-indigo-950/50 border border-indigo-900/30 font-bold text-indigo-400">
                                              THOUGHT
                                            </span>
                                          </div>
                                          <p className="text-slate-300 leading-relaxed whitespace-pre-wrap text-[11px] font-sans">
                                            {displayThought}
                                          </p>
                                          {isLong && (
                                            <button
                                              onClick={() => {
                                                setExpandedLogs(prev => ({ ...prev, [originalIndex]: !isThoughtExpanded }));
                                              }}
                                              className="mt-1.5 text-[9px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                            >
                                              {isThoughtExpanded ? "收起思考过程 ↑" : `查看完整思考过程 (${logMessage.length} 字) ↓`}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div key={originalIndex} className={`p-2 rounded border ${style.bg} transition-all`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex gap-2">
                                      <div className="mt-0.5 shrink-0">{style.icon}</div>
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[9px] text-slate-500">
                                            {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "N/A"}
                                          </span>
                                          <span className={`text-[8px] uppercase px-1 rounded bg-[#0A0B0E] border border-[#1F2937] font-bold ${
                                            log.type === 'error' ? 'text-rose-400' : 'text-slate-400'
                                          }`}>
                                            {log.type || "system"}
                                          </span>
                                        </div>
                                        <p className={`${style.text} leading-normal text-[11px]`}>{logMessage}</p>
                                      </div>
                                    </div>

                                    {hasDetails && (
                                      <button
                                        onClick={() => toggleExpand(originalIndex)}
                                        className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                                      >
                                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                      </button>
                                    )}
                                  </div>

                                  {/* JSON Details foldout */}
                                  {hasDetails && isExpanded && (
                                    <div className="mt-2 p-2 rounded bg-black/40 border border-[#1F2937] overflow-x-auto text-[10px] text-slate-400 leading-normal">
                                      <pre className="whitespace-pre-wrap font-mono">
                                        {JSON.stringify(log.details, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Final standardized task output */}
        {(task.executionStatus === "completed" || task.status === "completed") && (
          <div className="p-3.5 rounded bg-emerald-950/10 border border-emerald-500/20 space-y-3 mt-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold text-xs">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>[SYSTEM] TASK COMPLETED SUCCESSFULLY - SUMMARY OUTPUT</span>
            </div>
            
            {/* Summary Text */}
            <div className="bg-[#0A0B0E]/80 p-2.5 rounded border border-emerald-950/40 text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">
              {task.results?.summary || task.result || "任务已顺利完成，没有返回额外文字说明。"}
            </div>

            {/* Resources and Outputs Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-emerald-950/50">
              {/* Resources */}
              <div className="space-y-1 text-[10px] text-slate-400 font-mono">
                <span className="font-bold text-slate-500 uppercase tracking-wider block">RESOURCE CONSUMPTION (运行耗能指标)</span>
                <div className="grid grid-cols-2 gap-y-1 gap-x-2">
                  <div>执行耗时: <span className="text-blue-400 font-bold">{task.resourceConsumption?.durationMs ? (task.resourceConsumption.durationMs / 1000).toFixed(2) : "0.00"}s</span></div>
                  <div>消耗 Token: <span className="text-blue-400 font-bold">{task.resourceConsumption?.tokensUsed || 0} tkn</span></div>
                  <div>系统负载: <span className="text-blue-400 font-bold">{task.resourceConsumption?.cpuLoadAvg || 0}% CPU</span></div>
                  <div>物理内存: <span className="text-blue-400 font-bold">{task.resourceConsumption?.memoryUsedBytes ? (task.resourceConsumption.memoryUsedBytes / 1024 / 1024).toFixed(2) : "0.00"} MB</span></div>
                </div>
              </div>

              {/* Output Files */}
              <div className="space-y-1 text-[10px] text-slate-400 font-mono">
                <span className="font-bold text-slate-500 uppercase tracking-wider block">GENERATED OUTPUTS (沙箱产出文件)</span>
                {task.results?.outputFiles && task.results.outputFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-1 max-h-[60px] overflow-y-auto">
                    {task.results.outputFiles.map((file, idx) => (
                      <span 
                        key={idx} 
                        className="px-1.5 py-0.5 bg-emerald-950/30 text-emerald-400 border border-emerald-900/50 rounded text-[9px] font-semibold truncate max-w-[180px]"
                        title={file}
                      >
                        {file}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-600 block italic">未在沙箱工作区生成或修改额外文件。</span>
                )}
              </div>
            </div>
          </div>
        )}

        {(task.executionStatus === "failed" || task.status === "failed") && (
          <div className="p-3.5 rounded bg-rose-950/10 border border-rose-500/20 space-y-2 mt-3 animate-in fade-in duration-300">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 text-rose-400 font-mono font-bold text-xs">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>[SYSTEM] EXECUTION HALTED DUE TO ANOMALIES</span>
              </div>
              {onQuickRetry && (
                <button
                  onClick={() => onQuickRetry(task.id)}
                  className="px-2.5 py-1 text-[10px] font-bold uppercase bg-rose-600 hover:bg-rose-500 text-white rounded shadow-lg shadow-rose-500/20 flex items-center gap-1.5 transition-all cursor-pointer font-mono shrink-0"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  快速重试 / Quick Retry
                </button>
              )}
            </div>
            
            {/* Error Message */}
            <div className="bg-rose-950/20 p-2.5 rounded border border-rose-950/40 text-rose-300 text-xs font-mono">
              {task.results?.error || "任务在执行流中遭遇未捕获错误或触发指令越界熔断。"}
            </div>

            {/* Partial Resources */}
            {task.resourceConsumption && (
              <div className="pt-1 text-[10px] text-slate-500 font-mono flex gap-4">
                <span>耗时: <b className="text-slate-400">{((task.resourceConsumption.durationMs || 0) / 1000).toFixed(2)}s</b></span>
                <span>负载: <b className="text-slate-400">{task.resourceConsumption.cpuLoadAvg || 0}% CPU</b></span>
                <span>Token: <b className="text-slate-400">{task.resourceConsumption.tokensUsed || 0}</b></span>
              </div>
            )}
            
            <p className="text-[10px] text-slate-500 font-mono leading-relaxed mt-1">
              可检查 API Key 配额设置或网络中转，重置任务状态并重新载入就绪队列。
            </p>
          </div>
        )}

        <div ref={consoleBottomRef} />
      </div>
    </div>
  );
}
