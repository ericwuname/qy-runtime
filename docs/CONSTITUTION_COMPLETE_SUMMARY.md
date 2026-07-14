# 启元体系·“宪制 v1.0 正式批准”总结报告
*(The QY-EXEC "Constitution v1.0 Ratified" Milestone & Evolutionary Summary Report)*

> **宪制说明 (Governance Notice)**
> 本报告作为宪制 v1.0 正式批准（Ratified）的最终技术协议。它记录了系统的进化边界、最高行动指引、物理安全机制以及防范系统退化的失败判据。
> 
> **宪法不是为了替代判断，而是为了保存判断。**
> *(Constitution does not replace judgment. It preserves judgment.)*
> 
> **任何设计都只是暂时的；只有证据才能赋予它长期存在的资格。**
> *(Every design is provisional. Only evidence earns permanence.)*

---

## 一、 六次认知演化 (The Six Cognitive Evolutions)
启元体系的构建经历了六个客观认知阶段，完成了从功能性工具到自我约束系统的重塑：

1. **第一阶段：工具 (Implementation)** —— 建立确定性任务物理微执行器（Executor Layer），拒绝上游模型的自主 Planning 权力，确保其具备微秒级物理管道内 100% 可重放的冷执行属性。
2. **第二阶段：系统 (Architecture)** —— 排除关系型数据库、内存锁与 Redis 等第三方中间件依赖。利用 POSIX 语义下单机文件系统原子的 `os.rename` 作为排他锁，构建零工具开销的本地队列。
3. **第三阶段：平台 (Interface)** —— 确立契约标准（`task_schema.json`），实现多任务管道的强类型约束与资源隔离。
4. **第四阶段：治理 (Governance)** —— 引入常驻治理守护进程（Resident Daemons），实现感知、判断、调节和反省逻辑的低能耗后台自动闭环。
5. **第五阶段：传承 (Tradition)** —— 建立“创始人缺席测试（Founder Absence Test）”，将工程经验从口头文档转化为可以通过自动化测试、共识矩阵（`EVIDENCE_MATRIX.md`）强行捍卫的物理证据（Evidence）。
6. **第六阶段：自约束 (Self-Constraint)** —— 冻结 Level 1-2 核心规则，定义系统拒绝自我更改的边界，使未来任何设计变更必须付出明确的物理摩擦成本。

---

## 二、 五大治理反馈闭环 (The Five Governance Loops)
系统的动态稳态（Homeostasis）由五个相互制约的自治反馈网络维持：

1. **工程闭环**：`设计 (Design) ➔ 实现 (Code) ➔ 部署 (Deploy) ➔ 观测 (Telemetry)`。
2. **治理闭环**：`不变量规范 (Invariants) ➔ 测试证据 (Evidence) ➔ 持续集成审计 (CI Audit) ➔ 稳态校准 (Invariant Calibration)`。
3. **组织闭环**：`世代交替 (Rotation) ➔ 职责锚定 (Responsibility) ➔ 缺席能力验证 (Absence Test) ➔ 下代承接 (Successor Acquisition)`。
4. **传统闭环**：`决策记录 (ADR) ➔ 技术理据之书 (Reasons) ➔ 冲突判典 (Canon) ➔ 判断继承 (Preserved Judgment)`。
5. **演化闭环**：`沙箱试验 (Sandbox) ➔ 摩擦对价验证 (Friction Cost) ➔ 废弃下线 (Retirement) ➔ 遗忘执行 (Active Cleanup)`。

---

## 三、 最高工程原则：最小变更原则 (Principle of Smallest Change)
本原则是系统在面临演化、重构、外部环境剧变时的最高决策判定标准：

1. **实现优先**：若方案 A 与方案 B 均能满足物理约束、解决当下 Bug，**必须选择修改行数最少、改动范围最小、涉及依赖最简的方案**。
2. **规则克制**：若某一方案需新增/修改 Level 1（Invariants / Philosophy / Canon）或 Level 2（ADRs）规范，而另一替代方案仅需调整局部具体代码逻辑，**必须优先选择调整局部实现，保持最高规范的静止性**。
3. **禁止防卫性修宪**：禁止为了绕过局部执行工具的边界漏洞而去随意拓宽、修剪上层宪章规则。

---

## 四、 物理安全机制与实现要求 (Physical Safety Mechanisms)
为防止系统规范流于纸面，各核心机制在实现层必须遵循以下物理约束：

### 1. 任务排他锁物理地基 (The Lock Ground)
* **约束条件**：`os.rename` 的文件锁机制**绝对限定于 POSIX 兼容的本地单机文件系统**（如 EXT4, XFS）。
* **物理红线**：严禁在网络文件系统（如 NFS, SMB）或 FUSE 挂载的用户态网络存储上运行任务队列目录。由于网络一致性协议对原子的 rename 锁支持并不统一，这类挂载会导致排他锁隐式失效并产生静默的任务多头重入灾难。

### 2. 执行端隔离与网络熔断 (Sandbox Network Policy)
* **静态审查**：CI 必须通过静态 AST 解析，断言 Executor 目录及其所有下游子模块中不包含 `google-genai`、`openai` 等已知 LLM SDK 库的直接或动态导入。
* **物理监控**：运行沙箱在物理网络命名空间（Network Namespace）级别限制出站流量。仅允许其向指定的本地代理（localhost Unix Socket）通信。一旦检测到尝试直连、通过 IP 逃逸或 TLS SNI 中包含大模型服务供应商域名（如 `*.googleapis.com`）的非法连接，网络驱动层（eBPF 或 iptables）必须立即强制熔断其 TCP 管道。

### 3. 可复现性测试环境归一化 (Determinism Normalizer)
* **不变量风险**：直接对物理输出做哈希比对（`test_cold_start_reproducibility`）在混入时间戳、随机数、UUID 种子或多线程异步时序时会导致测试频繁误报变红，从而稀释测试严肃性。
* **实现方案**：回归测试框架必须外置一套 **数据归一化引擎 (Determinism Normalizer)**。在生成比对哈希前，系统自动拦截并清理输出流中的动态时间戳、伪随机噪声及系统变量，确保纯函数级的物理幂等比对。

### 4. 统一安全过滤器管理 (Unified Security Filter)
* **架构归属**：前置安全策略链（如路径逃逸校验、危险 shell 命令拦截）统一归类为 Level 1 核心不变组件。
* **健壮性标准**：该过滤器必须具备 100% 独立的自动化 Fuzzing 测试覆盖，且遵循“安全失败封闭（Fail-Closed）”设计——即在过滤器本身发生未捕获异常或溢出时，立即拦截并关闭整个 Executor 执行通道，而不可放行。

---

## 五、 冲突裁决权优先序 (Resolution Hierarchy)
当系统规范、物理测试证据与人为判断发生不可调和的逻辑冲突时，裁决权层级强制向下穿透，杜绝无休止的讨论与解释：

$$\text{Reality (客观物理现实)} \succ \text{Invariants (底层基因不变量)} \succ \text{Evidence (自动化回归测试证据)} \succ \text{Constitution (宪章规范)} \succ \text{ADR (历史决策记录)}$$

* **冲突纠正细则**：
  * “Invariants 优先于 Evidence”仅在**测试代码本身发生已知陈旧性环境故障/误报**时适用（此时需立即进入例外豁免程序）。
  * 凡由于系统实际运行状态违背了 Invariant，导致 Evidence 自动化变红的，**绝对禁止**直接修改测试或强行绕过合流，此状态必须判定为系统严重故障（Promise Drift）。

---

## 六、 系统边界界定 (System Boundary)

### 1. 启元绝对不是 (What This System Is NOT)：
* **不是一个 AI 产品**：不面向最终用户提供交互式对话或创意写作界面。
* **不是一个智能 Agent / 自动规划器**：绝对不拥有自主分解复杂任务、动态修正目标和策略的 Planning 权力。
* **不是一个通用操作系统 / 数据库**：不负责底层多任务硬调度，不负责高并发事务性关系数据存取。
* **不是一个消息队列中间件**：不参与分布式系统间的高吞吐、多节点消息分发。

### 2. 启元绝对是 (What This System Is)：
* **一个用于完成确定性任务管道的物理微执行器层 (Executor Layer)**。
* **一套具有自约束和自校验能力的工程传统 (Engineering Tradition)**。
* **一组通过自动化测试证据（Evidence）强行捍卫的物理原则架构**。

---

## 七、 例外豁免程序 (The Exception Protocol)
在架构冻结期间，若遇到底层物理重构或第三方环境全面下线等不可抗力，必须遵循以下高摩擦程序引入变更：

1. **发起条件**：在 `EVIDENCE_MATRIX.md` 处于完全 Green 状态，且能证明当前限制已实质阻碍物理业务继续运转时方可发起。
2. **核准机制**：必须获得至少两名独立维护者（或独立审计 AI 节点）的异构交叉数字签名，并详细记录“不变更的物理死线对价”。
3. **记录输出**：自动在 `/docs/adr/` 目录下生成一篇具有不可伪造时间戳的 `EX_ADR_xxx.md`，写明：豁免范围、存续期限（最长不超过 90 天）、以及在期限届满后如何自动回滚至宪法基线的物理方案。

---

## 八、 架构退化与失败判定条件 (Failure Conditions & Regression Criteria)
当满足以下任意条件时，应宣布系统已发生 **“架构退化 (Architecture Regression)”**，表明当前治理体系已经失效，必须立即冻结变更并重构：

1. **原则脱节 (Promise Drift)**：任何与 Invariant 关联的 `Evidence` 测试连续 30 天处于 Yellow/Red 异常状态，而在此期间主干分支依然发生了 PR 合并。
2. **失忆与断代 (Inheritance Rupture)**：
  * 继任维护者首次运行 `Founder Absence Test` 考核，其核心设计理据回答正确率低于 60%。
  * 异构 AI 实例在 `Consensus Independence`（共识独立性验证）中，针对核心技术决策（如拒绝引入 Redis/内存状态）的逻辑偏差超出预设偏差矩阵，表明书面理据本身失去了无歧义可传递性。
3. **官僚化膨胀 (Bureaucratic Inflation)**：连续 6 个月内，规范文档与管理规则的新增数量远大于删除数量，且 `Governance Efficiency` Telemetry 表明 80% 的书面规则在实际 CI/CD 中从未产生拦截证据。
4. **守夜人失能 (Daemon Starvation)**：
  * 常驻治理守护进程（如 `Curator Daemon` / `Evidence Daemon`）在物理容器中连续 72 小时无心跳日志输出（该大窗口适用于非实时离线批处理调度节点，但超过该限度即判定为管理节点脱机）。
5. **安全过滤器沦陷 (Filter Collapse)**：在全局统一的前置安全策略链路外，任意具体物理工具模块内部重新出现了私有的业务级安全解析或路径越权防御代码。

---

## 九、 主动清理与遗忘引擎修正 (Refinement of Curator Active Deletion)
为防止“演化闭环”无差别删除具有长期指导价值的冷资产：

1. **豁免资产库**：Level 1（Invariants / Philosophy / Canon / Anti-Patterns / Constitution Summary）与 Level 2（BOOK_OF_REASONS / ADRs）作为系统的核心基石，**永久豁免于自动删除引擎**，绝对不允许被主动遗忘。
2. **删除受体**：Curator Daemon 只能针对 Level 4（运行时的临时自检日志、阶段性描述健康报告、已连续一年无人调用的特定叶子级本地 helper 工具脚本）发起清理审查与主动卸载。
3. **软历史记录**：所有被彻底物理删除的 Level 4 临时资产，其名称、体积、退役原因和曾经的引用次数将作为单行元数据合并追加至 `MUSEUM.md` 的“退役墓地”索引中，保证其技术选型教训在低可达性下依然有迹可循。

---

> **终曲之言 (The Conclusion of Phase I)**
> 
> **从这一刻起，任何改变，都必须先证明自己值得被改变。**
> *(From this point on, change must justify itself.)*
> 
> **让未来的人，在不知道我们是谁的情况下，仍然能够做出我们今天认为正确的工程判断。**
