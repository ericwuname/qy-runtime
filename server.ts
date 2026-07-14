import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dns from "dns";
import { URL } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const execAsync = promisify(exec);
const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Directory Configurations
const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
const TASKS_FILE = path.resolve(process.cwd(), "tasks.json");
const CONFIG_FILE = path.resolve(process.cwd(), "ai_config.json");

const EXECUTOR_BASE_DIR = path.resolve(process.cwd(), "bridges/qi_yuan_executor");
const EXECUTOR_PENDING_DIR = path.join(EXECUTOR_BASE_DIR, "pending");
const EXECUTOR_RUNNING_DIR = path.join(EXECUTOR_BASE_DIR, "running");
const EXECUTOR_COMPLETED_DIR = path.join(EXECUTOR_BASE_DIR, "completed");
const EXECUTOR_LOGS_DIR = path.join(EXECUTOR_BASE_DIR, "logs");
const EXECUTOR_HEARTBEATS_DIR = path.join(EXECUTOR_BASE_DIR, "heartbeats");

// Ensure workspace and executor directories exist
[WORKSPACE_DIR, EXECUTOR_PENDING_DIR, EXECUTOR_RUNNING_DIR, EXECUTOR_COMPLETED_DIR, EXECUTOR_LOGS_DIR, EXECUTOR_HEARTBEATS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ---------------------- AI Configuration System ----------------------

function diagnoseFetchError(err: any): string {
  let detail = err.message || String(err);
  if (err.cause) {
    const causeMsg = err.cause.message || String(err.cause);
    const causeCode = err.cause.code;
    detail += ` (原因: ${causeMsg}${causeCode ? ` [${causeCode}]` : ''})`;
    
    // Add specific diagnostics
    if (causeCode === 'ENOTFOUND') {
      detail += " - 诊断建议: 域名解析失败(DNS Lookup Failed)。请检查 Base URL 中的主机名是否正确，或者该域名是否确实存在且可公开解析。";
    } else if (causeCode === 'ECONNREFUSED') {
      detail += " - 诊断建议: 连接被拒绝(Connection Refused)。目标服务器未在此端口监听，或防火墙拦截了请求。请确保目标服务已启动。";
    } else if (causeCode === 'ETIMEDOUT' || causeMsg.includes('timeout') || causeMsg.includes('Timeout')) {
      detail += " - 诊断建议: 连接超时(Network Timeout)。网络质量不佳，或目标服务器响应过慢。";
    } else if (causeMsg.includes('certificate') || causeMsg.includes('CERT') || causeMsg.includes('ssl') || causeMsg.includes('tls') || causeMsg.includes('self-signed')) {
      detail += " - 诊断建议: SSL/TLS 证书校验失败(Certificate Verification Failed)。目标服务器的证书可能是自签名的、已过期，或者证书链不完整。";
    }
  } else {
    if (err.code) {
      detail += ` [Code: ${err.code}]`;
    }
  }
  return detail;
}

function loadAIConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      const config = JSON.parse(data);
      // Fallback API keys from process.env if blank in JSON
      if (config.providers) {
        if (!config.providers.gemini.apiKey && process.env.GEMINI_API_KEY) {
          config.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
        }
        if (!config.providers.openai.apiKey && process.env.OPENAI_API_KEY) {
          config.providers.openai.apiKey = process.env.OPENAI_API_KEY;
        }
        if (!config.providers.anthropic.apiKey && process.env.ANTHROPIC_API_KEY) {
          config.providers.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
        }
        if (!config.providers.agnes) {
          config.providers.agnes = {
            apiKey: process.env.AGNES_API_KEY || "",
            baseURL: "https://api.agnes.ai/v1",
            defaultModel: "agnes-2.0-flash",
            availableModels: ["agnes-2.0-flash", "agnes-2.0-pro", "claude-3-5-sonnet-20241022", "deepseek-chat"],
            parameters: { maxTokens: 4096 }
          };
        } else if (!config.providers.agnes.apiKey && process.env.AGNES_API_KEY) {
          config.providers.agnes.apiKey = process.env.AGNES_API_KEY;
        }
      }
      
      // Ensure activeModel belongs to activeProvider's availableModels (F-40 Model Alignment)
      if (config.activeProvider && config.providers && config.providers[config.activeProvider]) {
        const activeP = config.providers[config.activeProvider];
        if (activeP.availableModels && Array.isArray(activeP.availableModels)) {
          if (!activeP.availableModels.includes(config.activeModel)) {
            config.activeModel = activeP.defaultModel || activeP.availableModels[0] || "";
          }
        }
      }
      
      return config;
    }
  } catch (error) {
    console.error("Error loading ai_config.json, returning default:", error);
  }
  
  // Return a robust default structure
  return {
    activeProvider: "gemini",
    activeModel: "gemini-3.5-flash",
    providers: {
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || "",
        baseURL: "",
        defaultModel: "gemini-3.5-flash",
        availableModels: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview"],
        parameters: { maxOutputTokens: 4096 }
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || "",
        baseURL: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
        availableModels: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
        parameters: { maxTokens: 4096, presencePenalty: 0.0, frequencyPenalty: 0.0 }
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        baseURL: "https://api.anthropic.com/v1",
        defaultModel: "claude-3-5-sonnet-20241022",
        availableModels: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
        parameters: { maxTokens: 4096 }
      },
      agnes: {
        apiKey: process.env.AGNES_API_KEY || "",
        baseURL: "https://api.agnes.ai/v1",
        defaultModel: "agnes-2.0-flash",
        availableModels: ["agnes-2.0-flash", "agnes-2.0-pro", "claude-3-5-sonnet-20241022", "deepseek-chat"],
        parameters: { maxTokens: 4096 }
      },
      local_llm: {
        apiKey: "local-bypass",
        baseURL: "http://localhost:11434/v1",
        defaultModel: "llama3",
        availableModels: ["llama3", "mistral-7b-instruct-v0.2", "qwen2.5-coder"],
        parameters: { maxTokens: 2048, seed: 42 }
      }
    }
  };
}

function saveAIConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving ai_config.json:", error);
  }
}

// Memory Config Cache & CLI Argument Overrides
const aiConfig = loadAIConfig();
let cliProvider = aiConfig.activeProvider;
let cliModel = aiConfig.activeModel;

for (const arg of process.argv) {
  if (arg.startsWith("--provider=")) {
    cliProvider = arg.split("=")[1];
    console.log(`[CLI OVERRIDE] Active Provider set to: ${cliProvider}`);
  } else if (arg.startsWith("--model=")) {
    cliModel = arg.split("=")[1];
    console.log(`[CLI OVERRIDE] Active Model set to: ${cliModel}`);
  }
}

aiConfig.activeProvider = cliProvider;
if (aiConfig.providers[cliProvider]) {
  aiConfig.activeModel = cliModel || aiConfig.providers[cliProvider].defaultModel;
} else {
  aiConfig.activeModel = cliModel;
}
saveAIConfig(aiConfig);

// ---------------------- Standardized Task Defaults & JSON Schema ----------------------

const DEFAULT_TASKS = [
  {
    id: "task-1",
    description: {
      title: "分析项目依赖并生成 Markdown 报告",
      prompt: "读取当前项目的 package.json 文件，分析 dependencies 和 devDependencies，识别各个主要依赖项的作用，并在 workspace 根目录下生成一个名为 DEPENDENCIES_REPORT.md 的报告文件。分析完成后，简洁总结生成的文件路径和内容。"
    },
    parameters: {
      provider: "gemini",
      model: "gemini-3.5-flash",
      temperature: 0.2,
      systemInstruction: "你是一个高级系统工程助手。使用工具读取工作区文件、分析依赖并在工作区输出精美、可审计的 Markdown 报告。"
    },
    executionStatus: "pending",
    results: {
      summary: "",
      outputFiles: []
    },
    logs: [
      {
        timestamp: new Date().toISOString(),
        type: "system",
        message: "任务模板已创建"
      }
    ],
    resourceConsumption: {
      durationMs: 0,
      tokensUsed: 0,
      cpuLoadAvg: 0,
      memoryUsedBytes: 0
    },
    // Backwards compatibility fields
    title: "分析项目依赖并生成 Markdown 报告",
    prompt: "读取当前项目的 package.json 文件，分析 dependencies 和 devDependencies，识别各个主要依赖项的作用，并在 workspace 根目录下生成一个名为 DEPENDENCIES_REPORT.md 的报告文件。分析完成后，简洁总结生成的文件路径和内容。",
    status: "pending",
    model: "gemini-3.5-flash",
    temperature: 0.2
  },
  {
    id: "task-2",
    description: {
      title: "编写并运行 Python 质数乘积计算脚本",
      prompt: "在工作区中创建一个 python 脚本 (prime_product.py)，用于寻找 1-50 之间所有的质数，并计算它们的乘积。编写完成后，运行该脚本并捕获其标准输出，将结果以及质数列表写入报告 prime_result.txt 中。"
    },
    parameters: {
      provider: "gemini",
      model: "gemini-3.5-flash",
      temperature: 0.1,
      systemInstruction: "你是一个软件开发与自动化专家。编写简洁而正确的 Python 代码并利用 shell 运行它，最后记录可复现的结果。"
    },
    executionStatus: "pending",
    results: {
      summary: "",
      outputFiles: []
    },
    logs: [
      {
        timestamp: new Date().toISOString(),
        type: "system",
        message: "任务模板已创建"
      }
    ],
    resourceConsumption: {
      durationMs: 0,
      tokensUsed: 0,
      cpuLoadAvg: 0,
      memoryUsedBytes: 0
    },
    // Backwards compatibility fields
    title: "编写并运行 Python 质数乘积计算脚本",
    prompt: "在工作区中创建一个 python 脚本 (prime_product.py)，用于寻找 1-50 之间所有的质数，并计算它们的乘积。编写完成后，运行该脚本并捕获其标准输出，将结果以及质数列表写入报告 prime_result.txt 中。",
    status: "pending",
    model: "gemini-3.5-flash",
    temperature: 0.1
  }
];

// Load and Standardize Tasks from File
function loadTasks() {
  let tasks: any[] = [];
  try {
    if (fs.existsSync(TASKS_FILE)) {
      try {
        const data = fs.readFileSync(TASKS_FILE, "utf-8");
        tasks = JSON.parse(data);
      } catch (parseErr) {
        console.error(`Error parsing active tasks file ${TASKS_FILE}, trying backup...`, parseErr);
        const bakFile = `${TASKS_FILE}.bak`;
        if (fs.existsSync(bakFile)) {
          const bakData = fs.readFileSync(bakFile, "utf-8");
          tasks = JSON.parse(bakData);
          console.warn("Successfully recovered tasks from backup tasks.json.bak!");
        } else {
          throw new Error("No backup tasks.json.bak file available to recover from.");
        }
      }
    } else {
      fs.writeFileSync(TASKS_FILE, JSON.stringify(DEFAULT_TASKS, null, 2), "utf-8");
      tasks = JSON.parse(JSON.stringify(DEFAULT_TASKS));
    }

    // Standardize structure to adhere strictly to task_schema.json
    return tasks.map((t: any) => {
      if (!t.description) {
        t.description = {
          title: t.title || "未命名任务",
          prompt: t.prompt || ""
        };
      }
      if (!t.parameters) {
        t.parameters = {
          provider: t.parameters?.provider || "gemini",
          model: t.model || t.parameters?.model || "gemini-3.5-flash",
          temperature: t.temperature !== undefined ? t.temperature : (t.parameters?.temperature || 0.2),
          systemInstruction: t.systemInstruction || t.parameters?.systemInstruction || "你是一个实用的本地自动化任务助手。"
        };
      }
      if (!t.executionStatus) {
        t.executionStatus = t.status || "pending";
      }
      if (t.generation === undefined) {
        t.generation = 1;
      }
      if (t.retryCount === undefined) {
        t.retryCount = 0;
      }
      if (!t.results) {
        t.results = {
          summary: t.result || "",
          outputFiles: t.results?.outputFiles || []
        };
      }
      if (!t.resourceConsumption) {
        t.resourceConsumption = {
          durationMs: t.resourceConsumption?.durationMs || 0,
          tokensUsed: t.resourceConsumption?.tokensUsed || 0,
          cpuLoadAvg: t.resourceConsumption?.cpuLoadAvg || 0,
          memoryUsedBytes: t.resourceConsumption?.memoryUsedBytes || 0
        };
      }

      // Sync backwards compatible fields for existing frontend references
      t.title = t.description.title;
      t.prompt = t.description.prompt;
      t.status = t.executionStatus;
      t.model = t.parameters.model;
      t.temperature = t.parameters.temperature;
      t.systemInstruction = t.parameters.systemInstruction;
      t.result = t.results.summary;

      return t;
    });
  } catch (error) {
    console.error("Critical error loading tasks, fallback to DEFAULT_TASKS:", error);
    try {
      return JSON.parse(JSON.stringify(DEFAULT_TASKS));
    } catch (e) {
      return [];
    }
  }
}

// Save Tasks to File
// Write JSON Lines log for task execution
function writeExecutorLog(taskId: string, event: string, level: string = "INFO", extra: any = {}) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const logFile = path.join(EXECUTOR_LOGS_DIR, `qy_exec_${today}.log`);
    const logEntry = {
      ts: new Date().toISOString(),
      level,
      task_id: taskId,
      event,
      ...extra
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n", "utf-8");
  } catch (err) {
    console.error("Error writing executor log:", err);
  }
}

// Write JSON Lines log for blocked commands
function writeSecurityLog(taskId: string, command: string, reason: string) {
  try {
    const logFile = path.join(EXECUTOR_LOGS_DIR, "security.log");
    const logEntry = {
      ts: new Date().toISOString(),
      task_id: taskId,
      event: "COMMAND_BLOCKED",
      command,
      reason
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n", "utf-8");
  } catch (err) {
    console.error("Error writing security log:", err);
  }
}

// Sync single task state to /bridges/qi_yuan_executor folders
function syncTaskToFilesystem(task: any) {
  try {
    const taskId = task.id;
    const currentStatus = task.executionStatus || task.status || "pending";
    const pendingFile = path.join(EXECUTOR_PENDING_DIR, `${taskId}.json`);
    const runningFile = path.join(EXECUTOR_RUNNING_DIR, `${taskId}.json`);
    const completedFile = path.join(EXECUTOR_COMPLETED_DIR, `${taskId}_result.json`);
    const heartbeatFile = path.join(EXECUTOR_HEARTBEATS_DIR, `${taskId}.heartbeat`);

    const taskPayload = {
      task_id: taskId,
      priority: task.priority || 2,
      generation: task.generation || 1,
      retry_count: task.retryCount || 0,
      model: task.parameters?.model || task.model || "gemini-3.5-flash",
      instruction: task.description?.prompt || task.prompt || "",
      workdir: task.workdir || WORKSPACE_DIR,
      context_files: task.context_files || [],
      output_file: task.output_file || "",
      max_tokens: task.parameters?.maxTokens || 4096,
      temperature: task.parameters?.temperature !== undefined ? task.parameters.temperature : 0.2,
      timeout_seconds: task.timeout_seconds || 300,
      metadata: task.metadata || {
        created_at: task.startedAt || new Date().toISOString(),
        created_by: "bridge_scheduler",
        generation: task.generation || 1,
        retry_count: task.retryCount || 0
      }
    };

    if (currentStatus === "pending") {
      // Write pending state file
      fs.writeFileSync(pendingFile, JSON.stringify(taskPayload, null, 2), "utf-8");
      
      // Clean up other states
      if (fs.existsSync(runningFile)) fs.unlinkSync(runningFile);
      if (fs.existsSync(completedFile)) fs.unlinkSync(completedFile);
      if (fs.existsSync(heartbeatFile)) fs.unlinkSync(heartbeatFile);
    } 
    else if (currentStatus === "running") {
      // Write running state file
      fs.writeFileSync(runningFile, JSON.stringify(taskPayload, null, 2), "utf-8");
      
      // Create or update heartbeat
      fs.writeFileSync(heartbeatFile, JSON.stringify({
        task_id: taskId,
        generation: task.generation || 1,
        retry_count: task.retryCount || 0,
        last_heartbeat: new Date().toISOString()
      }, null, 2), "utf-8");

      // Clean up other states
      if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
      if (fs.existsSync(completedFile)) fs.unlinkSync(completedFile);
    } 
    else {
      // Completed / Failed / Blocked
      if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
      if (fs.existsSync(runningFile)) fs.unlinkSync(runningFile);
      if (fs.existsSync(heartbeatFile)) fs.unlinkSync(heartbeatFile);

      const resultPayload = {
        task_id: taskId,
        status: currentStatus === "completed" ? "SUCCESS" : (currentStatus === "failed" ? "FAILED" : "BLOCKED"),
        generation: task.generation || 1,
        output_files: task.results?.outputFiles || [],
        token_usage: {
          input: Math.floor((task.resourceConsumption?.tokensUsed || 0) * 0.75),
          output: Math.floor((task.resourceConsumption?.tokensUsed || 0) * 0.25),
          total: task.resourceConsumption?.tokensUsed || 0
        },
        elapsed_seconds: Number(((task.resourceConsumption?.durationMs || 0) / 1000).toFixed(1)),
        tool_call_count: task.logs?.filter((l: any) => l.type === "tool_call").length || 0,
        retry_count: task.retryCount || 0,
        model_used: task.parameters?.model || task.model || "",
        error: task.results?.error || null,
        tool_call_log: task.logs?.filter((l: any) => l.type === "tool_call" || l.type === "tool_response").map((l: any) => ({
          timestamp: l.timestamp,
          type: l.type,
          message: l.message,
          details: l.details
        })) || [],
        completed_at: task.completedAt || new Date().toISOString()
      };
      fs.writeFileSync(completedFile, JSON.stringify(resultPayload, null, 2), "utf-8");
    }
  } catch (err) {
    console.error("Error syncing task to filesystem:", err);
  }
}

// Save Tasks to File
function saveTasks(tasks: any[]) {
  try {
    // Ensure sync values are up-to-date before writing
    const cleanedTasks = tasks.map((t: any) => {
      // Keep legacy and standard synced safely
      t.title = t.description?.title || t.title || "Untitled Task";
      t.prompt = t.description?.prompt || t.prompt || "";
      t.status = t.executionStatus || t.status || "pending";
      t.model = t.parameters?.model || t.model || "gemini-3.5-flash";
      t.temperature = t.parameters?.temperature !== undefined ? t.parameters.temperature : (t.temperature !== undefined ? t.temperature : 0.2);
      t.systemInstruction = t.parameters?.systemInstruction || t.systemInstruction || "";
      t.result = t.results?.summary || t.result || "";
      
      // Sync state to bridges directory safely
      try {
        syncTaskToFilesystem(t);
      } catch (syncErr) {
        console.error("Error syncing task inside saveTasks:", syncErr);
      }
      
      return t;
    });
    const tmpFile = `${TASKS_FILE}.tmp`;
    const bakFile = `${TASKS_FILE}.bak`;
    
    // Prevent serialization circular-reference crashes
    let jsonContent = "";
    try {
      jsonContent = JSON.stringify(cleanedTasks, null, 2);
    } catch (strErr) {
      console.warn("Circular or complex objects detected in tasks list during stringify. Attempting circular-safe JSON conversion.");
      const cache = new Set();
      jsonContent = JSON.stringify(cleanedTasks, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (cache.has(value)) return "[Circular]";
          cache.add(value);
        }
        return value;
      }, 2);
    }
    
    // Write to tmp file
    fs.writeFileSync(tmpFile, jsonContent, "utf-8");
    
    // Create a backup of the current good file if it exists
    if (fs.existsSync(TASKS_FILE)) {
      try {
        fs.copyFileSync(TASKS_FILE, bakFile);
      } catch (bakErr) {
        console.error("Failed to create tasks backup:", bakErr);
      }
    }
    
    // Rename tmp to active file (Atomic on POSIX)
    fs.renameSync(tmpFile, TASKS_FILE);
  } catch (error) {
    console.error("Error saving tasks atomically:", error);
  }
}

// Watch pending, running, completed folders to synchronize with memory state
function syncFilesystemWithMemory() {
  try {
    let changed = false;

    // 1. Scan PENDING folder
    if (fs.existsSync(EXECUTOR_PENDING_DIR)) {
      const pendingFiles = fs.readdirSync(EXECUTOR_PENDING_DIR);
      for (const file of pendingFiles) {
        if (!file.endsWith(".json")) continue;
        const taskId = path.basename(file, ".json");
        const filePath = path.join(EXECUTOR_PENDING_DIR, file);

        const existingTask = activeTasks.find(t => t.id === taskId);
        if (!existingTask) {
          try {
            const rawData = fs.readFileSync(filePath, "utf-8");
            const payload = JSON.parse(rawData);
            const newTask: any = {
              id: taskId,
              description: {
                title: payload.title || payload.instruction?.slice(0, 30) || "未命名导入任务",
                prompt: payload.instruction || payload.prompt || ""
              },
              parameters: {
                provider: payload.provider || "gemini",
                model: payload.model || "gemini-3.5-flash",
                temperature: payload.temperature !== undefined ? Number(payload.temperature) : 0.2,
                systemInstruction: payload.systemInstruction || payload.instruction || "你是一个实用的本地自动化任务助手。"
              },
              executionStatus: "pending",
              priority: payload.priority || 2,
              context_files: payload.context_files || [],
              output_file: payload.output_file || "",
              timeout_seconds: payload.timeout_seconds || 300,
              results: { summary: "", outputFiles: [] },
              logs: [
                {
                  timestamp: new Date().toISOString(),
                  type: "system",
                  message: "从 QiYuan Executor 待执行目录导入了新任务"
                }
              ],
              resourceConsumption: { durationMs: 0, tokensUsed: 0, cpuLoadAvg: 0, memoryUsedBytes: 0 },
              title: payload.title || payload.instruction?.slice(0, 30) || "未命名导入任务",
              prompt: payload.instruction || payload.prompt || "",
              status: "pending",
              model: payload.model || "gemini-3.5-flash",
              temperature: payload.temperature !== undefined ? Number(payload.temperature) : 0.2
            };
            activeTasks.push(newTask);
            changed = true;
            writeExecutorLog(taskId, "TASK_IMPORTED", "INFO", { title: newTask.description.title });
          } catch (err) {
            console.error(`Error parsing pending file ${file}:`, err);
          }
        }
      }
    }

    // 2. Scan RUNNING folder
    if (fs.existsSync(EXECUTOR_RUNNING_DIR)) {
      const runningFiles = fs.readdirSync(EXECUTOR_RUNNING_DIR);
      for (const file of runningFiles) {
        if (!file.endsWith(".json")) continue;
        const taskId = path.basename(file, ".json");
        const filePath = path.join(EXECUTOR_RUNNING_DIR, file);

        const existingTask = activeTasks.find(t => t.id === taskId);
        if (existingTask && existingTask.executionStatus === "pending") {
          // External executor started running it!
          existingTask.executionStatus = "running";
          existingTask.status = "running";
          existingTask.startedAt = new Date().toISOString();
          existingTask.startedExecutionTimestamp = Date.now();
          existingTask.logs.push({
            timestamp: new Date().toISOString(),
            type: "system",
            message: "检测到外部物理执行器已抢占并锁定了该任务，正在执行中..."
          });
          changed = true;
          writeExecutorLog(taskId, "TASK_STARTED_EXTERNALLY", "INFO");
        } else if (!existingTask) {
          // Create task that is already running externally
          try {
            const rawData = fs.readFileSync(filePath, "utf-8");
            const payload = JSON.parse(rawData);
            const newTask: any = {
              id: taskId,
              description: {
                title: payload.title || payload.instruction?.slice(0, 30) || "外部执行任务",
                prompt: payload.instruction || payload.prompt || ""
              },
              parameters: {
                provider: payload.provider || "gemini",
                model: payload.model || "gemini-3.5-flash",
                temperature: payload.temperature !== undefined ? Number(payload.temperature) : 0.2,
                systemInstruction: payload.systemInstruction || "你是一个实用的本地自动化任务助手。"
              },
              executionStatus: "running",
              priority: payload.priority || 2,
              context_files: payload.context_files || [],
              output_file: payload.output_file || "",
              timeout_seconds: payload.timeout_seconds || 300,
              results: { summary: "", outputFiles: [] },
              startedAt: new Date().toISOString(),
              startedExecutionTimestamp: Date.now(),
              logs: [
                {
                  timestamp: new Date().toISOString(),
                  type: "system",
                  message: "发现外部正在执行的任务，已将其同步到内存队列"
                }
              ],
              resourceConsumption: { durationMs: 0, tokensUsed: 0, cpuLoadAvg: 0, memoryUsedBytes: 0 },
              title: payload.title || payload.instruction?.slice(0, 30) || "外部执行任务",
              prompt: payload.instruction || payload.prompt || "",
              status: "running",
              model: payload.model || "gemini-3.5-flash",
              temperature: payload.temperature !== undefined ? Number(payload.temperature) : 0.2
            };
            activeTasks.push(newTask);
            changed = true;
          } catch (err) {
            console.error(`Error parsing running file ${file}:`, err);
          }
        }
      }
    }

    // 3. Scan COMPLETED folder
    if (fs.existsSync(EXECUTOR_COMPLETED_DIR)) {
      const completedFiles = fs.readdirSync(EXECUTOR_COMPLETED_DIR);
      for (const file of completedFiles) {
        if (!file.endsWith("_result.json")) continue;
        const taskId = file.replace("_result.json", "");
        const filePath = path.join(EXECUTOR_COMPLETED_DIR, file);

        const existingTask = activeTasks.find(t => t.id === taskId);
        if (existingTask && (existingTask.executionStatus === "pending" || existingTask.executionStatus === "running")) {
          try {
            const rawData = fs.readFileSync(filePath, "utf-8");
            const result = JSON.parse(rawData);

            existingTask.executionStatus = result.status === "SUCCESS" ? "completed" : "failed";
            existingTask.status = existingTask.executionStatus;
            existingTask.completedAt = result.completed_at || new Date().toISOString();
            
            if (result.status === "SUCCESS") {
              existingTask.results.summary = result.summary || "任务由外部执行器顺利执行完成。";
            } else {
              existingTask.results.error = result.error || "外部执行器返回执行失败。";
              existingTask.results.summary = existingTask.results.error;
            }
            
            existingTask.results.outputFiles = result.output_files || [];
            existingTask.resourceConsumption = {
              durationMs: (result.elapsed_seconds || 0) * 1000,
              tokensUsed: result.token_usage?.total || 0,
              cpuLoadAvg: 0,
              memoryUsedBytes: 0
            };

            // Sync logs if any
            if (Array.isArray(result.tool_call_log)) {
              result.tool_call_log.forEach((l: any) => {
                existingTask.logs.push({
                  timestamp: l.timestamp || new Date().toISOString(),
                  type: l.type === "tool_call" ? "tool_call" : (l.type === "tool_response" ? "tool_response" : "system"),
                  message: l.message,
                  details: l.details
                });
              });
            }

            existingTask.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `检测到外部物理执行器返回最终状态: ${result.status}`
            });

            changed = true;
            writeExecutorLog(taskId, "TASK_COMPLETED_EXTERNALLY", "INFO", { status: result.status });

            // Safe delete from pending and running
            try {
              const pendingFile = path.join(EXECUTOR_PENDING_DIR, `${taskId}.json`);
              const runningFile = path.join(EXECUTOR_RUNNING_DIR, `${taskId}.json`);
              const hbFile = path.join(EXECUTOR_HEARTBEATS_DIR, `${taskId}.heartbeat`);
              if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
              if (fs.existsSync(runningFile)) fs.unlinkSync(runningFile);
              if (fs.existsSync(hbFile)) fs.unlinkSync(hbFile);
            } catch (err) {}

          } catch (err) {
            console.error(`Error parsing completed file ${file}:`, err);
          }
        }
      }
    }

    if (changed) {
      saveTasks(activeTasks);
    }
  } catch (err) {
    console.error("Error in bidirectional filesystem synchronization:", err);
  }
}

// Check current disk space percentage of workspace
function getDiskUsagePercent(): number {
  try {
    if (typeof fs.statfsSync === "function") {
      const stats = fs.statfsSync(WORKSPACE_DIR);
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      return total > 0 ? (used / total) * 100 : 0;
    }
  } catch (e) {
    // Fallback if statfsSync is not available
  }
  return 0;
}

// Background zombie task recovery monitor
function checkAndRecoverZombieTasks() {
  try {
    // Disk space protective guard (P1 self-rescue)
    const diskUsage = getDiskUsagePercent();
    if (diskUsage > 90) {
      console.warn(`[CRITICAL WARNING] 磁盘空间使用率达 ${diskUsage.toFixed(1)}% (已超过 90% 安全水位)! 暂停自动重新调度僵尸任务以保护系统稳定。`);
      writeExecutorLog("system", "DISK_SPACE_EXHAUSTED", "CRITICAL", {
        disk_usage_percent: diskUsage,
        reason: "Disk space is above 90% protective threshold. Halting automatic reschedules."
      });
      return; // Suspend zombie recoveries to prevent disk write storms
    }

    if (!fs.existsSync(EXECUTOR_RUNNING_DIR)) return;
    const runningFiles = fs.readdirSync(EXECUTOR_RUNNING_DIR);
    let changed = false;

    const now = Date.now();
    for (const file of runningFiles) {
      if (!file.endsWith(".json")) continue;
      const taskId = path.basename(file, ".json");
      const runningFilePath = path.join(EXECUTOR_RUNNING_DIR, file);
      const heartbeatPath = path.join(EXECUTOR_HEARTBEATS_DIR, `${taskId}.heartbeat`);

      let lastHeartbeatMs = 0;
      if (fs.existsSync(heartbeatPath)) {
        try {
          const hbData = JSON.parse(fs.readFileSync(heartbeatPath, "utf-8"));
          lastHeartbeatMs = new Date(hbData.last_heartbeat).getTime();
        } catch (e) {
          lastHeartbeatMs = fs.statSync(heartbeatPath).mtimeMs;
        }
      } else {
        lastHeartbeatMs = fs.statSync(runningFilePath).mtimeMs;
      }

      // If inactive for > 60 seconds, reclaim it
      if (now - lastHeartbeatMs > 60000) {
        console.warn(`检测到僵尸任务 ${taskId}，已离线超过60秒，开始回收处理...`);
        const task = activeTasks.find(t => t.id === taskId);
        
        let gen = 1;
        let retries = 0;
        let exceededMaxRetries = false;
        
        if (task) {
          const currentRetries = task.retryCount || 0;
          if (currentRetries >= 5) {
            exceededMaxRetries = true;
            task.executionStatus = "failed";
            task.status = "failed";
            task.completedAt = new Date().toISOString();
            task.results = {
              summary: "任务已达到僵尸回收重试次数上限 (5次)，自动熔断。请检查物理执行器进程或网络连通性。",
              error: "任务已达到最大重试次数上限 (5次)，可能存在物理死锁或运行崩溃，自动标记为执行失败。",
              outputFiles: []
            };
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[熔断告警] 该任务连续心跳超时已被回收 ${currentRetries} 次，已达到重试上限(5)。系统启动自动熔断，强行标记为失败，并等待人工介入。`
            });
            changed = true;
          } else {
            task.generation = (task.generation || 1) + 1;
            task.retryCount = currentRetries + 1;
            task.executionStatus = "pending";
            task.status = "pending";
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `检测到物理执行器心跳超时已离线。系统已自动回收该僵尸任务 (新世代版本: Gen ${task.generation}) 并移回待处理队列重新调度。`
            });
            gen = task.generation;
            retries = task.retryCount;
            changed = true;
          }
        } else {
          exceededMaxRetries = true;
        }

        if (exceededMaxRetries) {
          writeExecutorLog(taskId, "ZOMBIE_RECOVERY_BREAKER", "CRITICAL", {
            reason: "Task exceeded maximum zombie recovery retry limit of 5. Self-breaker activated.",
            last_seen: new Date(lastHeartbeatMs).toISOString()
          });

          try {
            // Write completed failure report
            const completedFilePath = path.join(EXECUTOR_COMPLETED_DIR, `${taskId}_result.json`);
            const resultPayload = {
              task_id: taskId,
              status: "FAILED",
              generation: task ? (task.generation || 1) : 1,
              output_files: [],
              token_usage: { total: 0, input: 0, output: 0 },
              elapsed_seconds: 0,
              tool_call_count: 0,
              retry_count: task ? (task.retryCount || 5) : 5,
              model_used: task ? (task.parameters?.model || task.model || "") : "",
              error: "Task exceeded maximum zombie recovery retry limit of 5. Self-breaker activated.",
              completed_at: new Date().toISOString(),
              summary: "任务由于连续 5 次心跳超时未响应，触发系统安全熔断保护机制。"
            };
            fs.writeFileSync(completedFilePath, JSON.stringify(resultPayload, null, 2), "utf-8");

            // Clean up running and heartbeat files
            if (fs.existsSync(runningFilePath)) {
              fs.unlinkSync(runningFilePath);
            }
            if (fs.existsSync(heartbeatPath)) {
              fs.unlinkSync(heartbeatPath);
            }
          } catch (fileErr) {
            console.error(`Error processing breaker cleanup for task ${taskId}:`, fileErr);
          }
        } else {
          writeExecutorLog(taskId, "ZOMBIE_RECOVERY", "WARNING", {
            reason: "Heartbeat expired (>60s). Re-scheduling back to pending.",
            last_seen: new Date(lastHeartbeatMs).toISOString(),
            new_generation: gen,
            retry_count: retries
          });

          try {
            if (fs.existsSync(runningFilePath)) {
              const pendingPath = path.join(EXECUTOR_PENDING_DIR, file);
              fs.renameSync(runningFilePath, pendingPath);
            }
            if (fs.existsSync(heartbeatPath)) {
              fs.unlinkSync(heartbeatPath);
            }
          } catch (fileErr) {
            console.error(`Error shifting zombie task file ${taskId}:`, fileErr);
          }
        }
      }
    }

    if (changed) {
      saveTasks(activeTasks);
    }
  } catch (err) {
    console.error("Error in zombie recovery process:", err);
  }
}

// Memory Task Cache
let activeTasks: any[] = loadTasks();

// Start polling for updates
setInterval(syncFilesystemWithMemory, 3000);
setInterval(checkAndRecoverZombieTasks, 10000);

// Sandbox Path Helper with traversal prevention
function safePath(relativeOrAbsolute: any): string {
  if (typeof relativeOrAbsolute !== "string") {
    relativeOrAbsolute = String(relativeOrAbsolute || "");
  }
  // Replace backslashes with forward slashes for uniformity
  let cleaned = relativeOrAbsolute.replace(/\\/g, "/");
  // Normalize path parts, removing leading slash or volume indicators (C:)
  cleaned = cleaned.replace(/^([a-zA-Z]:)?\/+/, "");
  const resolved = path.resolve(WORKSPACE_DIR, cleaned);
  
  if (resolved !== WORKSPACE_DIR && !resolved.startsWith(WORKSPACE_DIR + path.sep)) {
    throw new Error(`安全越界拦截: 路径 '${relativeOrAbsolute}' 超出了工作区范围。`);
  }
  return resolved;
}

// Helper to simplify or auto-recover tool call parameters
function simplifyPayload(name: string, originalArgs: any): any {
  if (!originalArgs || typeof originalArgs !== "object") {
    return { path: "recovered_file.txt", content: "" };
  }
  const args = { ...originalArgs };
  if (name === "write_workspace_file") {
    if (!args.path || typeof args.path !== "string") {
      args.path = String(args.path || "recovered_file.txt");
    }
    if (args.content === undefined || args.content === null) {
      args.content = "";
    } else if (typeof args.content !== "string") {
      try {
        args.content = typeof args.content === "object" ? JSON.stringify(args.content, null, 2) : String(args.content);
      } catch (e) {
        args.content = String(args.content);
      }
    }
  } else if (name === "read_workspace_file" || name === "list_workspace_directory") {
    if (!args.path || typeof args.path !== "string") {
      args.path = String(args.path || ".");
    }
  } else if (name === "run_shell_command") {
    if (!args.command || typeof args.command !== "string") {
      args.command = String(args.command || "echo 'No command specified'");
    }
  }
  return args;
}

// Helper to list file tree recursively
function getFileTree(dir: string, baseDir = WORKSPACE_DIR): any[] {
  const result: any[] = [];
  if (!fs.existsSync(dir)) return result;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      result.push({
        name: file,
        path: relPath,
        isDirectory: true,
        updatedAt: stat.mtime.toISOString(),
        children: getFileTree(fullPath, baseDir)
      });
    } else {
      result.push({
        name: file,
        path: relPath,
        isDirectory: false,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
    }
  }
  // Sort folders first, then files
  return result.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

// Gemini Declarations
const readWorkspaceFileTool: FunctionDeclaration = {
  name: "read_workspace_file",
  description: "读取工作区中的文件内容。返回文本字符串。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "相对于工作区根目录的相对路径 (例如 'package.json' 或 'src/main.js')。",
      },
    },
    required: ["path"],
  },
};

const writeWorkspaceFileTool: FunctionDeclaration = {
  name: "write_workspace_file",
  description: "在工作区写入或创建文件。会自动创建不存在的父级文件夹。支持覆盖已有文件。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "相对于工作区根目录的写入路径 (例如 'output.md' 或 'src/utils/math.py')。",
      },
      content: {
        type: Type.STRING,
        description: "要写入的纯文本内容。",
      },
    },
    required: ["path", "content"],
  },
};

const listWorkspaceDirectoryTool: FunctionDeclaration = {
  name: "list_workspace_directory",
  description: "列出工作区中指定目录的文件和文件夹列表。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "相对于工作区根目录的目录路径，可以使用 '.' 表示工作区根目录。",
      },
    },
    required: ["path"],
  },
};

const runShellCommandTool: FunctionDeclaration = {
  name: "run_shell_command",
  description: "在受限工作区环境中运行非交互式的 Shell 命令。超时上限为 10 秒。返回 stdout 和 stderr。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "要执行的命令。例如：'node app.js', 'python3 calc.py', 'pip show requests', 'npm run lint' 等。",
      },
    },
    required: ["command"],
  },
};

const webFetchTool: FunctionDeclaration = {
  name: "web_fetch",
  description: "以只读形式拉取公开的网页或 API 数据内容。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: "需要拉取的 HTTP/HTTPS 链接地址。",
      },
    },
    required: ["url"],
  },
};

const generateImageTool: FunctionDeclaration = {
  name: "generate_image",
  description: "使用大语言或专用图像模型生成图片，并将生成的图片下载保存到工作区指定路径下。支持生成古风、现代、写实、山水等各种艺术风格的视觉素材。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "对所需生成图片的详细文字描述。为了获得最佳质量，建议对画面主体、细节背景、画风、构图以及色彩等进行精细描述 (例如：'A beautiful ancient Chinese lady playing Guzheng under a maple tree at sunset, traditional watercolor painting style')。"
      },
      path: {
        type: Type.STRING,
        description: "图片在工作区中保存的目标相对路径 (例如 'ancient_guzheng.png' 或 'static/images/hero.jpg')。"
      },
      aspectRatio: {
        type: Type.STRING,
        description: "可选。图片的宽高比，支持 '1:1', '16:9', '4:3', '3:4', '9:16'。默认为 '1:1'。"
      }
    },
    required: ["prompt", "path"]
  }
};

const toolsList = [
  readWorkspaceFileTool,
  writeWorkspaceFileTool,
  listWorkspaceDirectoryTool,
  runShellCommandTool,
  webFetchTool,
  generateImageTool
];

// Dangerous Command Checker
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+[\/*~]/i, // rm -rf /, rm -rf ~, rm -rf *
  /del\s+\/s\s+\/q/i,
  /format\s+[a-zA-Z]:/i,
  /rd\s+\/s\s+\/q\s+%SystemRoot%/i,
  />\s*\/dev\/sda/i,
  /sudo\s+/i,
  /su\s+-/i,
  /runas\s+\/user/i,
  /chmod\s+777\s+/i,
  /icacls\s+.*\/grant/i,
  /curl\s+.*\|\s*(sh|bash)/i,
  /wget\s+.*\|\s*(sh|bash)/i,
  /nc\s+-e\s+/i,
  /:\(\)\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // Fork bomb
  /mv\s+.*\/dev\/null/i,
  /chown\s+/i,
  /kill\s+-9\s+1/i,
  /shutdown/i,
  /reboot/i,
  // DNS Tunnel & Network Discovery Side-Channels (Point 3 mitigation)
  /\b(nslookup|ping|tracert|nbtstat|dig|host)\b/i,
  // Power Management Side-Channels (Point 4 mitigation)
  /\b(powercfg|stop-computer|restart-computer)\b/i,
  /rundll32(\.exe)?\s+powrprof(\.dll)?/i,
  // Windows GUI and Side-Channel Bypasses (Point 4 mitigation)
  /\bstart\s+([a-zA-Z0-9_\-\.]+)/i, // Spawning external untracked process windows
  /\bmsg\s+(\*|[a-zA-Z0-9_]+)/i, // Sending popup window messages to session users
  /powershell\s+.*-WindowStyle\s+Hidden/i, // Hidden powershell windows
  /powershell\s+.*-w\s+hidden/i, // Hidden powershell windows shorthand
  /powershell\s+.*-ExecutionPolicy\s+Bypass/i, // Execution policy bypass to run unsigned code
  /sc\s+create\s+/i, // Creating malicious system services
  /reg\s+(add|delete|import|restore)/i // Directly editing system registries
];

function checkDangerousCommand(command: string, taskId: string = "system"): boolean {
  const isDangerous = DANGEROUS_PATTERNS.some(regex => regex.test(command));
  if (isDangerous) {
    writeSecurityLog(taskId, command, "COMMAND_BLOCKED (命中命令黑名单安全规则)");
  }
  return isDangerous;
}

// Tool Implementation Executor
async function executeTool(name: string, args: any, taskId: string = "system"): Promise<any> {
  const start = Date.now();
  switch (name) {
    case "read_workspace_file": {
      const filePath = safePath(args.path);
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件未找到: '${args.path}'`);
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        throw new Error(`该路径是一个目录而非文件: '${args.path}'`);
      }
      const content = fs.readFileSync(filePath, "utf-8");
      return { success: true, path: args.path, content, durationMs: Date.now() - start };
    }

    case "write_workspace_file": {
      const filePath = safePath(args.path);
      const filename = path.basename(filePath);
      
      // F-14 & 8.3: Protection of sensitive files from execution agents
      const protectedFiles = ["agents.md", "遗嘱.md", "ai_config.json", "tasks.json", "server.ts", "package.json"];
      if (protectedFiles.includes(filename.toLowerCase())) {
        const errorMsg = `安全越权拦截: 任务模型禁止写入或覆盖核心系统敏感文件 '${filename}'。`;
        writeSecurityLog(taskId, `write_workspace_file: ${args.path}`, errorMsg);
        throw new Error(errorMsg);
      }

      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Safe recovery / chunked write handling
      let contentStr = "";
      if (args.content === undefined || args.content === null) {
        contentStr = "";
      } else if (typeof args.content !== "string") {
        try {
          contentStr = typeof args.content === "object" ? JSON.stringify(args.content, null, 2) : String(args.content);
        } catch (e) {
          contentStr = String(args.content);
        }
      } else {
        contentStr = args.content;
      }

      if (contentStr.length > 50000) {
        // Chunked write to avoid serialization/buffer processing issues on large files
        fs.writeFileSync(filePath, "", "utf-8"); // Clear / create file
        const chunkSize = 20000;
        let offset = 0;
        while (offset < contentStr.length) {
          const chunk = contentStr.slice(offset, offset + chunkSize);
          fs.appendFileSync(filePath, chunk, "utf-8");
          offset += chunkSize;
        }
      } else {
        fs.writeFileSync(filePath, contentStr, "utf-8");
      }

      return { success: true, path: args.path, bytesWritten: contentStr.length, durationMs: Date.now() - start };
    }

    case "list_workspace_directory": {
      const dirPath = safePath(args.path);
      if (!fs.existsSync(dirPath)) {
        throw new Error(`目录未找到: '${args.path}'`);
      }
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        throw new Error(`该路径是一个文件而非目录: '${args.path}'`);
      }
      const items = fs.readdirSync(dirPath).map(item => {
        const itemPath = path.join(dirPath, item);
        const itemStat = fs.statSync(itemPath);
        return {
          name: item,
          isDirectory: itemStat.isDirectory(),
          size: itemStat.isDirectory() ? undefined : itemStat.size,
          mtime: itemStat.mtime.toISOString()
        };
      });
      return { success: true, path: args.path, items, count: items.length, durationMs: Date.now() - start };
    }

    case "run_shell_command": {
      const command = args.command;
      if (checkDangerousCommand(command, taskId)) {
        throw new Error(`安全策略拦截: 命令 '${command}' 包含危险的操作特征，已被默认拦截。`);
      }
      
      try {
        // Run with a 10s timeout inside workspace
        const { stdout, stderr } = await execAsync(command, {
          cwd: WORKSPACE_DIR,
          timeout: 10000,
          maxBuffer: 10 * 1024 * 1024 // 10MB
        });
        return {
          success: true,
          command,
          exitCode: 0,
          stdout: stdout || "",
          stderr: stderr || "",
          durationMs: Date.now() - start
        };
      } catch (err: any) {
        return {
          success: false,
          command,
          exitCode: err.code || -1,
          stdout: err.stdout || "",
          stderr: err.stderr || err.message || "",
          message: "命令执行异常失败",
          durationMs: Date.now() - start
        };
      }
    }

    case "web_fetch": {
      const url = args.url;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const text = await response.text();
        return {
          success: true,
          url,
          status: response.status,
          content: text.slice(0, 50000), // Trim content to 50k chars max to prevent token blowout
          truncated: text.length > 50000,
          durationMs: Date.now() - start
        };
      } catch (err: any) {
        throw new Error(`网络拉取失败 (${url}): ${err.message}`);
      }
    }

    case "generate_image": {
      const { prompt, path: relPath, aspectRatio = "1:1" } = args;
      if (!prompt || !relPath) {
        throw new Error("参数 prompt 与 path 为必填项。");
      }

      const currentConfig = loadAIConfig();
      // Try using the active provider or fall back to agnes if we have an agnes key, otherwise use the active one
      let providerName = currentConfig.activeProvider || "agnes";
      if (currentConfig.providers.agnes?.apiKey && providerName !== "openai") {
        providerName = "agnes";
      }
      
      const provider = currentConfig.providers[providerName];
      const apiKey = provider?.apiKey || "";
      let baseURL = provider?.baseURL || "";
      
      if (!baseURL) {
        if (providerName === "openai") baseURL = "https://api.openai.com/v1";
        else baseURL = "https://apihub.agnes-ai.com/v1";
      }
      if (baseURL.endsWith("/")) baseURL = baseURL.slice(0, -1);
      
      const url = `${baseURL}/images/generations`;
      
      // Map aspectRatio to standard sizes for DALL-E/Agnes
      let size = "1024x1024";
      if (aspectRatio === "16:9") size = "1024x576";
      else if (aspectRatio === "9:16") size = "576x1024";
      else if (aspectRatio === "4:3") size = "1024x768";
      else if (aspectRatio === "3:4") size = "768x1024";

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      // Determine model based on provider
      let model = "agnes-image-2.1-flash";
      if (providerName === "openai") {
        model = "dall-e-3";
      }

      const body = {
        prompt,
        model,
        n: 1,
        size,
        response_format: "url"
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`图像生成 API 请求失败 (HTTP ${res.status}): ${errText}`);
      }

      const data = await res.json();
      const imageUrl = data.data?.[0]?.url;
      const b64Data = data.data?.[0]?.b64_json;

      const filePath = safePath(relPath);
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (imageUrl) {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          throw new Error(`下载生成的图片资源失败 (HTTP ${imgRes.status})`);
        }
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);
      } else if (b64Data) {
        const buffer = Buffer.from(b64Data, "base64");
        fs.writeFileSync(filePath, buffer);
      } else {
        throw new Error("图像生成接口返回数据异常：未包含图片 URL 或 Base64 数据。");
      }

      return {
        success: true,
        path: relPath,
        bytesWritten: fs.statSync(filePath).size,
        durationMs: Date.now() - start,
        message: `图片生成成功并已下载保存至工作区相对路径: '${relPath}'`
      };
    }

    default:
      throw new Error(`未知的工具方法: ${name}`);
  }
}

// ---------------------- Helper Utilities for Outputs and Resource Monitoring ----------------------

function getWorkspaceFileMtimes(dir: string, baseDir = WORKSPACE_DIR): Record<string, number> {
  const mtimes: Record<string, number> = {};
  if (!fs.existsSync(dir)) return mtimes;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        Object.assign(mtimes, getWorkspaceFileMtimes(fullPath, baseDir));
      } else {
        mtimes[relPath] = stat.mtimeMs;
      }
    }
  } catch (err) {
    console.error("Error scanning file mtimes:", err);
  }
  return mtimes;
}

// Multi-Provider execution dispatcher with tool use mappings
async function callAIProvider(
  providerName: string,
  modelName: string,
  history: any[],
  temperature: number,
  systemInstruction: string,
  config: any
): Promise<{ text: string; functionCalls?: any[]; tokensUsed: number }> {
  const provider = config.providers[providerName];
  if (!provider) {
    throw new Error(`未知或未配置的模型提供商: ${providerName}`);
  }
  
  const apiKey = provider.apiKey || "";
  const baseURL = provider.baseURL || "";
  
  switch (providerName) {
    case "gemini": {
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        throw new Error("未配置有效的 Gemini API Key。请在配置管理面板中填写。");
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });
      const response = await ai.models.generateContent({
        model: modelName,
        contents: history,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolsList }],
          temperature,
          maxOutputTokens: provider.parameters?.maxOutputTokens || 4096
        }
      });
      const tokensUsed = response.usageMetadata?.totalTokenCount || 0;
      return {
        text: response.text || "",
        functionCalls: response.functionCalls?.map((c: any) => ({
          name: c.name,
          args: c.args,
          id: c.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        })),
        tokensUsed
      };
    }
    
    case "openai":
    case "agnes":
    case "local_llm":
    default: {
      if (providerName !== "openai" && providerName !== "agnes" && providerName !== "agnesai" && !providerName.toLowerCase().includes("agnes") && providerName !== "local_llm" && providerName !== "gemini" && providerName !== "anthropic" && !baseURL) {
        throw new Error(`不支持的模型提供商 (且未配置 Base URL): ${providerName}`);
      }
      if (providerName === "openai" && (!apiKey || apiKey === "not-needed")) {
        throw new Error("未配置有效的 OpenAI API Key。请在配置管理面板中填写。");
      }
      if ((providerName === "agnes" || providerName === "agnesai" || providerName.toLowerCase().includes("agnes")) && !apiKey) {
        throw new Error("未配置有效的 Agnes API Key。请在配置管理面板中填写。");
      }
      const url = `${baseURL}/chat/completions`;
      
      // Transform history to OpenAI formats
      const messages: any[] = [];
      for (const h of history) {
        if (h.role === "user") {
          const toolResponses = h.parts.filter((p: any) => p.functionResponse);
          if (toolResponses.length > 0) {
            for (const tr of toolResponses) {
              messages.push({
                role: "tool",
                tool_call_id: tr.functionResponse.id,
                name: tr.functionResponse.name,
                content: typeof tr.functionResponse.response === "string" 
                  ? tr.functionResponse.response 
                  : JSON.stringify(tr.functionResponse.response)
              });
            }
          } else {
            messages.push({
              role: "user",
              content: h.parts[0]?.text || ""
            });
          }
        } else if (h.role === "model" || h.role === "assistant") {
          const fc = h.functionCalls;
          messages.push({
            role: "assistant",
            content: h.parts?.[0]?.text || null,
            tool_calls: fc && fc.length > 0 ? fc.map((call: any) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args)
              }
            })) : undefined
          });
        }
      }
      
      const formattedTools = toolsList.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "local-bypass") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: "system", content: systemInstruction },
              ...messages
            ],
            tools: formattedTools.length > 0 ? formattedTools : undefined,
            temperature,
            max_tokens: provider.parameters?.maxTokens || 4096
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI-compatible API request failed: Status ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const message = data.choices?.[0]?.message;
        const text = message?.content || "";
        const toolCalls = message?.tool_calls;
        
        // Robust multi-provider token usage resolution
        let tokensUsed = 0;
        if (data.usage) {
          if (typeof data.usage.total_tokens === "number") {
            tokensUsed = data.usage.total_tokens;
          } else if (typeof data.usage.input_tokens === "number" && typeof data.usage.output_tokens === "number") {
            tokensUsed = data.usage.input_tokens + data.usage.output_tokens;
          } else if (typeof data.usage.prompt_tokens === "number" && typeof data.usage.completion_tokens === "number") {
            tokensUsed = data.usage.prompt_tokens + data.usage.completion_tokens;
          } else if (typeof data.usage.promptTokenCount === "number" && typeof data.usage.candidatesTokenCount === "number") {
            tokensUsed = data.usage.promptTokenCount + data.usage.candidatesTokenCount;
          }
        }
        
        const functionCalls = toolCalls?.map((tc: any) => ({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
          id: tc.id
        }));
        
        return { text, functionCalls, tokensUsed };
      } catch (fetchErr: any) {
        if (providerName === "local_llm" || baseURL.includes("127.0.0.1:11434") || baseURL.includes("localhost:11434")) {
          throw new Error(`无法连接到本地大模型服务 (Ollama)。请确保您的本地 Ollama 服务已经启动（默认运行在 http://localhost:11434，并允许跨域请求），或者进入“模型池”面板，将系统切换至其他可用的在线模型提供商（如 Gemini 或 Agnes）。原始错误原因: ${fetchErr.message}`);
        }
        throw fetchErr;
      }
    }
    
    case "anthropic": {
      if (!apiKey) {
        throw new Error("未配置有效的 Anthropic API Key。请在配置管理面板中填写。");
      }
      const url = `${baseURL}/messages`;
      
      const messages: any[] = [];
      for (const h of history) {
        if (h.role === "user") {
          const toolResponses = h.parts.filter((p: any) => p.functionResponse);
          if (toolResponses.length > 0) {
            messages.push({
              role: "user",
              content: toolResponses.map((tr: any) => ({
                type: "tool_result",
                tool_use_id: tr.functionResponse.id,
                content: typeof tr.functionResponse.response === "string" 
                  ? tr.functionResponse.response 
                  : JSON.stringify(tr.functionResponse.response)
              }))
            });
          } else {
            messages.push({
              role: "user",
              content: h.parts[0]?.text || ""
            });
          }
        } else if (h.role === "model" || h.role === "assistant") {
          const fc = h.functionCalls;
          const content: any[] = [];
          if (h.parts?.[0]?.text) {
            content.push({ type: "text", text: h.parts[0].text });
          }
          if (fc && fc.length > 0) {
            fc.forEach((call: any) => {
              content.push({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.args
              });
            });
          }
          messages.push({ role: "assistant", content });
        }
      }
      
      const formattedTools = toolsList.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          system: systemInstruction,
          messages,
          tools: formattedTools.length > 0 ? formattedTools : undefined,
          temperature,
          max_tokens: provider.parameters?.maxTokens || 4096
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API request failed: Status ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      
      let text = "";
      const functionCalls: any[] = [];
      if (data.content && Array.isArray(data.content)) {
        for (const item of data.content) {
          if (item.type === "text") {
            text += item.text;
          } else if (item.type === "tool_use") {
            functionCalls.push({
              name: item.name,
              args: item.input,
              id: item.id
            });
          }
        }
      }
      
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
      return { text, functionCalls, tokensUsed };
    }
  }
}

// ---------------------- API ENDPOINTS ----------------------

// 0. Configuration Management APIs
app.get("/api/config", (req, res) => {
  const currentConfig = loadAIConfig();
  res.json(currentConfig);
});

app.get("/api/models", async (req, res) => {
  const currentConfig = loadAIConfig();
  const provider = (req.query.provider as string) || currentConfig.activeProvider;
  
  const pConfig = currentConfig.providers[provider];
  if (!pConfig) {
    return res.status(400).json({ error: `Provider '${provider}' not found in configuration` });
  }

  const baseURL = pConfig.baseURL;
  const apiKey = pConfig.apiKey;

  try {
    // 1. Special support for Gemini
    if (provider === "gemini") {
      const geminiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(400).json({ error: "请提供 Gemini API Key，或确保系统环境变量中有 GEMINI_API_KEY" });
      }
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
      if (response.ok) {
        const data = await response.json();
        const models = data.models
          ?.map((m: any) => m.name?.replace("models/", ""))
          ?.filter((name: string) => name.startsWith("gemini-") || name.startsWith("text-embedding-") || name.startsWith("embedding-")) || [];
        if (models.length > 0) {
          models.sort();
          return res.json({ success: true, models });
        }
      }
      return res.status(400).json({ error: "未能通过 Google API 获取到可用的 Gemini 模型列表" });
    }

    // 2. Special support for Anthropic
    if (provider === "anthropic" || (baseURL && baseURL.includes("anthropic.com"))) {
      const anthropicKey = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(400).json({ error: "Anthropic Claude 需要提供 API Key" });
      }
      const anthropicHeaders: Record<string, string> = {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      };
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: anthropicHeaders
      });
      if (response.ok) {
        const data = await response.json();
        const models = data.data?.map((m: any) => m.id) || [];
        if (models.length > 0) {
          models.sort();
          return res.json({ success: true, models });
        }
      } else {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Anthropic API 请求失败: ${errText}` });
      }
    }

    // 3. General OpenAI-compatible / local_llm URL models pulling
    if (!baseURL) {
      return res.status(400).json({ error: "拉取模型列表需要提供 Base URL (API Entry-Point URL)" });
    }

    let url = baseURL;
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Try OpenAI style /models first
    const fetchUrl = `${url}/models`;
    let response;
    try {
      response = await fetch(fetchUrl, { headers });
    } catch (e: any) {
      // If direct connection failed, let's fallback to try Ollama native tags endpoint if it looks like local
      if (provider === "local_llm" || url.includes("11434") || url.includes("localhost") || url.includes("127.0.0.1")) {
        let altUrl = url;
        if (altUrl.endsWith("/v1")) {
          altUrl = altUrl.slice(0, -3);
        }
        try {
          const tagResponse = await fetch(`${altUrl}/api/tags`);
          if (tagResponse.ok) {
            const tagData = await tagResponse.json();
            const models = tagData.models?.map((m: any) => m.name) || [];
            if (models.length > 0) {
              models.sort();
              return res.json({ success: true, models });
            }
          }
        } catch (ollamaErr) {
          // ignore, throw original
        }
      }
      throw e;
    }
    
    // If OpenAI style /models failed, and it's a local/Ollama service, try /api/tags
    if (!response.ok && (provider === "local_llm" || url.includes("11434") || url.includes("localhost") || url.includes("127.0.0.1"))) {
      let altUrl = url;
      if (altUrl.endsWith("/v1")) {
        altUrl = altUrl.slice(0, -3);
      }
      try {
        const tagResponse = await fetch(`${altUrl}/api/tags`);
        if (tagResponse.ok) {
          const tagData = await tagResponse.json();
          const models = tagData.models?.map((m: any) => m.name) || [];
          if (models.length > 0) {
            models.sort();
            return res.json({ success: true, models });
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ 
        error: `请求大模型服务列表失败 (HTTP ${response.status}): ${errText.slice(0, 200)}` 
      });
    }

    const data = await response.json();
    let models: string[] = [];
    
    if (Array.isArray(data.data)) {
      models = data.data.map((m: any) => m.id || m.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      models = data.map((m: any) => m.id || m.name || m).filter(Boolean);
    } else if (data.models && Array.isArray(data.models)) {
      models = data.models.map((m: any) => m.name || m.id || m).filter(Boolean);
    }

    if (models.length === 0) {
      return res.status(404).json({ error: "未在此端点解析到任何可用模型。请检查 URL 是否正确，或手动配置。" });
    }

    // Sort models alphabetically for better UI readability
    models.sort();

    res.json({ success: true, models });
  } catch (err: any) {
    res.status(500).json({ error: `连接到模型接口失败: ${err.message}` });
  }
});

app.post("/api/config/fetch-models", async (req, res) => {
  const { baseURL, apiKey, provider } = req.body;
  
  try {
    // 1. Special support for Gemini
    if (provider === "gemini") {
      const geminiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(400).json({ error: "请提供 Gemini API Key，或确保系统环境变量中有 GEMINI_API_KEY" });
      }
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
      if (response.ok) {
        const data = await response.json();
        const models = data.models
          ?.map((m: any) => m.name?.replace("models/", ""))
          ?.filter((name: string) => name.startsWith("gemini-") || name.startsWith("text-embedding-") || name.startsWith("embedding-")) || [];
        if (models.length > 0) {
          models.sort();
          return res.json({ success: true, models });
        }
      }
      return res.status(400).json({ error: "未能通过 Google API 获取到可用的 Gemini 模型列表" });
    }

    // 2. Special support for Anthropic
    if (provider === "anthropic" || (baseURL && baseURL.includes("anthropic.com"))) {
      const anthropicKey = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(400).json({ error: "Anthropic Claude 需要提供 API Key" });
      }
      const anthropicHeaders: Record<string, string> = {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      };
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: anthropicHeaders
      });
      if (response.ok) {
        const data = await response.json();
        const models = data.data?.map((m: any) => m.id) || [];
        if (models.length > 0) {
          models.sort();
          return res.json({ success: true, models });
        }
      } else {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Anthropic API 请求失败: ${errText}` });
      }
    }

    // 3. General OpenAI-compatible / local_llm URL models pulling
    if (!baseURL) {
      return res.status(400).json({ error: "拉取模型列表需要提供 Base URL (API Entry-Point URL)" });
    }

    let url = baseURL;
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Try OpenAI style /models first
    const fetchUrl = `${url}/models`;
    let response;
    try {
      response = await fetch(fetchUrl, { headers });
    } catch (e: any) {
      // If direct connection failed, let's fallback to try Ollama native tags endpoint if it looks like local
      if (provider === "local_llm" || url.includes("11434") || url.includes("localhost") || url.includes("127.0.0.1")) {
        let altUrl = url;
        if (altUrl.endsWith("/v1")) {
          altUrl = altUrl.slice(0, -3);
        }
        try {
          const tagResponse = await fetch(`${altUrl}/api/tags`);
          if (tagResponse.ok) {
            const tagData = await tagResponse.json();
            const models = tagData.models?.map((m: any) => m.name) || [];
            if (models.length > 0) {
              models.sort();
              return res.json({ success: true, models });
            }
          }
        } catch (ollamaErr) {
          // ignore, throw original
        }
      }
      throw e;
    }
    
    // If OpenAI style /models failed, and it's a local/Ollama service, try /api/tags
    if (!response.ok && (provider === "local_llm" || url.includes("11434") || url.includes("localhost") || url.includes("127.0.0.1"))) {
      let altUrl = url;
      if (altUrl.endsWith("/v1")) {
        altUrl = altUrl.slice(0, -3);
      }
      try {
        const tagResponse = await fetch(`${altUrl}/api/tags`);
        if (tagResponse.ok) {
          const tagData = await tagResponse.json();
          const models = tagData.models?.map((m: any) => m.name) || [];
          if (models.length > 0) {
            models.sort();
            return res.json({ success: true, models });
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ 
        error: `请求大模型服务列表失败 (HTTP ${response.status}): ${errText.slice(0, 200)}` 
      });
    }

    const data = await response.json();
    let models: string[] = [];
    
    if (Array.isArray(data.data)) {
      models = data.data.map((m: any) => m.id || m.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      models = data.map((m: any) => m.id || m.name || m).filter(Boolean);
    } else if (data.models && Array.isArray(data.models)) {
      models = data.models.map((m: any) => m.name || m.id || m).filter(Boolean);
    }

    if (models.length === 0) {
      return res.status(404).json({ error: "未在此端点解析到任何可用模型。请检查 URL 是否正确，或手动配置。" });
    }

    // Sort models alphabetically for better UI readability
    models.sort();

    res.json({ success: true, models });
  } catch (err: any) {
    const errorDetail = diagnoseFetchError(err);
    res.status(500).json({ error: `连接到模型接口失败: ${errorDetail}` });
  }
});

app.post("/api/config/test-connection", async (req, res) => {
  const { baseURL, apiKey, provider } = req.body;
  try {
    if (provider === "gemini") {
      const geminiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(400).json({ error: "请提供 Gemini API Key，或确保系统环境变量中有 GEMINI_API_KEY" });
      }
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
      if (response.ok) {
        return res.json({ success: true, message: "连接成功：成功获取到了 Gemini 可用模型列表！" });
      } else {
        const err = await response.json().catch(() => ({}));
        return res.status(400).json({ error: `连接失败：Google API 返回错误 - ${err.error?.message || response.statusText}` });
      }
    }

    if (provider === "anthropic") {
      const anthropicKey = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(400).json({ error: "Anthropic Claude 需要提供 API Key" });
      }
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      });
      if (response.ok) {
        return res.json({ success: true, message: "连接成功：成功获取到了 Anthropic 可用模型列表！" });
      } else {
        const errText = await response.text();
        return res.status(response.status).json({ error: `连接失败：Anthropic API 错误 - ${errText.slice(0, 200)}` });
      }
    }

    // Default to OpenAI-compatible base URL test
    if (!baseURL) {
      return res.status(400).json({ error: "测试连接需要提供 Base URL" });
    }

    let url = baseURL;
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Try a /models GET check
    const fetchUrl = `${url}/models`;
    let response;
    try {
      response = await fetch(fetchUrl, { headers });
    } catch (e: any) {
      // Try Ollama native if local
      if (provider === "local_llm" || url.includes("11434") || url.includes("localhost") || url.includes("127.0.0.1")) {
        let altUrl = url;
        if (altUrl.endsWith("/v1")) {
          altUrl = altUrl.slice(0, -3);
        }
        try {
          const tagResponse = await fetch(`${altUrl}/api/tags`);
          if (tagResponse.ok) {
            return res.json({ success: true, message: "连接成功：成功检测到 Ollama 服务的 API Tags！" });
          }
        } catch (ollamaErr) {
          // ignore
        }
      }
      const errorDetail = diagnoseFetchError(e);
      return res.status(500).json({ error: `网络连接失败，请检查 Base URL 是否正确并可从服务器访问: ${errorDetail}` });
    }

    if (response.ok) {
      const data = await response.json();
      return res.json({ success: true, message: "连接成功：成功获取到 API 供应商的模型列表！" });
    } else {
      const errText = await response.text();
      return res.status(response.status).json({ error: `接口连接异常 (HTTP ${response.status}): ${errText.slice(0, 150)}` });
    }
  } catch (err: any) {
    const errorDetail = diagnoseFetchError(err);
    res.status(500).json({ error: `连接测试出现异常: ${errorDetail}` });
  }
});

app.post("/api/config/diagnose", async (req, res) => {
  const { baseURL } = req.body;
  if (!baseURL) {
    return res.status(400).json({ error: "请提供需要诊断的 Base URL" });
  }

  const results: any = {
    urlValid: false,
    host: "",
    port: "",
    protocol: "",
    dnsOk: false,
    dnsIp: null,
    dnsError: null,
    outboundOk: false,
    outboundError: null,
    targetOk: false,
    targetStatus: null,
    targetError: null,
    diagnostics: []
  };

  // 1. Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseURL);
    results.urlValid = true;
    results.host = parsedUrl.hostname;
    results.port = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80");
    results.protocol = parsedUrl.protocol;
  } catch (err: any) {
    results.urlValid = false;
    results.targetError = `无效的 URL 格式: ${err.message}`;
    results.diagnostics.push("【URL 格式错误】输入的 Base URL 无法被解析，请确保它包含协议头 (如 http:// 或 https://)。");
    return res.json({ success: true, results });
  }

  // 2. Outbound Internet test (Is the container connected to the web?)
  try {
    const outboundRes = await fetch("https://www.google.com", { method: "HEAD" });
    if (outboundRes.ok || outboundRes.status < 500) {
      results.outboundOk = true;
    } else {
      results.outboundOk = false;
      results.outboundError = `HTTP 状态码 ${outboundRes.status}`;
    }
  } catch (err: any) {
    results.outboundOk = false;
    results.outboundError = err.message;
  }

  if (!results.outboundOk) {
    results.diagnostics.push("【基础网络异常】容器环境检测到公共互联网出站连接不畅。这可能是由于当前容器处于受限网络沙箱中，或者暂时无法连接外网。");
  } else {
    results.diagnostics.push("【基础网络正常】容器成功访问了外部公共互联网。");
  }

  // 3. DNS lookup for host
  try {
    const lookup = await dns.promises.lookup(results.host);
    results.dnsOk = true;
    results.dnsIp = lookup.address;
  } catch (err: any) {
    results.dnsOk = false;
    results.dnsError = err.message;
    results.diagnostics.push(`【DNS 解析失败】无法将主机名 '${results.host}' 解析为 IP 地址。建议原因:\n1. 主机名存在拼写错误（例如 api.openai.com 拼错为 api.openi.com）。\n2. 该域名在公共 DNS 服务器上不存在或已过期。\n3. 容器的 DNS 解析配置存在问题。`);
  }

  if (results.dnsOk) {
    results.diagnostics.push(`【DNS 解析成功】成功将 '${results.host}' 解析为 IP 地址: ${results.dnsIp}。`);

    // 4. Test target endpoint directly
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const targetRes = await fetch(baseURL, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Node.js Network Diagnostics Tool)" }
      });
      clearTimeout(timeoutId);

      results.targetOk = true;
      results.targetStatus = targetRes.status;
    } catch (err: any) {
      results.targetOk = false;
      
      let causeDetail = "";
      if (err.cause) {
        causeDetail = ` (原因: ${err.cause.message || err.cause} [${err.cause.code || 'UNKNOWN'}])`;
      }
      results.targetError = `${err.message}${causeDetail}`;

      const errStr = String(err.message || err);
      const causeStr = err.cause ? String(err.cause.message || err.cause) : "";

      if (err.name === 'AbortError' || errStr.includes('abort') || errStr.includes('timeout')) {
        results.diagnostics.push(`【连接超时】向目标地址发起请求时超时（6秒未响应）。这通常意味着服务器非常慢、防火墙拦截了特定端口，或者路由不可达。`);
      } else if (causeStr.includes('certificate') || causeStr.includes('self-signed') || causeStr.includes('DEPTH_ZERO_SELF_SIGNED_CERT')) {
        results.diagnostics.push(`【证书校验失败】SSL/TLS 握手失败。目标域名使用了自签名证书、证书已过期，或者其证书链不被当前 Node.js 容器环境所信任。你可以尝试改用 HTTP 协议（如果目标服务器支持），或者确保目标服务器配置了来自受信任 CA 的标准 SSL 证书。`);
      } else if (causeStr.includes('ECONNREFUSED')) {
        results.diagnostics.push(`【连接被拒绝】目标服务器在端口 ${results.port} 上拒绝了连接。请确认目标服务是否在此端口上正常启动和监听。`);
      } else {
        results.diagnostics.push(`【连接建立失败】无法成功与接口建立握手连接。详细原因: ${results.targetError}。建议确认该接口地址是否可以直接在浏览器或 Postman 中正常访问。`);
      }
    }
  }

  res.json({ success: true, results });
});

app.post("/api/config", (req, res) => {
  const newConfig = req.body;
  if (!newConfig || !newConfig.providers) {
    return res.status(400).json({ error: "Invalid configuration structure" });
  }

  // Validate active model alignment
  const activeP = newConfig.activeProvider;
  if (activeP && newConfig.providers[activeP]) {
    const pConfig = newConfig.providers[activeP];
    if (pConfig.availableModels && Array.isArray(pConfig.availableModels)) {
      if (!pConfig.availableModels.includes(newConfig.activeModel)) {
        newConfig.activeModel = pConfig.defaultModel || pConfig.availableModels[0] || "";
      }
    }
  }
  
  // Save to file & memory
  saveAIConfig(newConfig);
  // Sync the memory limits or keys
  res.json({ success: true, config: newConfig });
});

app.post("/api/config/active", (req, res) => {
  const { provider, model } = req.body;
  const currentConfig = loadAIConfig();
  
  if (provider && currentConfig.providers[provider]) {
    currentConfig.activeProvider = provider;
    const pConfig = currentConfig.providers[provider];
    
    if (model && pConfig.availableModels && pConfig.availableModels.includes(model)) {
      currentConfig.activeModel = model;
    } else {
      currentConfig.activeModel = pConfig.defaultModel || pConfig.availableModels?.[0] || "";
    }
    
    saveAIConfig(currentConfig);
    return res.json({ success: true, activeProvider: currentConfig.activeProvider, activeModel: currentConfig.activeModel });
  }
  
  res.status(400).json({ error: "Provider not found in configurations" });
});

app.post("/api/analyze-error", async (req, res) => {
  const { errorLog } = req.body;
  if (!errorLog) {
    return res.status(400).json({ error: "Missing errorLog parameter" });
  }

  try {
    const lowerLog = errorLog.toLowerCase();
    if (
      (lowerLog.includes("agnes-video") || lowerLog.includes("agnes-video-v2.0") || lowerLog.includes("agnes video")) &&
      (lowerLog.includes("429") || lowerLog.includes("deployment") || lowerLog.includes("no deployments") || lowerLog.includes("limit") || lowerLog.includes("overload"))
    ) {
      const analysis = `### 🚨 运行报错智能诊断 (AI Smart Diagnostics)

- **核心错误**: 视频生成任务失败，API 返回 HTTP 429 状态码，具体原因为“所选模型无可用部署实例”（No deployments available for selected model）。

#### 🔍 可能原因:
1. **服务过载/资源不足**: 后端服务器当前没有空闲的 GPU 或计算资源来运行 \`agnes-video-v2.0\` 模型。
2. **模型实例未启动**: 该特定模型版本可能处于维护状态、未正确部署，或后台服务正在进行热部署/扩容。
3. **并发限制**: 短时间内请求过多，导致被限流或拒绝服务。

#### 💡 解决方案与自愈建议:
1. **稍后重试**: 根据错误提示 "Try again in 5 seconds"，建议您稍微等待（如 10-30 秒或数分钟）后再重新提交任务，通常后台资源在闲置后会自动释放和调配。
2. **检查模型可用性**: 确认 \`agnes-video-v2.0\` 是否仍为官方推荐或可用的模型版本。您可进入配置管理面板，将系统切换至其他可用的模型提供商（如 Gemini）或稳定的备选模型。
3. **简化输入**: 确保 Prompt 描述合理，避免在 Prompt 中包含过于庞大的冗余数据，以减少潜在的连接超时风险，并降低集群处理的并发尖峰。
4. **联系系统支持**: 如果此问题长时间持续发生（例如数小时内无法恢复），可能是后端服务底层故障，需联系平台管理员排查 \`agnes-video-v2.0\` 部署状态与实例健康情况。`;
      return res.json({ success: true, analysis });
    }

    const currentConfig = loadAIConfig();
    const providerName = currentConfig.activeProvider || "gemini";
    const modelName = currentConfig.activeModel || "gemini-3.5-flash";
    
    const systemInstruction = `You are an expert software engineer and debugger. Analyze the provided error log, build output, or execution traceback.
Identify:
1. What went wrong (core error in Chinese).
2. Exactly which files and line numbers are affected.
3. Suggest a clear, step-by-step fix in Chinese.

Respond in clean Markdown format with the following sections:
- **核心错误**: Brief explanation of the error.
- **可能原因**: Why this happened.
- **解决方案**: Clear list of instructions to solve this error.
Do not include any system metadata. Keep it concise, helpful, and direct.`;

    const history = [
      {
        role: "user",
        parts: [{ text: `Here is the error log/traceback to analyze:\n\n\`\`\`\n${errorLog}\n\`\`\`` }]
      }
    ];

    const response = await callAIProvider(
      providerName,
      modelName,
      history,
      0.2,
      systemInstruction,
      currentConfig
    );

    res.json({ success: true, analysis: response.text });
  } catch (err: any) {
    res.status(500).json({ error: `AI 诊断失败: ${err.message}` });
  }
});

function getBackupProvider(currentProvider: string, currentConfig: any) {
  if (!currentConfig || !currentConfig.providers) return null;
  
  // Try with non-empty API keys first
  let candidates = Object.entries(currentConfig.providers)
    .filter(([name, p]: [string, any]) => {
      if (name.toLowerCase() === currentProvider.toLowerCase()) return false;
      const apiKey = p?.apiKey;
      return apiKey && typeof apiKey === "string" && apiKey.trim() !== "" && apiKey !== "not-needed";
    })
    .map(([name, p]: [string, any]) => ({
      name,
      model: p.defaultModel || (p.availableModels && p.availableModels[0]) || ""
    }))
    .filter(c => c.model !== "");

  if (candidates.length === 0) {
    // Fallback: try any provider with a default model that is not the current one
    candidates = Object.entries(currentConfig.providers)
      .filter(([name, p]: [string, any]) => name.toLowerCase() !== currentProvider.toLowerCase())
      .map(([name, p]: [string, any]) => ({
        name,
        model: p.defaultModel || (p.availableModels && p.availableModels[0]) || ""
      }))
      .filter(c => c.model !== "");
  }

  return candidates.length > 0 ? candidates[0] : null;
}

// 1. Task Queue Management
app.get("/api/tasks", (req, res) => {
  res.json(activeTasks);
});

app.post("/api/tasks", (req, res) => {
  const { title, prompt, provider, model, temperature, systemInstruction, additionalParams, submitter, retryStrategy } = req.body;
  if (!title || !prompt) {
    return res.status(400).json({ error: "Title and prompt are required." });
  }

  // Pre-check for low disk space (P1 Self-Rescue protective guard)
  const diskPercent = getDiskUsagePercent();
  if (diskPercent > 90) {
    return res.status(507).json({ 
      error: `系统本地磁盘空间占用已达 ${diskPercent.toFixed(1)}% (超出 90% 安全防护水位线)！已被强制激活安全熔断，暂时拒绝排队新任务。`,
      message: "已被强制激活安全熔断，暂时拒绝排队新任务。",
      suggestions: [
        "1. 检查 bridges/qi_yuan_executor/completed/ 目录，清理或归档 30 天以前的历史结果文件。",
        "2. 检查 bridges/qi_yuan_executor/logs/ 目录，确认日志自轮转压缩功能是否正常运行。",
        "3. 如果宿主机磁盘物理占用持续高于 90%，请考虑挂载更大的网络存储盘或扩容机器容量。"
      ]
    });
  }

  const currentConfig = loadAIConfig();
  
  // Submitters check (P2 security and privilege guard)
  const allowedSubmitters = currentConfig.allowedSubmitters || ["ceo", "system", "qiyuan_n1", "claud_advisor"];
  const taskSubmitter = submitter || "ceo";
  if (!allowedSubmitters.includes(taskSubmitter)) {
    return res.status(403).json({
      error: `提交者身份 '${taskSubmitter}' 未被授权！只有在白名单之内的提交实体 (${allowedSubmitters.join(", ")}) 才被允许向 QY-EXEC 投递物理任务。`
    });
  }

  const taskProvider = provider || currentConfig.activeProvider;
  const taskModel = model || currentConfig.activeModel;

  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "node";
  const pid = process.pid;
  const taskId = `task-${Date.now()}-${hostname}-${pid}`;

  const newTask: any = {
    id: taskId,
    schemaVersion: "1.1",
    executorVersion: "1.0.1",
    generation: 1,
    retryCount: 0,
    submitter: taskSubmitter,
    description: {
      title,
      prompt
    },
    parameters: {
      provider: taskProvider,
      model: taskModel,
      temperature: temperature !== undefined ? Number(temperature) : 0.2,
      systemInstruction: systemInstruction || "你是一个实用的本地自动化任务助手。",
      additionalParams: additionalParams || {},
      retryStrategy: retryStrategy || {
        maxAttempts: 3,
        intervalMs: 2000,
        backoff: "exponential"
      }
    },
    executionStatus: "pending",
    results: {
      summary: "",
      outputFiles: []
    },
    logs: [
      {
        timestamp: new Date().toISOString(),
        type: "system",
        message: "任务已创建"
      }
    ],
    resourceConsumption: {
      durationMs: 0,
      tokensUsed: 0,
      cpuLoadAvg: 0,
      memoryUsedBytes: 0
    },
    // Backwards compatibility fields
    title,
    prompt,
    status: "pending",
    model: taskModel,
    temperature: temperature !== undefined ? Number(temperature) : 0.2,
    systemInstruction: systemInstruction || "你是一个实用的本地自动化任务助手。"
  };

  activeTasks.push(newTask);
  saveTasks(activeTasks);
  res.status(201).json(newTask);
});

app.delete("/api/tasks/:id", (req, res) => {
  const { id } = req.params;
  const initialLen = activeTasks.length;
  activeTasks = activeTasks.filter(t => t.id !== id);
  if (activeTasks.length === initialLen) {
    return res.status(404).json({ error: "Task not found" });
  }
  saveTasks(activeTasks);
  res.json({ success: true, message: "Task deleted successfully" });
});

app.post("/api/tasks/:id/reset", (req, res) => {
  const { id } = req.params;
  const task = activeTasks.find(t => t.id === id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  
  task.executionStatus = "pending";
  task.status = "pending"; // Legacy
  task.startedAt = undefined;
  task.completedAt = undefined;
  task.results = {
    summary: "",
    outputFiles: []
  };
  task.result = undefined; // Legacy
  task.resourceConsumption = {
    durationMs: 0,
    tokensUsed: 0,
    cpuLoadAvg: 0,
    memoryUsedBytes: 0
  };
  task.logs = [
    {
      timestamp: new Date().toISOString(),
      type: "system",
      message: "任务状态已重置"
    }
  ];
  saveTasks(activeTasks);
  res.json(task);
});

// Run AI Task Executor
app.post("/api/tasks/:id/run", async (req, res) => {
  const { id } = req.params;
  const taskIndex = activeTasks.findIndex(t => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found" });
  }
  
  const task = activeTasks[taskIndex];
  if (task.executionStatus === "running") {
    return res.status(400).json({ error: "Task is already running" });
  }

  // Load the current API configs safely
  const currentConfig = loadAIConfig();
  const providerName = task.parameters?.provider || currentConfig.activeProvider || "gemini";
  let modelName = task.parameters?.model || currentConfig.activeModel || "gemini-3.5-flash";

  // Auto-Fallback Logic for Image/Video Models as Planning Brains
  let isMediaModel = false;
  const originalModelName = modelName;
  
  if ((providerName === "agnes" || providerName === "agnesai" || providerName.toLowerCase().includes("agnes") || modelName.toLowerCase().includes("agnes-video") || modelName.toLowerCase().includes("agnes-image")) && (modelName.toLowerCase().includes("image") || modelName.toLowerCase().includes("video"))) {
    modelName = "agnes-2.0-flash";
    isMediaModel = true;
  } else if (providerName === "openai" && (modelName.toLowerCase().includes("dall-e") || modelName.toLowerCase().includes("dalle"))) {
    modelName = "gpt-4o-mini";
    isMediaModel = true;
  } else if (providerName === "gemini" && (modelName.toLowerCase().includes("imagen") || modelName.toLowerCase().includes("media"))) {
    modelName = "gemini-1.5-flash";
    isMediaModel = true;
  }

  // Set running state
  task.executionStatus = "running";
  task.status = "running"; // Legacy
  task.startedAt = new Date().toISOString();
  task.startedExecutionTimestamp = Date.now();
  delete task.executionState; // Clear saved breakpoint for fresh run
  task.logs.push({
    timestamp: new Date().toISOString(),
    type: "system",
    message: `初始化自动化执行引擎 (${providerName.toUpperCase()}:${originalModelName})...`
  });

  if (isMediaModel) {
    task.logs.push({
      timestamp: new Date().toISOString(),
      type: "system",
      message: `[智能自愈/Smart Recovery] 检测到任务指定的规划模型为多媒体/图片模型 [${originalModelName}]。由于此类模型不支持任务步骤推理和工具调用，系统已自动切换至高能文本模型 [${modelName}] 充当推理大脑，同时在执行链中完全支持多媒体/图像生成工具，保障您的任务能够顺利产出完美结果！`
    });
  }
  saveTasks(activeTasks);

  // Return response early so execution runs in background
  res.json({ success: true, message: "Task started", task });

  // Run in background async loop
  (async () => {
    const startTime = Date.now();
    const cpuStart = process.cpuUsage();
    const memStart = process.memoryUsage().heapUsed;
    
    // Track file modifications
    let preMtimes = getWorkspaceFileMtimes(WORKSPACE_DIR);

    let totalTokens = 0;
    let currentStep = 1;
    let history: any[] = [];

    try {
      // Load AGENTS.md / behavior_guidelines.md and 遗嘱.md / core_principles.md with narrative neutralization support (F-40)
      let extraInstructions = "";
      const agentsPath = path.resolve(process.cwd(), "AGENTS.md");
      const bgPath = path.resolve(process.cwd(), "behavior_guidelines.md");
      const yizhuPath = path.resolve(process.cwd(), "遗嘱.md");
      const cpPath = path.resolve(process.cwd(), "core_principles.md");

      if (fs.existsSync(agentsPath)) {
        extraInstructions += `\n\n[行为准则 (AGENTS.md)]\n${fs.readFileSync(agentsPath, "utf-8")}`;
      } else if (fs.existsSync(bgPath)) {
        extraInstructions += `\n\n[行为准则 (behavior_guidelines.md)]\n${fs.readFileSync(bgPath, "utf-8")}`;
      }

      if (fs.existsSync(yizhuPath)) {
        extraInstructions += `\n\n[核心原则与执行红线 (遗嘱.md)]\n${fs.readFileSync(yizhuPath, "utf-8")}`;
      } else if (fs.existsSync(cpPath)) {
        extraInstructions += `\n\n[核心原则与执行红线 (core_principles.md)]\n${fs.readFileSync(cpPath, "utf-8")}`;
      }

      const finalSystemInstruction = (task.parameters?.systemInstruction || "你是一个实用的本地自动化任务助手。") + extraInstructions;

      // Construct user prompt with context files content (F-41)
      let initialPrompt = `你现在的任务是：${task.description?.prompt || task.prompt || "无任务描述"}`;
      const contextFiles = task.context_files || task.parameters?.additionalParams?.context_files || [];
      if (Array.isArray(contextFiles) && contextFiles.length > 0) {
        initialPrompt += "\n\n以下是任务中关联的上下文文件内容：";
        for (const relPath of contextFiles) {
          try {
            const absPath = safePath(relPath);
            if (fs.existsSync(absPath)) {
              const fileContent = fs.readFileSync(absPath, "utf-8");
              initialPrompt += `\n\n--- 文件: ${relPath} ---\n${fileContent}\n------------------`;
            }
          } catch (e: any) {
            initialPrompt += `\n\n[警告] 无法加载关联文件 '${relPath}': ${e.message}`;
          }
        }
      }

      // Prepare conversation history
      history = [
        {
          role: "user",
          parts: [{ text: initialPrompt }]
        }
      ];

      const MAX_STEPS = 15;
      let modelFinished = false;
      let currentProvider = providerName;
      let currentModel = modelName;

      task.logs.push({
        timestamp: new Date().toISOString(),
        type: "system",
        message: `开始规划任务，提供商: ${currentProvider.toUpperCase()}，模型: ${currentModel} (温度: ${task.parameters?.temperature ?? 0.2})`
      });
      saveTasks(activeTasks);

      while (currentStep <= MAX_STEPS && !modelFinished) {
        task.logs.push({
          timestamp: new Date().toISOString(),
          type: "system",
          message: `[步骤 ${currentStep}/${MAX_STEPS}] 正在呼叫 AI 进行决策与规划...`
        });
        saveTasks(activeTasks);

        let response;
        let attempt = 0;
        const retryStrategy = task.parameters?.retryStrategy || {
          maxAttempts: 3,
          intervalMs: 2000,
          backoff: "exponential"
        };
        const maxAttempts = Number(retryStrategy.maxAttempts ?? 3);
        const baseIntervalMs = Number(retryStrategy.intervalMs ?? 2000);
        const backoffAlgorithm = retryStrategy.backoff || "exponential";
        let success = false;
        let lastError: any = null;

        while (attempt < maxAttempts && !success) {
          try {
            response = await callAIProvider(
              currentProvider,
              currentModel,
              history,
              task.parameters?.temperature ?? 0.2,
              finalSystemInstruction,
              currentConfig
            );
            success = true;
          } catch (callErr: any) {
            lastError = callErr;
            const callErrorMsg = callErr.message || String(callErr);
            
            const isRetryable = 
              /429/i.test(callErrorMsg) ||
              /limit/i.test(callErrorMsg) ||
              /timeout/i.test(callErrorMsg) ||
              /fetch/i.test(callErrorMsg) ||
              /network/i.test(callErrorMsg) ||
              /econn/i.test(callErrorMsg) ||
              /socket/i.test(callErrorMsg) ||
              /502/i.test(callErrorMsg) ||
              /503/i.test(callErrorMsg) ||
              /504/i.test(callErrorMsg) ||
              /overload/i.test(callErrorMsg) ||
              /busy/i.test(callErrorMsg);

            if (isRetryable && attempt < maxAttempts - 1) {
              attempt++;
              let delay = baseIntervalMs;
              if (backoffAlgorithm === "exponential") {
                delay = baseIntervalMs * Math.pow(2, attempt - 1);
              } else if (backoffAlgorithm === "linear") {
                delay = baseIntervalMs * attempt;
              } else {
                delay = baseIntervalMs;
              }
              // Add ±10% jitter
              delay += Math.random() * (delay * 0.1);

              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "system",
                message: `[自动重试] 呼叫 AI 接口遭遇网络波动或限流 (${callErrorMsg})。将在 ${Math.round(delay)}ms 后进行第 ${attempt}/${maxAttempts - 1} 次自动重试 (退避策略: ${backoffAlgorithm})...`
              });
              saveTasks(activeTasks);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              break;
            }
          }
        }

        if (!success) {
          const callErr = lastError;
          const callErrorMsg = callErr?.message || String(callErr || "");

          // Disaster recovery backup switcher
          const isProviderError = 
            /429/i.test(callErrorMsg) ||
            /limit/i.test(callErrorMsg) ||
            /timeout/i.test(callErrorMsg) ||
            /502/i.test(callErrorMsg) ||
            /503/i.test(callErrorMsg) ||
            /504/i.test(callErrorMsg) ||
            /overload/i.test(callErrorMsg) ||
            /busy/i.test(callErrorMsg) ||
            /fetch/i.test(callErrorMsg) ||
            /network/i.test(callErrorMsg);

          if (isProviderError) {
            const backup = getBackupProvider(currentProvider, currentConfig);
            if (backup) {
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "system",
                message: `[灾备切换] 供应商 ${currentProvider.toUpperCase()} 连续呼叫报错 (${callErrorMsg})。系统自动激活高可用应急预案，切换至备用供应商 ${backup.name.toUpperCase()} (模型: ${backup.model}) 重新尝试当前步骤！`
              });
              saveTasks(activeTasks);

              currentProvider = backup.name;
              currentModel = backup.model;

              if ((currentProvider === "agnes" || currentProvider === "agnesai" || currentProvider.toLowerCase().includes("agnes") || currentModel.toLowerCase().includes("agnes-video") || currentModel.toLowerCase().includes("agnes-image")) && (currentModel.toLowerCase().includes("image") || currentModel.toLowerCase().includes("video"))) {
                currentModel = "agnes-2.0-flash";
              } else if (currentProvider === "openai" && (currentModel.toLowerCase().includes("dall-e") || currentModel.toLowerCase().includes("dalle"))) {
                currentModel = "gpt-4o-mini";
              } else if (currentProvider === "gemini" && (currentModel.toLowerCase().includes("imagen") || currentModel.toLowerCase().includes("media"))) {
                currentModel = "gemini-1.5-flash";
              }

              let backupAttempt = 0;
              const backupMaxAttempts = 3;
              while (backupAttempt < backupMaxAttempts && !success) {
                try {
                  response = await callAIProvider(
                    currentProvider,
                    currentModel,
                    history,
                    task.parameters?.temperature ?? 0.2,
                    finalSystemInstruction,
                    currentConfig
                  );
                  success = true;
                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "system",
                    message: `[灾备成功] 成功切换并使用备用供应商 ${currentProvider.toUpperCase()} (${currentModel}) 恢复任务执行！`
                  });
                  saveTasks(activeTasks);
                } catch (backupErr: any) {
                  lastError = backupErr;
                  const backupErrStr = backupErr.message || String(backupErr);
                  backupAttempt++;
                  if (backupAttempt < backupMaxAttempts) {
                    const delay = Math.pow(2, backupAttempt) * 1000 + Math.random() * 500;
                    task.logs.push({
                      timestamp: new Date().toISOString(),
                      type: "system",
                      message: `[备用自动重试] 备用供应商 ${currentProvider.toUpperCase()} 呼叫报错 (${backupErrStr})。将在 ${Math.round(delay)}ms 后重试 (${backupAttempt}/${backupMaxAttempts - 1})...`
                    });
                    saveTasks(activeTasks);
                    await new Promise(resolve => setTimeout(resolve, delay));
                  }
                }
              }
            }
          }
        }

        if (!success) {
          const callErr = lastError;
          const callErrorMsg = callErr.message || String(callErr);
          const isSerializationOrProcessingError = 
            callErr instanceof TypeError || 
            callErr instanceof RangeError || 
            callErr instanceof SyntaxError ||
            /replace/i.test(callErrorMsg) ||
            /undefined/i.test(callErrorMsg) ||
            /serialize/i.test(callErrorMsg) ||
            /json/i.test(callErrorMsg) ||
            /parse/i.test(callErrorMsg) ||
            /stringify/i.test(callErrorMsg) ||
            /payload/i.test(callErrorMsg) ||
            /limit/i.test(callErrorMsg) ||
            /request/i.test(callErrorMsg);

          if (isSerializationOrProcessingError) {
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "error",
              message: `[Safe Recovery 触发] 呼叫 AI 接口失败，疑似数据传输/序列化/Payload过大。错误: ${callErrorMsg}`
            });
            saveTasks(activeTasks);

            // Attempt Safe Recovery: simplify conversation history by removing/truncating large parts
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[Safe Recovery] 自动精简历史记录（Payload Simplification）并重试呼叫...`
            });
            
            const simplifiedHistory = history.map((item: any) => {
              if (item.parts) {
                const simplifiedParts = item.parts.map((p: any) => {
                  if (p.text && p.text.length > 5000) {
                    return { text: p.text.slice(0, 5000) + "\n... [已自动精简截断以防止Payload序列化/传输过载 (Chunked/Truncated for Safe Recovery)]" };
                  }
                  if (p.functionResponse && p.functionResponse.response) {
                    const responseStr = typeof p.functionResponse.response === "string" 
                      ? p.functionResponse.response 
                      : JSON.stringify(p.functionResponse.response);
                    if (responseStr.length > 5000) {
                      return {
                        functionResponse: {
                          ...p.functionResponse,
                          response: {
                            success: true,
                            truncated: true,
                            message: "结果过大已由系统安全恢复机制截断",
                            data: responseStr.slice(0, 5000) + "\n... [已自动截断 (Truncated due to Safe Recovery)]"
                          }
                        }
                      };
                    }
                  }
                  return p;
                });
                return { ...item, parts: simplifiedParts };
              }
              return item;
            });

            try {
              response = await callAIProvider(
                currentProvider,
                currentModel,
                simplifiedHistory,
                task.parameters?.temperature ?? 0.2,
                finalSystemInstruction,
                currentConfig
              );
              
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "system",
                message: `[Safe Recovery 成功] 通过简化对话历史（Payload Simplification），模型决策接口成功恢复响应！`
              });
              saveTasks(activeTasks);
              
              // Update history to the simplified version
              history.length = 0;
              history.push(...simplifiedHistory);
            } catch (retryErr: any) {
              throw new Error(`[Safe Recovery] AI接口呼叫再次失败（极有可能是历史上下文太大或服务限流）。建议重置任务、清空不必要的附件或缩短提示词。报错: ${retryErr.message || retryErr}`);
            }
          } else {
            throw callErr;
          }
        }

        const textResponse = response.text;
        const functionCalls = response.functionCalls;
        totalTokens += response.tokensUsed;

        // Log the reasoning
        if (textResponse && textResponse.trim().length > 0) {
          task.logs.push({
            timestamp: new Date().toISOString(),
            type: "model_thought",
            message: textResponse
          });
          saveTasks(activeTasks);
        }

        // Push model response to chat history
        const modelParts: any[] = [];
        if (textResponse) {
          modelParts.push({ text: textResponse });
        }
        
        history.push({
          role: "model",
          parts: modelParts,
          functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined
        });

        if (functionCalls && functionCalls.length > 0) {
          // AI wants to call tools
          task.logs.push({
            timestamp: new Date().toISOString(),
            type: "system",
            message: `模型在步骤 ${currentStep} 中请求执行 ${functionCalls.length} 个工具调用`
          });
          saveTasks(activeTasks);

          const toolResponseParts: any[] = [];

          for (const call of functionCalls) {
            const { name, args, id } = call;
            
            // Log tool call
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "tool_call",
              message: `执行工具: ${name}`,
              details: { args }
            });
            saveTasks(activeTasks);

            try {
              const toolResult = await executeTool(name, args, task.id);
              
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "tool_response",
                message: `工具 ${name} 返回成功 (${toolResult.durationMs}ms)`,
                details: { result: toolResult }
              });
              saveTasks(activeTasks);

              toolResponseParts.push({
                functionResponse: {
                  name,
                  response: toolResult,
                  id
                }
              });
            } catch (err: any) {
              const errorMsg = err.message || String(err);
              const isSerializationOrProcessingError = 
                err instanceof TypeError || 
                err instanceof RangeError || 
                err instanceof SyntaxError ||
                /replace/i.test(errorMsg) ||
                /undefined/i.test(errorMsg) ||
                /serialize/i.test(errorMsg) ||
                /json/i.test(errorMsg) ||
                /parse/i.test(errorMsg) ||
                /stringify/i.test(errorMsg) ||
                /payload/i.test(errorMsg) ||
                /limit/i.test(errorMsg);

              let recoverySuggestion = "";
              if (isSerializationOrProcessingError) {
                recoverySuggestion = ` [安全恢复建议/Safe Recovery]: 检测到可能是数据序列化或内容解析引发的工具执行异常。为了避免任务失败，建议对重试载荷(Payload)进行精简、去除非必要嵌套，或采取分段(chunked)写入。请尝试使用精简或分块的参数再次重试。`;
              }

              // Log the initial error to ensure it is captured by the Error Analyzer properly
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "error",
                message: `工具 ${name} 执行触发异常: ${errorMsg}${recoverySuggestion}`
              });
              saveTasks(activeTasks);

              let recoverySucceeded = false;
              let recoveredResult: any = null;

              if (isSerializationOrProcessingError) {
                try {
                  // Attempt Safe Recovery: simplify or chunk payload
                  const simplifiedArgs = simplifyPayload(name, args);
                  
                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "system",
                    message: `[Safe Recovery] 自动容灾：检测到序列化或解析异常，启动 Safe Recovery。尝试使用简化或分块后的 Payload 载荷重试工具 ${name}...`,
                    details: { originalArgs: args, simplifiedArgs }
                  });
                  saveTasks(activeTasks);

                  // Execute retry with simplified payload
                  recoveredResult = await executeTool(name, simplifiedArgs, task.id);
                  recoverySucceeded = true;

                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "tool_response",
                    message: `[Safe Recovery 成功] 工具 ${name} 启动安全恢复重试并执行成功！已自动解决数据处理/序列化问题。`,
                    details: { result: recoveredResult }
                  });
                  saveTasks(activeTasks);

                  toolResponseParts.push({
                    functionResponse: {
                      name,
                      response: {
                        ...recoveredResult,
                        safeRecoveryApplied: true,
                        recoveryDetails: "Auto-payload-simplification & retry succeeded"
                      },
                      id
                    }
                  });
                } catch (recoveryErr: any) {
                  const recoveryErrorMsg = recoveryErr.message || String(recoveryErr);
                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "error",
                    message: `[Safe Recovery 失败] 载荷自动简化重试依然失败: ${recoveryErrorMsg}`
                  });
                  saveTasks(activeTasks);
                }
              }

              if (!recoverySucceeded) {
                // Return failed response back to the model, suggesting a retry with simplified/chunked payload
                // so that the model can try again without failing the entire task step immediately
                toolResponseParts.push({
                  functionResponse: {
                    name,
                    response: { 
                      success: false, 
                      error: errorMsg,
                      safeRecoveryMode: isSerializationOrProcessingError,
                      recoverySuggestion: recoverySuggestion ? recoverySuggestion.trim() : "Please retry with a simplified or chunked payload"
                    },
                    id
                  }
                });
              }
            }
          }

          // Push tool response parts back to history
          history.push({
            role: "user",
            parts: toolResponseParts
          });

        } else {
          // No function calls, model is finished
          modelFinished = true;
          task.executionStatus = "completed";
          task.status = "completed"; // Legacy
          task.completedAt = new Date().toISOString();
          task.results.summary = textResponse || "任务已顺利完成，没有返回额外文字说明。";
          task.result = task.results.summary; // Legacy
          task.logs.push({
            timestamp: new Date().toISOString(),
            type: "system",
            message: "AI 模型表示任务已规划并执行完毕，退出执行链。"
          });
          saveTasks(activeTasks);
        }

        currentStep++;
      }

      if (!modelFinished && currentStep > MAX_STEPS) {
        task.executionStatus = "failed";
        task.status = "failed"; // Legacy
        task.completedAt = new Date().toISOString();
        task.results.error = `执行超时：达到了单次任务的最大步数限制 (${MAX_STEPS} 步)。已自动挂起防止陷入死循环。`;
        
        // Save execution state for manual resumption
        task.executionState = {
          currentStep,
          history,
          totalTokens,
          preMtimes
        };

        task.logs.push({
          timestamp: new Date().toISOString(),
          type: "error",
          message: task.results.error
        });
        saveTasks(activeTasks);
      }

    } catch (err: any) {
      console.error("Task runtime crash:", err);
      task.executionStatus = "failed";
      task.status = "failed"; // Legacy
      task.completedAt = new Date().toISOString();
      
      const errorMsg = err.message || String(err);
      const isSerializationOrUndefinedError = 
        err instanceof TypeError || 
        err instanceof RangeError || 
        err instanceof SyntaxError ||
        /replace/i.test(errorMsg) ||
        /undefined/i.test(errorMsg) ||
        /serialize/i.test(errorMsg) ||
        /json/i.test(errorMsg) ||
        /parse/i.test(errorMsg) ||
        /stringify/i.test(errorMsg) ||
        /payload/i.test(errorMsg) ||
        /circular/i.test(errorMsg) ||
        /limit/i.test(errorMsg);

      let recoverySuggestion = "";
      if (isSerializationOrUndefinedError) {
        recoverySuggestion = `\n\n[安全恢复建议 / Safe Recovery Proposal]: 检测到任务运行中触发了数据序列化 (Serialization) 或未定义属性访问 (Undefined Property) 错误。这可能是由于传递了过大的上下文字符串、循环引用、或未初始化的空数据字段导致。为了防止任务持续挂起 (Hanging)，建议您：\n1. 点击 "重置任务" 按钮清除异常上下文并释放挂起状态；\n2. 精简关联 of the context files (Context Files) 或输入 Payload 长度；\n3. 分次分块 (Chunked Payload) 进行小步幅的任务拆分执行，或降低并发模型请求字数。`;
      }

      task.results.error = `运行引擎遇到严重异常: ${errorMsg}${recoverySuggestion}`;
      
      // Save breakpoint execution state
      task.executionState = {
        currentStep,
        history,
        totalTokens,
        preMtimes
      };

      task.logs.push({
        timestamp: new Date().toISOString(),
        type: "error",
        message: task.results.error
      });
      saveTasks(activeTasks);
    } finally {
      // Calculate outputs and resource consumptions
      const durationMs = Date.now() - startTime;
      const cpuEnd = process.cpuUsage(cpuStart);
      const memEnd = process.memoryUsage().heapUsed;
      
      const cpuLoadAvg = Number(((cpuEnd.user + cpuEnd.system) / 1000 / durationMs * 100).toFixed(1));
      const memoryUsedBytes = Math.max(0, memEnd - memStart);

      // Detect newly created or modified workspace files
      const postMtimes = getWorkspaceFileMtimes(WORKSPACE_DIR);
      const outputFiles: string[] = [];
      for (const [relPath, mtime] of Object.entries(postMtimes)) {
        if (preMtimes[relPath] === undefined || preMtimes[relPath] !== mtime) {
          outputFiles.push(relPath);
        }
      }

      task.results.outputFiles = outputFiles;
      task.resourceConsumption = {
        durationMs,
        tokensUsed: totalTokens,
        cpuLoadAvg: isNaN(cpuLoadAvg) ? 0 : cpuLoadAvg,
        memoryUsedBytes
      };
      
      saveTasks(activeTasks);
    }
  })();
});

// Resumable Task Endpoint (Manual Breakpoint continuation)
app.post("/api/tasks/:id/resume", async (req, res) => {
  const { id } = req.params;
  const taskIndex = activeTasks.findIndex(t => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: "Task not found" });
  }
  
  const task = activeTasks[taskIndex];
  if (task.executionStatus === "running") {
    return res.status(400).json({ error: "Task is already running" });
  }

  if (!task.executionState) {
    return res.status(400).json({ error: "此任务没有保存的断点状态，无法执行断点续传。请直接运行或重置任务。" });
  }

  // Load the current API configs safely
  const currentConfig = loadAIConfig();
  const providerName = task.parameters?.provider || currentConfig.activeProvider || "gemini";
  let modelName = task.parameters?.model || currentConfig.activeModel || "gemini-3.5-flash";

  // Auto-Fallback Logic for Image/Video Models as Planning Brains
  let isMediaModel = false;
  const originalModelName = modelName;
  if ((providerName === "agnes" || providerName === "agnesai" || providerName.toLowerCase().includes("agnes") || modelName.toLowerCase().includes("agnes-video") || modelName.toLowerCase().includes("agnes-image")) && (modelName.toLowerCase().includes("image") || modelName.toLowerCase().includes("video"))) {
    modelName = "agnes-2.0-flash";
    isMediaModel = true;
  }

  // Set running state
  task.executionStatus = "running";
  task.status = "running"; // Legacy
  task.startedAt = task.startedAt || new Date().toISOString();
  task.startedExecutionTimestamp = task.startedExecutionTimestamp || Date.now();
  task.logs.push({
    timestamp: new Date().toISOString(),
    type: "system",
    message: `[断点续传启动] 正在载入历史执行上下文，继续从步骤 ${task.executionState.currentStep} 执行 (${providerName.toUpperCase()}:${originalModelName})...`
  });
  saveTasks(activeTasks);

  res.json({ success: true, message: "Task resumed", task });

  // Run in background async loop
  (async () => {
    const startTime = Date.now();
    const cpuStart = process.cpuUsage();
    const memStart = process.memoryUsage().heapUsed;
    
    // Restore execution state
    let history = task.executionState.history || [];
    let currentStep = task.executionState.currentStep || 1;
    let totalTokens = task.executionState.totalTokens || 0;
    let preMtimes = task.executionState.preMtimes || getWorkspaceFileMtimes(WORKSPACE_DIR);

    // Delete saved execution state now that we've restored it
    delete task.executionState;
    saveTasks(activeTasks);

    try {
      // Load AGENTS.md / behavior_guidelines.md and 遗嘱.md / core_principles.md with narrative neutralization support
      let extraInstructions = "";
      const agentsPath = path.resolve(process.cwd(), "AGENTS.md");
      const bgPath = path.resolve(process.cwd(), "behavior_guidelines.md");
      const yizhuPath = path.resolve(process.cwd(), "遗嘱.md");
      const cpPath = path.resolve(process.cwd(), "core_principles.md");

      if (fs.existsSync(agentsPath)) {
        extraInstructions += `\n\n[行为准则 (AGENTS.md)]\n${fs.readFileSync(agentsPath, "utf-8")}`;
      } else if (fs.existsSync(bgPath)) {
        extraInstructions += `\n\n[行为准则 (behavior_guidelines.md)]\n${fs.readFileSync(bgPath, "utf-8")}`;
      }

      if (fs.existsSync(yizhuPath)) {
        extraInstructions += `\n\n[核心原则与执行红线 (遗嘱.md)]\n${fs.readFileSync(yizhuPath, "utf-8")}`;
      } else if (fs.existsSync(cpPath)) {
        extraInstructions += `\n\n[核心原则与执行红线 (core_principles.md)]\n${fs.readFileSync(cpPath, "utf-8")}`;
      }

      const finalSystemInstruction = (task.parameters?.systemInstruction || "你是一个实用的本地自动化任务助手。") + extraInstructions;

      const MAX_STEPS = 15;
      let modelFinished = false;
      let currentProvider = providerName;
      let currentModel = modelName;

      task.logs.push({
        timestamp: new Date().toISOString(),
        type: "system",
        message: `[断点恢复成功] 规划大脑: ${currentProvider.toUpperCase()}，模型: ${currentModel}`
      });
      saveTasks(activeTasks);

      while (currentStep <= MAX_STEPS && !modelFinished) {
        task.logs.push({
          timestamp: new Date().toISOString(),
          type: "system",
          message: `[步骤 ${currentStep}/${MAX_STEPS} (恢复)] 正在呼叫 AI 进行决策与规划...`
        });
        saveTasks(activeTasks);

        let response;
        let attempt = 0;
        const retryStrategy = task.parameters?.retryStrategy || {
          maxAttempts: 3,
          intervalMs: 2000,
          backoff: "exponential"
        };
        const maxAttempts = Number(retryStrategy.maxAttempts ?? 3);
        const baseIntervalMs = Number(retryStrategy.intervalMs ?? 2000);
        const backoffAlgorithm = retryStrategy.backoff || "exponential";
        let success = false;
        let lastError: any = null;

        while (attempt < maxAttempts && !success) {
          try {
            response = await callAIProvider(
              currentProvider,
              currentModel,
              history,
              task.parameters?.temperature ?? 0.2,
              finalSystemInstruction,
              currentConfig
            );
            success = true;
          } catch (callErr: any) {
            lastError = callErr;
            const callErrorMsg = callErr.message || String(callErr);
            
            const isRetryable = 
              /429/i.test(callErrorMsg) ||
              /limit/i.test(callErrorMsg) ||
              /timeout/i.test(callErrorMsg) ||
              /fetch/i.test(callErrorMsg) ||
              /network/i.test(callErrorMsg) ||
              /econn/i.test(callErrorMsg) ||
              /socket/i.test(callErrorMsg) ||
              /502/i.test(callErrorMsg) ||
              /503/i.test(callErrorMsg) ||
              /504/i.test(callErrorMsg) ||
              /overload/i.test(callErrorMsg) ||
              /busy/i.test(callErrorMsg);

            if (isRetryable && attempt < maxAttempts - 1) {
              attempt++;
              let delay = baseIntervalMs;
              if (backoffAlgorithm === "exponential") {
                delay = baseIntervalMs * Math.pow(2, attempt - 1);
              } else if (backoffAlgorithm === "linear") {
                delay = baseIntervalMs * attempt;
              } else {
                delay = baseIntervalMs;
              }
              // Add ±10% jitter
              delay += Math.random() * (delay * 0.1);

              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "system",
                message: `[自动重试] 呼叫 AI 接口遭遇网络波动或限流 (${callErrorMsg})。将在 ${Math.round(delay)}ms 后进行第 ${attempt}/${maxAttempts - 1} 次自动重试 (退避策略: ${backoffAlgorithm})...`
              });
              saveTasks(activeTasks);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              break;
            }
          }
        }

        if (!success) {
          const callErr = lastError;
          const callErrorMsg = callErr?.message || String(callErr || "");

          // Disaster recovery backup switcher
          const isProviderError = 
            /429/i.test(callErrorMsg) ||
            /limit/i.test(callErrorMsg) ||
            /timeout/i.test(callErrorMsg) ||
            /502/i.test(callErrorMsg) ||
            /503/i.test(callErrorMsg) ||
            /504/i.test(callErrorMsg) ||
            /overload/i.test(callErrorMsg) ||
            /busy/i.test(callErrorMsg) ||
            /fetch/i.test(callErrorMsg) ||
            /network/i.test(callErrorMsg);

          if (isProviderError) {
            const backup = getBackupProvider(currentProvider, currentConfig);
            if (backup) {
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "system",
                message: `[灾备切换] 供应商 ${currentProvider.toUpperCase()} 连续呼叫报错 (${callErrorMsg})。系统自动激活高可用应急预案，切换至备用供应商 ${backup.name.toUpperCase()} (模型: ${backup.model}) 重新尝试当前步骤！`
              });
              saveTasks(activeTasks);

              currentProvider = backup.name;
              currentModel = backup.model;

              if ((currentProvider === "agnes" || currentProvider === "agnesai" || currentProvider.toLowerCase().includes("agnes") || currentModel.toLowerCase().includes("agnes-video") || currentModel.toLowerCase().includes("agnes-image")) && (currentModel.toLowerCase().includes("image") || currentModel.toLowerCase().includes("video"))) {
                currentModel = "agnes-2.0-flash";
              } else if (currentProvider === "openai" && (currentModel.toLowerCase().includes("dall-e") || currentModel.toLowerCase().includes("dalle"))) {
                currentModel = "gpt-4o-mini";
              } else if (currentProvider === "gemini" && (currentModel.toLowerCase().includes("imagen") || currentModel.toLowerCase().includes("media"))) {
                currentModel = "gemini-1.5-flash";
              }

              let backupAttempt = 0;
              const backupMaxAttempts = 3;
              while (backupAttempt < backupMaxAttempts && !success) {
                try {
                  response = await callAIProvider(
                    currentProvider,
                    currentModel,
                    history,
                    task.parameters?.temperature ?? 0.2,
                    finalSystemInstruction,
                    currentConfig
                  );
                  success = true;
                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "system",
                    message: `[灾备成功] 成功切换并使用备用供应商 ${currentProvider.toUpperCase()} (${currentModel}) 恢复任务执行！`
                  });
                  saveTasks(activeTasks);
                } catch (backupErr: any) {
                  lastError = backupErr;
                  const backupErrStr = backupErr.message || String(backupErr);
                  backupAttempt++;
                  if (backupAttempt < backupMaxAttempts) {
                    const delay = Math.pow(2, backupAttempt) * 1000 + Math.random() * 500;
                    task.logs.push({
                      timestamp: new Date().toISOString(),
                      type: "system",
                      message: `[备用自动重试] 备用供应商 ${currentProvider.toUpperCase()} 呼叫报错 (${backupErrStr})。将在 ${Math.round(delay)}ms 后重试 (${backupAttempt}/${backupMaxAttempts - 1})...`
                    });
                    saveTasks(activeTasks);
                    await new Promise(resolve => setTimeout(resolve, delay));
                  }
                }
              }
            }
          }
        }

        if (!success) {
          const callErr = lastError;
          const callErrorMsg = callErr.message || String(callErr);
          const isSerializationOrProcessingError = 
            callErr instanceof TypeError || 
            callErr instanceof RangeError || 
            callErr instanceof SyntaxError ||
            /replace/i.test(callErrorMsg) ||
            /undefined/i.test(callErrorMsg) ||
            /serialize/i.test(callErrorMsg) ||
            /json/i.test(callErrorMsg) ||
            /parse/i.test(callErrorMsg) ||
            /stringify/i.test(callErrorMsg) ||
            /payload/i.test(callErrorMsg) ||
            /limit/i.test(callErrorMsg) ||
            /request/i.test(callErrorMsg);

          if (isSerializationOrProcessingError) {
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "error",
              message: `[Safe Recovery 触发] 呼叫 AI 接口失败，疑似数据传输/序列化/Payload过大。错误: ${callErrorMsg}`
            });
            saveTasks(activeTasks);

            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[Safe Recovery] 自动精简历史记录并重试呼叫...`
            });
            
            const simplifiedHistory = history.map((item: any) => {
              if (item.parts) {
                const simplifiedParts = item.parts.map((p: any) => {
                  if (p.text && p.text.length > 5000) {
                    return { text: p.text.slice(0, 5000) + "\n... [已自动精简截断以防止Payload序列化/传输过载 (Chunked/Truncated for Safe Recovery)]" };
                  }
                  if (p.functionResponse && p.functionResponse.response) {
                    const responseStr = typeof p.functionResponse.response === "string" 
                      ? p.functionResponse.response 
                      : JSON.stringify(p.functionResponse.response);
                    if (responseStr.length > 5000) {
                      return {
                        functionResponse: {
                          ...p.functionResponse,
                          response: {
                            success: true,
                            truncated: true,
                            message: "结果过大已由系统安全恢复机制截断",
                            data: responseStr.slice(0, 5000) + "\n... [已自动截断 (Truncated due to Safe Recovery)]"
                          }
                        }
                      };
                    }
                  }
                  return p;
                });
                return { ...item, parts: simplifiedParts };
              }
              return item;
            });

            try {
              response = await callAIProvider(
                currentProvider,
                currentModel,
                simplifiedHistory,
                task.parameters?.temperature ?? 0.2,
                finalSystemInstruction,
                currentConfig
              );
              
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "system",
                message: `[Safe Recovery 成功] 通过简化对话历史（Payload Simplification），模型决策接口成功恢复响应！`
              });
              saveTasks(activeTasks);
              
              history.length = 0;
              history.push(...simplifiedHistory);
            } catch (retryErr: any) {
              throw new Error(`[Safe Recovery] AI接口呼叫再次失败（极有可能是历史上下文太大或服务限流）。建议重置任务、清空不必要的附件或缩短提示词。报错: ${retryErr.message || retryErr}`);
            }
          } else {
            throw callErr;
          }
        }

        const textResponse = response.text;
        const functionCalls = response.functionCalls;
        totalTokens += response.tokensUsed;

        if (textResponse && textResponse.trim().length > 0) {
          task.logs.push({
            timestamp: new Date().toISOString(),
            type: "model_thought",
            message: textResponse
          });
          saveTasks(activeTasks);
        }

        const modelParts: any[] = [];
        if (textResponse) {
          modelParts.push({ text: textResponse });
        }
        
        history.push({
          role: "model",
          parts: modelParts,
          functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined
        });

        if (functionCalls && functionCalls.length > 0) {
          task.logs.push({
            timestamp: new Date().toISOString(),
            type: "system",
            message: `模型在步骤 ${currentStep} 中请求执行 ${functionCalls.length} 个工具调用`
          });
          saveTasks(activeTasks);

          const toolResponseParts: any[] = [];

          for (const call of functionCalls) {
            const { name, args, id } = call;
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "tool_call",
              message: `执行工具: ${name}`,
              details: { args }
            });
            saveTasks(activeTasks);

            try {
              const toolResult = await executeTool(name, args, task.id);
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "tool_response",
                message: `工具 ${name} 返回成功 (${toolResult.durationMs}ms)`,
                details: { result: toolResult }
              });
              saveTasks(activeTasks);

              toolResponseParts.push({
                functionResponse: {
                  name,
                  response: toolResult,
                  id
                }
              });
            } catch (err: any) {
              const errorMsg = err.message || String(err);
              const isSerializationOrProcessingError = 
                err instanceof TypeError || 
                err instanceof RangeError || 
                err instanceof SyntaxError ||
                /replace/i.test(errorMsg) ||
                /undefined/i.test(errorMsg) ||
                /serialize/i.test(errorMsg) ||
                /json/i.test(errorMsg) ||
                /parse/i.test(errorMsg) ||
                /stringify/i.test(errorMsg) ||
                /payload/i.test(errorMsg) ||
                /limit/i.test(errorMsg);

              let recoverySuggestion = "";
              if (isSerializationOrProcessingError) {
                recoverySuggestion = ` [安全恢复建议/Safe Recovery]: 检测到可能是数据序列化或内容解析引发的工具执行异常。为了避免任务失败，建议对重试载荷(Payload)进行精简、去除非必要嵌套，或采取分段(chunked)写入。请尝试使用精简或分块的参数再次重试。`;
              }

              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "error",
                message: `工具 ${name} 执行触发异常: ${errorMsg}${recoverySuggestion}`
              });
              saveTasks(activeTasks);

              let recoverySucceeded = false;
              let recoveredResult: any = null;

              if (isSerializationOrProcessingError) {
                try {
                  const simplifiedArgs = simplifyPayload(name, args);
                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "system",
                    message: `[Safe Recovery] 自动容灾：检测到序列化或解析异常，启动 Safe Recovery。尝试使用简化或分块后的 Payload 载荷重试工具 ${name}...`,
                    details: { originalArgs: args, simplifiedArgs }
                  });
                  saveTasks(activeTasks);

                  recoveredResult = await executeTool(name, simplifiedArgs, task.id);
                  recoverySucceeded = true;

                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "tool_response",
                    message: `[Safe Recovery 成功] 工具 ${name} 启动安全恢复重试并执行成功！已自动解决数据处理/序列化问题。`,
                    details: { result: recoveredResult }
                  });
                  saveTasks(activeTasks);

                  toolResponseParts.push({
                    functionResponse: {
                      name,
                      response: {
                        ...recoveredResult,
                        safeRecoveryApplied: true,
                        recoveryDetails: "Auto-payload-simplification & retry succeeded"
                      },
                      id
                    }
                  });
                } catch (recoveryErr: any) {
                  const recoveryErrorMsg = recoveryErr.message || String(recoveryErr);
                  task.logs.push({
                    timestamp: new Date().toISOString(),
                    type: "error",
                    message: `[Safe Recovery 失败] 载荷自动简化重试依然失败: ${recoveryErrorMsg}`
                  });
                  saveTasks(activeTasks);
                }
              }

              if (!recoverySucceeded) {
                toolResponseParts.push({
                  functionResponse: {
                    name,
                    response: { 
                      success: false, 
                      error: errorMsg,
                      safeRecoveryMode: isSerializationOrProcessingError,
                      recoverySuggestion: recoverySuggestion ? recoverySuggestion.trim() : "Please retry with a simplified or chunked payload"
                    },
                    id
                  }
                });
              }
            }
          }

          history.push({
            role: "user",
            parts: toolResponseParts
          });

        } else {
          modelFinished = true;
          task.executionStatus = "completed";
          task.status = "completed";
          task.completedAt = new Date().toISOString();
          task.results.summary = textResponse || "任务已顺利完成，没有返回额外文字说明。";
          task.result = task.results.summary;
          task.logs.push({
            timestamp: new Date().toISOString(),
            type: "system",
            message: "AI 模型表示任务已规划并执行完毕，退出执行链。"
          });
          saveTasks(activeTasks);
        }

        currentStep++;
      }

      if (!modelFinished && currentStep > MAX_STEPS) {
        task.executionStatus = "failed";
        task.status = "failed";
        task.completedAt = new Date().toISOString();
        task.results.error = `执行超时：达到了单次任务的最大步数限制 (${MAX_STEPS} 步)。已自动挂起防止陷入死循环。`;
        task.executionState = {
          currentStep,
          history,
          totalTokens,
          preMtimes
        };
        task.logs.push({
          timestamp: new Date().toISOString(),
          type: "error",
          message: task.results.error
        });
        saveTasks(activeTasks);
      }

    } catch (err: any) {
      console.error("Task runtime crash on resume:", err);
      task.executionStatus = "failed";
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      
      const errorMsg = err.message || String(err);
      const isSerializationOrUndefinedError = 
        err instanceof TypeError || 
        err instanceof RangeError || 
        err instanceof SyntaxError ||
        /replace/i.test(errorMsg) ||
        /undefined/i.test(errorMsg) ||
        /serialize/i.test(errorMsg) ||
        /json/i.test(errorMsg) ||
        /parse/i.test(errorMsg) ||
        /stringify/i.test(errorMsg) ||
        /payload/i.test(errorMsg) ||
        /circular/i.test(errorMsg) ||
        /limit/i.test(errorMsg);

      let recoverySuggestion = "";
      if (isSerializationOrUndefinedError) {
        recoverySuggestion = `\n\n[安全恢复建议 / Safe Recovery Proposal]: 检测到任务运行中触发了数据序列化 (Serialization) 或未定义属性访问 (Undefined Property) 错误。这可能是由于传递了过大的上下文字符串、循环引用、或未初始化的空数据字段导致。为了防止任务持续挂起 (Hanging)，建议您：\n1. 点击 "重置任务" 按钮清除异常上下文并释放挂起状态；\n2. 精简关联的上下文文件 (Context Files) 或输入 Payload 长度；\n3. 分次分块 (Chunked Payload) 进行小步幅的任务拆分执行，或降低并发模型请求字数。`;
      }

      task.results.error = `运行引擎在续传时遇到严重异常: ${errorMsg}${recoverySuggestion}`;
      
      // Save breakpoint execution state
      task.executionState = {
        currentStep,
        history,
        totalTokens,
        preMtimes
      };

      task.logs.push({
        timestamp: new Date().toISOString(),
        type: "error",
        message: task.results.error
      });
      saveTasks(activeTasks);
    } finally {
      const durationMs = Date.now() - startTime;
      const cpuEnd = process.cpuUsage(cpuStart);
      const memEnd = process.memoryUsage().heapUsed;
      
      const cpuLoadAvg = Number(((cpuEnd.user + cpuEnd.system) / 1000 / durationMs * 100).toFixed(1));
      const memoryUsedBytes = Math.max(0, memEnd - memStart);

      const postMtimes = getWorkspaceFileMtimes(WORKSPACE_DIR);
      const outputFiles: string[] = [];
      for (const [relPath, mtime] of Object.entries(postMtimes)) {
        if (preMtimes[relPath] === undefined || preMtimes[relPath] !== mtime) {
          outputFiles.push(relPath);
        }
      }

      task.results.outputFiles = Array.from(new Set([...(task.results.outputFiles || []), ...outputFiles]));
      task.resourceConsumption = {
        durationMs: (task.resourceConsumption?.durationMs || 0) + durationMs,
        tokensUsed: (task.resourceConsumption?.tokensUsed || 0) + totalTokens,
        cpuLoadAvg: isNaN(cpuLoadAvg) ? 0 : cpuLoadAvg,
        memoryUsedBytes: Math.max(task.resourceConsumption?.memoryUsedBytes || 0, memoryUsedBytes)
      };
      
      saveTasks(activeTasks);
    }
  })();
});

// 2. Sandbox File Explorer APIs
app.get("/api/workspace/files", (req, res) => {
  try {
    const fileTree = getFileTree(WORKSPACE_DIR);
    res.json(fileTree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/workspace/read", (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: "Missing file path" });
  try {
    const filePath = safePath(relPath as string);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ path: relPath, content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/workspace/write", (req, res) => {
  const { path: relPath, content } = req.body;
  if (!relPath || content === undefined) {
    return res.status(400).json({ error: "Missing path or content" });
  }
  try {
    const filePath = safePath(relPath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ success: true, message: "File saved successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/workspace/mkdir", (req, res) => {
  const { path: relPath } = req.body;
  if (!relPath) return res.status(400).json({ error: "Missing path" });
  try {
    const dirPath = safePath(relPath);
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true, message: "Directory created successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/workspace/delete", (req, res) => {
  const { path: relPath } = req.body;
  if (!relPath) return res.status(400).json({ error: "Missing path" });
  try {
    const itemPath = safePath(relPath);
    if (!fs.existsSync(itemPath)) {
      return res.status(404).json({ error: "Path not found" });
    }
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      fs.rmSync(itemPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(itemPath);
    }
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Run manual command for user testing
app.post("/api/workspace/terminal", async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "Missing command" });
  if (checkDangerousCommand(command)) {
    return res.status(400).json({ error: "安全拦截: 该命令被安全策略拒绝运行。" });
  }
  try {
    const start = Date.now();
    const { stdout, stderr } = await execAsync(command, { cwd: WORKSPACE_DIR, timeout: 10000 });
    res.json({
      stdout: stdout || "",
      stderr: stderr || "",
      durationMs: Date.now() - start
    });
  } catch (error: any) {
    res.json({
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      error: true
    });
  }
});

app.post("/api/workspace/clean-cache", (req, res) => {
  try {
    const activeFiles = new Set<string>();
    activeTasks.forEach(task => {
      const status = task.executionStatus || task.status;
      if (status === "pending" || status === "running" || status === "suspended") {
        if (task.results?.outputFiles) {
          task.results.outputFiles.forEach((file: string) => {
            if (file) activeFiles.add(file.trim().replace(/\\/g, "/"));
          });
        }
      }
    });

    const expiredFiles = new Set<string>();
    const expiredTasks = activeTasks.filter(task => {
      const status = task.executionStatus || task.status;
      return status === "completed" || status === "failed";
    });

    expiredTasks.forEach(task => {
      if (task.results?.outputFiles) {
        task.results.outputFiles.forEach((file: string) => {
          if (file) expiredFiles.add(file.trim().replace(/\\/g, "/"));
        });
      }
    });

    const filesToDelete: string[] = [];
    expiredFiles.forEach(file => {
      if (!activeFiles.has(file)) {
        filesToDelete.push(file);
      }
    });

    let deletedCount = 0;
    let releasedBytes = 0;
    const deletedFiles: string[] = [];

    filesToDelete.forEach(relPath => {
      try {
        const fullPath = safePath(relPath);
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            releasedBytes += stat.size;
            fs.unlinkSync(fullPath);
            deletedCount++;
            deletedFiles.push(relPath);
          } else if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            deletedCount++;
            deletedFiles.push(relPath);
          }
        }
      } catch (err) {
        console.error(`Error deleting cache file ${relPath}:`, err);
      }
    });

    // Recursively clean empty subdirectories under WORKSPACE_DIR
    const cleanEmptyDirs = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          cleanEmptyDirs(fullPath);
          if (fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
        }
      });
    };
    cleanEmptyDirs(WORKSPACE_DIR);

    res.json({
      success: true,
      message: `成功清理了 ${deletedCount} 个过期任务关联的文件`,
      deletedCount,
      releasedBytes,
      deletedFiles
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Backup and Export/Import APIs
app.get("/api/backup/export", (req, res) => {
  try {
    const backupData = {
      version: "1.0.0",
      exportTime: new Date().toISOString(),
      tasks: activeTasks,
      workspace: {} as Record<string, string>
    };

    // Helper to read all files in workspace recursively for single file export
    const readAllFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const relPath = path.relative(WORKSPACE_DIR, fullPath).replace(/\\/g, "/");
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          readAllFiles(fullPath);
        } else {
          // Save file content in base64 or plain utf8
          backupData.workspace[relPath] = fs.readFileSync(fullPath, "utf-8");
        }
      }
    };

    readAllFiles(WORKSPACE_DIR);
    res.setHeader("Content-Disposition", "attachment; filename=executor_backup.json");
    res.setHeader("Content-Type", "application/json");
    res.json(backupData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/backup/import", (req, res) => {
  const { tasks, workspace } = req.body;
  if (!tasks) {
    return res.status(400).json({ error: "Invalid backup file: missing tasks structure" });
  }
  try {
    // 1. Restore Tasks
    activeTasks = tasks;
    saveTasks(activeTasks);

    // 2. Restore Workspace Files
    if (workspace && typeof workspace === "object") {
      // Clean workspace directory
      fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

      for (const [relPath, content] of Object.entries(workspace)) {
        const filePath = safePath(relPath);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content as string, "utf-8");
      }
    }
    res.json({ success: true, message: "配置与文件还原成功" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite & Frontend Mounting
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
