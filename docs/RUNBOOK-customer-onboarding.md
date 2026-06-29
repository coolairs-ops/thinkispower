# RUNBOOK：一个政企客户从零上线（一客户一套独立部署）

> 交付手册。对齐 [WHITEPAPER v2](./WHITEPAPER-value-and-delivery-v2.md)（单客户单系统模型）与 [ADR-0012](./architecture/ADR-0012-one-console-rbac-vs-two-interfaces.md)（若依统一控制台）。
> 适用：给一个政企客户私有化交付一套可登录、带 RBAC/数据权限/审计的若依控制台。
> 不适用：多租户 SaaS（本模型每客户一套独立部署，天然隔离，见 [ADR-0017 搁置](./architecture/ADR-0017-one-tenant-per-project-isolation.md)）。

---

## 0. 模型与边界（先和客户对齐，再开工）

- **一个客户 = 一套独立私有化若依底座**。客户内业务人员"种"出的多个应用（客户管理/设备报修/巡检…）**共用这一套**，靠角色 + 数据权限 + 菜单分隔。客户之间各自独立部署、物理隔离。
- **走链B（若依控制台），不用链A（crud 自造前端）**——链A 是交付不确定性来源，政企交付一律链B。
- **现货 vs 路线图（WHITEPAPER §八，必须对客户讲清）**：
  - 现货：私有化若依控制台、登录、角色/数据权限、全程审计留痕、源码交付、**配置级改动当天生效**。
  - 按天级：新增模块（要重编译重启若依，有停服窗口）。
  - 路线图/按需定制（**不当现货卖**）：ERP/OA 连接器、行业知识库、全域数据治理。

---

## 1. 前置环境

### 1.1 客户侧（这一套部署在客户服务器 / 客户的云 / 你托管的一台）
- **Linux 服务器**（强烈建议；避开 Windows docker bind-mount 导致的冷启慢/脆）。
- **JDK 17 + Maven**（⚠️不是只放 fat-jar——本平台交付模型是 codegen 产 Java 源码后**在该实例上重编译**，所以实例需要完整构建环境 + 若依源码）。
- **MySQL 8**（库 `ry-vue`）、**Redis**。
- **若依-Vue-Plus 源码**（`RuoYi-Vue-Plus`，部署到 `RUOYI_SRC_ROOT`）+ **plus-ui 源码**（部署到 `RUOYI_UI_ROOT`）。
- **Nginx**（托管控制台前端 dist + 反代 /prod-api）。

### 1.2 平台侧（思想动力，可与客户实例同机或独立）
- 思想动力 `apps/api`（NestJS）+ `apps/web`（Next.js）+ Postgres + Redis。
- LLM：`AI_MODE=local`（数据不出域，政企/信创卖点）或 DeepSeek key。

---

## 2. 起若依后端（生产档）

1. 初始化 `ry-vue` 库（导入若依-Vue-Plus 自带 SQL）。
2. **放宽 MySQL 握手超时**（避免 boot 期 HikariCP 撞 `connect_timeout`）：
   `SET GLOBAL connect_timeout=120;`（MySQL 重启会丢，写进配置或启动脚本）。
3. **生产用 fat-jar 起 `ruoyi-server`**（`java -jar`，冷启 30–60s；不要用 dev 的 exploded/bind-mount，那是 dev 慢的根源）。
4. 验活：能访问若依登录接口、`admin/admin123` 能登。

> 注意：第 3 步只解决**启动**快慢；**新增模块仍会触发重编译**（见 §7 变更口径）——这是 codegen 交付模型的固有代价，对客户讲明"新模块=按天级+停服窗口"。

---

## 3. 平台指向这套客户实例（env）

编辑 `apps/api/.env`（每个客户一套 env；多客户可用多份 env / 多实例平台）：

| env | 含义 | 示例 |
|---|---|---|
| `RUOYI_BASE_URL` | 若依后端地址 | `http://<客户内网>:8080` |
| `RUOYI_SRC_ROOT` | 若依源码根（codegen 写 Java + 编译） | `/opt/ruoyi` |
| `RUOYI_MODULE` | 业务模块路径 | `ruoyi-modules/ruoyi-system`（默认）|
| `RUOYI_UI_ROOT` | plus-ui 源码根（codegen 落 vue + build） | `/opt/plus-ui` |
| `RUOYI_MYSQL_HOST/PORT/USER/PASS/DB` | 建表用 MySQL | `…/3306/root/***/ry-vue` |
| `RUOYI_CLIENT_ID` | 若依 clientId | 默认 `e5cd7e48…` |
| `RUOYI_USER`/`RUOYI_PASS` | 平台调若依的管理账号 | `admin`/`***` |
| `RUOYI_TENANT` | 租户号（单客户固定） | `000000` |
| `RUOYI_COMPILE_CMD` | 重编译命令（按客户构建方式配） | `mvn -o -q compile -pl <module>` |
| `RUOYI_RESTART_CMD` | 重启若依命令 | `systemctl restart ruoyi`（或 docker restart）|
| `RUOYI_CONSOLE_URL` | 控制台对外地址（nginx，见 §5） | `https://console.<客户域>` |
| `RUOYI_CONSOLE_API_PREFIX` | 控制台代理前缀 | `/prod-api`（默认）|
| `RUOYI_CONSOLE_BUILD_CMD` | plus-ui 生产构建 | `npm run build:prod`（默认）|
| `RUOYI_DEFAULT_USER_PWD` | 初始账号默认密码 | `123456`（交付后让客户改）|

改完 env：`cd apps/api && npm run build` 后重启 API。

---

## 4. 在平台跑链B交付

**界面**（推荐）：平台登录 → 新建项目 → 需求访谈 → 规格 → 预览(demo) → **方案页打开「用若依底座」** → 终稿交付。
**或 headless**：`POST /api/projects/:id/delivery/deliver`（带平台 token）。

交付一步自动完成（无需手工 SQL）：
建表(DDL，自动加 tenant_id 等基础列) → 若依 codegen(中文标签) → **重编译** → 重启 → 等就绪 → seed 项目专属角色/data_scope → 建业务模块菜单+权限点(挂「业务模块」目录) → 种项目专属账号(`<projId8>_u1/u2`) → `build:prod` 控制台 → 上线门。

终态：`goLiveStatus=completed`、`productionUrl=RUOYI_CONSOLE_URL`、交付页显示**项目专属登录账号**。

---

## 5. 部署控制台（plus-ui）— 当前唯一手工环节

平台只做 `build:prod` 产出 `dist`；**把 dist serve 出来要在客户侧配一次 nginx**（单客户一套，配一次即可）：

```nginx
server {
  listen 80;                      # 或 443 + TLS
  server_name console.<客户域>;
  root /opt/plus-ui/dist;         # plus-ui build:prod 产物
  location / { try_files $uri $uri/ /index.html; }   # SPA history fallback
  location /prod-api/ {           # 控制台→若依后端 的代理(必须，否则前端调不到后端)
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

要点：`RUOYI_CONSOLE_URL` = 这个 nginx 地址；`/prod-api` 前缀要和 `RUOYI_CONSOLE_API_PREFIX` 一致；若 plus-ui 生产构建开了加密，需与若依实例配置对齐（dev 曾踩"加密不匹配→登录未知异常"）。

> 这一步就是 WHITEPAPER §七 说的"serve 部署基建"。单客户手工/脚本起一次可接受；要量产再做自动化（候选②）。

---

## 6. 冒烟验收（确定性二值，别靠感觉）

1. 上线门：`GET /api/projects/:id/delivery` → `goLiveStatus=completed`。
2. **经控制台代理冒烟**：用交付页给出的**项目专属账号**，经 `RUOYI_CONSOLE_URL/prod-api/auth/login` 登录 + 首个业务资源 `list` 返 200（守护中心 `probeRuoyiConsole` 也跑同一口径）。
3. 浏览器实登：用 `<projId8>_u1`/`123456` 登控制台 → 只见本项目业务菜单（在「业务模块」下）。

---

## 7. 交付给客户

- **账号清单**：项目专属账号 `<projId8>_u1`(管理员·全部数据) / `<projId8>_u2`(普通·仅本人)，默认密码 `123456` → **务必让客户首次登录改密**。
- **⚠️ 勿把若依超管 `admin` 给终端用户**：admin 是跨项目超管、看到所有模块；终端用户一律用项目专属账号（只看本项目）。
- **变更口径**（写进交付说明）：
  - 配置/权限/菜单类改动 → **当天生效**（运行时配置，不重启）。
  - 新增模块/改业务逻辑 → **按天级**（重编译重启窗口，单客户可错峰）。
- **范围**：交付物 = CRUD 管理后台 + RBAC + 审计。地图/语音/AI/连接器等 = 路线图，不在本次现货内。

---

## 8. 守护与运维

- 守护中心自动把有 `productionUrl` 的项目入列、定时巡检（对若依控制台走**代理 login+list 深探**，不被"首页 200 但登不上"骗）；掉线→critical 告警。
- 所有变更经平台留痕（`goLiveStatus` + 结构化日志 = 审计护城河，WHITEPAPER 价值三）。
- 实例运维（起停/备份/扩容）在客户侧；建议 fat-jar + systemd + MySQL 定时备份。

---

## 附：当前已知手工/限制（诚实清单）

- **serve 部署**（§5 nginx）手工配一次——候选② serve 自动化未做，单客户可接受。
- **新增模块要重编译**——codegen 交付模型固有；客户实例需 JDK+Maven+源码（非纯 fat-jar 运行时）。
- **冷启/编译**在 Windows 慢；生产用 Linux + fat-jar。
- **连接器/行业库/全域数据**=路线图，不当现货。
