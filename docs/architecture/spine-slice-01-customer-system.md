# Spine Slice 01：客户系统 = 第一根确定性脊柱（若依底座版）

**Status:** Plan（2026-06-25 修订 · 待执行）
**目的:** 用一个纯确定性 CRUD 业务系统，把"**生成/置备 → 编译 → 部署 → 真起来 → 上线门 completed → 真能登录/真能增删改查**"这条**交付脊柱**端到端跑通一次。脊柱立住后，再在其上加图表（ADR-0008）与生成型 AI 端点（ADR-0011）。
**关联:** 承接 [ADR-0003 强制底座=若依]、[ADR-0010]/[ADR-0011] 的"先确定性、后生成型"排序；用 [ADR-0009] 上线门 + 本轮修复（goLiveStatus / backend-smoke / 契约门 / 守护 liveness）做验证工具。

> **本次修订（2026-06-25）相对旧版的两处关键变化：**
> 1. **底座从 codegen/路B 改为若依底座置备（`ruoyi` 适配器，ADR-0003，非 codegen）。** 注意术语：按 `backend-runtime.interface.ts` 权威定义，`crud`=固定运行时(路B)、`generated`=生成代码容器(路C，预留)、`ruoyi`=若依底座(ADR-0003)——**若依是独立的第三种 BackendRuntime 适配器，不是路C**。理由：codegen 的"生成完整性"硬伤（Prisma schema 被 maxTokens 截断、缺 model）是生成路才有的不确定性；改走若依 `importTable` 从 dataModel 置备，从源头消掉这一类不确定性，符合 ADR-0003 强制底座与"确定性优先"。
> 2. **第一阻塞点前移到"若依实例环境"。** 现实核查发现：若依本地根本没起（无若依容器、8080 CLOSED），且 `RUOYI_BASE_URL`/`RUOYI_SRC_ROOT` 未配 → `loadRuoyiInstanceConfig.enabled=false`，上次交付正因此回落 codegen。所以第一关是环境，不是生成质量。

---

## 唯一目标

**客户系统 → 若依底座 → 真上线，能登录、能增删改查。**

不是"评估分高"、不是"demo 像"。判据全部落在"真能跑 / 真能用"。

## 为什么是这条路

- **确定性优先**（变量最少）：走若依底座置备，不依赖 LLM 生成完整后端，消掉生成完整性这一类不确定性。
- **若依是 ADR-0003 强制底座**：政企信创主力（若依-Plus，信创适配 + 完整 RBAC + 数据权限；具体版本/许可证以官方为准，不在此断言）。
- **客户系统是真实候选里唯一干净的**：客户分级 + 项目关联跟踪 + 客户/项目关系 + 多用户角色 = 全是 CRUD+关系+鉴权，只有一个"数据看板"碰图表缺口（v1 降级）。最通用的 CRM 范式，跑通它≈跑通大半 B2B 后台。（药店巡店=地图+视觉+语音+看板 4 缺口；客服平台=对话+IM 双缺口，均排除。）

项目：`客户系统`（`id=ed541b1e-e258-4d3f-bdef-7be91875033e`，demo_ready，dataModel 已有，backend_kind=crud）。

---

## 现实核查结论（已证的硬阻塞，路线据此排序）

| 核查项 | 结论 | 含义 |
|---|---|---|
| 若依容器 | **无**，8080 CLOSED | 若依实例根本没起 |
| `RUOYI_BASE_URL`/`RUOYI_SRC_ROOT` | **未配** | `enabled=false` |
| 上次交付走向 | 回落 codegen | 正因 `enabled=false`，没走若依路 |

→ **结论：第一关是环境。** 关键路径上的真不确定性集中在 **Phase 0（环境，便宜，先排）** 和 **Phase 2（置备链可靠性，核心，攻坚）**。

---

## 范围

**v1 做（确定性核心）**
- 实体 CRUD：客户、项目（增删改查 + 列表 + 详情 + 表单）
- 关系：客户 1—N 项目，关联查询
- 字段：客户分级（A/B/C 枚举字段）、项目金额/数量/进展状态
- 鉴权：管理员 / 普通用户角色登录（用若依开箱 RBAC + 数据权限）

**v1 降级（不让已知缺口污染脊柱测试）**
- 「数据看板」→ **确定性计数卡/表格**（A级客户数 / 项目总额 / 今日任务 N，纯聚合数字，不上图表库）
- 「数据实时同步」→ 普通 REST + 前端刷新（不做 websocket 实时）

**v1 不做（明确后置，命中即诚实标缺口，不假交付）**
- 真图表/可视化看板 → ADR-0008 图表词汇生长
- 任何 AI/生成型端点 → ADR-0011
- 任何 external（地图/语音/IM/支付/OCR）→ gap_workflow

---

## 成功判据（唯一一条，端到端真绿 · checklist）

- [ ] 置备产物 **编译通过**（若依模块 Maven build 0 错）
- [ ] **真部署起来**：若依实例 build/run 成功 + 健康检查 healthy（非降级 static_only）
- [ ] `productionUrl` **真能打开**（守护 liveness 探活 reachable）
- [ ] 客户/项目 **CRUD 真能用**：backend-smoke 对交付后端探活通过 + 契约门一致（前端调用 ⊆ 后端真契约）
- [ ] **前端页真落地可见（别假设它在）**：codegen 的 `vue/**` 已落进 plus-ui（`uiRoot` 配通）+ 前端重建/重部署 → 控制台菜单**点进去是真 CRUD 页（列表/搜索/表单/分页），不是空页/404**
- [ ] 角色登录真生效（管理员/普通用户可登录、数据权限隔离生效、鉴权拦截未登录）
- [ ] 上线门据实 `goLiveStatus=completed`（编译∧部署健康∧契约∧冒烟全过）

---

## 路线（每关带可证伪的退出判据，goal-driven）

### Phase 0 · 若依环境就位（先做——已证的硬阻塞）

- 起 `D:\ruoyi-study` 若依三件套（server / mysql / redis），确认 8080 可访问（冷启提速脚本 `_run-exploded.sh` ~66s + 三件套重建命令）。
- **确认构建工具链**：若依模块编译是 Maven 构建生成模块——确认运行环境里有 JDK + Maven + 依赖可拉取（否则 Phase 2 会卡在一个本该在 Phase 0 排掉的坑上）。
- 设 `RUOYI_BASE_URL`/`RUOYI_SRC_ROOT` 等 env，重启 API。

**退出判据：** 8080 通 + `loadRuoyiInstanceConfig.enabled=true` + `ensureProvisioned` 不再返回 disabled + JDK/Maven 可用。

### Phase 1 · 把客户系统接上若依路（不走 codegen）

- **先 designate（不可省）**：客户系统当前 `backend_kind=crud`，而 `ensureProvisioned` 有硬门 `if (be.kind !== 'ruoyi') return 'not-ruoyi'`——不会自动转若依。必须先调 `RuoyiProvisionService.designate(projectId, true)`（= 方案页"用若依底座"开关），把 `backendRuntime` 置成 `{kind:'ruoyi', status:'pending'}`，之后交付时 `ensureProvisioned` 才会入队置备。
- 让客户系统的后端走若依底座：designate 后，交付触发 `ensureProvisioned` → `kind=ruoyi` 置备入队。
- v1 范围：客户/项目 CRUD + 关系 + 分级字段 + 角色登录；看板降级计数卡。

**退出判据：** ① `designate` 后 `backendRuntime.kind=ruoyi, status=pending` 已落库；② 触发交付后，日志/状态显示走若依置备链，**不落 `stepwiseGenerate` codegen**。

### Phase 2 · 置备链对客户系统 dataModel 跑通（核心，最可能要修/要建）

- 走 `ruoyi-provision` 全链：建表 → `importTable` 生成 CRUD → 写工程 → 单模块编译 → 重启 → seed RBAC。修途中断点。
- **预期校准（已据代码核实，精确定位风险面）**：编排**已串通、非半成**——`RuoyiRuntime.provisionApp` 完整编排（建表→deploySources→waitReady→seed），`RuoyiProvisionService` 用 BullMQ 队列 + processor + **断点续跑**（相位 none→ddl→deployed→ready→seeded）包住，真 infra 驱动 `RuoyiMysqlDdlDriver` / `RuoyiLocalDeployer` 都在，代码注释明示这些是"端到端已手工证通的步骤的代码化"。（`provision(projectId, dataModel)` 那个 `throw` 是**故意的窄签名守卫**——"用 provisionApp"，非未实现 stub；interface 上的"预留 M3"是**过时保守注释**，不是真缺口。）
- **真正没被证过的只有一处**：代码注释直言 `单测用 mock infra，生产接真实现`——即**编排被 mock 单测覆盖，但两个真 infra 驱动从未在活若依实例上、对任意 dataModel 跑过**：`RuoyiMysqlDdlDriver` 对真 MySQL 建表、`RuoyiLocalDeployer` 真做 importTable+下载源码+写工程+单模块 mvn compile+重启、`waitReady` 真探活。**Phase 2 不是建编排，是验/修这两个 infra 驱动 × 任意 dataModel 对活实例的可靠性。** Claude Code 攻坚时直奔这两个 driver + `waitReady`，不要重写编排。若某段对真实例跑不通，那正是本路线要攻的核心，是"验/修驱动"而非退步。

**退出判据：** `backendRuntime.kind=ruoyi, status=ready`；客户/项目表 + CRUD 模块在若依实例里真存在（后台菜单/列表能看到）。

### Phase 3 · 真上线 + 上线门据实 completed

- 若依实例部署可访问；上线门用真证据（backendReady ready ∧ 部署健康 ∧ 契约一致）→ `goLiveStatus=completed` + `productionUrl` 真可打开。
- 用 backend-smoke / 守护 liveness 验。

**退出判据（成功判据 checklist）：** 编译过 ∧ 真部署可访问 ∧ CRUD 真能用 ∧ 角色登录生效 ∧ `goLiveStatus=completed`。

### Phase 4 · 真人走一遍（= 目标达成）

- 登录（若依账号）→ 建一个 A 级客户 → 关联一个项目 → 列表/详情可见；守护 liveness reachable。

**退出判据：** 一个真人能用的客户系统上线了 → 目标"跑通一个程序最终交付上线"达成。**里程碑 = Phase 4 退出 = 目标达成。**

---

## 贯穿原则

- 每关 exit = **真能跑**，不是评分高 / demo 像。
- **诚实底线**：任一关不过就据实卡住，绝不人工标 completed 冒充（本轮修复要守的底线）。
- 验证全用本轮工具：`goLiveStatus` / backend-smoke / 契约门 / 守护 liveness / 逐层翻交付物（`.hermes/deliveries/<id>/`）。
- **路 B（通用 CRUD）与 codegen 在本路线退场**：客户系统走若依；codegen 仅留给后续 AI 业务增量（ADR-0011）。

---

## 主要风险 / 回退

- **Phase 0**：若依冷启慢 / 三件套 docker 重启不回 → 用提速脚本 `_run-exploded.sh` + 重建命令。构建工具链缺失（无 Maven）→ 先补，再进 Phase 2。
- **Phase 2（最硬）**：置备链对任意业务 dataModel 跑不通 → 这才是真要攻的核心（若依 `importTable` 自动化的可靠性）。暴露即如实定位修复；修不动则单独立项，脊柱据实阻塞在此（不假上线）。
- **Phase 3**：部署 / 网络可访问性。

> 不为过判据而放水：任一环不过 → 据实卡住，绝不人工标 completed 冒充。这正是本轮修复要守的诚实底线。

---

## 验证用什么（本轮已建的工具）

- `goLiveStatus`（ADR-0009 Slice A）：据实读门结局，不被生命周期 status 干扰。
- backend-smoke 进融合分（Slice C）：反映交付后端真死活。
- 契约门（ADR-0009 D3）：前端调用 ⊆ 后端真契约。
- 守护 liveness（Slice D）：productionUrl 真探活。
- `.hermes/deliveries/<id>/`：逐层翻置备产物，确认是真若依 CRUD 模块。

---

## 脊柱立住之后（下一步，不在本切片）

1. 图表/看板真实现 → ADR-0008 图表词汇生长（把 v1 的计数卡升级成图表）。
2. 生成型 AI 端点 → ADR-0011 P1（在证过的脊柱上加 LLM Port + 领域端点）。
3. 复用同脊柱跑第二个确定性系统（如销售管理），验证可复制性。

---

## 执行分工（Cowork ↔ Claude Code）

- **Claude Code（在真机执行）**：Phase 0→4 的 Docker / Maven / 置备链 / 部署 / 探活全部执行——需要真机 Docker daemon、localhost:8080、Maven 构建、对活服务打真实 HTTP，这些 Cowork 沙箱够不到。
- **Cowork（本文档作者）**：路线/ADR 文档沉淀、跨仓库读码分析、每关产出与判据的第二双眼睛审查（守"不假 completed"底线）。
