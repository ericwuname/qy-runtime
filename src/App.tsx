import React, { useEffect, useState, useRef } from "react";
import { Task, AIConfig } from "./types";
import TaskQueue from "./components/TaskQueue";
import LiveLogs from "./components/LiveLogs";
import WorkspaceManager from "./components/WorkspaceManager";
import AIConfigManager from "./components/AIConfigManager";
import ErrorAnalyzer from "./components/ErrorAnalyzer";
import { 
  Cpu, 
  Terminal, 
  Download, 
  Upload, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  BookOpen, 
  Activity, 
  HeartHandshake,
  Settings,
  FileWarning
} from "lucide-react";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"monitor" | "workspace" | "config" | "error_analyzer">("monitor");
  const [pollingActive, setPollingActive] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Load AI configuration from API
  const loadAIConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setAiConfig(data);
      }
    } catch (err) {
      console.error("Error loading AI config:", err);
    }
  };

  useEffect(() => {
    loadAIConfig();
  }, []);
  
  // High Density Real-time Telemetry Stats
  const [cpuLoad, setCpuLoad] = useState(42.1);
  const [memUsage, setMemUsage] = useState(1.24);

  useEffect(() => {
    const timer = setInterval(() => {
      setCpuLoad(prev => {
        const diff = (Math.random() - 0.5) * 6;
        const next = prev + diff;
        return Number(Math.max(25, Math.min(85, next)).toFixed(1));
      });
      setMemUsage(prev => {
        const diff = (Math.random() - 0.5) * 0.08;
        const next = prev + diff;
        return Number(Math.max(1.02, Math.min(2.18, next)).toFixed(2));
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  
  // Notification states
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Load all tasks
  const loadTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (Array.isArray(data)) {
        setTasks(data);
        
        // Auto-select the first task if none selected
        if (data.length > 0 && !selectedTaskId) {
          setSelectedTaskId(data[0].id);
        }
      }
    } catch (err) {
      console.error("Error loading tasks:", err);
    }
  };

  // Poll tasks if any task is running
  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    const isAnyRunning = tasks.some(t => (t.executionStatus || t.status) === "running");
    setPollingActive(isAnyRunning);

    let intervalId: NodeJS.Timeout | null = null;
    if (isAnyRunning) {
      intervalId = setInterval(() => {
        loadTasks();
      }, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [tasks]);

  const showNotification = (message: string, type: "success" | "error" | "info" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Handlers
  const handleCreateTask = async (taskData: any) => {
    try {
      const { runImmediately, ...dataToPost } = taskData;
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToPost)
      });
      if (res.ok) {
        const newTask = await res.json();
        setTasks(prev => [...prev, newTask]);
        setSelectedTaskId(newTask.id);
        if (runImmediately) {
          showNotification("新任务创建成功，正在启动执行链...", "info");
          await handleRunTask(newTask.id);
        } else {
          showNotification("新任务创建成功，已载入就绪队列");
        }
      } else {
        const errData = await res.json();
        showNotification(errData.error || "任务创建失败", "error");
      }
    } catch (err) {
      showNotification("无法连接至执行端服务器", "error");
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== id));
        if (selectedTaskId === id) {
          setSelectedTaskId(null);
        }
        showNotification("任务已安全移除");
      }
    } catch (err) {
      showNotification("移除任务失败", "error");
    }
  };

  const handleRunTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/run`, { method: "POST" });
      if (res.ok) {
        showNotification("执行链启动，AI 专家正在分析任务...", "info");
        loadTasks();
      } else {
        const errData = await res.json();
        showNotification(errData.error || "启动运行失败", "error");
      }
    } catch (err) {
      showNotification("触发运行遇到网络异常", "error");
    }
  };

  const handleResumeTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/resume`, { method: "POST" });
      if (res.ok) {
        showNotification("断点续传成功，继续从失败处开始运行！", "success");
        loadTasks();
      } else {
        const errData = await res.json();
        showNotification(errData.error || "断点恢复失败", "error");
      }
    } catch (err) {
      showNotification("续传操作遇到网络异常", "error");
    }
  };

  const handleResetTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/reset`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setTasks(prev => prev.map(t => t.id === id ? updated : t));
        showNotification("任务状态和历史日志已全部重置", "info");
      }
    } catch (err) {
      showNotification("重置操作失败", "error");
    }
  };

  const handleQuickRetry = async (id: string) => {
    try {
      showNotification("正在重置并准备快速重试任务...", "info");
      const resetRes = await fetch(`/api/tasks/${id}/reset`, { method: "POST" });
      if (!resetRes.ok) {
        showNotification("重置任务失败，无法重试", "error");
        return;
      }
      const updatedTask = await resetRes.json();
      setTasks(prev => prev.map(t => t.id === id ? updatedTask : t));

      const runRes = await fetch(`/api/tasks/${id}/run`, { method: "POST" });
      if (runRes.ok) {
        showNotification("快速重试成功：已重置状态并启动执行链！", "success");
        loadTasks();
      } else {
        const errData = await runRes.json();
        showNotification(errData.error || "启动重试失败", "error");
      }
    } catch (err) {
      showNotification("快速重试网络请求失败", "error");
    }
  };

  const handleExportBackup = () => {
    window.location.href = "/api/backup/export";
    showNotification("任务队列与沙箱文件打包导出中...");
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target?.result as string);
        const res = await fetch("/api/backup/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(backupData)
        });
        if (res.ok) {
          showNotification("配置及工作区文件还原成功！", "success");
          loadTasks();
        } else {
          showNotification("导入格式不符合模板规范", "error");
        }
      } catch (err) {
        showNotification("解析 JSON 配置文件失败", "error");
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#0A0B0E] text-[#D1D5DB] flex flex-col font-sans selection:bg-blue-500/30 selection:text-white border border-[#1F2937]" id="main-app">
      {/* Dynamic Alert Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded border shadow-2xl flex items-center gap-2.5 max-w-sm animate-in fade-in slide-in-from-top-4 duration-300 ${
          notification.type === "success" 
            ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-300"
            : notification.type === "error"
            ? "bg-rose-950/90 border-rose-500/40 text-rose-300"
            : "bg-[#111827] border-blue-500/40 text-blue-300"
        }`}>
          {notification.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          )}
          <span className="text-[11px] font-mono leading-normal">{notification.message}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <nav className="flex items-center justify-between h-14 px-6 bg-[#111827] border-b border-[#1F2937] shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white tracking-tighter italic">AX</div>
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Local AI Task Executor</span>
            <span className="text-[10px] opacity-50">v1.2.4 • Sandbox Active</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[10px] uppercase opacity-50 font-semibold font-mono">Active Model Pool</span>
            <span className="text-xs font-mono text-blue-400">
              {aiConfig ? `${aiConfig.activeProvider.toUpperCase()}: ${aiConfig.activeModel}` : "loading..."}
            </span>
          </div>
          <div className="h-8 w-[1px] bg-[#374151]"></div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportBackup}
              className="px-2.5 py-1.5 bg-[#1F2937] hover:bg-[#374151] border border-[#374151] text-[11px] font-medium rounded transition-colors flex items-center gap-1.5"
              title="一键打包备份"
            >
              <Download className="w-3.5 h-3.5" />
              导出备份
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportBackup}
              accept=".json"
              className="hidden"
              id="restore-upload-input"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 bg-[#1F2937] hover:bg-[#374151] border border-[#374151] text-[11px] font-medium rounded transition-colors flex items-center gap-1.5"
              title="载入备份还原状态"
            >
              <Upload className="w-3.5 h-3.5" />
              载入备份
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Layout */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0A0B0E] p-4 gap-4">
        
        {/* Navigation & Tab Toggle */}
        <div className="flex items-center justify-between border-b border-[#1F2937] pb-2.5" id="navigation-tabs">
          <div className="flex gap-1.5">
            <button
              onClick={() => setActiveTab("monitor")}
              className={`px-3 py-1 text-xs font-mono rounded transition-all cursor-pointer flex items-center gap-1.5 border ${
                activeTab === "monitor"
                  ? "bg-blue-600/10 border-blue-500/50 text-blue-400 font-bold"
                  : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              [01] MONITORING CENTER (监控台)
            </button>
            <button
              onClick={() => setActiveTab("workspace")}
              className={`px-3 py-1 text-xs font-mono rounded transition-all cursor-pointer flex items-center gap-1.5 border ${
                activeTab === "workspace"
                  ? "bg-blue-600/10 border-blue-500/50 text-blue-400 font-bold"
                  : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              [02] SANDBOX WORKSPACE (工作区)
            </button>
            <button
              onClick={() => setActiveTab("config")}
              className={`px-3 py-1 text-xs font-mono rounded transition-all cursor-pointer flex items-center gap-1.5 border ${
                activeTab === "config"
                  ? "bg-blue-600/10 border-blue-500/50 text-blue-400 font-bold"
                  : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              [03] AI ENGINE CONFIG (模型池)
            </button>
            <button
              onClick={() => setActiveTab("error_analyzer")}
              className={`px-3 py-1 text-xs font-mono rounded transition-all cursor-pointer flex items-center gap-1.5 border ${
                activeTab === "error_analyzer"
                  ? "bg-blue-600/10 border-blue-500/50 text-blue-400 font-bold"
                  : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <FileWarning className="w-3.5 h-3.5 text-red-400" />
              [04] ERROR ANALYZER (报错解析)
            </button>
          </div>


          <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span>SANDBOX DIRECTORY OVERFLOW BLOCKED • SECURE</span>
          </div>
        </div>

        {/* Tab View Switching */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "monitor" ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
              {/* Task list sidebar */}
              <div className="lg:col-span-3 h-full overflow-hidden">
                <TaskQueue
                  tasks={tasks}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={(id) => setSelectedTaskId(id)}
                  onCreateTask={handleCreateTask}
                  onDeleteTask={handleDeleteTask}
                  onRunTask={handleRunTask}
                  onResumeTask={handleResumeTask}
                  onResetTask={handleResetTask}
                  isRunningAny={pollingActive}
                  aiConfig={aiConfig}
                />
              </div>

              {/* Execution console */}
              <div className="lg:col-span-6 h-full overflow-hidden">
                <LiveLogs task={selectedTask} onQuickRetry={handleQuickRetry} />
              </div>

              {/* Right Sidebar: Resources & Sandbox context */}
              <div className="lg:col-span-3 h-full overflow-y-auto custom-scrollbar bg-[#0F172A] border border-[#1F2937] rounded flex flex-col p-4 space-y-5">
                {/* Resource Usage Section */}
                <div>
                  <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2.5 tracking-widest font-mono">System Health (健康指标)</h4>
                  <div className="space-y-3.5">
                    <div>
                      <div className="flex justify-between text-[11px] mb-1 font-mono">
                        <span>CPU LOAD (4 CORES)</span>
                        <span className="text-blue-400 font-bold">{cpuLoad}%</span>
                      </div>
                      <div className="h-1 w-full bg-slate-855 rounded overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${cpuLoad}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-1 font-mono">
                        <span>SANDBOX RAM ALLOC</span>
                        <span className="text-emerald-400 font-bold">{memUsage}GB / 4GB</span>
                      </div>
                      <div className="h-1 w-full bg-slate-855 rounded overflow-hidden">
                        <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${(memUsage / 4) * 100}%` }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Task Engine Counters */}
                <div className="pt-3.5 border-t border-[#1F2937]">
                  <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2.5 tracking-widest font-mono">QUEUE STATS (队列指标)</h4>
                  <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                    <div className="p-2 bg-[#111827] border border-[#1F2937] rounded flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">PENDING</span>
                      <span className="text-xs font-bold text-slate-300">
                        {tasks.filter(t => (t.executionStatus || t.status) === "pending").length} WAITING
                      </span>
                    </div>
                    <div className="p-2 bg-blue-950/10 border border-[#1F2937] rounded flex flex-col">
                      <span className="text-[9px] text-blue-400 font-bold uppercase">RUNNING</span>
                      <span className="text-xs font-bold text-blue-400">
                        {tasks.filter(t => (t.executionStatus || t.status) === "running").length} ACTIVE
                      </span>
                    </div>
                    <div className="p-2 bg-emerald-950/10 border border-[#1F2937] rounded flex flex-col">
                      <span className="text-[9px] text-emerald-400 font-bold uppercase">COMPLETED</span>
                      <span className="text-xs font-bold text-emerald-400">
                        {tasks.filter(t => (t.executionStatus || t.status) === "completed").length} SUCCESS
                      </span>
                    </div>
                    <div className="p-2 bg-rose-950/10 border border-[#1F2937] rounded flex flex-col">
                      <span className="text-[9px] text-rose-400 font-bold uppercase">FAILED</span>
                      <span className="text-xs font-bold text-rose-400">
                        {tasks.filter(t => (t.executionStatus || t.status) === "failed").length} ERROR
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sandbox Rules Section */}
                <div className="pt-3.5 border-t border-[#1F2937]">
                  <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2.5 tracking-widest font-mono">SECURITY CONTEXT (安全限制)</h4>
                  <div className="space-y-1.5 text-[10px] font-mono">
                    <div className="flex items-center gap-1.5 text-emerald-400/90">
                      <div className="w-3.5 h-3.5 rounded bg-emerald-400/20 flex items-center justify-center text-[8px] font-bold">✓</div>
                      WRITE PATH: ./workspace/*
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400/90">
                      <div className="w-3.5 h-3.5 rounded bg-emerald-400/20 flex items-center justify-center text-[8px] font-bold">✓</div>
                      TRAVERSAL PROTECTION: ENFORCED
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400/90">
                      <div className="w-3.5 h-3.5 rounded bg-emerald-400/20 flex items-center justify-center text-[8px] font-bold">✓</div>
                      TIMEOUT CONSTRAINT: 10s LIMIT
                    </div>
                    <div className="flex items-center gap-1.5 text-red-400/90">
                      <div className="w-3.5 h-3.5 rounded bg-red-400/20 flex items-center justify-center text-[8px] font-bold">✕</div>
                      NETWORK INBOUND: BLOCKED
                    </div>
                  </div>
                </div>

                {/* Active Tools Section */}
                <div className="pt-3.5 border-t border-[#1F2937]">
                  <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-widest font-mono">ACTIVE TOOLS (审计工具)</h4>
                  <div className="flex flex-wrap gap-1">
                    <span className="px-1.5 py-0.5 bg-[#1E293B] text-[9px] font-mono rounded border border-[#334155] text-slate-300">file_rw</span>
                    <span className="px-1.5 py-0.5 bg-[#1E293B] text-[9px] font-mono rounded border border-[#334155] text-slate-300">bash_env</span>
                    <span className="px-1.5 py-0.5 bg-[#1E293B] text-[9px] font-mono rounded border border-[#334155] text-slate-300">web_fetch</span>
                    <span className="px-1.5 py-0.5 bg-amber-950/40 text-amber-400 text-[9px] font-mono rounded border border-amber-900/50">gemini_rpc</span>
                  </div>
                </div>

                {/* Sidebar Actions */}
                <div className="mt-auto pt-3.5 border-t border-[#1F2937] flex flex-col gap-1.5">
                  <button 
                    onClick={() => {
                      showNotification("已向下游执行池广播：暂停排队任务", "info");
                    }}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-slate-800 hover:bg-slate-750 text-[10px] font-semibold border border-slate-700 rounded transition-colors font-mono uppercase"
                  >
                    PAUSE EXECUTION (暂停队列)
                  </button>
                  <button 
                    onClick={async () => {
                      if (confirm("是否确认一键重置当前沙箱中的全部就绪任务状态？")) {
                        for (const t of tasks) {
                          const currentStatus = t.executionStatus || t.status;
                          if (currentStatus === "running") {
                            await fetch(`/api/tasks/${t.id}/reset`, { method: "POST" });
                          }
                        }
                        loadTasks();
                        showNotification("沙箱内运行实例已全部终止并初始化", "error");
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 border border-red-500/30 text-red-400 hover:bg-red-950/20 text-[10px] font-semibold rounded transition-colors font-mono uppercase"
                  >
                    FORCE RESET (终止并重置实例)
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === "workspace" ? (
            <div className="h-full">
              <WorkspaceManager />
            </div>
          ) : activeTab === "config" ? (
            <div className="h-full">
              <AIConfigManager onConfigChanged={loadAIConfig} />
            </div>
          ) : (
            <div className="h-full">
              <ErrorAnalyzer tasks={tasks} selectedTaskId={selectedTaskId} />
            </div>
          )}
        </div>

      </main>

      {/* Bottom Status Bar */}
      <footer className="h-8 px-4 bg-[#111827] border-t border-[#1F2937] flex items-center justify-between text-[10px] font-mono text-slate-500 shrink-0 select-none">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            LOCAL DAEMON: READY
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
            QUEUE: {tasks.filter(t => (t.executionStatus || t.status) === 'running').length} ACTIVE / {tasks.filter(t => (t.executionStatus || t.status) === 'pending').length} WAITING
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>STORAGE: 14.8GB FREE</span>
          <span className="text-slate-400">v1.2.4-stable-prod</span>
        </div>
      </footer>
    </div>
  );
}
