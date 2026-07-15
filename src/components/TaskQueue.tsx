import React, { useState } from "react";
import { Task, AIConfig } from "../types";
import { 
  Play, 
  Trash2, 
  Plus, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Cpu, 
  Clock, 
  Settings2,
  ListRestart,
  ChevronDown,
  ChevronRight,
  Search,
  Copy,
  CheckSquare,
  Square,
  Info,
  Download,
  Upload
} from "lucide-react";

interface TaskQueueProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onCreateTask: (taskData: {
    title: string;
    prompt: string;
    provider: string;
    model: string;
    temperature: number;
    systemInstruction: string;
    runImmediately?: boolean;
    retryStrategy?: {
      maxAttempts: number;
      intervalMs: number;
      backoff: 'exponential' | 'linear' | 'fixed';
    };
  }) => void;
  onDeleteTask: (id: string) => void;
  onRunTask: (id: string) => void;
  onResumeTask?: (id: string) => void;
  onResetTask: (id: string) => void;
  isRunningAny: boolean;
  aiConfig: AIConfig | null;
  localMirrorTasks?: Task[];
  onRestoreFromLocalMirror?: () => void;
}

export default function TaskQueue({
  tasks,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onDeleteTask,
  onRunTask,
  onResumeTask,
  onResetTask,
  isRunningAny,
  aiConfig,
  localMirrorTasks = [],
  onRestoreFromLocalMirror
}: TaskQueueProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newProvider, setNewProvider] = useState("gemini");
  const [newModel, setNewModel] = useState("gemini-3.5-flash");
  const [newTemp, setNewTemp] = useState(0.2);
  const [newInstruction, setNewInstruction] = useState("你是一个精悍而强大的本地 AI 自动化执行助理。");
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);
  const [retryIntervalMs, setRetryIntervalMs] = useState(2000);
  const [retryBackoff, setRetryBackoff] = useState<'exponential' | 'linear' | 'fixed'>('exponential');

  // Filters, Search & Sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "running" | "completed" | "failed">("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");

  // Bulk Operations State
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'run' | 'reset' | 'delete' | 'clear';
    count: number;
  } | null>(null);

  // Check if browser mirror differs from current active tasks
  const showRestoreBanner = localMirrorTasks.length > 0 && 
    (localMirrorTasks.length > tasks.length || 
     (localMirrorTasks.length === tasks.length && 
      localMirrorTasks.some(l => l.executionStatus !== "pending") && 
      tasks.every(t => t.executionStatus === "pending")
     )
    );

  const totalCount = tasks.length;
  const runningCount = tasks.filter(t => (t.executionStatus || t.status) === "running").length;
  const completedCount = tasks.filter(t => (t.executionStatus || t.status) === "completed").length;
  const failedCount = tasks.filter(t => (t.executionStatus || t.status) === "failed").length;
  const pendingCount = tasks.filter(t => (t.executionStatus || t.status) === "pending").length;
  
  const successRate = (completedCount + failedCount) > 0 
    ? Math.round((completedCount / (completedCount + failedCount)) * 100) 
    : 0;
     
  const totalTokens = tasks.reduce((acc, t) => acc + (t.resourceConsumption?.tokensUsed || 0), 0);
  const totalDurationSec = Math.round(tasks.reduce((acc, t) => acc + (t.resourceConsumption?.durationMs || 0), 0) / 1000);

  // Helper to compute sort priority / value
  const getTaskSortValue = (task: Task) => {
    // 1. Check if createdAt exists
    if (task.createdAt) {
      const d = new Date(task.createdAt).getTime();
      if (!isNaN(d)) return d;
    }
    
    // 2. Check first log entry timestamp
    if (task.logs && task.logs.length > 0 && task.logs[0].timestamp) {
      const d = new Date(task.logs[0].timestamp).getTime();
      if (!isNaN(d)) return d;
    }
    
    // 3. Try parsing task-[timestamp]-... or task-[index]
    if (task.id.startsWith("task-")) {
      const parts = task.id.split("-");
      if (parts.length > 1) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) {
          return num;
        }
      }
    }
    
    return 0;
  };

  // Sort tasks based on getTaskSortValue and user's chosen direction
  const sortedTasks = [...tasks].sort((a, b) => {
    const valA = getTaskSortValue(a);
    const valB = getTaskSortValue(b);
    
    if (valA !== valB) {
      return sortBy === "newest" ? valB - valA : valA - valB;
    }
    
    // Fallback
    const indexDiff = tasks.indexOf(b) - tasks.indexOf(a);
    return sortBy === "newest" ? indexDiff : -indexDiff;
  });

  // Apply filters and search query
  const filteredTasks = sortedTasks.filter(task => {
    const titleVal = (task.description?.title || task.title || "").toLowerCase();
    const promptVal = (task.description?.prompt || task.prompt || "").toLowerCase();
    const query = searchQuery.toLowerCase().trim();

    // Search matches title or prompt
    const matchesSearch = !query || titleVal.includes(query) || promptVal.includes(query);

    // Status matching
    const currentStatus = task.executionStatus || task.status || "pending";
    const matchesStatus = statusFilter === "all" || currentStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const getTaskDateGrouping = (task: Task): { id: string; title: string } => {
    const taskTime = getTaskSortValue(task);
    if (!taskTime) {
      return { id: "older", title: "更早以前 (Earlier)" };
    }
    
    const date = new Date(taskTime);
    const now = new Date();
    
    // Calculate start of today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const monthStart = todayStart - 30 * 24 * 60 * 60 * 1000;

    // Helper to get week number
    const getWeekNumber = (d: Date) => {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const millisecsInDay = 86400000;
      return Math.ceil((((d.getTime() - onejan.getTime()) / millisecsInDay) + onejan.getDay() + 1) / 7);
    };

    if (taskTime >= todayStart) {
      return { 
        id: `day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, 
        title: `今天 (Today) - ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` 
      };
    } else if (taskTime >= yesterdayStart) {
      return { 
        id: `day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, 
        title: `昨天 (Yesterday) - ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` 
      };
    } else if (taskTime >= weekStart) {
      const weekNum = getWeekNumber(date);
      return { 
        id: `week-${date.getFullYear()}-${weekNum}`, 
        title: `本周 (This Week) - ${date.getFullYear()}年第 ${weekNum} 周` 
      };
    } else if (taskTime >= monthStart) {
      return { 
        id: `month-${date.getFullYear()}-${date.getMonth()}`, 
        title: `本月 (This Month) - ${date.getFullYear()}年 ${date.getMonth() + 1}月` 
      };
    } else if (date.getFullYear() === now.getFullYear()) {
      return { 
        id: `year-${date.getFullYear()}`, 
        title: `今年 (This Year) - ${date.getFullYear()}年` 
      };
    } else {
      return { 
        id: `older-${date.getFullYear()}`, 
        title: `更早以前 (Earlier) - ${date.getFullYear()}年` 
      };
    }
  };

  const groupedTasks = React.useMemo(() => {
    const groups: Record<string, { title: string; tasks: Task[]; order: number }> = {};

    filteredTasks.forEach(task => {
      const groupInfo = getTaskDateGrouping(task);
      if (!groups[groupInfo.id]) {
        const taskTime = getTaskSortValue(task);
        groups[groupInfo.id] = {
          title: groupInfo.title,
          tasks: [],
          order: taskTime
        };
      }
      groups[groupInfo.id].tasks.push(task);
    });

    // Sort groups chronologically so that groups with newer tasks are displayed first/last based on sortBy
    return Object.entries(groups)
      .map(([id, group]) => ({ id, title: group.title, tasks: group.tasks, order: group.order }))
      .sort((a, b) => sortBy === "newest" ? b.order - a.order : a.order - b.order);
  }, [filteredTasks, sortBy]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const handleOpenForm = () => {
    if (aiConfig) {
      const activeProvider = aiConfig.activeProvider;
      let activeModel = aiConfig.activeModel;
      const pConfig = aiConfig.providers[activeProvider];
      if (pConfig) {
        const models = pConfig.availableModels || [];
        if (!models.includes(activeModel)) {
          activeModel = (pConfig.defaultModel && models.includes(pConfig.defaultModel))
            ? pConfig.defaultModel
            : (models[0] || "");
        }
      }
      setNewProvider(activeProvider);
      setNewModel(activeModel);
    }
    setShowCreateForm(!showCreateForm);
  };

  const handleProviderChange = (provider: string) => {
    setNewProvider(provider);
    if (aiConfig && aiConfig.providers[provider]) {
      const pConfig = aiConfig.providers[provider];
      const models = pConfig.availableModels || [];
      const defaultM = pConfig.defaultModel;
      const matchedModel = (defaultM && models.includes(defaultM))
        ? defaultM
        : (models[0] || "");
      setNewModel(matchedModel);
    }
  };

  const handleFormSubmit = (runImmediately: boolean) => {
    const titleVal = newTitle.trim();
    const promptVal = newPrompt.trim();

    if (!titleVal && !promptVal) {
      alert("请填写任务名称或提示词中的至少一项！");
      return;
    }

    const finalTitle = titleVal || (promptVal.length > 25 ? promptVal.slice(0, 25) + "..." : promptVal);
    const finalPrompt = promptVal || titleVal;

    onCreateTask({
      title: finalTitle,
      prompt: finalPrompt,
      provider: newProvider,
      model: newModel,
      temperature: newTemp,
      systemInstruction: newInstruction,
      runImmediately,
      retryStrategy: {
        maxAttempts: retryMaxAttempts,
        intervalMs: retryIntervalMs,
        backoff: retryBackoff
      }
    });

    setNewTitle("");
    setNewPrompt("");
    setShowCreateForm(false);
  };

  // Clone / Duplicate Task Handler
  const handleCloneTask = (task: Task) => {
    const taskTitle = task.description?.title || task.title || "未命名任务";
    const taskPrompt = task.description?.prompt || task.prompt || "";
    const taskProvider = task.parameters?.provider || "gemini";
    const taskModel = task.parameters?.model || "gemini-3.5-flash";
    const taskTemp = task.parameters?.temperature !== undefined ? task.parameters.temperature : 0.2;
    const taskInstruction = task.parameters?.systemInstruction || "你是一个精悍而强大的本地 AI 自动化执行助理。";
    
    setNewTitle(`${taskTitle} (Clone)`);
    setNewPrompt(taskPrompt);
    setNewProvider(taskProvider);
    setNewModel(taskModel);
    setNewTemp(taskTemp);
    setNewInstruction(taskInstruction);
    
    if (task.parameters?.retryStrategy) {
      setRetryMaxAttempts(task.parameters.retryStrategy.maxAttempts || 3);
      setRetryIntervalMs(task.parameters.retryStrategy.intervalMs || 2000);
      setRetryBackoff(task.parameters.retryStrategy.backoff || 'exponential');
    }

    setShowCreateForm(true);
    
    // Scroll Task Queue Panel to top to show form
    const formEl = document.getElementById("task-queue-panel");
    if (formEl) {
      formEl.scrollTop = 0;
    }
  };

  // Toggle single bulk selection
  const handleToggleSelectBulk = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid selecting the card
    setSelectedBulkIds(prev => 
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    );
  };

  // Toggle select all filtered tasks
  const handleToggleSelectAll = () => {
    const allFilteredIds = filteredTasks.map(t => t.id);
    const areAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedBulkIds.includes(id));

    if (areAllSelected) {
      // Unselect all of these
      setSelectedBulkIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
    } else {
      // Select all of these (merge)
      setSelectedBulkIds(prev => {
        const union = new Set([...prev, ...allFilteredIds]);
        return Array.from(union);
      });
    }
  };

  // Bulk Run
  const handleBulkRun = async () => {
    if (selectedBulkIds.length === 0) return;
    const ids = [...selectedBulkIds];
    setSelectedBulkIds([]);
    for (const id of ids) {
      await onRunTask(id);
    }
  };

  // Bulk Reset
  const handleBulkReset = async () => {
    if (selectedBulkIds.length === 0) return;
    const ids = [...selectedBulkIds];
    setSelectedBulkIds([]);
    for (const id of ids) {
      await onResetTask(id);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedBulkIds.length === 0) return;
    if (confirm(`⚠️ 确认彻底删除这 ${selectedBulkIds.length} 个选中的任务吗？`)) {
      const ids = [...selectedBulkIds];
      setSelectedBulkIds([]);
      for (const id of ids) {
        await onDeleteTask(id);
      }
    }
  };

  // Clear completed and failed tasks to keep queue pristine
  const handleClearFinishedTasks = async () => {
    const finished = tasks.filter(t => {
      const s = t.executionStatus || t.status;
      return s === "completed" || s === "failed";
    });
    if (finished.length === 0) return;
    if (confirm(`确认清理这 ${finished.length} 个已完成或失败的任务吗？`)) {
      for (const t of finished) {
        await onDeleteTask(t.id);
      }
    }
  };

  const getStatusBadge = (status: Task["executionStatus"], hasState?: boolean) => {
    switch (status) {
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#111827] text-slate-400 border border-[#1F2937]">
            PENDING
          </span>
        );
      case "running":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 animate-pulse">
            RUNNING
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            COMPLETED
          </span>
        );
      case "failed":
        return (
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
              FAILED
            </span>
            {hasState && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-sans font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30" title="此任务已保存执行断点，支持手动续传恢复">
                ⚡️ RESUMABLE
              </span>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0F172A] border border-[#1F2937] rounded overflow-hidden shadow-xl" id="task-queue-panel">
      {/* Header */}
      <div className="p-3 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-blue-400" />
          <h2 className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400">Task Queue</h2>
          <span className="px-1.5 py-0.5 rounded-full bg-blue-900/40 text-blue-400 text-[10px] font-bold font-mono">{tasks.length}</span>
        </div>
        <button
          onClick={handleOpenForm}
          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold font-mono uppercase text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          {showCreateForm ? "- Close Form" : "+ New Task"}
        </button>
      </div>

      {/* Task Creation Form Panel */}
      {showCreateForm && (
        <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit(false); }} className="border-b border-[#1F2937] bg-[#111827] flex flex-col max-h-[460px] animate-in fade-in slide-in-from-top-4 duration-200">
          {/* Scrollable Input Fields Container */}
          <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar max-h-[340px] pr-1.5 flex-1">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[10px] uppercase font-bold text-slate-500 font-mono">任务名称 / Name</label>
                <span className="text-[9px] font-mono text-slate-600">与提示词可互通/选填</span>
              </div>
              <input
                type="text"
                placeholder="任务名称 (留空则自动提取提示词摘要)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-200 placeholder-slate-700 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[10px] uppercase font-bold text-slate-500 font-mono">提示词指令 / System Prompt</label>
                <span className="text-[9px] font-mono text-slate-600">留空则复制任务名称</span>
              </div>
              <textarea
                rows={3}
                placeholder="要 AI 自动执行的指令步骤 (留空则默认同任务名称)"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-200 placeholder-slate-700 text-xs focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1 font-mono">平台 / Provider</label>
                <select
                  value={newProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full px-1.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-300 text-[11px] font-mono focus:outline-none"
                >
                  {aiConfig ? Object.keys(aiConfig.providers).map(pKey => {
                    const nameMap: Record<string, string> = {
                      gemini: "Google Gemini",
                      openai: "OpenAI GPT",
                      anthropic: "Anthropic Claude",
                      agnes: "Agnes AI",
                      local_llm: "Local LLM"
                    };
                    return (
                      <option key={pKey} value={pKey}>{nameMap[pKey] || pKey}</option>
                    );
                  }) : (
                    <>
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI GPT</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="agnes">Agnes AI</option>
                      <option value="local_llm">Local LLM</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1 font-mono">核模型 / Model</label>
                <select
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  className="w-full px-1.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-300 text-[11px] font-mono focus:outline-none"
                >
                  {aiConfig && aiConfig.providers[newProvider] ? (
                    aiConfig.providers[newProvider].availableModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))
                  ) : (
                    <option value={newModel}>{newModel}</option>
                  )}
                </select>
              </div>
            </div>

            {/* Media Model Auto-Fallback Alert */}
            {(newModel.toLowerCase().includes("video") || newModel.toLowerCase().includes("image") || newModel.toLowerCase().includes("dall-e") || newModel.toLowerCase().includes("dalle") || newModel.toLowerCase().includes("imagen")) && (
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded text-[10px] text-blue-300 leading-normal flex items-start gap-1.5 font-sans">
                <span className="text-blue-400 mt-0.5">💡</span>
                <div>
                  <strong>智能自愈机制已就绪：</strong>
                  检测到您选用了图像/视频等多媒体模型作为任务的规划大脑。任务引擎将自动调度 <code>agnes-2.0-flash</code> (或类似的高能文本模型) 充当其决策大脑，并在执行过程中配合工具调度，保障您的任务能够顺利产出完美结果！
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1 font-mono">温度 / Temp: {newTemp}</label>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.1"
                  value={newTemp}
                  onChange={(e) => setNewTemp(Number(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-blue-500 mt-2.5"
                />
              </div>
              <div className="flex items-end pb-1 text-[10px] text-slate-500 font-mono italic">
                值越高，决策创意性越强
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1 font-mono">系统预设 / Preset Instruction</label>
              <input
                type="text"
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Configurable Retry Strategy */}
            <div className="p-2.5 bg-[#1F2937]/30 border border-[#1F2937] rounded space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">重试策略 / Retry Strategy</label>
                <span className="text-[9px] font-mono text-blue-400 font-semibold">自愈/退避算法可用</span>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-500 mb-1 font-mono">最大重试 / Max</label>
                  <select
                    value={retryMaxAttempts}
                    onChange={(e) => setRetryMaxAttempts(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-300 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                  >
                    <option value={1}>1 次 (不重试)</option>
                    <option value={2}>2 次</option>
                    <option value={3}>3 次 (默认)</option>
                    <option value={5}>5 次</option>
                    <option value={10}>10 次</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-500 mb-1 font-mono">间隔 / Interval</label>
                  <select
                    value={retryIntervalMs}
                    onChange={(e) => setRetryIntervalMs(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-300 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                  >
                    <option value={1000}>1.0 秒</option>
                    <option value={2000}>2.0 秒 (默认)</option>
                    <option value={3000}>3.0 秒</option>
                    <option value={5000}>5.0 秒</option>
                    <option value={10000}>10.0 秒</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-500 mb-1 font-mono">算法 / Backoff</label>
                  <select
                    value={retryBackoff}
                    onChange={(e) => setRetryBackoff(e.target.value as any)}
                    className="w-full px-1.5 py-1 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-300 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                  >
                    <option value="exponential">指数退避</option>
                    <option value="linear">线性增加</option>
                    <option value="fixed">固定间隔</option>
                  </select>
                </div>
              </div>
              <div className="text-[9px] text-slate-500 leading-normal font-sans">
                * 针对 AI 请求波动进行多轮重试。{retryBackoff === 'exponential' ? '退避示例：2s, 4s, 8s...' : retryBackoff === 'linear' ? '退避示例：2s, 4s, 6s...' : '固定间隔：每次都是 ' + (retryIntervalMs / 1000) + 's'}
              </div>
            </div>
          </div>

          {/* Fixed Footer Action Buttons */}
          <div className="p-3 bg-[#0d131f] border-t border-[#1F2937] flex justify-between items-center shrink-0 font-mono">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-2 py-1 text-[10px] font-bold uppercase text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleFormSubmit(false)}
                className="px-2.5 py-1 text-[10px] font-bold uppercase bg-[#1E293B] border border-[#334155] text-slate-300 hover:bg-[#334155] rounded cursor-pointer"
              >
                Save Task
              </button>
              <button
                type="button"
                onClick={() => handleFormSubmit(true)}
                className="px-2.5 py-1 text-[10px] font-bold uppercase bg-blue-600 hover:bg-blue-500 text-white rounded shadow-lg shadow-blue-500/20 flex items-center gap-1 cursor-pointer"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                Save & Run
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Local Storage Auto-Recovery double-guard banner */}
      {showRestoreBanner && onRestoreFromLocalMirror && (
        <div className="mx-2 mt-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs leading-normal text-amber-300 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <p className="font-bold font-mono text-[10px] uppercase tracking-wider text-amber-400 font-sans">Double-Guard Local Cache Detected / 发现历史任务</p>
              <p className="text-slate-300 text-[11px] font-sans">
                由于云端容器沙箱为临时环境，重启或重新部署会重置任务列表。系统检测到您的浏览器缓存中存有历史执行记录（共 <strong>{localMirrorTasks.length}</strong> 个任务）。
              </p>
              <button 
                type="button"
                onClick={onRestoreFromLocalMirror}
                className="inline-flex items-center gap-1 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-mono font-bold uppercase rounded cursor-pointer transition-all shadow shadow-amber-900"
              >
                <Upload className="w-3 h-3 animate-bounce" />
                一键恢复同步所有任务 (Sync Cache)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mini Dashboard */}
      {tasks.length > 0 && (
        <div className="mx-2 mt-2 p-2.5 bg-[#111827]/60 border border-[#1F2937] rounded space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[9px] uppercase font-bold tracking-widest font-mono text-slate-500">Execution Overview</h3>
            <span className="text-[9px] font-mono font-semibold text-slate-500">
              Tokens: <span className="text-blue-400 font-bold">{totalTokens.toLocaleString()}</span> • Time: <span className="text-emerald-400 font-bold">{totalDurationSec}s</span>
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1 text-center font-mono text-[10px]">
            <div className="p-1 bg-[#1E293B]/30 rounded border border-[#1f2937]/50">
              <div className="text-slate-500 text-[8px] uppercase">Total</div>
              <div className="font-bold text-slate-300">{totalCount}</div>
            </div>
            <div className="p-1 bg-blue-500/5 rounded border border-blue-500/10">
              <div className="text-blue-500 text-[8px] uppercase">Run</div>
              <div className="font-bold text-blue-400 animate-pulse">{runningCount}</div>
            </div>
            <div className="p-1 bg-emerald-500/5 rounded border border-emerald-500/10">
              <div className="text-emerald-500 text-[8px] uppercase">Done</div>
              <div className="font-bold text-emerald-400">{completedCount}</div>
            </div>
            <div className="p-1 bg-rose-500/5 rounded border border-rose-500/10">
              <div className="text-rose-500 text-[8px] uppercase">Fail</div>
              <div className="font-bold text-rose-400">{failedCount}</div>
            </div>
            <div className="p-1 bg-[#1E293B]/30 rounded border border-[#1f2937]/50">
              <div className="text-slate-500 text-[8px] uppercase">Success</div>
              <div className="font-bold text-slate-300">{successRate}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      {tasks.length > 0 && (
        <div className="mx-2 my-2 space-y-2">
          <div className="flex gap-1.5">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="搜索任务..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-300 placeholder-slate-600 text-[11px] focus:outline-none focus:border-blue-500 font-sans"
              />
            </div>
            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-1.5 py-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-400 text-[11px] font-mono focus:outline-none cursor-pointer"
            >
              <option value="newest">最新优先</option>
              <option value="oldest">最早优先</option>
            </select>
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#1F2937]/50 scrollbar-none font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${statusFilter === "all" ? "bg-slate-800 text-white border border-slate-700" : "hover:text-slate-300"}`}
            >
              All ({tasks.length})
            </button>
            <button
              onClick={() => setStatusFilter("pending")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${statusFilter === "pending" ? "bg-slate-800 text-slate-400 border border-slate-700" : "hover:text-slate-300"}`}
            >
              Pend ({tasks.filter(t => (t.executionStatus || t.status) === 'pending').length})
            </button>
            <button
              onClick={() => setStatusFilter("running")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${statusFilter === "running" ? "bg-slate-800 text-blue-400 border border-slate-700" : "hover:text-slate-300"}`}
            >
              Run ({tasks.filter(t => (t.executionStatus || t.status) === 'running').length})
            </button>
            <button
              onClick={() => setStatusFilter("completed")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${statusFilter === "completed" ? "bg-slate-800 text-emerald-400 border border-slate-700" : "hover:text-slate-300"}`}
            >
              Done ({tasks.filter(t => (t.executionStatus || t.status) === 'completed').length})
            </button>
            <button
              onClick={() => setStatusFilter("failed")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${statusFilter === "failed" ? "bg-slate-800 text-rose-400 border border-slate-700" : "hover:text-slate-300"}`}
            >
              Fail ({tasks.filter(t => (t.executionStatus || t.status) === 'failed').length})
            </button>
          </div>

          {/* Bulk Controls Toolbar */}
          <div className="flex items-center justify-between p-1.5 bg-[#111827]/40 border border-[#1F2937]/50 rounded text-[10px] font-mono animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                title={filteredTasks.length > 0 && filteredTasks.every(t => selectedBulkIds.includes(t.id)) ? "取消全选" : "全选当前过滤任务"}
              >
                {filteredTasks.length > 0 && filteredTasks.every(t => selectedBulkIds.includes(t.id)) ? (
                  <CheckSquare className="w-4 h-4 text-blue-500" />
                ) : (
                  <Square className="w-4 h-4 opacity-40 hover:opacity-100" />
                )}
              </button>
              <span className="text-slate-500">已选 <strong className="text-blue-400">{selectedBulkIds.length}</strong> 项</span>
            </div>

            {selectedBulkIds.length > 0 ? (
              <div className="flex gap-1.5">
                <button
                  onClick={handleBulkRun}
                  className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold uppercase text-[9px] cursor-pointer transition-all"
                >
                  运行所选
                </button>
                <button
                  onClick={handleBulkReset}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded font-bold uppercase text-[9px] cursor-pointer transition-all"
                >
                  重置所选
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="px-2 py-0.5 bg-rose-950 hover:bg-rose-900 border border-rose-900/40 text-rose-400 rounded font-bold uppercase text-[9px] cursor-pointer transition-all"
                >
                  删除所选
                </button>
              </div>
            ) : (
              <button
                onClick={handleClearFinishedTasks}
                disabled={(completedCount + failedCount) === 0}
                className={`px-2 py-0.5 text-[9px] rounded transition-all font-bold uppercase flex items-center gap-1 border border-transparent ${
                  (completedCount + failedCount) === 0
                    ? 'text-slate-600 opacity-40 cursor-not-allowed'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 cursor-pointer hover:border-slate-800'
                }`}
              >
                <Trash2 className="w-3 h-3" />
                清理已结任务
              </button>
            )}
          </div>
        </div>
      )}

      {/* Task List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {tasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-600 font-mono">
            <AlertCircle className="w-6 h-6 mb-2 text-slate-700" />
            <p className="text-[10px] uppercase">No active task queue</p>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-600 font-mono">
            <Search className="w-6 h-6 mb-2 text-slate-700" />
            <p className="text-[10px] uppercase">未找到匹配过滤条件的任务</p>
          </div>
        ) : (
          groupedTasks.map((group) => {
            const isCollapsed = !!collapsedGroups[group.id];
            return (
              <div key={group.id} className="space-y-1 mb-2">
                {/* Collapsible Group Header */}
                <div 
                  onClick={() => toggleGroupCollapse(group.id)}
                  className="flex items-center justify-between p-2 bg-[#1e293b]/40 hover:bg-[#1e293b]/60 rounded border border-[#1f2937]/50 cursor-pointer select-none font-mono text-[10px] text-slate-400 font-bold uppercase tracking-wider transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{group.title}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[9px] border border-slate-700/50">
                    {group.tasks.length}
                  </span>
                </div>

                {/* Group Content */}
                {!isCollapsed && (
                  <div className="space-y-1 pl-1">
                    {group.tasks.map((task) => {
                      const isSelected = selectedTaskId === task.id;
                      const currentStatus = task.executionStatus || task.status || "pending";
                      const taskTitle = task.description?.title || task.title || "未命名任务";
                      const taskPrompt = task.description?.prompt || task.prompt || "";
                      const taskModel = task.parameters?.model || task.model || "gemini-3.5-flash";
                      const taskTemp = task.parameters?.temperature !== undefined ? task.parameters.temperature : (task.temperature || 0.2);

                      return (
                        <div
                          key={task.id}
                          onClick={() => onSelectTask(task.id)}
                          className={`group p-3 rounded border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-blue-600/10 border-blue-500/30"
                              : "bg-transparent border-transparent opacity-70 hover:opacity-100 hover:bg-[#111827]/40"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            {/* Checkbox selector on the left of each task */}
                            <button
                              type="button"
                              onClick={(e) => handleToggleSelectBulk(task.id, e)}
                              className="mt-1 shrink-0 text-slate-500 hover:text-blue-400 transition-colors cursor-pointer"
                            >
                              {selectedBulkIds.includes(task.id) ? (
                                <CheckSquare className="w-4 h-4 text-blue-500" />
                              ) : (
                                <Square className="w-4 h-4 opacity-40 hover:opacity-100" />
                              )}
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="space-y-0.5 overflow-hidden">
                                  <p className="text-xs font-semibold text-slate-200 truncate group-hover:text-white transition-colors">
                                    {taskTitle}
                                  </p>
                                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                                    <span>ID: {task.id?.slice(0, 6) || "N/A"}</span>
                                    <span>•</span>
                                    <span className="truncate">Prompt: {taskPrompt}</span>
                                  </div>
                                </div>
                                <div className="shrink-0">{getStatusBadge(currentStatus, !!task.executionState)}</div>
                              </div>

                              {/* Progress Bar for Running Tasks */}
                              {currentStatus === "running" && (
                                <div className="my-2 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500 w-[65%] animate-pulse"></div>
                                </div>
                              )}

                              {/* Task Stats Info */}
                              <div className="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-2 text-[10px] text-slate-500 font-mono pt-1.5 border-t border-[#1F2937]/30 mt-1.5">
                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                  <span className="text-blue-400 font-bold uppercase shrink-0">{task.parameters?.provider || "gemini"}</span>
                                  <span className="truncate max-w-[90px] text-slate-400" title={taskModel}>
                                    {taskModel.replace("gemini-", "g-")}
                                  </span>
                                  <span className="shrink-0 text-slate-600">T={taskTemp}</span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
                                  {/* Duplicate/Clone Action */}
                                  <button
                                    onClick={() => handleCloneTask(task)}
                                    title="复制/克隆任务参数"
                                    className="p-1 rounded hover:bg-[#1E293B] hover:text-emerald-400 transition-colors cursor-pointer text-slate-400"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => onResetTask(task.id)}
                                    title="重置任务状态"
                                    className="p-1 rounded hover:bg-[#1E293B] hover:text-blue-400 transition-colors cursor-pointer text-slate-400"
                                    disabled={currentStatus === "running"}
                                  >
                                    <ListRestart className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => onDeleteTask(task.id)}
                                    title="删除任务"
                                    className="p-1 rounded hover:bg-[#1E293B] hover:text-rose-400 transition-colors cursor-pointer text-slate-400"
                                    disabled={currentStatus === "running"}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  {currentStatus !== "running" ? (
                                    <div className="flex items-center gap-1 shrink-0 ml-0.5">
                                      {task.executionState && onResumeTask && (
                                        <button
                                          onClick={() => onResumeTask(task.id)}
                                          title="断点续传 / 手动断点恢复"
                                          className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[9px] flex items-center gap-0.5 cursor-pointer shadow-sm transition-all shrink-0"
                                        >
                                          <Play className="w-2 h-2 fill-current animate-pulse shrink-0" />
                                          <span className="text-[8px]">RESUME</span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => onRunTask(task.id)}
                                        title={task.executionState ? "全新或重新运行任务" : "执行任务"}
                                        className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-[9px] flex items-center gap-0.5 cursor-pointer shadow-sm transition-all shrink-0"
                                      >
                                        <Play className="w-2 h-2 fill-current shrink-0" />
                                        <span className="text-[8px]">{task.executionState ? "RESTART" : "RUN"}</span>
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-ping mx-2 shrink-0" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
