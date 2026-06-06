# Think-is-power 架构演进规划

> 版本：v1 ｜ 日期：2026-06-06
> 依据：融合《ECC 架构重构说明书 V2.0》(交付质量轴) + 商业化规模化评审(规模化轴) + 现有代码实况核对
> 原则：**不破坏现有流程 · 对齐增强而非平行新建 · 小步可验证可回退 · 为水平扩展留接口**

---

## 0. 为什么要演进

平台定位已从「单人快速原型」升级为「给很多人运营的商业平台」。这带来**两条正交的能力轴**，缺一不可：

- **质量轴（纵向）**：单个项目交付得更可控、可验证、可审计 —— ECC 重构文档覆盖的就是这条。
- **规模化轴（横向）**：很多人同时用不崩、可计费、可隔离 —— ECC 文档完全没碰，但这是「商业运营」的前提。

本规划把两条轴合并成一条连贯路线。

---

## 1. 现状盘点（核对过代码，避免重复造轮子）

### 1.1 已有能力 —— 演进时应「对齐增强」，不要平行新建

| 能力 | 现有实现 | 位置 |
|---|---|---|
| 公共表达过滤 | `sanitize.service.ts`（BANNED_TERMS + sanitizePublicText，8 处调用）+ `Project.publicStatusLabel` | `src/services/sanitize.service.ts` |
| 多层验证 | sensors 体系：L1 静态 / L2 运行时 / L3 语义 + fusion + cross-validator + traceability + compile-validator + screenshot-comparator | `src/sensors/` |
| 任务模型 | `Task`：已有 type / dependencies / status / retryCount / maxRetries / inputPayload / resultPayload | `prisma/schema.prisma:120` |
| 经验模型 | `ErrorPattern` / `ErrorEvent` / `CaseReview` / `ExperienceRecommendation` / `DecisionRule` / `DecisionLog`（6 个，但多数未接成闭环） | `prisma/schema.prisma` |
| 执行器 | CloudecodeClient（Demo + 全栈降级路径）、CC Bridge、HermesClient | `src/integrations/` |

> ⚠️ ECC 文档建议「新增」的 `DeliveryTask` / `VerificationReport` / `PublicOutputSanitizer` / `ErrorPattern` / `ProjectExperience`，**大多在上表已存在等价物**。直接新建会让系统分裂成两套。本规划一律采用「扩展/激活现有」。

### 1.2 真增量 —— 现有系统确实没有，值得新建

| 能力 | 说明 |
|---|---|
| ExecutorRouter | 现在只有硬编码「分步生成失败→降级 cloudecode」，无按任务类型/风险/成本路由 |
| SecurityGate | 无 allowedFiles/forbiddenFiles 文件边界、无命令白名单 |
| 任务图 DAG | 现在是固定 4 步串行（Schema→Backend→Frontend→Integration），无依赖图/模块级并行/局部重试 |
| 双消息结构 | 有零散的 publicStatusLabel，但无系统化的 internalMessage/publicMessage 分离 |

### 1.3 规模化缺失 —— 商业运营的命门（ECC 文档全未覆盖）

| 缺失 | 证据 | 风险 |
|---|---|---|
| 持久化任务队列 | 无 BullMQ；长任务靠 in-process EventEmitter + setInterval 轮询 | 进程重启=任务丢；无法多副本 |
| 全局单例锁 | `SystemLock.id` 固定值保证全局唯一（`schema:386`） | 全平台同时只能跑 1 个自动迭代 |
| 跨实例事件 | EventEmitter2 进程内（12 文件）、SSE 手写存内存 | 多副本下事件/推送不互通 |
| 多租户 | 仅 User→Project，无 Organization/Membership | 无团队协作、无计费主体、越权风险 |
| 限流/AI 配额 | 无 ThrottlerModule | 成本失控、易被刷爆 |
| 数据库事务 | 全库 0 处 `$transaction` | 多步状态变更无原子性 |

---

## 2. 整体架构演进路线

> 核心判断：**别把「控制层」和「扩展地基」分两次做。** ECC 文档的 TaskRunner 与规模化需要的 BullMQ 是同一件事的两面 —— 让控制层直接建在持久化队列上，一举两得。

| 阶段 | 主题 | 做什么 | 与两份输入的关系 |
|---|---|---|---|
| **0** | 地基 | BullMQ 任务队列 + SystemLock 单例→per-project 分布式锁 | 补规模化轴；同时是 TaskRunner 的正确底座 |
| **1** | 控制层骨架 | delivery-control 模块；SecurityGate（真增量）；ExecutorRouter（真增量）；TaskRunner 建在 BullMQ 上；**扩展现有 Task** 而非新建 DeliveryTask | ECC P0 + 地基，合并 |
| **2** | 任务图 DAG | 固定 4 步 → Module Map → Task DAG，模块级并行/局部重试 | ECC P1，直接采纳 |
| **3** | 验证产品化 | 把**现有 sensors 结果**包装成统一报告 + 双消息 + 交付包扫描 | ECC P2，基于现有 sensors |
| **4** | 多租户 | Organization/Membership + tenant scope + AI 配额计量 | 补规模化轴，商业运营必经 |
| **5** | 经验闭环 | **激活对齐现有 6 个经验模型**，接进决策引擎 | ECC P3，对齐现有 |

每阶段均可独立交付、独立上线，不需要大爆炸式重写。

---

## 3. 分步执行计划（阶段 0–1 细化）

> 节奏：每步**小到可在一两次提交内完成 + 可独立验证 + 可回退**。先做不依赖运行态基础设施（Redis/DB/Docker）的纯逻辑增量，把骨架立住，再逐步接入。

### 阶段 1（先行，纯逻辑，零运行态依赖）

| 步骤 | 目标 | 涉及文件 | 验证 | 影响面/回退 |
|---|---|---|---|---|
| **S1.1** | delivery-control 模块骨架 + **SecurityGate 文件边界**（allowedFiles/forbiddenFiles glob 匹配）+ 单测 | `src/delivery-control/delivery-control.module.ts`、`security-gate.service.ts`、`security-gate.service.spec.ts` | 新单测通过 + build | 纯新增文件，不接主流程，删目录即回退 |
| **S1.2** | SecurityGate 命令白名单校验 + 单测 | 同上 service 扩展 | 单测 | 同上 |
| **S1.3** | ExecutorRouter（按任务类型/风险选执行器的纯规则函数）+ 单测 | `executor-router.service.ts` (+spec) | 单测 | 纯逻辑，不接现有执行器 |
| **S1.4** | 双消息结构类型 + PublicOutputSanitizer **对接现有 sanitize.service**（不新建） | `delivery-message.types.ts`、复用 `sanitize.service` | 单测 | 仅加类型与薄封装 |

### 阶段 0（地基，需运行态，待 Docker 迁移完成后做）

| 步骤 | 目标 | 验证 | 影响面/回退 |
|---|---|---|---|
| **S0.1** | 引入 BullMQ + QueueModule（连现有 Redis，env 配置，不接业务） | app 启动 + 队列连通 | 纯加法，移除 module 即回退 |
| **S0.2** | TaskRunner 建在 BullMQ 上，**包一个现有执行调用**试跑（老接口保持兼容） | 端到端跑通一次 | 灰度，老路径保留 |
| **S0.3** | SystemLock 单例 → per-project 分布式锁（Redlock 或 DB 行锁） | 并发两个项目互不阻塞 | 改并发控制，需回归测试，保留开关 |

> 阶段 1 排在阶段 0 之前先做，是因为它**不依赖 Redis/DB 运行态**（你正在迁移 Docker），可立即用单测验证、零风险立住控制层骨架。等 Docker 就位再做阶段 0 的地基接入。

### 后续阶段（2–5）

到阶段 1、0 落地、骨架稳固后，再逐阶段细化执行计划（避免过早规划易变的远期细节）。

---

## 4. 贯穿原则与风险控制

1. **不破坏现有**：每步要么纯新增、要么灰度接入并保留老路径；CI 必须保持绿（demo/n8n 那 1 个已知红除外）。
2. **对齐而非新建**：遇到「文档说要新增 X」先查现有等价物（见 §1.1），优先扩展。
3. **小步可验证**：每步有明确验证命令 + 通过标准；无法验证不算完成。
4. **为扩展留接口**：新增组件不得硬编码单实例假设（状态进 Redis/DB，不进进程内存）。
5. **回退就绪**：每步注明回退方式；骨架阶段以「删新增文件」即可回退。

---

## 5. 进度追踪

| 步骤 | 状态 | 提交 |
|---|---|---|
| S1.1 SecurityGate 文件边界 | ⬜ 进行中 | — |
| S1.2 命令白名单 | ⬜ | — |
| S1.3 ExecutorRouter | ⬜ | — |
| S1.4 双消息结构 | ⬜ | — |
| S0.1 BullMQ 脚手架 | ⬜ 待 Docker 就位 | — |
| S0.2 TaskRunner | ⬜ | — |
| S0.3 分布式锁 | ⬜ | — |
