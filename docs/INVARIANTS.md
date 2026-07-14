# QY-EXEC 系统永恒不变量契约与治理层级 (System Invariants & Governance Hierarchy)

> **核心原则 (The Law of Conservation of Invariants)**
> 技术方案（Architecture Design）会演进，配置文件与代码（Implementation）会重构，但 **“不变量（Invariants）”永远不变。**
> 任何破坏本文件中声明的 7 大不变量或无视四层网关（Architecture Gate Reviews）的提交合并，均视为系统级非法修改，必须直接驳回。

---

## 1. 启元架构四级治理层级 (The 4-Tier Governance Hierarchy)

为避免文档及规范膨胀，导致新进团队无法辨明主次发生认知死锁，系统建立以下严密、层级高低的治理树。上层决断天然对下层具备物理穿透约束力：

```
 Level 1: 永恒不变量 (System Invariants) ── [当前文件]
    │  (确定系统绝对底线、生存基因与守恒定律。5-10年保持零变动)
    ▼
 Level 2: 架构决策记录 (ADR) & 演进路线 ── [ADR.md]
    │  (记录针对特定发展周期的物理选择权衡，记录 "Why & Why Not" 选择决策)
    ▼
 Level 3: 组件间契约约束 (System Contracts) ── [contracts.md]
    │  (规范模块边界数据类型、版本对齐字段、以及外部接口对齐协议)
    ▼
 Level 4: 物理代码与自动化测试 (Implementation & Regression) ── [src/ & tests/]
    (最底层的代码表达，每天通过高强度混沌与回归脚本无情检验上层规则)
```

---

## 2. QY-EXEC 7 大永恒不变量 (The Seven Sacred Invariants)

### Invariant 1: Executor 永远不参与规划
* **规则定义**：Executor 仅是一个物理原子指令反射器。它绝对不会参与任何任务的二次规划（Planning）、目标分解（Task Decomposition）、或执行意图推演。它只能接收确定性指令，并交还确定性执行结果。

### Invariant 2: 任务执行天然幂等化 (Idempotency of Tasks)
* **规则定义**：对于同一个 `task_id` 的同一代（Generation）任务，重入调用所产生的副作用（Side-effect）和系统最终状态必须完全一致。所有物理写操作工具必须原生支持基于覆盖或条件校验的幂等防重写机制。

### Invariant 3: 执行端（Executor）彻底无状态化 (No Local State Persistence)
* **规则定义**：物理执行器不承担任何跨任务长期记忆、持久化用户喜好、或状态机维护的职责。每次任务被抢占启动时，都视其为“冷启动”的洁净节点。

### Invariant 4: 物理工具绝对单向调用 (No Lateral Tool Calling)
* **规则定义**：物理工具（Tool）之间严禁相互跨过 Executor 层级进行横向相互串联或自主嵌套调用。任何工具的启动、结束和输入输出必须被 Executor 100% 审计并记录于单向追加（Append-Only）事件链中。

### Invariant 5: 契约优先于物理实现 (Contract Over Implementation)
* **规则定义**：任何 API 或 JSON 结构的扩展，在修改具体的 TypeScript 或 Python 代码前，必须先在 `task_schema.json` 与 `contracts.md` 中进行显式定义与联合核准。

### Invariant 6: 安全策略热解耦且独立运行 (Decoupled Policy Engine)
* **规则定义**：黑名单、白名单等安全审计防护机制必须始终在策略拦截器（Policy Filter）中独立解析运行，任何安全机制不得混入具体物理工具的内部业务代码。

### Invariant 7: 审计事件链（Events）永远只增不改 (Append-Only Events)
* **规则定义**：系统日志链（Event Stream）必须是物理上 Append-Only 的。一旦发生文件或内存写入，严禁对其执行任何修改、替换或高位覆盖。不变量的改动必须由新的事件进行状态冲抵。

---

## 3. 架构控制网关 (Architecture Gate Reviews)

在未来的系统运维中，任何团队成员发起新功能（Features）合并或重大升级（Release）时，必须在评审表第一页回答并无情通过以下 **4 大检查站（Gate Reviews）**：

### 🛑 Gate 1: 执行器保瘦核验 (Is the Executor Staying Thin?)
* **审查问题**：此新增能力为什么必须属于执行层（Executor），而不能属于 Planner（上游模型层）、Tool（下游特定工具）、或 Policy（旁路策略引擎）？
* **熔断准则**：若回答“因为顺手加在这方便”，直接驳回（Reject）。

### 🛑 Gate 2: 兼容性契约保护 (Did we Preserve the Contracts?)
* **审查问题**：此修改是否破坏了现有的 `task_schema.json` 规则？若接口不兼容，向后迁移的平铺降级方案、旧版退役时间表、以及多版本混部支持是否已就绪？
* **熔断准则**：若出现可能导致旧版 Executor 解析崩溃的断层修改，直接驳回（Reject）。

### 🛑 Gate 3: 状态显式可观测性 (Zero Hidden States)
* **审查问题**：此更改是否引入了任何“隐藏内存状态”（如隐藏重试、内部缓存机制）？一旦系统出现假死，运维人员能否在 logs 审计流中通过 `correlation_id` 一眼看清、重放、调试和 Replay 此行为？
* **熔断准则**：不允许任何没有对应结构化事件（Structured Events）支持的隐式状态，发现即直接驳回（Reject）。

### 🛑 Gate 4: 极端故障自愈机制 (Is it Recoverable?)
* **审查问题**：如果在执行此任务期间，物理机由于断电、掉网、磁盘溢出或进程被强制 Kill 导致意外终止，系统处于何种状态？我们是否提供了完备的、可在下一次自检中优雅解除锁（Zombie Reclaim）并安全降级的策略？
* **熔断准则**：如果产生任何不可恢复的状态死锁、孤儿僵尸锁，直接驳回（Reject）。

### 🛑 Gate 5: 可拔插与可删除性核验 (Is it Deletable?)
* **审查问题**：如果未来要把这个新功能彻底从代码库里删掉，会发生什么？系统核心会因此瘫痪吗？
* **熔断准则**：如果一个功能的增加会导致核心模块与其深度耦合，导致未来无法干净、无损地将其拆除，则直接驳回（Reject）。
