import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { Type, FunctionDeclaration } from "@google/genai";
import { safePath, checkDangerousCommand, isValidPublicUrl, writeSecurityLog } from "./security";
import { loadAIConfig } from "./config";

const execAsync = promisify(exec);
const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

// ---------------------- Tool Definitions ----------------------

export const readWorkspaceFileTool: FunctionDeclaration = {
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

export const writeWorkspaceFileTool: FunctionDeclaration = {
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

export const listWorkspaceDirectoryTool: FunctionDeclaration = {
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

export const runShellCommandTool: FunctionDeclaration = {
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

export const webFetchTool: FunctionDeclaration = {
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

export const generateImageTool: FunctionDeclaration = {
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

export const toolsList = [
  readWorkspaceFileTool,
  writeWorkspaceFileTool,
  listWorkspaceDirectoryTool,
  runShellCommandTool,
  webFetchTool,
  generateImageTool
];

// Helper to simplify or auto-recover tool call parameters
export function simplifyPayload(name: string, originalArgs: any): any {
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

// ---------------------- Tool Executor ----------------------

export async function executeTool(name: string, args: any, taskId: string = "system"): Promise<any> {
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
      
      // Protection of sensitive files from execution agents
      const protectedFiles = [
        "agents.md", "遺嘱.md", "ai_config.json", "tasks.json", "server.ts", "package.json", 
        "behavior_guidelines.md", "core_principles.md"
      ];
      if (protectedFiles.includes(filename.toLowerCase())) {
        const errorMsg = `安全越权拦截: 任务模型禁止写入或覆盖核心系统敏感文件 '${filename}'。`;
        writeSecurityLog(taskId, `write_workspace_file: ${args.path}`, errorMsg);
        throw new Error(errorMsg);
      }

      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

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
      // Mitigate SSRF Risk (Point 5 audit fix!)
      if (!isValidPublicUrl(url)) {
        const errorMsg = `安全越权拦截: URL '${url}' 被判定存在 SSRF 或内网访问风险，系统强行默认拦截。`;
        writeSecurityLog(taskId, `web_fetch: ${url}`, errorMsg);
        throw new Error(errorMsg);
      }
      
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
