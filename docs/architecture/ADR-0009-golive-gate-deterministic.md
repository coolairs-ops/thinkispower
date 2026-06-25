# ADR-0009: 上线门 —— 确定性二值闸，焊死在"可运行"维度（验收真证据 / L2运行时 / 契约一致 / 部署健康）

**Status:** Proposed（2026-06-25；由"评分卡 71"排查反向暴露上线门是空的；逐环节审计又查实现有"运行时"检查有空跑/测错对象。本 ADR 焊死真闸——并明令"先修空跑、别把空跑升级成门"）
**Date:** 2026-06-25
**Deciders:** 平台负责人
**关联:** 落实 [ADR-0002] 原则①（完整闭环）"hard enforcement 靠确定性门不靠提示词"；把 [ADR-0005] 传感器/迭代信号（融合分 L1×.3+L2×.3+L3×.4）**明确踢出上线判据**、只留作迭代进度表；接 [ADR-0007] 契约一致门进交付；与 [ADR-0008] D5 验收分桶配合（self判HTML/backend认置备/external受控）。触发：2026-06-25 排查 demo 综合分卡 71 时，用户追问"通过验收的程序能否真实上线、真正运行；不能为评分通过而突破门和工程控制论"。

---

## Context（为什么现在定）

排查"评分卡 71"时查实**当前上线门是空的**——"通过验收"并不保证"能跑"：

- **唯一硬门是验收 passRate**：`productionDeliver` 入口卡 `acceptance.gate`（passRate ≥ 0.8，默认）。而验收场景是 **LLM 对照 demo HTML 判**（ADR-0008 已让其按 provenance 分桶、更准，但本质仍是"对预览页的语义判定"，不是"真后端跑起来了"）。
- **L2 运行时跑了但不拦**：`runProductionDelivery` 里 `verifyAndFixCompilation` 算出 `compilationPassed`、`generateAndRunSmokeTests` 算出 `smokeResult.passed`——**只打日志**（`[编译验证] ✅/❌`、`[冒烟测试] ✅/⚠️`），不阻断。Build 记录**永远** `status:'success'`。
- **契约一致不进交付门**：`checkContractConformance(html, contract)`（ADR-0007）只在**迭代回路**用，交付时不查——交付产物可能调后端不存在的资源仍放行。
- **部署健康被降级掩盖**：部署 health check 不 healthy → `deployStatus='deploy_failed'`，但随后 `if(!productionUrl)` **降级为 API 静态托管**，项目**照样置 `status:'completed'`** 并给出"上线 URL"。
- **融合分（L1/L3 静态）本就不在门里**，但它是"项目评估"那个显眼的数——有被误当成"可交付/可上线"判据的风险（卡 71 之争正源于此）。

**病灶一句话**：上线闸测的是"demo 像不像做好了"（验收 LLM + 静态分），而**不是"交付的全栈程序编译过没、跑得起没、调的是真后端没、部署健康没"**。一个 demo 验收过关的程序，可以编译不过、冒烟挂、部署不健康，却被标"已上线"。这违背工程控制论——**闸门必须测真正想控制的量**（可运行），否则是开环。

**更要命的（2026-06-25 控制论逐环节审计）：现有"看起来在跑"的检查里有空跑 / 测错对象——若不察觉就把它们 log→gate，等于把空跑升级成门、更糟。** 实测：
- **冒烟测试是空跑**：`generateAndRunSmokeTests` 真生成真执行 `node smoke.test.js`，但打的是 `localhost:3000`——而**交付后端此刻根本没起**（产物只是生成的文件、冒烟跑在 deploy 之前）→ 恒"服务可能未启动"、log 忽略。等于没测。
- **L2 运行时测错对象**：`L2RuntimeSensor.checkDatabaseHealth` 真 `$queryRaw SELECT 1`，但查的是**平台自己的 DB(5433)**、不是交付程序的后端 → 恒 ~85（平台一直在跑），冒充"这程序运行时健康"。真正探活交付后端的 `backend-smoke` **不进 L2 融合分**（fuse 取本层首个 report = 平台那个）、只进建议。
- **真编译/真探活做了但被忽略**：`verifyAndFixCompilation` 真 `npx tsc` 编译交付代码、`backend-smoke` 真探活若依后端——但前者 log-only、后者不进分。
- **delivery-control（调速器/越界门/路由）是空骨架**：`security-gate.service` 源码自陈"尚未接入主交付流程（骨架阶段）"，只在 `pipeline.service` 侧路径调，主交付 `productionDeliver` 不经它。

---

## Decision（六条）

把"可上线（completed）"从"一个软门（验收 passRate）"换成**四个真维度的确定性二值合取门（AND 全过才放行）**。每门 pass/fail 二值、可解释、零模糊。呼应"90→100"裁定：不在融合分上追满分，换**确定性二值门、每桶各自达标**。

### D1｜验收真证据（保留 + 硬化）
验收 passRate ≥ 阈值仍是门。但"真证据"硬化：**must 场景的 pass 需运行时/数据证据**，不止 LLM 看 demo——
- `self` 场景：保留 HTML 语义判定（ADR-0008 D2/D5）。
- `backend` 场景：认后端置备 + 探活（不是 HTML）。
- 关键 must 场景：可要求**冒烟测试命中对应端点**或人工确认作为硬证据。
- `external`/`deferred`：D5 受控放行，不阻断、显式标"待对接"。

### D2｜L2 运行时（log → gate）——**先把空跑修成真验证，再升成门**
把已经在跑、只打日志的两步升级成硬门——但**前提是它们测的是真的**（否则把空跑升级成门更糟）：
- **编译**（已是真验证）：`compilationPassed===false` → 项目置 `build_failed`，**不置 completed**、不产出"上线 URL"。这步本就真 `npx tsc`，直接 log→gate 即可。
- **冒烟**（先修空跑再升门）：现在打没起的后端 = 空跑。**升门前必须：冒烟前真把交付后端起起来**（起容器/起进程）→ 再打它的真端点 → 测出的 pass/fail 才作数。修好后 `smoke_failed` 不过 → 不置 completed。**绝不把"恒服务未启动"那种空跑直接当门。**
- Build 记录的 `status` 据实写（`success`/`failed`），不再恒 `success`。

### D3｜契约一致（接进交付门）
交付产物置 completed 前，对**交付的前端**跑 `checkContractConformance(frontendHtml, contract)`（ADR-0007）：前端 `appData.<op>('<资源>')` 必须 ⊆ 后端真契约。越界 → `contract_violation`、不放行。把这道本只在迭代用的确定性门也焊到交付出口。

### D4｜部署健康（不健康绝不"上线"）
- 部署 health check 必须 healthy 才算 `deployed` → 才可置 completed + 对外 URL。
- 不健康 → `deploy_failed`，**绝不置 completed、绝不给"上线"URL**。
- 降级静态托管（Docker 不可用等）只能标 **"仅预览·未上线"** 的独立态，不得冒充 completed/已上线。

### D5｜状态诚实 + 融合分退场（两条铁律）
- **状态诚实**：`completed`（=真上线）当且仅当 **D1∧D2∧D3∧D4 全过**。任一不过 → 对应失败态（`acceptance_blocked`/`build_failed`/`smoke_failed`/`contract_violation`/`deploy_failed`），且**前端绝不呈现为"已上线"**，而是显示卡在哪门、为什么。
- **融合分退场**：L1×.3+L2×.3+L3×.4 融合分**永不作上线判据**，只当**迭代打磨进度信号**（项目评估页的数）。文档化守住，禁止任何交付/上线逻辑读它做门。

### D6｜门必须测"交付程序本身真在跑"，不是代理/平台/空跑（防把空跑升级成门）
这是 D1-D4 的前置纪律：每道门的证据必须来自**交付的程序真起来、真被打、真编译**，而非平台自身、demo 预览或没起的目标。
- **L2 运行时测交付程序，不测平台**：上线门的"运行时"证据用 **`backend-smoke` 对交付后端的真探活**（若依/路B 实例），**不用 `L2RuntimeSensor` 那个查平台 DB 的分**（平台一直在跑、恒高、与本项目无关）。即把真探活的那个 report 提为门的运行时依据。
- **冒烟前真起后端**（同 D2）：没起后端就不存在"冒烟通过"这回事；空跑结果一律视为**未验证**（既不算过、也不假装过），交付卡在"待运行验证"态。
- **delivery-control 二选一，不留空骨架**：调速器/越界门/执行路由要么**真接进 `productionDeliver` 主流程**当控制器，要么**诚实标"未启用"**——禁止留个 `pipeline.service` 侧路径的骨架假装系统有控制环。
- **总原则**：宁可门显示"未验证/待运行验证"（诚实的未知），也不可把空跑/测错对象判成"通过"（假阳性）。**假阳性 = 把跑不起来的标成已上线 = 这条 ADR 要消灭的头号风险。**

---

## 边界（这条纪律管什么、不管什么）

- **管**："可上线"的判定从"demo 像不像"升级为"全栈产物真能跑"——四个确定性二值门焊在编译/冒烟/契约/部署健康 + 验收真证据上。
- **不管**：UI 好不好看、业务规则全不全（那是设计/规则包的活）；也不管把每门做到多智能——门只要**确定性、可解释、零假阳性**（宁可挡住存疑的，不可放过跑不起来的）。
- **与既有门关系**：不替换 ADR-0005 传感器家族，而是**把上线判据从模糊融合分迁到这四个硬门**；ADR-0007 契约门、ADR-0008 验收分桶都成为本门的组成证据。

---

## Consequences

**变可信：** "已上线"从此=真编译过/真跑得起/真调对后端/真部署健康。监管/政企客户拿到的"completed"不再可能是跑不起来的空壳。开环（测错量）补成闭环（测可运行）。

**需关注：** 门收紧后**更多项目会卡在交付门**（编译不过/部署不健康的会被如实挡下、不再假"上线"）——这是对的，但要求**生成质量 + 部署链**跟上，否则通过率下降。配套要有清晰的"卡在哪门、怎么补"的客户侧反馈（接 ADR-0008 D6 处置策略）。冒烟/部署健康依赖运行环境（Docker/若依），私有化/降级场景要定义清楚"仅预览·未上线"的合法中间态。

**将来重访：** 把"真证据"再硬化（端到端 e2e 而非冒烟）；门的结果进守护中心（上线后持续验真）；与 ADR-0004 计量/授权配合（上线=计量起点）。

---

## Action Items

1. [ ] **（门骨架）** 定义 GoLive 状态机与失败态枚举（`build_failed`/`smoke_failed`/`contract_violation`/`deploy_failed`/`preview_only`），`runProductionDelivery` 据实置态。
2. [ ] **（D2·先修空跑）** **冒烟前真起交付后端**（起容器/进程）再打真端点——没起=未验证、不当门；编译(已真验证)直接 log→gate。
3. [ ] **（D6·测对对象）** 上线门"运行时"证据改用 **`backend-smoke` 对交付后端的真探活**，不用 `L2RuntimeSensor` 查平台 DB 的分；把真探活 report 提为门依据。
4. [ ] **（D2）** `compilationPassed`/`smokeResult`（已修空跑后）由 log 升级为 gate：失败 → 失败态，不置 completed；Build status 据实写。
5. [ ] **（D3）** `productionDeliver` / 交付出口接 `checkContractConformance`，越界 → `contract_violation`。
6. [ ] **（D4）** 部署健康作硬门：不 healthy → `deploy_failed`、不给上线 URL；降级静态托管标 `preview_only`。
7. [ ] **（D6·去空骨架）** delivery-control 二选一：真接进 `productionDeliver` 主流程，或诚实标"未启用"——不留假装有控制环的骨架。
8. [ ] **（D1）** must 场景验收证据硬化（冒烟命中端点/置备探活），与 ADR-0008 D5 分桶对齐。
9. [ ] **（D5）** 前端"项目评估/终稿交付"区分"迭代进度分(融合分)"与"上线门(门状态)"；上线门卡住时显示卡在哪门、怎么补。
10. [ ] **（守护）** 上线门结果上报守护中心，上线后持续验真（接 [[project_guardian_center]]）。

---

> 触发实证：2026-06-25 排查 demo 综合分卡 71，查实 `runProductionDelivery` 的 compile/smoke/deploy 只 log 不拦、契约不进交付门、部署不健康仍置 completed → "通过验收 ≠ 能跑"。相关 [[project_followup_spec_gaps]]、[[project_roadmap_status]]、[[project_guardian_center]]、[[project_path_b_progress]]。

---

## Update（2026-06-25）：工程控制论全链路体检 + 修复路线图

上线门焊实后做了一次全链路体检（追踪 DeepSeek 生成 → 测量 → 比较 → 修复 → 守护 → 控制器六环节，逐一取证）。核心结论：**纵向出口（生成→编译→部署→上线门→输出）已实打实、completed 已诚实；但横向反馈环（测量/修复/守护/控制器）此前都在「设计态(demo HTML/schema)」打转，没对准「运行态(真部署的程序)」。** 上线门是当时唯一真测运行态的环。

### 八项隐患与修复状态

| # | 隐患 | 修复 |
|---|---|---|
| 3 | `Project.status` 一个字段被生命周期与上线门结局共用：legacy completed 假"已上线"；门失败态污染状态机致孤儿态/Demo brick | **Slice A 已修**：新增 `Project.goLiveStatus` 独立字段；上线门只写它、不覆盖生命周期 `status`；前端读 `goLiveStatus`；迁移回填。 |
| 4 | `decide('accept'/'view_demo')` 直接置 `status='completed'` 旁路上线门 | **Slice B 已修**：safety 部分由 Slice A 字段分离消解（completed 不再等于上线）；`view_demo` 不再改状态。 |
| 7 | `delivery-orchestrator` 死代码（监听无 emitter 事件）与主交付竞争写 `status` | **Slice B 已修**：删除 orchestrator + spec + 注册。 |
| 1 | 融合分 L2 取平台 DB 健康（恒高），真探活交付后端的 backend-smoke 被排除在总分外 | **Slice C 已修**：有真后端时 L2 分取 backend-smoke 真探活；无后端回退平台 L2。 |
| 2 | 守护从不打线上 `productionUrl`，只验库存 demoHtml + 平台健康 | **Slice D 已修**：守护增加 liveness 真探活，线上不可达即 critical。 |
| 8 | D3 契约门无 schema/dataModel 时静默放行 | **Slice E 已修**：未验证如实记录原因（仍不阻断纯前端的合法情形）。 |
| 5 | 自迭代修复回路只改设计态(demoHtml/schema)，不碰运行态代码 | **边界（见下，刻意不强行重写）** |
| 6 | 生成的运行骨架（CRUD server.js/Dockerfile/中间件）是注入的硬编码模板，非模型产物 | **边界（见下，刻意权衡）** |

### 明确边界（刻意不做，避免过度工程）

- **#5 自迭代 = 设计态打磨回路**：自迭代在 demoHtml/appSchema（设计态）内测→修→重测自洽收敛，是真闭环、分数真因修复而动；但它**不修复运行态全栈代码**。运行态的可运行性由上线门（D2 编译/D3 契约/D4 部署冒烟）在交付出口把关，不依赖自迭代。两者分工明确，不应让自迭代去"修后端代码"——那是另一套能力，当前刻意不建。
- **#6 生成骨架 = 模板托底（刻意权衡）**：交付产物的运行骨架（Express CRUD `server.js`、标准化 Dockerfile、安全/可观测中间件）由 `injectEnterprisePack` 注入硬编码模板覆盖 AI 产物——这是为"稳定能跑"刻意做的托底（AI 生成的基础设施不稳定）。代价是"能跑"部分靠模板而非模型本身。保留此权衡；AI 产物质量由 Qwen 审查 + 编译门兜底。
- **重复实现**：`sensor-fusion.service.ts` 是另一份未被 `runAll` 使用的融合实现；活路径是 `SensorService.fuse()`（已在 Slice C 修）。重复件应择机清理/标注，避免误改死路径。

> 体检与修复：2026-06-25，分支 `feat/cybernetic-loop-fix`。Slice A–E 已落地并各自单测/构建验证；Slice A 浏览器实测过六态 + legacy completed 不再假已上线 + 门失败态不污染生命周期。
