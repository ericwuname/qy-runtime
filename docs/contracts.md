# QY-EXEC 系统间组件契约规范 (System Boundary Contracts)

本文件详尽定义了 QY-EXEC（执行器内核）与启元生态其他系统组件（AGENTS.md、SOP-036 安全标准、共享网盘文件目录、Web 前端控制台）之间的**强约束边界契约 (Strong Structural Contracts)**。
任何打破这些契约的修改均属于重大架构变更，必须遵循本文件末尾规定的变更管理流程。

---

## 1. 契约一：QY-EXEC ↔ AGENTS.md 行为加载契约

* **契约承诺**：
  1. QY-EXEC 在控制面启动、读取配置及生成系统提示词（System Instruction）时，必须自动探测并解析工作区根目录下的 `AGENTS.md` 及 `GEMINI.md` 文件。
  2. 若该文件存在，QY-EXEC 必须在模型上下文构建时，将用户在其中声明的“专属提示规范”或“持久化运作约束”完整、无感地拼入最终的 Model Prompt 中，使本地 Agent 的指令表现始终保持对定制规则的继承。
  3. 若 `AGENTS.md` 文件不存在，系统默认降级至配置中的 `defaultSystemInstruction` 兜底，绝不允许因为定制文件缺失而抛出 Panic 崩溃。
* **边界标准**：
  * 文件加载延迟：控制面加载启动时一并载入，单次读取开销不得超过 50ms。

---

## 2. 契约二：QY-EXEC ↔ SOP-036 文件安全性校验契约

* **契约承诺**：
  1. 在执行任何涉及本地文件写操作（如 `file_write`、`create_file`）的工具链逻辑时，物理执行器必须严格遵循 **SOP-036 (文件覆盖与路径逃逸安全规范)**：
     * 禁止向宿主机系统盘根目录、`Windows/System32`、`bin/`、`etc/` 等高敏感目录注入文件。
     * 所有读写操作必须被严格沙箱化（Sandboxed）在 `workspace/` 及 `bridges/` 特定目录下，实施 `path.resolve` 相对路径逃逸防御。
  2. 在对已存在的文件进行破坏性覆盖（Overwrite）时，必须确保：
     * 目标文件不属于系统核心运行态代码文件（如 `/server.ts`）。
     * 执行前必须对原文件执行轻量备份，或具备在操作失败时自动回滚的安全退出路线。

---

## 3. 契约三：QY-EXEC ↔ `task_schema.json` 强数据结构契约

* **契约承诺**：
  1. 在 `pending/`, `running/`, `completed/` 三个状态流转文件夹内流动的 JSON 事务文件，其核心结构必须 100% 保持与 `task_schema.json` 中的规范一致。
  2. **向前/向后兼容性保护**：
     为防止历史遗留的客户端或旧执行器解析挂起，QY-EXEC 郑重承诺即使在底层扩展了 `generation`, `retryCount`, `submitter` 等新型自救字段后，依然在数据接口中暴露老版本的平铺式备选字段：
     * `status`：对齐映射至 `executionStatus`
     * `result`：对齐映射至 `results.summary`
     * `title` & `prompt`：对齐映射至 `description.title` & `description.prompt`
  3. 任何解析器一旦遇到格式不规范的任务 JSON，必须立刻将其投档至 `logs/security.log` 审计，并安全归档，切不可导致死锁空转。

---

## 4. 契约四：QY-EXEC ↔ 外部多活控制中心提交特权契约

* **契约承诺**：
  1. QY-EXEC 将不属于系统白名单的恶意/未授权提交源完全堵截在控制边界外。
  2. 控制面 `POST /api/tasks` 端点在接受新任务注册时，必须核验 `submitter` 参数是否在 `allowedSubmitters` 白名单中。
  3. 白名单默认配置：`["ceo", "system", "qiyuan_n1", "claud_advisor"]`。
  4. 未经认证与签名的调用端一旦强行投递指令，系统必须返回 403 Forbidden，并在冷存储审计中留存其提交痕迹，绝不向物理执行器泄露未授权的指令输入。

---

## 5. 契约变更管理规程 (Change Management Process)

任何对上述系统间契约（Contract）的物理改动，或由此引起的 API 字段断裂、加载行为变动，必须履行以下安全规程：
1. **联合签发**：修改此契约需要 **CEO + 军师** 两人联合电子签章/书面确认批准。
2. **架构回测**：任何改动必须在多活适配沙箱内执行 `npm run lint` 和 `compile_applet` 全套打包构建测试。
3. **版本对齐**：契约更新时，必须同步提交对 `docs/architecture_design.md` 和 `docs/SUCCESSOR_PROTOCOL.md` 的增补修订，确保文档行为与代码严格契合。
