# 执行计划 · 修订版（P0–P15 Rev）

> 基于 `EXECUTION_PLAN_P0_P15.md` 的修订。日期：2026-06-06。
> 三大立身之本作为主轴：**私有化/数据不出域 · Axure+蓝湖工作流 · 可验收/可追溯**。
> 产品规格（Specification）= 验收标准，是本计划的核心交付物。

---

## 0. 修订说明

### 0.1 与已完成工作对齐（不要重做）

| 原计划项 | 现状 | 处置 |
|---|---|---|
| **P0-1 BullMQ** | ✅ 已完成（S0.1，QueueModule 已接 app.module、redis 连接验证通过，提交 `3abf0ba`） | 标记完成，P0-4/P15-3 直接复用 |
| **P1-0 delivery-control 接线** | 骨架已完成（SecurityGate/ExecutorRouter/DeliveryMessage，41 单测，提交 41a6904→fd0cc10） | 只剩接线 |
| demo maxTokens 截断 / 闸门死锁 / 超时自愈 | ✅ 已修（`72fd039` 等） | P0-4 只剩"迁 BullMQ 持久化"这一步根治 |
| 终态保护 A/B | ✅ 新增已完成（`isProjectLocked`，confirmPlan/doGenerate 防回退） | 升级为贯穿项，见 §1.3 与 §4 |

### 0.2 相对原计划的三类改动

1. **定位翻转**：原计划 P0-5「云上运营、tusd 直写公有云 OSS」→ 改为 **私有化优先、数据域内**（§1.1）。这是立身之本，不是可选项。
2. **入口与证据模型重构**：原「双卡片二选一」→ **统一入口 + 多源证据**，`description` 也是证据之一（§2）。
3. **溯源贯穿 + 产品规格强化**：新增 provenance 溯源链，Specification 作为可验收基线（§1.3、§3）。

---

## 1. 三大立身之本（贯穿设计）

### 1.1 立身之本 ①：私有化 / 数据不出域（自持算力 + 对互联网多租户）

**部署形态（已定）**：运营方**自持算力平台**（自有 GPU + 数据 + 模型），整套系统私有化部署其上，**对互联网开放多租户服务**。

**「数据不出域」在此形态下的含义**：终端用户的数据与 AI 推理**全程在运营方自有算力平台内闭环，不流向任何第三方**（不调 DeepSeek/Qwen 公有 API、不依赖公有云存储）。对终端用户（尤其有数据顾虑的企业/政企）这是强信任背书；对运营方，因算力自持，**模型能力不必妥协**——这消解了「私有化 vs 用好模型」的张力。

**连带刚需**：对互联网开放 = 一套**多租户 SaaS**，见 §1.4。任何把数据送出运营方算力平台的链路，必须默认关闭、可审计。

**数据出域的三个风险点与对策**：

| 风险点 | 现状 | 私有化对策 |
|---|---|---|
| ① 文件存储 | 原计划 tusd S3 store 直写**公有云 OSS** | tusd S3 store 的 endpoint 指向**客户域内** MinIO/私有 OSS；S3 抽象层（AWS S3 v3 SDK）只换 endpoint 即可。公有云仅作为可选部署目标 |
| ② **LLM 调用（最大风险）** | DeepSeek/Qwen 走公有 API（`api.deepseek.com` / `dashscope`）。专业资料含商业机密，喂公有 LLM = 出域 | 新增 **LLM 网关层**：所有 AI 调用统一走可配置端点（`*_BASE_URL` 已可配）。私有化模式指向**域内 OpenAI 兼容模型**（vLLM / Ollama + DeepSeek/Qwen 开源权重）。配 `AI_MODE=local\|cloud`，local 模式禁止任何外呼 LLM |
| ③ 生成产物 | 代码/源码包/部署 | 全部落域内对象存储与域内容器，不外传 |

**新增任务 P0-7「LLM 网关 + 数据流向审计」**（见 §4）。

**部署形态**：全栈已 docker-compose 化，私有化即「客户内网一键 compose 部署 + 域内模型 + 域内存储」。需产出**私有化部署清单**：哪些服务、哪些数据卷、哪些端口、域内模型最低配置（GPU/显存）、离线安装方式。

**验收口径（私有化）**：`AI_MODE=local` 下，全链路抓包/审计证明**无任何客户数据外呼**（LLM、存储、遥测均域内）。

### 1.2 立身之本 ②：Axure + 蓝湖工作流

**原则**：PM 的真实交付物就是 Axure 原型 + 蓝湖设计稿。把这条工作流做深做顺，是赢得 PM 群体的关键差异化。

**Axure 链路（深化 P15-5）**：
- **三件套同传**：`.rp`（工程文件，归档不解析）+ **HTML 导出包**（一级可解析数据源）+ 截图兜底。
- HTML 包解析：cheerio 读 `data/document.js` 的 `$axure.document.sitemap.rootNodes` → **页面树 / 路径 / 跳转关系 / 默认态交互**。
- 截图兜底：HTML 包缺失时 Playwright 加载 `resources/` 运行时、等 `networkidle`、只截默认态，并**明确提示精度下降**。
- **页面级溯源（新增）**：解析出的每个 PrototypePage / PrototypeFlow 记录 `sourceRef`（来自哪个原型包、哪个 sitemap 节点），为 §1.3 溯源链打底。

**蓝湖链路（深化 P15-6）**：
- 第一阶段：链接登记 + 截图/资源包上传 + 标注/切图登记 → DesignReference，**关联到页面清单**。
- 不依赖蓝湖开放接口（后续可接）。

**三源交叉（PM 核心价值）**：PRD ↔ Axure 原型 ↔ 蓝湖设计稿三者**一致性校验**（P15-7 冲突检测）——「PRD 写了导出功能但原型没有这个按钮」这类差异主动标出。这是 PM 最想要的"别让我自己对"。

### 1.3 立身之本 ③：可验收 / 可追溯（产品规格 = 验收标准）

**原则**：从「导入资料 → 需求理解 → 产品规格 → 生成 → 交付」每一步**可追溯到来源**，验收标准**可溯源、可核对、可审计**。产品规格（Specification）是这条链的验收基线。

**溯源链（provenance）—— 贯穿数据模型**：
```
来源资料(PRD章节/原型页面/设计稿/用户描述)
   → 需求理解条目(RequirementUnderstanding，带 sourceRefs[])
      → 产品规格条目(Specification.coreFunctions/pages/acceptanceScenarios，带 provenance)
         → 生成产物(Build/Demo，带 specVersion)
            → 验收检查(sensors L1/L2/L3 结果，带 scenarioRef)
```
每个功能 / 页面 / 验收场景都能回答「这是从哪份资料来的、对应哪个产物、检查通过没有」。

**落地（复用现有基础）**：
- **验收标准载体**：`Specification.acceptanceScenarios = [{name, given, when, then, priority}]`（已是 Given-When-Then 结构，天然可验收）。强化：每条场景加 `provenance`（来源）+ `coverage`（对应功能/页面）+ `verification`（对应检查结果）。
- **可追溯基础**：`Specification.version` + `frozenAt` + `changeLog`（变更可溯）；`DemoSnapshot`（版本快照）；`DecisionLog`（决策日志）；sensors（评估=验收证据）。把这些串成一条链。
- **验收报告（新增产出）**：交付时生成「验收报告」——逐条验收场景 → 来源 → 实现 → 检查结果（通过/未通过/待人工确认），可审计、可导出。呼应 ECC 的 VerificationReport，但**加上溯源**。
- **人在回路 + 冻结基线**：PM 确认/修正规格后 `frozenAt` 冻结为验收基线；后续变更走 `changeLog`，验收按冻结版本核对。

**新增贯穿要求 P15-Y「溯源与验收报告」**（见 §4）。

### 1.4 部署形态与多租户（「对互联网服务」的连带需求）

「自持算力私有化 + 对互联网服务」= 一套**多租户 SaaS**。这把架构评审里的规模化项从「以后」变成「现在必须」：

| 能力 | 为什么现在必须 | 现状 / 落点 |
|---|---|---|
| **多租户隔离** | 公网多团队/多企业开放，数据必须按租户隔离、防越权 | 现仅 User→Project；需加 Organization/Membership + 租户作用域（统一仓储层或 Postgres RLS 兜底） |
| **AI 配额 / 限流** | GPU 算力有限，按租户/套餐限额；防公网滥用 | `plan` 字段（free/pro/enterprise）已有，需接配额计量 + ThrottlerModule |
| **水平扩展** | 公网负载需多副本 | BullMQ（✅ P0-1）+ 分布式锁（P0-2）+ 跨实例事件（Redis pub/sub 替 in-process EventEmitter）+ 手写 SSE 改 Redis 广播 |
| **用量计量 / 计费** | 按用量（尤其 AI/GPU 时长）计费 | 新增计量层 |
| **可观测性** | 公网运营需监控/告警/追踪 | 新增（结构化日志 + OpenTelemetry） |

**新增 Phase 2「多租户与对外运营」**（架构评审阶段 4 提前为刚需）：Organization/Membership + 租户作用域 + AI 配额 + 限流 + 用量计量 + 可观测性。建议**在 Phase 0 地基之后、与 Phase 1.5 并行**推进——导入功能本身也必须在多租户作用域内隔离（一个租户看不到另一个租户的 PRD/原型）。

> **AI 层定位明确**：LLM 网关（P0-7）的「local 模式」即指向**运营方算力平台的域内模型集群**（vLLM/Ollama + DeepSeek/Qwen 权重）；公有 API 仅作可选 fallback，私有化运营下默认禁用。

---

## 2. 群体与入口（整合）

### 2.1 目标群体（按资料丰富度光谱）

| 群体 | 手头资料 | 价值 |
|---|---|---|
| 产品经理 | PRD + Axure + 蓝湖 | 专业产出物直接变软件，跳过开发排期 |
| 外包 / 数字化服务商 | 甲方文档 + 原型 | 交付提效 |
| 企业信息化部门 | 历史系统文档、老系统截图 | 复用历史资产做重构 |
| **业务专家 / 中小企业主**（原计划低估） | Excel、流程图、表单截图、老系统链接 | 零散材料变软件 |
| 政企 / 央国企 | 规范文档、业务规程 | 合规材料驱动建设，且**天然要求私有化**（呼应 §1.1） |

### 2.2 入口重构：统一入口 + 多源证据（替换原「双卡片二选一」）

- **入口统一**：不是「描述想法 vs 导入资料」二选一，而是「**描述想法 + 可选附加任何已有资料**」。资料越多，理解越准。
- **架构统一**：`description` 视为**一种证据源**，与 PRD/原型/设计稿/截图**并列**喂给需求理解引擎——复用平台已有的 sensors 多源融合思想。不是两条链路，是「一个需求理解引擎 + N 种证据」。
- **轻分诊**：开场问「你手头现在有什么？」（什么都没有 / 零散材料 / 完整文档或原型），动态展开引导，并为后端解析器选择提供信号。

### 2.3 MVP 收敛（别三线齐开）

首发 **document-parser 先行**（覆盖最广、ROI 最高，含 Excel/截图 OCR 考量）+ Axure 原型解析（立身之本②）验证闭环；蓝湖第一阶段只登记不解析，最轻、可最后。

---

## 3. 产品规格 Specification = 验收标准（核心章节）

> 用户明确：**产品规格这里是验收标准**。本章是计划的核心。

### 3.1 定位

Specification 是「导入路径」与「描述路径」的**唯一汇合点**（沿用原 P15-8：不新建并行链路，汇入现有 `spec_confirmed`）。它既是开发的输入，也是**验收的基线**。

### 3.2 草稿规格的物化（带溯源）

需求理解结果（RequirementUnderstanding）经 PM 确认后，物化为草稿 Specification：

| Specification 字段 | 来源 | 溯源要求 |
|---|---|---|
| `targetUsers` | 需求理解的角色识别 | 记录来自哪份资料 |
| `coreFunctions [{name, description, priority}]` | 功能候选（PRD + 原型交叉） | 每个功能带 `provenance`（PRD 章节 / 原型页面） |
| `pages [{name, route, description}]` | Axure 页面树（P15-5） | 每页关联 PrototypePage.sourceRef |
| `roles / dataModels` | 文档解析 + 理解 | 带来源 |
| **`acceptanceScenarios [{name, given, when, then, priority, provenance, coverage}]`** | **验收标准核心** | 每条场景：来源 + 覆盖的功能/页面 |

### 3.3 验收闭环（可验收）

```
Specification 冻结(frozenAt) = 验收基线
   → 生成(Build 带 specVersion)
      → sensors 评估(L1 编译 / L2 运行 / L3 语义) 逐场景核对 acceptanceScenarios
         → 验收报告：每条场景 [来源 → 实现 → 检查结果]
            → 通过率达标 → 交付；未通过 → 自愈/迭代，变更走 changeLog
```

### 3.4 验收标准的可审计性（政企/私有化刚需）

- 验收报告可导出（PDF/结构化），每条结论可回溯到**原始资料证据**。
- 规格变更全程 `changeLog` 留痕（谁、何时、改了什么、为什么）。
- 这与 §1.1 私有化、§1.3 溯源共同构成「可信交付」——对政企/央国企是采购门槛。

---

## 4. 修订后的任务包（增量 + 新增）

> 未列出的任务包沿用原 `EXECUTION_PLAN_P0_P15.md`。以下为**改动项**与**新增项**。

### P0-5（修订）　tusd 上传服务 → **域内对象存储**

- 改动：S3 store endpoint **默认指向域内 MinIO/私有 OSS**；公有云 OSS 降为可选部署目标。
- 新增验收：私有化模式下，上传字节全程域内，不经任何公网。
- 其余（tusd hook、tus-js-client、续传）不变。

### P0-7（新增）　LLM 网关 + 数据流向审计

```json
{
  "goal": "建立统一 LLM 网关层，所有 AI 调用走可配置端点；新增 AI_MODE=local|cloud 开关，local 模式禁止任何 LLM 外呼，指向域内 OpenAI 兼容模型。附数据流向审计。",
  "inputContext": "现 deepseek/qwen 的 BASE_URL 已可配且走标准 /chat/completions，私有化基础具备。需收敛为统一网关 + 模式开关 + 审计。",
  "allowedFiles": ["apps/api/src/integrations/llm/**", "apps/api/src/services/deepseek*", "apps/api/src/sensors/qwen-client*", "docker-compose.yml"],
  "forbiddenFiles": [".env", "node_modules/**", "dist/**"],
  "verificationCommands": ["npm run build", "npm run test"],
  "expectedOutput": "统一 LlmGateway；AI_MODE=local 时所有调用指向域内端点、外呼被硬阻断并告警；提供数据流向清单（哪些流出域、私有化下全部域内）；含一个 local 模式外呼拦截测试。"
}
```

### P15-1（修订）　数据模型 — 加溯源字段

- 在原 11 个 model 基础上，所有"理解/规格"条目增加 `provenance / sourceRefs`；PrototypePage/PrototypeFlow 加 `sourceRef`；RequirementUnderstanding 条目带 `sourceRefs[]`。
- AssetFile 增加 `domainResident: boolean`（标记是否域内，支撑 §1.1 审计）。

### P15-5 / P15-6（修订）　Axure + 蓝湖工作流深化

- 按 §1.2 落地：三件套同传、页面级 sourceRef 溯源、三源一致性校验入 P15-7。

### P15-7（修订）　需求理解 — 多源证据 + 溯源 + 冲突

- `description` 纳入证据源，与 PRD/原型/设计稿统一输入。
- 每个理解条目带 `sourceRefs`；置信度门控 + PRD↔原型↔设计稿三源冲突清单。
- 摘要走 **LLM 网关**（§1.1），私有化下用域内模型。

### P15-8（修订）　草稿规格 — 带溯源的验收基线

- 按 §3 物化：每条 coreFunction/page/acceptanceScenario 带 provenance；确认后 `frozenAt` 冻结为验收基线。

### P15-9（修订）　入口 — 统一入口 + 多源证据 + 轻分诊

- 替换"双卡片二选一"为 §2.2 方案；上传页引导三件套（.rp + HTML 包 + 蓝湖）。

### P15-Y（新增）　溯源与验收报告

```json
{
  "goal": "实现端到端溯源链与验收报告：每个功能/页面/验收场景可回溯来源、关联产物与检查结果；交付时产出可导出、可审计的验收报告。",
  "inputContext": "复用 Specification.acceptanceScenarios(Given-When-Then) + changeLog + DemoSnapshot + sensors 结果。",
  "allowedFiles": ["apps/api/src/modules/specification/**", "apps/api/src/modules/delivery/**", "apps/api/src/requirement-understanding/**"],
  "forbiddenFiles": [".env", "node_modules/**", "dist/**"],
  "verificationCommands": ["npm run build", "npm run test"],
  "expectedOutput": "验收报告：逐条 acceptanceScenario → 来源 → 实现 → 检查结果(通过/未通过/待人工)；可导出；规格变更 changeLog 留痕；通过率门控接入交付。"
}
```

### 终态保护（已完成，升为贯穿项）

`isProjectLocked` 已落地（confirmPlan/doGenerate）。延伸：**产物复用**——已生成/已交付/已导入的产物直接复用展示，不反复触发 AI 重做（与本计划"导入即证据、不重复生产"一致）。

### Phase 2（新增）　多租户与对外运营

> 与 Phase 1.5 并行；导入功能必须在多租户作用域内隔离（一个租户看不到另一个租户的 PRD/原型）。

- **P2-1 多租户模型**：Organization/Membership；Project 归属 org。
  - ✅ **2-1a/b 已完成**：数据模型 + 现有数据回填（每用户 personal org + owner membership，提交 `1b0e0d2`）
  - ✅ **2-1c-1 已完成**：tenant-scope helper（assertOrgAccess/orgScope）+ JWT 注入 orgId（`8c84227`）
  - ✅ **2-1d-0 已完成**：注册建 org + 建项目设 orgId（`1dc1ff0`）
  - ⏸ **2-1d 剩余（29 处 userId!== → org 作用域）暂缓**：当前每用户独占 personal org，userId 检查 == org 检查、已正确隔离、无越权漏洞；此改造是**团队协作（多人共享 org）前瞻**，待真有该场景再扫（分 4 批：project+feedback / plan+message / specification+delivery / test-deployment+余下）
  - ⏸ **2-1c-2 RLS 暂缓**：后台任务密集，FORCE RLS 风险高，需先理清后台 org 上下文 + bypass 角色后审慎引入
- **P2-2 租户作用域**：见上（应用层主防线已就位；RLS 兜底暂缓）。
- **P2-3 AI 配额 + 限流**：按租户/套餐（`plan`）的 AI 用量配额（GPU 时长 / token）+ ThrottlerModule 公网限流。
- **P2-4 用量计量**：记录每租户 AI/存储/生成用量，为配额与计费提供数据。
- **P2-5 跨实例化**：in-process EventEmitter → Redis pub/sub；手写 SSE → Redis 广播；与 P0-2 分布式锁配套，支撑 API 多副本水平扩展。

---

## 5. 验收里程碑（更新）

- **Phase 0 完成**：自动迭代不受 SystemLock 单例限制；任务进程重启不丢；demo 不卡死；大文件可续传**直传域内存储**；demoHtml 不在 DB；**`AI_MODE=local` 下全链路无数据外呼**。
- **Phase 1.5 完成**：可上传 .rp/HTML 包/PRD/蓝湖资料；解析出页面清单与跳转**并带来源溯源**；生成需求理解（多源证据 + 三源冲突），经确认产出**带溯源的草稿 Specification** 并冻结为验收基线，接入现有 `spec_confirmed`；交付产出**可审计的验收报告**；新界面无内部词。
- **Phase 2 完成（对外运营）**：多租户隔离生效（A 租户看不到 B 租户资料）；AI 调用按租户配额限额、公网限流生效；事件/SSE 跨实例可用，API 可多副本水平扩展。
- **立身之本验收**：① 私有化模式实测**零外呼**（AI 推理在运营方算力平台域内）；② Axure 三件套→页面树/跳转/设计参考全打通；③ 任一交付物可逐条回溯到来源资料与检查结果。
