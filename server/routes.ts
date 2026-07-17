import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import dns from "dns";
import { safePath, checkDangerousCommand, isValidPublicUrl } from "./security";
import { loadAIConfig, saveAIConfig, diagnoseFetchError, maskConfigKeys, mergeSubmittedConfig } from "./config";
import { saveTasks, getDiskUsagePercent, getFileTree, loadChatSessions, saveChatSessions } from "./persistence";
import { callAIProvider, getBackupProvider, getBackupProviders } from "./providers";
import { executeTaskBackground, resumeTaskBackground } from "./agent-loop";
import { getRepoIndex, reindexWorkspace, searchSymbols } from "./repo-indexer";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

const TRASH_DIR = path.join(WORKSPACE_DIR, ".trash");
const TRASH_FILES_DIR = path.join(TRASH_DIR, "files");
const TRASH_METADATA_FILE = path.join(TRASH_DIR, "metadata.json");

interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  deletedAt: string;
  size: number;
  isDirectory: boolean;
}

function ensureTrashDirs() {
  if (!fs.existsSync(TRASH_DIR)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
  }
  if (!fs.existsSync(TRASH_FILES_DIR)) {
    fs.mkdirSync(TRASH_FILES_DIR, { recursive: true });
  }
  if (!fs.existsSync(TRASH_METADATA_FILE)) {
    fs.writeFileSync(TRASH_METADATA_FILE, "[]", "utf-8");
  }
}

function loadTrashMetadata(): TrashItem[] {
  ensureTrashDirs();
  try {
    const data = fs.readFileSync(TRASH_METADATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveTrashMetadata(items: TrashItem[]) {
  ensureTrashDirs();
  fs.writeFileSync(TRASH_METADATA_FILE, JSON.stringify(items, null, 2), "utf-8");
}

function autoPurgeTrash() {
  try {
    ensureTrashDirs();
    const items = loadTrashMetadata();
    const now = Date.now();
    const activeItems: TrashItem[] = [];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const item of items) {
      const deletedTime = new Date(item.deletedAt).getTime();
      if (now - deletedTime > sevenDaysMs) {
        const trashPath = path.join(TRASH_FILES_DIR, item.id);
        if (fs.existsSync(trashPath)) {
          fs.rmSync(trashPath, { recursive: true, force: true });
        }
      } else {
        activeItems.push(item);
      }
    }
    saveTrashMetadata(activeItems);
  } catch (err) {
    console.error("Error auto purging trash:", err);
  }
}

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

    // Securely print configuration lifecycle logs to terminal
    console.log("[CONFIG SAVE] Received configuration save request. Active provider:", submittedConfig.activeProvider);
    for (const pName of Object.keys(submittedConfig.providers)) {
      const key = submittedConfig.providers[pName].apiKey;
      const keyLen = key ? key.length : 0;
      const isMasked = key === "******";
      console.log(`[CONFIG SAVE] Provider [${pName}]: Submitted API Key len = ${keyLen}, isMasked = ${isMasked}`);
    }

    const merged = mergeSubmittedConfig(submittedConfig, currentDisk);

    console.log("[CONFIG SAVE] Merged with current disk config.");
    for (const pName of Object.keys(merged.providers)) {
      const key = merged.providers[pName].apiKey;
      const keyLen = key ? key.length : 0;
      const isMasked = key === "******";
      const prefix = key && keyLen > 4 ? key.substring(0, 4) : "";
      const suffix = key && keyLen > 4 ? key.substring(keyLen - 4) : "";
      console.log(`[CONFIG SAVE] Provider [${pName}]: Merged API Key len = ${keyLen}, isMasked = ${isMasked}, pattern = ${prefix}...${suffix}`);
    }

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

  // Repo Indexer APIs
  app.get("/api/indexer/status", async (req, res) => {
    try {
      const index = await getRepoIndex();
      res.json({ success: true, index });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/indexer/reindex", async (req, res) => {
    try {
      const index = await reindexWorkspace();
      res.json({ success: true, index });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/indexer/symbols", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      const symbols = await searchSymbols(query);
      res.json({ success: true, symbols });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
      // Ensure test_zone folder exists
      const testZoneDir = path.join(WORKSPACE_DIR, "test_zone");
      if (!fs.existsSync(testZoneDir)) {
        fs.mkdirSync(testZoneDir, { recursive: true });
      }

      const fileTree = getFileTree(WORKSPACE_DIR);
      // Filter out `.trash` or any other dot folders from the top level
      const filteredTree = fileTree.filter(node => {
        return node.name !== ".trash" && !node.name.startsWith(".");
      });
      res.json(filteredTree);
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

  app.get("/api/workspace/raw-file", (req, res) => {
    const { path: relPath } = req.query;
    if (!relPath) return res.status(400).json({ error: "Missing file path" });
    try {
      const filePath = safePath(relPath as string);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      res.sendFile(filePath);
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
    
    // Prevent deleting trash directory or test_zone itself
    if (relPath.startsWith(".trash") || relPath === ".trash") {
      return res.status(400).json({ error: "不能直接删除回收站系统目录" });
    }
    if (relPath === "test_zone" || relPath === "test_zone/") {
      return res.status(400).json({ error: "测试区域目录（test_zone）受系统保护，请勿删除。您可以使用顶部清理按钮一键回收其内所有测试文件。" });
    }

    try {
      const itemPath = safePath(relPath);
      if (!fs.existsSync(itemPath)) {
        return res.status(404).json({ error: "Path not found" });
      }

      ensureTrashDirs();
      const stat = fs.statSync(itemPath);
      const timestamp = Date.now();
      const filename = path.basename(itemPath);
      const trashId = `${timestamp}_${filename}`;
      const destPath = path.join(TRASH_FILES_DIR, trashId);

      // Move physically to trash files
      fs.renameSync(itemPath, destPath);

      // Save metadata
      const items = loadTrashMetadata();
      const newItem: TrashItem = {
        id: trashId,
        name: filename,
        originalPath: relPath.replace(/\\/g, "/"),
        deletedAt: new Date().toISOString(),
        size: stat.isDirectory() ? 4096 : stat.size,
        isDirectory: stat.isDirectory()
      };
      items.push(newItem);
      saveTrashMetadata(items);

      res.json({ success: true, message: "已安全移入历史回收站", trashItem: newItem });
    } catch (error: any) {
      console.error("Delete failed, moving to trash error:", error);
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

  app.get("/api/workspace/chat-sessions", (req, res) => {
    try {
      const sessions = loadChatSessions();
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspace/chat-sessions", (req, res) => {
    try {
      const { title, scope, selectedFilePath, selectedProjectFiles } = req.body;
      const sessions = loadChatSessions();
      const newSession = {
        id: `session-${Date.now()}`,
        title: title || "新对话",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        scope: scope || "single",
        selectedFilePath: selectedFilePath || null,
        selectedProjectFiles: selectedProjectFiles || []
      };
      sessions.unshift(newSession);
      saveChatSessions(sessions);
      res.status(201).json(newSession);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/workspace/chat-sessions/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { title, scope, selectedFilePath, selectedProjectFiles } = req.body;
      const sessions = loadChatSessions();
      const session = sessions.find(s => s.id === id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (title !== undefined) session.title = title;
      if (scope !== undefined) session.scope = scope;
      if (selectedFilePath !== undefined) session.selectedFilePath = selectedFilePath;
      if (selectedProjectFiles !== undefined) session.selectedProjectFiles = selectedProjectFiles;
      session.updatedAt = new Date().toISOString();
      saveChatSessions(sessions);
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/workspace/chat-sessions/:id", (req, res) => {
    try {
      const { id } = req.params;
      let sessions = loadChatSessions();
      const initialLength = sessions.length;
      sessions = sessions.filter(s => s.id !== id);
      if (sessions.length === initialLength) {
        return res.status(404).json({ error: "Session not found" });
      }
      saveChatSessions(sessions);
      res.json({ success: true, message: "Session deleted" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspace/chat-sessions/:id/messages/raw", (req, res) => {
    try {
      const { id } = req.params;
      const { messages, title } = req.body;
      const sessions = loadChatSessions();
      const session = sessions.find(s => s.id === id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (messages !== undefined) session.messages = messages;
      if (title !== undefined) session.title = title;
      session.updatedAt = new Date().toISOString();
      saveChatSessions(sessions);
      res.json({ success: true, session });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspace/chat-sessions/:id/messages", async (req, res) => {
    const { id } = req.params;
    const { prompt, action } = req.body;
    if ((!prompt || !prompt.trim()) && (!action || action === "custom")) {
      return res.status(400).json({ error: "Prompt or action is required" });
    }

    try {
      const sessions = loadChatSessions();
      const session = sessions.find(s => s.id === id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const getFilesRecursiveLocal = (dir: string, baseDir: string = dir): string[] => {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          const relPath = path.relative(baseDir, fullPath);
          const stat = fs.statSync(fullPath);
          if (stat && stat.isDirectory()) {
            if (!file.startsWith(".") && file !== "node_modules" && file !== "dist") {
              results = results.concat(getFilesRecursiveLocal(fullPath, baseDir));
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

      const buildTreeStringLocal = (dir: string, prefix: string = ""): string => {
        let tree = "";
        try {
          if (!fs.existsSync(dir)) return tree;
          const list = fs.readdirSync(dir);
          const items = list.filter(item => !item.startsWith("."));
          items.sort((a, b) => {
            let aIsDir = false;
            let bIsDir = false;
            try { aIsDir = fs.statSync(path.join(dir, a)).isDirectory(); } catch(_) {}
            try { bIsDir = fs.statSync(path.join(dir, b)).isDirectory(); } catch(_) {}
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.localeCompare(b);
          });

          items.forEach((item, index) => {
            const isLast = index === items.length - 1;
            const fullPath = path.join(dir, item);
            let isDir = false;
            try { isDir = fs.statSync(fullPath).isDirectory(); } catch(_) {}
            const marker = isLast ? "└── " : "├── ";
            
            if (isDir) {
              if (item !== "node_modules" && item !== "dist") {
                tree += `${prefix}${marker}${item}/\n`;
                tree += buildTreeStringLocal(fullPath, prefix + (isLast ? "    " : "│   "));
              }
            } else {
              tree += `${prefix}${marker}${item}\n`;
            }
          });
        } catch (_) {}
        return tree;
      };

      let promptText = prompt || "";
      let displayPrompt = prompt || "";

      if (action && action !== "custom") {
        const isProjectScope = session.scope === "project";
        const workspaceTree = buildTreeStringLocal(WORKSPACE_DIR);
        
        let targetFiles: { path: string; content: string }[] = [];
        if (isProjectScope) {
          let pathsToRead = session.selectedProjectFiles || [];
          if (pathsToRead.length === 0) {
            pathsToRead = getFilesRecursiveLocal(WORKSPACE_DIR);
          }
          let totalSize = 0;
          for (const relPath of pathsToRead) {
            if (totalSize >= 250 * 1024) break;
            try {
              const absPath = safePath(relPath);
              if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
                const size = fs.statSync(absPath).size;
                if (size < 100 * 1024) {
                  const content = fs.readFileSync(absPath, "utf-8");
                  targetFiles.push({ path: relPath, content });
                  totalSize += size;
                }
              }
            } catch (e) {}
          }
        } else if (session.selectedFilePath) {
          try {
            const absPath = safePath(session.selectedFilePath);
            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
              const content = fs.readFileSync(absPath, "utf-8");
              targetFiles.push({ path: session.selectedFilePath, content });
            }
          } catch (e) {}
        }

        if (targetFiles.length > 0) {
          const filePath = targetFiles[0].path;
          const fileContent = targetFiles[0].content;
          const fileSummaries = targetFiles.map(f => `--- 文件路径: ${f.path} ---\n${f.content}`).join("\n\n");

          if (isProjectScope) {
            if (action === "explain") {
              displayPrompt = "🔍 一键宏观解构项目架构";
              promptText = `你是一个顶尖的软件系统架构专家和首席系统分析师。请对当前沙箱项目的多文件系统进行**深度宏观解构**、**拓扑依赖提炼**与**核心生命周期数据流分析**。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供一份极其专业、结构严密、具备高度科技感的全方位解构报告，包含以下核心版块：
1. 📂 架构全景与模块职责
2. 🔗 拓扑依赖网格 (包含 Mermaid 流程图)
3. ⚡ 核心业务生命周期与数据流
4. 💎 架构演进与优化路线图`;
            } else if (action === "optimize") {
              displayPrompt = "🚀 一键优化重构当前项目";
              promptText = `你是一个精通系统重构和性能调优的顶级首席架构师。请针对当前项目的多文件协同场景，进行深度审查并输出**多文件协同重构及全局性能调优方案**。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供一份极具落地价值、契合现代软件工程高水准的重构调优白皮书：
1. 🎯 架构冗余与技术债清单
2. 🚀 性能与可维护性调优方案
3. 🛠️ 优雅重构对照设计 (提供完整重构代码块)`;
            } else if (action === "fix-bugs") {
              displayPrompt = "🚨 一键排查项目缺陷漏洞";
              promptText = `你是一个卓越的白盒安全专家、Bug 猎手和高并发调试大师。请对当前沙箱项目的多文件系统进行全局严格审查，重点排查跨文件交互中的逻辑漏洞、未捕获异常、内存泄漏、并发冲突以及边缘崩溃隐患。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供一份精准、严谨的漏洞缺陷扫描与免疫加固报告：
1. 🚨 跨文件安全与缺陷隐患矩阵 (Markdown 表格)
2. 🩺 关键漏洞根因诊断
3. 💉 免疫防御编程与安全加固 (提供完整修复代码块)`;
            } else if (action === "data-summary") {
              displayPrompt = "📊 一键提炼项目数据血缘";
              promptText = `你是一个顶级数据架构师和资深商业智能（BI）分析师。请对当前沙箱项目中多个文件的数据流、协议接口、持久化记录或输出内容进行**深度多文件联合提炼与数据血缘洞察**。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提炼并输出一份精细化、可直接支持数据治理的数据流契约与洞察报告：
1. 📡 全局数据模型与接口契约总览
2. 📊 跨源数据血缘图 (Mermaid 流程图)
3. 💡 数据健康度诊断与演进建议`;
            }
          } else {
            if (action === "explain") {
              displayPrompt = `🔍 一键深度解读文件 [${filePath.split("/").pop()}]`;
              promptText = `你是一个资深的软件工程专家，请对以下文件进行深度解读 and 多维度技术解析。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请详细说明：
1. **主要功能与应用场景**：该文件的主要职责、应用定位以及与其它的模块协作关系。
2. **核心业务逻辑与数据流向**：梳理关键方法/类/函数的调用链路，解析数据在其中如何变化与演变。
3. **架构与设计模式亮点**：指出其中用到的优雅设计模式、优秀的并发或容错机制。
4. **后续维护与二次开发建议**：提供未来扩展的切入点 and 注意事项。`;
            } else if (action === "optimize") {
              displayPrompt = `🚀 一键重构优化文件 [${filePath.split("/").pop()}]`;
              promptText = `你是一个追求极致性能和代码健壮性的代码重构大师。请对以下文件进行深度逻辑审查，并提出高级重构/优化意见。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **重构亮点与原理解释**：精确定位存在的逻辑冗余、性能瓶颈、代码可读性差等问题，并详尽剖析理由。
2. **重构调优后的完整代码**：在下方提供一份**完整**、**高可读性**、支持防御性异常捕获 and 并发安全的可替换代码。请务必将代码完整包裹在对应的代码块中。`;
            } else if (action === "fix-bugs") {
              displayPrompt = `🚨 一键排查文件 [${filePath.split("/").pop()}] 缺陷`;
              promptText = `你是一个资深的白盒安全专家和卓越的 Bug 诊断工具。请对以下代码进行深度逻辑审查，严密排查潜在的运行崩溃点、异常捕获缺失、内存泄露或并发死锁。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **多维度缺陷分析表格**：列出检测到的每个潜在漏洞、边界溢出或崩溃点，包含【缺陷定位】、【触发边界/机制】、【缺陷影响】及【失效级别】。
2. **安全自愈设计方案**：提出从根本上规避该逻辑缺陷 of 免疫方案。
3. **安全加固后的完整代码**：提供一份**逻辑自愈**、**100%健壮且完美修复缺陷**的完整代码，完整包裹在对应的代码块中。`;
            } else if (action === "data-summary") {
              displayPrompt = `📊 一键提炼文件 [${filePath.split("/").pop()}] 数据契约`;
              promptText = `你是一个资深的数据建模专家 and 高级数据分析师。请对以下文件的数据模式、运行指标、日志输出或状态契约进行深度提炼：

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请详细归纳并提供：
1. **核心数据字段与指标定义**：全面提取该文件中的关键常量、状态变量、或输出报表，列明其代表的物理/业务定义。
2. **隐藏数据模式与行为特征**：解析变量之间的耦合度、状态转换轨迹或数值变化趋势。
3. **健康度分析与下一步落地建议**：基于对代码中数据结构的审查，给出未来优化数据存储 and 接口设计的落地指引。`;
            }
          }
        }
      }

      const userMessage = {
        role: "user",
        parts: [{ text: promptText }],
        displayPrompt: displayPrompt,
        timestamp: new Date().toISOString()
      };
      session.messages.push(userMessage);

      let activeFileContext = "";
      if (session.scope === "single" && session.selectedFilePath) {
        try {
          const absPath = safePath(session.selectedFilePath);
          if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
            const content = fs.readFileSync(absPath, "utf-8");
            activeFileContext = `--- 当前选中的激活文件: ${session.selectedFilePath} ---\n\`\`\`\n${content}\n\`\`\`\n`;
          }
        } catch (e) {
          console.error("Error reading active file for chat context:", e);
        }
      } else if (session.scope === "project") {
        activeFileContext = "--- 当前项目核心文件上下文 ---\n";
        let totalSize = 0;
        const maxFiles = 15;
        const maxSize = 300 * 1024;
        let filesToRead = session.selectedProjectFiles || [];
        
        if (filesToRead.length === 0) {
          filesToRead = getFilesRecursiveLocal(WORKSPACE_DIR);
        }
        for (const relPath of filesToRead) {
          if (totalSize >= maxSize) break;
          try {
            const absPath = safePath(relPath);
            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
              const size = fs.statSync(absPath).size;
              if (size < 100 * 1024) {
                const content = fs.readFileSync(absPath, "utf-8");
                activeFileContext += `\n--- 文件: ${relPath} ---\n${content}\n`;
                totalSize += size;
              }
            }
          } catch (e) {}
        }
      }

      const currentConfig = loadAIConfig();
      const providerName = currentConfig.activeProvider || "gemini";
      const modelName = currentConfig.activeModel || "gemini-3.5-flash";

      const repoIndex = await getRepoIndex();
      const repoIndexSummary = `\n--- 仓库及代码符号发现（Codebase Index） ---
当前工作区共包含 ${repoIndex.totalFiles} 个文件，已提取 ${repoIndex.totalSymbols} 个关键类/函数等符号。
部分核心文件: ${repoIndex.files.slice(0, 30).join(", ")}${repoIndex.files.length > 30 ? "...(等)" : ""}
部分提取的代码符号:
${repoIndex.symbols.slice(0, 15).map(s => `- [${s.type.toUpperCase()}] \`${s.name}\` (在 ${s.filePath}:${s.line} 行)`).join("\n")}${repoIndex.symbols.length > 15 ? "\n...(更多符号略)" : ""}`;

      let originalText = "";
      let hasActions = true;
      let loopCount = 0;
      const maxLoops = 5; // Allow up to 5 steps of autonomous thinking & executing!
      let lastExecutionOutput = "";

      while (hasActions && loopCount < maxLoops) {
        loopCount++;

        const systemInstruction = `You are an autonomous AI Agent Developer Copilot in a live server-side sandbox. You write perfect responses in Chinese.
You have the power to actually execute actions in the user's workspace on their behalf!
When the user asks you to write a file, create a directory, delete a file, generate reports, or run/test a command, you MUST use the following special XML-style tags to declare the actions. The backend will automatically parse and execute them for you, feed the output back to you, and allow you to continue working until the job is complete.

### 重要！你必须使用结构化 XML 标签将你的【智能体思考生命周期】包裹起来：
1. 思考与意图深剖：在每一次生成的最开头，你必须先使用 \`<thinking>\` 标签包裹你当前的深度分析、问题拆解及对上下文中文件依赖的逻辑判断。
2. 蓝图设计与计划拆解：紧接着，你必须使用 \`<planning>\` 标签包裹你的具体执行方案、计划步骤，指明你要修改哪些文件、创建哪些脚本、运行哪些测试命令。
3. 最终自省与质量复盘：在任务圆满完成后（没有更多 <workspace_action> 需要执行，这是最后一步输出），你必须在回答的末尾使用 \`<retrospective>\` 标签包裹你的质量自省报告。包括你成功完成了什么、踩了什么坑（比如自愈修复的过程）、下一步建议。

Supported actions:

1. Create or overwrite a file (write full file content inside the tags, do not omit any code):
<workspace_action type="create_file" path="relative/path/to/file">
file content goes here...
</workspace_action>

2. Create a directory (mkdir):
<workspace_action type="mkdir" path="relative/path/to/dir" />

3. Delete a file or directory (recycles it safely to the trash):
<workspace_action type="delete_file" path="relative/path/to/file" />

4. Run a terminal command (e.g. run python/js scripts, compile, test, find, verify, or execute any safe shell tool):
<workspace_action type="run_command" command="python test_zone/report.py" />

Rules:
- All paths MUST be relative to the workspace root directory (e.g. "test_zone/report.md").
- You can execute MULTIPLE actions in one response. They will be executed sequentially.
- If you execute a command or write a file, the execution result (stdout, success/failure) will be fed back to you in the next turn as a [System Execution Result]. You should observe this output and continue executing more actions if needed (e.g. if there's a compilation error, write a fix and run again), or write your final response/report if you are done.
- When you are completely done with the task and no more actions are needed, simply write your final response to the user without generating any more <workspace_action> tags.

作为类似 Codex CLI 的自主执行 Agent，你必须遵循以下核心开发原则：
1. **规划与执行分离 (Plan before Action)**:
   - 收到用户的任务后，请优先生成一个详细的步骤规划并输出。步骤规划应该清晰、紧凑。格式如下：
     - **📋 任务规划方案 (Task Step-by-Step Plan)**:
       1. [PLANNING]: 任务分析和符号依赖检索。
       2. [DESIGN]: 设计方案和涉及文件接口。
       3. [EXECUTION]: 具体的代码编写、构建编译及运行测试。
       4. [SUMMARY]: 输出验证和自愈测试总结。
2. **安全自愈循环 (Self-Healing Loop)**:
   - 严禁在遇到运行报错、编译失败、语法错误时立即妥协，你拥有完全自愈的能力！
   - 请结合报错的 Traceback、Linter 提示或 Stderr 输出，精确找到缺陷代码行，并自动规划修复代码再次覆盖写入，重新运行指令或测试验证，直到完美解决问题！

${repoIndexSummary}

以下是用户当前沙箱中最新的开发文件上下文：
${activeFileContext}
${lastExecutionOutput ? `\n【上一步系统自动执行结果反馈（请结合此结果进行后续决策，若有报错请直接重构编写代码修复并再次执行）：】\n${lastExecutionOutput}` : ""}`;

        const historyForProvider = session.messages.map((m: any) => ({
          role: m.role,
          parts: m.parts
        }));

        let aiResponse: any = null;
        let success = false;
        let lastError: any = null;
        let finalProviderUsed = providerName;
        let finalModelUsed = modelName;

        // 1. Attempt primary provider first
        try {
          aiResponse = await callAIProvider(
            providerName,
            modelName,
            historyForProvider,
            0.2,
            systemInstruction,
            currentConfig
          );
          success = true;
        } catch (callErr: any) {
          lastError = callErr;
          console.error(`[AI Chat Main Provider Error] ${providerName} failed:`, callErr);
        }

        // 2. Dynamic Active Model Pool failover if primary provider fails
        if (!success) {
          const backups = getBackupProviders(providerName, currentConfig);
          console.log(`[AI Chat Failover] Primary provider failed. Found ${backups.length} active backup providers:`, backups);
          
          for (const backup of backups) {
            try {
              console.log(`[AI Chat Failover] Seamlessly attempting backup provider: ${backup.name} (model: ${backup.model})...`);
              aiResponse = await callAIProvider(
                backup.name,
                backup.model,
                historyForProvider,
                0.2,
                systemInstruction,
                currentConfig
              );
              finalProviderUsed = backup.name;
              finalModelUsed = backup.model;
              success = true;
              break;
            } catch (backupErr: any) {
              console.error(`[AI Chat Failover] Backup provider ${backup.name} failed:`, backupErr);
              lastError = backupErr;
            }
          }
        }

        if (!success) {
          const errMsg = lastError?.message || String(lastError || "未知模型错误");
          return res.status(500).json({
            error: `智能体主模型与激活备用模型池调用全部失败。当前主供应商为 ${providerName.toUpperCase()}，错误原因: ${errMsg}。请在“模型池”配置面板中检查 API Key 余额或接口连通性。`
          });
        }

        originalText = aiResponse.text || "";

        // Append a highly polished notification if backup model was activated
        if (finalProviderUsed !== providerName) {
          const fallbackNotice = `\n\n---\n> 💡 **防灾高可用保障**：由于主模型提供商 **${providerName.toUpperCase()}** 呼叫失败（可能因为 API Key 欠费或限流），系统已为您**动态无缝切换**至备用模型池中的激活节点：**${finalProviderUsed.toUpperCase()}** (${finalModelUsed})，保证您的开发连续不中断。`;
          originalText += fallbackNotice;
        }

        // Parse workspace action tags
        const actionTagRegex = /<workspace_action\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/workspace_action>)/g;
        const actionsToExecute: Array<{
          type: string;
          path?: string;
          command?: string;
          content?: string;
          rawTag: string;
        }> = [];

        let match;
        while ((match = actionTagRegex.exec(originalText)) !== null) {
          const rawTag = match[0];
          const attributesStr = match[1];
          const content = match[2] ? match[2].trim() : "";

          const typeMatch = attributesStr.match(/type="([^"]+)"/) || attributesStr.match(/type='([^']+)'/);
          const pathMatch = attributesStr.match(/path="([^"]+)"/) || attributesStr.match(/path='([^']+)'/);
          const commandMatch = attributesStr.match(/command="([^"]+)"/) || attributesStr.match(/command='([^']+)'/);

          const type = typeMatch ? typeMatch[1] : "";
          const pathVal = pathMatch ? pathMatch[1] : "";
          const commandVal = commandMatch ? commandMatch[1] : "";

          actionsToExecute.push({
            type,
            path: pathVal,
            command: commandVal,
            content,
            rawTag
          });
        }

        if (actionsToExecute.length === 0) {
          // No more workspace actions! The agent has completed the task and generated the final text.
          hasActions = false;
          
          // Let's check for fallback markdown code block creation just in case
          const markdownCodeBlockRegex = /```(\w+)?(?:\s+([^\n]+))?\n([\s\S]+?)\n```/g;
          let mdMatch;
          let hasFallbackExecuted = false;
          let executionLogs: string[] = [];
          const executedActionsData: any[] = [];

          while ((mdMatch = markdownCodeBlockRegex.exec(originalText)) !== null) {
            const langAttr = (mdMatch[1] || "").trim();
            const metaAttr = (mdMatch[2] || "").trim();
            const content = mdMatch[3];

            let resolvedPath = "";
            if (metaAttr.includes("/") || metaAttr.includes(".")) {
              resolvedPath = metaAttr;
            } else if (langAttr.includes("/") || langAttr.includes(".")) {
              resolvedPath = langAttr;
            }

            if (!resolvedPath) {
              const lines = content.slice(0, 300).split("\n");
              for (const line of lines.slice(0, 4)) {
                const fileCommentMatch = line.match(/(?:\/\/|#|\/\*)\s*(?:@?file(?:path)?|filepath|filename|file):\s*([a-zA-Z0-9_\-\.\/]+)/i);
                if (fileCommentMatch) {
                  resolvedPath = fileCommentMatch[1].trim();
                  break;
                }
              }
            }

            if (resolvedPath) {
              resolvedPath = resolvedPath.replace(/^workspace\//, "").replace(/^[.\/]+/, "");
              let success = false;
              let size = 0;
              let error = "";

              try {
                const filePath = safePath(resolvedPath);
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(filePath, content, "utf-8");
                success = true;
                size = content.length;
                if (!hasFallbackExecuted) {
                  executionLogs.push("\n\n---\n🤖 **Copilot 自动修复执行（代码块自适应提取）：**\n");
                  hasFallbackExecuted = true;
                }
                executionLogs.push(`- ✅ 通过智能代码块识别创建文件: \`${resolvedPath}\` (${size} 字符)`);
              } catch (err: any) {
                error = err.message || "写入失败";
                executionLogs.push(`- ❌ 智能写入 \`${resolvedPath}\` 失败: ${error}`);
              }

              executedActionsData.push({
                type: "create_file",
                path: resolvedPath,
                success,
                size,
                error
              });
            }
          }

          if (hasFallbackExecuted) {
            originalText = originalText.trim() + executionLogs.join("\n");
          }

          // Push final model response turn to session history
          const modelMessage = {
            role: "model",
            parts: [{ text: originalText }],
            timestamp: new Date().toISOString(),
            executedActions: executedActionsData
          };
          session.messages.push(modelMessage);
          break;
        }

        // Execute step-by-step actions
        let executionLogs: string[] = [];
        let nextTurnObservation = "【系统自动执行以下操作并获得反馈如下】：\n";
        const executedActionsData: Array<{
          type: string;
          path?: string;
          command?: string;
          success: boolean;
          size?: number;
          output?: string;
          error?: string;
        }> = [];

        executionLogs.push("\n\n---\n🤖 **Copilot 自动执行任务汇总：**\n");

        for (const action of actionsToExecute) {
          let success = false;
          let size = 0;
          let output = "";
          let error = "";

          try {
            if (action.type === "create_file" || action.type === "write_file") {
              if (!action.path) {
                error = "未指定文件路径 `path`";
                executionLogs.push(`- ❌ 写入文件失败：未指定文件路径 \`path\``);
                nextTurnObservation += `- 写入文件失败：未指定 path\n`;
                executedActionsData.push({ type: action.type, path: action.path, success, error });
                continue;
              }
              const filePath = safePath(action.path);
              const dir = path.dirname(filePath);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              fs.writeFileSync(filePath, action.content || "", "utf-8");
              success = true;
              size = (action.content || "").length;
              executionLogs.push(`- ✅ 成功创建/写入文件: \`${action.path}\` (${size} 字符)`);
              nextTurnObservation += `- 成功创建/写入文件: ${action.path} (${size} 字符)\n`;
            } else if (action.type === "mkdir") {
              if (!action.path) {
                error = "未指定目录路径 `path`";
                executionLogs.push(`- ❌ 创建目录失败：未指定目录路径 \`path\``);
                nextTurnObservation += `- 创建目录失败：未指定 path\n`;
                executedActionsData.push({ type: action.type, path: action.path, success, error });
                continue;
              }
              const dirPath = safePath(action.path);
              fs.mkdirSync(dirPath, { recursive: true });
              success = true;
              executionLogs.push(`- ✅ 成功创建目录: \`${action.path}\``);
              nextTurnObservation += `- 成功创建目录: ${action.path}\n`;
            } else if (action.type === "delete_file") {
              if (!action.path) {
                error = "未指定路径 `path`";
                executionLogs.push(`- ❌ 删除文件失败：未指定路径 \`path\``);
                nextTurnObservation += `- 删除文件失败：未指定 path\n`;
                executedActionsData.push({ type: action.type, path: action.path, success, error });
                continue;
              }
              const itemPath = safePath(action.path);
              if (!fs.existsSync(itemPath)) {
                error = `路径 \`${action.path}\` 不存在`;
                executionLogs.push(`- ⚠️ 删除失败：路径 \`${action.path}\` 不存在`);
                nextTurnObservation += `- 删除失败：路径 ${action.path} 不存在\n`;
                executedActionsData.push({ type: action.type, path: action.path, success, error });
                continue;
              }
              ensureTrashDirs();
              const stat = fs.statSync(itemPath);
              const timestamp = Date.now();
              const filename = path.basename(itemPath);
              const trashId = `${timestamp}_${filename}`;
              const destPath = path.join(TRASH_FILES_DIR, trashId);

              fs.renameSync(itemPath, destPath);

              const items = loadTrashMetadata();
              const newItem: TrashItem = {
                id: trashId,
                name: filename,
                originalPath: action.path.replace(/\\/g, "/"),
                deletedAt: new Date().toISOString(),
                size: stat.isDirectory() ? 4096 : stat.size,
                isDirectory: stat.isDirectory()
              };
              items.push(newItem);
              saveTrashMetadata(items);
              success = true;
              executionLogs.push(`- 🗑️ 已安全将文件/目录移入回收站: \`${action.path}\``);
              nextTurnObservation += `- 已安全将文件/目录移入回收站: ${action.path}\n`;
            } else if (action.type === "run_command") {
              if (!action.command) {
                error = "未指定 `command` 内容";
                executionLogs.push(`- ❌ 运行命令失败：未指定 \`command\` 内容`);
                nextTurnObservation += `- 运行命令失败：未指定 command\n`;
                executedActionsData.push({ type: action.type, command: action.command, success, error });
                continue;
              }
              if (checkDangerousCommand(action.command)) {
                error = "安全拦截：该命令由于安全防护策略已被禁止运行";
                executionLogs.push(`- 🛡️ 安全拦截：命令 \`${action.command}\` 被安全策略拒绝运行`);
                nextTurnObservation += `- 运行命令失败：命令被安全拦截\n`;
                executedActionsData.push({ type: action.type, command: action.command, success, error });
                continue;
              }
              
              const { exec } = await import("child_process");
              const { promisify } = await import("util");
              const execAsync = promisify(exec);
              
              executionLogs.push(`- ⚙️ 正在执行系统命令: \`${action.command}\`...`);
              try {
                const { stdout, stderr } = await execAsync(action.command, { cwd: WORKSPACE_DIR, timeout: 25000 });
                output = `${stdout || ""}${stderr || ""}`.trim();
                success = true;
                if (output) {
                  executionLogs.push(`  \`\`\`text\n${output}\n  \`\`\``);
                  nextTurnObservation += `- 运行命令: ${action.command}\n  成功退出。控制台输出:\n  \`\`\`\n  ${output}\n  \`\`\`\n`;
                } else {
                  executionLogs.push(`  *(命令无控制台输出，静默退出)*`);
                  nextTurnObservation += `- 运行命令: ${action.command}\n  成功退出，无输出内容。\n`;
                }
              } catch (execErr: any) {
                output = `${execErr.stdout || ""}${execErr.stderr || execErr.message || ""}`.trim();
                error = execErr.message || "命令执行异常退出";
                executionLogs.push(`  ❌ 命令执行异常退出:\n  \`\`\`text\n${output}\n  \`\`\``);
                nextTurnObservation += `- 运行命令: ${action.command} 失败！错误输出:\n  \`\`\`\n  ${output}\n  \`\`\`\n`;
              }
            } else {
              error = `未知的操作类型: ${action.type}`;
              executionLogs.push(`- ⚠️ 未知的操作类型: \`${action.type}\``);
              nextTurnObservation += `- 未知的操作类型: ${action.type}\n`;
            }
          } catch (actionErr: any) {
            error = actionErr.message || "未知执行错误";
            executionLogs.push(`- ❌ 执行 \`${action.type}\` 发生系统错误: ${error}`);
            nextTurnObservation += `- 执行发生系统错误: ${error}\n`;
          }

          executedActionsData.push({
            type: action.type,
            path: action.path,
            command: action.command,
            success,
            size,
            output,
            error
          });
        }

        // Stripping raw action tags from output text for display log
        let cleanedModelText = originalText;
        for (const action of actionsToExecute) {
          cleanedModelText = cleanedModelText.replace(action.rawTag, "");
        }
        cleanedModelText = cleanedModelText.trim() + executionLogs.join("\n");

        // Push model response turn
        session.messages.push({
          role: "model",
          parts: [{ text: cleanedModelText }],
          timestamp: new Date().toISOString(),
          executedActions: executedActionsData
        });

        // Setup feedback loop turn for LLM
        lastExecutionOutput = nextTurnObservation;
        session.messages.push({
          role: "user",
          parts: [{ text: `【系统自动反馈】:\n${nextTurnObservation}\n请根据此执行结果决定接下来的步骤。如果任务已经圆满完成，请直接编写最终总结报告且不要包含任何 <workspace_action> 标记。如果还有待办、脚本测试、或者任何错误，请继续用 <workspace_action> 标记执行修复和验证！` }],
          timestamp: new Date().toISOString()
        });
      }

      if (session.title === "新对话" || session.title === "New Chat") {
        session.title = displayPrompt.length > 20 ? displayPrompt.substring(0, 20) + "..." : displayPrompt;
      }

      session.updatedAt = new Date().toISOString();
      saveChatSessions(sessions);

      res.json({
        success: true,
        response: originalText,
        session
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      // Helper function to build a beautiful ASCII directory tree of the workspace
      const buildTreeString = (dir: string, prefix: string = ""): string => {
        let tree = "";
        try {
          if (!fs.existsSync(dir)) return tree;
          const list = fs.readdirSync(dir);
          const items = list.filter(item => !item.startsWith("."));
          items.sort((a, b) => {
            let aIsDir = false;
            let bIsDir = false;
            try { aIsDir = fs.statSync(path.join(dir, a)).isDirectory(); } catch(_) {}
            try { bIsDir = fs.statSync(path.join(dir, b)).isDirectory(); } catch(_) {}
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.localeCompare(b);
          });

          items.forEach((item, index) => {
            const isLast = index === items.length - 1;
            const fullPath = path.join(dir, item);
            let isDir = false;
            try { isDir = fs.statSync(fullPath).isDirectory(); } catch(_) {}
            const marker = isLast ? "└── " : "├── ";
            
            if (isDir) {
              if (item !== "node_modules" && item !== "dist") {
                tree += `${prefix}${marker}${item}/\n`;
                tree += buildTreeString(fullPath, prefix + (isLast ? "    " : "│   "));
              }
            } else {
              tree += `${prefix}${marker}${item}\n`;
            }
          });
        } catch (e) {
          console.error("Error building tree string:", e);
        }
        return tree;
      };

      let promptText = "";
      if (isProjectScope) {
        const fileSummaries = targetFiles.map(f => `--- 文件路径: ${f.path} ---\n${f.content}`).join("\n\n");
        const workspaceTree = buildTreeString(WORKSPACE_DIR) || "├── (根目录未包含子文件)";
        
        if (action === "explain") {
          promptText = `你是一个顶尖的软件系统架构专家和首席系统分析师。请对当前沙箱项目的多文件系统进行**深度宏观解构**、**拓扑依赖提炼**与**核心生命周期数据流分析**。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供一份极其专业、结构严密、具备高度科技感的全方位解构报告，包含以下核心版块：

### 1. 📂 架构全景与模块职责 (Architecture & Module Responsibilities)
- **物理与逻辑架构层级**：清晰归纳当前项目的架构模式（如：分层架构、事件驱动、MVC、管道-过滤器等）。
- **组件职责精析表格**：以精细的 Markdown 表格形式列出分析中的每个文件，包含：【文件路径】、【核心定位/职责描述】、【关键方法/函数API】和【强依赖/协作项】。

### 2. 🔗 拓扑依赖网格 (Topology & Dependency Graph)
- **依赖调用关系**：使用专业的 **Mermaid 流程图** (\`graph TD\` 或 \`flowchart TD\`) 描述各文件之间的底层通信关系（例如：前端页面 -> HTTP API 路由 -> 工具调用链）。
- **设计缺陷自查**：剖析现有依赖网络中是否存在不合理的“紧耦合点”、“跨层级越权调用”或“循环依赖隐患”。

### 3. ⚡ 核心业务生命周期与数据流 (Data Pipeline & Lifecycles)
- **关键业务流分析**：描述用户操作输入后，数据是如何在各个文件之间流转、中转处理、状态更新以及被持久化或导出的（请精确关联到具体变量名、JSON 契约字段或函数方法）。
- **多端一致性审查**：分析跨文件（如前后台、后台与存储介质）传递时，是否存在数据冗余、数据边界混乱或并发时序不同步的隐患。

### 4. 💎 架构演进与优化路线图 (Architectural Evolution Roadmap)
- 给出 3 个高含金量的、可逐步解耦或增强鲁棒性的架构重构建议。`;
        } else if (action === "optimize") {
          promptText = `你是一个精通系统重构和性能调优的顶级首席架构师。请针对当前项目的多文件协同场景，进行深度审查并输出**多文件协同重构及全局性能调优方案**。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供一份极具落地价值、契合现代软件工程高水准的重构调优白皮书，包含以下核心版块：

### 1. 🎯 架构冗余与技术债清单 (Architecture Debt Ledger)
- 识别项目在设计层面（如：模块化不足、职责不清、硬编码、回调地狱、冗余计算等）的核心弊端，指出对应的代码位置并阐明理由。

### 2. 🚀 性能与可维护性调优方案 (Optimization Blueprint)
- **模块化解耦方案**：说明如何合理抽取公共辅助类（Utils）、高复用服务或状态管理单元。
- **并发与异步处理**：针对 I/O 阻塞、耗时轮询、同步阻塞等场景给出具体的非阻塞与高并发异步设计意见。

### 3. 🛠️ 优雅重构对照设计 (Refactoring Blueprint)
- 针对需要重构的模块，展示清晰的【重构前 vs 重构后】设计变化对比，并提供符合最佳实践的、**完整且可直接无缝替换的重构代码块**。
- 重构代码须包裹在精确的代码块（如 \`\`\`typescript ... \`\`\`）中，确保逻辑无缺失、格式精美，且不破坏现有核心业务契约。`;
        } else if (action === "fix-bugs") {
          promptText = `你是一个卓越的白盒安全专家、Bug 猎手和高并发调试大师。请对当前沙箱项目的多文件系统进行全局严格审查，重点排查跨文件交互中的逻辑漏洞、未捕获异常、内存泄漏、并发冲突以及边缘崩溃隐患。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提供一份精准、严谨的漏洞缺陷扫描与免疫加固报告：

### 1. 🚨 跨文件安全与缺陷隐患矩阵 (Defect Matrix)
请设计一个 Markdown 表格，分级分类罗列所有潜在缺陷：
| 缺陷ID | 缺陷类别 (Concurrency/Sync/Exception/Security/Logic) | 严重级别 (Critical/High/Medium/Low) | 影响文件及代码位置 | 触发条件与边界条件 | 造成后果与失效模式 |

### 2. 🩺 关键漏洞根因诊断 (Root Cause Diagnosis)
- 深入剖析矩阵中 Medium 级及以上的缺陷，说明其底层执行流、事件循环或数据状态由于何种不合理设计而发生冲突或崩溃。

### 3. 💉 免疫防御编程与安全加固 (Hardened Code Implementation)
- 针对高危缺陷，提供防范彻底、逻辑自愈的**加固后完整代码块**。
- 加固代码须遵循防御性编程最佳实践（包含异常分支捕获、超时重试、自动资源回收、熔断限流等机制），确保 100% 具备边缘用例自适应力。`;
        } else if (action === "data-summary") {
          promptText = `你是一个顶级数据架构师和资深商业智能（BI）分析师。请对当前沙箱项目中多个文件的数据流、协议接口、持久化记录或输出内容进行**深度多文件联合提炼与数据血缘洞察**。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

请提炼并输出一份精细化、可直接支持数据治理的数据流契约与洞察报告：

### 1. 📡 全局数据模型与接口契约总览 (Unified Schema & Protocol Spec)
- 以 Markdown 表格形式统一整理本项目中所有跨文件传递、存储、或交互的数据契约，包含：【所属模块】、【字段/参数名】、【参数类型】、【约束条件/可空性】、【默认值】和【核心业务含义】。

### 2. 📊 跨源数据血缘图 (Data Lineage & Trace Map)
- 绘制一个直观的 **Mermaid 流程图** (\`graph LR\` 或 \`flowchart LR\`)，精准追踪数据在项目各流转节点的血缘演变过程（例如：外部入参 -> 数据验证器 -> 模型处理 -> 临时状态缓存 -> 最终持久化文件）。

### 3. 💡 数据健康度诊断与演进建议 (Data Health & Evolution Guide)
- 对项目现有的数据格式规范、存储冗余度、读写健壮性进行健康评分。
- 给出支持大规模扩展、跨文件秒级对齐或多源异构整合的数据模型优化架构建议。`;
        } else if (action === "custom") {
          promptText = `你是一个具有深厚软件工程积淀的 AI 编程助手与工作区协同专家。请针对当前沙箱项目中的多个文件，深度解答用户的具体指令或提问。

📂 【工作区全景目录拓扑】
\`\`\`text
workspace/
${workspaceTree}
\`\`\`

当前已加载分析的核心文件上下文：
${targetFiles.map(f => `- ${f.path}`).join("\n")}

各文件具体源码内容如下：
${fileSummaries}

用户提问/指令: "${customPrompt}"

请结合上述所有上下文，以资深工程师的视角进行极其精准、切中肯綮的解答。若涉及代码修改，请务必提供修改后的、无损、完整的核心文件代码块，方便用户一键替换。`;
        } else {
          return res.status(400).json({ error: "Invalid action" });
        }
      } else {
        const filePath = targetFiles[0].path;
        const fileContent = targetFiles[0].content;

        if (action === "explain") {
          promptText = `你是一个资深的软件工程专家，请对以下文件进行深度解读和多维度技术解析。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请详细说明：
1. **主要功能与应用场景**：该文件的主要职责、应用定位以及与其它的模块协作关系。
2. **核心业务逻辑与数据流向**：梳理关键方法/类/函数的调用链路，解析数据在其中如何变化与演变。
3. **架构与设计模式亮点**：指出其中用到的优雅设计模式、优秀的并发或容错机制。
4. **后续维护与二次开发建议**：提供未来扩展的切入点和注意事项。`;
        } else if (action === "optimize") {
          promptText = `你是一个追求极致性能和代码健壮性的代码重构大师。请对以下文件进行深度逻辑审查，并提出高级重构/优化意见。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **重构亮点与原理解释**：精确定位存在的逻辑冗余、性能瓶颈（如高频I/O、多余轮询）、代码可读性差等问题，并详尽剖析需要优化的底层理由。
2. **重构调优后的完整代码**：在下方提供一份**完整**、**高可读性**、支持防御性异常捕获和并发安全的可替换代码。请务必将代码完整包裹在对应的代码块中，不要提供碎片化或带有省略号的截断片段，确保用户可无缝一键载入和保存。`;
        } else if (action === "fix-bugs") {
          promptText = `你是一个资深的白盒安全专家和卓越的 Bug 诊断工具。请对以下代码进行深度逻辑审查，严密排查潜在的运行崩溃点、异常捕获缺失、内存泄露或并发死锁。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请提供：
1. **多维度缺陷分析表格**：列出检测到的每个潜在漏洞、边界溢出或崩溃点，包含【缺陷定位】、【触发边界/机制】、【缺陷影响】及【失效级别】。
2. **安全自愈设计方案**：提出从根本上规避该逻辑缺陷的免疫方案。
3. **安全加固后的完整代码**：提供一份**逻辑自愈**、**100%健壮且完美修复缺陷**的完整代码，完整包裹在对应的代码块中，方便用户一键完美替换。`;
        } else if (action === "data-summary") {
          promptText = `你是一个资深的数据建模专家和高级数据分析师。请对以下文件的数据模式、运行指标、日志输出或状态契约进行深度提炼：

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请详细归纳并提供：
1. **核心数据字段与指标定义**：全面提取该文件中的关键常量、状态变量、或输出报表，列明其代表的物理/业务定义。
2. **隐藏数据模式与行为特征**：解析变量之间的耦合度、状态转换轨迹或数值变化趋势。
3. **健康度分析与下一步落地建议**：基于对代码中数据结构的审查，给出未来优化数据存储和接口设计的落地指引。`;
        } else if (action === "custom") {
          promptText = `你是一个资深的 AI 编程顾问。请针对以下文件回答用户的具体指令或提问。

文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

用户提问/指令: "${customPrompt}"

请切中要害、给出最符合工业规范的精确解答。如果是代码相关的修改，请务必提供修改后的核心文件完整代码块，以便用户能够无痛一键替换。`;
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
      const testZoneDir = path.join(WORKSPACE_DIR, "test_zone");
      if (!fs.existsSync(testZoneDir)) {
        fs.mkdirSync(testZoneDir, { recursive: true });
        return res.json({
          success: true,
          message: "测试区未创建或为空，无需清理",
          deletedCount: 0,
          releasedBytes: 0,
          deletedFiles: []
        });
      }

      ensureTrashDirs();
      const trashItems = loadTrashMetadata();
      let deletedCount = 0;
      let releasedBytes = 0;
      const deletedFiles: string[] = [];

      // Read files/folders in test_zone
      const files = fs.readdirSync(testZoneDir);
      for (const file of files) {
        const fullPath = path.join(testZoneDir, file);
        const relPath = `test_zone/${file}`;
        try {
          const stat = fs.statSync(fullPath);
          const timestamp = Date.now() + Math.floor(Math.random() * 1000);
          const trashId = `${timestamp}_${file}`;
          const destPath = path.join(TRASH_FILES_DIR, trashId);

          releasedBytes += stat.isDirectory() ? 4096 : stat.size;
          fs.renameSync(fullPath, destPath);

          trashItems.push({
            id: trashId,
            name: file,
            originalPath: relPath,
            deletedAt: new Date().toISOString(),
            size: stat.isDirectory() ? 4096 : stat.size,
            isDirectory: stat.isDirectory()
          });
          deletedCount++;
          deletedFiles.push(relPath);
        } catch (err: any) {
          console.error(`Error trash-cleaning test_zone file ${file}:`, err);
        }
      }

      saveTrashMetadata(trashItems);

      res.json({
        success: true,
        message: `成功安全清理并回收了测试区内的 ${deletedCount} 个测试文件/文件夹`,
        deletedCount,
        releasedBytes,
        deletedFiles
      });
    } catch (error: any) {
      console.error("Clean cache error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Recycle Bin (Trash) management endpoints
  app.get("/api/workspace/trash", (req, res) => {
    try {
      autoPurgeTrash(); // Automatically clear expired files (older than 7 days)
      const items = loadTrashMetadata();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/workspace/trash/restore", (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing trash item ID" });
    try {
      const items = loadTrashMetadata();
      const itemIndex = items.findIndex(item => item.id === id);
      if (itemIndex === -1) {
        return res.status(404).json({ error: "未在回收站中找到该文件记录" });
      }

      const item = items[itemIndex];
      const srcPath = path.join(TRASH_FILES_DIR, item.id);
      if (!fs.existsSync(srcPath)) {
        items.splice(itemIndex, 1);
        saveTrashMetadata(items);
        return res.status(404).json({ error: "回收站中的物理文件已丢失" });
      }

      const destPath = safePath(item.originalPath);
      const destDir = path.dirname(destPath);
      
      // Ensure original parent directories exist
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Restore physically
      fs.renameSync(srcPath, destPath);

      // Remove record
      items.splice(itemIndex, 1);
      saveTrashMetadata(items);

      res.json({ success: true, message: "文件已成功还原至原位置", originalPath: item.originalPath });
    } catch (error: any) {
      console.error("Restore failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/workspace/trash/delete", (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing trash item ID" });
    try {
      const items = loadTrashMetadata();
      const itemIndex = items.findIndex(item => item.id === id);
      if (itemIndex === -1) {
        return res.status(404).json({ error: "未找到该回收站记录" });
      }

      const item = items[itemIndex];
      const srcPath = path.join(TRASH_FILES_DIR, item.id);
      if (fs.existsSync(srcPath)) {
        fs.rmSync(srcPath, { recursive: true, force: true });
      }

      items.splice(itemIndex, 1);
      saveTrashMetadata(items);

      res.json({ success: true, message: "该文件已被永久彻底删除" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/workspace/trash/empty", (req, res) => {
    try {
      ensureTrashDirs();
      const files = fs.readdirSync(TRASH_FILES_DIR);
      for (const file of files) {
        const fullPath = path.join(TRASH_FILES_DIR, file);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
      saveTrashMetadata([]);
      res.json({ success: true, message: "回收站已安全彻底清空" });
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
