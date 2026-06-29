# 交接：思想动力底座选型 —— RuoYi-FastAPI 评估与 PoC（2026-06-29）

> 新窗口读这份 + [`docs/architecture/EVAL-ruoyi-fastapi-base.md`](architecture/EVAL-ruoyi-fastapi-base.md)（完整评估+PoC-1/3 实测）就能续。本文管"现状/怎么续跑/决策卡哪/坑"。

---

## 1. 一句话现状

平台负责人在评估**用一份魔改 RuoYi-FastAPI（Python 若依 + vfadmin 前端）替换/统一底座**（战略：党政市场靠产品+架构断崖领先·效果第一）。**PoC 三命门已实测全过**；**决策未拍板**，卡在一道商业闸（目标客户是否要 Java）。

## 2. 评估结论（详见 EVAL 文档）

RuoYi-FastAPI = FastAPI+SQLAlchemy(async)+**MySQL/PG 双支持**+vfadmin(Vue3)+codegen(REST 驱动,产 Python+Vue)+data_scope+**无 JVM 编译**+单租户。**PoC 三命门全过**：
- **① codegen 确定性出全栈**：`/tool/gen` REST(与 Java 若依路径对齐)，`preview_code` 返回代码 dict 不落盘不编译，8 产物(controller/dao/do/service/vo + Vue3 + menu.sql + api.js)。
- **② 免编译上线**：生成 .py 放进模块树→重启 ~5s→接口 200（对比 Java 若依 ~10min 编译=断崖）。
- **③ data_scope 改模板一次生效**：改 controller/service/dao 三 jinja2 各一处注入 →实测 admin 看全部 / 仅本人用户只看自己。**权限分身卖点成本=一次性模板改**（优于 Java 后注入 Mapper）。

**断崖优势**：秒级无编译 + PG 统一(信创 PG 系利好) + 模板可控(数据权限/审计确定性注入) + Python 嵌 AI 天然。

## 3. 决策状态（**未拍板，新窗口接着推**）

时机分析结论：**生命周期时机有利**（现在零真客户=换底座最便宜的窗口，越晚越贵），但全面切**为时过早**，卡两道闸：
- **闸一（决定性·商业·先答）**：目标党政客户招标/信创是否**写死 Java**？写死→FastAPI 出局；只要"国产 OS+国产库"→FastAPI+PG 反而更顺。**这道闸免费、不写码、gate 住一切。**
- **闸二（工程）**：还没用任何底座交付过一个真客户。Java 若依链B 已端到端跑通(runbook 就绪)；别在"掀地基"和"上线第一个客户"之间选掀地基。

**建议路径**：① 先答闸一 → ② 若不强制 Java=立项 FastAPI 统一底座(先 PoC-2 摸适配成本)、停止加码 Java 若依；③ 若有迫近真客户=先用 Java 若依链B 上，FastAPI 留下一批/确认后切。

## 4. PoC 环境怎么续跑（关键）

**底座源码**：`C:\Users\coola\Desktop\资料汇集\dev-base-backend-frontend-20260629180008\ruoyi-fastapi-backend`（已 git init，见 §5）。

- **DB**：docker 容器 `poc-ruoyi-pg`（端口 **5434**，user `postgres`/`root`，库 `ruoyi-fastapi`）。已载 `sql/ruoyi-fastapi-pg.sql` + 关 captcha(sys_config) + 建了 `poc_book` 表 + 测试数据。**docker 容器持久**(会话结束不丢)；docker 重启后需 `docker start poc-ruoyi-pg`。
- **Redis**：复用主机 `tip-redis-local`:6379 **DB 2**。
- **App**：venv `.venv-poc`(已装 requirements-pg + boto3)，配置 `.env.poc`(指 5434+6379)。起法（**会话结束 app 会停，需重起**）：
  ```
  cd <backend dir>
  PYTHONUTF8=1 PYTHONIOENCODING=utf-8 APP_RELOAD=false ./.venv-poc/Scripts/python.exe app.py --env=poc
  ```
  端口 **9099**，路由在根路径（`/login`、`/tool/gen/*`、`/system/book/*`；`/dev-api` 只是 root_path 名）。
- **账号**：`admin`/`admin123`(超管)、`booktester`/`admin123`(user_id=100,角色 9001 data_scope=5 仅本人)。登录是 **OAuth2 form**：`POST /login` `application/x-www-form-urlencoded` username/password。
- **已改的模板（PoC 成果，data_scope 注入）**：`module_generator/templates/python/{controller,service,dao}.py.jinja2`。
- **生成的样例模块**：`poc_book/`（已 gitignore，可重生成）。

**重跑 codegen 流程**（平台集成对标）：登录拿 token → `createTable?sql=` 或直接 psql 建表 → `importTable?tables=X` → 补 `gen_table.options`(非空) + 所有列 `column_comment`(不可空,否则模板 `.find()` 崩) → `preview/{table_id}` 拿产物 → 落盘进 `<pkg>/controller/` 单层目录(匹配 router glob `*/controller/[!_]*.py`) → 重启。

## 5. 备份现状

- 底座目录已 `git init`(master, commit `249e84a`, 436 文件)，**推到 GitHub `coolairs-ops/MindDrive.git`**(含 PoC 改过的模板)。排除了 venv/缓存/前端 node_modules/poc_book/PoC scratch。
- **⚠ 密钥未清**：4 个后端 `.env`(JWT_SECRET_KEY `b01c66…`、OSS key `quichtest/quich123`、DB root/root)已进 MindDrive 历史。用户暂不清(认为 dev 占位)。上生产前务必轮换 JWT/OSS；若要清=`git filter` 重写历史+gitignore+force push。

## 6. 实测踩的坑（速查）

- `requirements-pg.txt` **缺 boto3**(OSS 模块要)→ 单独装。
- 登录 captcha 默认开 + 缓存进 Redis → 关 sys_config + 删 redis DB2 `sys_config:sys.account.captchaEnabled` 缓存。
- codegen 前置：`gen_table.options` 须非空 + **每列须有注释**(controller/service/dao 模板裸用 `column_comment.find()`，null 即崩)→ 平台 LLM 中文标签步骤兜。
- 默认父菜单 ID='3'(系统工具)，同 Java 若依菜单挂错坑(平台 `4bac241`)。
- package_name 须**单层**(匹配 router glob `*/controller/`)才自动注册。
- Windows/git-bash 下 **watchfiles 热重载不灵**(新目录监听不到)；**重启可靠且仍免编译**。生产 Linux 预计正常(待 PoC-2 复验)。
- 日志 emoji 撞 Windows GBK → `PYTHONUTF8=1`。
- data_scope "仅本人"按 `user_id` 列过滤；业务表须有 user_id 列+add 填(模板已注入)；本 PoC 只注 list 读路径，export/edit/delete 校验待补。
- bash 里 `UID` 是只读变量，别用作变量名(踩过)。

## 7. 下一步候选

1. **答闸一**(商业·目标客户 Java/信创要求)——决定性、免费。
2. **PoC-2**：平台写最小适配(对标现有 `app-runtime/ruoyi-client`)REST 驱动它，验"零手工全自动"+摸适配成本。
3. 若拍板 → 立项"FastAPI 若依统一底座"ADR，规划 `app-runtime` 适配层重写。
4. MindDrive 密钥清理(可选)。

---

> 相关：[`EVAL-ruoyi-fastapi-base.md`](architecture/EVAL-ruoyi-fastapi-base.md)、[`WHITEPAPER-value-and-delivery-v2.md`](WHITEPAPER-value-and-delivery-v2.md)、[`ADR-0012`](architecture/ADR-0012-one-console-rbac-vs-two-interfaces.md)(若依统一控制台)、[`ADR-0017`](architecture/ADR-0017-one-tenant-per-project-isolation.md)(租户搁置)。备份仓库：github.com/coolairs-ops/MindDrive。
