import fs from "fs";
import path from "path";
import os from "os";
import { safePath, checkDangerousCommand } from "./security";
import { loadAIConfig } from "./config";
import { saveTasks, getWorkspaceFileMtimes } from "./persistence";
import { callAIProvider, getBackupProvider, getBackupProviders } from "./providers";
import { executeTool, simplifyPayload } from "./tools";
import { getRepoIndex } from "./repo-indexer";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

function getErrorFingerprint(errorMsg: string, toolName: string): string {
  let cleaned = errorMsg.toLowerCase();
  cleaned = cleaned.replace(/\d+/g, ""); // strip numbers
  cleaned = cleaned.replace(/at\s+.*?(?:\(|\n|$)/g, ""); // strip stack traces
  cleaned = cleaned.replace(/(?:\/[a-zA-Z0-9_\.\-]+)+/g, ""); // strip paths
  cleaned = cleaned.trim();
  return `${toolName}::${cleaned}`;
}

export async function executeTaskBackground(task: any, activeTasks: any[]): Promise<void> {
  const startTime = Date.now();
  const cpuStart = process.cpuUsage();
  const memStart = process.memoryUsage().heapUsed;
  
  // Track file modifications
  let preMtimes = getWorkspaceFileMtimes(WORKSPACE_DIR);

  let totalTokens = 0;
  let currentStep = 1;
  let history: any[] = [];

  const errorHistory: { fingerprint: string; count: number }[] = [];
  let selfHealingAttempts = 0;

  // Load configuration and model names
  const currentConfig = loadAIConfig();
  const providerName = task.parameters?.provider || currentConfig.activeProvider || "gemini";
  let modelName = task.parameters?.model || currentConfig.activeModel || "gemini-3.5-flash";

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

    // Load codebase awareness (RepoIndexer)
    let codebaseContext = "";
    try {
      const index = await getRepoIndex();
      if (index && index.files && index.files.length > 0) {
        codebaseContext += `\n\n[代码库结构感知 (Codebase Awareness)]\n当前工作区包含以下文件 (前 100 个)：\n${index.files.slice(0, 100).map((f: string) => `- ${f}`).join("\n")}`;
        if (index.symbols && index.symbols.length > 0) {
          codebaseContext += `\n\n代码库关键符号定义 (前 50 个)：\n${index.symbols.slice(0, 50).map((sym: any) => `- [${sym.type.toUpperCase()}] ${sym.name} (位于 ${sym.filePath}:${sym.line})`).join("\n")}`;
        }
      }
    } catch (e: any) {
      console.warn("Failed to inject codebase context into agent-loop:", e);
    }

    const finalSystemInstruction = (task.parameters?.systemInstruction || "你是一个实用的本地自动化任务助手。") + extraInstructions + codebaseContext;

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
          const backups = getBackupProviders(currentProvider, currentConfig);
          for (const backup of backups) {
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[灾备切换] 供应商 ${currentProvider.toUpperCase()} 呼叫报错 (${callErrorMsg})。系统自动激活高可用应急预案，尝试切换至备用供应商 ${backup.name.toUpperCase()} (模型: ${backup.model}) 重新尝试当前步骤！`
            });
            saveTasks(activeTasks);

            let tempProvider = backup.name;
            let tempModel = backup.model;

            if ((tempProvider === "agnes" || tempProvider === "agnesai" || tempProvider.toLowerCase().includes("agnes") || tempModel.toLowerCase().includes("agnes-video") || tempModel.toLowerCase().includes("agnes-image")) && (tempModel.toLowerCase().includes("image") || tempModel.toLowerCase().includes("video"))) {
              tempModel = "agnes-2.0-flash";
            } else if (tempProvider === "openai" && (tempModel.toLowerCase().includes("dall-e") || tempModel.toLowerCase().includes("dalle"))) {
              tempModel = "gpt-4o-mini";
            } else if (tempProvider === "gemini" && (tempModel.toLowerCase().includes("imagen") || tempModel.toLowerCase().includes("media"))) {
              tempModel = "gemini-1.5-flash";
            }

            let backupAttempt = 0;
            const backupMaxAttempts = 3;
            let backupSuccess = false;
            while (backupAttempt < backupMaxAttempts && !backupSuccess) {
              try {
                response = await callAIProvider(
                  tempProvider,
                  tempModel,
                  history,
                  task.parameters?.temperature ?? 0.2,
                  finalSystemInstruction,
                  currentConfig
                );
                backupSuccess = true;
                success = true;
                currentProvider = tempProvider;
                currentModel = tempModel;
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
                    message: `[备用自动重试] 备用供应商 ${tempProvider.toUpperCase()} 呼叫报错 (${backupErrStr})。将在 ${Math.round(delay)}ms 后重试 (${backupAttempt}/${backupMaxAttempts - 1})...`
                  });
                  saveTasks(activeTasks);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
            }
            if (backupSuccess) {
              break;
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
            message: `[Safe Recovery] 自动容灾：自动精简历史记录（Payload Simplification）并重试呼叫...`
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
            const fingerprint = getErrorFingerprint(errorMsg, name);
            
            // Track in error history
            let existing = errorHistory.find(h => h.fingerprint === fingerprint);
            if (!existing) {
              existing = { fingerprint, count: 1 };
              errorHistory.push(existing);
            } else {
              existing.count++;
            }

            // Self-healing logging and breaker checks
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[自愈引擎监控] 遭遇错误。特征指纹: "${fingerprint}"。当前特征累计发生 ${existing.count} 次。已自动重试/自我修复次数: ${selfHealingAttempts}/3`
            });
            saveTasks(activeTasks);

            // Hard Breaker 1: Repetitive Error Breaker (原地磨损拦截)
            if (existing.count >= 2) {
              const breakMsg = `[自愈熔断] 拦截到重复错误指纹 ("${fingerprint}")。检测到模型陷入原地死循环。自愈引擎启动安全拦截，强行熔断任务运行以防止耗尽 API 限额或陷入无限等待。请人工介入排查。`;
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "error",
                message: breakMsg
              });
              
              // Build unconfirmed hypothesis diagnostic report
              const hypothesis = `\n\n### 🚨 [UNCONFIRMED_HYPOTHESIS / 未证实修复假设]\n根据系统自动反思，该故障（${errorMsg}）在执行工具 ${name} 时重复发生了 ${existing.count} 次。\n这极有可能是因为：\n1. 修复代码时没有考虑到前置依赖或环境状态；\n2. AI 模型未能跳出当前的决策局部最优解。\n请参考本提示，重置任务，检查代码逻辑并手动调整后再次运行。`;
              
              task.results.error = breakMsg + hypothesis;
              task.executionStatus = "failed";
              task.status = "failed";
              task.completedAt = new Date().toISOString();
              saveTasks(activeTasks);
              return; // Halt background loop completely!
            }

            // Hard Breaker 2: Total Self-Healing Budget (总预算限额)
            selfHealingAttempts++;
            if (selfHealingAttempts > 3) {
              const budgetBreakMsg = `[自愈熔断] 已达到该任务的最大自动自愈重试上限 (3次)。为保证运行确定性与防范死循环，系统自动将任务标记为失败。`;
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "error",
                message: budgetBreakMsg
              });
              
              const hypothesis = `\n\n### 🚨 [UNCONFIRMED_HYPOTHESIS / 未证实修复假设]\n任务运行过程中累计触发了超过 3 次自我修复尝试。底层错误为：\n> ${errorMsg}\n建议点击“重置任务”清空对话历史，并在 Prompt 中加入更明确的修复约束。`;
              
              task.results.error = budgetBreakMsg + hypothesis;
              task.executionStatus = "failed";
              task.status = "failed";
              task.completedAt = new Date().toISOString();
              saveTasks(activeTasks);
              return; // Halt background loop completely!
            }

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
      recoverySuggestion = `\n\n[安全恢复建议 / Safe Recovery Proposal]: 检测到任务运行中触发了数据序列化 (Serialization) 或未定义属性访问 (Undefined Property) 错误。这可能是由于传递了过大的上下文字序、循环引用、或未初始化的空数据字段导致。为了防止任务持续挂起 (Hanging)，建议您：\n1. 点击 "重置任务" 按钮清除异常上下文并释放挂起状态；\n2. 精简关联 of the context files (Context Files) 或输入 Payload 长度；\n3. 分次分块 (Chunked Payload) 进行小步幅的任务拆分执行，或降低并发模型请求字数。`;
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

    task.results.outputFiles = Array.from(new Set([...(task.results.outputFiles || []), ...outputFiles]));
    task.resourceConsumption = {
      durationMs: (task.resourceConsumption?.durationMs || 0) + durationMs,
      tokensUsed: (task.resourceConsumption?.tokensUsed || 0) + totalTokens,
      cpuLoadAvg: isNaN(cpuLoadAvg) ? 0 : cpuLoadAvg,
      memoryUsedBytes: Math.max(task.resourceConsumption?.memoryUsedBytes || 0, memoryUsedBytes)
    };
    
    saveTasks(activeTasks);
  }
}

export async function resumeTaskBackground(task: any, activeTasks: any[]): Promise<void> {
  const startTime = Date.now();
  const cpuStart = process.cpuUsage();
  const memStart = process.memoryUsage().heapUsed;
  
  if (!task.executionState) {
    throw new Error("Task execution state is missing");
  }

  // Restore execution state
  let history = task.executionState.history || [];
  let currentStep = task.executionState.currentStep || 1;
  let totalTokens = task.executionState.totalTokens || 0;
  let preMtimes = task.executionState.preMtimes || getWorkspaceFileMtimes(WORKSPACE_DIR);

  // Delete saved execution state now that we've restored it
  delete task.executionState;
  saveTasks(activeTasks);

  const currentConfig = loadAIConfig();
  const providerName = task.parameters?.provider || currentConfig.activeProvider || "gemini";
  let modelName = task.parameters?.model || currentConfig.activeModel || "gemini-3.5-flash";

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

    // Load codebase awareness (RepoIndexer)
    let codebaseContext = "";
    try {
      const index = await getRepoIndex();
      if (index && index.files && index.files.length > 0) {
        codebaseContext += `\n\n[代码库结构感知 (Codebase Awareness)]\n当前工作区包含以下文件 (前 100 个)：\n${index.files.slice(0, 100).map((f: string) => `- ${f}`).join("\n")}`;
        if (index.symbols && index.symbols.length > 0) {
          codebaseContext += `\n\n代码库关键符号定义 (前 50 个)：\n${index.symbols.slice(0, 50).map((sym: any) => `- [${sym.type.toUpperCase()}] ${sym.name} (位于 ${sym.filePath}:${sym.line})`).join("\n")}`;
        }
      }
    } catch (e: any) {
      console.warn("Failed to inject codebase context into agent-loop resume:", e);
    }

    const finalSystemInstruction = (task.parameters?.systemInstruction || "你是一个实用的本地自动化任务助手。") + extraInstructions + codebaseContext;

    const MAX_STEPS = 15;
    const errorHistory: { fingerprint: string; count: number }[] = [];
    let selfHealingAttempts = 0;
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
          const backups = getBackupProviders(currentProvider, currentConfig);
          for (const backup of backups) {
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[灾备切换] 供应商 ${currentProvider.toUpperCase()} 呼叫报错 (${callErrorMsg})。系统自动激活高可用应急预案，尝试切换至备用供应商 ${backup.name.toUpperCase()} (模型: ${backup.model}) 重新尝试当前步骤！`
            });
            saveTasks(activeTasks);

            let tempProvider = backup.name;
            let tempModel = backup.model;

            if ((tempProvider === "agnes" || tempProvider === "agnesai" || tempProvider.toLowerCase().includes("agnes") || tempModel.toLowerCase().includes("agnes-video") || tempModel.toLowerCase().includes("agnes-image")) && (tempModel.toLowerCase().includes("image") || tempModel.toLowerCase().includes("video"))) {
              tempModel = "agnes-2.0-flash";
            } else if (tempProvider === "openai" && (tempModel.toLowerCase().includes("dall-e") || tempModel.toLowerCase().includes("dalle"))) {
              tempModel = "gpt-4o-mini";
            } else if (tempProvider === "gemini" && (tempModel.toLowerCase().includes("imagen") || tempModel.toLowerCase().includes("media"))) {
              tempModel = "gemini-1.5-flash";
            }

            let backupAttempt = 0;
            const backupMaxAttempts = 3;
            let backupSuccess = false;
            while (backupAttempt < backupMaxAttempts && !backupSuccess) {
              try {
                response = await callAIProvider(
                  tempProvider,
                  tempModel,
                  history,
                  task.parameters?.temperature ?? 0.2,
                  finalSystemInstruction,
                  currentConfig
                );
                backupSuccess = true;
                success = true;
                currentProvider = tempProvider;
                currentModel = tempModel;
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
                    message: `[备用自动重试] 备用供应商 ${tempProvider.toUpperCase()} 呼叫报错 (${backupErrStr})。将在 ${Math.round(delay)}ms 后重试 (${backupAttempt}/${backupMaxAttempts - 1})...`
                  });
                  saveTasks(activeTasks);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
            }
            if (backupSuccess) {
              break;
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
            const fingerprint = getErrorFingerprint(errorMsg, name);
            
            // Track in error history
            let existing = errorHistory.find(h => h.fingerprint === fingerprint);
            if (!existing) {
              existing = { fingerprint, count: 1 };
              errorHistory.push(existing);
            } else {
              existing.count++;
            }

            // Self-healing logging and breaker checks
            task.logs.push({
              timestamp: new Date().toISOString(),
              type: "system",
              message: `[自愈引擎监控] 遭遇错误。特征指纹: "${fingerprint}"。当前特征累计发生 ${existing.count} 次。已自动重试/自我修复次数: ${selfHealingAttempts}/3`
            });
            saveTasks(activeTasks);

            // Hard Breaker 1: Repetitive Error Breaker (原地磨损拦截)
            if (existing.count >= 2) {
              const breakMsg = `[自愈熔断] 拦截到重复错误指纹 ("${fingerprint}")。检测到模型陷入原地死循环。自愈引擎启动安全拦截，强行熔断任务运行以防止耗尽 API 限额或陷入无限等待。请人工介入排查。`;
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "error",
                message: breakMsg
              });
              
              // Build unconfirmed hypothesis diagnostic report
              const hypothesis = `\n\n### 🚨 [UNCONFIRMED_HYPOTHESIS / 未证实修复假设]\n根据系统自动反思，该故障（${errorMsg}）在执行工具 ${name} 时重复发生了 ${existing.count} 次。\n这极有可能是因为：\n1. 修复代码时没有考虑到前置依赖或环境状态；\n2. AI 模型未能跳出当前的决策局部最优解。\n请参考本提示，重置任务，检查代码逻辑并手动调整后再次运行。`;
              
              task.results.error = breakMsg + hypothesis;
              task.executionStatus = "failed";
              task.status = "failed";
              task.completedAt = new Date().toISOString();
              saveTasks(activeTasks);
              return; // Halt background loop completely!
            }

            // Hard Breaker 2: Total Self-Healing Budget (总预算限额)
            selfHealingAttempts++;
            if (selfHealingAttempts > 3) {
              const budgetBreakMsg = `[自愈熔断] 已达到该任务的最大自动自愈重试上限 (3次)。为保证运行确定性与防范死循环，系统自动将任务标记为失败。`;
              task.logs.push({
                timestamp: new Date().toISOString(),
                type: "error",
                message: budgetBreakMsg
              });
              
              const hypothesis = `\n\n### 🚨 [UNCONFIRMED_HYPOTHESIS / 未证实修复假设]\n任务运行过程中累计触发了超过 3 次自我修复尝试。底层错误为：\n> ${errorMsg}\n建议点击“重置任务”清空对话历史，并在 Prompt 中加入更明确的修复约束。`;
              
              task.results.error = budgetBreakMsg + hypothesis;
              task.executionStatus = "failed";
              task.status = "failed";
              task.completedAt = new Date().toISOString();
              saveTasks(activeTasks);
              return; // Halt background loop completely!
            }

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
}
