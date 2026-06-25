# ADR-0011: 领域 AI 端点生成能力 —— 让交付的后端会"动词"：识别生成型需求 → 注入 LLM Port → 生成真调模型的领域端点 + 结构化输出契约 + 运行态功能验收

**Status:** Proposed（2026-06-25，草案；承接 [ADR-0010] G1 的 Action Item #2）
**Date:** 2026-06-25
**Deciders:** 平台负责人

**关联:** 落地 [ADR-0010] 的核心缺口（平台产不出"运行时调 LLM 的生成型端点"）。复用 [ADR-0008] 能力中心（catalog + maturity + disposeGap + 生成器词汇生长）——本设计是其"后端词汇生长"的首条。复用 [ADR-0001] 后端运行时 Port 抽象（可换实现）的思路做 **LLM Port**。接 [ADR-0007] 契约优先（生成端点的输入/输出进契约）。接 [ADR-0004] 授权计量（LLM 调用是计量落点）。接 [ADR-0009] 上线门 + 其 D1 硬化（运行态功能验收）。

---

## Context

[ADR-0010] 实测证明：当前交付链把需求里的"名词"摊成 CRUD，但产不出"动词"——"输入大纲→AI 生成分镜剧本"交付出来是 `prisma.script.create({data})` 空壳、0 处 LLM 调用。本 ADR 设计补上这一能力：**让生成器能产出"运行时真调 LLM 的领域端点"**，并让这类功能能被契约门和验收门覆盖。

现有可复用地基（来自体检）：
- 生成主链 `stepwiseGenerate`：DeepSeek 分步出 schema/backend/frontend/integration。
- `injectEnterprisePack`：构建期向交付物**注入硬编码模板**（CRUD `server.js`、安全/可观测中间件、Dockerfile）——这是"模板托底求稳"的既有模式，本设计沿用它注入 **LLM Port**。
- ADR-0008：`capability-registry`（能力+maturity）、`capability-provenance`（inferFulfillment）、`disposeGap`（路由）、生成器词汇（前端 block）。

---

## Goals / Non-Goals

**Goals**
1. 识别"生成型/AI 型"需求，区别于 CRUD。
2. 生成**运行时真调 LLM** 的领域端点（含 prompt 模板 + 结构化输出 + 约束/重试）。
3. 端点的输入/输出进**应用契约**（ADR-0007），前端按结构化结果渲染（如分镜数组），D3 契约门覆盖。
4. **运行态功能验收**：给样例输入断言真产出（非空 + 相关），闭合 ADR-0010 G2 的开环。
5. 参数化复用：一套模板服务所有生成型功能（生成/总结/提取/分类/改写/对话…），按 ADR-0008 词汇生长复利。

**Non-Goals**
- 不追求生成的 prompt 一次到位最优（可迭代）。
- 不做模型训练/微调（只编排现有 LLM）。
- 不覆盖纯前端生成型 block（那是 ADR-0008 前端词汇，如 qa block）——本设计是**后端端点**。

---

## Design

### 1. 识别（detection）—— 复用 ADR-0008 provenance，加"动词"判定
需求项/验收场景命中以下信号 → 归类 `domain-ai-endpoint`（注册表 `maturity` 初始 red）：
- **动词信号**：features/Then 含"生成/自动生成/总结/提取/分类/改写/润色/对话/问答/推荐/翻译/抽取/识别"等；
- **语义信号**：Then 含"连贯/符合大纲/智能/根据…生成…"等运行时智能行为；
- 排除：纯"增删改查/列表/详情/导出"→ 仍走 CRUD。
落点：规格 `acceptanceScenarios[i].fulfilledBy` 旁增 `capability: 'domain-ai-endpoint'` 标注；`disposeGap` 命中 → **extend-generator**（不进 auto-iterate、不摊 CRUD）。能力未就绪（red）期间：诚实标缺口 + gap_workflow 登记（ADR-0010 G1）。

### 2. LLM Port（运行态接入）—— 像 backend-runtime 一样可换实现
向交付物注入一个标准 **LLM Port**（构建期 `injectEnterprisePack` 同机制注入 `backend/src/llm/llm.port.ts`）：
```
interface LlmPort { generate(input: { prompt: string; schema?: JsonSchema; maxTokens?: number }): Promise<{ text: string; json?: any }> }
```
两种实现（部署期由 env 选定，**默认 b**）：
- **(a) Direct**：交付后端直接调 LLM（key 在交付环境）。私有化友好；key 管理落客户。
- **(b) Platform Gateway（默认）**：交付后端回调**平台 LLM 网关**（平台持 key、统一鉴权与**计量**）。对齐 [ADR-0004] 计量/授权——LLM 调用即计量点。耦合平台，但可信、可计费、可审计。
> 决策：默认 (b)，私有化场景切 (a)。Port 抽象保证生成的端点代码不变、只换注入实现（同 ADR-0001 约束②）。

### 3. 领域端点模板（生成产物）—— 骨架托底 + LLM 填域
沿用 ADR-0010"骨架靠模板托底求稳"的权衡，**两段式**：
- **稳定骨架（平台注入，不靠 LLM 现编）**：controller + service 结构、调用 LlmPort、输出校验、重试/降级、落库、错误处理——硬编码模板，参数化。避免体检里"AI 生成基础设施不稳定"（schema 截断那类）。
- **域内容（构建期 LLM 填）**：仅生成两样**数据**而非代码——① **prompt 模板**（把输入字段→指令，由需求 Then + dataModel 推出）；② **输出 JSON Schema**（如 `{script:string, scenes:[{index,heading,dialogue}]}`）。
端点形如 `POST /scripts/generate { outline }` → 填 prompt → `llm.generate({prompt, schema})` → 校验非空+合 schema（不合则 1~2 次重试，再不合诚实报错不空跑）→ `prisma.script.create` 落库 → 返回结构化结果。

### 4. 契约与前端对齐（ADR-0007）
- 生成端点的**输入字段**（outline）+ **输出结构**（scenes[]）登记进应用契约（`app-contract`）。前端 appData 调用 `generate` 资源 ⊆ 真契约 → D3 契约门自动覆盖（不再"前端调了后端没有的资源"）。
- 前端按输出 schema **结构化渲染**（分镜数组成表），解决体检里"仅 raw 展示 script 字符串、与含分镜需求脱节"。

### 5. 运行态功能验收（闭合 ADR-0010 G2 / 承接 ADR-0009 #8）
能力 maturity 由 red→green 的判据，以及 D1 对生成型 must 场景的验收，统一为**对运行的交付后端打真实端点**：
- 给**样例输入**（如一段样例大纲）→ 调真 `generate` 端点 → 断言：HTTP 2xx + 输出合 schema + **非空** + 与输入**相关**（关键词覆盖/或 LLM-as-judge 二次校验，弱断言起步）。
- 通过 = 这条生成型需求"功能对"有了**运行态证据**，而非"看 demo / 人工拍板"。接入上线门 D1 与守护持续验真。

---

## 关键决策与取舍

| 决策 | 取舍 |
|---|---|
| 构建期 LLM 只生成 **prompt+输出schema（数据）**，端点代码用**稳定骨架模板** | 牺牲"端点逻辑完全由 AI 定制"的灵活，换**生成稳定性**（避免 schema 截断那类不可编译产物）。与 ADR-0010 模板托底一致。 |
| 运行态 LLM 默认走**平台网关 (b)** | 牺牲交付物完全自包含，换**计量/鉴权/审计**（ADR-0004）+ 客户免管 key。私有化可切 Direct。 |
| 识别用**注册表+动词信号**，未命中保守归 CRUD | 牺牲召回（个别生成型被当 CRUD），换不误报（CRUD 不会被强塞 LLM 端点）；可人工在规格覆盖。 |
| maturity red 期间**诚实标缺口**不假交付 | 牺牲短期通过率，换不假阳性（ADR-0010 G1）。 |

---

## 分期（建议）

- **P0**：注册表加 `domain-ai-endpoint`（red）+ 识别器 + disposeGap 路由 + 命中即诚实标缺口/登记（先让平台"知道自己不会"，不再悄悄交 CRUD）。
- **P1**：LLM Port（默认平台网关）+ 端点骨架模板 + 构建期生成 prompt/输出schema；首例 = 短剧"剧本生成"，验 red→green 复利。
- **P2**：契约登记 + 前端结构化渲染（D3 覆盖）；运行态功能验收接入 D1 + 守护（闭合 G2）。
- **P3**：词汇生长——总结/提取/分类/改写… 各补一类 prompt+schema 预设，复用同骨架。

---

## Open Questions

1. 平台 LLM 网关的鉴权/配额模型（与 ADR-0004 计量耦合的具体形态）。
2. "输出与输入相关"的验收强度：关键词覆盖（确定性、弱）vs LLM-as-judge（强、但又引入一个需被验的判子）。起步用弱断言 + 人在回路。
3. prompt 模板的版本化与回归（prompt 变更如何不破坏既有项目的验收）。
4. 与 ADR-0008 前端词汇（qa block 等）的衔接：一个生成型需求可能同时需要后端端点 + 前端展示 block，二者如何在一次交付里配套生成。

---

> 本设计为草案，承接 [ADR-0010] 实测结论（短剧交付 = CRUD 空壳）。落地首例以短剧"剧本生成"端点为试金石。相关 [[project_motherbase_vision]]、[[project_knowledge_base]]、[[project_path_b_progress]]。
