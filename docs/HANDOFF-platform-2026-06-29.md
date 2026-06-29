# 思想动力平台开发 · 本会话小结与交接（2026-06-29）

> 新窗口续**平台开发**先读这份。细节参考 [`handoff-2026-06-29-ruoyi-console-pipeline.md`](handoff-2026-06-29-ruoyi-console-pipeline.md)（链B 管线全貌）。
> 注：本会话另有一条独立线程"底座选型 RuoYi-FastAPI 评估"，已单独交接 [`HANDOFF-ruoyi-fastapi-base.md`](HANDOFF-ruoyi-fastapi-base.md)，**别和平台开发混**。

---

## 1. 一句话现状

master = **`b94615b`**（Gitee+GitHub 全推；本会话把 `feat/ruoyi-console-autogen` 合入 master）。全仓 **106 套 ~1060 测绿、tsc 0、build 净**。本会话主线=**真人跑 demo/评估/交付又揪出一串链B 平台 bug，全部修回 apps/api 并 live 验过**（铁律：修生成器不修实例）；并立了完整文档轴。链B（若依统一控制台）交付管线更稳。

## 2. 本会话平台代码改动（都已 live 验证）

| commit | 修了什么 |
|---|---|
| `4c5ad83` | **designate 被覆盖根治**：demo 三生成路径 + 路B 部署的 `this.backend.provision`(crud) 会把已选 `{kind:ruoyi}` 抹回 crud → 四处置备前判 kind 跳过，保住若依底座意图。 |
| `8dbc4d4` | **④自迭代缺口处置接线（止损）**：`disposeGap` 大脑此前零调用 → FIX 前 `triageRecommendations` 按能力来源分流，只 self+能产的喂 DeepSeek，其余路由出去；无可迭代项→`routed_stop` 止损，不空转烧 LLM。 |
| `3fea7d0` | **④前端缺口清单**：评估页按类别(平台补建/待外部对接/待后端置备/转人工)展示缺口+客户下一步。 |
| `5c29b21` | **④透传修复**(live 揪出)：`getAutoIterateStatus` 字段白名单漏 routedGaps → 补，running/terminal 两态前端都能渲染。 |
| `921c46d` | **②守护探活深探**：守护对若依控制台改"代理 login+list 深探"(同上线门口径)，不被"首页200但登不上"骗；抽 `smokeRuoyiConsole` 共享。 |
| `a082264` | **上线产品引导专属账号**：getDelivery 带出 consoleLogin(项目专属账号+"勿用 admin 超管"警告)，交付页展示。 |
| `b69e94a` | **重新交付自愈种账号**：ensureProvisioned 对"已 ready 但缺 initialUsers"的旧项目，重新交付时只重跑 seed(不重 DDL/编译)补种项目专属角色/账号。 |
| `4bac241` | **菜单改挂业务模块目录**：seedMenusAndGrant 对已存在 C 菜单(旧置备误挂"系统工具")改挂到"业务模块"目录，自愈"授了菜单却不显示"。 |

**这串 bug 的源头**："demo↔交付不是一个产品"——根因是共享 dev 若依里多项目挤一套(共享控制台/超管串菜单)；**生产一客户一套独立部署不会出现**（业务模型已澄清，见 §4）。

## 3. 当前状态 / 服务态

- **样板项目**(都在共享 dev 若依/控制台 8089，账号密码 `123456`)：客户系统 `ed541b1e`(zhangsan/lijingli/admin) / 设备报修 `e7175cb0`(e7175cb0_u1/u2) / 以岭巡店 `becca759` / 项目管理0628 `e7ecab0f` / **合同管理系统 `12acf9f0`**(本会话新建·链B 全自动交付·account `12acf9f0_u1`)。
- **平台账号**：`admin@123.com`/`admin123`(admin 角色，本会话重置密码) + `verify-import@test.local`/`verify123`。
- **服务态**(会话结束可能停)：API:3002(`apps/api` 守护 `node dist/main.js`)、web:3009(`apps/web` `next dev -p 3009`，本会话修过陈旧实例)、控制台 preview:8089、若依8080、postgres:5433、redis:6379。

## 4. 重要口径（接手必懂）

- **业务模型已澄清**：政企定制·**一客户一套独立部署**(非 SaaS)。→ ①多租户/ADR-0017 **搁置**(独立部署=天然隔离)；②真客户上线走**链B若依**(不用 crud 自造前端)，路径见 `RUNBOOK-customer-onboarding.md`；③"思想动力运营后台"用户暂选"先不做、继续打磨交付管线"。
- **修生成器不修实例**(铁律，见 memory `feedback_fix_generator_not_instance`)。
- 本会话踩的共享坑是 dev 单实例多项目产物，非生产问题。

## 5. 本会话新增文档轴

- `WHITEPAPER-value-and-delivery-v2.md`——产品宪法(单客户模型·价值兑现度✅🟡🔴)。
- `RUNBOOK-customer-onboarding.md`——一客户从零上线交付手册。
- `architecture/ADR-0016-nl-requirement-interaction.md`——**全自然语言需求交互引擎**(价值一引擎；**已附落地切片计划**：覆盖度量化→进度条→澄清记录→冻结状态机；现有 discovery 上加，两样已有雏形)。
- `architecture/ADR-0017-...isolation.md`——一项目一租户(搁置)。
- `architecture/EVAL-ruoyi-fastapi-base.md` + `HANDOFF-ruoyi-fastapi-base.md`——底座选型线程(独立)。

## 6. 下一步候选（平台开发）

1. **ADR-0016 需求交互引擎·切片1**：若依交付覆盖度量化(后端纯函数+单测，最安全第一刀)。切片计划已落 ADR Action Items。← 白皮书 §七 排的下一个建设主线(价值一引擎)。
2. ~~**serve 基建自动化**(候选②剩半)~~ **首刀已落**：托管 serve(`RUOYI_CONSOLE_SERVE=managed`)——平台内置静态服务+代理替代手工 vite preview，productionUrl 由部署产出(`ConsoleServeService`/`console-serve.ts`，14 测，RUNBOOK §5 路线B)。**剩**：对外域名/HTTPS/TLS 终止仍需一层反代(客户基建)。
3. 价值三：一键审计报告导出页(地基有，补成品)。
4. 自迭代收敛/缺口分类的后续打磨(④已接线，可继续)。

---

> 相关 memory：`project_session_handoff.md`(顶部交接清单，最权威)、`feedback_fix_generator_not_instance`、`project_console_direction`。
