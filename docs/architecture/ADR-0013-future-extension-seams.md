# ADR-0013: 为"对外门户 / 大屏 / C 端 App / 非 Java 栈"留口 —— 契约中立 + deliveryProfile 路由位 + 能力降级归档，留口不盖楼

**Status:** Proposed（2026-06-25；为 ADR-0012"一个若依控制台"路线补未来扩展口，避免把非内部系统场景焊死。经评审纳入 4 处批注：口一改排样板后+置备回归验证、口二定位为路由标非承重口、大屏/C端非纯渲染器会拉后端能力、DataScope 枚举源自若依模型按子集映射）
**Date:** 2026-06-25
**Deciders:** 平台负责人

**关联:** 直接补 [ADR-0012]（内部系统走若依统一控制台；本 ADR 给"将来要门户/大屏/C端/非Java"留扩展口）；落 [ADR-0007] 契约优先（契约是前端/栈无关的腰）；用 [ADR-0003] 的 `BackendRuntime` 适配器口（`generated` 预留）作非 Java 后端的口。

---

## Context（为什么现在留口）

ADR-0012 把内部业务系统焊到"一个若依控制台"，换来交付确定性——这是对的。但它的代价（视觉只能 Element-Plus 重着色、锁 Java/Spring+Vue、不接对外/大屏/C端）会在将来真有这类客户时咬人。问题不是"现在要不要做这些"（YAGNI，不做），而是"**现在不留口，将来要做就得伤筋动骨重构**"。

核查现有代码（2026-06-25）得到关键事实：

- **契约层已基本中立、范式正确**：`app-contract.ts` 的 `DataContract` = `resources + fields`，与前端/栈无关；若依特有转换隔离在 `normalizeContractForRuntime(contract, backendKind)`，仅 `backendKind==='ruoyi'` 才施加。**这是标准答案**——契约中立、适配器各自转换。
- **但 `AppSpec` 正在漏若依**：`app-spec.types.ts:14` 把 `RuoyiDataScope = '1'|'2'|'3'|'4'|'5'`（若依 `sys_role.data_scope` 魔法数字）焊进平台核心 spec，`AppRole.dataScope`（`:19`）直接用它。`deriveDataScope()`（`app-spec-assembler.service.ts:102`）也直接产 '1'/'5'。**将来换前端/换栈会被这堆魔法数字绊住**。
- **没有前端/交付目标的对称抽象**：`BackendRuntime` 有干净的 `kind` 枚举（`crud|generated|ruoyi`，`generated` 已为非平台后端预留），但前端侧无 `deliveryProfile/frontendTarget` 概念；ADR-0012 D1 的"一个界面 vs 两个界面"只是散文规则，未 typed。

**病灶一句话**：契约层范式对了，但（一）`AppSpec` 漏若依魔法数字、（二）D1 路由未 typed——这两处不堵，将来加"门户/大屏/C端/非Java"就不是"挂渲染器"而是"动核心"。

---

## Decision（三处留口 + 一条卫生，全是"在已有边界上加一道抽象/一个字段"，不新建子系统）

### 口一（承重）｜契约/权限模型中立化 —— 把 `RuoyiDataScope` 漏点堵掉

契约（`DataContract` + `AppSpec`）是前端/栈无关的腰：**对外门户**本质上确是"同一份契约的另一个渲染器"，契约中立它才挂得上。

> **诚实注脚（别简化）**：**大屏 / C 端 App 并非"只是另一个渲染器"**——大屏要实时推送 + 聚合端点、C 端要推送/离线/OAuth(微信)登录，这些是**新的后端能力**，会拉动 [ADR-0008] 能力生长。**契约中立是它们落地的必要非充分条件**；本 ADR 只保证"挂得上契约"，不代表"挂个渲染器就完事"。

`DataContract` 已中立，只差把 `AppSpec` 的数据权限去若依化：

- 在 `app-spec.types.ts` 新增**语义枚举**替换 `RuoyiDataScope`：
  ```ts
  /** 数据权限范围（中立语义，不绑任何后端实现） */
  export type DataScope = 'all' | 'custom' | 'dept' | 'dept_and_child' | 'self';
  ```
  `AppRole.dataScope` 改用 `DataScope`。
  > **来源注脚**：此枚举取自若依 `sys_role.data_scope` 模型（`all/custom/dept/dept_and_child/self` ↔ `1/2/3/4/5`），是合理的**最小公约**但带若依烙印（"本部门及以下"是若依特有粒度）。非若依后端若无此粒度，**按子集映射**即可，不强求一一对应。
- `deriveDataScope()`（`app-spec-assembler.service.ts:102`）改产语义值（`'all'`/`'self'` …），不再产 '1'/'5'。
- **若依映射下沉到适配器边界**：在 `ruoyi-mapping.ts` 加 `toRuoyiDataScope(s: DataScope): RuoyiDataScope`（`all→'1' / custom→'2' / dept→'3' / dept_and_child→'4' / self→'5'`），仅在构造若依 sys_role payload 处调用——`ruoyi-runtime.service.ts:135`（`spec.roles.map(... dataScope: r.dataScope)` 改为 `dataScope: toRuoyiDataScope(r.dataScope)`）。`ruoyi-client.service.ts` 那层签名已是 `dataScope: string`，天然中立，不用动。
- 影响面小：仅 `app-spec.types.ts` / `app-spec-assembler.service.ts` / `ruoyi-mapping.ts` / `ruoyi-runtime.service.ts` 四个文件 + 对应 spec。
- **⚠️ 时机（重要）**：口一虽小，但 `ruoyi-runtime.service.ts:135`（构造 sys_role）+ `deriveDataScope` 在**活的置备路径**上。当前正"做客户系统这个能打通的样板"，**此刻动置备核心有回归风险**。故 **口一排在客户系统样板上线/稳定之后**做，或现在做就**立即跑置备+seedRoles 端到端回归验证**（确认 `self→'5'`、`all→'1'` 映射后若依角色数据范围与改前一致）。不与样板抢稳定性——原"不拖延脊柱"措辞已据此修正。

### 口二（保险）｜D1 路由做成 typed 字段 `deliveryProfile`

把 ADR-0012 D1 的散文规则钉成一个已知决策位：

- `AppSpec`（`app-spec.types.ts`）加：
  ```ts
  /** 交付形态（ADR-0012 D1 路由）：当前仅实现 internal-console，其余为未来预留口 */
  export type DeliveryProfile = 'internal-console' | 'external-portal' | 'big-screen' | 'mobile-app';
  // AppSpec 增字段：deliveryProfile?: DeliveryProfile;  // 缺省 'internal-console'
  ```
  （命名用 `deliveryProfile`，避开 `rule-templates.ts` 已有的"Industry Profile"行业模板概念，勿混。）
- 规格/需求阶段加一步**判定并写入** `deliveryProfile`（默认 `internal-console`；命中"对外/匿名/品牌化/大屏"才升级）。
- **当前只实现 `internal-console` 一个分支**，其余值仅占位。将来 = 往枚举加分支 + 加渲染器，**不是重构**。

> **定位注脚（别高估）**：`deliveryProfile` 是**路由标 + 意图表态**，不是承重的"扩展接口"。将来加 `external-portal` 时真正的工作是**写那个渲染器**，这个 tag 帮不上、只负责路由。**真正防"动核心"的是口一（契约中立）+ 已有的 `BackendRuntime` 口**；口二近零成本、值得加（钉死决策、文档化意图），但它的价值在"记录"不在"防重构"。

### 口三｜自造前端能力降级归档，不删

落实 ADR-0012 D5：平台自造前端（daisyUI 块系统 + 表单/登录门生成）**退出内部系统主交付，但归档为注册能力**，挂到 `deliveryProfile ∈ {external-portal, mobile-app}` 与 ADR-0011 生成型 AI 端点轨。**关键约束：它也消费同一份 `DataContract`**——这样第一个对外门户项目落地时，已有契约驱动的前端生成器可指过去，不用从零造。

### 卫生｜非 Java 后端的口已在，保持干净

非 Java 栈后端 = `BackendRuntime` 的 `generated` kind（已预留）。本 ADR 不实现它（YAGNI）；要做的只有"把若依特性关在 `RuoyiRuntime` 里别外泄"——即口一堵掉的 `dataScope` 漏点。将来 Node/Python/Go 后端 = 实现一个新 `BackendRuntime` kind。

---

## 边界（管什么、不管什么）

- **管**：堵契约层若依泄漏（口一）、把交付形态路由 typed 化（口二）、自造前端降级而非删除（口三）、保持后端适配器口干净（卫生）。
- **不管**：不实现 `external-portal/big-screen/mobile-app` 任何渲染器；不建 `FrontendRuntime` 适配器框架；不实现 `generated` 非 Java 后端；不建外部集成（OCR/IM/支付）适配器框架。**留口 ≠ 现在盖楼。**

---

## Consequences

**未来不被焊死**：门户/大屏/C端/非Java 都成了"同一契约的另一个渲染器/适配器"，加它们 = 挂分支，不动核心。**今天近乎零成本**：三处都是已有边界上加一个枚举/一道映射，合计 < 1 天，且口一让脊柱更干净、不拖延。**纪律风险**：必须守住"契约中立"——以后任何后端/前端特有假设都只能进各自适配器（`normalizeContractForRuntime` / `toRuoyiDataScope` 这种边界函数），绝不再进 `DataContract`/`AppSpec`。

**代价**：`deliveryProfile` 等枚举值长期只有一个被实现，是有意的占位（不是 TODO 债）；评审时别误删。

---

## Action Items

1. [ ] **（口一·承重，排客户系统样板稳定之后）** `app-spec.types.ts` 加 `DataScope` 语义枚举替换 `RuoyiDataScope`；`AppRole.dataScope: DataScope`。
2. [ ] **（口一）** `deriveDataScope()`（`app-spec-assembler.service.ts:102`）改产语义值；`ruoyi-mapping.ts` 加 `toRuoyiDataScope()`；`ruoyi-runtime.service.ts:135` 在构造 sys_role 处调用映射。更新对应 `.spec.ts`。**改完立即跑置备+seedRoles 端到端回归**，确认若依角色 data_scope 与改前逐一致（self→'5'/all→'1'…），再合入。
3. [ ] **（口二·保险）** `AppSpec` 加 `deliveryProfile?: DeliveryProfile`（默认 `internal-console`）；规格阶段加判定写入步。
4. [ ] **（口三）** 自造前端能力（daisyUI 块 / 表单·登录门生成）归档为注册能力，绑 `deliveryProfile ∈ {external-portal, mobile-app}` + ADR-0011 轨；确认它消费 `DataContract`。
5. [ ] **（卫生）** 审一遍 `DataContract`/`AppSpec`，确认无其他后端/前端特有假设泄漏（除已隔离的 `normalizeContractForRuntime`）。
6. [ ] **（不做清单·防过度建设）** 明确记：本轮不实现任何新渲染器/`FrontendRuntime`框架/`generated`后端/外部集成框架。

---

> 触发实证：2026-06-25 本会话——为 ADR-0012"一个若依控制台"路线评估未来扩展，核查代码发现 `DataContract` 已中立（范式对）但 `AppSpec.dataScope` 漏若依 '1'-'5' 魔法数字、且无 `deliveryProfile` 路由位。结论：现阶段在"契约/权限中立化 + 交付形态 typed 化 + 能力降级归档"三处留口最省最顶用，且不拖延客户系统脊柱。相关 [[project_motherbase_vision]]、[[project_roadmap_status]]、[[project_path_b_progress]]。
