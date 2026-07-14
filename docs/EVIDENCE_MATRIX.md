# QY-EXEC 共识证据矩阵 (The Evidence & Enforcement Matrix)

> **核心工程定律 (The Enforcement Law of Consensus)**
> **“文档负责表达共识，测试负责验证共识，代码负责强制共识。”**
> 在成熟的工程体系中，任何纸面上的不变量（Invariants）和治理原则，如果仅仅停留在自然语言说明文档中，它就只是一个脆弱的愿望。
> QY-EXEC 规定：每一项 Level 1 永恒不变量，都必须在系统中具备唯一的、可独立审计的 **“证明证据链 (Evidence Chain)”**，形成由自然语言意图、自动化拦截测试、和代码物理极限限制三位一体的铁流闭环。

---

## 1. QY-EXEC 七大永恒不变量证据矩阵 (The Seven Invariants Proofs)

本矩阵是系统运行状态的可信源。凡是没有通过测试与代码双重物理强制的不变量，一律判定为“存在安全缺口（Yellow/Red Alarm）”。

| 永恒不变量 (Level 1 Invariant) | 1. 文档表达 (Consensus Document) | 2. 测试验证 (Evidence Test Verification) | 3. 代码强制 (Code-Level Enforcement) | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **Invariant 1: Executor 永远不参与规划** | `INVARIANTS.md` / `EVOLUTION_CONSTITUTION.md` 明确划定职责边界。 | **回归测试 `test_executor_cannot_plan`**：拦截任何 Executor 底层试图调用 LLM SDK / 产生 Task 分解行为的伪造动作。 | **API 级物理隔离**：Executor (Python/Node 沙箱) 中**完全没有**引入 `GoogleGenAI` 等任何大模型 SDK 库或 API 调用凭证，物理剥离其向外建立模型连接的能力。 | 🟢 **Green** |
| **Invariant 2: 任务执行天然幂等化** | `INVARIANTS.md` 明确写写工具写入规范。 | **回归测试 `test_idempotent_writes`**：连续运行同一个 write_file 写入完全相同字节流，断言物理哈希一致、状态未受破坏，未引起进程死锁。 | **写操作原子保护与哈希前置校验**：在写文件 API 中对重复数据执行底层校验，强制要求写操作失败时触发自动恢复，避免产生半写入死状态。 | 🟢 **Green** |
| **Invariant 3: 执行端（Executor）彻底无状态化** | `INVARIANTS.md` 确定无本地常驻状态与跨任务记忆。 | **测试用例 `test_cold_start_reproducibility`**：启动两个并行的执行沙箱执行同款任务，确保无外部缓存残留干扰。 | **环境清洁与内存无痕隔离**：每一次抢占 pending 任务在容器启动时，执行器都自动执行全局临时空间初始化，对临时变量、环境变量及缓存执行物理级 Flush 和解绑。 | 🟢 **Green** |
| **Invariant 4: 物理工具绝对单向调用** | `INVARIANTS.md` 明确要求工具间单向通信，禁止横向穿透。 | **静态依赖分析测试 `test_no_cross_tool_import`**：在 CI 中自动跑 AST（抽象语法树）分析器，若发现 write_file 导入了 bash 或 patch，测试立即挂起。 | **微内核隔离机制**：每一个物理工具（Tools）均由独立的微脚本表达，被约束在核心调度器的子进程（Child Process）下，各工具底层无权横向建立任何 IPC 通道或数据流重定向。 | 🟢 **Green** |
| **Invariant 5: 契约优先于物理实现** | `INVARIANTS.md` 规定 schema version 核验原则。 | **输入格式强制拦截测试 `test_schema_required_fields`**：传入一个没有 `schemaVersion`、或拼写错 `executorVersion` 的恶意 JSON，断言协调器在第 1 毫秒拦截。 | **JSON Schema 入口验证关卡**：在 `/server.ts` 及物理数据接收口，全面挂载 `task_schema.json` 强规则链拦截校验（AJV/Zod 级逻辑），不匹配直接返回 400 Bad Request。 | 🟢 **Green** |
| **Invariant 6: 安全策略热解耦且独立运行** | `INVARIANTS.md` 与 `ADR-002`。 | **混沌防穿越防御测试 `test_path_traversal_interception`** 与 **DNS 隧道攻击测试 `test_dns_tunnel_block`**：通过 `nslookup` 或 `../etc` 试图逃逸，断言 100% 拒绝并阻断。 | **安全过滤器前置拦截链 (Filter Chain)**：所有的命令执行与文件路径解析均必须优先流入统一的 `validate_safe_path()` 与 `command_block_list`。策略引擎被解耦设计，物理工具无法越过策略执行逻辑。 | 🟢 **Green** |
| **Invariant 7: 审计事件链（Events）永远只增不改** | `INVARIANTS.md` 关于 Append-Only Event 规范。 | **测试用例 `test_event_log_append_only`**：试图通过脚本写覆盖或删除已经生成的审计 Event 文件，测试直接断言系统由于 `Permission Denied` 或写入被拒而失败。 | **文件流单向写入机制 (WriteStream append)**：日志和 Event 输出物理上通过 Node 系统的 `fs.createWriteStream` 以 `'a'` (append) 模式建立，物理级阻断覆写与倒退行为。 | 🟢 **Green** |

---

## 2. 证据度量标准 (Evidence Scoring Rules)

策展者（Curator）在执行“减法与收敛审查”时，对任何新增或存留不变量，按以下评分标准强制标识，并输出可视化的证据报告：

* **🟢 Green (完全落地/强制共识)**：
  * 原则有明确的文档声明（Level 1/2）；
  * 原则有自动化回归测试用例在 CI 管道中每日跑通，模拟各种黑客、混沌或挂挂场景；
  * 原则在底层物理代码架构、API 设计或包引入（import）上具备了强制性限制（即使开发者手抖也绝不可能轻易绕过）。
* **🟡 Yellow (部分缺口/验证缺口)**：
  * 原则有文档，代码可能也做了部分处理，但**缺乏自动化回归测试**来证明其在极端边界下的防护力和稳定性。
  * *纠偏策略*：策展者限期 3 天，要求开发团队必须补齐自动化测试用例，否则降级为 Red 警报。
* **🔴 Red (严重漂移/纸面约束)**：
  * 原则仅在 Markdown 文档中作为“口头警告/自觉守则”存在。在具体代码实现中，完全可以通过拼写别名、故意手抖、或绕过策略直接访问。
  * *纠偏策略*：直接熔断。在代码级机制落地并被回归脚本验证通过前，禁止该版本上线。
