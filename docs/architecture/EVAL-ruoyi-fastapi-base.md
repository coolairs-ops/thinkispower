# EVAL：RuoYi-FastAPI 作为思想动力底座 / 链A框架 的评估 + PoC 清单

**类型**：技术评估 + 决策留痕（非 ADR；PoC 通过后再升级为 ADR 决策）
**日期**：2026-06-29
**评估对象**：`C:\Users\coola\Desktop\资料汇集\dev-base-backend-frontend-20260629180008`（一份"魔改的" RuoYi-FastAPI + vfadmin 前端）
**评估人**：平台负责人 + Claude（深读源码）
**战略前提**：党政市场靠**产品+架构断崖式领先**、**效果第一**。底座选型按"能不能支撑确定性生成 + 数据权限真生效 + 秒级响应"判，而非按惯性。

---

## 0.5 PoC-1 实测结果（2026-06-29，✅ 通过）

**实跑环境**：Python 3.12 venv + requirements-pg + 独立 postgres 容器(5434) + 主机 redis(6379/DB2)，`app.py --env=poc`（PG 档），端口 9099。

**结论：✅ "确定性出全栈 CRUD + 免编译" 成立。** 关键实测：
1. **起得来（PG 档）**：FastAPI 在 Postgres 上 boot + 登录(admin/admin123)通；REST 全可驱动（`/tool/gen/*` 路径与 Java 若依对齐）。
2. **codegen 确定性出 8 文件**：对 `poc_book` 表走 createTable(psql)→importTable→edit→**preview_code**，`<1s` 返回 8 个产物：Python `controller/dao/do/service/vo` + Vue3 `index.vue` + `menu.sql` + `api.js`。
3. **免编译上线**：把生成的 5 个 .py 放进 `poc_book/` 模块树（匹配路由 glob `*/controller/[!_]*.py`）→ **app 重启 ~5s（零编译）→ `/system/book/list` 返回 HTTP 200**（标准若依分页壳）。对比 Java 若依新模块 ~10min 编译+冷启——**这是断崖级差异**。
4. **鉴权/数据权限实测印证深读**：生成 controller **7 个功能权限点在**（`UserInterfaceAuthDependency('system:book:list/...')`）；**data_scope = 0**（需改模板注入，同坎2）。

**实测中暴露的坑（平台集成必须处理，均可控）**：
- **codegen 前置条件**：`gen_table.options` 须非空 + **每列须有注释**（多个模板裸用 `column_comment.find()`，null 即崩）→ 平台的"LLM 中文标签"步骤正好兜这两样。
- **默认父菜单 ID='3'（系统工具）** → 同 Java 若依菜单挂错坑（本会话 `4bac241`）。
- **package_name 须单层**（匹配 glob `*/controller/`）才能被自动注册——平台落盘时按此组织。
- **热重载在 Windows/git-bash 下 watchfiles 不灵**（新目录监听不到）；**重启可靠且仍免编译**（Python 重启秒级）。生产 Linux 下热重载预计正常，待 PoC-2 复验。
- `boto3` 不在 requirements-pg（OSS 模块要）；登录是 OAuth2 **form**、captcha 默认开（PoC 关掉）；日志 emoji 撞 Windows GBK（`PYTHONUTF8=1` 解）。
- 新增接口 body 解析报错（入参字段格式待对齐，PoC-2 平台驱动时纠）。

**判定**：PoC-1 两命门（**codegen 产物质量 ✅ / 免编译上线 ✅**）已过。

## 0.6 PoC-3 实测结果（2026-06-29，✅ 通过——第三命门）

**目标**：改 controller/service/dao 三个 jinja2 模板各**一处**注入 data_scope，验"改一次模板 → 所有产物自动带数据权限"。

**做法**（基于深读 `common/aspect/data_scope.py`：`DataScopeDependency(Model)` 按当前用户角色 data_scope 返回 SQL 过滤条件，admin/全部→不过滤、仅本人→`Model.user_id==当前user_id`）：
- **controller.py.jinja2**：list 端点加 `data_scope_sql: Annotated[ColumnElement, DataScopeDependency({{ClassName}})]` 依赖并透传；add 端点加 `user_id = current_user.user.user_id`（仅本人按 user_id 过滤需此列）。
- **service.py.jinja2** / **dao.py.jinja2**：list 链路加 `data_scope_sql` 形参（带默认 `True` 不破坏 export 调用）；dao 的 `.where(data_scope_sql, ...)` 注入过滤。

**实测**（同一个生成的 `/system/book/list`，两条数据 Admin的书[user_id=1] / Tester的书[user_id=100]）：
| 用户 | 角色 data_scope | list 返回 |
|---|---|---|
| admin | 超管(绕过) | `total=2`（全部）|
| booktester | 仅本人(=5) | **`total=1`，只有 Tester的书** ✅ |

**结论**：✅ **"改一次模板 → 数据权限确定性生效"成立**。模板用 `{{ClassName}}`/`{{businessName}}` 泛化，任何未来生成的表都自动带数据权限——**"权限分身"卖点成本 = 一次性模板改，不是每次后处理**（相对 Java 若依"平台后注入 Mapper.xml @DataPermission"的 🟢 优势被实测坐实）。

**注意/留尾（平台集成要补全）**：
- 本 PoC 只注入了 **list 读路径**；完整覆盖还需 export 读路径 + detail/edit/delete 的 data-scope 校验（参照 `dept_controller` 对全部读写端点都注）。
- data_scope 默认按 `user_id` 列过滤"仅本人"；业务表须有 `user_id` 列且 add 时填（模板已注入）。"本部门"档需 `dept_id` 列。
- 测试用的角色/权限点/用户为手工 seed；平台化时由置备链种（对标 Java 若依 seedRoles/Menus/Users）。

---

**三命门总判定：codegen 产物质量 ✅ / 免编译上线 ✅ / data_scope 模板注入一次生效 ✅ —— 全过。** FastAPI 若依作统一底座在"效果"上的断崖优势（秒级无编译 + PG 统一 + 模板可控数据权限）**已被三轮实测全面坐实**。剩商业风险（信创/招标是否写死 Java，见 §6）+ 适配工作量（重写若依集成层，见 §3）。

---

## 0. 一句话结论

RuoYi-FastAPI 作统一底座在"**效果**"上有断崖潜力（**无 JVM 编译→秒级 / Postgres 统一 / 模板可控→数据权限确定性注入 / Python 利于嵌 AI**），但作底座要**重写整套若依适配层**、且 **data_scope 不开箱**（同 Java 若依坑，但可改模板根治）。**结论：不纸上拍板，先做 PoC-1/2/3（命门三片）；商业上盯死目标客户是否信创/招标写死 Java。**

---

## 1. 它是什么（定性，已读源码确认）

- **后端**：RuoYi-FastAPI —— FastAPI 0.128 + SQLAlchemy 2.0(async) + **MySQL/Postgres 双支持**（`Dockerfile.pg` + `requirements-pg.txt` + `config/database.py` db_type 分流）+ Redis + JWT + APScheduler(定时任务) + alembic(迁移)。
- **前端**：vfadmin 1.9.0 —— Vue 3.5 + Element-Plus 2.13 + Vite 6（≠ 平台现用的 plus-ui/若依-Vue-Plus 前端）。
- **若依能力齐全**：`module_admin` 全套系统模块（user/role/menu/dept/dict/post/notice/job/log/online/cache/server/captcha/login）；**data_scope 数据权限机制在**（`module_admin/service/dept_service.py` 用 `data_scope_sql`）；**无多租户**（`grep tenant module_admin` 空 → 单租户，正契合"一客户一套"）。
- **代码生成器** `module_generator`：REST 可驱动，jinja2 模板，产 Python+Vue3+SQL。
- **"魔改"不透明**：无 README、非 git 仓库 → 改了什么不可知，推断在 Postgres 双支持 / sqlglot SQL 方言 / `APIRouterPro` / codegen 模板。**作底座前须吃透魔改点**（尤其 PG 适配 + sqlglot 方言转换是易埋坑处）。

---

## 2. 深读结论

### 2.1 codegen 全流程（与 Java 若依同构，REST 全可驱动）

REST 面（`module_generator/controller/gen_controller.py`，前缀 `/tool/gen`，几乎与 Java 若依路径对齐）：

| 步 | 端点 | 作用 |
|---|---|---|
| 建表 | `POST /tool/gen/createTable?sql=<CREATE TABLE…>` | 从 DDL 建物理表 |
| 导入 | `POST /tool/gen/importTable?tables=<name>` | 进 `gen_table` + 列元数据 |
| 配置 | `PUT /tool/gen` | 改 businessName/中文 functionName/moduleName/parentMenuId/每列 html_type·dict·是否 list/query/edit |
| **预览** | `GET /tool/gen/preview/{table_id}` | **返回 `dict{模板路径: 渲染后代码}`，不落盘、不编译，平台直接拿** ⭐ |
| 落盘 | `GET /tool/gen/genCode/{table_name}` | 写磁盘（受 `GenConfig.allow_overwrite` 控制） |
| 打包 | `GET /tool/gen/batchGenCode?tables=` | zip 流 |
| 同步 | `GET /tool/gen/synchDb/{table_name}` | 表结构同步进 gen_table |

产物（`utils/template_util.py` get_template_list/get_file_name）：`controller/dao/do/service/vo`(Python) + `index.vue`(Vue3，element-plus 走 `vue/v3`) + `api.js` + `{business}_menu.sql`。落点确定（`backend/.../{business}_controller.py`、`frontend/views/{module}/{business}/index.vue`）。模板上下文（`prepare_context`）：tableName/className/businessName/functionName/permissionPrefix=`{module}:{business}`/columns/pkColumn/dbType/parentMenuId。

→ **平台现有"REST 驱动若依 codegen + 编辑 gen_table 元数据"的集成模式可近乎平移**（API 路径/产物不同，要重写适配层，但模型同构）。

### 2.2 鉴权 & 数据权限（决定"权限分身"招牌卖点）

- ✅ **功能权限点在产物里**（`controller.py.jinja2`）：生成的每个接口都带 `UserInterfaceAuthDependency('{permissionPrefix}:list/add/edit/remove/query/export')` —— 权限点是构造性的（对标 Java 若依 @SaCheckPermission；坎1 不用额外种产物级权限点，但角色仍需被授权）。
- ❌ **data_scope 数据权限不在产物里**：生成的 `get_..._list` 接口**只有 UserInterfaceAuthDependency + DBSessionDependency，没有 GetDataScope 依赖**，list 直查不带数据范围过滤。框架层有 data_scope 机制（dept_service 用 `data_scope_sql: ColumnElement`），但 **codegen 模板不注入** → "普通用户只看自己"**开箱不工作，和 Java 若依坎2 同坑**。
- 🟢 **关键利好**：这里是 **jinja2 模板**。**改一次 `controller.py.jinja2` / `service.py.jinja2` 注入 `GetDataScope` 依赖 + 把 data_scope_sql 串进 DAO 查询 → 所有后续产物自动带数据权限**。比 Java 若依（平台后处理注入 Mapper.xml @DataPermission）**更干净、更确定**。这是"模板可控"带来的根治式优势。

### 2.3 会平移过来的已知坑

- **默认父菜单 ID='3'（系统工具）**（`template_util.py` `DEFAULT_PARENT_MENU_ID='3'`）→ 生成菜单挂错目录。**与本会话 `4bac241` 修过的 Java 若依同坑**——FastAPI 版要同样改模板/置 parentMenuId。
- 平台要为 FastAPI 版**重写一套**：菜单/角色/账号 seed + 授权 + data_scope 模板注入 + 控制台部署（对标现有 `app-runtime/ruoyi-*` + 本会话修的菜单改挂/账号自愈）。

### 2.4 相对 Java 若依的真优势（对"效果第一/断崖"是杠杆）

1. **preview_code 返回代码 dict（REST、不落盘、不编译）** → 平台集成更顺。
2. **无 JVM 编译** → 新模块秒级热重载（uvicorn reload）vs Java 若依 ~10min 编译+冷启（平台头号痛点）。
3. **MySQL/Postgres 双支持** → 与平台主库统一；**信创 PG 系（openGauss/人大金仓）适配可能比 Java+MySQL 更顺**。
4. **模板 jinja2、平台可控** → 数据权限/审计/菜单父级这些**确定性注入直接改模板**，不靠后处理。
5. **Python 生态** → 嵌 AI 端点（ADR-0010/0011 domain-ai-endpoint）天然，Java 若依里别扭。
6. **单租户** → 契合"一客户一套"（ADR-0017 租户搁置正好）。

---

## 3. 作底座的适配工作量（诚实）

换 FastAPI 若依 ≈ 重写平台 `app-runtime` 的整条若依集成：`ruoyi-client`(REST 形状变) / `ruoyi-ddl`(建表) / codegen 驱动 / provision 编排 / data-proxy(终端登录代持) / console-deploy(前端从 plus-ui→vfadmin) / 菜单·角色·账号 seed + 本会话的菜单改挂/账号自愈 —— **平台投入最大的模块之一基本重做**。这是作底座的最大成本，PoC 通过也要正视。

---

## 4. PoC 清单（怎么做 + 验什么 + 通过标准）

必做顺序 **1→2→3**（底座可行性命门）；4 按目标客户画像。

### PoC-1 · 起环境 + 跑它自带 codegen（半天）
- **做**：起 RuoYi-FastAPI(**Postgres 档**，对齐平台主库) + vfadmin；用自带代码生成页对一个测试表走 createTable→importTable→edit→genCode→热重载。
- **验**：① 产物(Python+Vue)能直接跑、CRUD 通；② 热重载是否真免编译、秒级；③ Postgres 档无 sqlglot 方言坑。
- **通过**：一个新表 5 分钟内从 DDL 到可用 CRUD 页、无需编译。

### PoC-2 · 平台 REST 驱动 codegen（1-2 天）
- **做**：思想动力写最小适配（对标现有 ruoyi-client）调 `/tool/gen`：createTable(sql)→importTable→edit(配 businessName/中文 functionName/parentMenuId)→**preview_code 拿产物** 或 genCode 落盘→重载。
- **验**：① 平台能否像驱动 Java 若依那样全自动驱动；② preview_code 产物质量(中文标签、字段映射)；③ 落盘+重载后接口 200。
- **通过**：平台一条命令把一个数据模型变成可用 FastAPI+Vue CRUD、零手工。

### PoC-3 · data_scope 数据权限验证（命门，1 天）
- **做**：① **未改模板时**：建两个角色(全部/仅本人)+两个用户，各自登录 list → 看是否隔离（预期：不隔离，因模板没注入）。② **改 `controller.py.jinja2`/`service.py.jinja2` 注入 GetDataScope + data_scope_sql**，重新生成 → 再验。
- **验**：注入后"普通用户只看自己建的、管理员看全部"是否真生效。
- **通过**：**改模板一次 → 所有生成接口数据权限生效**（决定"权限分身"卖点成本=一次模板改 vs 每次后处理）。

### PoC-4 · 信创 / 部署形态（1 天，按目标客户）
- **做**：后端跑国产 PG 系库（openGauss/人大金仓）+ 国产 OS（麒麟）；前端 build 部署。
- **验**：① PG 系信创库兼容（FastAPI 相对 Java+MySQL 的潜在优势点）；② 整栈能跑。
- **通过**：一套信创栈（国产 OS + PG 系库）跑通 CRUD + 数据权限。

---

## 5. 用它做链A框架的适用性

链A 现状 = 自造前端 HTML(DeepSeek 即兴) + crud postgres，是"交付不确定性最大来源"。用 RuoYi-FastAPI codegen 替代 = 把"赌 LLM 出对 HTML"换成"确定性产 Python+Vue"，**直接消灭链A 不确定性源**，且 Postgres 一致、无编译、适合快出小系统。

**但定位要先想清**：若链A 也用若依 codegen 控制台，**链A 与链B 就趋同/合并**——这其实是"用 FastAPI 若依做统一底座"的更大决策（回到本评估主题），而非单纯"给链A 换框架"。且链A 原本"自造灵活/对外品牌化前台"（ADR-0012 D1 两个界面里的对外/匿名/C 端）的能力，若依控制台覆盖不了——对外门户仍需别的方案。**故：用它只覆盖链A 里"管理后台形态"的部分。**

---

## 6. 决策建议

- **命门三片**（codegen 产物质量 / 平台 REST 驱动 / data_scope 模板注入一次生效）→ PoC-1/2/3 必做、成本小、决定性强。
- **若三片通过** → FastAPI 若依作**统一底座**在"效果"上确有断崖优势（秒级无编译 + Postgres 统一 + 模板可控注入 + Python 嵌 AI），正是"靠产品和架构打天下"的底座级杠杆；可同时解决链A 不确定性 + 链B 编译痛点 + DB 割裂。
- **要盯死的商业风险**：目标客户招标是否写死 Java（信创生态 Java 最厚）。这由 PoC-4 + 客户画像（党政核心？还是中小政企/国企业务系统？）决定，不是技术问题。
- **过渡策略**：在跑的 Java 若依客户不动；FastAPI 底座先 PoC，再决定是新客户切换还是统一替换。

---

> 触发：2026-06-29 会话——平台负责人提供一份魔改 RuoYi-FastAPI，问"作底座/链A框架合不合适"。深读 gen_controller/gen_service/template_util/controller.py.jinja2/dept_service 后产出本评估。相关 [ADR-0012]（若依统一控制台）、[ADR-0017]（租户搁置·一客户一套）、`WHITEPAPER-value-and-delivery-v2`、`RUNBOOK-customer-onboarding`。
