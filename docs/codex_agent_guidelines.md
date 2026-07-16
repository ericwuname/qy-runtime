# Codex 对话执行器与自愈引擎架构指导书 (Codex-Agent-Guidelines)

> **导言 (Strategic Intent)**
> 真正的 "Codex 级" 稳定可靠性来自对工程细节的极致打磨与严苛防线。
> 本指导书针对前一版方案的漏洞和 Claude 的反馈进行深度的、实战化的重构：
> 1. **RepoIndexer 地基化**：实现高性能、单语言/浅层符号表索引，并无缝注入规划大脑。
> 2. **Planner (规划器) 务实化**：设计结构化、小幅度的分步计划，不盲目追求长链规划。
> 3. **自愈循环 (Self-Healing) 确定化**：摒弃不切实际的 85% 语义相似度拦截，改用**硬性重试预算 (最大 3 次)** 与 **错误特征比对 (Error Fingerprinting)**。
> 4. **沙箱边界明晰化**：确认 AI Studio 容器环境不支持嵌套 Docker，基于现有的多级 Child Process 防御、10秒超时、路径安全锚定（safePath）进行物理级加固。
> 5. **反思报告 (Reflection) 临时化**：任何自愈反思结论仅被视为 `[UNCONFIRMED_HYPOTHESIS]` (未证实假设)，绝不污染长期存在的系统文件，彻底规避幻觉自我强化死循环。

---

## 1. 模块设计与落地细节

### 1.1 RepoIndexer (代码库感知引擎)
* **工程价值**：这是整个多步执行链的基础。没有代码感知，规划器就是在闭眼探路。
* **实现策略**：
  * 对工作区（`workspace/`）下的 `.ts`, `.js`, `.tsx`, `.jsx`, `.py` 等源文件进行浅层符号表提取（Regex-based Match）。
  * 提取 `class`, `function`, `interface`, `type`, `import` 及对应行号。
  * **上下文注入 (Context Injection)**：在启动 Task 时，系统会自动读取 RepoIndex 并生成紧凑的“代码库概览”，以系统上下文的形式灌入 LLM 的 Prompt 中，使模型拥有上帝视角。

### 1.2 Planner (多步规划器)
* **执行约束**：摒弃长链规划（10+ 步），单次规划最大生成 **5 步**。
* **规划结构 (Schema)**：
  ```json
  {
    "plan": [
      {
        "step": 1,
        "title": "分析当前项目 package.json 依赖",
        "tool": "read_workspace_file",
        "args": { "path": "package.json" }
      }
    ]
  }
  ```
* **自动纠偏机制**：如果模型输出的规划未通过 JSON 校验或参数不全，Planner 不会直接抛出异常，而是将格式错误反馈给自身进行一轮 **“格式自我纠正 (Self-Correction)”**。若两轮纠偏失败，则退回单步决策模式，绝不空转。

### 1.3 Self-Healing Loop (确定性自愈引擎)
* **死循环断路器 (Heuristic Breaker)**：
  1. **最大重试预算 (Retry Budget)**：单步骤或单个错误的自动修复上限限制为 **3 次**。
  2. **错误特征指纹 (Error Fingerprinting)**：系统会在运行时提取报错的核心内容（如 `TypeError: Cannot read property...` 或 `bash: command not found`）和执行工具参数。
  3. **相同错误拦截 (Repetitive Error Interception)**：如果**同一个工具调用**连续产生**完全相同特征的错误**（代表模型陷入了原地摩擦），自愈引擎将立刻切断循环，不进入下一轮重试，将状态设为 `failed` 报错，释放控制权并等待人工介入。
* **自愈自醒模式**：每次自愈重试时，系统将对当前的执行路径和错误历史进行浓缩整理，告知 LLM：*“你在执行第 X 步时遭遇了以下错误，请避免再次使用导致该报错的方法进行修复。”*

### 1.4 Sandboxed Environment (隔离沙箱)
* **物理底座**：AI Studio 托管的 Cloud Run 隔离容器（无 Docker-in-Docker 权限）。
* **加固对策**：
  1. **路径绝对锚定 (`safePath`)**：通过文件操作工具限制所有路径只能解析在 `/workspace` 子目录内，物理拦截 `..` 路径穿越。
  2. **命令严格阻断 (`checkDangerousCommand`)**：利用高度敏感的正则（包括 DNS 隧道工具、休眠/重启、物理端口占用等）对 `run_shell_command` 进行首毫秒熔断拦截。
  3. **10秒硬超时 (Hard Timeout)**：所有 `child_process.exec` 的超时参数硬编码为 `10000ms`，彻底防范死循环脚本。

### 1.5 Reflection & Insights (反思临时化)
* **防幻觉污染协议**：
  * 反思所产生的“经验总结”存储在任务本地临时日志中，或者写入标记为临时性质的 `workspace/.insights_temp.json`。
  * **头部显式声明**：
    ```markdown
    [UNCONFIRMED_HYPOTHESIS / 系统未证实假设]
    此结论由模型根据单次执行失败进行总结。由于缺乏广泛测试验证，该经验仅作为当前任务重试的本地临时参考，严禁作为确定性事实注入长期系统指令。
    ```
  * 每次新任务开始时，系统会**清空或重置**临时反思，保证规划器从一张白纸开始，不被上一次的错误反思误导。

---

## 2. 工程交付与验收标准

### 2.1 验收标准 (Definition of Done)
1. **[RepoIndexer]**：通过调用 API 能够立刻列出当前工作区的所有函数、类符号，并在 Task 启动时自动注入 Prompt。
2. **[Heuristic Breaker]**：当模拟一个必定持续报错的命令（例如试图访问不存在的 node 变量）时，系统在触发**第 3 次**相同错误时能够**百分百自动停止并设为 failed**，输出清晰的报错诊断，而不是无限轮询 15 步。
3. **[Safe Sandbox]**：传入包含安全违规（如路径穿越 `../../` 或禁用命令 `nslookup`）的任务，系统必须在 5 毫秒内予以安全拦截，并录入 `security.log`。
4. **[Hypothesis Tagging]**：运行产生的修复报告中必须带有 `[UNCONFIRMED_HYPOTHESIS]` 字样，提示用户仅作临时参考。

---

## 3. 开发执行步骤 (Execution Blueprint)

1. **第 1 步：加固工具层与沙箱地基 (`server/tools.ts`)**  
   确保所有本地文件操作、Shell 执行具备最严苛的路径和命令白名单过滤、超时控制。
2. **第 2 步：实现 RepoIndex 符号注入 (`server/agent-loop.ts`)**  
   在 `agent-loop` 开始前，调用 `getRepoIndex()`，将生成的代码文件树与关键符号注入 systemPrompt，使其具备代码库感知。
3. **第 3 步：编写自愈自愈断路器 (`server/agent-loop.ts`)**  
   维护一个 `errorHistory` 数组，对每次工具执行报错提取 `fingerprint`（错误信息摘要）。若出现相同特征错误，将 `repetitiveErrorCount` 递增。若任一错误触发 2 次原地摩擦或重试达 3 次，立刻中断任务，转为 failed，输出诊断。
4. **第 4 步：设计临时反思机制 (`server/agent-loop.ts`)**  
   自愈生成的任何诊断日志头部自动带上 `[UNCONFIRMED_HYPOTHESIS]`，拒绝污染任何全局配置或长期存在的 `insights.md`。
5. **第 5 步：验收测试与质量验证**  
   编译项目，跑 Linter 确保类型无误，并进行真实的任务演练以确保系统表现无可挑剔。
