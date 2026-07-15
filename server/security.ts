import path from "path";
import fs from "fs";
import { URL } from "url";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
const EXECUTOR_BASE_DIR = path.resolve(process.cwd(), "bridges/qi_yuan_executor");
const EXECUTOR_LOGS_DIR = path.join(EXECUTOR_BASE_DIR, "logs");

// Ensure directories exist
[WORKSPACE_DIR, EXECUTOR_LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// JSON Lines security log writer
export function writeSecurityLog(taskId: string, command: string, reason: string) {
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

// JSON Lines executor log writer
export function writeExecutorLog(taskId: string, event: string, level: string = "INFO", extra: any = {}) {
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

// Traversal Prevention Safe Path Solver
export function safePath(relativeOrAbsolute: any): string {
  if (typeof relativeOrAbsolute !== "string") {
    relativeOrAbsolute = String(relativeOrAbsolute || "");
  }
  // Uniform separators
  let cleaned = relativeOrAbsolute.replace(/\\/g, "/");
  // Remove absolute prefixes or windows drive prefixes (e.g. C:/)
  cleaned = cleaned.replace(/^([a-zA-Z]:)?\/+/, "");
  const resolved = path.resolve(WORKSPACE_DIR, cleaned);
  
  if (resolved !== WORKSPACE_DIR && !resolved.startsWith(WORKSPACE_DIR + path.sep)) {
    throw new Error(`安全越界拦截: 路径 '${relativeOrAbsolute}' 超出了工作区范围。`);
  }
  return resolved;
}

// Advanced Blacklist patterns supporting obfuscated shell techniques
export const DANGEROUS_PATTERNS = [
  /rm\s+-[a-zA-Z]*rf[a-zA-Z]*\s+([\/*~]|\.+)/i, // rm -rf /, rm -rf ~, rm -rf *, rm -rf ., rm -rf ..
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
  // Script generation -> execution bypass protection (block sh, bash, source, . execution of local scripts)
  /\b(bash|sh|source)\s+.*\.sh\b/i,
  /(^|\s+)\.\s+.*\.sh\b/i,
  /\.\/.*\.sh\b/i,
  // Obfuscated Base64 / execution pipe checks
  /base64\s+-d\s*\|\s*(sh|bash|eval)/i,
  /echo\s+.*\s*\|\s*sh/i,
  // Variable assignment of dangerous commands / dynamic expansion bypass
  /\b[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*(['"]?)(rm|curl|wget|chmod|chown|kill|sudo|su|nc|bash|sh)\b/i,
  /\$\([^)]+\)/i, // captures any $(...) command substitution
  /`[^`]+`/i,     // captures any `...` backtick command substitution
  /\$[a-zA-Z_][a-zA-Z0-9_]*\s+-[a-zA-Z0-9_-]*/i,
  // DNS Tunnel & Network Discovery Side-Channels
  /\b(nslookup|ping|tracert|nbtstat|dig|host)\b/i,
  // Power Management Side-Channels
  /\b(powercfg|stop-computer|restart-computer)\b/i,
  /rundll32(\.exe)?\s+powrprof(\.dll)?/i,
  // Windows GUI and Side-Channel Bypasses
  /\bstart\s+([a-zA-Z0-9_\-\.]+)/i, 
  /\bmsg\s+(\*|[a-zA-Z0-9_]+)/i, 
  /powershell\s+.*-WindowStyle\s+Hidden/i, 
  /powershell\s+.*-w\s+hidden/i, 
  /powershell\s+.*-ExecutionPolicy\s+Bypass/i, 
  /sc\s+create\s+/i, 
  /reg\s+(add|delete|import|restore)/i 
];

// Check command safety
export function checkDangerousCommand(command: string, taskId: string = "system"): boolean {
  const isDangerous = DANGEROUS_PATTERNS.some(regex => regex.test(command));
  if (isDangerous) {
    writeSecurityLog(taskId, command, "COMMAND_BLOCKED (命中命令黑名单安全规则)");
  }
  return isDangerous;
}

// SSRF Safety Validator (web_fetch defense)
export function isValidPublicUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    
    // Only HTTP/HTTPS protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const host = url.hostname.toLowerCase();

    // Block private/loopback domain names
    const forbiddenDomains = [
      "localhost",
      "localhost.localdomain",
      "127.0.0.1",
      "0.0.0.0",
      "[::1]",
      "metadata",
      "metadata.google.internal"
    ];

    if (forbiddenDomains.includes(host) || host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }

    // IP address format check
    const isIp = /^[0-9.]+$/.test(host) || host.startsWith("[");
    if (isIp) {
      const cleanIp = host.replace(/[\[\]]/g, "");
      
      // IPv4 blocklist
      if (
        cleanIp.startsWith("127.") || 
        cleanIp.startsWith("10.") || 
        cleanIp.startsWith("169.254.") || 
        cleanIp.startsWith("192.168.")
      ) {
        return false;
      }
      
      // IPv4 Class B Private Block (172.16.0.0 - 172.31.255.255)
      if (cleanIp.startsWith("172.")) {
        const parts = cleanIp.split(".");
        if (parts.length >= 2) {
          const secondOctet = parseInt(parts[1], 10);
          if (secondOctet >= 16 && secondOctet <= 31) {
            return false;
          }
        }
      }

      // IPv6 Loopback or Link-Local Check
      if (cleanIp === "::1" || cleanIp === "0:0:0:0:0:0:0:1" || cleanIp.startsWith("fe80:") || cleanIp.startsWith("fc00:")) {
        return false;
      }
    }

    return true;
  } catch (err) {
    return false;
  }
}
