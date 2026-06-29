# ADR-0016: 全自然语言需求交互 —— 覆盖式收敛澄清，把"需求反复"前移到便宜的澄清阶段

**Status:** Proposed（2026-06-29；从白皮书价值一/六倒逼设计——"需求响应分钟级 + 重塑 IT 角色"的引擎是需求交互层。融合 spec-kit/BMAD/OpenSpec 三个高星成熟方案的**模式**，建在现有 discovery 上，不重做、不装工具。**已勘探现有 discovery/specification 并附落地切片计划**——见下"实现地基盘点 + 切片计划"，两样已有雏形、净新增面小；待批准后从切片1起。）
**Date:** 2026-06-29
**Deciders:** 平台负责人

**关联:** 兑现 `WHITEPAPER-value-and-delivery-v2` 价值一（速度）/价值六（角色重塑）；是工程控制论"控制器"角色的增强；与 [ADR-0014] 角色流水线"业务翻译官"合流；与 [ADR-0015] 终态验收分工（本 ADR 管"需求→规格"，ADR-0015 管"功能对不对"）；冻结状态机接住"交付后变更"。

---

## Context（为什么做这个）

传统软件最大成本 = **需求反复**：模糊指令 → 程序员脑补 → 做错 → 返工 → 再沟通，循环发生在**昂贵的交付后**。

平台已有 discovery 一套（需求访谈/完备性批判 A/处置分类 D/关系补全/追加问答/structuredRequirement），脊柱也证过"需求→规格→交付"。但它缺三样让"反复"真正收敛的机制：**①缺口的量化可见（完备度）②澄清的可追溯沉淀 ③规格的冻结/版本化**。

**病灶一句话**：现有 discovery 能澄清，但**业务人看不见"还差什么"、改了不知"为什么这么定"、规格没有冻结线** → 反复仍可能漏到交付后。本 ADR 把反复**前移并收敛在澄清阶段**（选选项 + 点 demo 的廉价环节），而非交付后（推倒重来的昂贵环节）。

**这是数控机床思路在需求侧的落地**：把图纸（G 代码）做精确，加工就不返工。

---

## Decision

### D1｜核心范式：填已知槽位的"覆盖式收敛"，不是开放对话

平台特点决定形态：**用户非技术 + 交付目标形状已知**（若依交付要：实体/字段/关系/角色/数据范围/菜单/验收场景）。所以澄清不是开放式聊，是**把这些固定槽位填满**——目标形状已知 → 提问有界、可度量覆盖。

### D2｜交互流程（七步，给 Claude Code 当实现蓝本）

```
① 大白话进（说一句 / 传文档 / 传截图）
        ↓
② 抽成结构化 IR，对齐到若依交付的固定槽位
   （实体/字段/关系/角色/数据范围/菜单/验收场景）—— 目标形状已知，澄清不开放
        ↓
③ 覆盖式缺口扫描（现有完备性批判 A + 新增"覆盖度量化"）→ 每个必填槽算覆盖度，缺口带证据
        ↓
④ 缺口 → 合成一屏业务选择题（现有处置分类 D：autofill 自动补 / ask 问 / info 提示）
   ★ 新增：顶部"需求完备度 72% → 还差 3 个关键决策"进度条
     （让业务人当场看见差什么，一次问清 ≠ 来回拉扯）
        ↓
⑤ 每个回答写进规格的"澄清记录"区（新增）
   → 可追溯"这字段为什么这么定 = 你哪天选的哪个选项"
        ↓
⑥ 试切确认：给可点 demo 确认逻辑对不对（现有），不让业务人读规格
        ↓
⑦ 冻结 = proposal → apply（新增状态机）；要改 = 新 proposal，版本化（接交付后变更）
```

### D3｜融合三个高星成熟方案（借模式 · 不装工具 · 不照搬技术问答表面）

| 来源 | 星 | 借它的什么 | 映射到平台现有 |
|---|---|---|---|
| **GitHub Spec-Kit** `/clarify` | 55k★ | 覆盖式、按缺口顺序提问 + Clarifications 记录区 | 升级现有"完备性批判 A + 追加问答"为 **③覆盖度量化 + ⑤澄清记录区** |
| **BMAD-METHOD** | 48k★ | PM/架构师/UX persona 的结构化人格 | 作为 [ADR-0014]"业务翻译官/领域建模师"**提示词蓝本**（提示词化时抄 persona 结构） |
| **OpenSpec** | 52k★ | proposal/apply/archive 三相状态机 | **⑦规格冻结/解冻/再交付版本化** |

### D4｜三条不照搬（红线）
- **不照搬技术问答表面**：spec-kit 等问的是**开发者技术澄清**；平台用户是**业务人员**，必须翻成**业务选择题 + demo 确认**，不是技术问答。
- **不装它们的工具**：它们是 coding agent 的 CLI；本 ADR 只**借设计模式**，融进现有 discovery，不引入 spec-kit/BMAD/OpenSpec 本体。
- **不越界管"功能正确性"**：本 ADR 只管"需求→规格"这段；"做出来功能对不对"交 [ADR-0015] 终态验收，别指望澄清能兜功能。

### D5｜实现落点：长在现有 discovery 上，加三样，不重做
- 加 **覆盖度量化 + 进度条**（在完备性批判 A 之上算每个必填槽的覆盖度）。
- 加 **澄清记录区**（写进 structuredRequirement，与需求保留式合并，勿整体替换——遵 handoff §4 纪律）。
- 加 **冻结状态机**（proposal/apply/archive，规格冻结才进交付；改 = 新 proposal）。
- 其余（IR 抽取、处置分类 D、关系补全、demo 试切）**复用现有，不动**。

---

## 边界（管什么、不管什么）

- **管**：把现有 discovery 升级为"覆盖式收敛澄清"（覆盖度 + 澄清记录 + 冻结）；定融合来源与映射；定不照搬红线。
- **不管**：不重做 discovery；不引入 spec-kit/BMAD/OpenSpec 工具本体；不管功能正确性（ADR-0015）；不做技术问答表面。

---

## Consequences

**需求反复前移变便宜**：覆盖度逼出所有缺口、一屏问清、试切确认、冻结锁共识——反复发生在"选选项+点 demo"的几分钟环节，不在"做完推翻"的昂贵环节。**兑现价值一/六**：业务人看得见完备度、自助答完即推进；IT 转向审核治理。**可追溯**：澄清记录让"为什么这么定"可查，接政企可审计叙事。

**代价/风险**：覆盖度规则要按"若依交付槽位"定义（与置备链耦合，需对齐）；冻结状态机要和现有项目状态机（needs_input→…→delivered）协调，别冲突；进度条若算不准会误导业务人——覆盖度算法需校准。

---

## 实现地基盘点（2026-06-29 勘探现有 discovery/specification，落"建在现有上、不重做"）

三样里**两样已有雏形**，净新增面比想象小：

| ADR 要的 | 现有（复用） | 差距（净新增） |
|---|---|---|
| 覆盖度量化 | `discovery/completeness-checker.service.ts` 已算 0-100 加权分 + 每槽状态 + gaps + `isReadyForPlan(≥70)` | 它算**通用发现槽**(产品形态/规模/目标用户…)，**非若依交付槽**(实体/字段/关系/角色+数据范围/菜单/验收场景)→ 需对齐交付槽的覆盖层 |
| 一屏业务选择题 | `specification/followup-question.service.ts` 已把 D 的 ask 缺口 + 关系 + 业务规则**合批成统一选择题列表**(带 options，提交路由回各自 apply) | 缺"完备度进度条"呈现头 |
| 澄清记录 | followup 答案 apply 回写 `structuredRequirement` | **无 clarifications 记录**(问/答/时间) |
| 冻结状态机 | `specification.service.ts` 已有 `frozen`/`frozenAt` + `spec_confirmed` + `assertValidTransition` | 有冻结雏形，**缺 proposal/apply/archive 版本化**(交付后改=新版本) |
| 若依交付槽定义 | `app-runtime/app-spec.types.ts`：`entities`/`roles(dataScope)`/`menus`/`relations` + `acceptanceScenarios{name,given,when,then,priority}` | 这就是覆盖度该对齐的槽 |

---

## 实现切片计划（排 serve 基建之后；与 ADR-0014 业务翻译官合流。每片独立可验、可回退）

### 切片 1 · 若依交付覆盖度量化（后端纯函数，单测先行，最安全）✅ 已落（2026-06-29）
- **加**：`RuoyiCoverageService.evaluate(spec: AppSpec, acceptanceScenarios)` → 按 7 个若依交付槽（实体/字段/关系/角色/数据范围/菜单/验收场景）算覆盖度，输出 `{coverage:0-100, perSlot, gaps[]}`。权重和=100（实体25/字段20/角色15/关系10/数据范围10/菜单10/验收10）。
- **复用**：照抄 `CompletenessChecker` 的"加权+gaps"结构；**输入取已组装的 `AppSpec`**（= 复用 app-spec-assembler 产物，保纯函数可单测）；验收场景取自 `structuredRequirement.acceptanceScenarios`。
- **实现/验**：[`ruoyi-coverage.service.ts`](../../apps/api/src/modules/app-runtime/ruoyi-coverage.service.ts)；10 测——空 spec→0、满 spec→100、无验收→验收 missing(−10)、roles 全默认全部→dataScope partial、部分裸实体→fields partial、单实体不罚关系、覆盖度单调。已注册进 app-runtime module（供切片2 端点注入）。
- **校准取舍（备查）**：①数据范围——角色全为 data_scope='1'(全部) 判 partial（"没区分谁看哪些数据"）；②关系——恰 1 实体不罚、0 实体随空 spec missing、≥2 实体无关系才 missing；③字段——只算非 id/审计列。

### 切片 2 · 完备度进度条 + 缺口清单（前端 + 一个聚合端点）✅ 已落（2026-06-29）
- **加**：后端 `GET /api/projects/:id/coverage`（切片1覆盖度 + followup questions，聚合服务 [`requirement-coverage.service.ts`](../../apps/api/src/modules/specification/requirement-coverage.service.ts) + 控制器）；前端方案页"设计建议"子页 [`coverage-progress.tsx`](../../apps/web/src/app/projects/%5Bid%5D/plan/coverage-progress.tsx)——"需求完备度 X% · 还差 N 项"进度条 + 7 槽状态 chip + 缺口清单。
- **复用**：`AppSpecAssemblerService.assemble`（dataModel 空/不合法 → 容错空实体，进度条不 500）；`FollowUpQuestionService.getQuestions`（只读，无 LLM）。聚合只读、不写库、不调模型。
- **实现/验**：后端 7 测（属主校验/空·不合法 dataModel 容错/聚合/followup 失败不阻断/场景取值优先级）；**live 实证**——真人项目跑通：合同管理系统 80%（关系+验收 missing）、客户系统 100%；浏览器 design 子页渲染"需求完备度 80% · 还差 2 项 ✓业务对象 ✓字段 ○关系 …"与后端一致。
- **取舍**：进度条挂方案页"设计建议"子页（needs design tab；与已有 FollowUpQuestions 同位，互补：进度条=总览，followup=作答），未单建 idea/spec 顶部；后续可上移。answer followup 后 `relKey++` → 进度条重取前进。

### 切片 3 · 澄清记录区（后端·保留式合并，独立低风险）
- **加**：followup 提交 apply 时往 `structuredRequirement.clarifications` **append** `{slot, question, answer, at, source}`；**保留式合并**（遵 handoff §4 + 本会话 `66bad41` 把整体覆盖改保留式的纪律），绝不整体替换。
- **复用**：现有 followup apply 三条回写链路（requirement/relation/businessRule）。
- **验**：单测多轮答题 → clarifications 累积 N 条、原需求字段不被覆盖、时间戳/来源正确。

### 切片 4 · 冻结 proposal/apply/archive 版本化（后端+前端·最重·最后做）
- **现状**：已有 `frozen`/`spec_confirmed` 雏形，先别推翻。
- **加**：交付后"改需求"入口 → 生成**新 proposal 版本**（不直接改已冻结规格），apply 后归档旧版（archive）；与项目状态机(spec_confirmed→demo→…→completed)用 `assertValidTransition` 协调守合法流转。
- **验**：单测——冻结后改需求生成新版本/旧版归档/非法流转被挡；端到端"交付后小改→新 proposal→apply→重交付"。
- **注**：与状态机耦合最深、风险最高，最后做；先做最小版（"冻结后改=新版本"，archive 可后补）。

**顺序**：1→2（覆盖度地基→看得见缺口，最高价值闭环）→ 3（澄清沉淀，独立）→ 4（冻结版本化，最重最后）。切片 1/3 纯后端可单测先行、零前端依赖。

### 横切（贯穿，非独立片）
- [ ] **persona 蓝本**：业务翻译官/领域建模师提示词参考 BMAD persona 结构（接 [ADR-0014] R2 SOP）。
- [ ] **红线**：表面只用业务选择题 + demo，不引技术问答；不装 spec-kit/BMAD/OpenSpec 工具本体（D4）。

---

## 时机

**设计已完成（本 ADR）；实现排在唯一硬闸 serve 基建之后**，与 ADR-0014 业务翻译官角色一起做（同属"需求→规格"段）。注：单客户模型已消解"多租户隔离"闸，当前主线硬闸只剩 serve/部署基建（见 `WHITEPAPER-v2` 第七节 / `CLAUDE-CODE-HANDOFF`）。

---

> 触发实证：2026-06-29 本会话——从政企价值白皮书"需求响应分钟级 + 重塑 IT 角色"倒逼，设计需求交互引擎；GitHub 调研 spec-kit(55k)/BMAD(48k)/OpenSpec(52k) 三高星方案，确认借覆盖式澄清+persona+冻结状态机三模式、不照搬技术问答表面、建在现有 discovery 上。相关 [[project_motherbase_vision]]、[[project_roadmap_status]]、[[project_knowledge_base]]。
