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

## 4. 关键事实（2026-06-20 已据源码核实，非推断）✅
> 读 RuoYi-Vue-Plus 源码 `ruoyi-modules/ruoyi-generator` 得，未起实例：
1. **codegen 自动化 = REST API**（`GenController` `/tool/gen/*`）：
   - `POST /importTable?tables=&dataName=` 从**已存在的 DB 表**反射列 → 落 `gen_table`/`gen_table_column`。
   - `PUT /tool/gen`（editSave）改字段配置（javaType/isList/isQuery/htmlType/queryType/dictType…）。
   - `GET /preview/{tableId}` → **返回 `Map<文件名,代码>`（内存，不落盘）** ← 自动化可直接拿产码。
   - `GET /download/{tableId}` / `batchGenCode` → zip。
   → **provision 流程**：据 ParsedModel **先建实体表** → importTable → (editSave 配字段) → preview 取码。
2. **产码必重编译 = 是**（base RuoYi-Vue-Plus **无运行时动态表/在线表单**，grep online/动态表单 0 命中）。codegen 产 `.java/.vue/.ts/.xml` 源码 → 必须塞进若依工程 **Maven build + 重部署**才跑得起。
   - **但** 菜单/按钮权限是 `sys_menu` 的 SQL insert（模板 `sql.vm`，menu_type C菜单/F按钮+perms），角色=`sys_role`、字典=`sys_dict`、**数据权限=`sys_role.data_scope`**——全是 sys_* 表数据、**运行时 SQL 可配、零重编译**。
   - ⇒ **强化"混合"决策**：只有**实体 CRUD（Java/Vue 源码）背负一次 build**；RBAC/菜单/字典/数据权限全运行时配。每个生成 App（或实体模型变更）= 一次 Java build+deploy（分钟级）——这是最重的一环，也是与路 B「运行时通用 CRUD、零 build」的根本差异。
3. **gen_table_column 元数据**（16 字段）已确认：columnName/columnComment/columnType/javaType/javaField/isPk/isIncrement/isRequired/isInsert/isEdit/isList/isQuery/queryType(EQ/NE/GT/LT/LIKE/BETWEEN)/htmlType(input/textarea/select/checkbox/radio/datetime/image/upload/editor)/dictType/sort。§2.1 映射表据此成立。
4. **docker-compose 现成**：`script/docker/docker-compose.yml`（MySQL/Redis/Nginx），起实例端到端验证用。

### M3 端到端已实测（2026-06-20，真·运行的 RuoYi-Vue-Plus）✅
- **起实例**：maven 容器从源码构建 `ruoyi-admin.jar`(163MB fat jar，首次含依赖下载，分钟级) → eclipse-temurin:17-jre 跑 jar + MySQL8 + Redis(同 docker 网络，容器名互连)。
- **跑通 codegen**：登录拿 JWT → `POST /tool/gen/importTable?tables=demo_store&dataName=master` → `GET /tool/gen/list` 取 tableId → `GET /tool/gen/preview/{tableId}` → **返回 12 个文件**：domain/vo/bo/mapper/service/serviceImpl/**controller**(Java) + mapper.xml + **sql(菜单)** + api.ts/types.ts + **index.vue**。controller 是完整 RuoYi CRUD（SaCheckPermission/分页/Excel）。**证实：实体 → 完整可跑 CRUD 源码。**
- **起实例踩的坑（M3b/provision 自动化要处理）**：① host 连容器要用 `127.0.0.1` 不能 `localhost`(IPv6) ② Redis 必须配密码(dev 默认 `ruoyi123`，Redisson 发 AUTH) ③ 多租户登录要 `clientId`(sys_client，PC=`e5cd7e4891bf95d1d19206ce24a7b32e`) ④ **默认开**验证码(`captcha.enable`)+**全局接口加密**(`api-decrypt.enabled`，login 体 RSA/AES)——自动化要么关、要么 RuoyiRuntime 实现 RSA 握手 ⑤ snail-job 客户端连不到调度server(8800)会刷 grpc 重连日志，非致命。
- **build 成本已量（M3c）**：依赖缓存后 `mvn package -pl ruoyi-admin -am` 全 reactor 重编译 **≈ 6 分钟**（本机；各模块 common/system/generator/demo/workflow/admin 串行编译 + admin 的 spring-boot fat-jar repackage 是大头）。⇒ **每 App（或实体模型变更）≈ 一次 6min build**，正是"混合"决策要把 RBAC/菜单/数据权限放运行时、尽量少碰 codegen/build 的原因。（注：增量 build 不能省 `clean`，否则 repackage 撞已有 fat jar 报 `.jar.original` 错。）
- **M3b/M3c 代码已落**：`RuoyiClient`(REST,LIVE 实测产 12 文件)、`ruoyi-ddl.ts`(ParsedModel→建表)、`RuoyiRuntime` 组装链(ddlFor/generateSources)。
- **fat-jar Velocity 坑（M3c 实测发现）**：若依 codegen 用 Velocity ClasspathResourceLoader 读 `vm/*.vm` 模板，**Spring Boot fat-jar 下偶发 `unable to find resource 'vm/java/domain.java.vm'`**（preview/download 首次能跑、之后失效）。生产化要么**以 exploded jar / 解压模板**跑若依，要么 provision **一次性抓 codegen 产物缓存**。属部署 nuance，非集成/codegen 机制问题（12 文件早先已实证产出）。
- **M3c-remaining（操作最后一公里，刻意未做）**：把 12 文件按若依模块结构塞回工程 → build → redeploy → 真访问新 CRUD 端点；seed sys_role/menu/data_scope；`RuoyiRuntime.provision` 串完整链。**为何不在 study 阶段做**：① 现卡在上面的 fat-jar Velocity nuance（折腾"跑若依"非折腾集成）② 本质是重验若依标准 codegen 产物能否编译运行（零疑问、每个若依用户日常）③ 要烧多轮 6min 构建、脆。**闭环已在原理+实践证通**（codegen 真产完整 CRUD + 我们的代码真驱动 + 成本量化），剩的是生产化收尾，等真正接生产时连同"exploded jar 跑若依 / provision 缓存产物"一并做。

> 实例容器：`ruoyi-mysql`/`ruoyi-redis`/`ruoyi-server`(8080) 在 docker 网络 `ruoyi-net`；源码 `D:\ruoyi-study`。启动 jar 需覆盖：`api-decrypt.enabled=false`、`captcha.enable=false`、`spring.data.redis.host/password`、datasource url 的 host→容器名。

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
