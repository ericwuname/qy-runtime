import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import dns from "dns";
import { safePath, checkDangerousCommand, isValidPublicUrl } from "./security";
import { loadAIConfig, saveAIConfig, diagnoseFetchError, maskConfigKeys, mergeSubmittedConfig } from "./config";
import { saveTasks, getDiskUsagePercent, getFileTree } from "./persistence";
import { callAIProvider, getBackupProvider } from "./providers";
import { executeTaskBackground, resumeTaskBackground } from "./agent-loop";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

export function registerRoutes(app: express.Express, getActiveTasks: () => any[], setActiveTasks: (tasks: any[]) => void) {
  
  // 0. Configuration Management APIs
  app.get("/api/config", (req, res) => {
    const currentConfig = loadAIConfig();
    // Return masked config to the client to avoid cleartext leak in HTTP (Point 13 audit fix!)
    res.json(maskConfigKeys(currentConfig));
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
      if (apiKey && apiKey !== "******") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const fetchUrl = `${url}/models`;
      let response;
      try {
        response = await fetch(fetchUrl, { headers });
      } catch (e: any) {
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
          } catch (ollamaErr) {}
        }
        throw e;
      }
      
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
        } catch (e) {}
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

      models.sort();
      res.json({ success: true, models });
    } catch (err: any) {
      res.status(500).json({ error: `连接到模型接口失败: ${err.message}` });
    }
  });

  app.post("/api/config/fetch-models", async (req, res) => {
    let { baseURL, apiKey, provider } = req.body;
    if (apiKey === "******") {
      const savedConfig = loadAIConfig();
      apiKey = savedConfig?.providers?.[provider]?.apiKey || "";
    }
    
    try {
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
      if (apiKey && apiKey !== "******") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const fetchUrl = `${url}/models`;
      let response;
      try {
        response = await fetch(fetchUrl, { headers });
      } catch (e: any) {
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
          } catch (ollamaErr) {}
        }
        throw e;
      }
      
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
        } catch (e) {}
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

      models.sort();
      res.json({ success: true, models });
    } catch (err: any) {
      const errorDetail = diagnoseFetchError(err);
      res.status(500).json({ error: `连接到模型接口失败: ${errorDetail}` });
    }
  });

  app.post("/api/config/test-connection", async (req, res) => {
    let { baseURL, apiKey, provider } = req.body;
    if (apiKey === "******") {
      const savedConfig = loadAIConfig();
      apiKey = savedConfig?.providers?.[provider]?.apiKey || "";
    }
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
      if (apiKey && apiKey !== "******") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const fetchUrl = `${url}/models`;
      let response;
      try {
        response = await fetch(fetchUrl, { headers });
      } catch (e: any) {
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
          } catch (ollamaErr) {}
        }
        const errorDetail = diagnoseFetchError(e);
        return res.status(500).json({ error: `网络连接失败，请检查 Base URL 是否正确并可从服务器访问: ${errorDetail}` });
      }

      if (response.ok) {
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
    let { baseURL, provider } = req.body;
    if (!baseURL) {
      if (provider === "gemini") {
        baseURL = "https://generativelanguage.googleapis.com";
      } else if (provider === "anthropic") {
        baseURL = "https://api.anthropic.com";
      } else if (provider === "openai") {
        baseURL = "https://api.openai.com/v1";
      } else {
        return res.status(400).json({ error: "请提供需要诊断的 Base URL" });
      }
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
    const submittedConfig = req.body;
    if (!submittedConfig || !submittedConfig.providers) {
      return res.status(400).json({ error: "Invalid configuration structure" });
    }

    const currentDisk = loadAIConfig();
    const merged = mergeSubmittedConfig(submittedConfig, currentDisk);

    const activeP = merged.activeProvider;
    if (activeP && merged.providers[activeP]) {
      const pConfig = merged.providers[activeP];
      if (pConfig.availableModels && Array.isArray(pConfig.availableModels)) {
        if (!pConfig.availableModels.includes(merged.activeModel)) {
          merged.activeModel = pConfig.defaultModel || pConfig.availableModels[0] || "";
        }
      }
    }
    
    saveAIConfig(merged);
    res.json({ success: true, config: maskConfigKeys(merged) });
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

  // 1. Task Queue Management
  app.get("/api/tasks", (req, res) => {
    res.json(getActiveTasks());
  });

  app.post("/api/tasks", (req, res) => {
    const { title, prompt, provider, model, temperature, systemInstruction, additionalParams, submitter, retryStrategy } = req.body;
    if (!title || !prompt) {
      return res.status(400).json({ error: "Title and prompt are required." });
    }

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
      title,
      prompt,
      status: "pending",
      model: taskModel,
      temperature: temperature !== undefined ? Number(temperature) : 0.2,
      systemInstruction: systemInstruction || "你是一个实用的本地自动化任务助手。"
    };

    const tasks = getActiveTasks();
    tasks.push(newTask);
    setActiveTasks(tasks);
    saveTasks(tasks);
    res.status(201).json(newTask);
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const { id } = req.params;
    let tasks = getActiveTasks();
    const initialLen = tasks.length;
    tasks = tasks.filter(t => t.id !== id);
    if (tasks.length === initialLen) {
      return res.status(404).json({ error: "Task not found" });
    }
    setActiveTasks(tasks);
    saveTasks(tasks);
    res.json({ success: true, message: "Task deleted successfully" });
  });

  app.post("/api/tasks/:id/reset", (req, res) => {
    const { id } = req.params;
    const tasks = getActiveTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    
    task.executionStatus = "pending";
    task.status = "pending";
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.results = {
      summary: "",
      outputFiles: []
    };
    task.result = undefined;
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
    saveTasks(tasks);
    res.json(task);
  });

  app.post("/api/tasks/:id/run", async (req, res) => {
    const { id } = req.params;
    const tasks = getActiveTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found" });
    }
    
    const task = tasks[taskIndex];
    if (task.executionStatus === "running") {
      return res.status(400).json({ error: "Task is already running" });
    }

    const currentConfig = loadAIConfig();
    const providerName = task.parameters?.provider || currentConfig.activeProvider || "gemini";
    let modelName = task.parameters?.model || currentConfig.activeModel || "gemini-3.5-flash";

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

    task.executionStatus = "running";
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.startedExecutionTimestamp = Date.now();
    delete task.executionState;
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
    saveTasks(tasks);

    res.json({ success: true, message: "Task started", task });

    // background execution
    executeTaskBackground(task, tasks).catch(err => {
      console.error(`Unhandled error running task ${id} in background:`, err);
    });
  });

  app.post("/api/tasks/:id/resume", async (req, res) => {
    const { id } = req.params;
    const tasks = getActiveTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found" });
    }
    
    const task = tasks[taskIndex];
    if (task.executionStatus === "running") {
      return res.status(400).json({ error: "Task is already running" });
    }

    if (!task.executionState) {
      return res.status(400).json({ error: "此任务没有保存的断点状态，无法执行断点续传。请直接运行或重置任务。" });
    }

    const currentConfig = loadAIConfig();
    const providerName = task.parameters?.provider || currentConfig.activeProvider || "gemini";
    let modelName = task.parameters?.model || currentConfig.activeModel || "gemini-3.5-flash";

    let isMediaModel = false;
    const originalModelName = modelName;
    if ((providerName === "agnes" || providerName === "agnesai" || providerName.toLowerCase().includes("agnes") || modelName.toLowerCase().includes("agnes-video") || modelName.toLowerCase().includes("agnes-image")) && (modelName.toLowerCase().includes("image") || modelName.toLowerCase().includes("video"))) {
      modelName = "agnes-2.0-flash";
      isMediaModel = true;
    }

    task.executionStatus = "running";
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    task.startedExecutionTimestamp = task.startedExecutionTimestamp || Date.now();
    task.logs.push({
      timestamp: new Date().toISOString(),
      type: "system",
      message: `[断点续传启动] 正在载入历史执行上下文，继续从步骤 ${task.executionState.currentStep} 执行 (${providerName.toUpperCase()}:${originalModelName})...`
    });
    saveTasks(tasks);

    res.json({ success: true, message: "Task resumed", task });

    // background execution continuation
    resumeTaskBackground(task, tasks).catch(err => {
      console.error(`Unhandled error resuming task ${id} in background:`, err);
    });
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

  app.post("/api/workspace/terminal", async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "Missing command" });
    if (checkDangerousCommand(command)) {
      return res.status(400).json({ error: "安全拦截: 该命令被安全策略拒绝运行。" });
    }
    try {
      const start = Date.now();
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
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

  app.get("/api/workspace/image", (req, res) => {
    const { path: relPath } = req.query;
    if (!relPath) return res.status(400).json({ error: "Missing path" });
    try {
      const imgPath = safePath(relPath as string);
      if (!fs.existsSync(imgPath)) {
        return res.status(404).json({ error: "Image not found" });
      }
      const ext = path.extname(imgPath).toLowerCase();
      let contentType = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".webp") contentType = "image/webp";
      else if (ext === ".gif") contentType = "image/gif";
      else if (ext === ".svg") contentType = "image/svg+xml";

      res.setHeader("Content-Type", contentType);
      const stream = fs.createReadStream(imgPath);
      stream.pipe(res);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/workspace/ai-assistant", async (req, res) => {
    const { filePath, fileContent, filePaths, scope, action, customPrompt } = req.body;
    
    try {
      const currentConfig = loadAIConfig();
      const providerName = currentConfig.activeProvider || "gemini";
      const modelName = currentConfig.activeModel || "gemini-3.5-flash";

      // Helper function to read recursive files in safe directory
      const getFilesRecursive = (dir: string, baseDir: string = dir): string[] => {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          const relPath = path.relative(baseDir, fullPath);
          const stat = fs.statSync(fullPath);
          if (stat && stat.isDirectory()) {
            if (!file.startsWith(".") && file !== "node_modules" && file !== "dist") {
              results = results.concat(getFilesRecursive(fullPath, baseDir));
            }
          } else {
            const ext = path.extname(file).toLowerCase();
            const ignoreExts = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".zip", ".tar", ".gz", ".db", ".sqlite", ".ico"];
            if (!ignoreExts.includes(ext) && !file.startsWith(".")) {
              results.push(relPath);
            }
          }
        }
        return results;
      };

      let targetFiles: { path: string; content: string }[] = [];
      const isProjectScope = scope === "project";

      if (isProjectScope) {
        let pathsToRead = filePaths;
        if (!pathsToRead || !Array.isArray(pathsToRead) || pathsToRead.length === 0) {
          // Read all recursive files in workspace
          pathsToRead = getFilesRecursive(WORKSPACE_DIR);
        }

        let totalSize = 0;
        const maxFiles = 20;
        const maxSize = 400 * 1024; // 400KB limit

        for (const relPath of pathsToRead) {
          if (targetFiles.length >= maxFiles || totalSize >= maxSize) break;
          try {
            const absPath = safePath(relPath);
            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
              const size = fs.statSync(absPath).size;
              if (size < 150 * 1024) { // Only read files smaller than 150KB
                const content = fs.readFileSync(absPath, "utf-8");
                targetFiles.push({ path: relPath, content });
                totalSize += size;
              }
            }
          } catch (e) {
            console.error(`Error loading multi-file analysis content for ${relPath}:`, e);
          }
        }
      } else {
        if (!filePath || fileContent === undefined) {
          return res.status(400).json({ error: "Missing filePath or fileContent" });
        }
        targetFiles.push({ path: filePath, content: fileContent });
      }

      if (targetFiles.length === 0) {
        return res.status(400).json({ error: "No text-based code or log files found in the active context" });
      }

      let promptText = "";
      if (isProjectScope) {
        const fileSummaries = targetFiles.map(f => `--- 文件路径: ${f.path} ---\n${f.content}`).join("\n\n");
        
        if (action === "explain") {
          promptText = `你是一个资深的软件架构专家。请对当前沙箱项目的多文件系统进行**深度宏观解读**、**拓扑结构解析**与**依赖流程分析**。
          
当前项目包含以下核心文件：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供：
1. **系统架构与职责分工**: 分析项目的整体架构（如：数据采集、特征计算、模型运行等），详细说明各文件的核心职责和协同机制。
2. **核心业务数据流**: 绘制/详细文字描述数据流或调用链路，说明数据是如何在文件之间流转和演变的。
3. **全局协同优化建议**: 指出架构层面任何可优化、解耦或提升健壮性的方向。
请使用结构清晰、排版美观、富有科技感的 Markdown 格式输出（建议使用中英双语核心术语，全中文解析）。`;
        } else if (action === "optimize") {
          promptText = `你是一个精通系统重构和性能调优的首席架构师。请针对当前项目的多文件协同场景，进行深度审查并输出**多文件重构及全局优化方案**。

当前项目包含以下核心文件：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供：
1. **多文件协同重构方案**: 分析各文件间的依赖、职责，指出冗余或不合理的地方，提出优化重构思路。
2. **重构后的全局架构与协同流程**: 说明重构后文件结构如何演变、消息/数据如何流转。
3. **关键文件重构建议**: 提供各文件的优化方向、架构建议或局部的重构范式。`;
        } else if (action === "fix-bugs") {
          promptText = `你是一个卓越的白盒安全专家和 Debug 专家。请对当前沙箱项目的多文件系统进行全局逻辑审查，排查跨文件的 Bug、潜在死锁、未捕获异常、以及架构冲突。

当前项目包含以下核心文件：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供：
1. **全局漏洞与 Bug 报告**: 分析存在的潜在运行崩溃点、时序冲突、状态不一致或隐藏的安全隐患。
2. **多文件协同修复策略**: 说明如何多端/多文件对齐协同解决该 Bug。
3. **关键修复建议**: 提出具体、可落地的解决思路。`;
        } else if (action === "data-summary") {
          promptText = `你是一个资深的数据分析专家。请对当前沙箱项目中多个文件的数据流、运行日志或数据输出内容进行深度多文件联合提炼和数据洞察：

当前项目包含以下核心文件：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提取并概括：
1. **全局核心数据/指标摘要**: 跨文件的关键运行结果、指标、状态等。
2. **多源数据模式与趋势**: 发现不同文件产出数据之间的相互联系、隐藏规律或异常波动。
3. **多端协同业务建议**: 基于分析数据得出的多端落地与改进策略。`;
        } else if (action === "custom") {
          promptText = `你是一个强大的 AI 编程与工作区协同助手。请针对当前沙箱项目中的多个文件，回答用户的具体指令或提问。

当前项目包含以下核心文件：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

用户提问/指令: "${customPrompt}"

请结合上述所有文件内容，进行多文件全局视角的精准解答。如果是代码相关的修改，请提供修改后的核心文件完整代码块，方便用户一键替换。`;
        } else {
          return res.status(400).json({ error: "Invalid action" });
        }
      } else {
        const filePath = targetFiles[0].path;
        const fileContent = targetFiles[0].content;

        if (action === "explain") {
          promptText = `你是一个资深的软件工程专家，请对以下文件进行深度解读和技术解析。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请详细说明：
1. 该文件的主要功能、职责与应用场景。
2. 核心逻辑、算法或架构设计。
3. 给开发者的阅读与后续二次开发建议。
请使用结构清晰、排版美观的 Markdown 格式输出（支持中英文双语对照或全中文解析）。`;
        } else if (action === "optimize") {
          promptText = `你是一个追求极致性能和代码规范的重构大师。请对以下文件进行审查并提出高级重构/优化意见：

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **重构亮点**: 识别逻辑冗余、性能瓶颈、或是缺乏健壮性的部分，并解释为什么需要优化。
2. **优化后的代码**: 在下方提供一份**完整**、**高可读性**、符合最佳实践的重构后代码。请确保将代码包裹在精确的代码块中（例如：\`\`\`python ... \`\`\` 或 \`\`\`javascript ... \`\`\`），以便执行引擎能够准确识别，并在后续中提供一键应用能力。`;
        } else if (action === "fix-bugs") {
          promptText = `你是一个资深的白盒安全专家和 Debug 工具。请对以下代码进行深度逻辑审查，排查潜在的 Bug、语法错误、不合规的逻辑结构。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **缺陷分析**: 列出检测到的潜在风险、运行崩溃隐患或逻辑漏洞。
2. **安全自愈方案**: 提出针对性的修复策略。
3. **修复后的完整代码**: 在下方提供一份**完整**、**修正后**的代码，包裹在对应的代码块中，方便用户一键应用。`;
        } else if (action === "data-summary") {
          promptText = `你是一个资深的数据分析专家。请对以下文件的数据流、运行日志或数据输出内容进行深度提炼和数据洞察：

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提取并概括：
1. **核心数据摘要**: 主要的关键指标、运行结果或重要数据点。
2. **模式与趋势**: 发现数据中的隐藏规律、趋势或异常波动。
3. **下一步行动建议**: 基于分析数据得出的具体、可落地业务策略建议。`;
        } else if (action === "custom") {
          promptText = `你是一个强大的 AI 编程与工作区协同助手。请针对以下文件回答用户的具体指令或提问。

文件路径: ${filePath}
用户提问/指令: "${customPrompt}"

文件内容:
\`\`\`
${fileContent}
\`\`\`

请结合文件内容进行精准解答，如果是代码相关的修改，请提供修改后的完整代码块，以便用户能够一键替换。`;
        } else {
          return res.status(400).json({ error: "Invalid action" });
        }
      }

      const systemInstruction = `You are a professional, high-performance developer sandbox assistant. You write perfect Markdown responses in Chinese. Your insights are precise, actionable, and based on solid engineering principles. Always keep any recommended code block complete rather than writing partial snippets, so the user can easily replace their file.`;

      const history = [
        {
          role: "user",
          parts: [{ text: promptText }]
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

      res.json({ success: true, response: response.text });
    } catch (err: any) {
      res.status(500).json({ error: `AI 协同分析失败: ${err.message}` });
    }
  });

  app.post("/api/workspace/ai-assistant-duplicate-old", async (req, res) => {
    const { filePath, fileContent, action, customPrompt } = req.body;
    if (!filePath || fileContent === undefined) {
      return res.status(400).json({ error: "Missing filePath or fileContent" });
    }

    try {
      const currentConfig = loadAIConfig();
      const providerName = currentConfig.activeProvider || "gemini";
      const modelName = currentConfig.activeModel || "gemini-3.5-flash";

      let promptText = "";
      if (action === "explain") {
        promptText = `你是一个资深的软件工程专家，请对以下文件进行深度解读和技术解析。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请详细说明：
1. 该文件的主要功能、职责与应用场景。
2. 核心逻辑、算法或架构设计。
3. 给开发者的阅读与后续二次开发建议。
请使用结构清晰、排版美观的 Markdown 格式输出（支持中英文双语对照或全中文解析）。`;
      } else if (action === "optimize") {
        promptText = `你是一个追求极致性能和代码规范的重构大师。请对以下文件进行审查并提出高级重构/优化意见：

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **重构亮点**: 识别逻辑冗余、性能瓶颈、或是缺乏健壮性的部分，并解释为什么需要优化。
2. **优化后的代码**: 在下方提供一份**完整**、**高可读性**、符合最佳实践的重构后代码。请确保将代码包裹在精确的代码块中（例如：\`\`\`python ... \`\`\` 或 \`\`\`javascript ... \`\`\`），以便执行引擎能够准确识别，并在后续中提供一键应用能力。`;
      } else if (action === "fix-bugs") {
        promptText = `你是一个资深的白盒安全专家和 Debug 工具。请对以下代码进行深度逻辑审查，排查潜在的 Bug、语法错误、不合规的逻辑结构。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **缺陷分析**: 列出检测到的潜在风险、运行崩溃隐患或逻辑漏洞。
2. **安全自愈方案**: 提出针对性的修复策略。
3. **修复后的完整代码**: 在下方提供一份**完整**、**修正后**的代码，包裹在对应的代码块中，方便用户一键应用。`;
      } else if (action === "data-summary") {
        promptText = `你是一个资深的数据分析专家。请对以下文件的数据流、运行日志或数据输出内容进行深度提炼和数据洞察：

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提取并概括：
1. **核心数据摘要**: 主要的关键指标、运行结果或重要数据点。
2. **模式与趋势**: 发现数据中的隐藏规律、趋势或异常波动。
3. **下一步行动建议**: 基于分析数据得出的具体、可落地业务策略建议。`;
      } else if (action === "custom") {
        promptText = `你是一个强大的 AI 编程与工作区协同助手。请针对以下文件回答用户的具体指令或提问。

文件路径: ${filePath}
用户提问/指令: "${customPrompt}"

文件内容:
\`\`\`
${fileContent}
\`\`\`

请结合文件内容进行精准解答，如果是代码相关的修改，请提供修改后的完整代码块，以便用户能够一键替换。`;
      } else {
        return res.status(400).json({ error: "Invalid action" });
      }

      const systemInstruction = `You are a professional, high-performance developer sandbox assistant. You write perfect Markdown responses in Chinese. Your insights are precise, actionable, and based on solid engineering principles. Always keep any recommended code block complete rather than writing partial snippets, so the user can easily replace their file.`;

      const history = [
        {
          role: "user",
          parts: [{ text: promptText }]
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

      res.json({ success: true, response: response.text });
    } catch (err: any) {
      res.status(500).json({ error: `AI 协同分析失败: ${err.message}` });
    }
  });

  app.post("/api/workspace/clean-cache", (req, res) => {
    try {
      const tasks = getActiveTasks();
      const activeFiles = new Set<string>();
      tasks.forEach(task => {
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
      const expiredTasks = tasks.filter(task => {
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
      const tasks = getActiveTasks();
      const backupData = {
        version: "1.0.0",
        exportTime: new Date().toISOString(),
        tasks,
        workspace: {} as Record<string, string>
      };

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
      setActiveTasks(tasks);
      saveTasks(tasks);

      if (workspace && typeof workspace === "object") {
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
}
