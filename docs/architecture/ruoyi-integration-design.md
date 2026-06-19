# 若依接入技术设计（ADR-0003 步骤 2-4 施工蓝图）

> 实现设计，非决策记录。决策见 [ADR-0003]；契约见 [app-runtime-rest-contract.md]、[ADR-0001]。
> **置信度标注**：✅=已据现有代码确认 / 🟡=据若依通用架构推断、**起实例核实** / ❓=待调研。

## 0. 已锁决策（2026-06-20）
- **部署形态**：私有化交付 = **每客户一套独立若依实例**；线上 SaaS = **一个多租户若依单实例**（sys_tenant 隔离）。两档并存，先从一档起步。
- **生成管线 = 混合**：实体 CRUD 走 **codegen（一次）**；角色/菜单/字典/**数据权限**走若依**运行时配置**（不重编译）。最小化 Java build 次数。
- **底座** = RuoYi-Vue-Plus（Spring Boot 3、多租户、信创适配、MIT）。本地学习/MVP 用 **MySQL**；信创(达梦/人大金仓)留真单子（RuoYi-Vue-Plus 本就能切库）。

## 1. 适配缝已存在 ✅
[backend-runtime.interface.ts] 的 `BackendRuntime`（`provision/health/teardown` + `kind`）就是 ADR-0001 为路 C 预留的底座适配器。接若依 =
- `BackendRuntimeKind` 加 `'ruoyi'`。
- 新增 `RuoyiRuntime implements BackendRuntime`，`provision` 不再建 Postgres 表，而是**驱动若依 codegen + 运行时配置**。
- 前端/传感器/部署编排**不改**（契约不变，仅换实现）。

**唯一要扩的**：`provision(projectId, dataModel: string)` 现在只收 Prisma 文本，信息不够（若依还要角色/数据权限/菜单）。改为收一份**应用规格** `AppSpec`：
```
AppSpec {
  entities: ParsedModel[]          // ✅ 已有(data-model.types.ts)：实体+字段+类型
  roles:    { name, dataScope }[]  // 来自需求补全(spec.roles + D 的"数据权限"缺口)
  menus:    { name, path, entity }[] // 来自 planSummary.pages / spec.pages
}
```
> `ParsedModel`、`roles`、`pages` 这几天都已在 IR 里产出（A/D/E + 回写），是现成的料。

## 2. IR → 若依映射表（核心）
### 2.1 实体字段 → 若依 gen_table_column 🟡
| 思想动力 (ParsedModel.field) | 若依 gen_table_column | 备注 |
|---|---|---|
| prismaType `String` | columnType `varchar`/`text`、javaType `String`、htmlType `input`/`textarea` | |
| `Int`/`BigInt` | `int`/`bigint`、`Long`/`Integer`、`input` | |
| `Decimal`/`Float` | `decimal`、`BigDecimal`、`input` | 金额精度→若依 decimal(p,s) |
| `Boolean` | `tinyint`、`Integer`/`Boolean`、`select`(0/1) | |
| `DateTime` | `datetime`、`Date`、`datetime` | |
| `Json` | `json`/`text`、`String` | 列表/查询默认关 |
| `isId` | isPk=1、自增或雪花 | |
| `optional=false` | isRequired=1 | |
| (默认) | isInsert/isEdit/isList=1；短文本 isQuery=1 | 可由 LLM/规则细化 |
> 需一张 **prismaType → {MySQL columnType, javaType, htmlType, queryType}** 映射常量（类比现有 `SCALAR_TYPE_MAP`，新增 MySQL 版）。

### 2.2 角色/数据权限 → 若依 RBAC（运行时配，不 codegen）🟡
- 需求补全的 `roles` → `sys_role`。
- D 判出的 **"数据权限(数据范围控制)"缺口** → 若依 `sys_role.data_scope`：1全部/2自定义/3本部门/4本部门及以下/**5仅本人**。
  - "普通用户只看自己" → data_scope=5；"管理员看全部" → data_scope=1。**这正是 demo 修不出、若依开箱即有的那块。**
- 角色↔菜单 → `sys_role_menu`。

### 2.3 页面 → 若依菜单（运行时配）🟡
- `planSummary.pages` / `spec.pages` → `sys_menu`（目录+菜单+按钮权限）。codegen 实体时若依本就会产对应菜单 SQL，可复用。

## 3. provision 两条路径（按部署形态）
- **私有化·独立实例**：起一套专属若依容器（compose）→ 跑实体 codegen → seed 角色/菜单/数据权限 → 健康检查。重，但隔离最强、可气隙打包。
- **SaaS·多租户单实例**：在共享若依里 `sys_tenant` 建租户 → 租户内跑实体 codegen → seed 配置。轻，共享。
> 两路径共用「IR→若依映射」与「运行时配 RBAC」，只在"实例从哪来/租户隔离"分叉。

## 4. 待实例核实（M1 的目标）❓
1. **codegen 自动化路径**：若依 codegen 正常是 UI（导入表→配置→生成→下载/写盘）。自动化候选：① 直接 insert `gen_table`/`gen_table_column` + 调其 `/tool/gen/genCode` 接口；② 直接用其 Velocity 模板引擎离线产码。**起实例跑通一遍手动 codegen，看真实 gen_table 结构与产物。**
2. **产码是否必重编译**：RuoYi-Vue-Plus codegen 产 Java 源码→需 build。确认有无任何运行时动态表/在线表单能力可减重编译（影响"混合"里 codegen 的占比）。
3. gen_table 各字段（queryType/htmlType/dictType 等）的确切枚举值。

## 5. 落地里程碑
- **M1 起实例·学 codegen**：Docker 跑 RuoYi-Vue-Plus(MySQL/Redis)，手动 codegen 一个实体，记录输入(gen_table)/输出(产物+菜单SQL)。→ 核实 §4。
- **M2 契约+骨架**（现栈、零 Java）：`BackendRuntime` 加 `'ruoyi'`；`AppSpec` 类型；`RuoyiRuntime` 骨架 + prismaType→若依映射常量 + 单测。
- **M3 单实体打通**：IR→gen_table→codegen→起得来的 CRUD 模块（先 SaaS 多租户单实例一条路径）。
- **M4 RBAC 运行时配**：roles/data_scope/menu seed，验"管理员看全部/普通用户看自己"真生效。
- **M5 私有化独立实例路径** + 信创切库（达梦）——留真单子。

## 6. 与现有的衔接
- 控制面（NestJS：需求/规格/编排/传感器/守护）**不动**；若依只在"生成 App 的后端"那侧。
- ADR-0005 建造回路（已并行化）= 栈无关编排：M3 起 `RealBuildStepRunner` 的 step 从"产 demo HTML"渐进替换/并存为"产若依模块"，编排/认领/续跑复用。
- demo 分段生成 = 降级为**售前快速预览**；真交付走若依。
