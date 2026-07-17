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
  ShieldAlert,
  Award,
  Download,
  CheckSquare
} from "lucide-react";
import Markdown from "react-markdown";
import AgentBrainPipeline from "./AgentBrainPipeline";

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

  // Active Model Pool tracking state
  const [activeModel, setActiveModel] = useState<string>("gemini-3.5-flash");
  const [activeProvider, setActiveProvider] = useState<string>("gemini");

  const fetchActiveModel = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        if (data.activeModel) {
          setActiveModel(data.activeModel);
        }
        if (data.activeProvider) {
          setActiveProvider(data.activeProvider);
        }
      }
    } catch (e) {
      console.error("Failed to fetch active model config:", e);
    }
  };

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
  const [rightTab, setRightTab] = useState<"preview" | "code" | "index" | "deliverables">("preview");

  const [selectedDeliverablePath, setSelectedDeliverablePath] = useState<string | null>(null);
  const [deliverableContent, setDeliverableContent] = useState<string>("");
  const [deliverableLoading, setDeliverableLoading] = useState(false);
  const [generatingDemo, setGeneratingDemo] = useState(false);

  const getFlatFiles = (nodes: FileNode[]): FileNode[] => {
    let result: FileNode[] = [];
    for (const node of nodes) {
      if (node.isDirectory) {
        if (node.children) {
          result = [...result, ...getFlatFiles(node.children)];
        }
      } else {
        result.push(node);
      }
    }
    return result;
  };

  const handleSelectDeliverable = async (pathStr: string) => {
    setSelectedDeliverablePath(pathStr);
    if (pathStr.endsWith(".html")) {
      setDeliverableContent("");
      return;
    }
    setDeliverableLoading(true);
    try {
      const res = await fetch(`/api/workspace/read?path=${encodeURIComponent(pathStr)}`);
      if (res.ok) {
        const data = await res.json();
        setDeliverableContent(data.content || "");
      } else {
        setDeliverableContent("无法读取文件内容。");
      }
    } catch (e) {
      setDeliverableContent("读取文件失败。");
    } finally {
      setDeliverableLoading(false);
    }
  };

  const handleGenerateDemoDeliverables = async () => {
    setGeneratingDemo(true);
    try {
      // 1. Write Joke
      await fetch("/api/workspace/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "test_zone/joke.txt",
          content: `为什么程序员分不清万圣节（Halloween）和圣诞节（Christmas）？\n因为 Oct 31 === Dec 25 !\n(31 Octal 等于 25 Decimal)\n\n---\n\n为什么智能体自愈回路不需要人类插手？\n因为每次被 Bug 报错卡住时，它都会静静地使用 <thinking> 标签展开深度推演，然后在人类还没醒来时，全自动修复了昨晚遗留的整个编译障碍！\n\n[🎉 恭喜！这是一个由智能体生成的幽默文本交付物。]`
        })
      });

      // 2. Write Report
      await fetch("/api/workspace/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "test_zone/data_analysis_report.md",
          content: `# 📈 智能体深度执行与自愈流多维评估报告\n\n## 📊 评估结论与多维矩阵\n经过高并发安全文件缓存模块 (CacheManager) 等沙箱场景的深度压测，当前自主智能体深度流水线能力评估如下：\n\n1. **思考深度 (Thinking Quality)**: 🌟🌟🌟🌟🌟 (98%)\n   - 能精确识别多级依赖，自动识别拼写错误变量并根据报错 Traceback 建立完备的符号树。\n2. **规划能力 (Planning Precision)**: 🌟🌟🌟🌟🌟 (95%)\n   - 能够清晰拆解任务阶段，支持并发锁、并发流、临界资源防穿透控制逻辑的设计。\n3. **缺陷自愈率 (Self-Healing Success)**: 🌟🌟🌟🌟🌟 (100%)\n   - 具备强大的自主纠错。在遭遇 \`tsc\` 编译阻断报错时，能精准定位出错符号、自动实施热修复补丁并重新编译交付。\n\n## 🛠️ 下一步迭代建议\n- **性能优化**: 引入增量热编译缓存（Incremental tsc build cache）来缩减自愈回路的大中型项目时延。\n- **监控大屏**: 提供可视化流水线仪表盘，实时跟踪高并发事务锁的碰撞及处理状态。`
        })
      });

      // 3. Write Interactive Game HTML
      const gameHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>赛博霓虹：打砖块太空战机</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      background: #030712;
      color: #f3f4f6;
    }
    .neon-text {
      text-shadow: 0 0 5px #3b82f6, 0 0 10px #3b82f6, 0 0 20px #1d4ed8;
    }
    .neon-border {
      box-shadow: 0 0 5px #10b981, 0 0 15px #047857;
    }
    canvas {
      background: radial-gradient(circle, #0c1020 0%, #030712 100%);
    }
  </style>
</head>
<body class="flex flex-col items-center justify-center min-h-screen p-4 font-mono">
  <div class="max-w-2xl w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
    <!-- Header -->
    <div class="flex justify-between items-center mb-4 pb-4 border-b border-slate-800">
      <div>
        <h1 class="text-xl font-extrabold text-blue-400 tracking-wider neon-text">NEON BREAKOUT</h1>
        <p class="text-[10px] text-slate-500">智能体全自动交付的 HTML5 交互式交付物</p>
      </div>
      <div class="flex items-center gap-4 text-xs font-bold text-emerald-400">
        <div>SCORE: <span id="score" class="text-slate-200">0</span></div>
        <div>LIVES: <span id="lives" class="text-slate-200">3</span></div>
        <div>LEVEL: <span id="level" class="text-slate-200">1</span></div>
      </div>
    </div>

    <!-- Canvas Container -->
    <div class="relative rounded-lg overflow-hidden border border-slate-800/80 bg-black/40">
      <canvas id="gameCanvas" width="600" height="340" class="w-full block"></canvas>
      
      <!-- Start Overlay -->
      <div id="overlay" class="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4">
        <h2 class="text-2xl font-bold text-indigo-400 mb-2 neon-text">赛博激光打砖块</h2>
        <p class="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
          点击下方按钮或使用键盘 <span class="bg-slate-800 px-1 rounded text-slate-200">←</span> / <span class="bg-slate-800 px-1 rounded text-slate-200">→</span> 键移动，消除所有赛博高防砖块！
        </p>
        <button id="startBtn" class="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-extrabold tracking-widest uppercase rounded shadow-lg transition-transform active:scale-95 cursor-pointer">
          激活系统 (Start)
        </button>
      </div>
    </div>

    <!-- Control Bar -->
    <div class="mt-4 flex flex-col sm:flex-row justify-between items-center gap-3 text-[10px] text-slate-500 border-t border-slate-800/60 pt-4">
      <div class="flex gap-2">
        <button id="btnLeft" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded text-slate-200 select-none font-sans">左移 (←)</button>
        <button id="btnRight" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded text-slate-200 select-none font-sans">右移 (→)</button>
      </div>
      <div class="text-center sm:text-right">
        <span>🔊 内置 Web Audio 赛博脉冲音效 | 防碰撞保护已就绪</span>
      </div>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('score');
    const livesEl = document.getElementById('lives');
    const levelEl = document.getElementById('level');
    const overlay = document.getElementById('overlay');
    const startBtn = document.getElementById('startBtn');
    
    // Audio synthesis context for retro sound effects
    let audioCtx = null;
    function playSound(freq, duration, type = 'sine') {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch (e) {
        console.log('Audio synthesis not supported or blocked');
      }
    }

    // Game variables
    let score = 0;
    let lives = 3;
    let level = 1;
    let ballRadius = 6;
    let x = canvas.width / 2;
    let y = canvas.height - 30;
    let dx = 3;
    let dy = -3;
    let paddleHeight = 10;
    let paddleWidth = 80;
    let paddleX = (canvas.width - paddleWidth) / 2;
    let rightPressed = false;
    let leftPressed = false;
    
    // Bricks config
    let brickRowCount = 4;
    let brickColumnCount = 7;
    let brickWidth = 70;
    let brickHeight = 14;
    let brickPadding = 10;
    let brickOffsetTop = 30;
    let brickOffsetLeft = 30;
    
    let bricks = [];
    function initBricks() {
      for(let c=0; c<brickColumnCount; c++) {
        bricks[c] = [];
        for(let r=0; r<brickRowCount; r++) {
          bricks[c][r] = { x: 0, y: 0, status: 1 };
        }
      }
    }
    initBricks();

    // Event listeners
    document.addEventListener("keydown", keyDownHandler, false);
    document.addEventListener("keyup", keyUpHandler, false);
    
    const btnLeft = document.getElementById('btnLeft');
    const btnRight = document.getElementById('btnRight');
    
    btnLeft.addEventListener('mousedown', () => leftPressed = true);
    btnLeft.addEventListener('mouseup', () => leftPressed = false);
    btnLeft.addEventListener('touchstart', (e) => { e.preventDefault(); leftPressed = true; });
    btnLeft.addEventListener('touchend', () => leftPressed = false);
    
    btnRight.addEventListener('mousedown', () => rightPressed = true);
    btnRight.addEventListener('mouseup', () => rightPressed = false);
    btnRight.addEventListener('touchstart', (e) => { e.preventDefault(); rightPressed = true; });
    btnRight.addEventListener('touchend', () => rightPressed = false);

    function keyDownHandler(e) {
      if(e.key === "Right" || e.key === "ArrowRight") rightPressed = true;
      else if(e.key === "Left" || e.key === "ArrowLeft") leftPressed = true;
    }

    function keyUpHandler(e) {
      if(e.key === "Right" || e.key === "ArrowRight") rightPressed = false;
      else if(e.key === "Left" || e.key === "ArrowLeft") leftPressed = false;
    }

    let isPlaying = false;
    startBtn.addEventListener('click', () => {
      overlay.style.display = 'none';
      if(!isPlaying) {
        isPlaying = true;
        score = 0;
        lives = 3;
        level = 1;
        scoreEl.innerText = score;
        livesEl.innerText = lives;
        levelEl.innerText = level;
        x = canvas.width / 2;
        y = canvas.height - 30;
        dx = 3.5;
        dy = -3.5;
        initBricks();
        playSound(440, 0.2, 'square');
        draw();
      }
    });

    function collisionDetection() {
      for(let c=0; c<brickColumnCount; c++) {
        for(let r=0; r<brickRowCount; r++) {
          let b = bricks[c][r];
          if(b.status === 1) {
            if(x > b.x && x < b.x + brickWidth && y > b.y && y < b.y + brickHeight) {
              dy = -dy;
              b.status = 0;
              score += 10;
              scoreEl.innerText = score;
              playSound(600 + (r * 80), 0.1, 'sine');
              
              // Check for level complete
              let allCleared = true;
              for(let cc=0; cc<brickColumnCount; cc++) {
                for(let rr=0; rr<brickRowCount; rr++) {
                  if(bricks[cc][rr].status === 1) allCleared = false;
                }
              }
              if(allCleared) {
                level++;
                levelEl.innerText = level;
                dx += dx > 0 ? 0.5 : -0.5;
                dy += dy > 0 ? 0.5 : -0.5;
                x = canvas.width/2;
                y = canvas.height-30;
                paddleX = (canvas.width-paddleWidth)/2;
                initBricks();
                playSound(880, 0.4, 'triangle');
              }
            }
          }
        }
      }
    }

    function drawBall() {
      ctx.beginPath();
      ctx.arc(x, y, ballRadius, 0, Math.PI*2);
      ctx.fillStyle = "#60a5fa";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#3b82f6";
      ctx.fill();
      ctx.shadowBlur = 0; // reset
      ctx.closePath();
    }

    function drawPaddle() {
      ctx.beginPath();
      ctx.rect(paddleX, canvas.height - paddleHeight, paddleWidth, paddleHeight);
      ctx.fillStyle = "#10b981";
      ctx.shadowBlur = 8;
      ctx.shadowColor = "#10b981";
      ctx.fill();
      ctx.shadowBlur = 0; // reset
      ctx.closePath();
    }

    function drawBricks() {
      const colors = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"];
      for(let c=0; c<brickColumnCount; c++) {
        for(let r=0; r<brickRowCount; r++) {
          if(bricks[c][r].status === 1) {
            let brickX = (c*(brickWidth+brickPadding))+brickOffsetLeft;
            let brickY = (r*(brickHeight+brickPadding))+brickOffsetTop;
            bricks[c][r].x = brickX;
            bricks[c][r].y = brickY;
            ctx.beginPath();
            ctx.rect(brickX, brickY, brickWidth, brickHeight);
            ctx.fillStyle = colors[r % colors.length];
            ctx.fill();
            ctx.closePath();
          }
        }
      }
    }

    function draw() {
      if(!isPlaying) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBricks();
      drawBall();
      drawPaddle();
      collisionDetection();

      // Wall collision (left/right)
      if(x + dx > canvas.width-ballRadius || x + dx < ballRadius) {
        dx = -dx;
        playSound(300, 0.05, 'sine');
      }
      // Ceiling collision
      if(y + dy < ballRadius) {
        dy = -dy;
        playSound(300, 0.05, 'sine');
      } 
      // Floor collision / Paddle collision
      else if(y + dy > canvas.height - ballRadius - paddleHeight) {
        if(x > paddleX && x < paddleX + paddleWidth) {
          // Calculate angle based on where the ball hits the paddle
          let relativeHit = (x - (paddleX + paddleWidth / 2)) / (paddleWidth / 2);
          dx = relativeHit * 4;
          dy = -Math.abs(dy); // force moving up
          playSound(440, 0.08, 'triangle');
        } else if(y + dy > canvas.height-ballRadius) {
          lives--;
          livesEl.innerText = lives;
          playSound(150, 0.3, 'sawtooth');
          if(!lives) {
            overlay.style.display = 'flex';
            overlay.querySelector('h2').innerText = "赛博系统崩塌 (Game Over)";
            overlay.querySelector('p').innerText = "最终得分：" + score + " 分。智能体守护的缓存区已被全部穿透！";
            overlay.querySelector('button').innerText = "重新加载自愈机制";
            isPlaying = false;
          } else {
            x = canvas.width/2;
            y = canvas.height-30;
            dx = 3;
            dy = -3;
            paddleX = (canvas.width-paddleWidth)/2;
          }
        }
      }

      // Move paddle
      if(rightPressed && paddleX < canvas.width-paddleWidth) {
        paddleX += 5;
      } else if(leftPressed && paddleX > 0) {
        paddleX -= 5;
      }

      x += dx;
      y += dy;
      requestAnimationFrame(draw);
    }
  </script>
</body>
</html>`;

      await fetch("/api/workspace/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "test_zone/interactive_app.html",
          content: gameHtml
        })
      });

      await fetchFiles();
      showAlert("成果生成成功！", "已在 workspace/test_zone 文件夹下为您生成了三份极其震撼、且完全符合您期望的成果交付物（包括 1 份笑话 joke.txt、1 份深度分析报告 data_analysis_report.md、1 个带霓虹灯光效与音效的打砖块 HTML 游戏 interactive_app.html）！您可以在列表中点击对应项，在右侧直接预览、玩游戏或复制/下载！");
    } catch (e: any) {
      showAlert("生成失败", "生成交付物示例失败: " + e.message);
    } finally {
      setGeneratingDemo(false);
    }
  };

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
  const [simulationStatus, setSimulationStatus] = useState<string | null>(null);
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
    fetchActiveModel();
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
      fetchActiveModel();
    }
  };

  const handleStartSimulation = async () => {
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await handleCreateSession("global");
    }
    if (!sessionId) {
      showAlert("错误", "无法定位或创建对话会话，请刷新重试。");
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setSimulationStatus("智能体正在加载测试上下文环境 (Initializing)...");

    // Pre-create the initial user message
    const userMsg: any = {
      role: "user",
      timestamp: new Date().toISOString(),
      parts: [{ text: "模拟测试任务：构建一个轻量级高并发安全的文件缓存模块 (CacheManager)，附带基准测试与完整异常容灾自愈流程。" }]
    };

    // Keep track of messages in the simulated session
    let updatedMessages: any[] = [userMsg];

    // Helper to update state and database
    const updateSessionMessages = async (msgs: any[]) => {
      setSessions(prev => prev.map(s => {
        if (s.id === sessionId) {
          return { ...s, messages: msgs, updatedAt: new Date().toISOString() };
        }
        return s;
      }));
    };

    await updateSessionMessages(updatedMessages);

    // Stage 1: Thinking...
    setTimeout(async () => {
      setSimulationStatus("智能体正在进行深度思考与意图深剖 (Phase 1)...");
      const textStage1 = `<thinking>
### 1. 意图解析
用户希望构建一个高性能、并发安全的轻量级文件缓存模块 \`CacheManager\`。
核心要求：
- 支持高并发读写安全（互斥锁机制防止数据脏写与幻读）。
- 提供高并发读写的 Benchmark 压力测试。
- 演示完整的**编译异常容灾自愈流程**（Auto-Healing Loop）。

### 2. 依赖项及上下文分析
- 编译环境：Node.js v20+, TypeScript。
- 项目结构：需在 \`src/utils\` 或 \`workspace\` 下创建核心文件 \`CacheManager.ts\`。
- 系统文件操作具有完备的读写访问权限，可使用 sandbox 控制台编译与校验。

### 3. 自适应容灾自愈预案
为了演示强大的“沙箱自愈”能力，我们在首次生成代码时，将故意在一处高并发临界值判断中引入一个**拼写错误变量** \`CONCURRENCY_LIMIT_TYPO\`。在接下来的控制台编译测试（Phase 3）中，编译器将准确抛出无法找到符号的 TS 异常。系统捕捉到异常后，将自动读取报错日志行，定位代码文件行，重构该上下文并一键热修复，最后重新编译，完成 100% 验收通过交付。
</thinking>`;

      const aiMsg = {
        role: "model",
        timestamp: new Date().toISOString(),
        parts: [{ text: textStage1 }],
        executedActions: []
      };

      updatedMessages = [...updatedMessages, aiMsg];
      await updateSessionMessages(updatedMessages);

      // Stage 2: Planning...
      setTimeout(async () => {
        setSimulationStatus("智能体正在生成蓝图与任务拆解 (Phase 2)...");
        const textStage2 = textStage1 + `\n\n<planning>
### 任务拆解与开发蓝图
- **Step 1 [写入新文件]**：在当前工作区创建缓存核心 \`src/utils/CacheManager.ts\`。首版代码故意引入 \`CONCURRENCY_LIMIT_TYPO\` 从而确保触发编译期报错以进行自愈评测。
- **Step 2 [基准压力测试]**：创建基准测试脚本 \`src/utils/CacheManager.test.ts\` 用于对读写性能进行冲击性压测。
- **Step 3 [沙箱执行 & 错误捕获]**：运行 TypeScript 静态编译命令，精准捕捉未声明变量报错。
- **Step 4 [自愈热修复]**：读取编译器报错，自动修正为 \`CONCURRENCY_LIMIT = 10\` 并完成异步互斥锁补丁。
- **Step 5 [二次编译与验收]**：重新执行编译与 Benchmark 测试，100% 验收通过交付。
</planning>`;

        updatedMessages[1].parts[0].text = textStage2;
        await updateSessionMessages(updatedMessages);

        // Stage 3: Sandbox Executing (Step 1 - Write File)
        setTimeout(async () => {
          setSimulationStatus("智能体正在执行第一阶段沙箱写入：写入 CacheManager.ts (Phase 3)...");
          try {
            await fetch("/api/workspace/write", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: "test_zone/CacheManager.ts",
                content: `/**
 * 高并发安全的轻量级文件缓存模块 CacheManager
 * 具备并发控制、读写互斥和防击穿/穿透/雪崩机制
 */
import * as fs from 'fs';
import * as path from 'path';

export class CacheManager {
  private cacheDir: string;
  private locks: Map<string, boolean> = new Map();
  private memoryCache: Map<string, { value: any, expiresAt: number }> = new Map();

  constructor(cacheDir: string = './test_zone/cache_store') {
    this.cacheDir = cacheDir;
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public async get(key: string, fetcher: () => Promise<any>, ttlMs: number = 60000): Promise<any> {
    const cached = this.memoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // 故意引入一个未定义的变量进行自愈测试：
    if (CONCURRENCY_LIMIT_TYPO.get(key)) {
      while (this.locks.get(key)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return this.memoryCache.get(key)?.value;
    }

    this.locks.set(key, true);
    try {
      const value = await fetcher();
      this.memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      this.locks.delete(key);
    }
  }
}`
              })
            });
            await fetchFiles();
          } catch (e) {
            console.error("Simulation physical write 1 failed:", e);
          }

          updatedMessages[1].executedActions = [
            {
              type: "create_file",
              path: "test_zone/CacheManager.ts",
              success: true,
              size: 1824
            }
          ];
          await updateSessionMessages(updatedMessages);

          // Stage 3: Sandbox Executing (Step 2 - Test File)
          setTimeout(async () => {
            setSimulationStatus("智能体正在执行第二阶段沙箱写入：创建 Benchmark 基准测试 (Phase 3)...");
            try {
              await fetch("/api/workspace/write", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  path: "test_zone/CacheManager.test.ts",
                  content: `/**
 * CacheManager 高并发读写 Benchmark 压力测试
 */
import { CacheManager } from './CacheManager';

async function runBenchmark() {
  console.log("=== 启动高并发缓存压力测试基准检测 ===");
  const manager = new CacheManager();
  
  let counter = 0;
  const fetcher = async () => {
    counter++;
    await new Promise(resolve => setTimeout(resolve, 50));
    return \`Dynamic Data #\${counter}\`;
  };

  const startTime = Date.now();
  console.log("正在模拟 10,000 次高并发读写请求...");

  const tasks = [];
  for (let i = 0; i < 10000; i++) {
    tasks.push(manager.get("shared_key", fetcher, 5000));
  }

  const results = await Promise.all(tasks);
  const duration = Date.now() - startTime;

  console.log(\`[Success] 测试通过！\`);
  console.log(\`- 总请求量: \${results.length} 次\`);
  console.log(\`- 真实加载(Fetcher)次数: \${counter} 次\`);
  console.log(\`- 基准测试耗时: \${duration}ms\`);
}

runBenchmark().catch(console.error);`
                })
              });
              await fetchFiles();
            } catch (e) {
              console.error("Simulation physical write 2 failed:", e);
            }

            updatedMessages[1].executedActions = [
              ...updatedMessages[1].executedActions,
              {
                type: "create_file",
                path: "test_zone/CacheManager.test.ts",
                success: true,
                size: 1240
              }
            ];
            await updateSessionMessages(updatedMessages);

            // Stage 3: Sandbox Executing (Step 3 - Run Command with Error)
            setTimeout(async () => {
              setSimulationStatus("智能体正在启动控制台执行测试编译与 Benchmark (Phase 3)...");
              updatedMessages[1].executedActions = [
                ...updatedMessages[1].executedActions,
                {
                  type: "run_command",
                  command: "npx tsc test_zone/CacheManager.ts --noEmit",
                  success: false,
                  output: "test_zone/CacheManager.ts:24:9 - error TS2304: Cannot find name 'CONCURRENCY_LIMIT_TYPO'. Did you mean 'this.locks'?",
                  error: "编译失败 (typescript: noEmit)。发现 1 个阻断性类型错误：无法解析未声明的符号 'CONCURRENCY_LIMIT_TYPO'。准备自动调用智能体自愈回路，分析第 24 行上下文并启动代码自愈重写。"
                }
              ];
              await updateSessionMessages(updatedMessages);

              // Stage 3: Sandbox Executing (Step 4 - Self-Healing Hotfix)
              setTimeout(async () => {
                setSimulationStatus("⚠️ 编译失败！智能体自愈回路已激活，正在智能重构修复 (Phase 3)...");
                try {
                  await fetch("/api/workspace/write", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      path: "test_zone/CacheManager.ts",
                      content: `/**
 * 高并发安全的轻量级文件缓存模块 CacheManager
 * 具备并发控制、读写互斥和防击穿/穿透/雪崩机制
 */
import * as fs from 'fs';
import * as path from 'path';

export class CacheManager {
  private cacheDir: string;
  private locks: Map<string, boolean> = new Map();
  private memoryCache: Map<string, { value: any, expiresAt: number }> = new Map();

  constructor(cacheDir: string = './test_zone/cache_store') {
    this.cacheDir = cacheDir;
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public async get(key: string, fetcher: () => Promise<any>, ttlMs: number = 60000): Promise<any> {
    const cached = this.memoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // 成功自愈：使用正确安全的并发读写锁控制机制
    if (this.locks.get(key)) {
      while (this.locks.get(key)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return this.memoryCache.get(key)?.value;
    }

    this.locks.set(key, true);
    try {
      const value = await fetcher();
      this.memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      this.locks.delete(key);
    }
  }
}`
                    })
                  });
                  await fetchFiles();
                } catch (e) {
                  console.error("Simulation physical write 3 failed:", e);
                }

                updatedMessages[1].executedActions = [
                  ...updatedMessages[1].executedActions,
                  {
                    type: "write_file",
                    path: "test_zone/CacheManager.ts",
                    success: true,
                    size: 1850,
                    output: "[Self-Healed] 已经成功将 CacheManager.ts 第 24 行的 `CONCURRENCY_LIMIT_TYPO` 修正为常量并发控制 locks 机制。并在文件头部补充了缺少的并发锁控制逻辑。"
                  }
                ];
                await updateSessionMessages(updatedMessages);

                // Stage 3: Sandbox Executing (Step 5 - Re-Compile Success)
                setTimeout(async () => {
                  setSimulationStatus("智能自愈成功！正在重新运行编译与压力测试 (Phase 3)...");
                  updatedMessages[1].executedActions = [
                    ...updatedMessages[1].executedActions,
                    {
                      type: "run_command",
                      command: "npx tsc test_zone/CacheManager.ts --noEmit && node dist/utils/CacheManager.test.js",
                      success: true,
                      output: "[Success] TypeScript compilation passed successfully.\n[Benchmark] Thread safe cache operations:\n  - Concurrent Writes: 10,000 ops (Time: 142ms)\n  - Concurrent Reads:  20,000 ops (Time: 64ms)\n  - Thread lock status: SECURE\n  - Cache hit rate: 98.4%\nBenchmark execution completed with zero failures. High performance safe file cache delivered."
                    }
                  ];
                  await updateSessionMessages(updatedMessages);

                  // Stage 4: Retrospective & Summary Output
                  setTimeout(async () => {
                    setSimulationStatus("沙箱验收通过！正在整理自省指标与项目级质量报告 (Phase 4)...");
                    const finalResponse = textStage2 + `\n\n### 🚀 模拟测试成功：高并发文件缓存模块开发交付完成

经过 **5 步自动化生命周期迭代**，系统成功构建并测试了并发安全的 \`CacheManager\` 缓存模块。期间智能体通过**自主沙箱自愈引擎**完成了 1 次代码缺陷自修复。

#### 📦 产出交付件
1. **\`test_zone/CacheManager.ts\`**：具备读写锁与防雪崩机制的高性能缓存核心类。
2. **\`test_zone/CacheManager.test.ts\`**：10,000+ 高并发压力与基准测试脚本。

---
> 💡 智能体自主执行并已成功自愈。

<retrospective>
### 📊 智能体执行度指标与多维自省

#### 1. 核心运行指标
- **计划达成率**：100% (5/5 步骤全量落成)
- **自愈响应耗时**：2.0s 快速诊断与代码重组
- **执行安全性（Security Guard）**：未触发任何越权或危险指令限制，符合沙箱安全规则
- **压力测试表现**：写入 10k ops 耗时 142ms，并发锁零竞争锁死

#### 2. 深度复盘（Retrospective）
- **踩坑与诊断**：在首次文件写入时，程序因引用了未声明变量 \`CONCURRENCY_LIMIT_TYPO\` 导致 \`tsc\` 报错。该错误被主回路捕获后，自愈引擎精确抓取到 \`TS2304\` 报错签名，通过分析上下文，自动进行了变量重构及类型修补。
- **未来优化建议**：对于特大型项目，频繁的文件重写与 \`tsc\` 全量编译耗时可能会增大。建议在后续迭代中引入**增量热重载编译 (Incremental Compilation)** 以进一步缩减自愈回路的时延。
</retrospective>`;

                    updatedMessages[1].parts[0].text = finalResponse;
                    await updateSessionMessages(updatedMessages);

                    // Sync messages to backend!
                    try {
                      const saveRes = await fetch(`/api/workspace/chat-sessions/${sessionId}/messages/raw`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          messages: updatedMessages,
                          title: "🔍 智能体多步执行自愈评测"
                        })
                      });
                      if (saveRes.ok) {
                        const saveData = await saveRes.json();
                        if (saveData.session) {
                          setSessions(prev => prev.map(s => s.id === sessionId ? saveData.session : s));
                        }
                      }
                    } catch (e) {
                      console.error("Failed to persist simulated messages:", e);
                    }

                    setAiLoading(false);
                    setSimulationStatus(null);
                    fetchSessions();
                    showAlert("模拟评测完成", "🎉 恭喜！智能体深度执行流水线与自愈流模拟评测成功。你可以实时查看整个流在不同 Phase 下的思考、规划、执行步骤详情、报错自愈记录、日志流及最终的复盘分析指标 dashboard！");
                  }, 2000);
                }, 1500);
              }, 1500);
            }, 1500);
          }, 1500);
        }, 1500);
      }, 1500);
    }, 1500);
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
      
      {/* LEFT PANEL: AI AGENT CHAT (Span 4) */}
      <div className="lg:col-span-4 flex flex-col bg-[#0F172A] border border-[#1F2937] rounded-lg overflow-hidden shadow-xl h-full animate-in fade-in duration-200">
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
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 bg-blue-950/40 text-[9px] font-mono text-blue-400 rounded border border-blue-900/30 uppercase font-semibold">
                    {activeProvider}: {activeModel}
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
                          className={`p-3 rounded-lg text-xs leading-relaxed max-w-[92%] select-text whitespace-normal break-words ${
                            isUser
                              ? "bg-blue-600/25 border border-blue-500/20 text-slate-200"
                              : "bg-[#0A0F1D]/85 border border-slate-800 text-slate-300 w-full"
                          }`}
                        >
                          {isUser ? (
                            <p className="whitespace-pre-wrap font-mono">{msg.displayPrompt || msg.parts[0]?.text}</p>
                          ) : (
                            <AgentBrainPipeline 
                              text={msg.parts[0]?.text || ""} 
                              executedActions={msg.executedActions} 
                              timestamp={msg.timestamp} 
                            />
                          )}
                        </div>
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

      {/* RIGHT PANEL: COCKPIT WORKBENCH (Span 8) */}
      <div className="lg:col-span-8 flex flex-col gap-4 h-full">
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
              <button
                onClick={() => setRightTab("deliverables")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                  rightTab === "deliverables"
                    ? "bg-[#020617] text-amber-400 border border-[#1F2937]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Award className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                <span>成果交付 & 实时预览</span>
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
              {/* Simulation Trigger Panel */}
              <div className="mb-3 p-3 bg-gradient-to-r from-blue-950/40 to-slate-900/50 border border-blue-500/20 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 select-none animate-in fade-in duration-200">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                    <h5 className="text-xs font-mono font-bold text-blue-200 uppercase tracking-wide">智能体深度执行 & 自愈多维模拟评测</h5>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    一键启动模拟基准测试任务，完整评测智能体的【思考(Thinking)-规划(Planning)-执行(Sandbox Executing)-缺陷捕获-容灾自愈(Self-Healing)-质量复盘(Retrospective)】全链路深度自理能力。
                  </p>
                </div>
                {simulationStatus ? (
                  <div className="w-full sm:w-auto px-4 py-2 bg-blue-600/20 border border-blue-500/40 text-blue-400 text-[10px] font-mono font-bold uppercase rounded animate-pulse text-center">
                    {simulationStatus}
                  </div>
                ) : (
                  <button
                    onClick={handleStartSimulation}
                    disabled={aiLoading}
                    className="w-full sm:w-auto shrink-0 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 text-white text-[10px] font-mono font-bold uppercase rounded cursor-pointer shadow-md shadow-blue-950 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 animate-bounce" />
                    <span>启动一键模拟评测</span>
                  </button>
                )}
              </div>

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

          {/* TAB CONTENT: 4. DELIVERABLES & INTERACTIVE PREVIEW */}
          {rightTab === "deliverables" && (
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[#020617] p-4 text-slate-300 gap-4">
              {/* Left Column: Deliverables Index */}
              <div className="w-full md:w-[260px] flex flex-col gap-3 shrink-0 overflow-y-auto custom-scrollbar">
                <div className="p-3 bg-[#0A0F1D]/80 border border-[#1F2937] rounded-lg space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wide">
                    <Award className="w-4 h-4 text-amber-500" />
                    <span>成果交付中心</span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    在这里，您可以一键实时预览或运行智能体在工作区中生存交付出的任何交付成果。
                  </p>
                  <button
                    onClick={handleGenerateDemoDeliverables}
                    disabled={generatingDemo}
                    className="w-full py-2 px-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 text-white text-[10px] font-mono font-bold uppercase rounded cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-950/40"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${generatingDemo ? "animate-spin" : ""}`} />
                    <span>{generatingDemo ? "正在极速生成中..." : "一键生成标准成果样例"}</span>
                  </button>
                </div>

                {/* Grouped Files List */}
                <div className="flex-1 space-y-4">
                  {getFlatFiles(files).length === 0 ? (
                    <div className="p-4 bg-slate-900/40 border border-slate-800/60 rounded-lg text-center text-[10px] font-mono text-slate-500">
                      🫙 工作区暂无物理交付件<br/>点击上方按钮生成样例
                    </div>
                  ) : (
                    <>
                      {/* Web Frontends */}
                      {getFlatFiles(files).filter(f => f.name.endsWith(".html")).length > 0 && (
                        <div className="space-y-1.5">
                          <h6 className="text-[9px] font-mono font-extrabold text-blue-400 tracking-wider uppercase pl-1">网页 & 交互式应用 (HTML)</h6>
                          <div className="space-y-1">
                            {getFlatFiles(files).filter(f => f.name.endsWith(".html")).map((file, fIdx) => (
                              <button
                                key={fIdx}
                                onClick={() => handleSelectDeliverable(file.path)}
                                className={`w-full text-left p-2 rounded text-xs font-mono truncate transition-all flex items-center justify-between border ${
                                  selectedDeliverablePath === file.path
                                    ? "bg-blue-950/40 border-blue-500/50 text-blue-200"
                                    : "bg-slate-900/50 border-slate-800/40 text-slate-400 hover:bg-slate-800/40"
                                }`}
                              >
                                <span className="truncate">📄 {file.name}</span>
                                <span className="text-[9px] text-slate-500 font-mono shrink-0">{(file.size || 0) > 1024 ? `${((file.size || 0)/1024).toFixed(1)} KB` : `${file.size || 0} B`}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Documents & Reports */}
                      {getFlatFiles(files).filter(f => f.name.endsWith(".md") || f.name.endsWith(".txt") || f.name.endsWith(".json")).length > 0 && (
                        <div className="space-y-1.5">
                          <h6 className="text-[9px] font-mono font-extrabold text-amber-400 tracking-wider uppercase pl-1">文档 & 数据分析报告</h6>
                          <div className="space-y-1">
                            {getFlatFiles(files).filter(f => f.name.endsWith(".md") || f.name.endsWith(".txt") || f.name.endsWith(".json")).map((file, fIdx) => (
                              <button
                                key={fIdx}
                                onClick={() => handleSelectDeliverable(file.path)}
                                className={`w-full text-left p-2 rounded text-xs font-mono truncate transition-all flex items-center justify-between border ${
                                  selectedDeliverablePath === file.path
                                    ? "bg-amber-950/30 border-amber-500/40 text-amber-200"
                                    : "bg-slate-900/50 border-slate-800/40 text-slate-400 hover:bg-slate-800/40"
                                }`}
                              >
                                <span className="truncate">📝 {file.name}</span>
                                <span className="text-[9px] text-slate-500 font-mono shrink-0">{(file.size || 0) > 1024 ? `${((file.size || 0)/1024).toFixed(1)} KB` : `${file.size || 0} B`}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Code Modules */}
                      {getFlatFiles(files).filter(f => !f.name.endsWith(".html") && !f.name.endsWith(".md") && !f.name.endsWith(".txt") && !f.name.endsWith(".json")).length > 0 && (
                        <div className="space-y-1.5">
                          <h6 className="text-[9px] font-mono font-extrabold text-emerald-400 tracking-wider uppercase pl-1">核心程序 & 自愈模块</h6>
                          <div className="space-y-1">
                            {getFlatFiles(files).filter(f => !f.name.endsWith(".html") && !f.name.endsWith(".md") && !f.name.endsWith(".txt") && !f.name.endsWith(".json")).map((file, fIdx) => (
                              <button
                                key={fIdx}
                                onClick={() => handleSelectDeliverable(file.path)}
                                className={`w-full text-left p-2 rounded text-xs font-mono truncate transition-all flex items-center justify-between border ${
                                  selectedDeliverablePath === file.path
                                    ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-200"
                                    : "bg-slate-900/50 border-slate-800/40 text-slate-400 hover:bg-slate-800/40"
                                }`}
                              >
                                <span className="truncate">⚙️ {file.name}</span>
                                <span className="text-[9px] text-slate-500 font-mono shrink-0">{(file.size || 0) > 1024 ? `${((file.size || 0)/1024).toFixed(1)} KB` : `${file.size || 0} B`}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Right Column: Dynamic Preview Screen */}
              <div className="flex-1 bg-[#0A0B0E] border border-[#1F2937] rounded-lg overflow-hidden flex flex-col min-h-[300px]">
                {selectedDeliverablePath ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Preview Toolbar */}
                    <div className="bg-[#111827] px-4 py-2.5 border-b border-[#1F2937] flex items-center justify-between select-none">
                      <div className="flex items-center gap-2">
                        <span className="flex h-1.5 w-1.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-300 truncate max-w-[280px]">
                          {selectedDeliverablePath}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Download link */}
                        <a
                          href={`/api/workspace/raw-file?path=${encodeURIComponent(selectedDeliverablePath)}`}
                          download={selectedDeliverablePath.split("/").pop()}
                          className="px-2.5 py-1 bg-[#1F2937] hover:bg-slate-800 text-slate-300 text-[10px] font-mono rounded flex items-center gap-1 transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          <span>下载成果</span>
                        </a>
                        {/* Copy Code */}
                        {!selectedDeliverablePath.endsWith(".html") && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(deliverableContent);
                              showAlert("成功", "成果源码已复制到剪贴板！");
                            }}
                            className="px-2.5 py-1 bg-slate-850 hover:bg-slate-800 text-slate-300 text-[10px] font-mono rounded flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            <span>复制代码</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Preview Area */}
                    <div className="flex-1 overflow-hidden relative flex flex-col">
                      {deliverableLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-[#020617]/80 text-xs font-mono text-slate-500 animate-pulse">
                          📥 正在加载并校验物理交付件...
                        </div>
                      ) : selectedDeliverablePath.endsWith(".html") ? (
                        /* Live HTML Iframe Render! */
                        <div className="flex-1 flex flex-col">
                          <div className="p-1.5 bg-[#0D1527] border-b border-[#1F2937] flex justify-between items-center px-4 select-none">
                            <span className="text-[10px] font-mono text-blue-400">⚡ 双沙箱完全隔离 | 实时交互运行预览</span>
                            <button
                              onClick={() => {
                                const currentPath = selectedDeliverablePath;
                                setSelectedDeliverablePath(null);
                                setTimeout(() => setSelectedDeliverablePath(currentPath), 50);
                              }}
                              className="text-[9px] font-mono text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>重置运行</span>
                            </button>
                          </div>
                          <iframe
                            src={`/api/workspace/raw-file?path=${encodeURIComponent(selectedDeliverablePath)}`}
                            className="flex-1 w-full h-full bg-[#030712] border-none"
                            title="Interactive Deliverable Preview"
                            sandbox="allow-scripts allow-same-origin"
                          />
                        </div>
                      ) : selectedDeliverablePath.endsWith(".md") ? (
                        /* Beautiful formatted Markdown Document reader! */
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#030712] selection:bg-amber-500/25 select-text leading-relaxed">
                          <div className="markdown-body text-sm text-slate-300">
                            <Markdown>{deliverableContent}</Markdown>
                          </div>
                        </div>
                      ) : (
                        /* Standard code viewer */
                        <pre className="flex-1 overflow-auto custom-scrollbar p-4 bg-[#030712] text-xs font-mono text-slate-300 select-text leading-relaxed tab-size-4">
                          <code>{deliverableContent}</code>
                        </pre>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
                    <Award className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
                    <h5 className="text-sm font-mono font-bold text-slate-400 uppercase tracking-wider mb-1">
                      未选择任何交付成果
                    </h5>
                    <p className="text-xs text-slate-500 max-w-sm leading-normal">
                      请在左侧列表中点击选择要预览的成果，或者点击顶部的【一键生成标准成果样例】直接生成并运行一个完整的打砖块 HTML 交互游戏和评估报告！
                    </p>
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
