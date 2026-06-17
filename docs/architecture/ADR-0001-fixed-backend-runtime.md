# ADR-0001: 固定后端运行时 + 数据模型驱动（路 B）

**Status:** Proposed
**Date:** 2026-06-17
**Deciders:** 平台负责人 / 后端 owner
**关联:** 路 C（全栈代码生成 + 真部署）将在本 ADR 的脊柱上增量演进；本 ADR 显式为 C 预留升级位。

---

## Context（背景与受力）

平台当前真实交付能力（已核实，带证据）：

- 产物只有**单文件 HTML 前端 SPA**，数据是写死在前端模板字符串里的 mock（`cloudecode.client.ts` 生成，存 `project.demoHtml`）。
- 宣称的"后端 codegen / 全栈"是**死代码**：`generateBackend()` 几乎不被调用，生成的 Express/Prisma 代码进了 zip 但**从不编译/部署/运行**，外面套着三层降级链——平台自己都不信任这条路径。
- 数据库 schema 输出成 SQL 文本但**没人执行 CREATE TABLE**；部署（`deployment.service`）只静态托管 `demoHtml`，前端里调 API 会 404。
- 自迭代闭环的**传感器只能"看" HTML 字符串**（`sensor.service.ts` L1/L2/L3 全部围绕 `demoHtml`），看不到运行中的后端——所以哪怕生成了后端，闭环也无法在其上收敛。

受力：
1. 定位是**面向普通人**，长尾需求是记账/表单/清单/看板/轻 CRM —— **真持久化 + 多用户**，而非任意定制后端逻辑。
2. 自由后端 codegen 不可靠（已被三层降级证伪），但"真数据"是这些应用成立的硬条件。
3. 这是路 C 的前置：脊柱（数据模型、迁移执行、后端传感器、真部署、前端真 API 契约）无论 B/C 都要建，必须**一次建对、可复用**。

### 两条硬约束（为路 C 防绕路）

- **约束①｜契约即普通代码**：数据模型用**真 Prisma schema** 表达，对外用**真 REST 约定**——这正是路 C 也会生成的形态。**不得**引入私有 DSL / 私有 metadata 格式。
- **约束②｜后端可替换**：脊柱（迁移执行 / 后端健康探针 / 真部署）按 `BackendRuntime` 接口编程，路 C 只需换实现（固定 runtime → 生成代码容器），**契约 / 前端 / 传感器 / 部署编排不动**。

---

## Decision（决策）

引入一个**平台内置的通用 CRUD 运行时**，数据模型驱动：

1. LLM 不再写后端代码，只产出 **① 一段 Prisma schema（数据模型）+ ② 调用真 REST 接口的前端代码**。
2. 平台据 schema 在**共享 Postgres 的 per-project schema 命名空间**（`proj_<id>`）里自动建表（受控迁移）。
3. 一个**元数据驱动的通用 CRUD 控制器**按数据模型暴露标准 REST：`/api/app/:projectId/:resource`（list/get/create/update/delete + 过滤/排序/分页）。这是"固定后端"——确定性、零 LLM 代码。
4. demoHtml 仍是单文件 SPA，但通过注入的 `appData` helper `fetch()` 真接口，**数据真的存得住**。
5. 新增**后端冒烟传感器**（L2 运行时层）：健康检查 + 对每个 resource 跑 CRUD 往返，把闭环延伸到后端。
6. 部署：在线链接背后从"托管一个 HTML"变为"HTML + 该项目的真 REST API + 该项目的 Postgres schema"。

---

## Options Considered

### Option A：维持自由后端 codegen（现状愿景）
| 维度 | 评估 |
|------|------|
| 复杂度 | 高 |
| 可靠性 | 低（已被三层降级证伪） |
| 约束① | 满足（生成真代码） |
| 闭环可迭代 | 否（传感器看不到运行后端，且生成代码不部署） |

**Pros:** 理论上能做任意后端。
**Cons:** 不可靠、产物是死代码、无法自迭代收敛。**这就是要被取代的现状。**

### Option B：自建通用 CRUD 运行时 + Prisma 模型驱动 ✅（选定）
| 维度 | 评估 |
|------|------|
| 复杂度 | 中 |
| 可靠性 | 高（确定性 runtime，无自由 codegen） |
| 约束① | 满足（Prisma schema + REST，与 C 同形态） |
| 约束② | 满足（runtime 在 `BackendRuntime` 接口后，可换） |
| 覆盖面 | 普通人长尾 CRUD 应用基本全覆盖 |

**Pros:** 可靠、可立刻发货、脊柱 80% 被 C 复用、契约与 C 一致。
**Cons:** 自建 CRUD 运行时与受控迁移有工作量；v1 不覆盖自定义业务逻辑。

### Option C：嵌入开源 BaaS（Hasura / PostgREST / Directus / PocketBase）
| 维度 | 评估 |
|------|------|
| 复杂度 | 低（买现成） |
| 可靠性 | 高 |
| 约束① | **冲突**：BaaS 用自有 metadata（Hasura）/GraphQL/PostgREST 约定，**非** Prisma+标准 REST → 前端契约无法平移到 C |
| 数据合规 | PocketBase 用 SQLite（与共享 Postgres、与 C 的 Postgres 不一致） |

**Pros:** 上线最快。
**Consः** **直接违反防绕路约束①**——BaaS 的契约形态与路 C 生成的代码不同形，将来上 C 要重写契约层与前端调用层，**这才是真绕路**。故否决作为主线（可作为内部存储实现细节，但不暴露其契约）。

### Option D：通用文档存储（JSON blob 按 projectId/collection/id）
**Cons:** 不是真表，违反约束①（C 会生成真表/真 schema），且查询能力差。否决。

---

## Trade-off Analysis

- **可靠性 vs 灵活性**：B 牺牲"任意后端逻辑"换"确定性可发货"。对普通人定位，这是正确取舍——长尾要的是持久化，不是定制逻辑。定制逻辑留给 C。
- **自建 vs 买（B vs C-as-BaaS）**：决定性因素是**约束①**。只有自建薄 CRUD 运行时（直接基于 Prisma 模型 + 标准 REST）才能让契约与路 C 生成的代码**同形**，从而 C = "换后端实现"而非"重写契约"。BaaS 省的是最便宜的一块（runtime 本体），却污染最贵的一块（契约），得不偿失。
- **隔离**：per-project Postgres schema 命名空间，避免跨项目数据串扰，且与"将来 C 给每个项目独立后端/库"方向一致。
- **迁移安全**：LLM 产出的 schema 必须经**类型白名单 + 禁止裸 SQL** 校验后才执行，杜绝注入与破坏性 DDL。

---

## Consequences

**变容易：**
- 普通人 CRUD 应用**立刻可真实交付**（数据存得住、多用户共享）。
- 自迭代闭环延伸到后端（后端传感器），不再只迭代前端。
- 路 C 的脊柱（模型/迁移/探针/部署/前端契约）一次建成，C 只剩"换后端实现"一个变量——把双变量难题降为单变量。

**变难 / 需关注：**
- 受控迁移执行是新的安全面（DDL 校验、schema 隔离、回滚）。
- demoHtml 前端契约要从"内联 mock"迁到"fetch 真接口"，需向后兼容旧 demo（无数据模型时退回内联 mock，沿用 autoFix 的 fallback 模式）。
- 共享 Postgres 的多 schema 容量 / 连接管理。

**将来需重访：**
- v1 不做：自定义业务逻辑/计算型接口、per-app 鉴权、文件上传、实时——这些是 C 或 B 后续档位。
- 关系建模 v1 仅支持简单外键引用（belongsTo），复杂关系延后。

---

## v1 最小可交付范围（MVP 边界）

**做：**
1. `BackendRuntime` 接口 + `CrudRuntime` 实现（元数据驱动的通用 CRUD 控制器）。
2. Project 新增字段承载数据模型（Prisma schema 文本）与运行时描述符。
3. `SchemaMigrationService`：校验（类型白名单/禁裸 SQL）→ 在 `proj_<id>` schema 建表/迁移。
4. demo 生成 prompt 升级：产出数据模型 + 用注入的 `appData` helper fetch 真接口的前端；无模型时退回内联 mock。
5. `BackendSmokeSensor`（L2）：健康 + 每 resource 的 CRUD 往返打分，接入 `SensorService.runAll`。
6. 部署编排：在线链接背后挂上该项目的真 API + schema（runtime 常驻，按 projectId scope）。

**不做（显式延后）：** 自定义服务端逻辑、per-app 鉴权、文件/对象存储、实时/WebSocket、复杂关系、生成代码容器（=路 C）。

---

## Action Items（实施切片，每片独立可验收）

1. [ ] **契约骨架**：定义 `BackendRuntime` 接口 + REST 约定文档（`/api/app/:projectId/:resource`，分页/过滤/排序约定）。约束②的落点。
2. [ ] **数据模型载体**：Project 加 `dataModel`（Prisma schema 文本）+ `backendRuntime` 描述符字段；prisma migrate。
3. [ ] **受控迁移**：`SchemaMigrationService`——解析+校验 Prisma 模型，在 `proj_<id>` 建表；含类型白名单与回滚。单测覆盖恶意/破坏性 schema 被拒。
4. [ ] **CRUD 运行时**：`CrudRuntime` 实现 `BackendRuntime`，元数据驱动 list/get/create/update/delete + 过滤分页；按 projectId scope 到对应 schema。
5. [ ] **前端真 API 对接**：注入 `appData` helper（仿现有 annotation 注入器），demo prompt 产出 fetch 真接口的前端；旧 demo 无模型时退回内联 mock（向后兼容）。
6. [ ] **后端传感器**：`BackendSmokeSensor` 接入 `SensorService.runAll`，产出可定位到 resource 的 recommendations，让自迭代能修后端契约问题。
7. [ ] **部署编排**：`deployment.service` 扩展——部署时确保 `proj_<id>` schema 存在且 runtime 路由可达；`BackendRuntime` 描述符进部署产物（为 C 预留容器化位）。
8. [ ] **端到端验收**：一个"带数据的轻应用"（如待办/记账）从需求→生成→建表→前端 CRUD 真存→后端传感器打分→部署在线链接可读写，全程闭环。
