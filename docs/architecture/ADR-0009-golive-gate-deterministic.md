# ADR-0009: 上线门 —— 确定性二值闸，焊死在"可运行"维度（验收真证据 / L2运行时 / 契约一致 / 部署健康）

**Status:** Proposed（2026-06-25；由"评分卡 71"排查反向暴露——上线门测的不是"能不能跑"，本 ADR 焊死真闸）
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

---

## Decision（五条）

把"可上线（completed）"从"一个软门（验收 passRate）"换成**四个真维度的确定性二值合取门（AND 全过才放行）**。每门 pass/fail 二值、可解释、零模糊。呼应"90→100"裁定：不在融合分上追满分，换**确定性二值门、每桶各自达标**。

### D1｜验收真证据（保留 + 硬化）
验收 passRate ≥ 阈值仍是门。但"真证据"硬化：**must 场景的 pass 需运行时/数据证据**，不止 LLM 看 demo——
- `self` 场景：保留 HTML 语义判定（ADR-0008 D2/D5）。
- `backend` 场景：认后端置备 + 探活（不是 HTML）。
- 关键 must 场景：可要求**冒烟测试命中对应端点**或人工确认作为硬证据。
- `external`/`deferred`：D5 受控放行，不阻断、显式标"待对接"。

### D2｜L2 运行时（log → gate）
把已经在跑、只打日志的两步**升级成硬门**：
- **编译**：`compilationPassed===false` → 项目置 `build_failed`，**不置 completed**、不产出"上线 URL"。
- **冒烟**：`smokeResult.passed===false`（对有后端的交付）→ 置 `smoke_failed`，不置 completed。
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
2. [ ] **（D2）** `compilationPassed`/`smokeResult` 由 log 升级为 gate：失败 → 失败态，不置 completed。
3. [ ] **（D3）** `productionDeliver` / 交付出口接 `checkContractConformance`，越界 → `contract_violation`。
4. [ ] **（D4）** 部署健康作硬门：不 healthy → `deploy_failed`、不给上线 URL；降级静态托管标 `preview_only`。
5. [ ] **（D1）** must 场景验收证据硬化（冒烟命中端点/置备探活），与 ADR-0008 D5 分桶对齐。
6. [ ] **（D5）** 前端"项目评估/终稿交付"区分"迭代进度分(融合分)"与"上线门(四门状态)"；上线门卡住时显示卡在哪门、怎么补。
7. [ ] **（守护）** 上线门结果上报守护中心，上线后持续验真（接 [[project_guardian_center]]）。

---

> 触发实证：2026-06-25 排查 demo 综合分卡 71，查实 `runProductionDelivery` 的 compile/smoke/deploy 只 log 不拦、契约不进交付门、部署不健康仍置 completed → "通过验收 ≠ 能跑"。相关 [[project_followup_spec_gaps]]、[[project_roadmap_status]]、[[project_guardian_center]]、[[project_path_b_progress]]。
