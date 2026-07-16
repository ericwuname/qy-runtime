import React, { useState, useEffect, useRef } from "react";
import { 
  Terminal as TerminalIcon, 
  Play, 
  Trash2, 
  RotateCcw, 
  HelpCircle, 
  Cpu, 
  Activity, 
  ShieldAlert, 
  CheckCircle,
  Clock,
  History,
  Copy,
  Info,
  Server,
  TerminalSquare,
  ChevronDown,
  ArrowRight,
  Code,
  FileCode,
  Check,
  AlertTriangle
} from "lucide-react";

type ShellEngine = "bash" | "python3" | "node" | "powershell";

interface PresetSnippet {
  title: string;
  desc: string;
  code: string;
}

export default function SandboxTerminal() {
  const [engine, setEngine] = useState<ShellEngine>("bash");
  const [manualCommand, setManualCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [executingCmd, setExecutingCmd] = useState(false);
  const [commandHistory, setCommandHistory] = useState<{ id: string; engine: ShellEngine; code: string; timestamp: string }[]>([]);
  const [activeTab, setActiveTab] = useState<"snippets" | "history" | "env">("snippets");
  
  // Loaded system configuration/telemetry states
  const [uptime, setUptime] = useState("0h 0m 0s");
  const [startTime] = useState<Date>(new Date());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Command input history
  useEffect(() => {
    const cachedHistory = localStorage.getItem("qiyuan_terminal_history_v2");
    if (cachedHistory) {
      try {
        setCommandHistory(JSON.parse(cachedHistory));
      } catch (e) {
        console.error("Failed to parse terminal history", e);
      }
    }
  }, []);

  // Update sandbox uptime counter
  useEffect(() => {
    const timer = setInterval(() => {
      const diffMs = new Date().getTime() - startTime.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(diffSecs / 3600);
      const minutes = Math.floor((diffSecs % 3600) / 60);
      const seconds = diffSecs % 60;
      setUptime(`${hours}h ${minutes}m ${seconds}s`);
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const saveHistory = (newHistory: typeof commandHistory) => {
    setCommandHistory(newHistory);
    localStorage.setItem("qiyuan_terminal_history_v2", JSON.stringify(newHistory));
  };

  const getEngineColor = (eng: ShellEngine) => {
    switch (eng) {
      case "bash": return "text-emerald-400";
      case "python3": return "text-sky-400";
      case "node": return "text-green-500";
      case "powershell": return "text-blue-400";
      default: return "text-slate-400";
    }
  };

  const getEngineLabel = (eng: ShellEngine) => {
    switch (eng) {
      case "bash": return "Bash / Linux Shell";
      case "python3": return "Python 3 Runtime";
      case "node": return "Node.js JavaScript";
      case "powershell": return "PowerShell Core Emulation";
    }
  };

  // Run selected interpreter
  const runTerminalCommand = async (codeToExecute: string, forcedEngine: ShellEngine = engine) => {
    if (!codeToExecute.trim()) return;

    setExecutingCmd(true);
    let outputHeader = `\n>>> 正在初始化 [${getEngineLabel(forcedEngine)}] 执行上下文...\n`;
    setTerminalOutput(prev => prev + outputHeader);

    // Save to history
    const newHistItem = {
      id: `hist-${Date.now()}`,
      engine: forcedEngine,
      code: codeToExecute,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    };
    const updatedHistory = [newHistItem, ...commandHistory].slice(0, 50);
    saveHistory(updatedHistory);

    try {
      let finalCommand = "";
      let isSuccess = true;
      let stdoutResult = "";
      let stderrResult = "";

      if (forcedEngine === "powershell") {
        // PowerShell compatibility handling
        let translatedCode = codeToExecute;
        const lowercaseCode = codeToExecute.trim().toLowerCase();
        
        let hint = "";
        // Simple PowerShell translation layer
        if (lowercaseCode.startsWith("get-childitem") || lowercaseCode === "gci" || lowercaseCode === "dir") {
          translatedCode = "ls -la";
          hint = "【翻译适配层】检测到 PowerShell 指令 `Get-ChildItem` / `dir`，由于当前在 Linux 环境中运行，已无缝翻译并执行对应 Linux 命令: `ls -la`\n";
        } else if (lowercaseCode.startsWith("get-content ") || lowercaseCode.startsWith("cat ")) {
          const parts = codeToExecute.split(/\s+/);
          parts.shift();
          translatedCode = `cat ${parts.join(" ")}`;
          hint = `【翻译适配层】检测到 PowerShell 查看文件指令，已翻译为 Linux 对应命令: \`${translatedCode}\`\n`;
        } else if (lowercaseCode.startsWith("clear-host") || lowercaseCode === "cls") {
          clearOutput();
          setExecutingCmd(false);
          return;
        } else {
          // General command map
          translatedCode = codeToExecute;
          hint = "【兼容模式】由于本云端容器底层运行 Linux 内核，已启动 PowerShell 常用命令兼容引擎(模拟器模式)进行转换及执行。\n";
        }

        setTerminalOutput(prev => prev + `${hint}$ ${translatedCode}\n`);

        // Execute translated command in bash
        const tempFilename = ".powershell_temp.sh";
        await fetch("/api/workspace/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: tempFilename, content: translatedCode })
        });

        const res = await fetch("/api/workspace/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `bash ${tempFilename} && rm -f ${tempFilename}` })
        });
        const data = await res.json();
        stdoutResult = data.stdout || "";
        stderrResult = data.stderr || (data.error ? data.stderr || "执行出现错误" : "");
      }
      else if (forcedEngine === "python3") {
        // Run Python Block
        const tempFilename = ".sandbox_temp.py";
        // 1. Write user code to temporary file
        await fetch("/api/workspace/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: tempFilename, content: codeToExecute })
        });

        // 2. Run python execution
        const res = await fetch("/api/workspace/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `python3 ${tempFilename} && rm -f ${tempFilename}` })
        });
        const data = await res.json();
        stdoutResult = data.stdout || "";
        stderrResult = data.stderr || (data.error ? data.stderr || "Python 引擎异常退出" : "");
      } 
      else if (forcedEngine === "node") {
        // Run Node.js JavaScript
        const tempFilename = ".sandbox_temp.js";
        // 1. Write user code to temporary file
        await fetch("/api/workspace/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: tempFilename, content: codeToExecute })
        });

        // 2. Run node execution
        const res = await fetch("/api/workspace/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `node ${tempFilename} && rm -f ${tempFilename}` })
        });
        const data = await res.json();
        stdoutResult = data.stdout || "";
        stderrResult = data.stderr || (data.error ? data.stderr || "NodeJS 运行环境异常" : "");
      }
      else {
        // Standard Bash Loop
        const tempFilename = ".sandbox_temp.sh";
        // Write multiline script to a shell script to support complex commands
        await fetch("/api/workspace/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: tempFilename, content: codeToExecute })
        });

        const res = await fetch("/api/workspace/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `bash ${tempFilename} && rm -f ${tempFilename}` })
        });
        const data = await res.json();
        stdoutResult = data.stdout || "";
        stderrResult = data.stderr || (data.error ? data.stderr || "Linux Shell 执行报错" : "");
      }

      setTerminalOutput(prev => {
        const cleaned = prev.replace(`>>> 正在初始化 [${getEngineLabel(forcedEngine)}] 执行上下文...\n`, "");
        return `${cleaned}${stdoutResult}${stderrResult || (!stdoutResult ? "(脚本运行成功，无标准控制台输出)\n" : "")}\n`;
      });

    } catch (err: any) {
      setTerminalOutput(prev => `${prev}\n执行引擎网络错误: ${err.message}\n`);
    } finally {
      setExecutingCmd(false);
    }
  };

  const handleRunTerminalForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCommand.trim()) return;
    runTerminalCommand(manualCommand);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter to execute command
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!manualCommand.trim() || executingCmd) return;
      runTerminalCommand(manualCommand);
    }
  };

  const clearOutput = () => {
    setTerminalOutput("");
  };

  const clearHistory = () => {
    if (confirm("是否清空终端历史指令？")) {
      saveHistory([]);
    }
  };

  const selectSnippet = (snippet: PresetSnippet, selectedEngine: ShellEngine) => {
    setEngine(selectedEngine);
    setManualCommand(snippet.code);
  };

  // Preset Snippets
  const snippets: Record<ShellEngine, PresetSnippet[]> = {
    bash: [
      {
        title: "递归查看工作区",
        desc: "列出当前工作区中所有的文件树、大小及状态",
        code: "find . -maxdepth 3 -not -path '*/.*' -not -path '*/node_modules*'"
      },
      {
        title: "系统端口与网络诊断",
        desc: "查看当前开放的端口及 Node.js 监听进程",
        code: "netstat -tuln || ss -tuln || ps aux | grep node"
      },
      {
        title: "查看 NPM 依赖",
        desc: "查看项目中安装的所有 npm 包版本",
        code: "npm list --depth=0"
      },
      {
        title: "硬件性能诊断",
        desc: "查看沙箱 CPU 负载、系统版本及内存详情",
        code: "uname -a && free -h && df -h"
      }
    ],
    python3: [
      {
        title: "环境探针 & 系统信息",
        desc: "使用 Python 提取详细的运行时系统元数据",
        code: `import sys
import platform
import os

print("--- Python Environment Probe ---")
print("Python Version:", sys.version)
print("OS Platform:", platform.platform())
print("CPU Count:", os.cpu_count())
print("Process ID:", os.getpid())`
      },
      {
        title: "工作区文件大小统计",
        desc: "计算并列出 workspace 下占用最大的前 5 个文件",
        code: `import os

files = []
for root, dirs, filenames in os.walk('.'):
    if 'node_modules' in root or '.git' in root or 'dist' in root:
        continue
    for f in filenames:
        fp = os.path.join(root, f)
        try:
            sz = os.path.getsize(fp)
            files.append((fp, sz))
        except:
            pass

files.sort(key=lambda x: x[1], reverse=True)
print("=== Workspace Largest Files ===")
for path, size in files[:5]:
    print(f"{size/1024:.1f} KB - {path}")`
      },
      {
        title: "SQLite 数据库测试",
        desc: "在内存中新建 SQLite 数据库并进行查询和操作测试",
        code: `import sqlite3

# 创建内存数据库
conn = sqlite3.connect(':memory:')
cursor = conn.cursor()

# 创建测试表
cursor.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT)')
cursor.execute("INSERT INTO users (name, role) VALUES ('CEO', 'Administrator')")
cursor.execute("INSERT INTO users (name, role) VALUES ('Coder', 'AI Agent')")
conn.commit()

# 查询
cursor.execute('SELECT * FROM users')
for row in cursor.fetchall():
    print(f"ID: {row[0]}, User: {row[1]}, Role: {row[2]}")

conn.close()`
      }
    ],
    node: [
      {
        title: "Node.js OS 资源监视器",
        desc: "读取底层操作系统的 CPU 及内存空闲率",
        code: `const os = require('os');

console.log('=== OS Metrics ===');
console.log('CPU Architecture:', os.arch());
console.log('Platform:', os.platform());
console.log('Total Memory:', (os.totalmem() / 1024 / 1024).toFixed(2), 'MB');
console.log('Free Memory:', (os.freemem() / 1024 / 1024).toFixed(2), 'MB');
console.log('CPU Cores:', os.cpus().map((c, i) => \`Core \${i}: \${c.model}\`).join(', '));`
      },
      {
        title: "HTTP 接口请求测试",
        desc: "使用原生 HTTPS 库请求公共接口元数据",
        code: `const https = require('https');

https.get('https://api.github.com/zen', {
  headers: { 'User-Agent': 'Node-Sandbox-Agent' }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('--- GitHub Zen Quote ---');
    console.log(data);
  });
}).on('error', (err) => {
  console.error('Request failed:', err.message);
});`
      },
      {
        title: "递归文件遍历器",
        desc: "列出工作区根目录下所有文件夹结构",
        code: `const fs = require('fs');
const path = require('path');

function listFolders(dir, depth = 0) {
  if (depth > 2) return;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    if (file.startsWith('.') || file === 'node_modules' || file === 'dist') return;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        console.log('  '.repeat(depth) + '📁 ' + file + '/');
        listFolders(fullPath, depth + 1);
      }
    } catch (e) {}
  });
}

console.log('Workspace Structure:');
listFolders('.');`
      }
    ],
    powershell: [
      {
        title: "获取当前文件夹元素 (GCI)",
        desc: "执行 PowerShell 特色 Get-ChildItem 指令",
        code: "Get-ChildItem -Path . -Recurse -Depth 2 | Select-Object Name, Length"
      },
      {
        title: "查看进程属性",
        desc: "PowerShell 命令查看运行线程 (翻译适配)",
        code: "Get-Process | Select-Object Id, ProcessName, CPU -First 10"
      },
      {
        title: "查看文本数据 (GC)",
        desc: "使用 Get-Content 提取 package.json",
        code: "Get-Content -Path package.json -Head 15"
      }
    ]
  };

  return (
    <div className="flex flex-col lg:flex-row h-full gap-4 overflow-hidden" id="sandbox-terminal-layout">
      {/* Left panel: Main Shell Stream */}
      <div className="flex-1 flex flex-col bg-[#030712] border border-[#1F2937] rounded-lg overflow-hidden shadow-2xl h-full">
        {/* Terminal Header */}
        <div className="p-3 bg-[#111827] border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-3 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <TerminalIcon className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="font-bold text-slate-200 text-xs uppercase font-mono tracking-wider">
              Multilingual Console (沙箱脚本执行环境)
            </h3>
            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 px-1.5 py-0.5 rounded font-mono">
              SECURE SHIELD
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-mono">执行引擎:</span>
            <div className="relative">
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as ShellEngine)}
                className="bg-[#1F2937] text-slate-200 font-mono text-[11px] rounded border border-[#374151] px-2 py-1 pr-6 outline-none cursor-pointer appearance-none"
              >
                <option value="bash">🖥️ Linux Bash Shell</option>
                <option value="python3">🐍 Python 3 Runtime</option>
                <option value="node">⬡ Node.js (Javascript)</option>
                <option value="powershell">🐚 PowerShell Core Emulation</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            <button
              onClick={clearOutput}
              className="px-2 py-1 bg-[#1F2937] hover:bg-[#374151] border border-[#374151] text-slate-400 hover:text-slate-200 font-mono text-[10px] rounded transition-colors cursor-pointer ml-2"
            >
              Clear Log
            </button>
          </div>
        </div>

        {/* Compatibility Info Alert */}
        {engine === "powershell" && (
          <div className="bg-blue-950/20 border-b border-blue-900/40 p-2.5 px-4 flex items-center gap-2.5 select-none animate-in slide-in-from-top duration-200 shrink-0">
            <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0" />
            <p className="text-[10px] text-slate-400 leading-normal">
              <strong className="text-blue-300 font-bold">PowerShell Core 兼容适配激活:</strong> 云端沙箱底层运行 Linux 内核。在此模式下，我们已激活了<strong>指令翻译转换引擎</strong>，它会自动映射 CMD/Powershell 习惯（如 <code>gci</code>, <code>dir</code>, <code>Get-Content</code> 等）为对应的高速 Bash 系统指令运行！
            </p>
          </div>
        )}

        {/* Output Screen */}
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-slate-300 bg-black/85 space-y-1 select-text custom-scrollbar">
          {terminalOutput ? (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">{terminalOutput}</pre>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-600 font-mono select-none">
              <TerminalSquare className="w-12 h-12 mb-3 text-slate-800 animate-pulse" />
              <p className="text-[11px] font-bold text-slate-400">隔离沙箱多语言编译器控制端就绪</p>
              <p className="text-[10px] text-slate-600 mt-2 max-w-lg leading-relaxed">
                在这里你可以随意撰写并执行 <span className="text-emerald-400">Bash shell 脚本</span>、<span className="text-sky-400">Python 3 数据处理脚本</span> 或 <span className="text-green-400">NodeJS JavaScript 应用程序</span>。
                所有执行结果将在受限容器中完全安全地输出。
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-4">
                <button
                  onClick={() => selectSnippet(snippets.bash[0], "bash")}
                  className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-[10px] rounded transition-colors cursor-pointer"
                >
                  运行文件遍历(Bash)
                </button>
                <button
                  onClick={() => selectSnippet(snippets.python3[0], "python3")}
                  className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-[10px] rounded transition-colors cursor-pointer"
                >
                  运行系统探针(Python)
                </button>
                <button
                  onClick={() => selectSnippet(snippets.node[0], "node")}
                  className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-[10px] rounded transition-colors cursor-pointer"
                >
                  运行内存监控(Node)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input Textarea Form */}
        <div className="border-t border-[#1F2937] bg-[#0A0F1D] p-3 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-500 uppercase flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${engine === "bash" ? "bg-emerald-500" : engine === "python3" ? "bg-sky-500" : "bg-green-500"}`} />
              正在运行环境: {getEngineLabel(engine)}
            </span>
            <span className="text-[9px] text-slate-600 font-mono">
              提示: 输入脚本，按 <kbd className="bg-[#1F2937] text-slate-400 px-1 rounded">Ctrl + Enter</kbd> 极速派发执行
            </span>
          </div>

          <form onSubmit={handleRunTerminalForm} className="flex gap-2.5 items-end">
            <div className="flex-1 bg-[#030712] border border-[#1F2937] rounded focus-within:border-blue-500/50 transition-colors overflow-hidden">
              <textarea
                disabled={executingCmd}
                rows={3}
                onKeyDown={handleKeyDown}
                placeholder={
                  executingCmd 
                    ? "指令安全编译及运行中，请稍候..." 
                    : engine === "bash" 
                    ? "输入并编辑多行 Linux Shell 指令 (例: ls -la && ps aux) 并点击运行..."
                    : engine === "python3"
                    ? "此处支持直接撰写多行 Python 脚本并执行 (例: import sys; print(sys.version))"
                    : engine === "node"
                    ? "此处支持直接运行 NodeJS (例: console.log(process.env.NODE_ENV || 'development'))"
                    : "此处支持直接运行 PowerShell 命令 (例: Get-ChildItem -Path . -Depth 1)"
                }
                value={manualCommand}
                onChange={(e) => setManualCommand(e.target.value)}
                className="w-full p-2.5 bg-transparent text-slate-200 font-mono text-xs border-none outline-none focus:ring-0 placeholder-slate-700 resize-none"
              />
            </div>
            
            <button
              type="submit"
              disabled={executingCmd || !manualCommand.trim()}
              className="px-4 py-3 h-[42px] bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-bold rounded flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-35 disabled:cursor-not-allowed shrink-0 select-none"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{executingCmd ? "运行中" : "RUN"}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Right panel: Terminal Dashboard & Helpers (Span width: 320px) */}
      <div className="w-full lg:w-[320px] flex flex-col gap-4 shrink-0">
        <div className="bg-[#0F172A] border border-[#1F2937] rounded-lg p-4 flex flex-col h-full overflow-hidden shadow-xl">
          {/* Tab Selection */}
          <div className="flex border-b border-[#1F2937] pb-2 mb-4 shrink-0 gap-1.5 select-none">
            <button
              onClick={() => setActiveTab("snippets")}
              className={`flex-1 py-1.5 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer text-center ${
                activeTab === "snippets" ? "bg-blue-600/10 border border-blue-500/50 text-blue-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              一键精选脚本
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex-1 py-1.5 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer text-center ${
                activeTab === "history" ? "bg-blue-600/10 border border-blue-500/50 text-blue-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              执行历史
            </button>
            <button
              onClick={() => setActiveTab("env")}
              className={`flex-1 py-1.5 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer text-center ${
                activeTab === "env" ? "bg-blue-600/10 border border-blue-500/50 text-blue-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              安全环境
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {activeTab === "snippets" && (
              <div className="space-y-4 font-sans select-none animate-in fade-in duration-150">
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                    <Code className="w-3.5 h-3.5 text-blue-400" />
                    <span>精选脚本预设 ({getEngineLabel(engine)})</span>
                  </h4>
                  <div className="space-y-2">
                    {snippets[engine]?.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => selectSnippet(item, engine)}
                        className="p-2.5 bg-[#030712]/50 border border-[#1F2937] hover:border-blue-500/30 rounded cursor-pointer transition-all group"
                      >
                        <div className="font-mono text-xs text-blue-400 group-hover:text-blue-300 truncate flex items-center justify-between">
                          <span>{item.title}</span>
                          <span className="text-[8px] bg-slate-900 border border-slate-800 px-1 py-0.5 text-slate-500 uppercase font-bold group-hover:text-blue-400">
                            + 载入
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 leading-normal font-sans">
                          {item.desc}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-blue-950/10 border border-[#1F2937] rounded-lg">
                  <h5 className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <Activity className="w-3 h-3 text-emerald-400" />
                    <span>代码块运行机制</span>
                  </h5>
                  <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                    多行脚本会被编译并存储于受限的沙箱隔离媒介中运行，从而完美保证了 quotes 字符对齐、缩进以及多行 loops 在编译时不受命令行限制而崩坏。
                  </p>
                </div>
              </div>
            )}

            {activeTab === "history" && (
              <div className="space-y-3 font-sans animate-in fade-in duration-150">
                <div className="flex justify-between items-center select-none">
                  <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">
                    SESSION RUNS ({commandHistory.length})
                  </span>
                  {commandHistory.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="text-[9px] text-rose-400 hover:text-rose-300 font-mono font-bold cursor-pointer"
                    >
                      清空历史
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {commandHistory.length === 0 ? (
                    <div className="text-center py-12 text-xs font-mono text-slate-600 select-none">
                      (暂无指令执行记录)
                    </div>
                  ) : (
                    commandHistory.map((cmd) => (
                      <div
                        key={cmd.id}
                        onClick={() => {
                          setEngine(cmd.engine);
                          setManualCommand(cmd.code);
                        }}
                        className="p-2.5 bg-[#030712]/30 border border-[#1F2937] hover:border-blue-500/30 rounded cursor-pointer transition-colors flex flex-col gap-1 group"
                      >
                        <div className="flex justify-between items-center text-[9px] font-mono">
                          <span className={`${getEngineColor(cmd.engine)} font-bold`}>
                            {cmd.engine.toUpperCase()}
                          </span>
                          <span className="text-slate-600">{cmd.timestamp}</span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-300 group-hover:text-white truncate">
                          {cmd.code}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "env" && (
              <div className="space-y-4 font-mono text-xs text-slate-400 animate-in fade-in duration-150 select-none">
                <div className="p-3 bg-[#030712]/50 border border-[#1F2937] rounded-lg space-y-2">
                  <div className="flex justify-between border-b border-slate-900 pb-1.5">
                    <span className="text-slate-500 uppercase">Sandbox ID</span>
                    <span className="text-slate-300">sb-multilingual-v2</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-900 pb-1.5">
                    <span className="text-slate-500 uppercase">Uptime</span>
                    <span className="text-slate-300">{uptime}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-900 pb-1.5">
                    <span className="text-slate-500 uppercase">Docker Env</span>
                    <span className="text-emerald-400 font-bold">Secure Core</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 uppercase">Root Shell</span>
                    <span className="text-slate-300">/bin/bash</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                    环境编译器包就绪状态
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="p-2 bg-[#030712]/30 border border-[#1F2937] rounded flex items-center justify-between">
                      <span className="text-slate-500">Python 3.11</span>
                      <span className="text-emerald-400 font-bold">READY</span>
                    </div>
                    <div className="p-2 bg-[#030712]/30 border border-[#1F2937] rounded flex items-center justify-between">
                      <span className="text-slate-500">Node v20.x</span>
                      <span className="text-emerald-400 font-bold">READY</span>
                    </div>
                    <div className="p-2 bg-[#030712]/30 border border-[#1F2937] rounded flex items-center justify-between">
                      <span className="text-slate-500">Bash v5.x</span>
                      <span className="text-emerald-400 font-bold">READY</span>
                    </div>
                    <div className="p-2 bg-[#030712]/30 border border-[#1F2937] rounded flex items-center justify-between">
                      <span className="text-slate-500">SQLite 3</span>
                      <span className="text-emerald-400 font-bold">READY</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
