# ADR-0007: 应用契约先行 —— 同一份数据契约统一驱动前端生成 + 后端置备 + 验收门

**Status:** Accepted（2026-06-21；实证先行、本 ADR 形式化）
**Date:** 2026-06-21
**Deciders:** 平台负责人
**关联:** 补 [ADR-0003] 自陈的缺口——"填槽+校验门"纪律此前只用在**后端 codegen**，前端迭代仍自由生成、对若依契约是盲的 → 撞验收门；落实 [ADR-0002] 原则①（完整闭环）+ "hard enforcement 靠校验器不靠提示词"；建在 [ADR-0006] 装配线（适配器①②/provisionApp）之上。本 ADR 由 ② 若依全 API 写实测（2026-06-21 live 通过）反向实证后形式化。

---

## Context（为什么现在定）

- **病灶（ADR-0003 §修订 自陈）**：母体的"出得对"纪律分两半，只焊了一半。
  - **后端**：codegen 从实体模型**填槽**产出 CRUD/权限，schema 是真的、有校验门——出得对。
  - **前端**：文字生成 / 截图复刻产的 daisyUI HTML，`appData.list/get/create/update/remove(<资源>, ...)` 的资源名与字段是**模型自由发明**的——没有任何东西保证它落在后端真实存在的资源上。
- **后果**：前端迭代（ADR-0005 自迭代回路）对若依契约**盲**——它不知道后端只服务 `customer/project/task/...` 这些资源、字段叫什么。迭代越改越像样、却调着不存在的资源 → 永远撞验收门、"迭代不下去"。
- **已验证契约是真实存在的硬约束（②，2026-06-21）**：customer 项目重 provision 后，若依对 4 资源的最小创建全 `200 操作成功`。这证明后端契约**不是纸面**——前端只要落在契约内就能真读真写，落在契约外就是 500/404。契约值得被当作一等公民显式建模、并双向强制。

---

## Decision（三条焊死）

### D1｜应用数据契约是一等产物，从实体模型确定性导出
- 定义 **`DataContract = { resources: [{ name, fields[] }] }`**：资源名 = 实体表名，字段 = 实体列（剔除若依基础/审计列 `tenant_id/create_by/create_time/update_by/update_time/create_dept/del_flag`，这些后端自动填、不暴露给前端）。
- 实现：`apps/api/src/modules/app-runtime/app-contract.ts` 的 **`buildDataContract(entities)`** ——**纯函数、零依赖、确定性**（符合 ADR-0002「hard enforcement 靠校验器」）。实体来源复用 `SchemaMigrationService.parseAndValidate(dataModel)`，不另造解析。

### D2｜契约**双向**驱动：注入前端生成 prompt（先验）+ 校验前端产物（后验）
- **先验（注入）**：`contractPromptBlock(contract)` 把契约渲成硬约束文本块（"appData 资源名只能取下列之一、字段只能用对应列出的字段"），注入前端生成/迭代 prompt → 前端**从第一次生成就用对的资源名/字段**，而非生成后再纠。
- **后验（校验门）**：`extractAppDataResources(html)` 正则抽出前端 `appData.<op>('<资源>', ...)` 引用的资源名 → `checkContractConformance(html, contract)` 判其是否 ⊆ 契约 → 越界即驳回。
- **已接进自迭代回路**（`delivery-iteration.service.ts`）：每轮 sense 后做确定性契约一致性校验，前端用了模型外资源 → `unshift` 一条修复建议进既有 `recommendations → autoFix` 回路 → **迭代朝契约收敛**，不再瞎改。

### D3｜契约是**运行时真契约**的投影，含底座方言（不止字段名清单）
- 契约不仅是"字段名集合"，还须反映**目标底座的真实 API 方言**，否则先验注入会把前端带偏。当目标后端是若依（`backendRuntime.kind === 'ruoyi'`）时，已知方言差异（②实测）：
  - **字段名小写化**：若依 `toCamelCase` 对无下划线驼峰列名先 `toLowerCase()` → 路B Prisma 的 `userId/contactInfo/createdAt` 在若依实体/JSON 成 **`userid/contactinfo/createdat`**。**契约字段名必须按底座归一**（否则前端按 `userId` 写、不绑定、@NotNull 报错）。
  - **必填语义**：有 DB 默认的列（id 雪花/UUID、`createdAt/updatedAt`、枚举默认）在若依 BO **不 @NotNull**（见 ADR-0006 写入翻译）——契约应标注哪些字段创建时可省。
  - **鉴权头**：若依 REST 除 `Authorization: Bearer` 外**必须带 `clientid` 头**——属适配器②（serve 层）职责、不进前端契约，但属"运行时真契约"一部分，记此备忘。
- **裁定**：`buildDataContract` 现取 Prisma 驼峰字段名，对路B 前端正确；**接若依时需加一层字段名归一**（按 `backendRuntime` 选 `toCamelCase`-小写化）。这是 ADR-0007 落地的下一笔（见 Action Items）。

---

## 边界（这条纪律管什么、不管什么）

- **管**：前端 appData 调用的**资源名 + 字段名**是否落在后端真实契约内。这是"调得通真后端"的最小充分条件。
- **不管**：UI 好不好看、交互对不对（那是设计建议 / 截图复刻的活）；业务规则对不对（那是需求补全 / 规则包的活）。契约门只做"接得上"这一件事，确定性、零误报优先。
- **与既有门的关系**：契约门是 ADR-0005 测试门家族里**专管前后端接缝**的一员，和"可操作元素/非占位/覆盖率"等门并列，路由进同一 `recommendations → autoFix` 回路。

---

## Consequences

**变容易：** 前端迭代第一次就用对资源/字段（先验注入），用错也被确定性门挡回并定向修复（后验校验）——ADR-0003 自陈的"前端对若依盲"缺口被结构性填上；"迭代不下去"的一类根因（瞎调不存在的资源）消除。

**需关注：** 契约**字段名**当前取 Prisma 驼峰，接若依时与真实 API（小写）有方言差——`checkContractConformance` 现只校验**资源名**（表名两边小写能对上、故不误驳），但 `contractPromptBlock` 若直注且不归一会把前端带偏（见 D3）。直注 prompt（④）落地前必须先做字段名按底座归一，否则先验注入是负优化。

**将来重访：** 字段级（非仅资源级）一致性校验；契约随 `backendRuntime` 自动选方言（路B 驼峰 / 若依小写）；契约纳入"应用描述符"随产品交付（私有化气隙下前端自带契约、不回连母体）。

---

## Action Items

1. [x] `app-contract.ts`：`buildDataContract / contractPromptBlock / extractAppDataResources / checkContractConformance`（纯函数，已落，commit 321d337）。
2. [x] 接进自迭代回路：契约不一致 → 修复建议 → autoFix 收敛（`delivery-iteration.service.ts`，已落）。
3. [x] 实证契约真实性：② 若依全 API 写实测 live 通过（2026-06-21，4 资源最小创建全 200）。
4. [x] **④（分段生成路径）**：`contractPromptBlock` 直注前端生成 prompt，直注前按 `backendRuntime` 做**字段名归一**（若依 → 小写化，`normalizeContractForRuntime`），已落分段生成每页（commit 615158f）。**剩**：建造回路（`RealBuildStepRunner`）/ 迭代 autoFix 的先验注入（后验契约门已覆盖迭代）。
5. [ ] 字段级一致性校验（现仅资源名级）；契约标注"创建可省字段"（有 DB 默认者）。
6. [ ] 契约随 `backendRuntime` 选方言；纳入应用描述符随产品交付。
