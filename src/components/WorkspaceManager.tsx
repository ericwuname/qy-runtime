import React, { useEffect, useState } from "react";
import { 
  Folder, 
  FileText, 
  FolderPlus, 
  FilePlus, 
  Trash2, 
  RefreshCw, 
  Terminal, 
  ArrowRight, 
  Save, 
  Code2, 
  Eye, 
  X,
  Play
} from "lucide-react";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
  children?: FileNode[];
}

export default function WorkspaceManager() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  
  // File and folder creation
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null);

  // Terminal manual shell execution
  const [manualCommand, setManualCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [executingCmd, setExecutingCmd] = useState(false);

  // Cache cleaning state
  const [cleaning, setCleaning] = useState(false);
  const [cleanStats, setCleanStats] = useState<{ deletedCount: number; releasedBytes: number } | null>(null);

  const handleCleanCache = async () => {
    if (!confirm("确认要一键删除所有已完成/已失败任务关联的旧沙箱文件吗？此操作将安全释放系统存储空间，且不会影响任何正在执行的任务。")) return;
    setCleaning(true);
    setCleanStats(null);
    try {
      const res = await fetch("/api/workspace/clean-cache", {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        setCleanStats({
          deletedCount: data.deletedCount,
          releasedBytes: data.releasedBytes
        });
        fetchFiles();
        // Clear stats banner after 6 seconds
        setTimeout(() => setCleanStats(null), 6000);
      } else {
        alert("清理失败，请重试或查看系统后台。");
      }
    } catch (err) {
      console.error("Error cleaning cache:", err);
      alert("清理请求失败，无法连接到执行端服务器。");
    } finally {
      setCleaning(false);
    }
  };

  // Fetch file tree
  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace/files");
      const data = await res.json();
      if (Array.isArray(data)) {
        setFiles(data);
      }
    } catch (err) {
      console.error("Error fetching workspace files:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // Handle click on file
  const handleFileClick = async (path: string) => {
    try {
      const res = await fetch(`/api/workspace/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        setSelectedFilePath(path);
        setFileContent(data.content);
        setIsEditing(false);
        setSaveStatus("idle");
      }
    } catch (err) {
      console.error("Error reading file:", err);
    }
  };

  // Save modified file content
  const handleSaveFile = async () => {
    if (!selectedFilePath) return;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/workspace/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFilePath, content: fileContent })
      });
      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        fetchFiles();
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      setSaveStatus("error");
    }
  };

  // Delete file/folder
  const handleDeleteItem = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!confirm(`确认要彻底删除该项目吗? ${path}`)) return;
    try {
      const res = await fetch("/api/workspace/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path })
      });
      if (res.ok) {
        if (selectedFilePath === path) {
          setSelectedFilePath(null);
          setFileContent("");
        }
        fetchFiles();
      }
    } catch (err) {
      console.error("Error deleting item:", err);
    }
  };

  // Create new file or folder
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemType) return;

    const endpoint = newItemType === "file" ? "/api/workspace/write" : "/api/workspace/mkdir";
    const body = newItemType === "file" 
      ? { path: newItemName, content: "" }
      : { path: newItemName };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setNewItemName("");
        setNewItemType(null);
        fetchFiles();
      }
    } catch (err) {
      console.error("Error creating item:", err);
    }
  };

  // Execute manual terminal command
  const handleRunTerminal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCommand.trim()) return;
    setExecutingCmd(true);
    setTerminalOutput(prev => `${prev}\n$ ${manualCommand}\n[正在受限环境中执行...]`);
    try {
      const res = await fetch("/api/workspace/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: manualCommand })
      });
      const data = await res.json();
      
      let resultStr = "";
      if (data.error) {
        resultStr = data.stderr || "命令异常退出";
      } else {
        resultStr = `${data.stdout || ""}${data.stderr || ""}`;
      }
      setTerminalOutput(prev => `${prev.replace("[正在受限环境中执行...]", "")}${resultStr}\n`);
      setManualCommand("");
    } catch (err: any) {
      setTerminalOutput(prev => `${prev}\n执行引擎错误: ${err.message}\n`);
    } finally {
      setExecutingCmd(false);
    }
  };

  // Render file tree recursively
  const renderFileTree = (nodes: FileNode[]) => {
    if (nodes.length === 0) {
      return <div className="text-[11px] text-slate-600 pl-4 py-1">工作区目前为空</div>;
    }
    return (
      <ul className="space-y-1">
        {nodes.map((node) => (
          <li key={node.path} className="select-none">
            <div
              onClick={() => !node.isDirectory && handleFileClick(node.path)}
              className={`group flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                selectedFilePath === node.path
                  ? "bg-blue-600/10 border border-blue-500/20 text-blue-400 font-bold font-mono"
                  : "text-slate-300 hover:bg-[#111827]/45"
              }`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                {node.isDirectory ? (
                  <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                <span className="truncate" title={node.path}>{node.name}</span>
                {node.size !== undefined && (
                  <span className="text-[10px] text-slate-600 font-mono">
                    ({Math.round(node.size / 1024 * 10) / 10} KB)
                  </span>
                )}
              </div>
              <button
                onClick={(e) => handleDeleteItem(e, node.path)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-700 text-slate-500 hover:text-rose-400 rounded transition-all cursor-pointer"
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {node.isDirectory && node.children && (
              <div className="pl-4 border-l border-slate-800/60 ml-2 mt-0.5">
                {renderFileTree(node.children)}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full" id="workspace-manager-panel">
      {/* File Tree Explorer (Left Panel) */}
      <div className="lg:col-span-4 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded overflow-hidden shadow-xl">
        {/* Header */}
        <div className="p-3 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-400" />
            <h2 className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400">Sandbox Workspace (工作区)</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCleanCache}
              disabled={cleaning}
              title="清理所有已完成或已失败任务关联的旧沙箱文件"
              className="px-2 py-0.5 hover:bg-rose-950/20 text-rose-400 hover:text-rose-300 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors cursor-pointer flex items-center gap-1 text-[9px] uppercase font-mono font-bold border border-rose-500/10 hover:border-rose-500/30"
            >
              <Trash2 className={`w-3 h-3 text-rose-400 ${cleaning ? "animate-pulse" : ""}`} />
              <span>{cleaning ? "Cleaning..." : "Clean Cache"}</span>
            </button>
            <span className="text-slate-800 text-xs">|</span>
            <button
              onClick={fetchFiles}
              title="刷新文件"
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Create toolbar */}
        <div className="p-2 border-b border-[#1F2937] bg-[#0A0B0E]/30 flex gap-2">
          <button
            onClick={() => setNewItemType("file")}
            className="flex-1 py-1 px-2 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono font-bold uppercase text-slate-300 rounded flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5" />
            + File
          </button>
          <button
            onClick={() => setNewItemType("folder")}
            className="flex-1 py-1 px-2 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono font-bold uppercase text-slate-300 rounded flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            + Folder
          </button>
        </div>

        {/* Clean cache success statistics notice */}
        {cleanStats && (
          <div className="p-2.5 border-b border-[#1F2937] bg-emerald-950/20 text-emerald-400 text-[10px] font-mono leading-normal animate-in fade-in slide-in-from-top-1 duration-200 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>✨</span>
              <span>
                清理成功：删除了 <strong>{cleanStats.deletedCount}</strong> 个过期任务关联文件 
                ({Math.round(cleanStats.releasedBytes / 1024 * 10) / 10} KB 已释放)
              </span>
            </span>
            <button onClick={() => setCleanStats(null)} className="p-0.5 hover:bg-emerald-900/30 rounded text-emerald-500 hover:text-emerald-300 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Item Creator Form */}
        {newItemType && (
          <form onSubmit={handleCreateItem} className="p-2 border-b border-[#1F2937] bg-blue-600/10 flex gap-2 animate-in slide-in-from-top-2 duration-150">
            <input
              type="text"
              required
              placeholder={newItemType === "file" ? "e.g. src/app.js" : "e.g. src/utils"}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="flex-1 px-2 py-1 bg-[#0A0B0E] border border-[#1F2937] rounded text-slate-200 text-xs focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-mono font-bold uppercase cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setNewItemType(null)}
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        )}

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && files.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 animate-pulse">
              正在同步工作区文件树...
            </div>
          ) : (
            renderFileTree(files)
          )}
        </div>
      </div>

      {/* Code Editor & terminal console (Right Panel) */}
      <div className="lg:col-span-8 flex flex-col gap-4">
        {/* Code editor view */}
        <div className="flex-1 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded overflow-hidden shadow-xl min-h-[300px]">
          {/* Editor Header */}
          <div className="p-3 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-400" />
              <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400 truncate max-w-xs" title={selectedFilePath || ""}>
                {selectedFilePath ? `EDITING: ${selectedFilePath}` : "No file selected"}
              </span>
            </div>
            {selectedFilePath && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isEditing ? "Preview" : "Edit"}
                </button>
                {isEditing && (
                  <button
                    onClick={handleSaveFile}
                    disabled={saveStatus === "saving"}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-[10px] uppercase rounded flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saveStatus === "saving" ? "Saving..." : "Save"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Editor body */}
          <div className="flex-1 flex flex-col bg-[#020617] text-slate-300 overflow-hidden relative">
            {selectedFilePath ? (
              isEditing ? (
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-full p-3 font-mono text-xs bg-transparent text-slate-300 border-none outline-none focus:ring-0 resize-none leading-relaxed"
                />
              ) : (
                <pre className="w-full h-full p-3 font-mono text-xs overflow-auto select-text leading-relaxed whitespace-pre-wrap">
                  {fileContent || <span className="text-slate-600 italic">// Empty file</span>}
                </pre>
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-600 font-sans">
                <FileText className="w-8 h-8 mb-2 text-slate-700" />
                <p className="text-[10px] uppercase font-mono">Select a file from workspace to inspect or modify</p>
              </div>
            )}

            {/* Save Status banner */}
            {saveStatus === "saved" && (
              <div className="absolute top-3 right-3 bg-emerald-500 text-white text-[10px] font-mono font-bold uppercase px-2 py-1 rounded shadow-lg">
                File saved successfully
              </div>
            )}
            {saveStatus === "error" && (
              <div className="absolute top-3 right-3 bg-rose-500 text-white text-[10px] font-mono font-bold uppercase px-2 py-1 rounded shadow-lg">
                Save failed
              </div>
            )}
          </div>
        </div>

        {/* Terminal manual Console (Bottom Right Panel) */}
        <div className="bg-[#020617] border border-[#1F2937] rounded overflow-hidden shadow-xl h-[180px] flex flex-col">
          <div className="p-2 bg-[#111827] border-b border-[#1F2937] flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-slate-400 text-[10px] uppercase font-mono tracking-widest">
              Sandbox Manual Console (受限控制台)
            </h3>
          </div>
          
          {/* Terminal stream */}
          <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] text-slate-400 bg-black/70 space-y-1 select-text">
            {terminalOutput ? (
              <pre className="whitespace-pre-wrap">{terminalOutput}</pre>
            ) : (
              <p className="text-slate-600 text-[10px] leading-normal">
                # Input terminal commands to run inside sandbox, e.g., 'npm -v', 'ls -la', 'python3 --version'.<br />
                # System instructions enforce sandbox safety constraints. Traversal is strictly blocked.
              </p>
            )}
          </div>

          {/* Terminal Input Form */}
          <form onSubmit={handleRunTerminal} className="flex border-t border-[#1F2937]">
            <span className="p-2 bg-[#111827] text-blue-400 font-mono text-xs select-none flex items-center border-r border-[#1F2937]">
              $
            </span>
            <input
              type="text"
              disabled={executingCmd}
              placeholder="Type terminal command and press Enter..."
              value={manualCommand}
              onChange={(e) => setManualCommand(e.target.value)}
              className="flex-1 px-3 py-2 bg-[#020617]/40 text-emerald-400 font-mono text-xs border-none outline-none focus:ring-0 placeholder-slate-800"
            />
            <button
              type="submit"
              disabled={executingCmd}
              className="px-3 bg-[#111827] text-slate-300 hover:text-white border-l border-[#1F2937] flex items-center justify-center cursor-pointer transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current text-blue-400" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
