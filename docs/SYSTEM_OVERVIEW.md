# Think-is-power 系统说明（交接版）

> 用途：把项目全貌带到新对话窗口讨论下一步规划，自包含。
> 日期：2026-06-06 ｜ 基于实际代码核对，非臆测。

---

## 1. 定位

**Think-is-power（思想动力）**：面向**非专业技术人员**的 AI 软件生成与交付平台。

- **对用户的承诺**：用自然语言说想法 → 平台帮你逐步确认需求、生成预览、自动开发、自动检查、部署上线，并交付可带走的源码和说明。
- **内部实现**：需求规格化 + 任务拆解 + 多执行器调度 + 自动验证 + 安全过滤 + 经验沉淀，建模为一个**工程控制论闭环**（持续澄清→生成→评估→修复至达标→交付）。
- **铁律产品原则**：**所有用户可见界面只能出现普通人能懂的表达**。内部词（Agent/Docker/Prisma/JWT/SSE/工程控制论/传感器/Cloudecode/Claude Code 等）禁止泄露到 UI、错误提示、交付说明里——内部可用，对外必须翻译。

---

## 2. 架构

### 服务拓扑（docker-compose，7 服务）

```
前端 Next.js 14 (3003) ──→ API NestJS 11 (3001) ──→ PostgreSQL 16 (5433→5432)
                                  │                   Redis 7 (6379)
                                  ├──→ Cloudecode (5000)   Demo 快速生成引擎
                                  └──→ CC Bridge (5001)    全栈交付流水线 + SSE
                                       MinIO (9000/9001)   对象存储
```

### 技术栈

- **后端**：NestJS 11、TypeScript、Prisma 6、Passport-JWT、Socket.io、@nestjs/event-emitter、cheerio、archiver、MinIO SDK
- **前端**：Next.js 14 (App Router) + React 18 + Tailwind 3、Playwright E2E
- **AI**：DeepSeek（主，当前配 `deepseek-reasoner`）、Qwen（交叉验证）
- **基础设施**：PostgreSQL 16、Redis 7、MinIO、Docker Compose、GitHub Actions
- **代码托管**：Gitee（主仓 `gitee.com/quich_1_0/ideological-motivation`）+ GitHub（`coolairs-ops/thinkispower`，跑 CI）

### 工程控制论角色映射（项目最大亮点）

| 控制论角色 | 组件 | 位置 |
|---|---|---|
| 控制器 | HermesClient / ProductDiscovery | `integrations/hermes`、`modules/product-discovery` |
| 执行器 | PipelineService / CloudecodeClient / CC Bridge | `integrations/pipeline`、`integrations/cloudecode`、`internal/cc-bridge` |
| 传感器 | L1 静态 / L2 运行时 / L3 语义 + SensorFusion + CrossValidator(Qwen) + Traceability | `sensors/` |
| 反馈信道 | EventEmitter2（进程内）+ SSE（手写） | NestJS |

三级传感器加权融合 + Qwen 交叉验证，自动评估生成质量、修复至评分达标。

---

## 3. 核心功能闭环

### 用户视角流程

```
描述想法 → 补充关键信息 → 确认功能与页面(规格) → 查看预览Demo → 批注反馈
   → 提交生成 → 系统自动开发 → 自动检查 → 上线访问 → 下载源码与说明
```

### 内部项目状态机（Project.status）

```
needs_input → prd_ready / plan_ready → spec_confirmed
   → demo_generating → demo_ready → awaiting_demo_feedback
   → developing → completed
   （异常：demo_failed）
```

### 关键能力模块（apps/api/src）

- `modules/`：product-discovery（需求访谈）、specification（规格确认）、demo（预览生成+批注）、feedback（批注反馈）、delivery（交付评估）、deployment / task / demo-snapshot（版本快照）等
- `sensors/`：三级传感器评估体系
- `integrations/`：hermes（控制器）/ cloudecode / pipeline / cc-bridge 适配
- `services/`：sanitize（公共表达脱敏，@Global）、deepseek、qwen-reviewer、quality-gate、status-mapper、build、deploy-pipeline 等

---

## 4. 数据模型（19 个 Prisma model，关键实体）

- **User**（含 role、plan free/pro/enterprise、refreshToken）→ **Project**（仅 userId 关联，**无组织层**）
- **Project**：status / publicStatusLabel / structuredRequirement / planSummary / moduleMap / **demoHtml**(整页存DB) / demoUrl / productionUrl 等
- **Specification**（规格冻结：targetUsers/coreFunctions/pages/roles/dataModels/acceptanceScenarios + 版本/changeLog）
- **Task**（已具备 type/dependencies/status/retryCount/maxRetries/inputPayload/resultPayload）、**Module**、**FeedbackItem**、**DemoSnapshot**、**Build**、**Deployment**、**TestDeployment**
- **经验体系（已建模、多数未接成闭环）**：ErrorPattern / ErrorEvent / CaseReview / ExperienceRecommendation / DecisionRule / DecisionLog
- **SystemLock**（`id` 固定值的全局单例锁）

---

## 5. 当前状态（本会话已完成 / 进行中）

### 已完成
- **CI 护栏接通**：修分支名(main→master)、加 GitHub 远程让 GitHub Actions 生效、swagger 7→11 适配 NestJS 11、接入 eslint 工具链
- **测试**：364 个单测，**363 通过**（唯一红是 demo 的 n8n webhook 用例，**有意保留**——n8n 链路将来要继续用）
- **安全**：清理了误入 git 的 Qwen API Key（已实测吊销 401、新 key 200）
- **架构演进 — 阶段 1（交付控制层骨架）完成**：新增 `delivery-control` 模块，含 `SecurityGate`（文件边界+命令白名单）、`ExecutorRouter`（按任务类型/风险选执行器）、`DeliveryMessage`（internal/public 双消息，对接现有 sanitize）；41 单测，纯逻辑、**尚未接入主流程**

### 进行中
- **Demo 生成故障修复**：某项目 demo 卡在 `demo_generating` 无法显示。根因＝demo 生成是 fire-and-forget 内存异步，进程重启即丢失 + maxTokens 8192 截断 HTML。已改：maxTokens→32768、extractHtml 剥围栏、getDemo 加超时自愈；正在 rebuild api 容器验证。

---

## 6. 已知技术债 / 下一步规划输入

### 规模化（商业平台「很多人运营」的命门，均待补）
- **无多租户**：仅 User→Project，缺 Organization/Membership/计费主体/配额
- **无法水平扩展**：SystemLock 全局单例（全平台同时只能跑 1 个自动迭代）、EventEmitter2 进程内、SSE 手写存内存、**无持久化队列(BullMQ)**、fire-and-forget 异步（demo 卡死就是此问题）
- **无限流 / 无 AI 配额**（DeepSeek/Qwen 调用是真金白银）
- **0 处数据库事务**（多步状态变更无原子性）

### 数据 / 安全
- 大 HTML 直接存 DB（应转 MinIO）；status/role/plan 全 String 无 enum 约束；TestDeployment.adminPass 明文
- sanitize 的禁用词表缺 Docker/tsc/Prisma/JWT/SSE 等英文技术词

### 链路
- n8n 链路残留且状态不明（用户表示将来继续用）；demo/交付生成链路对外部依赖+进程存活的可靠性不足

### 演进路线（详见 `docs/architecture/EVOLUTION_PLAN.md`）
融合「ECC 交付控制层重构」+「商业化规模化评审」，分 6 阶段：
0. 地基（BullMQ + 分布式锁）→ 1. 控制层骨架(✅已完成) → 2. 任务图 DAG → 3. 验证产品化(基于现有 sensors) → 4. 多租户 → 5. 经验闭环。
核心原则：**对齐增强现有的（别重复造）+ 补规模化缺失 + 控制层直接建在可扩展地基上**。

---

## 7. 相关文档索引

- `docs/architecture/EVOLUTION_PLAN.md` — 分阶段架构演进规划 + 分步执行计划
- `PROJECT_ANALYSIS.md` — 项目问题/风险分析（已核实修正）
- `apps/api/prisma/schema.prisma` — 完整数据模型
- ECC 重构说明书（外部）— 交付控制层重构蓝图
