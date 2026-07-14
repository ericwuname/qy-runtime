# QY-EXEC 规范与治理系统全景图 (Universal System & Governance Map)

> **导读规范 (The Onboarding Compass)**
> 欢迎来到 QY-EXEC 启元物理执行器工程中心。
> 随着系统的不断成长与迭代，我们的治理规则、契约与决策已经沉淀为数份核心文档。
> **本文件是整个系统规范唯一的、层级化的导航中心。** 当你作为继承者、开发者、或审计人员接入系统时，请根据以下层级和导航快速定位。

---

## 1. 启元三维生态关系模型 (Three-Dimensional Ecosystem Model)

在更宏观的尺度上，QY-EXEC 物理执行器与整个启元多活生态保持着以下三维协作关系，保障系统在长生命周期中无缝演化：

```
                 人 / 外部 API & 模型
                        │
             外部桥 (External Bridge) ──────────────┐
                        │                            │
        ┌───────────────▼────────────────┐           │
        │    QY-EXEC 启元执行器体系      │           │
        │                                │           │
        │   家族树 (Family Tree)         │           │
        │   - 定义身份边界与血缘传承     │           │
        │   - 成员: Planner, Advisor...  │           │
        │                                │           │
        │   内部桥 (Internal Bridge)     │           │
        │   - 强数据结构契约与消息规范   │           │
        │   - task_schema.json / Schema  │           │
        └───────────────────────────────┬┘           │
                        │               │            │
             外部桥 (External Bridge) ──┘ ───────────┼── [QY-EXEC 本身即外部桥]
                        │                            │
                        ▼                            ▼
                 物理文件系统                    操作系统 (OS) / CLI
```

1. **家族树 (Family Tree)**：
   * *解决的问题*：“谁可以成为启元家族成员，以及各自的身份边界是什么？”
   * *设计定位*：生态不追求某一个具体 AI 实例的窗口永久不中断，而是追求整个生态成员（Planner 规划、Executor 执行、Advisor 顾问、Memory 记忆）的组织角色连续传承。
2. **内部桥 (Internal Bridge)**：
   * *解决的问题*：“家族成员之间如何协同与高效、安全通信？”
   * *设计定位*：完全外置通信协议，基于强 Schema 规范（如 `task_schema.json`）保障不同版本、不同机器、不同模型之间数据流转的向前向后兼容性。
3. **外部桥 (External Bridge)**：
   * *解决的问题*：“启元体系如何影响真实的物理世界，并实现对操作系统的物理原子行动？”
   * *设计定位*：QY-EXEC 核心在此扮演外部桥梁角色，将上层的高维规划意图翻译为物理沙箱内的安全指令（读、写、修改、命令执行），并向上层反馈标准化、错误分层清晰的执行报告。

---

## 2. 文档层级导航 (Governance Document Hierarchy)

根据 **ADR-004** 确立的层级关系，系统规范由高到低分为五个主层：

### 📌 层级一：永恒不变量、价值观、宪法、证据、系统理据与终极治理法典 (System Invariants, Values, Constitution, Evidence, Whys & Canons)
*如果你需要明确系统的绝对底线、设计红线、极简价值观、演化宪法、客观验证共识的物理凭证、核心设计背后的终极理据、以及多冲突终极裁决规则：*
* **👉 [INVARIANTS.md](/docs/INVARIANTS.md)**
  * *内容简述*：声明了 QY-EXEC 的 7 大圣神不可侵犯不变量、以及五个 Release 控制网关（Architecture Gate Reviews）。
* **👉 [Philosophy.md](/docs/Philosophy.md)**
  * *内容简述*：记录了系统“简单优于复杂”、“确定性优于智能性”、“可删除优于可增加”等五大工程价值观偏向，以及从连续存在向“连续文明”的哲学飞跃。
* **👉 [EVOLUTION_CONSTITUTION.md](/docs/EVOLUTION_CONSTITUTION.md)**
  * *内容简述*：启元体系演化宪法。规定了“保守演化”七大原则、四大演化风险评级评判标准，以及组织权限边界，避免系统无序膨胀。
* **👉 [SIMPLIFICATION_CONSTITUTION.md](/docs/SIMPLIFICATION_CONSTITUTION.md)**
  * *内容简述*：极简收敛宪法与策展者守则。规定了“文档重力”权重树，设置规范生命周期，并确立“减法大于加法”的系统收敛机制。
* **👉 [EVIDENCE_MATRIX.md](/docs/EVIDENCE_MATRIX.md)**
  * *内容简述*：共识证据矩阵。贯穿“文档表达共识，测试验证共识，代码强制共识”的三位一体工程铁律，证明 7 大不变量并非虚置。
* **👉 [BOOK_OF_REASONS.md](/docs/BOOK_OF_REASONS.md)**
  * *内容简述*：启元理据之书。集中记录了系统针对 Redis、SQLite、自我规划、分布式锁、有状态缓存等经典技术选型的“终极理据”（Why & Why Not），防范文明发生历史性遗忘。
* **👉 [CANON_OF_GOVERNANCE.md](/docs/CANON_OF_GOVERNANCE.md)**
  * *内容简述*：启元治理典章与终局遗产协议。规定了解释裁决优先序、例外豁免程序、失败博物馆规范、监督者轮值与退役制度，以及终局冷冻程序。
* **👉 [ANTI_PATTERNS.md](/docs/ANTI_PATTERNS.md)**
  * *内容简述*：启元工程反面模式防线。记录了 Executor 规划化、临时状态常驻化、安全业务级内聚等核心工程反面行径，作为保障系统纯洁性的“工程疫苗”。
* **👉 [CONSTITUTION_COMPLETE_SUMMARY.md](/docs/CONSTITUTION_COMPLETE_SUMMARY.md)**
  * *内容简述*：启元体系·“宪制完成”里程碑终结总结报告。高度提炼总结了系统经历的四大范式飞跃、五大治理反馈闭环、三大终极物理防线，标志着启元正式迈入架构冻结与观察时代。

### 📌 层级二：架构决策记录 (Architecture Decision Records)
*如果你需要追溯历史上的技术选型依据，知道“为什么这么做，为什么不那么做”以避免重复轮子与无意义技术讨论：*
* **👉 [ADR.md](/docs/ADR.md)**
  * *内容简述*：详细载明了基于 File-Queue 排队抢锁（ADR-001）、静态安全阻断黑白名单（ADR-002）与提交者身份声明白名单（ADR-003）的决策上下文与权衡利弊。

### 📌 层级三：契约约束与演进路线 (System Contracts & Evolution)
*如果你想知道各组件、各进程间通信的 API 字段、数据契约、以及 v1.1 阶段的升级规范：*
* **👉 [contracts.md](/docs/contracts.md)**
  * *内容简述*：定义了执行器内核与外部 SOP-036 安全标准、共享网盘目录、控制面板接口之间的强数据格式对齐承诺。
* **👉 [v1.1_strategic_evolution.md](/docs/v1.1_strategic_evolution.md)**
  * *内容简述*：QY-EXEC v1.1 阶段的核心技术演进蓝图。包含事件（Event）作为第一公民、工具元数据（Tool Manifest）、错误分层分类、UTC 时间对齐等具体设计方向。
* **👉 [task_schema.json](/task_schema.json)**
  * *内容简述*：系统底层唯一的强数据结构真理来源，规范任务文件在待处理、执行中与已完成后数据格式。

### 📌 层级四：代码预算与安全控制限制 (Architecture Budgets)
*如果你准备修改、编写代码，需要了解代码体量红线和代码复杂度审查标准：*
* **👉 [ARCHITECTURE_BUDGET.md](/docs/ARCHITECTURE_BUDGET.md)**
  * *内容简述*：规定了核心 Python/Node 文件最大 LOC 预算（LOC Budget）、复杂度预算红线（Complexity Budget），杜绝嵌套循环和高复杂度算法污染代码库。

### 📌 层级五：运维与优雅交接标准 (Onboarding & Succession Operations)
*如果你是第一天拿到本系统代码，想要让控制面与物理执行器无缝转起来，或在紧急状态下进行优雅熔断：*
* **👉 [SUCCESSOR_PROTOCOL.md](/docs/SUCCESSOR_PROTOCOL.md)**
  * *内容简述*：继承者移交协议。详细说明了系统的启停步骤、僵尸回收参数权衡决策、以及面临重大硬件异常时的熔断与保护程序。

---

## 3. 启元世代传承导航 (Ecosystem Generational Navigation)

启元体系的设计考虑了长达数年、跨越多个团队生命周期的连续演进。由于不同研发角色或不同世代看护人对系统的关切点存在物理差异，我们建立以下四代专属导航，帮助您快速切入：

```
                             ┌──────────────────────┐
                             │    启元世代看护人    │
                             └──────────┬───────────┘
                                        │
         ┌──────────────────┬───────────┴───────────┬──────────────────┐
         ▼                  ▼                       ▼                  ▼
  第一代: 创始人     第二代: 建设者          第三代: 运维人员     第四代: 承接者
    (Founder)          (Builder)               (Maintainer)        (Successor)
         │                  │                       │                  │
 🔍 探索全景与哲学   🔨 扩展与演进契约        🛠️ 保障物理可用性    📜 延续文明与基因
         │                  │                       │                  │
  - SYSTEM_MAP.md    - ADR.md                - SUCCESSOR.md     - INVARIANTS.md
  - Philosophy.md    - contracts.md          - EVIDENCE_MATRIX  - BOOK_OF_REASONS
  - 所有 Level 1-5   - task_schema.json      - BUDGET.md        - Philosophy.md
                                                                 - CANON_OF_GOVERNANCE.md
                                                                 - ANTI_PATTERNS.md
```

### 3.1 世代角色与导航说明
1. **第一代：创始人 (Founder)**：
   * *使命*：探索零到一的框架，建立初始的不变量与架构，定义文明基调。
   * *核心入口*：**[SYSTEM_MAP.md](/docs/SYSTEM_MAP.md)** (本图) 与 **[Philosophy.md](/docs/Philosophy.md)**，全面通读 Level 1 - 5 的全套规范，理解初始共识的全局全貌。
2. **第二代：建设者 (Builder)**：
   * *使命*：承接上级目标，扩展新的物理工具，重构并升级契约以适应更丰富的底层操作环境。
   * *核心入口*：**[ADR.md](/docs/ADR.md)**、**[contracts.md](/docs/contracts.md)** 与 **[task_schema.json](/task_schema.json)**。在修改任何接口前，必须先更新数据契约并对齐协议版本。
3. **第三代：运维与看护者 (Maintainer)**：
   * *使命*：保障系统 100% 在线，防止发生死锁，执行自动化漏洞阻断，解决在极端硬件断电后的环境恢复与清理。
   * *核心入口*：**[SUCCESSOR_PROTOCOL.md](/docs/SUCCESSOR_PROTOCOL.md)**、**[EVIDENCE_MATRIX.md](/docs/EVIDENCE_MATRIX.md)**、与 **[ARCHITECTURE_BUDGET.md](/docs/ARCHITECTURE_BUDGET.md)**。依证据矩阵每日对系统不变量状态进行客观测试，严格捍卫代码复杂度与 LOC 红线。
4. **第四代：文明承接者 (Successor)**：
   * *使命*：在创始人已离场、无历史上下文、面临外部大模型或开发语言全面换代的剧变时，确保“启元传统”不发生系统性失忆、不发生基因断代和治理分裂。
   * *核心入口*：**[INVARIANTS.md](/docs/INVARIANTS.md)**、**[BOOK_OF_REASONS.md](/docs/BOOK_OF_REASONS.md)**、**[Philosophy.md](/docs/Philosophy.md)**、**[CANON_OF_GOVERNANCE.md](/docs/CANON_OF_GOVERNANCE.md)** 与 **[ANTI_PATTERNS.md](/docs/ANTI_PATTERNS.md)**。承接者必须将 7 大不变量、理据之书、治理法典与反面模式防线视作系统的“物理定律、圣经、裁决天平与工程疫苗”，保证在物理重构或终局到来时，灵魂基因完好如初。

---

## 4. 创始人缺席测试验证标准 (Founder Absence Test & Autonomy Verification)

一个工程文明真正宣告成熟并建立的标志，是 **“创始人独立性 (Founder Independence)”** —— 当第一代作者完全离场、当历史对话上下文全部被截断时，新的看护人员或模型实例仅凭现有工程资产，依然能重构出高度一致的工程决策。

我们为此设立了系统最高级别的治理验证机制：**创始人缺席测试 (Founder Absence Test)**。

### 4.1 缺席测试断言清单 (The Assertions)
当一个新的系统维护者（人类或 AI）第一次接管 QY-EXEC 时，必须在没有任何口头解释的前提下，仅通读本规范库，在 **15分钟内** 准确回答以下 5 道灵魂理据题。回答的相符度直接证明了系统“创始人独立性”的健康评分。

1. **❓ 问 1**：为什么 Executor (QY-EXEC) **绝对不能** 引入任何大模型 SDK 并拥有自我分解任务的规划（Planning）能力？
   * *🎯 标准断言 (Assert)*：因为这会导致执行层与规划层的边界彻底崩塌。我们需要一个 100% 可预测、可还原的物理冷酷螺丝钉，不聪明、不推理、冷酷执行是不变量 1 的核心基石。
2. **❓ 问 2**：为什么我们不选择 Redis 或 RabbitMQ 作为我们的主调度排队中间件，即使它们看起来更“企业级”？
   * *🎯 标准断言 (Assert)*：因为我们要保障**零工具下的极致可观测性 (Zero-Tool Observability)** 与 **断网物理安全隔离性 (Air-gapped Physics)**。任何人仅需打开本地文件管理器查看 pending、running 目录，即可在 1 毫秒内了解队列状态。
3. **❓ 问 3**：为什么我们宁愿承受轻微的轮询开销，也坚决不引入 etcd、Consul 等分布式锁机制？
   * *🎯 标准断言 (Assert)*：为了践行“简单优于复杂”的价值观。操作系统对 `os.rename` 提供的原子性重命名机制是最天然的、强一致性排他物理锁，它以零外部运维依赖平替了数万行分布式锁的死锁风险。
4. **❓ 问 4**：当我们要为 QY-EXEC 新增一个涉及敏感权限的操作工具时，安全防御逻辑应该写在哪里？
   * *🎯 标准断言 (Assert)*：必须完全外置在统一的安全策略过滤器（Policy Filter Chain）中热解耦运行，绝对禁止写入具体物理工具的代码里，以此消灭安全死角、实现策略热升级。
5. **❓ 问 5**：什么是“共识证据矩阵”，为什么说“没有测试验证的不变量只是脆弱的愿望”？
   * *🎯 标准断言 (Assert)*：因为计算机只执行制度，不阅读文档。所有的不变量必须在系统中找到对应的回归测试验证与 API 级代码强制性物理隔离，形成“文档表达、测试验证、代码强制”的三位一体闭环（Green 状态）。

