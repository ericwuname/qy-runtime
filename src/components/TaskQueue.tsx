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
  ChevronRight
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
  aiConfig
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

  // Sort tasks: newest first
  const sortedTasks = [...tasks].sort((a, b) => {
    const valA = getTaskSortValue(a);
    const valB = getTaskSortValue(b);
    
    if (valA !== valB) {
      return valB - valA; // Descending (newest first)
    }
    
    // Fallback: reverse order of appearance in original tasks array
    return tasks.indexOf(b) - tasks.indexOf(a);
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

    sortedTasks.forEach(task => {
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

    // Sort groups chronologically so that groups with newer tasks are displayed first
    return Object.entries(groups)
      .map(([id, group]) => ({ id, title: group.title, tasks: group.tasks, order: group.order }))
      .sort((a, b) => b.order - a.order);
  }, [sortedTasks]);

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
        <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit(false); }} className="p-3 border-b border-[#1F2937] bg-[#111827] space-y-3 animate-in fade-in slide-in-from-top-4 duration-200">
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

          <div className="flex justify-between items-center pt-1 font-mono">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-2 py-1 text-[10px] font-bold uppercase text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleFormSubmit(false)}
                className="px-2.5 py-1 text-[10px] font-bold uppercase bg-[#1E293B] border border-[#334155] text-slate-300 hover:bg-[#334155] rounded"
              >
                Save Task
              </button>
              <button
                type="button"
                onClick={() => handleFormSubmit(true)}
                className="px-2.5 py-1 text-[10px] font-bold uppercase bg-blue-600 hover:bg-blue-500 text-white rounded shadow-lg shadow-blue-500/20 flex items-center gap-1"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                Save & Run
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Task List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {tasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-600 font-mono">
            <AlertCircle className="w-6 h-6 mb-2 text-slate-700" />
            <p className="text-[10px] uppercase">No active task queue</p>
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
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="space-y-0.5 overflow-hidden">
                              <p className="text-xs font-semibold text-slate-200 truncate group-hover:text-white transition-colors">
                                {taskTitle}
                              </p>
                              <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                                <span>ID: {task.id.slice(0, 6)}</span>
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
                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-blue-400 font-bold uppercase">{task.parameters?.provider || "gemini"}</span>
                              <span>{taskModel.replace("gemini-", "g-")}</span>
                              <span>T={taskTemp}</span>
                            </div>
                            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => onResetTask(task.id)}
                                title="重置任务状态"
                                className="p-1 rounded hover:bg-[#1E293B] hover:text-blue-400 transition-colors"
                                disabled={currentStatus === "running"}
                              >
                                <ListRestart className="w-3.5 h-3.5" />
                              </button>
                               <button
                                onClick={() => onDeleteTask(task.id)}
                                title="删除任务"
                                className="p-1 rounded hover:bg-[#1E293B] hover:text-rose-400 transition-colors"
                                disabled={currentStatus === "running"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              {currentStatus !== "running" ? (
                                <div className="flex items-center gap-1">
                                  {task.executionState && onResumeTask && (
                                    <button
                                      onClick={() => onResumeTask(task.id)}
                                      title="断点续传 / 手动断点恢复"
                                      className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[9px] flex items-center gap-0.5 cursor-pointer shadow-sm transition-all"
                                    >
                                      <Play className="w-2 h-2 fill-current animate-pulse" />
                                      RESUME
                                    </button>
                                  )}
                                  <button
                                    onClick={() => onRunTask(task.id)}
                                    title={task.executionState ? "全新或重新运行任务" : "执行任务"}
                                    className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-[9px] flex items-center gap-0.5 cursor-pointer shadow-sm transition-all"
                                  >
                                    <Play className="w-2 h-2 fill-current" />
                                    {task.executionState ? "RESTART" : "RUN"}
                                  </button>
                                </div>
                              ) : (
                                <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
                              )}
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
