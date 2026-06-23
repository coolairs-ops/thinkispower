# ADR-0008: 能力来源分流 —— 验收/迭代按 capability provenance 分桶，外部能力留标准端口 + 备忘录台账

**Status:** Proposed（2026-06-24；由 A3c live 验证时实测"迭代卡 71 / 接了若依仍报大量未实现"反向暴露，本 ADR 形式化解法）
**Date:** 2026-06-24
**Deciders:** 平台负责人
**关联:** 修 [ADR-0005] 自迭代回路与 [ADR-0007] 契约门**共同的盲点**——评估器只看 demo HTML、不认能力的真实来源；落实 [ADR-0002] 原则①（完整闭环）"hard enforcement 靠确定性门不靠提示词"；为 [ADR-0006] 装配线（适配器①②/provisionApp）补"外部能力"这一类装配位；接 ADR-0004（授权计量，文件待补）——外部能力端口正是计量/授权的落点。

---

## Context（为什么现在定）

A3c live 验证时实测一个政企 demo（客服/知识库/产品录入），暴露一条结构性死结：

- **综合评分卡死 71，4 轮迭代纹丝不动**。`sensor.service.ts` 三层融合：L1 静态(HTML 结构)×0.3 + L2 运行时×0.3 + L3 语义×0.4，门槛 ≥70。实测 L1=35 / L2=85 / L3=88 → 71。L1 死死压住，迭代怎么改都上不去。
- **需求覆盖 55%、11 项报"未实现"，但其中多项已经做出来了**。`traceability-validator.service.ts:37` 的判定签名是 `validate(projectId, demoHtml, ...)`——**只把 demo HTML 喂 LLM 判"实现了几条"，根本不认若依后台能力**。于是：
  - "权限控制 / RBAC / 多用户" → 已用若依 `data_scope` + 平台 token 代持**真做出来了**（坎2 LIVE 证通，见 [[project_session_handoff]]），但静态 HTML 里看不到 → 判未实现。
  - "登录页 / 咨询问答闭环 / 售后上报" → 能力在 `appData.login/ask` 运行时 + 若依，HTML 只有函数定义没 UI 链 → 判未实现。
- **迭代回路只会改 HTML**（`delivery-evaluation.reEvaluate` 的 prompt = "修改这段 HTML"）。它能补登录表单壳、补问答输入框，但**永远改不出"RBAC 真生效""ASR 真转写"**——这些根本不是 HTML 能力。
- **验收门同源同病**：`acceptance-verification.judge(scenarios, demoHtml, ...)` 也是把验收场景喂 demo HTML 给 LLM 判，`gate()` 要 `passRate ≥ 0.8` 才放行交付。于是只要需求里有"靠后端/靠外部"的能力，验收**必然卡死**。现有唯一逃生口 `manualConfirm`（A3c 刚收口）是人工打补丁、不是系统解，且 manual 不计 pass、反压低通过率。

**病灶一句话**：母体把"能力是否实现"统一用"demo HTML 像不像"来判，但能力的真实来源有三类——**前端自己的(self)、后端底座的(backend)、必须外部对接的(external)**——后两类在 HTML 这层天然看不到，于是被误判为未实现，迭代撞墙、验收卡死。这不是 HTML 质量缺口，是**缺少"能力来源"这一维**。

外部类能力（ASR 语音转写 / OCR 票据识别 / 外部 OA 审批 / 行业规则包）短期内不可能 live 接通，但**不能因此让整个交付永久卡在验收门前**。

---

## Decision（五条）

### D1｜能力来源是一等标注（Capability Provenance）
每条需求 / 验收场景 / coverage 准则带一个 `fulfilledBy` 字段：

| 来源 | 含义 | 谁满足 | 验收证据源 |
|---|---|---|---|
| `self` | 前端/HTML 能实现（表单、列表、交互） | 自迭代回路 | demo HTML（判定现状不变） |
| `backend:<kind>` | 后端底座能力（RBAC/数据隔离/CRUD/工作流） | provisionApp 置备（若依等） | **后端契约一致性 + 探活**，不判 HTML |
| `external:<protocol>` | 必须外部对接（asr/ocr/oa/rulepack/…） | 能力端口适配器 | **接口桩存在 + 协议声明 + 台账登记**，不要求 live |
| `deferred` | 本期明确不做 | — | **移出分母**，不计入覆盖率/通过率 |

来源标注由"需求 → 能力"映射时确定性推断（先有规则：涉及登录/权限/数据隔离/CRUD → backend；涉及语音/图像/识别/外部系统/审批 → external；其余默认 self），人可在规格阶段覆盖。落点：规格 `acceptanceScenarios[i].fulfilledBy`、`structuredRequirement` 的需求项同字段。

### D2｜评估器按来源分流（Provenance-aware validation）
`TraceabilityValidator.validate` 与 `acceptance-verification.judge` 不再对所有需求一律判 HTML，按 `fulfilledBy` 走不同证据源：
- `self` → 判 demo HTML（现状）。
- `backend:*` → 判**契约一致性（ADR-0007 的 `checkContractConformance`）+ 后端探活/置备 descriptor（已有 L2 传感器 + provisionApp 的 `backendRuntime.status===ready`）**。后端已就绪且前端落在契约内 = 实现。
- `external:*` → 判**对应能力端口是否已声明 + 台账是否登记**（D4）。
- `deferred` → 跳过、从覆盖率分母剔除。

**这是近期收益最大、纯软件、零外部依赖的一步**：它把若依已经做出来的 RBAC/隔离从"未实现"里救回来、把 ASR/OCR 从分母里拿掉，覆盖率与综合评分立刻回到反映真实进度的水平，迭代不再为不可能的事撞墙。

### D3｜标准能力端口（Capability Port）——"留标准接口"的落地
外部能力定义成一组**稳定 TS 接口 + `NotConfiguredAdapter`（空实现/留桩）+ 可插拔真实现**，例如：

```ts
interface SpeechToText   { transcribe(audio): Promise<{ text: string; confidence: number }> }
interface OcrExtract     { extract(image): Promise<{ fields: Record<string, string> }> }
interface OaApproval     { submit(payload): Promise<{ instanceId: string; status: string }> }
interface IndustryRulePack { evaluate(facts): Promise<{ verdict: string; evidence: string[] }> }
```

- 生成程序里"语音录入 / 拍照识别 / 提交 OA 审批 / 合规校验"等 UI 调对应端口；**未配置时 `NotConfiguredAdapter` 优雅降级**（提示"该能力待对接"、不报错、不空白），配置后即真用。
- 这正是柱四外部适配器 + 行业规则包（现仅药监一条，见 [[project_rule_engine]]）该插的装配位，并接 ADR-0004 授权计量（每次端口调用是计量/授权的天然落点）。
- 端口契约稳定、协议先定、实现后插 = "接口化、协议化"。

### D4｜能力备忘录台账（Capability Ledger）——"留备忘录"的落地
一张能力清单（落 `structuredRequirement.capabilities` 或独立表），每条 `external`/`deferred` 能力登记：`需求来源 / 能力端口 / 协议 / 对接方 / 状态(未配置→对接中→已接) / 验收口径(留桩即过 | 需 live)`。
- **验收报告读它**，把这些显式渲成"已声明·待对接"清单——既是验收的受控放行依据，又是随交付物给客户的**一份《集成对接清单》**，而非判失败。
- 状态从"未配置"翻到"已接"时，D2 对该能力的判定自动从"桩存在即过"升级为"探活达标"，无需改验收逻辑。

### D5｜验收门三态分桶（替代一刀切 passRate）
`gate()` 从"单一 passRate ≥ 0.8 二值门"升级为**按来源分桶、各桶各自达标**：
- `self` 的 must 场景 → HTML 判定必须达阈（如 ≥0.8）。
- `backend:*` 场景 → 契约一致 + 后端 ready。
- `external:*` / `deferred` → 有端口桩 + 台账登记即**受控放行（acknowledged）**，不阻断交付，但在交付物显式标注"以下能力待外部对接"。

呼应此前"90→100"的裁定：不在模糊融合分上追满分，换**确定性分桶门——每桶各自达标**，整体即"可交付"。综合评分(71)继续作内部迭代信号，不再充当交付闸。

---

## 边界（这条纪律管什么、不管什么）

- **管**：把"能力是否实现"的判定，从"只看 HTML"升级为"按来源看对的证据"；给不可能在本期 live 的外部能力一条**受控、有据、可交付**的出路。
- **不管**：端口背后真适配器的实现质量（那是各适配器自己的活）；UI 好不好看（设计建议/截图复刻）；业务规则对不对（规则包/需求补全）。来源分流门只做"按对的标准判、别误判、别卡死"这一件事，确定性、零误报优先。
- **与既有门的关系**：本 ADR 不替换 ADR-0005 的传感器/测试门家族，而是给它们加一层"按 provenance 选证据源"的前置路由；契约门(ADR-0007)成为 backend 类的判定证据之一；manualConfirm 退化为兜底而非主力。

---

## Consequences

**变容易：** 若依已做出来的后端能力不再被误判未实现 → 覆盖率/综合评分反映真实进度；ASR/OCR/OA 这类外部能力从"永久卡验收"变成"留桩+台账受控放行"，交付不再死结；迭代回路不再为非 HTML 能力空转撞墙。

**需关注：** `fulfilledBy` 推断错配的风险（把本应 self 的判成 external 蒙混过关）——推断规则要保守、人可在规格阶段复核；台账"留桩即过"是**契约承诺**而非能力兑现，必须在交付物里对客户**显式、诚实地**标注"待对接"，不得伪装成已实现（违背 ADR-0002 诚实闭环原则）。

**将来重访：** 端口状态翻"已接"后的 live 验收自动升级；能力台账纳入"应用描述符"随产品私有化交付；端口调用接 ADR-0004 计量/授权；行业规则包从药监一条扩到多行业、统一走 `IndustryRulePack` 端口。

---

## Action Items

1. [ ] **（近期·收益最大·纯软件）** `fulfilledBy` 字段 + 确定性来源推断（规格物化时落到 `acceptanceScenarios[i]` / 需求项）。
2. [ ] **（近期）** `TraceabilityValidator.validate` 与 `acceptance-verification.judge/gate` 按 `fulfilledBy` 分流：backend→契约+探活、external/deferred→台账、self→HTML（D2/D5）。
3. [ ] **（近期）** `gate()` 改三态分桶放行，external/deferred 受控 acknowledged，不阻断交付。
4. [ ] **（中期）** Capability Port 接口族 + `NotConfiguredAdapter`（speech/ocr/oa/rulepack），生成器在对应 UI 调端口、未配置优雅降级（D3）。
5. [ ] **（中期）** Capability Ledger 台账 + 验收报告/交付物里的《集成对接清单》渲染（D4）。
6. [ ] **（远期）** 各端口真适配器随客户对接逐个插；端口调用接 ADR-0004 计量；行业规则包多行业化。

---

> 触发实证：2026-06-24 A3c live 验证，政企客服 demo 综合评分卡 71、需求覆盖 55%、11 项未实现中多项实为若依已交付或须外部对接。相关 [[project_followup_spec_gaps]]、[[project_roadmap_status]]、[[project_rule_engine]]、[[project_session_handoff]]。
