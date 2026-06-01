# "下一步建议" 需求 vs 现有实现 差距评估

**日期**: 2026-06-01
**状态**: 评估（待审批）

---

## 一、现有实现 vs 需求对照

| 需求项 | 现有实现 | 差距 |
|--------|----------|------|
| 决策规则引擎 | ✅ `DecisionEngineService` (9条规则) | 规则逻辑不同，需调整 |
| API端点 | ✅ `GET /api/projects/:id/next-step` | 已存在 |
| 前端展示 | ✅ `NextStepCard` 组件 | 展示格式需对齐 |
| 展示位置 | ⚠️ 仅在plan/spec页 | 需求要求3个位置 |
| 判断输入 | 后端从DB读取完整项目数据 | 需求用前端简易参数 |

---

## 二、关键差异

### 2.1 架构差异

**需求方案**: 纯前端 `lib/knowledge/decisionTree.ts`，用简易参数判断
**现有实现**: 后端 `DecisionEngineService`，从DB读取完整数据

**问题**: 前端无法访问 `clarityScore`（DB字段）、`estimate`（DB字段）、`matchedWarnings`（需调API）。需求的前端纯函数方案无法获取这些数据。

### 2.2 规则差异

| 需求规则 | 现有规则 | 差异 |
|----------|----------|------|
| answersCount < 5 → continue | completeness < 30 → continue | 判断维度不同 |
| clarityScore < 60 → continue | 无对应 | 需新增clarityScore计算 |
| 高风险 >= 2 → revise | mustHaveCount > 8 → narrow | 触发条件不同 |
| 预算不足 → reduce | cost < 500 + highRisk > 0 → pause | 逻辑相似，名称不同 |
| 低风险+有estimate → generate | plan_ready → generate_spec | 现有更细粒度 |
| recommendation=not_recommended → pause | 无对应 | 需新增 |

### 2.3 展示位置差异

| 需求位置 | 现有 | 差距 |
|----------|------|------|
| 需求澄清页底部 | ❌ | 需新增 |
| 开工前预测页底部 | ✅ plan页已有 | 格式需微调 |
| 产品开发包页底部 | ❌ | 需新增（delivery页）|

---

## 三、推荐方案：增强现有实现，不复建

### 理由

1. **避免重复系统** — 已有完整的后端决策引擎+前端卡片，重复建设会造成两套逻辑不同步
2. **数据已在后端** — clarityScore、estimate、warnings等数据在后端DB，前端无法直接访问
3. **改动最小** — 调整现有规则+增加展示位置，而非新建文件

### 改动范围

| 文件 | 改动 | 影响 |
|------|------|------|
| `decision-engine.service.ts` | 调整规则匹配需求定义（6条→对齐） | 低风险，规则替换 |
| `next-step-card.tsx` | 调整按钮文案、布局对齐需求 | 无风险 |
| `project/[id]/page.tsx` | 需求澄清页底部 +NextStepCard | +1行导入 |
| `delivery/page.tsx` | 交付页底部 +NextStepCard | +1行导入 |
| ~~`lib/knowledge/decisionTree.ts`~~ | **不需要** — 复用现有后端 | — |

### 不变的部分

- 架构不动 — 仍然是后端决策+前端展示
- API端点不变 — `GET /api/projects/:id/next-step`
- 数据库不变 — 无新表
- 前端组件不变 — NextStepCard 复用

### 工作量估算

| 步骤 | 时间 |
|------|------|
| 调整决策规则 (6条→需求对齐) | 30min |
| 调整前端按钮文案 | 10min |
| 添加展示位置 (2页面) | 10min |
| 验证 | 10min |
| **合计** | **~1小时** |

---

## 四、不建议纯前端方案的原因

1. **数据不可达**: `clarityScore` 存储在 DB 的 `structuredRequirement` JSON 字段中，前端 Token 无法直接读取
2. **逻辑重复**: 建两套决策系统会导致后端给A建议、前端给B建议的不一致
3. **维护成本**: 后续改规则要改两处
4. **不可扩展**: 后续加入案例复盘、模板匹配等需要DB数据的功能无法在前端实现

---

## 五、结论

**建议**: 增强现有 `DecisionEngineService` + `NextStepCard`，对齐需求的6条规则和3个展示位置。**不动架构**，**不新增文件**。

**改动**: 4个文件，~1小时，零风险。
