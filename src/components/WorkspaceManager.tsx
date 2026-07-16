import React, { useEffect, useState, useRef } from "react";
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
  Play,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Search,
  MessageSquare,
  FileCode,
  Activity,
  Check,
  Cpu,
  CornerDownLeft,
  Settings,
  HelpCircle,
  Image as ImageIcon,
  Copy,
  RotateCcw,
  History,
  ShieldAlert
} from "lucide-react";
import Markdown from "react-markdown";

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
  const [originalContent, setOriginalContent] = useState<string>(""); // Used to track unsaved edits
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Custom dialog modal state
  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: "confirm" | "alert";
    title: string;
    message: string;
    onConfirm?: () => void;
  } | null>(null);

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({
      isOpen: true,
      type: "confirm",
      title,
      message,
      onConfirm
    });
  };

  const showAlert = (title: string, message: string) => {
    setModal({
      isOpen: true,
      type: "alert",
      title,
      message
    });
  };
  
  // File tree states
  const [treeViewMode, setTreeViewMode] = useState<"core" | "test" | "trash">("core");
  const [trashItems, setTrashItems] = useState<any[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);

  const fetchTrash = async () => {
    setTrashLoading(true);
    try {
      const res = await fetch("/api/workspace/trash");
      if (res.ok) {
        const data = await res.json();
        setTrashItems(data);
      }
    } catch (err) {
      console.error("Error fetching trash items:", err);
    } finally {
      setTrashLoading(false);
    }
  };

  const handleRestoreTrashItem = async (id: string) => {
    try {
      const res = await fetch("/api/workspace/trash/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        fetchTrash();
        fetchFiles();
      } else {
        const data = await res.json();
        showAlert("还原失败", data.error || "还原失败");
      }
    } catch (err) {
      console.error("Restore error:", err);
    }
  };

  const handlePermanentDeleteTrashItem = (id: string) => {
    showConfirm(
      "⚠️ 彻底删除此项将无法再次恢复！",
      "确定要永久彻底删除它吗？此操作不可逆。",
      async () => {
        try {
          const res = await fetch("/api/workspace/trash/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
          });
          if (res.ok) {
            fetchTrash();
          }
        } catch (err) {
          console.error("Permanent delete error:", err);
        }
      }
    );
  };

  const handleEmptyTrash = () => {
    showConfirm(
      "🛑 完全清空回收站",
      "确定要完全清空回收站吗？清空后，所有已暂存的项目都将被永久删除且无法恢复！",
      async () => {
        try {
          const res = await fetch("/api/workspace/trash/empty", {
            method: "POST"
          });
          if (res.ok) {
            fetchTrash();
          }
        } catch (err) {
          console.error("Empty trash error:", err);
        }
      }
    );
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null);

  // Multi-file & Project scope states
  const [selectedProjectFiles, setSelectedProjectFiles] = useState<string[]>([]);
  const [aiScope, setAiScope] = useState<"single" | "project" | "global">("single");

  // Helper to get recursive files under a folder node
  const getAllFilePathsUnderNode = (node: FileNode): string[] => {
    let results: string[] = [];
    if (!node.isDirectory) {
      results.push(node.path);
    } else if (node.children) {
      for (const child of node.children) {
        results = results.concat(getAllFilePathsUnderNode(child));
      }
    }
    return results;
  };

  // Copilot Panel states
  const [showAiPanel, setShowAiPanel] = useState(true);
  const [activeTab, setActiveTab] = useState<"ai" | "template">("ai");
  const [aiResponse, setAiResponse] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  // Persistent Chat Sessions states
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(true); // Default to true to show history immediately!
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom of the chat pane is disabled per user request to prevent unexpected jumps.

  const fetchSessions = async (selectLatest = false) => {
    try {
      const res = await fetch("/api/workspace/chat-sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
        if (selectLatest && data.length > 0) {
          setCurrentSessionId(data[0].id);
          if (data[0].scope) {
            setAiScope(data[0].scope);
          }
        } else if (selectLatest && data.length === 0) {
          // Auto create a first global session on startup so the user is immediately ready to type!
          handleCreateSession("global");
        }
      }
    } catch (err) {
      console.error("Error fetching chat sessions:", err);
    }
  };

  const handleCreateSession = async (scopeOverride?: "single" | "project" | "global") => {
    try {
      const res = await fetch("/api/workspace/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "新对话",
          scope: scopeOverride || aiScope,
          selectedFilePath: selectedFilePath,
          selectedProjectFiles: selectedProjectFiles
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(prev => [data, ...prev]);
        setCurrentSessionId(data.id);
        setAiResponse("");
        setAiError(null);
        if (data.scope) {
          setAiScope(data.scope);
        }
        return data.id;
      }
    } catch (err) {
      console.error("Error creating session:", err);
    }
    return null;
  };

  // Sync scope changes from frontend selection to active backend session
  useEffect(() => {
    if (currentSessionId) {
      const activeSession = sessions.find(s => s.id === currentSessionId);
      if (activeSession && activeSession.scope !== aiScope) {
        fetch(`/api/workspace/chat-sessions/${currentSessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: aiScope })
        }).then(res => {
          if (res.ok) {
            res.json().then(updated => {
              setSessions(prev => prev.map(s => s.id === currentSessionId ? updated : s));
            });
          }
        });
      }
    }
  }, [aiScope, currentSessionId]);

  const handleRenameSession = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`/api/workspace/chat-sessions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        const updated = await res.json();
        setSessions(prev => prev.map(s => s.id === id ? updated : s));
        setEditingSessionId(null);
      }
    } catch (err) {
      console.error("Error renaming session:", err);
    }
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirm(
      "确认删除对话",
      "确定要删除这条对话历史吗？删除后内容无法恢复。",
      async () => {
        try {
          const res = await fetch(`/api/workspace/chat-sessions/${id}`, {
            method: "DELETE"
          });
          if (res.ok) {
            setSessions(prev => prev.filter(s => s.id !== id));
            if (currentSessionId === id) {
              setCurrentSessionId(null);
            }
          }
        } catch (err) {
          console.error("Error deleting session:", err);
        }
      }
    );
  };

  // Terminal manual shell execution
  const [manualCommand, setManualCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [executingCmd, setExecutingCmd] = useState(false);

  // Cache cleaning state
  const [cleaning, setCleaning] = useState(false);
  const [cleanStats, setCleanStats] = useState<{ deletedCount: number; releasedBytes: number } | null>(null);

  const handleCleanCache = () => {
    showConfirm(
      "🧪 一键清理测试沙箱区域",
      "此操作将安全清空 test_zone 目录下的所有临时文件并暂存到历史回收站中，不仅保障核心开发代码 100% 安全，还能随时在回收站中完美自愈恢复！",
      async () => {
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
            fetchTrash(); // Auto refresh trash list to reflect newly recycled files
            setTimeout(() => setCleanStats(null), 6000);
          } else {
            showAlert("清理失败", "清理失败，请重试或查看系统后台。");
          }
        } catch (err) {
          console.error("Error cleaning cache:", err);
          showAlert("连接失败", "清理请求失败，无法连接到执行端服务器。");
        } finally {
          setCleaning(false);
        }
      }
    );
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
    fetchTrash();
    fetchSessions(true);
  }, [treeViewMode]);

  // Handle click on file
  const handleFileClick = async (path: string) => {
    try {
      const res = await fetch(`/api/workspace/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        setSelectedFilePath(path);
        setFileContent(data.content);
        setOriginalContent(data.content); // Track original to compare
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
        setOriginalContent(fileContent); // Mark as clean (saved)
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
  const handleDeleteItem = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const isTestFile = path.startsWith("test_zone/") || path === "test_zone";
    const confirmTitle = isTestFile ? "确认移入回收站" : "⚠️ 警告：正在删除核心文件！";
    const confirmMessage = isTestFile 
      ? `确认要将测试文件移入历史回收站吗？\n\n路径: ${path}`
      : `该操作虽然会将文件安全移入历史回收站，但可能导致当前项目架构或运行中断。\n\n确认要回收此核心开发文件吗？\n路径: ${path}`;
    
    showConfirm(
      confirmTitle,
      confirmMessage,
      async () => {
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
              setOriginalContent("");
            }
            fetchFiles();
            if (treeViewMode === "trash") {
              fetchTrash();
            }
          } else {
            const data = await res.json();
            showAlert("删除失败", data.error || "删除失败");
          }
        } catch (err) {
          console.error("Error deleting item:", err);
        }
      }
    );
  };

  // Create new file or folder
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemType) return;

    // Auto-prefix with test_zone if active tab is Test Zone
    const targetPath = treeViewMode === "test"
      ? (newItemName.startsWith("test_zone/") ? newItemName : `test_zone/${newItemName}`)
      : newItemName;

    const endpoint = newItemType === "file" ? "/api/workspace/write" : "/api/workspace/mkdir";
    const body = newItemType === "file" 
      ? { path: targetPath, content: "" }
      : { path: targetPath };

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
        if (newItemType === "file") {
          handleFileClick(targetPath);
        }
      } else {
        const data = await res.json();
        showAlert("创建失败", data.error || "创建失败");
      }
    } catch (err) {
      console.error("Error creating item:", err);
    }
  };

  // Execute terminal command
  const runTerminalCommand = async (commandToExecute: string) => {
    if (!commandToExecute.trim()) return;
    setExecutingCmd(true);
    setTerminalOutput(prev => `${prev}\n$ ${commandToExecute}\n[正在受限环境中执行...]`);
    try {
      const res = await fetch("/api/workspace/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandToExecute })
      });
      const data = await res.json();
      
      let resultStr = "";
      if (data.error) {
        resultStr = data.stderr || "命令异常退出";
      } else {
        resultStr = `${data.stdout || ""}${data.stderr || ""}`;
      }
      setTerminalOutput(prev => `${prev.replace("[正在受限环境中执行...]", "")}${resultStr}\n`);
    } catch (err: any) {
      setTerminalOutput(prev => `${prev}\n执行引擎错误: ${err.message}\n`);
    } finally {
      setExecutingCmd(false);
    }
  };

  const handleRunTerminalForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCommand.trim()) return;
    runTerminalCommand(manualCommand);
    setManualCommand("");
  };

  // Helper to check file types
  const getFileExtension = (filePath: string | null) => {
    if (!filePath) return "";
    return filePath.split(".").pop()?.toLowerCase() || "";
  };

  const isImageFile = (filePath: string | null) => {
    const ext = getFileExtension(filePath);
    return ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext);
  };

  const isMarkdownFile = (filePath: string | null) => {
    const ext = getFileExtension(filePath);
    return ext === "md" || ext === "markdown";
  };

  const isJsonFile = (filePath: string | null) => {
    const ext = getFileExtension(filePath);
    return ext === "json";
  };

  // AI assistant handlers
  const handleCallAiCopilot = async (action: "explain" | "optimize" | "fix-bugs" | "data-summary" | "custom") => {
    if (aiScope === "single" && !selectedFilePath) {
      showAlert("提示", "请先在左侧文件树选择一个激活文件，或者切换到【项目级分析】。");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiResponse("");

    try {
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = await handleCreateSession();
      }
      if (!sessionId) {
        throw new Error("无法创建或定位有效的对话会话");
      }

      const body: any = {
        prompt: action === "custom" ? customPrompt : "",
        action
      };

      const res = await fetch(`/api/workspace/chat-sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.session) {
          setSessions(prev => prev.map(s => s.id === sessionId ? data.session : s));
          setAiResponse(data.response);
          if (action === "custom") {
            setCustomPrompt("");
          }
        } else {
          setAiError(data.error || "智能体服务返回异常。");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setAiError(errData.error || `请求错误 (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setAiError(err.message || "请求发送失败，无法连接到 AI 协同服务器。");
    } finally {
      setAiLoading(false);
      fetchSessions();
      fetchFiles(); // Auto-refresh file tree to instantly display newly created/modified files
    }
  };

  // Extract first markdown code block for code healing
  const extractCodeFromMarkdown = (markdown: string) => {
    const regex = /```(?:[a-zA-Z0-9_\-+]+)?\n([\s\S]*?)\n```/;
    const match = markdown.match(regex);
    return match ? match[1] : null;
  };

  const handleApplyAiSuggestion = () => {
    const code = extractCodeFromMarkdown(aiResponse);
    if (!code) return;
    setFileContent(code);
    setIsEditing(true);
    showAlert("成功", "✨ 成功！已将 AI 优化/修复后的完整代码载入编辑器。请在核对无误后点击顶部的【Save】进行保存。");
  };

  // Code templates
  const templates = [
    {
      name: "Python 简易网页爬虫",
      filename: "crawler_demo.py",
      description: "一键请求基础网页，并通过 HTML 标签提炼信息",
      content: `import requests
from bs4 import BeautifulSoup

def main():
    print("[INFO] 开始运行 Python 网页数据提取脚本...")
    url = "https://news.ycombinator.com/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        print(f"[INFO] 请求成功, 状态码: {response.status_code}")
        
        # 简单提取新闻标题
        soup = BeautifulSoup(response.text, "html.parser")
        titles = soup.select(".titleline > a")[:5]
        
        print("\n=== HN 热门标题 Top 5 ===")
        for idx, item in enumerate(titles, 1):
            print(f"{idx}. {item.text} ({item['href']})")
            
    except Exception as e:
        print(f"[ERROR] 爬取失败: {e}")

if __name__ == "__main__":
    main()
`
    },
    {
      name: "Python 数据统计分析",
      filename: "data_analyzer.py",
      description: "读取或模拟多维度指标，进行数值聚合与指标计算",
      content: `import json
import os

def main():
    print("[INFO] 载入模拟数据，开始运行聚合算法...")
    mock_data = [
        {"item": "A", "price": 12.5, "sales": 100, "category": "电子"},
        {"item": "B", "price": 45.0, "sales": 20, "category": "服装"},
        {"item": "C", "price": 8.0, "sales": 340, "category": "生活"},
        {"item": "D", "price": 120.0, "sales": 15, "category": "电子"},
        {"item": "E", "price": 32.5, "sales": 80, "category": "生活"}
    ]
    
    print(f"[INFO] 成功导入 {len(mock_data)} 条指标记录，开始统计分析：")
    
    # 1. 计算总销售额
    total_revenue = sum(x["price"] * x["sales"] for x in mock_data)
    print(f"-> 模拟总销售额: {total_revenue} 元")
    
    # 2. 分类汇总
    category_summary = {}
    for x in mock_data:
        cat = x["category"]
        category_summary[cat] = category_summary.get(cat, 0) + (x["price"] * x["sales"])
        
    print("\n=== 分类汇总报告 ===")
    for cat, rev in category_summary.items():
        print(f"- {cat} 类别: {rev} 元")
        
    # 保存分析报表到本地
    output_path = "analysis_result.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"total_revenue": total_revenue, "by_category": category_summary}, f, indent=4, ensure_ascii=False)
    print(f"\n[SUCCESS] 分析报告已成功固化保存至本地: '{output_path}'")

if __name__ == "__main__":
    main()
`
    },
    {
      name: "JS 沙箱文件过滤器",
      filename: "file_filter.js",
      description: "快速检索、过滤非结构化字符串，并写入文本",
      content: `// Node.js 沙箱工作区提取解析器
const fs = require('fs');
const path = require('path');

function run() {
  console.log("[INFO] 启动 JavaScript 工作区日志分析流...");
  const logData = [
    "2026-07-15 10:00:01 [INFO] Agent started successfully",
    "2026-07-15 10:01:23 [WARNING] High response latency detected (1.2s)",
    "2026-07-15 10:03:45 [ERROR] Connection lost, retrying in 5s",
    "2026-07-15 10:04:10 [INFO] Reconnected, execution restored"
  ];
  
  // 过滤出 ERROR 和 WARNING 级别的严重日志
  const severeLogs = logData.filter(line => line.includes("[ERROR]") || line.includes("[WARNING]"));
  
  console.log("\\n=== 严重日志警报列表 ===");
  severeLogs.forEach(line => console.log(\`⚠️ \${line}\`));
  
  // 写入临时输出
  const outPath = path.join(__dirname, "severe_logs.txt");
  fs.writeFileSync(outPath, severeLogs.join("\\n"));
  console.log(\`\\n[SUCCESS] 过滤后的严重警报日志已固化写入: \${outPath}\\n\`);
}

run();
`
    }
  ];

  const handleApplyTemplate = (tpl: typeof templates[0]) => {
    const apply = () => {
      setFileContent(tpl.content);
      setIsEditing(true);
      if (!selectedFilePath) {
        setNewItemName(tpl.filename);
        setNewItemType("file");
      }
    };

    if (selectedFilePath && fileContent.trim() !== "") {
      showConfirm(
        "确认应用模板",
        `应用 [${tpl.name}] 模版将替换当前编辑器中的全部内容。确定要替换吗？`,
        apply
      );
    } else {
      apply();
    }
  };

  // Recursively filter the tree based on query
  const filterFileTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query) return nodes;
    const lowerQuery = query.toLowerCase();
    return nodes
      .map(node => {
        if (node.isDirectory) {
          const filteredChildren = node.children ? filterFileTree(node.children, query) : [];
          if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lowerQuery)) {
            return { ...node, children: filteredChildren };
          }
        } else {
          if (node.name.toLowerCase().includes(lowerQuery)) {
            return node;
          }
        }
        return null;
      })
      .filter(Boolean) as FileNode[];
  };

  const toggleCollapse = (path: string) => {
    setCollapsedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  // Render collapsible file tree
  const renderFileTree = (nodes: FileNode[]) => {
    if (nodes.length === 0) {
      return <div className="text-[11px] text-slate-600 pl-4 py-1">未搜索到匹配项</div>;
    }
    return (
      <ul className="space-y-1">
        {nodes.map((node) => {
          const isCollapsed = !!collapsedPaths[node.path];
          const nodeFiles = getAllFilePathsUnderNode(node);
          const isNodeChecked = node.isDirectory
            ? nodeFiles.length > 0 && nodeFiles.every(p => selectedProjectFiles.includes(p))
            : selectedProjectFiles.includes(node.path);

          return (
            <li key={node.path} className="select-none">
              <div
                onClick={() => {
                  if (node.isDirectory) {
                    toggleCollapse(node.path);
                  } else {
                    handleFileClick(node.path);
                  }
                }}
                className={`group flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-all cursor-pointer ${
                  selectedFilePath === node.path
                    ? "bg-blue-600/10 border border-blue-500/20 text-blue-400 font-bold font-mono"
                    : "text-slate-300 hover:bg-[#111827]/45"
                }`}
              >
                <div className="flex items-center gap-1.5 overflow-hidden w-full">
                  {/* Scope analysis checkbox selector */}
                  <input
                    type="checkbox"
                    checked={isNodeChecked}
                    onChange={(e) => {
                      e.stopPropagation();
                      const isChecked = e.target.checked;
                      if (isChecked) {
                        setSelectedProjectFiles(prev => {
                          const next = [...prev];
                          for (const p of nodeFiles) {
                            if (!next.includes(p)) next.push(p);
                          }
                          return next;
                        });
                      } else {
                        setSelectedProjectFiles(prev => prev.filter(p => !nodeFiles.includes(p)));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3 h-3 rounded border-slate-700/80 text-blue-600 focus:ring-0 focus:ring-offset-0 bg-[#020617] shrink-0 mr-1.5 cursor-pointer accent-blue-500"
                    title={node.isDirectory ? "勾选/反选该目录下所有文件" : "勾选以加入多文件分析范围"}
                  />

                  {node.isDirectory ? (
                    <>
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                    </>
                  ) : (
                    <>
                      <span className="w-3.5 h-3.5 shrink-0" />
                      <FileCode className="w-4 h-4 text-slate-400 shrink-0" />
                    </>
                  )}
                  <span className="truncate" title={node.path}>{node.name}</span>
                  {node.size !== undefined && !node.isDirectory && (
                    <span className="text-[9px] text-slate-600 font-mono shrink-0">
                      ({Math.round(node.size / 1024 * 10) / 10} KB)
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => handleDeleteItem(e, node.path)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-700 text-slate-500 hover:text-rose-400 rounded transition-all cursor-pointer shrink-0"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {node.isDirectory && !isCollapsed && node.children && (
                <div className="pl-3.5 border-l border-slate-800/60 ml-2.5 mt-0.5">
                  {renderFileTree(node.children)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const testZoneNode = files.find(node => node.name === "test_zone" && node.isDirectory);
  const testZoneChildren = testZoneNode?.children || [];

  const displayNodes = treeViewMode === "test" 
    ? testZoneChildren 
    : files.filter(node => node.name !== "test_zone");

  const filteredFiles = filterFileTree(displayNodes, searchQuery);
  const isDirty = selectedFilePath && fileContent !== originalContent;
  const hasExtractedCode = extractCodeFromMarkdown(aiResponse) !== null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full overflow-y-auto pr-1 pb-4 relative custom-scrollbar" id="sandbox-workspace-workbench">
      
      {/* 1. FILE TREE DISCOVERY (Left Panel - Span 3) */}
      <div className="lg:col-span-3 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded overflow-hidden shadow-xl h-[650px]">
        {/* Panel Header */}
        <div className="p-3 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-400" />
            <h2 className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400">Sandbox Tree (文件发现)</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCleanCache}
              disabled={cleaning}
              title="一键安全清理测试沙箱临时文件，并进入历史回收站"
              className="px-2 py-0.5 hover:bg-rose-950/20 text-rose-400 hover:text-rose-300 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors cursor-pointer flex items-center gap-1 text-[9px] uppercase font-mono font-bold border border-rose-500/10 hover:border-rose-500/30"
            >
              <Trash2 className={`w-3 h-3 text-rose-400 ${cleaning ? "animate-pulse" : ""}`} />
              <span>{cleaning ? "Cleaning..." : "Clean"}</span>
            </button>
            <span className="text-slate-800 text-xs">|</span>
            <button
              onClick={fetchFiles}
              title="强制同步工作区"
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#1F2937] bg-[#020617]/50 p-1 gap-1">
          <button
            onClick={() => setTreeViewMode("core")}
            className={`flex-1 py-1 px-1 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 ${
              treeViewMode === "core"
                ? "bg-[#1E293B] text-blue-400 border border-[#334155]"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
            title="查看和编辑项目的核心开发逻辑与代码"
          >
            <Code2 className="w-3 h-3" />
            <span>核心逻辑</span>
          </button>
          <button
            onClick={() => setTreeViewMode("test")}
            className={`flex-1 py-1 px-1 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 ${
              treeViewMode === "test"
                ? "bg-amber-950/40 text-amber-400 border border-amber-500/20"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
            title="测试临时文件专用存储区域"
          >
            <Sparkles className="w-3 h-3" />
            <span>测试沙箱</span>
          </button>
          <button
            onClick={() => setTreeViewMode("trash")}
            className={`flex-1 py-1 px-1 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 ${
              treeViewMode === "trash"
                ? "bg-rose-950/30 text-rose-400 border border-rose-500/15"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
            title="查看回收站文件并支持安全还原"
          >
            <History className="w-3 h-3" />
            <span>回收站</span>
            {trashItems.length > 0 && (
              <span className="bg-rose-500 text-white rounded-full text-[8px] px-1 shrink-0">
                {trashItems.length}
              </span>
            )}
          </button>
        </div>

        {/* Search & Toolbars */}
        <div className="p-2 border-b border-[#1F2937] bg-[#0A0B0E]/20 space-y-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder={treeViewMode === "trash" ? "搜索暂存垃圾..." : "搜索工作区文件..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-[#020617] border border-[#1F2937]/80 rounded text-slate-300 text-xs focus:outline-none focus:border-blue-500/50 placeholder-slate-700 font-mono"
            />
          </div>

          {/* Multi-file batch controls - only relevant for files, not trash */}
          {treeViewMode !== "trash" && (
            <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono pt-0.5 pb-1 px-1">
              <span className="text-[8px] uppercase font-bold text-slate-600 tracking-wider">Project Scope:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const allPaths: string[] = [];
                    const collect = (nodes: FileNode[]) => {
                      for (const n of nodes) {
                        if (!n.isDirectory) allPaths.push(n.path);
                        if (n.children) collect(n.children);
                      }
                    };
                    collect(displayNodes);
                    setSelectedProjectFiles(allPaths);
                  }}
                  className="hover:text-blue-400 font-bold transition-colors cursor-pointer"
                  title="一键选择该视图下所有脚本和配置文件进行深度交叉分析"
                >
                  全选 ({displayNodes.reduce((acc, n) => acc + getAllFilePathsUnderNode(n).length, 0)}个)
                </button>
                <span className="text-slate-800">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedProjectFiles([])}
                  className="hover:text-rose-400 font-bold transition-colors cursor-pointer"
                  title="清空当前勾选的文件范围"
                >
                  清空
                </button>
              </div>
            </div>
          )}

          {/* Create Buttons */}
          {treeViewMode !== "trash" && (
            <div className="flex gap-1.5">
              <button
                onClick={() => setNewItemType("file")}
                className="flex-1 py-1 px-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono font-bold uppercase text-slate-300 rounded flex items-center justify-center gap-1 cursor-pointer transition-colors"
              >
                <FilePlus className="w-3 h-3" />
                + File
              </button>
              <button
                onClick={() => setNewItemType("folder")}
                className="flex-1 py-1 px-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono font-bold uppercase text-slate-300 rounded flex items-center justify-center gap-1 cursor-pointer transition-colors"
              >
                <FolderPlus className="w-3 h-3" />
                + Folder
              </button>
            </div>
          )}
        </div>

        {/* Clean Cache Notification Banner */}
        {cleanStats && (
          <div className="p-2 border-b border-[#1F2937] bg-emerald-950/20 text-emerald-400 text-[10px] font-mono leading-normal animate-in fade-in slide-in-from-top-1 flex items-start justify-between">
            <span className="flex items-center gap-1">
              <span>✨</span>
              <span>
                安全清理：回收了测试区域内 <strong>{cleanStats.deletedCount}</strong> 个测试文件并移入回收站
              </span>
            </span>
            <button onClick={() => setCleanStats(null)} className="p-0.5 hover:bg-emerald-900/30 rounded text-emerald-500">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Node Creator Form overlay inline */}
        {newItemType && (
          <form onSubmit={handleCreateItem} className="p-2 border-b border-[#1F2937] bg-blue-950/20 flex gap-1.5 animate-in slide-in-from-top-2 duration-150">
            <input
              type="text"
              required
              placeholder={newItemType === "file" ? "e.g. run.py" : "e.g. dataset"}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="flex-1 px-2 py-0.5 bg-[#020617] border border-[#1F2937] rounded text-slate-200 text-xs focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-mono font-bold uppercase cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setNewItemType(null)}
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="w-3 h-3" />
            </button>
          </form>
        )}

        {/* Recursive Tree Body / Trash List */}
        <div className="flex-1 overflow-y-auto p-3 bg-[#0A0F1D]/30 custom-scrollbar">
          {treeViewMode === "trash" ? (
            trashLoading ? (
              <div className="text-center py-12 text-xs text-slate-600 animate-pulse font-mono">
                [SYSTEM_SYNC] 读取回收站历史...
              </div>
            ) : trashItems.length === 0 ? (
              <div className="text-center py-12 px-4 text-xs text-slate-600 font-mono flex flex-col items-center gap-2">
                <Check className="w-5 h-5 text-emerald-500" />
                <span>回收站为空，系统干干净净</span>
                <span className="text-[9px] text-slate-700 leading-normal">清理的测试文件会存入此处，支持物理还原自愈</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pb-1.5 border-b border-[#1F2937]/60">
                  <span>已暂存项目 ({trashItems.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase())).length} 个)</span>
                  <button
                    onClick={handleEmptyTrash}
                    className="text-rose-400 hover:text-rose-300 font-bold transition-colors cursor-pointer"
                  >
                    一键清空
                  </button>
                </div>
                <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
                  {trashItems
                    .filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((item) => (
                      <div
                        key={item.id}
                        className="group p-2 rounded bg-[#0A0B0E]/40 border border-[#1F2937]/45 hover:border-slate-800 transition-all text-xs"
                      >
                        <div className="flex items-start gap-1.5 justify-between">
                          <div className="flex items-start gap-1.5 overflow-hidden w-full">
                            {item.isDirectory ? (
                              <Folder className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            ) : (
                              <FileCode className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                            )}
                            <div className="overflow-hidden w-full text-[11px]">
                              <p className="font-mono text-slate-200 truncate font-semibold" title={item.name}>
                                {item.name}
                              </p>
                              <p className="text-[9px] text-slate-500 truncate" title={`原路径: ${item.originalPath}`}>
                                原: {item.originalPath}
                              </p>
                              <p className="text-[8px] text-slate-600 font-mono mt-0.5">
                                {new Date(item.deletedAt).toLocaleString("zh-CN", { hour12: false })}
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => handleRestoreTrashItem(item.id)}
                              className="p-1 hover:bg-emerald-950/30 text-emerald-500 hover:text-emerald-400 rounded transition-colors cursor-pointer"
                              title="一键物理还原并自愈"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handlePermanentDeleteTrashItem(item.id)}
                              className="p-1 hover:bg-rose-950/30 text-rose-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                              title="永久彻底删除"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )
          ) : loading && files.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-600 animate-pulse font-mono">
              [SYSTEM_SYNC] 同步工作区节点中...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-600 font-mono">
              {treeViewMode === "test" ? (
                <div className="flex flex-col items-center gap-1 px-4 leading-normal">
                  <span className="text-slate-500">测试沙箱暂无文件</span>
                  <span className="text-[9px] text-slate-700">可通过上方 "+ File" 在本区域创建实验脚本，安全清爽！</span>
                </div>
              ) : (
                "工作区为空，可一键在模版页生成"
              )}
            </div>
          ) : (
            renderFileTree(filteredFiles)
          )}
        </div>
      </div>

      {/* 2. CORE WORKSPACE EDITOR & PREVIEWER (Middle Panel - Span 5 or 9) */}
      <div className={`${showAiPanel ? "lg:col-span-5" : "lg:col-span-9"} flex flex-col gap-4 h-[650px] transition-all duration-300`}>
        <div className="flex-1 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded overflow-hidden shadow-xl">
          {/* Header toolbar */}
          <div className="p-3 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <Code2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-400 truncate max-w-xs" title={selectedFilePath || ""}>
                {selectedFilePath ? `Active: ${selectedFilePath}` : "Inspector Workspace"}
              </span>
              {isDirty && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" title="未保存的修改" />
              )}
            </div>

            {/* Editor Action Buttons */}
            <div className="flex items-center gap-1.5">
              {/* Toggle AI Panel Button */}
              <button
                onClick={() => setShowAiPanel(!showAiPanel)}
                className={`px-2 py-1 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  showAiPanel 
                    ? "bg-blue-950/40 border border-blue-500/20 text-blue-400"
                    : "bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                }`}
                title={showAiPanel ? "关闭 AI 智能面板" : "开启 AI 智能面板"}
              >
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                <span>AI Copilot</span>
              </button>

              <span className="text-slate-800">|</span>

              {selectedFilePath && (
                <>
                  {/* Edit/Preview Toggle button */}
                  {!isImageFile(selectedFilePath) && (
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1 transition-colors cursor-pointer border border-slate-700/60"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {isEditing ? "Preview" : "Edit"}
                    </button>
                  )}

                  {/* Save button */}
                  {(isEditing || isDirty) && (
                    <button
                      onClick={handleSaveFile}
                      disabled={saveStatus === "saving"}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold font-mono text-[10px] uppercase rounded flex items-center gap-1 transition-all cursor-pointer shadow-sm shadow-emerald-950"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saveStatus === "saving" ? "Saving..." : "Save"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Interactive Rendering Body */}
          <div className="flex-1 flex flex-col bg-[#020617] text-slate-300 overflow-hidden relative">
            {selectedFilePath ? (
              isImageFile(selectedFilePath) ? (
                /* IMAGE PREVIEW MODE */
                <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[linear-gradient(45deg,#0e1524_25%,transparent_25%),linear-gradient(-45deg,#0e1524_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#0e1524_75%),linear-gradient(-45deg,transparent_75%,#0e1524_75%)] bg-[size:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] overflow-auto">
                  <div className="max-w-full max-h-[400px] flex flex-col items-center gap-3">
                    <img
                      src={`/api/workspace/image?path=${encodeURIComponent(selectedFilePath)}`}
                      alt={selectedFilePath}
                      className="max-w-full max-h-[350px] object-contain rounded-lg border border-[#1F2937] shadow-2xl bg-black"
                    />
                    <div className="bg-[#111827]/90 px-3 py-1 rounded text-[10px] font-mono text-slate-400 flex items-center gap-1.5 border border-slate-800">
                      <ImageIcon className="w-3 h-3 text-emerald-400" />
                      <span>{selectedFilePath}</span>
                    </div>
                  </div>
                </div>
              ) : isMarkdownFile(selectedFilePath) && !isEditing ? (
                /* MARKDOWN PREVIEW MODE */
                <div className="flex-1 p-5 overflow-y-auto select-text bg-[#030712] prose-invert max-w-none">
                  <div className="markdown-body text-xs text-slate-300 leading-relaxed space-y-2">
                    <Markdown>{fileContent || "*这是一个空文件*"}</Markdown>
                  </div>
                </div>
              ) : isJsonFile(selectedFilePath) && !isEditing ? (
                /* BEAUTIFIED JSON INSPECTOR */
                <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-blue-300 select-text bg-[#030712]">
                  <pre className="whitespace-pre-wrap leading-relaxed">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(fileContent), null, 2);
                      } catch (e) {
                        return fileContent || "// 空的 JSON 数据或解析失败";
                      }
                    })()}
                  </pre>
                </div>
              ) : isEditing ? (
                /* TEXT CODE EDITOR TEXTAREA */
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-full p-4 font-mono text-xs bg-transparent text-slate-300 border-none outline-none focus:ring-0 resize-none leading-relaxed select-text select-all"
                  spellCheck={false}
                />
              ) : (
                /* SOURCE TEXT VIEW PRE */
                <pre className="w-full h-full p-4 font-mono text-xs overflow-auto select-text leading-relaxed whitespace-pre-wrap text-slate-400 bg-[#020617]/70">
                  {fileContent || <span className="text-slate-600 italic">// Empty file</span>}
                </pre>
              )
            ) : (
              /* EMPTY INSPECT WORKSPACE */
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-600 font-sans">
                <FileText className="w-10 h-10 mb-3 text-slate-800" />
                <h3 className="text-xs uppercase font-mono tracking-widest text-slate-500 font-bold">请选择或创建沙箱文件</h3>
                <p className="text-[10px] text-slate-700 max-w-xs mt-1.5 leading-normal">
                  您可以从左侧树桩选择任务输出的 TXT、JSON 格式日志、运行产生的 PNG 图片，或者一键引入右侧 AI 设计模板起步运行。
                </p>
              </div>
            )}

            {/* SAVE STATUS INDICATORS */}
            {saveStatus === "saved" && (
              <div className="absolute top-4 right-4 bg-emerald-600 border border-emerald-500/30 text-white text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded shadow-lg animate-in fade-in zoom-in duration-150">
                ✓ File Saved Successfully
              </div>
            )}
            {saveStatus === "error" && (
              <div className="absolute top-4 right-4 bg-rose-600 border border-rose-500/30 text-white text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded shadow-lg animate-in fade-in zoom-in duration-150">
                ⚠ Failed to Save File
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. AI WORKSPACE COPILOT & TEMPLATE (Right Panel - Span 4) */}
      {showAiPanel && (
        <div className="lg:col-span-4 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded overflow-hidden shadow-xl h-[650px] animate-in fade-in slide-in-from-right-3 duration-200">
          
          {/* Tabs header */}
          <div className="border-b border-[#1F2937] bg-[#111827] flex p-1 justify-between items-center">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("ai")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTab === "ai"
                    ? "bg-[#020617] text-blue-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>AI Copilot</span>
              </button>
              <button
                onClick={() => setShowSessionsSidebar(prev => !prev)}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  showSessionsSidebar
                    ? "bg-[#020617] text-amber-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                title="查看/管理历史对话"
              >
                <History className="w-3.5 h-3.5 text-amber-400" />
                <span>历史记录</span>
              </button>
              <button
                onClick={() => setActiveTab("template")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTab === "template"
                    ? "bg-[#020617] text-purple-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-purple-400" />
                <span>极速模板</span>
              </button>
            </div>
            <button
              onClick={() => setShowAiPanel(false)}
              className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 rounded"
              title="隐藏 AI 面板"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* TAB 1: AI ASSISTANT PORTAL */}
          {activeTab === "ai" && (
            <div className="flex-1 flex overflow-hidden relative">
              {/* Sessions Sidebar */}
              {showSessionsSidebar && (
                <div className="w-[180px] shrink-0 border-r border-[#1F2937] bg-[#0A0B0E]/80 flex flex-col overflow-hidden animate-in slide-in-from-left duration-150">
                  <div className="p-2 border-b border-[#1F2937] flex items-center justify-between shrink-0 bg-[#111827]">
                    <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">对话历史</span>
                    <button
                      onClick={() => handleCreateSession()}
                      className="px-1.5 py-0.5 bg-blue-900/30 hover:bg-blue-900/60 text-blue-400 border border-blue-500/20 text-[9px] font-mono rounded font-bold cursor-pointer transition-colors"
                      title="新建对话"
                    >
                      + 新建
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-1 space-y-1">
                    {sessions.length === 0 ? (
                      <div className="text-[10px] text-slate-600 text-center py-6 font-mono">暂无对话记录</div>
                    ) : (
                      sessions.map(s => {
                        const isSelected = s.id === currentSessionId;
                        const isEditing = s.id === editingSessionId;
                        return (
                          <div
                            key={s.id}
                            onClick={() => {
                              setCurrentSessionId(s.id);
                              const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
                              setAiResponse(lastMsg && lastMsg.role === "model" ? lastMsg.parts[0].text : "");
                              setAiError(null);
                            }}
                            className={`p-2 rounded text-[11px] group relative flex flex-col cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-blue-950/40 border border-blue-500/20 text-blue-300"
                                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                            }`}
                          >
                            <div className="flex-1 min-w-0 pr-6">
                              {isEditing ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingSessionTitle}
                                  onChange={e => setEditingSessionTitle(e.target.value)}
                                  onBlur={() => handleRenameSession(s.id, editingSessionTitle)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") handleRenameSession(s.id, editingSessionTitle);
                                    if (e.key === "Escape") setEditingSessionId(null);
                                  }}
                                  className="w-full bg-slate-900 border border-blue-500 rounded px-1 text-[11px] text-slate-200 outline-none"
                                />
                              ) : (
                                <div className="truncate font-medium">{s.title || "新对话"}</div>
                              )}
                              <div className="text-[8px] text-slate-600 font-mono mt-0.5">
                                {new Date(s.updatedAt || s.createdAt).toLocaleDateString("zh-CN", {
                                  month: "numeric",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </div>
                            </div>
                            
                            {!isEditing && (
                              <div className="absolute right-1 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 pl-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSessionId(s.id);
                                    setEditingSessionTitle(s.title || "新对话");
                                  }}
                                  className="text-[10px] text-slate-500 hover:text-slate-300"
                                  title="重命名"
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={(e) => handleDeleteSession(s.id, e)}
                                  className="text-slate-500 hover:text-rose-400"
                                  title="删除"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Chat Main Area */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Scope Toggler */}
                <div className="p-2 border-b border-[#1F2937]/80 bg-[#111827]/60 flex items-center justify-between gap-2.5 shrink-0">
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-400">分析范围 / SCOPE:</span>
                  <div className="flex bg-[#020617] p-0.5 rounded border border-[#1F2937] text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setAiScope("single")}
                      className={`px-2.5 py-1 rounded font-bold transition-all cursor-pointer ${
                        aiScope === "single"
                          ? "bg-blue-600 text-white font-extrabold"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      单文件
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiScope("project")}
                      className={`px-2.5 py-1 rounded font-bold transition-all relative cursor-pointer ${
                        aiScope === "project"
                          ? "bg-blue-600 text-white font-extrabold"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      项目级 ({selectedProjectFiles.length}个文件)
                      {selectedProjectFiles.length > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Active Model Pool HUD */}
                <div className="px-3 py-1.5 border-b border-[#1F2937]/65 bg-[#080E1A] flex items-center justify-between gap-2 shrink-0 select-none">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-[9px] font-mono font-bold text-slate-400 truncate uppercase tracking-wider">
                      Active Model Pool Connected
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="px-1.5 py-0.5 bg-[#020617] text-[9px] font-mono text-blue-400 rounded border border-[#1F2937]">
                      Gemini 3.5 Flash
                    </span>
                    <span className="px-1.5 py-0.5 bg-emerald-950/40 text-[9px] font-mono text-emerald-400 rounded border border-emerald-900/30">
                      No-Cost Pool
                    </span>
                  </div>
                </div>

                {/* Quick Prompt Command Matrix */}
                {(aiScope === "project" || selectedFilePath) && (
                  <div className="p-3 bg-[#0A0F1D]/50 border-b border-[#1F2937] space-y-1.5 shrink-0 animate-in fade-in duration-200">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest block">AI Quick Analysis (一键智能深度透视)</span>
                      <span className="text-[9px] font-mono font-bold bg-blue-950/60 text-blue-400 px-1.5 py-0.5 rounded border border-blue-900/40 font-mono">
                        {aiScope === "project" ? `项目分析 (${selectedProjectFiles.length}个文件)` : `单文件: ${selectedFilePath?.split("/").pop()}`}
                      </span>
                    </div>
                    {aiScope === "project" && selectedProjectFiles.length === 0 && (
                      <div className="p-2 border border-amber-500/20 bg-amber-950/20 rounded text-[10px] text-amber-400 leading-normal mb-1 font-mono">
                        💡 提示：您尚未在左侧勾选特定文件。项目分析将默认搜索并分析整个工作区内的主要 logic 和配置上下文！
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleCallAiCopilot("explain")}
                        disabled={aiLoading}
                        className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5 text-blue-400" />
                        <span>{aiScope === "project" ? "一键解构项目" : "解读文件逻辑"}</span>
                      </button>
                      <button
                        onClick={() => handleCallAiCopilot("optimize")}
                        disabled={aiLoading}
                        className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer transition-colors"
                      >
                        <Cpu className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        <span>{aiScope === "project" ? "项目重构优化" : "性能与重构优化"}</span>
                      </button>
                      <button
                        onClick={() => handleCallAiCopilot("fix-bugs")}
                        disabled={aiLoading}
                        className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer transition-colors"
                      >
                        <Activity className="w-3.5 h-3.5 text-rose-400" />
                        <span>{aiScope === "project" ? "项目缺陷扫描" : "代码缺陷排查"}</span>
                      </button>
                      <button
                        onClick={() => handleCallAiCopilot("data-summary")}
                        disabled={aiLoading}
                        className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-purple-400" />
                        <span>{aiScope === "project" ? "跨文件数据提炼" : "数据提炼洞察"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {!(aiScope === "project" || selectedFilePath) && (
                  <div className="p-4 text-center border-b border-[#1F2937] bg-[#0A0B0E]/20 text-[10px] font-mono text-slate-500 shrink-0">
                    ⚠️ 请在左侧文件树中先点击选择一个文件，以解锁 AI 协同能力
                  </div>
                )}

                {/* Stream output panel */}
                <div className="flex-1 overflow-y-auto p-4 bg-[#030712] relative space-y-4 select-text">
                  {(() => {
                    const activeSession = sessions.find(s => s.id === currentSessionId);
                    if (activeSession && activeSession.messages && activeSession.messages.length > 0) {
                      return activeSession.messages.map((msg: any, idx: number) => {
                        const isUser = msg.role === "user";
                        return (
                          <div
                            key={idx}
                            className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-in fade-in slide-in-from-bottom-2 duration-150`}
                          >
                            <div className="flex items-center gap-1 text-[9px] text-slate-500 font-mono mb-1 px-1">
                              <span>{isUser ? "You" : "Copilot"}</span>
                              <span>•</span>
                              <span>
                                {new Date(msg.timestamp).toLocaleTimeString("zh-CN", {
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </span>
                            </div>
                            <div
                              className={`p-3 rounded-lg text-xs leading-relaxed max-w-[88%] select-text whitespace-normal break-words ${
                                isUser
                                  ? "bg-blue-600/25 border border-blue-500/20 text-slate-200"
                                  : "bg-[#0A0F1D]/80 border border-[#1F2937] text-slate-300 markdown-body leading-relaxed space-y-2"
                              }`}
                            >
                              {isUser ? (
                                <p className="whitespace-pre-wrap font-mono">{msg.displayPrompt || msg.parts[0]?.text}</p>
                              ) : (
                                <Markdown>{msg.parts[0]?.text || ""}</Markdown>
                              )}
                            </div>

                            {/* Copilot visual task execution log HUD */}
                            {!isUser && msg.executedActions && msg.executedActions.length > 0 && (
                              <div className="mt-2 w-[88%] p-3 rounded-lg bg-[#050B14]/90 border border-emerald-950/50 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150 shrink-0 select-text">
                                <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider select-none">
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                                  <span>Copilot 自动任务执行日志 ({msg.executedActions.length})</span>
                                </div>
                                <div className="space-y-2 font-mono text-[11px] select-text">
                                  {msg.executedActions.map((action: any, aIdx: number) => (
                                    <div key={aIdx} className="flex flex-col gap-1.5 p-2 bg-[#02050A] rounded border border-slate-900 select-text">
                                      <div className="flex items-center justify-between gap-2 select-none">
                                        <span className="flex items-center gap-1.5 font-bold text-slate-300 truncate text-[10px]">
                                          {action.type === "create_file" || action.type === "write_file" ? "📁 写入文件" :
                                           action.type === "mkdir" ? "📂 创建目录" :
                                           action.type === "delete_file" ? "🗑️ 物理删除" :
                                           action.type === "run_command" ? "⚙️ 运行命令" : "🛠️ 执行操作"}:
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase shrink-0 ${
                                          action.success ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40" : "bg-rose-950/60 text-rose-400 border border-rose-800/40"
                                        }`}>
                                          {action.success ? "成功" : "失败"}
                                        </span>
                                      </div>
                                      <div className="text-blue-400 select-all break-all text-[10px] font-bold pl-1 border-l border-slate-800">
                                        {action.path || action.command}
                                      </div>
                                      {action.error && (
                                        <div className="text-rose-400 text-[10px] pl-1 border-l border-rose-500/50 mt-1">{action.error}</div>
                                      )}
                                      {action.type === "run_command" && action.output && (
                                        <details className="mt-1 select-text">
                                          <summary className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer select-none">显示终端控制台输出...</summary>
                                          <pre className="mt-1 p-2 bg-black text-slate-400 rounded text-[9px] max-h-32 overflow-y-auto whitespace-pre-wrap select-text selection:bg-slate-800">{action.output}</pre>
                                        </details>
                                      )}
                                      {(action.type === "create_file" || action.type === "write_file") && (
                                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-900/60 select-none">
                                          <span className="text-[9px] text-slate-500">{action.size} 字符</span>
                                          <button
                                            type="button"
                                            onClick={() => handleFileClick(action.path)}
                                            className="px-2 py-0.5 bg-blue-950 hover:bg-blue-900 text-blue-300 border border-blue-900 rounded text-[10px] cursor-pointer transition-colors"
                                          >
                                            在编辑器打开
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    }

                    if (aiLoading) {
                      return (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce duration-300 [animation-delay:-0.3s]" />
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce duration-300 [animation-delay:-0.15s]" />
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce duration-300" />
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider animate-pulse">Copilot 正在聚合分析上下文...</span>
                        </div>
                      );
                    }

                    if (aiError) {
                      return (
                        <div className="p-3 rounded border border-rose-900/30 bg-rose-950/20 text-rose-400 text-xs font-mono whitespace-pre-wrap leading-relaxed">
                          ❌ {aiError}
                        </div>
                      );
                    }

                    return (
                      <div className="text-center py-24 text-slate-600 font-sans">
                        <Sparkles className="w-8 h-8 text-slate-800 mx-auto mb-2 animate-pulse" />
                        <p className="text-[10px] uppercase font-mono tracking-wider">AI Copilot Interactive Frame</p>
                        <p className="text-[9px] text-slate-700 mt-1 max-w-[200px] mx-auto">点击一键分析或在下方输入框中向 AI 提问。</p>
                      </div>
                    );
                  })()}

                  {/* Typing Indicator */}
                  {aiLoading && (() => {
                    const activeSession = sessions.find(s => s.id === currentSessionId);
                    return activeSession && activeSession.messages && activeSession.messages.length > 0;
                  })() && (
                    <div className="flex items-center gap-1.5 p-1 text-[10px] text-slate-500 font-mono animate-pulse">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce duration-300" />
                      <span>Copilot 正在回复中...</span>
                    </div>
                  )}

                  {/* SELF HEALING CTA PANEL: If AI has optimized/fixed code, render code healing bar */}
                  {hasExtractedCode && !aiLoading && (
                    <div className="sticky bottom-0 left-0 right-0 p-2.5 border border-emerald-500/20 bg-emerald-950/30 rounded mt-5 flex flex-col gap-1.5 shadow-xl backdrop-blur-sm animate-in zoom-in-95 duration-150">
                      <div className="flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[9px] font-mono text-emerald-400 font-bold uppercase">检测到 AI 推荐的新版完整代码</span>
                      </div>
                      <button
                        onClick={handleApplyAiSuggestion}
                        className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-[10px] uppercase rounded cursor-pointer transition-all flex items-center justify-center gap-1 shadow shadow-emerald-950"
                      >
                        <Copy className="w-3 h-3" />
                        <span>一键应用并覆盖编辑器代码</span>
                      </button>
                    </div>
                  )}

                  {/* Ref marker for auto-scrolling */}
                  <div ref={chatBottomRef} />
                </div>

                {/* Chat Input interface */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (customPrompt.trim()) handleCallAiCopilot("custom");
                  }}
                  className="p-2 border-t border-[#1F2937] bg-[#111827] flex gap-1.5 shrink-0"
                >
                  <input
                    type="text"
                    disabled={aiLoading || (aiScope === "single" && !selectedFilePath)}
                    placeholder={
                      aiScope === "project"
                        ? selectedProjectFiles.length > 0
                          ? `提问勾选的 ${selectedProjectFiles.length} 个文件...`
                          : "提问或一键全盘检索整个项目..."
                        : selectedFilePath
                        ? "关于此文件你有什么疑问？..."
                        : "请先选择需要分析的文件"
                    }
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-[#020617] border border-[#1F2937] rounded text-slate-200 text-xs focus:outline-none focus:border-blue-500/50 disabled:opacity-50 placeholder-slate-700 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || (aiScope === "single" && !selectedFilePath) || !customPrompt.trim()}
                    className="px-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold font-mono text-[10px] rounded cursor-pointer transition-colors"
                  >
                    Ask
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: CODE BOILERPLATE TEMPLATE PORTAL */}
          {activeTab === "template" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#030712]">
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-slate-300 font-mono">Boilerplate Repository (沙箱极速模版仓库)</h3>
                <p className="text-[10px] text-slate-500 leading-normal">
                  我们为您精心预制了适用于自动化任务执行的工程脚本模版，点击一键注入代码编辑器并开始运行或二次开发。
                </p>
              </div>

              <div className="space-y-2.5">
                {templates.map((tpl) => (
                  <div
                    key={tpl.name}
                    className="p-3 rounded border border-[#1F2937] bg-[#0A0F1D]/50 hover:bg-[#0A0F1D]/90 transition-all flex flex-col justify-between gap-2.5"
                  >
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono font-bold text-purple-400 block">{tpl.filename}</span>
                      <h4 className="text-xs font-bold text-slate-200">{tpl.name}</h4>
                      <p className="text-[10px] text-slate-500 leading-normal">{tpl.description}</p>
                    </div>
                    <button
                      onClick={() => handleApplyTemplate(tpl)}
                      className="py-1 px-2.5 bg-purple-950/20 hover:bg-purple-950/50 border border-purple-500/20 hover:border-purple-500/40 text-purple-400 text-[10px] font-bold font-mono uppercase rounded transition-all cursor-pointer flex items-center justify-center gap-1"
                    >
                      <ArrowRight className="w-3 h-3" />
                      <span>载入该模版代码</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. RESTRICTED TERMINAL WINDOW & QUICK PRESETS (Bottom Panel - Span 12) */}
      <div className="lg:col-span-12 bg-[#020617] border border-[#1F2937] rounded overflow-hidden shadow-2xl h-[200px] flex flex-col">
        {/* Terminal Header */}
        <div className="p-2.5 bg-[#111827] border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-blue-400 shrink-0" />
            <h3 className="font-bold text-slate-400 text-[10px] uppercase font-mono tracking-widest">
              Sandbox Shell Console (受限执行沙箱)
            </h3>
          </div>

          {/* Quick command execution badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-mono font-bold text-slate-600 uppercase">Quick Command:</span>
            <button
              onClick={() => runTerminalCommand("ls -la")}
              disabled={executingCmd}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-mono text-[9px] rounded transition-colors cursor-pointer"
            >
              ls -la
            </button>
            <button
              onClick={() => runTerminalCommand("python3 --version && node -v")}
              disabled={executingCmd}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-mono text-[9px] rounded transition-colors cursor-pointer"
            >
              env-check
            </button>
            <button
              onClick={() => runTerminalCommand("pip list")}
              disabled={executingCmd}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-mono text-[9px] rounded transition-colors cursor-pointer"
            >
              pip list
            </button>
            <button
              onClick={() => runTerminalCommand("du -sh *")}
              disabled={executingCmd}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-mono text-[9px] rounded transition-colors cursor-pointer"
            >
              du -sh
            </button>
            <button
              onClick={() => setTerminalOutput("")}
              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-slate-300 font-mono text-[9px] rounded transition-colors cursor-pointer"
            >
              Clear Screen
            </button>
          </div>
        </div>
        
        {/* Scrollable output area */}
        <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] text-slate-400 bg-black/60 space-y-1 select-text">
          {terminalOutput ? (
            <pre className="whitespace-pre-wrap">{terminalOutput}</pre>
          ) : (
            <p className="text-slate-600 text-[10px] leading-normal">
              # 受限执行沙箱终端控制台已准备就绪。<br />
              # 运行安全策略保护系统层，越权读写或高危网络破坏会被安全组件自动熔断和捕获。<br />
              # 试运行一个指令吧，您可以点击上方的常用快捷按键 (如 'ls -la' 查看目录物理状态)。
            </p>
          )}
        </div>

        {/* Console command submit form */}
        <form onSubmit={handleRunTerminalForm} className="flex border-t border-[#1F2937]">
          <span className="p-2 bg-[#111827] text-blue-400 font-mono text-xs select-none flex items-center border-r border-[#1F2937]">
            $
          </span>
          <input
            type="text"
            disabled={executingCmd}
            placeholder={executingCmd ? "指令运行中..." : "输入要在沙箱中运行的 Linux 终端指令，按回车执行..."}
            value={manualCommand}
            onChange={(e) => setManualCommand(e.target.value)}
            className="flex-1 px-3 py-2 bg-[#020617]/30 text-emerald-400 font-mono text-xs border-none outline-none focus:ring-0 placeholder-slate-800"
          />
          <button
            type="submit"
            disabled={executingCmd}
            className="px-4 bg-[#111827] hover:bg-slate-800 text-slate-300 hover:text-white border-l border-[#1F2937] flex items-center justify-center cursor-pointer transition-colors"
          >
            <Play className={`w-3.5 h-3.5 fill-current text-blue-400 ${executingCmd ? "animate-pulse" : ""}`} />
          </button>
        </form>
      </div>

      {/* CUSTOM CONFIRM/ALERT DIALOG MODAL */}
      {modal?.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#020617]/85 backdrop-blur-sm p-4 animate-in fade-in duration-200" id="custom-modal-overlay">
          <div className="bg-[#0F172A] border border-[#1F2937] rounded-lg shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200" id="custom-modal-container">
            {/* Header */}
            <div className="p-4 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between" id="custom-modal-header">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                {modal.title}
              </h3>
              <button
                onClick={() => setModal(null)}
                className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                id="custom-modal-close-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Body */}
            <div className="p-6" id="custom-modal-body">
              <p className="text-xs text-slate-400 font-sans leading-relaxed whitespace-pre-line">
                {modal.message}
              </p>
            </div>
            {/* Footer */}
            <div className="p-4 border-t border-[#1F2937] bg-[#111827]/60 flex justify-end gap-2" id="custom-modal-footer">
              {modal.type === "confirm" ? (
                <>
                  <button
                    onClick={() => setModal(null)}
                    className="px-3.5 py-1.5 border border-[#1F2937] hover:bg-slate-800 text-slate-400 text-xs font-mono font-bold uppercase rounded cursor-pointer transition-colors"
                    id="custom-modal-cancel-btn"
                  >
                    取消 / Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (modal.onConfirm) modal.onConfirm();
                      setModal(null);
                    }}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 border border-rose-500/20 text-white text-xs font-mono font-bold uppercase rounded cursor-pointer transition-colors"
                    id="custom-modal-confirm-btn"
                  >
                    确认 / Confirm
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setModal(null)}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-500/20 text-white text-xs font-mono font-bold uppercase rounded cursor-pointer transition-colors"
                  id="custom-modal-ok-btn"
                >
                  好的 / OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
