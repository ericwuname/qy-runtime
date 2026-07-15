import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { loadAIConfig, saveAIConfig } from "./server/config";
import { loadTasks, syncFilesystemWithMemory, checkAndRecoverZombieTasks } from "./server/persistence";
import { registerRoutes } from "./server/routes";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Directory Configurations
const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
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

// Initialize Memory Task Cache
let activeTasks: any[] = loadTasks();

// Register Web API Routes
registerRoutes(
  app,
  () => activeTasks,
  (tasks: any[]) => {
    activeTasks = tasks;
  }
);

// Start Background Bridge Synchronizations
setInterval(() => {
  syncFilesystemWithMemory(activeTasks);
}, 3000);

setInterval(() => {
  checkAndRecoverZombieTasks(activeTasks);
}, 10000);

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
    console.log(`[QY-EXEC] Modernized modular server running on http://localhost:${PORT}`);
  });
}

startServer();
