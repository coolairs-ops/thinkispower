# 交接文档 · 若依控制台交付管线（2026-06-29）

> 面向接手者：读完这份就能理解"思想动力如何把一个需求做成真上线的若依控制台系统"、当前打通到哪、怎么跑、还差什么。
> 配套：`~/.claude/.../memory/project_session_handoff.md` 顶部段（更细的 commit 流水）、`docs/architecture/ADR-0012`（控制台方向）。

代码：master = `afc00d1`（Gitee + GitHub 全推），分支 `feat/ruoyi-console-autogen`。

---

## 1. 一句话现状

**「需求 → 规格 → demo → 真验收 → 终稿交付 → 若依置备 → 控制台 → 上线门 completed」对若依底座项目（链B / ADR-0012）端到端零手工跑通，并用两个真项目复验过。** 交付出的是一套中文、可登录、带权限分身（数据权限）的若依统一控制台。

---

## 2. 架构：两条交付链

平台有两条交付链，按项目 `backendRuntime.kind` 分流（方案页"用若依底座"开关 designate 决定）：

- **链A（路B / crud，默认）**：LLM `stepwiseGenerate` 生成整套前端 HTML + 一键部署 + crud 后端（postgres schema）。`backendRuntime.kind='crud'`。验收拿 demo HTML 判。
- **链B（若依统一控制台 / ADR-0012，政企主力）**：`backendRuntime.kind='ruoyi'`。交付物 = 若依控制台。**本会话主攻并打通的就是这条。**

### 链B 全流程（每步在哪）
```
需求访谈/补全 → 规格(Specification,含 acceptanceScenarios)
   ↓ (设计态，纯平台+LLM，不碰若依)
demo 预览(schema-composer→appSchema→renderSchema, 中文标签+无登录墙)
   ↓
designate 若依底座 (backendRuntime.kind=ruoyi,status=pending)  ← 方案页开关 / POST /ruoyi/designate
   ↓
终稿交付 POST /api/projects/:id/delivery/deliver
   ├─ 验收门 acceptance.gate (ruoyi 项目 self+backend 按"控制台交付"信用, passRate≥0.8 放行)
   ├─ ensureProvisioned → 若依置备链 (RuoyiProvisionService.provisionApp):
   │     ddl(建表) → codegen(/tool/gen importTable+中文标签+下载) → 写若依工程+编译+重启ruoyi-server
   │     → waitReady → seedRoles(项目专属角色+data_scope) → seedMenusAndGrant(业务模块+C菜单+F权限)
   │     → seedUsers(每角色一初始账号, 写 descriptor.initialUsers)
   └─ runProductionDelivery → (kind=ruoyi 分流) RuoyiConsoleDeployService.deliver:
         等后端ready → 构建 plus-ui(npm run build:prod) → 验控制台可达 → 冒烟(经控制台代理 login+list)
         → decideDeliveryOutcome(上线门) → goLiveStatus=completed + productionUrl=控制台URL
   ↓
运行态：若依控制台(plus-ui) + 若依后端，终端用户登录、CRUD 走若依(data_scope 真生效)
```

**若依只在两个时刻被调用**：① 终稿交付时置备；② 上线后当真后端。设计态(需求/规格/demo/评估)全程不碰若依。

### 关键文件
- 置备链：`apps/api/src/modules/app-runtime/` — `ruoyi-provision.service.ts`(编排)、`ruoyi-runtime.service.ts`(provisionApp:角色/菜单/用户/scope)、`ruoyi-client.service.ts`(若依REST:codegen/seedRoles/seedMenusAndGrant/seedUsers/clearGenTable)、`ruoyi-local-deployer.ts`(写工程+编译+重启+vue落plus-ui+清旧生成物)、`ruoyi-label-gen.ts`(LLM中文标签+确定性词典兜底)、`capability-provenance.ts`(能力来源分类)。
- 控制台交付：`apps/api/src/modules/delivery/ruoyi-console-deploy.service.ts`。
- 上线门：`apps/api/src/modules/delivery/golive-gate.ts`(decideDeliveryOutcome 纯函数)。
- 验收：`apps/api/src/modules/delivery/acceptance-verification.service.ts`。
- demo 生成：`apps/api/src/modules/app-runtime/ui-templates/`(schema-composer/block-renderer/appdata-inject)。

---

## 3. 本会话改了什么（带 commit）

**ADR-0012 控制台自动化 ①②③④（前期）**：① LLM中文标签(菜单/字段)、② vue落plus-ui成控制台真页、③ 自动建C导航菜单+授权、④ 角色按项目隔离(roleKey/roleName 加项目域)。配套修复：菜单 visible '1'(隐藏)→'0'、businessName 重名旧生成物清理(防 Ambiguous mapping 崩库)、增量授权补全父菜单、gen_table 去重。

**本会话(0628→0629)续**：
| commit | 内容 |
|---|---|
| `be1ee76` | ① 中文标签加确定性词典兜底 + LLM 双试（DeepSeek 抽风不裸回退英文）|
| `cf7e097` | ① 置备链自动种初始登录账号（每角色一个，写 descriptor.initialUsers，交付即能登）|
| `61d432f`/`823d1b6` | ② 若依控制台=交付物 + 上线门量控制台（RuoyiConsoleDeployService，等就绪+build:prod）|
| `f2a9753` | 登录修复（plus-ui preview.proxy + 关加密）+ 上线门冒烟改经控制台代理（测"控制台→后端"连通）|
| `e74f413` | demo 预览去登录墙（不再加载即自动弹）+ demo 菜单/标题/字段全中文 |
| `b7ca271` | 自迭代覆盖率：iterative-optimizer 补传 backendReady + inferFulfillment 加 external 兜底(快普/ERP/OAuth/Webhook/支付/短信)/Excel→backend |
| `f369690`/`87806e8` | 验收门对 ruoyi 项目 self+backend 按"控制台交付"信用（解交付前鸡生蛋；isRuoyiConsole=kind==='ruoyi'）|
| `66bad41` | 评估/交付不再整体覆盖 structuredRequirement（止血"采纳的设计建议丢失"）|
| `afc00d1` | 交付产物归位：deliveryAnalysis 迁 Project 独立列(db push)、qwenReview 不再塞 structuredRequirement |

---

## 4. 关键口径/设计决策（接手必懂）

1. **设计态 vs 运行态**：demo(HTML)是设计稿/mock；若依控制台才是 ruoyi 项目的真交付物。**凡"判 demo HTML"的地方对 ruoyi 项目都是判错对象** → 验收/覆盖率对 ruoyi 都改成"按控制台交付信用"，运行时真把关交给上线门的控制台冒烟。
2. **能力来源分流（ADR-0008，`capability-provenance.ts`）**：每条需求判 self(判HTML)/backend(若依置备信用)/external(受控放行、移出覆盖率分母)/deferred。保守原则"宁可漏判 external、不错判 external"。
3. **上线门是唯一上线判据（ADR-0009，`golive-gate.ts`）**：确定性二值合取(编译∧部署健康∧冒烟不为假)。自迭代分数/覆盖率只是"打磨进度"、不作上线判据。**铁律：宁可显示"未验证/失败"，不可假阳性把跑不起来的标已上线。**
4. **structuredRequirement 只装需求**：designSuggestions/completenessGaps/businessRules/relations/acceptanceScenarios。交付产物(deliveryAnalysis/qwenReview)已搬出。写它必须**保留式合并**、勿整体替换。
5. **修生成器不修实例**（用户铁律，见 memory `feedback_fix_generator_not_instance`）：生成出的若依系统出 bug 要修回 apps/api 的生成/置备代码，不手工改若依实例；实例只作暴露缺陷的样本。

---

## 5. 服务态 · 怎么跑

全用 PowerShell（Bash 的 PATH 偶坏）。docker 重启后手动容器(若依三件套/tip-redis-local)不自回需重建。

| 服务 | 端口 | 起法 |
|---|---|---|
| 平台 API | 3002 | `apps/api` 守护循环 `node dist/main.js`；env 在 `apps/api/.env`（含 DATABASE_URL=…127.0.0.1:5433、REDIS_HOST=127.0.0.1、RUOYI_BASE_URL=http://127.0.0.1:8080、RUOYI_SRC_ROOT=D:\ruoyi-study、RUOYI_UI_ROOT=D:\plus-ui、RUOYI_CONSOLE_URL=http://127.0.0.1:8089）|
| 思想动力前端 | 3009 | `apps/web` 守护 `next dev -p 3009` |
| 若依控制台 dev | 8088 | `D:\plus-ui` 守护 `npm run dev` |
| **若依控制台 preview** | **8089** | `D:\plus-ui` 守护 `npx vite preview --port 8089 --host 127.0.0.1`（服务构建产物 dist = 控制台 productionUrl；vite.config 已加 preview.proxy→8080）|
| 若依后端 | 8080 | docker `ruoyi-server`/`ruoyi-mysql`(root/root,ry-vue)/`ruoyi-redis`；冷启慢(Windows文件桥)，`_run-exploded.sh` 提速 |
| 基础设施 | 5433/6379/9000 | docker postgres / tip-redis-local / minio |

- 平台账号：`verify-import@test.local` / `verify123`（enterprise，能交付）。
- 改后端代码：先 `npm run build`；改 prisma 要先杀 API 再 `prisma db push`(DLL锁) + `prisma generate`。
- 改 plus-ui 代码/部署完新页：dev(8088)靠 HMR；**preview(8089)/正式要 `npm run build:prod` + 重启 preview**（import.meta.glob 对运行期新增组件不可靠）。

---

## 6. 已上线样板项目（可登录看）

控制台地址统一 **http://127.0.0.1:8089**（共享控制台+共享若依租户000000，靠登录+角色分），账号密码均 `123456`：

| 项目 | id | 账号 | 角色/数据范围 |
|---|---|---|---|
| 客户系统 | ed541b1e | admin/admin123、zhangsan、lijingli | 旧共享角色 app_role_1/2 |
| 设备报修管理系统 | e7175cb0 | e7175cb0_u1 / e7175cb0_u2 | 项目专属角色(全部/仅本人) |
| 以岭门店销售巡检 | becca759 | yilingmgr、yilingsales | 销售管理员·全部 / 销售代表·仅本人 |
| 项目管理系统0628 | e7ecab0f | e7ecab0f_u1/u2/u3 | 项目专属角色 |

---

## 7. 已知坑 / 排查项

- **designate 被覆盖**：项目管理系统0628 曾从 ruoyi 变成 crud(路B)、要重指定才走控制台。"用若依底座"开关状态在某处可能被交付/重置覆盖——**待排查**。
- **共享实例未隔离**：所有 ruoyi 项目共用一个 plus-ui(8089)+一个若依租户(000000)，productionUrl 对它们是同一地址。真交付要一项目一若依**租户**(架构级)。
- **serve 半自动**：平台只 `build:prod`，"部署/serve"靠手工起 vite preview(8089)。真产品要 CI 构建+部署基建。
- **以岭 4 缺口**：地图路径规划/拍照识别/语音上报/看板——external/deferred，走 gap_workflow/能力中心，控制台 CRUD 不含。
- **provision 慢**：若依模块编译 ~1.5–11min(冷热不定)+重启 boot，Windows 文件桥所致。
- **守护盯控制台 URL 未验**：上线后是否被守护中心探活，本会话没确认。

---

## 8. 下一步候选（按价值）

1. **一项目一若依租户硬隔离**（架构级；现共享 tenant 000000）。
2. **控制台 serve 基建自动化 + 守护接控制台 URL**（让"部署"和"持续守护"进闭环）。
3. **designate 被覆盖排查**（防路B/若依底座被意外切换）。
4. 自迭代收敛止损（覆盖率连续无提升即停）+ 缺口按类展示（前端可修/待后端置备/待外部对接）。
5. deliveryAnalysis/qwenReview 已归位；其余塞 structuredRequirement 的历史字段可继续清。
