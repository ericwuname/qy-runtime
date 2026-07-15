import fs from "fs";
import path from "path";
import { safePath, writeExecutorLog } from "./security";
import { loadAIConfig } from "./config";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
const TASKS_FILE = path.resolve(process.cwd(), "tasks.json");

const EXECUTOR_BASE_DIR = path.resolve(process.cwd(), "bridges/qi_yuan_executor");
const EXECUTOR_PENDING_DIR = path.join(EXECUTOR_BASE_DIR, "pending");
const EXECUTOR_RUNNING_DIR = path.join(EXECUTOR_BASE_DIR, "running");
const EXECUTOR_COMPLETED_DIR = path.join(EXECUTOR_BASE_DIR, "completed");
const EXECUTOR_HEARTBEATS_DIR = path.join(EXECUTOR_BASE_DIR, "heartbeats");

// Ensure dirs exist
[EXECUTOR_PENDING_DIR, EXECUTOR_RUNNING_DIR, EXECUTOR_COMPLETED_DIR, EXECUTOR_HEARTBEATS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const DEFAULT_TASKS = [
  {
    id: "task-1",
    description: {
      title: "分析项目依赖并生成 Markdown 报告",
      prompt: "读取当前项目的 package.json 文件，分析 dependencies 和 devDependencies，识别各个主要依赖项的作用，并在 workspace 根目录下生成一个名为 DEPENDENCIES_REPORT.md 的报告文件。分析完成后，简洁总结生成的文件路径 and 内容。"
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
    title: "分析项目依赖并生成 Markdown 报告",
    prompt: "读取当前项目的 package.json 文件，分析 dependencies 和 devDependencies，识别各个主要依赖项的作用，并在 workspace 根目录下生成一个名为 DEPENDENCIES_REPORT.md 的报告文件。分析完成后，简洁总结生成的文件路径 and 内容。",
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
    title: "编写并运行 Python 质数乘积计算脚本",
    prompt: "在工作区中创建一个 python 脚本 (prime_product.py)，用于寻找 1-50 之间所有的质数，并计算它们的乘积。编写完成后，运行该脚本并捕获其标准输出，将结果以及质数列表写入报告 prime_result.txt 中。",
    status: "pending",
    model: "gemini-3.5-flash",
    temperature: 0.1
  }
];

export function loadTasks(): any[] {
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

    // Standardize to latest schema format
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

      // Sync legacy properties
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

export function syncTaskToFilesystem(task: any) {
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
      fs.writeFileSync(pendingFile, JSON.stringify(taskPayload, null, 2), "utf-8");
      if (fs.existsSync(runningFile)) fs.unlinkSync(runningFile);
      if (fs.existsSync(completedFile)) fs.unlinkSync(completedFile);
      if (fs.existsSync(heartbeatFile)) fs.unlinkSync(heartbeatFile);
    } 
    else if (currentStatus === "running") {
      fs.writeFileSync(runningFile, JSON.stringify(taskPayload, null, 2), "utf-8");
      fs.writeFileSync(heartbeatFile, JSON.stringify({
        task_id: taskId,
        generation: task.generation || 1,
        retry_count: task.retryCount || 0,
        last_heartbeat: new Date().toISOString()
      }, null, 2), "utf-8");

      if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
      if (fs.existsSync(completedFile)) fs.unlinkSync(completedFile);
    } 
    else {
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

export function saveTasks(tasks: any[]) {
  try {
    const cleanedTasks = tasks.map((t: any) => {
      t.title = t.description?.title || t.title || "Untitled Task";
      t.prompt = t.description?.prompt || t.prompt || "";
      t.status = t.executionStatus || t.status || "pending";
      t.model = t.parameters?.model || t.model || "gemini-3.5-flash";
      t.temperature = t.parameters?.temperature !== undefined ? t.parameters.temperature : (t.temperature !== undefined ? t.temperature : 0.2);
      t.systemInstruction = t.parameters?.systemInstruction || t.systemInstruction || "";
      t.result = t.results?.summary || t.result || "";
      
      try {
        syncTaskToFilesystem(t);
      } catch (syncErr) {
        console.error("Error syncing task inside saveTasks:", syncErr);
      }
      
      return t;
    });

    const tmpFile = `${TASKS_FILE}.tmp`;
    const bakFile = `${TASKS_FILE}.bak`;
    
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
    
    fs.writeFileSync(tmpFile, jsonContent, "utf-8");
    if (fs.existsSync(TASKS_FILE)) {
      try {
        fs.copyFileSync(TASKS_FILE, bakFile);
      } catch (bakErr) {
        console.error("Failed to create tasks backup:", bakErr);
      }
    }
    fs.renameSync(tmpFile, TASKS_FILE);
  } catch (error) {
    console.error("Error saving tasks atomically:", error);
  }
}

export function syncFilesystemWithMemory(activeTasks: any[]): boolean {
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
    return changed;
  } catch (err) {
    console.error("Error in bidirectional filesystem synchronization:", err);
    return false;
  }
}

export function getDiskUsagePercent(): number {
  try {
    if (typeof fs.statfsSync === "function") {
      const stats = fs.statfsSync(WORKSPACE_DIR);
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      return total > 0 ? (used / total) * 100 : 0;
    }
  } catch (e) {
    // ignore / fallback
  }
  return 0;
}

export function checkAndRecoverZombieTasks(activeTasks: any[]): boolean {
  try {
    const diskUsage = getDiskUsagePercent();
    if (diskUsage > 90) {
      console.warn(`[CRITICAL WARNING] 磁盘空间使用率达 ${diskUsage.toFixed(1)}%! 暂停回收僵尸任务。`);
      writeExecutorLog("system", "DISK_SPACE_EXHAUSTED", "CRITICAL", {
        disk_usage_percent: diskUsage,
        reason: "Disk space is above 90% protective threshold. Halting automatic reschedules."
      });
      return false;
    }

    if (!fs.existsSync(EXECUTOR_RUNNING_DIR)) return false;
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
              summary: "任务已达到僵尸回收重试次数上限 (5次)，自动熔断并归类为 OS/TOOL 级别异常。",
              error: "任务已达到最大重试次数上限 (5次)，可能存在物理死锁或运行崩溃，自动标记为执行失败。",
              errorClassification: "SYSTEM_RECLAIM_BREAKER", // Assign correctly (Point 15 audit fix!)
              outputFiles: []
            };
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[熔断告警] 该任务连续心跳超时已被回收 ${currentRetries} 次，已达到重试上限(5)。系统启动自动熔断，强行标记为失败(SYSTEM_RECLAIM_BREAKER)，并等待人工介入。`
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

            if (fs.existsSync(runningFilePath)) fs.unlinkSync(runningFilePath);
            if (fs.existsSync(heartbeatPath)) fs.unlinkSync(heartbeatPath);
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
    return changed;
  } catch (err) {
    console.error("Error in zombie recovery process:", err);
    return false;
  }
}

export function getWorkspaceFileMtimes(dir: string): Record<string, number> {
  const mtimes: Record<string, number> = {};
  const scan = (d: string) => {
    if (!fs.existsSync(d)) return;
    const files = fs.readdirSync(d);
    for (const f of files) {
      const full = path.join(d, f);
      const rel = path.relative(WORKSPACE_DIR, full).replace(/\\/g, "/");
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        scan(full);
      } else {
        mtimes[rel] = stat.mtimeMs;
      }
    }
  };
  scan(dir);
  return mtimes;
}

export function getFileTree(dir: string, baseDir = WORKSPACE_DIR): any[] {
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
  return result.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}
