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

  // Workbench layout states
  const [rightTab, setRightTab] = useState<"preview" | "code" | "index">("preview");
  const [indexerQuery, setIndexerQuery] = useState("");
  const [indexerSymbols, setIndexerSymbols] = useState<any[]>([]);
  const [indexerLoading, setIndexerLoading] = useState(false);

  const fetchIndexerSymbols = async (q = "") => {
    setIndexerLoading(true);
    try {
      const res = await fetch(`/api/indexer/symbols?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.symbols) {
          setIndexerSymbols(data.symbols);
        }
      }
    } catch (err) {
      console.error("Error fetching indexer symbols:", err);
    } finally {
      setIndexerLoading(false);
    }
  };

  useEffect(() => {
    if (rightTab === "index") {
      fetchIndexerSymbols(indexerQuery);
    }
  }, [rightTab, indexerQuery]);

  // Copilot Panel states
  const [showAiPanel, setShowAiPanel] = useState(true);
  const [activeTab, setActiveTab] = useState<"ai">("ai");
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

  // Auto-scroll to bottom of chat is responsive
  const scrollToBottom = () => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (aiLoading) {
      scrollToBottom();
    }
  }, [aiLoading]);

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
          showAlert("连接失败", "清理请求失败，无法连接 to 执行端服务器。");
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

  const handleReindex = async () => {
    setIndexerLoading(true);
    try {
      const res = await fetch("/api/indexer/reindex", { method: "POST" });
      if (res.ok) {
        fetchIndexerSymbols(indexerQuery);
        fetchFiles();
        showAlert("提示", "✨ 仓库索引重建成功！所有文件与代码符号已重新载入。");
      }
    } catch (e) {
      console.error(e);
      showAlert("错误", "仓库索引重建失败，请检查控制台。");
    } finally {
      setIndexerLoading(false);
    }
  };

  const activeSession = sessions.find(s => s.id === currentSessionId);
  const allExecutedActions = activeSession?.messages
    ? activeSession.messages.flatMap((m: any) => m.executedActions || [])
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-full lg:overflow-hidden h-auto overflow-y-auto pr-1 pb-4 relative" id="sandbox-workspace-workbench">
      
      {/* LEFT PANEL: AI AGENT CHAT (Span 5) */}
      <div className="lg:col-span-5 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded-lg overflow-hidden shadow-xl h-full animate-in fade-in duration-200">
        {/* Tabs header */}
        <div className="border-b border-[#1F2937] bg-[#111827] flex p-1 justify-between items-center shrink-0">
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
              <span>AI Copilot Agent</span>
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
          </div>
        </div>

        {/* TAB 1: AI ASSISTANT PORTAL */}
        {activeTab === "ai" && (
          <div className="flex-1 flex overflow-hidden relative">
            {/* Sessions Sidebar */}
            {showSessionsSidebar && (
              <div className="w-[150px] shrink-0 border-r border-[#1F2937] bg-[#0A0B0E]/80 flex flex-col overflow-hidden animate-in slide-in-from-left duration-150">
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
                <div className="flex-1 overflow-y-auto custom-scrollbar p-1 space-y-1">
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
                    className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${
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
                    className={`px-2 py-1 rounded font-bold transition-all relative cursor-pointer ${
                      aiScope === "project"
                        ? "bg-blue-600 text-white font-extrabold"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    项目级 ({selectedProjectFiles.length}个)
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
                    Codex AI Agent Engine Online
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="px-1.5 py-0.5 bg-[#020617] text-[9px] font-mono text-blue-400 rounded border border-[#1F2937]">
                    Gemini 3.5 Flash
                  </span>
                </div>
              </div>

              {/* Quick Prompt Command Matrix */}
              {(aiScope === "project" || selectedFilePath) && (
                <div className="p-3 bg-[#0A0F1D]/50 border-b border-[#1F2937] space-y-1.5 shrink-0 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest block">一键深度探针 / Core Agents</span>
                  </div>
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
                      <span>{aiScope === "project" ? "项目重构优化" : "重构优化"}</span>
                    </button>
                    <button
                      onClick={() => handleCallAiCopilot("fix-bugs")}
                      disabled={aiLoading}
                      className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer transition-colors"
                    >
                      <Activity className="w-3.5 h-3.5 text-rose-400" />
                      <span>代码缺陷排查</span>
                    </button>
                    <button
                      onClick={() => handleCallAiCopilot("data-summary")}
                      disabled={aiLoading}
                      className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-purple-400" />
                      <span>数据提炼洞察</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Stream output panel */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-[#030712] relative space-y-4 select-text">
                {activeSession && activeSession.messages && activeSession.messages.length > 0 ? (
                  activeSession.messages.map((msg: any, idx: number) => {
                    const isUser = msg.role === "user";
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-in fade-in slide-in-from-bottom-2 duration-150`}
                      >
                        <div className="flex items-center gap-1 text-[9px] text-slate-500 font-mono mb-1 px-1">
                          <span>{isUser ? "You" : "Codex Copilot"}</span>
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

                        {/* Collapsed actions inside chat can stay, but they are also shown in Right Panel Preview */}
                        {!isUser && msg.executedActions && msg.executedActions.length > 0 && (
                          <div className="mt-1 text-[9px] text-emerald-400/80 font-mono italic pl-2">
                            ⚡ 已自动执行了 {msg.executedActions.length} 步操作，详情已实时推送至右侧【运行预览】
                          </div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className="text-center py-24 text-slate-600 font-sans">
                    <Sparkles className="w-8 h-8 text-slate-800 mx-auto mb-2 animate-pulse" />
                    <p className="text-[10px] uppercase font-mono tracking-wider">AI Copilot Interactive Frame</p>
                    <p className="text-[9px] text-slate-700 mt-1 max-w-[200px] mx-auto">在下方输入框中向 AI 提问或派发多步执行规划任务。</p>
                  </div>
                )}

                {aiLoading && (
                  <div className="flex items-center gap-1.5 p-1 text-[10px] text-slate-500 font-mono animate-pulse">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce duration-300" />
                    <span>Agent 正在执行自主决策与自愈循环...</span>
                  </div>
                )}

                {aiError && (
                  <div className="p-3 rounded border border-rose-900/30 bg-rose-950/20 text-rose-400 text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    ❌ {aiError}
                  </div>
                )}

                {/* SELF HEALING CTA PANEL */}
                {hasExtractedCode && !aiLoading && (
                  <div className="sticky bottom-0 left-0 right-0 p-2.5 border border-emerald-500/20 bg-emerald-950/30 rounded mt-5 flex flex-col gap-1.5 shadow-xl backdrop-blur-sm animate-in zoom-in-95 duration-150">
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[9px] font-mono text-emerald-400 font-bold uppercase">检测到 AI 生成的可用代码</span>
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
                        ? `提问选中的 ${selectedProjectFiles.length} 个文件...`
                        : "提问或一键全盘检索整个工作区..."
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
                  Send
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL: COCKPIT WORKBENCH (Span 7) */}
      <div className="lg:col-span-7 flex flex-col gap-4 h-full">
        {/* Main Tabbed Container (540px) */}
        <div className="flex-1 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded-lg overflow-hidden shadow-xl relative animate-in fade-in duration-200">
          {/* Tabs Navigation */}
          <div className="border-b border-[#1F2937] bg-[#111827] flex p-1 justify-between items-center shrink-0">
            <div className="flex gap-1">
              <button
                onClick={() => setRightTab("preview")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  rightTab === "preview"
                    ? "bg-[#020617] text-blue-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                <span>运行预览 & 步骤 logs</span>
              </button>
              <button
                onClick={() => setRightTab("code")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  rightTab === "code"
                    ? "bg-[#020617] text-emerald-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>代码逻辑 & 文件管理</span>
              </button>
              <button
                onClick={() => setRightTab("index")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  rightTab === "index"
                    ? "bg-[#020617] text-purple-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Search className="w-3.5 h-3.5 text-purple-400" />
                <span>仓库符号检索 (Repo Index)</span>
              </button>
            </div>
            
            {/* Context File info if on Code tab */}
            {rightTab === "code" && selectedFilePath && (
              <span className="text-[10px] font-mono text-slate-500 truncate max-w-[200px] pr-2">
                {selectedFilePath.split("/").pop()}
              </span>
            )}
          </div>

          {/* TAB CONTENT: 1. PREVIEW & RUN LOGS TIMELINE */}
          {rightTab === "preview" && (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#020617] p-4 text-slate-300">
              {/* Cockpit Diagnostic Dashboard */}
              <div className="p-3 bg-[#0A0F1D]/60 border border-[#1F2937] rounded-lg mb-4 flex items-center justify-between gap-4 shrink-0 select-none">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-950/40 rounded-full border border-blue-500/20">
                    <Cpu className="w-5 h-5 text-blue-400 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-slate-200">AGENT LIVE COCKPIT</h4>
                    <p className="text-[9px] text-slate-500">Autonomous Step-by-Step Command & Action Monitor</p>
                  </div>
                </div>
                <div className="flex gap-4 font-mono text-right shrink-0">
                  <div>
                    <p className="text-[9px] text-slate-500">EXEC STEPS</p>
                    <p className="text-xs font-bold text-blue-400">{allExecutedActions.length}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">STATUS</p>
                    <p className={`text-xs font-bold ${aiLoading ? "text-amber-400 animate-pulse" : "text-emerald-400"}`}>
                      {aiLoading ? "THINKING" : "STANDBY"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Compressed Steps Scroll Area */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 select-text">
                {allExecutedActions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#1F2937]/50 rounded-lg bg-slate-900/10">
                    <Activity className="w-10 h-10 text-slate-800 mb-3 animate-pulse" />
                    <h5 className="text-xs uppercase font-mono tracking-widest text-slate-400 font-bold">等待多步自主规划与指令运行...</h5>
                    <p className="text-[10px] text-slate-600 max-w-sm mt-1.5 leading-normal font-sans">
                      您可以在左侧聊天框输入复杂的系统升级、重构或脚本测试指令。Agent 将在这里实时、逐步展示执行轨迹与自愈日志。
                    </p>
                  </div>
                ) : (
                  <div className="relative pl-4 border-l border-slate-800 space-y-4">
                    {allExecutedActions.map((action: any, aIdx: number) => {
                      const isCommand = action.type === "run_command";
                      const isFile = action.type === "create_file" || action.type === "write_file";
                      return (
                        <div key={aIdx} className="relative group/step animate-in slide-in-from-top-1 duration-200">
                          {/* Circle marker */}
                          <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 ${
                            action.success 
                              ? "bg-emerald-500 border-emerald-950" 
                              : "bg-rose-500 border-rose-950"
                          } shadow-sm shadow-black`} />

                          {/* Step Card */}
                          <div className="p-3 bg-[#0A0B0E]/80 border border-[#1F2937] rounded-lg space-y-2 select-text hover:border-[#2A3F5F]/60 transition-colors">
                            <div className="flex items-center justify-between gap-2 select-none">
                              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                <span>STEP #{aIdx + 1}</span>
                                <span>•</span>
                                <span className="text-blue-400">
                                  {action.type === "create_file" || action.type === "write_file" ? "📁 WRITE_FILE" :
                                   action.type === "mkdir" ? "📂 MKDIR" :
                                   action.type === "delete_file" ? "🗑️ DELETE" :
                                   action.type === "run_command" ? "⚙️ EXEC_CMD" : "🛠️ WORKSPACE_ACTION"}
                                </span>
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase shrink-0 ${
                                action.success ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40" : "bg-rose-950/60 text-rose-400 border border-rose-800/40"
                              }`}>
                                {action.success ? "SUCCESS" : "FAILED"}
                              </span>
                            </div>

                            <div className="text-xs font-mono font-bold text-slate-200 break-all select-all pl-1 border-l border-slate-800">
                              {action.path || action.command}
                            </div>

                            {action.error && (
                              <div className="text-rose-400 text-[10px] font-mono pl-1.5 border-l border-rose-500/50 mt-1">
                                {action.error}
                              </div>
                            )}

                            {isCommand && action.output && (
                              <details className="mt-1.5 select-text" open={aIdx === allExecutedActions.length - 1}>
                                <summary className="text-[9px] font-mono text-slate-500 hover:text-slate-300 cursor-pointer select-none">
                                  查看控制台输出...
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-black/85 text-slate-400 rounded text-[10px] max-h-52 overflow-y-auto whitespace-pre-wrap select-text selection:bg-slate-800 leading-relaxed font-mono custom-scrollbar">
                                  {action.output}
                                </pre>
                              </details>
                            )}

                            {isFile && (
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-900 select-none">
                                <span className="text-[9px] text-slate-600 font-mono">{action.size} 字符</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRightTab("code");
                                    handleFileClick(action.path);
                                  }}
                                  className="px-2 py-0.5 bg-blue-950 hover:bg-blue-900 text-blue-300 border border-blue-900 rounded text-[9px] font-mono font-bold cursor-pointer transition-colors"
                                >
                                  在编辑器打开
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: 2. CODE EDITOR & FILES TREE DUAL PANE */}
          {rightTab === "code" && (
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden h-full">
              {/* Inner Left Pane: Files tree (Span 4) */}
              <div className="md:col-span-4 border-r border-[#1F2937]/50 flex flex-col bg-[#0A0B0E]/60 h-full overflow-hidden">
                {/* Search / Tree Type */}
                <div className="p-2 border-b border-[#1F2937] shrink-0 space-y-2 bg-[#111827]/40">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 w-3 h-3 text-slate-500" />
                    <input
                      type="text"
                      placeholder="检索工作区文件..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-7 pr-2.5 py-1.5 bg-[#020617] border border-[#1F2937] rounded text-[11px] text-slate-300 outline-none font-mono"
                    />
                  </div>
                  <div className="flex justify-between items-center gap-1">
                    <button
                      onClick={() => setTreeViewMode("core")}
                      className={`flex-1 py-1 px-1.5 rounded text-[9px] font-mono font-bold text-center border cursor-pointer transition-colors ${
                        treeViewMode === "core"
                          ? "bg-blue-950/40 text-blue-400 border-blue-500/20"
                          : "bg-slate-900/30 text-slate-500 border-transparent hover:text-slate-300"
                      }`}
                    >
                      开发
                    </button>
                    <button
                      onClick={() => setTreeViewMode("test")}
                      className={`flex-1 py-1 px-1.5 rounded text-[9px] font-mono font-bold text-center border cursor-pointer transition-colors ${
                        treeViewMode === "test"
                          ? "bg-amber-950/40 text-amber-400 border-amber-500/20"
                          : "bg-slate-900/30 text-slate-500 border-transparent hover:text-slate-300"
                      }`}
                    >
                      沙箱
                    </button>
                    <button
                      onClick={() => setTreeViewMode("trash")}
                      className={`flex-1 py-1 px-1.5 rounded text-[9px] font-mono font-bold text-center border cursor-pointer transition-colors ${
                        treeViewMode === "trash"
                          ? "bg-rose-950/40 text-rose-400 border-rose-500/20"
                          : "bg-slate-900/30 text-slate-500 border-transparent hover:text-slate-300"
                      }`}
                    >
                      回收站
                    </button>
                  </div>
                </div>

                {/* Tree Scroller */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                  {treeViewMode === "trash" ? (
                    trashLoading ? (
                      <div className="text-center py-6 text-[10px] text-slate-600 animate-pulse font-mono">[TRASH_SYNC] 同步回收站...</div>
                    ) : trashItems.length === 0 ? (
                      <div className="text-center py-6 text-[10px] text-slate-600 font-mono">回收站空空如也</div>
                    ) : (
                      <div className="space-y-1.5">
                        <button
                          onClick={handleEmptyTrash}
                          className="w-full py-1 bg-rose-950/30 hover:bg-rose-950/70 text-rose-400 border border-rose-500/20 text-[10px] font-mono rounded font-bold cursor-pointer transition-colors uppercase mb-2"
                        >
                          🗑️ 物理彻底清空
                        </button>
                        {trashItems.map((item: any) => (
                          <div key={item.id} className="p-1.5 bg-[#0A0B0E] border border-[#1F2937] rounded flex items-center justify-between text-[11px] font-mono">
                            <span className="truncate pr-2 text-slate-400" title={item.name}>{item.name}</span>
                            <div className="flex gap-1.5 shrink-0">
                              <button onClick={() => handleRestoreTrashItem(item.id)} className="text-emerald-500 hover:text-emerald-400 font-bold">还原</button>
                              <button onClick={() => handlePermanentDeleteTrashItem(item.id)} className="text-rose-500 hover:text-rose-400">粉碎</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : loading && files.length === 0 ? (
                    <div className="text-center py-8 text-[10px] text-slate-600 animate-pulse font-mono">[SYNC_FILES]</div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="text-center py-8 text-[10px] text-slate-600 font-mono">暂无匹配文件</div>
                  ) : (
                    renderFileTree(filteredFiles)
                  )}
                </div>

                {/* Inner File Creation Form */}
                <form onSubmit={handleCreateItem} className="p-2 border-t border-[#1F2937] shrink-0 bg-[#111827]/40 space-y-1.5">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setNewItemType("file")}
                      className={`flex-1 py-1 rounded text-[9px] font-mono font-bold text-center border cursor-pointer ${
                        newItemType === "file" ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/20" : "bg-[#020617] text-slate-500 border-[#1F2937]"
                      }`}
                    >
                      + File
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemType("folder")}
                      className={`flex-1 py-1 rounded text-[9px] font-mono font-bold text-center border cursor-pointer ${
                        newItemType === "folder" ? "bg-amber-950/40 text-amber-400 border-amber-500/20" : "bg-[#020617] text-slate-500 border-[#1F2937]"
                      }`}
                    >
                      + Dir
                    </button>
                  </div>
                  {newItemType && (
                    <div className="flex gap-1 animate-in slide-in-from-bottom-1 duration-150">
                      <input
                        type="text"
                        autoFocus
                        placeholder={newItemType === "file" ? "文件名 (e.g. app.py)..." : "目录路径..."}
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        className="flex-1 px-2 py-1 bg-[#020617] border border-[#1F2937] rounded text-[11px] text-slate-300 outline-none font-mono"
                      />
                      <button
                        type="submit"
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-mono text-[10px] font-bold"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewItemType(null)}
                        className="px-2 py-1 bg-slate-800 text-slate-400 rounded font-mono text-[10px]"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </form>
              </div>

              {/* Inner Right Pane: Editor (Span 8) */}
              <div className="md:col-span-8 flex flex-col h-full overflow-hidden bg-[#020617]">
                {/* Editor Toolbar Header */}
                <div className="p-2 border-b border-[#1F2937] bg-[#111827]/60 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]" title={selectedFilePath || ""}>
                      {selectedFilePath ? `File: ${selectedFilePath}` : "No file selected"}
                    </span>
                    {isDirty && (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" title="未保存的修改" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 select-none">
                    {selectedFilePath && (
                      <>
                        {!isImageFile(selectedFilePath) && (
                          <button
                            onClick={() => setIsEditing(!isEditing)}
                            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-mono font-bold uppercase cursor-pointer"
                          >
                            {isEditing ? "View" : "Edit"}
                          </button>
                        )}
                        {(isEditing || isDirty) && (
                          <button
                            onClick={handleSaveFile}
                            disabled={saveStatus === "saving"}
                            className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[9px] font-mono font-bold uppercase rounded cursor-pointer"
                          >
                            {saveStatus === "saving" ? "Saving..." : "Save"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Editor Body */}
                <div className="flex-1 overflow-hidden relative text-slate-300 select-text">
                  {selectedFilePath ? (
                    isImageFile(selectedFilePath) ? (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-black/40 overflow-auto">
                        <img
                          src={`/api/workspace/image?path=${encodeURIComponent(selectedFilePath)}`}
                          alt={selectedFilePath}
                          className="max-w-full max-h-[250px] object-contain rounded border border-[#1F2937] shadow-xl bg-black"
                        />
                        <span className="text-[10px] text-slate-500 mt-2 font-mono">{selectedFilePath}</span>
                      </div>
                    ) : isMarkdownFile(selectedFilePath) && !isEditing ? (
                      <div className="w-full h-full p-4 overflow-y-auto custom-scrollbar bg-[#030712] markdown-body text-xs leading-relaxed space-y-2">
                        <Markdown>{fileContent || "*这是一个空文件*"}</Markdown>
                      </div>
                    ) : isJsonFile(selectedFilePath) && !isEditing ? (
                      <div className="w-full h-full p-4 overflow-y-auto custom-scrollbar font-mono text-xs text-blue-300 bg-[#030712] leading-relaxed">
                        <pre className="whitespace-pre-wrap">
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
                      <textarea
                        value={fileContent}
                        onChange={(e) => setFileContent(e.target.value)}
                        className="w-full h-full p-3 font-mono text-xs bg-transparent text-slate-300 border-none outline-none focus:ring-0 resize-none leading-relaxed select-text overflow-y-auto custom-scrollbar"
                        spellCheck={false}
                      />
                    ) : (
                      <pre className="w-full h-full p-3 font-mono text-xs overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap text-slate-400 bg-transparent select-text">
                        {fileContent || <span className="text-slate-600 italic">// Empty file</span>}
                      </pre>
                    )
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-600">
                      <FileText className="w-8 h-8 mb-2 text-slate-800 animate-bounce" />
                      <h4 className="text-[11px] uppercase font-mono tracking-wider font-bold">请选择工作区开发文件</h4>
                      <p className="text-[9px] text-slate-700 max-w-[200px] mt-1">
                        在左侧小树上双击一个文件，以进入代码浏览或编辑状态。
                      </p>
                    </div>
                  )}

                  {/* Save feedback indicator */}
                  {saveStatus === "saved" && (
                    <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded shadow animate-in fade-in duration-150">
                      ✓ SAVED
                    </div>
                  )}
                  {saveStatus === "error" && (
                    <div className="absolute top-2 right-2 bg-rose-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded shadow animate-in fade-in duration-150">
                      ⚠️ ERR
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: 3. INDEXER MAP EXPLORER */}
          {rightTab === "index" && (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#020617] p-4 text-slate-300 select-text">
              {/* Indexer Toolbar */}
              <div className="flex items-center gap-2 mb-4 shrink-0 select-none">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="输入符号、类或函数名称搜索 (e.g., compile_applet, reindex)..."
                    value={indexerQuery}
                    onChange={(e) => setIndexerQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-[#0F172A] border border-[#1F2937] rounded text-xs text-slate-300 outline-none font-mono"
                  />
                </div>
                <button
                  onClick={handleReindex}
                  disabled={indexerLoading}
                  className="px-3 py-1.5 bg-purple-950/40 hover:bg-purple-900/60 text-purple-400 border border-purple-500/20 text-xs font-mono font-bold uppercase rounded cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3 h-3 ${indexerLoading ? "animate-spin" : ""}`} />
                  <span>重建索引</span>
                </button>
              </div>

              {/* Statistics Grid */}
              <div className="grid grid-cols-2 gap-3 mb-4 shrink-0 select-none">
                <div className="p-2.5 bg-[#0A0F1D]/50 border border-[#1F2937] rounded-lg text-center font-mono">
                  <span className="text-[9px] text-slate-500 block uppercase">已索引的文件总数</span>
                  <span className="text-xl font-bold text-blue-400">{files.length}</span>
                </div>
                <div className="p-2.5 bg-[#0A0F1D]/50 border border-[#1F2937] rounded-lg text-center font-mono">
                  <span className="text-[9px] text-slate-500 block uppercase">发现的核心代码符号</span>
                  <span className="text-xl font-bold text-purple-400">{indexerSymbols.length}</span>
                </div>
              </div>

              {/* Symbols Match List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {indexerLoading ? (
                  <div className="text-center py-12 text-xs font-mono text-slate-500 animate-pulse">
                    🔍 正在全盘检索依赖，请稍等...
                  </div>
                ) : indexerSymbols.length === 0 ? (
                  <div className="text-center py-12 text-xs font-mono text-slate-500">
                    💡 未检索到任何匹配的代码符号（输入检索词或点击上方 重建索引 按钮）
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {indexerSymbols.map((sym, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setRightTab("code");
                          handleFileClick(sym.filePath);
                        }}
                        className="p-2.5 bg-[#0A0B0E]/80 border border-[#1F2937] rounded-lg flex items-center justify-between gap-3 cursor-pointer hover:border-purple-500/30 transition-colors select-none"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0 font-mono ${
                            sym.type === "class" ? "bg-blue-950/40 text-blue-400 border border-blue-900/40" :
                            sym.type === "function" ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/40" :
                            "bg-slate-900 text-slate-400 border border-slate-800"
                          }`}>
                            {sym.type}
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-200 truncate" title={sym.name}>
                            {sym.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-500 font-mono shrink-0">
                          <span className="truncate max-w-[120px]">{sym.filePath.split("/").pop()}</span>
                          <span>:</span>
                          <span>{sym.line} 行</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
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
