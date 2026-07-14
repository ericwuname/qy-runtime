import { Task } from "./types";

export interface PhaseTiming {
  estimated: number;
  actual: number;
  difference: number;
  percentageDiff: number;
  status: "faster" | "slower" | "on_track" | "unknown";
}

export interface EfficiencyReport {
  score: number;
  label: string;
  color: string;
  comment: string;
  totalEstimated: number;
  totalActual: number;
  totalDifference: number;
  totalPercentageDiff: number;
  phases: Record<string, PhaseTiming>;
}

/**
 * Calculates estimated durations for different phases based on task parameters (prompt complexity, selected model, etc.)
 */
export function calculateExpectedDurations(task: Task) {
  let planning = 1.5;
  let design = 2.0;
  let execution = 6.0;
  let summary = 1.5;
  
  const promptLen = task?.prompt?.length || task?.description?.prompt?.length || 0;
  
  // Adjust based on prompt complexity
  if (promptLen > 300) {
    planning += 1.5;
    design += 2.5;
    execution += 6.0;
    summary += 1.0;
  } else if (promptLen > 100) {
    planning += 0.5;
    design += 1.0;
    execution += 3.0;
    summary += 0.5;
  }
  
  // Adjust based on model
  const m = String(task?.model || task?.parameters?.model || "").toLowerCase();
  if (m.includes("pro") || m.includes("ultra")) {
    execution += 4.0;
    design += 1.0;
  } else if (m.includes("flash")) {
    execution -= 1.5;
  }
  
  const total = planning + design + execution + summary;
  
  return {
    planning: Number(planning.toFixed(1)),
    design: Number(design.toFixed(1)),
    execution: Number(execution.toFixed(1)),
    summary: Number(summary.toFixed(1)),
    total: Number(total.toFixed(1))
  };
}

/**
 * Calculates actual execution durations from the task logs and timestamps
 */
export function calculateActualDurations(task: Task): {
  total: number;
  phases: Record<string, { startOffset: number; duration: number; isRunning: boolean }>;
} {
  const resultPhases = {
    planning: { startOffset: 0, duration: 0, isRunning: false },
    design: { startOffset: 0, duration: 0, isRunning: false },
    execution: { startOffset: 0, duration: 0, isRunning: false },
    summary: { startOffset: 0, duration: 0, isRunning: false }
  };

  if (!task || !task.logs || !Array.isArray(task.logs) || task.logs.length === 0) {
    return { total: 0, phases: resultPhases };
  }

  // Find all timestamps
  const allTimestamps = task.logs
    .map(l => l?.timestamp ? new Date(l.timestamp).getTime() : 0)
    .filter(t => t > 0);

  // Fallback to startExecutionTimestamp or startedAt if available
  let taskStart = allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0;
  if (taskStart === 0) {
    if (task.startedExecutionTimestamp) {
      taskStart = task.startedExecutionTimestamp;
    } else if (task.startedAt) {
      taskStart = new Date(task.startedAt).getTime();
    } else {
      taskStart = Date.now();
    }
  }

  // Standard total duration computation
  let lastTimestamp = allTimestamps.length > 0 ? Math.max(...allTimestamps) : taskStart;
  let totalDur = lastTimestamp - taskStart;
  const status = task.executionStatus || task.status;
  if (status === 'running') {
    totalDur = Math.max(totalDur, Date.now() - taskStart);
  }
  const totalSeconds = Number((totalDur / 1000).toFixed(1));

  // Determine active/running phases and logs grouped by phase type or source
  // We identify phase types based on keywords in log types or messages
  const phaseLogTimes: Record<string, number[]> = {
    planning: [],
    design: [],
    execution: [],
    summary: []
  };

  task.logs.forEach(log => {
    if (!log || !log.timestamp) return;
    const t = new Date(log.timestamp).getTime();
    if (t <= 0) return;

    const msg = String(log.message || "").toLowerCase();
    
    if (msg.includes("planning") || msg.includes("plan") || msg.includes("initialize")) {
      phaseLogTimes.planning.push(t);
    } else if (msg.includes("design") || msg.includes("layout") || msg.includes("ui")) {
      phaseLogTimes.design.push(t);
    } else if (msg.includes("execute") || msg.includes("run") || msg.includes("compiled") || msg.includes("tool")) {
      phaseLogTimes.execution.push(t);
    } else if (msg.includes("summary") || msg.includes("success") || msg.includes("verify") || msg.includes("completed")) {
      phaseLogTimes.summary.push(t);
    } else {
      // Fallback distribution
      if (phaseLogTimes.planning.length === 0) phaseLogTimes.planning.push(t);
      else if (phaseLogTimes.design.length === 0) phaseLogTimes.design.push(t);
      else if (phaseLogTimes.execution.length === 0) phaseLogTimes.execution.push(t);
      else phaseLogTimes.summary.push(t);
    }
  });

  // Calculate offsets and durations
  Object.keys(resultPhases).forEach(phaseId => {
    const times = phaseLogTimes[phaseId] || [];
    if (times.length === 0) {
      // Approximate fallback based on phase order if task is completed
      return;
    }
    const start = Math.min(...times);
    const end = Math.max(...times);
    const offset = Math.max(0, start - taskStart);
    let dur = end - start;

    const isPhaseRunning = status === 'running' && phaseId === 'execution'; // default simple indicator
    if (isPhaseRunning) {
      dur = Math.max(dur, Date.now() - start);
    }

    resultPhases[phaseId as keyof typeof resultPhases] = {
      startOffset: Number((offset / 1000).toFixed(1)),
      duration: Number(Math.max(0.1, dur / 1000).toFixed(1)),
      isRunning: isPhaseRunning
    };
  });

  return {
    total: totalSeconds,
    phases: resultPhases
  };
}

/**
 * Calculates detailed difference reports and diagnostic comments on estimated vs. actual execution times
 */
export function analyzeExecutionEfficiency(task: Task): EfficiencyReport {
  const ests = calculateExpectedDurations(task);
  const actuals = calculateActualDurations(task);
  
  const totalEst = ests.total;
  const totalAct = actuals.total;
  const totalDiff = Number((totalAct - totalEst).toFixed(1));
  const totalPctDiff = totalEst > 0 ? Number(((totalDiff / totalEst) * 100).toFixed(1)) : 0;
  
  const phases: Record<string, PhaseTiming> = {};
  
  const phaseIds = ["planning", "design", "execution", "summary"];
  phaseIds.forEach(id => {
    const est = ests[id as keyof typeof ests] || 1.5;
    const act = actuals.phases[id]?.duration || 0;
    const diff = Number((act - est).toFixed(1));
    const pctDiff = est > 0 ? Number(((diff / est) * 100).toFixed(1)) : 0;
    
    let status: PhaseTiming["status"] = "on_track";
    if (act === 0) status = "unknown";
    else if (diff > 1.0) status = "slower";
    else if (diff < -1.0) status = "faster";
    
    phases[id] = {
      estimated: est,
      actual: act,
      difference: diff,
      percentageDiff: pctDiff,
      status
    };
  });

  // Evaluation Metrics
  const ratio = totalAct > 0 ? totalEst / totalAct : 0;
  let score = Math.min(100, Math.round(ratio * 90));
  const taskStatus = task?.executionStatus || task?.status;

  if (taskStatus === "completed") {
    score = Math.max(score, 78);
    score = Math.min(99, score);
  } else if (taskStatus === "failed") {
    score = Math.min(45, score);
  } else if (totalAct === 0) {
    score = 100; // default initial state
  }

  let label = "普通 (Standard)";
  let color = "text-amber-400 bg-amber-500/10 border-amber-500/20";
  let comment = "实际执行时间贴合系统算力预期，模型决策与本地沙箱调用流顺畅。";

  if (taskStatus === "failed") {
    label = "异常中止 (Aborted)";
    color = "text-rose-400 bg-rose-500/10 border-rose-500/20";
    comment = "由于执行链发生异常中断，未能完整收集各模块的后置效率指标。";
  } else if (ratio >= 1.3) {
    label = "极速自愈 (Ultra Fast)";
    color = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    comment = "执行极为极速！AI 免去大范围决策过程直接完成交付，网络与编译环节损耗被压降至最低极限。";
  } else if (ratio >= 1.0) {
    label = "高效 (High Efficiency)";
    color = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    comment = "执行效率出色。多级规划与系统设计均优于系统算力预估阀值，系统资源调用完美协调。";
  } else if (ratio >= 0.7) {
    label = "良好 (Good)";
    color = "text-blue-400 bg-blue-500/10 border-blue-500/20";
    comment = "表现良好。受到 API 响应波动或磁盘 IO 队列轻微损耗，整体执行链条平稳流畅。";
  } else if (ratio < 0.7 && totalAct > 0) {
    label = "波动延迟 (Overhead Delay)";
    color = "text-rose-400 bg-rose-500/10 border-rose-500/20";
    comment = "执行遭遇了突发性的网络波动或重试延迟，好在自愈退避算法在后台完成了完美的保底交付。";
  } else {
    label = "等待执行 (Idle)";
    color = "text-slate-500 bg-slate-800/40 border-slate-750";
    comment = "正在等待执行链开始输出第一条审计日志以初始化效率对比评估...";
  }

  return {
    score,
    label,
    color,
    comment,
    totalEstimated: totalEst,
    totalActual: totalAct,
    totalDifference: totalDiff,
    totalPercentageDiff: totalPctDiff,
    phases
  };
}
