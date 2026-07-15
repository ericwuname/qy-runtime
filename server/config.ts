import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const CONFIG_FILE = path.resolve(process.cwd(), "ai_config.json");

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  availableModels: string[];
  parameters?: Record<string, any>;
  name?: string;
  desc?: string;
}

export interface AIConfig {
  activeProvider: string;
  activeModel: string;
  providers: Record<string, ProviderConfig>;
  allowedSubmitters?: string[];
}

export function diagnoseFetchError(err: any): string {
  let detail = err.message || String(err);
  if (err.cause) {
    const causeMsg = err.cause.message || String(err.cause);
    const causeCode = err.cause.code;
    detail += ` (原因: ${causeMsg}${causeCode ? ` [${causeCode}]` : ""})`;
    
    if (causeCode === "ENOTFOUND") {
      detail += " - 诊断建议: 域名解析失败(DNS Lookup Failed)。请检查 Base URL 中的主机名是否正确，或者该域名是否确实存在且可公开解析。";
    } else if (causeCode === "ECONNREFUSED") {
      detail += " - 诊断建议: 连接被拒绝(Connection Refused)。目标服务器未在此端口监听，或防火墙拦截了请求。请确保目标服务已启动。";
    } else if (causeCode === "ETIMEDOUT" || causeMsg.includes("timeout") || causeMsg.includes("Timeout")) {
      detail += " - 诊断建议: 连接超时(Network Timeout)。网络质量不佳，或目标服务器响应过慢。";
    } else if (causeMsg.includes("certificate") || causeMsg.includes("CERT") || causeMsg.includes("ssl") || causeMsg.includes("tls") || causeMsg.includes("self-signed")) {
      detail += " - 诊断建议: SSL/TLS 证书校验失败(Certificate Verification Failed)。目标服务器的证书可能是自签名的、已过期，或者证书链不完整。";
    }
  } else {
    if (err.code) {
      detail += ` [Code: ${err.code}]`;
    }
  }
  return detail;
}

export function loadAIConfig(): AIConfig {
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
      
      // Ensure activeModel belongs to activeProvider's availableModels
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
    },
    allowedSubmitters: ["ceo", "system", "qiyuan_n1", "claud_advisor"]
  };
}

export function saveAIConfig(config: AIConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving ai_config.json:", error);
  }
}

// Security: Mask API Keys so they are never exposed to client-side
export function maskConfigKeys(config: AIConfig): AIConfig {
  const masked = JSON.parse(JSON.stringify(config));
  if (masked.providers) {
    for (const pName of Object.keys(masked.providers)) {
      if (masked.providers[pName].apiKey) {
        masked.providers[pName].apiKey = "******";
      }
    }
  }
  return masked;
}

// Merge submitted masked/edited configs safely
export function mergeSubmittedConfig(submitted: any, currentDisk: AIConfig): AIConfig {
  const merged = JSON.parse(JSON.stringify(submitted));
  if (merged.providers) {
    for (const pName of Object.keys(merged.providers)) {
      const submittedProvider = merged.providers[pName];
      const diskProvider = currentDisk.providers[pName];
      if (submittedProvider.apiKey === "******") {
        submittedProvider.apiKey = diskProvider ? diskProvider.apiKey : "";
      }
    }
  }
  return merged;
}
