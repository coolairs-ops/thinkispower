# P15-Y 验收报告 — 实现交接

> 交接自一个已很长的会话；Phase 1.5 导入闭环、demo 防卡死、需求理解 PM 化均已完成。本文件是 P15-Y 的调研结论 + 实现拆解，供新会话 fresh 上下文直接上手。

> ✅ **已实现（2026-06-06）**。四步全部落地并本地端到端验证通过：
> - 场景真实化：`spec-materialize.service.ts` 从 features 生成真实 GWT（LLM + 确定性兜底，带 coverage/provenance）；实测 12 功能 → 20 条专业场景。
> - 报告模型 + 服务：`Specification` 加 `verificationResults/passRate/verifiedAt`（db push 已同步）；新增 `apps/api/src/modules/delivery/acceptance-verification.service.ts`（聚合场景↔传感器检查+语义判定，算 passRate，落库 + changeLog 留痕）。
> - 交付门控：`delivery-evaluation.service.ts` `requestEvaluation` 返回 `acceptance`；`productionDeliver` 前置 passRate≥阈值(默认 0.8，可配 `ACCEPTANCE_PASS_RATE_THRESHOLD`)。
> - API：`delivery.controller.ts` 加 `GET acceptance-report`/`POST acceptance-verify`/`POST acceptance-manual-confirm`。
> - 前端：`apps/web/src/app/projects/[id]/acceptance-report/page.tsx`（逐条卡片+来源/覆盖标签+证据+通过率仪表盘+导出 JSON+人工裁定回写）；NavBar 加「验收报告」入口。
> - 单测：spec-materialize / acceptance-verification / delivery-evaluation 全绿。
> 下文为原始调研记录，保留备查。

## 目标（执行计划 P15-Y）

端到端溯源链 + 可审计验收报告：逐条 `acceptanceScenario` → **来源(provenance)** → **实现** → **检查结果(通过/未通过/待人工)**；产出可导出、可审计的验收报告；规格变更 `changeLog` 留痕；**通过率门控接入交付**。呼应立身之本③「可验收/可追溯」。

参考：`docs/EXECUTION_PLAN_P0_P15_REV.md` 的 §1.3、§3、P15-Y 任务包。

## 现状调研结论（关键文件）

### acceptanceScenarios
- 数据模型：`apps/api/prisma/schema.prisma` 的 `Specification.acceptanceScenarios: Json?`，形状 `{name, given, when, then, priority}`；同模型有 `changeLog`、`version`、`frozenAt`。
- 读写：`apps/api/src/modules/specification/specification.service.ts`（草案生成 / `isBugWithinSpec` 判定用到，**只判定不执行验证**）；导入路径 `apps/api/src/modules/professional-import/spec-materialize.service.ts` 的 `assemble()`（约 L139-141）**给的是一条占位场景**。
- 前端：`apps/web/src/app/projects/[id]/spec/page.tsx` 有 acceptanceScenarios 的展示/编辑。

### sensors（L1/L2/L3 检查）
- `apps/api/src/sensors/`：l1-static / l2-runtime / l3-semantic / cross-validator / traceability-validator。
- 结果结构：`apps/api/src/sensors/sensor-report.interface.ts` 的 `SensorReport {sensorName,layer,passed,score,checks}` 与 `FusedReport {overallScore,layerNScore,passed,reports[],recommendations[],stopIteration}`。
- `sensor.service.ts runAll()` 返回 `FusedReport`，**不落库、checks 不按 acceptanceScenario/功能维度组织**。
- 触发者：`delivery-iteration.service.ts`（自迭代）、`delivery-evaluation.service.ts`（评估，走 quality-gate）。

### delivery / 评估
- `apps/api/src/modules/delivery/delivery.controller.ts`：`/evaluate`、`/deliver`、`/auto-iterate/start`。
- `delivery-evaluation.service.ts`：`requestEvaluation()`（Hermes 分析 + QualityGate）、`productionDeliver()`。
- **无 VerificationReport 输出、无按场景的 passRate 门控**；acceptanceScenarios 在交付/评估里未被使用。

### 溯源 / 快照 / changeLog
- 溯源已就位（导入路径）：`spec-materialize.service.ts` 给每个 coreFunction/page/role 加 `provenance: string[]`（来源文件名）；上游 `RequirementUnderstanding.features/pages/roles` 为 `[{name,sources[]}]`。
- `apps/api/src/modules/demo-snapshot/`：demoHtml 版本快照（无报告内容）。
- `Specification.changeLog`：`updateSpec()` 记录字段变更（无验收结果跟踪）。

### 前端
- 已有页：`spec` / `evaluation` / `delivery` / `snapshots`（`apps/web/src/app/projects/[id]/`）。
- **无验收报告页**；evaluation/delivery 可挂，或新建 `/[id]/acceptance-report`。

## 三个前提缺口（必须先补，否则报告是空壳）

1. **acceptanceScenarios 是占位**：物化时只给一条默认场景，没有真实可验收的 Given-When-Then。→ 报告"逐条场景"无内容。
2. **sensors 结果不落库、不按场景关联**：L1/L2/L3 的 checks 独立评分，无法回答"场景 X 通过没有"，拿不到逐条检查证据。
3. **无报告输出 + 无通过率门控**：交付前无 passRate 检查，无可导出审计的报告。

## 实现拆解（建议顺序）

**第 1 步（数据地基，自包含、应先做）— acceptanceScenarios 真实化**
- 在 `spec-materialize.service.ts` 物化时，从 `RequirementUnderstanding.features`（已是带 provenance 的功能清单）为每个/每组核心功能生成真实的 Given-When-Then 场景：`{name, given, when, then, priority, provenance, coverage}`，`provenance` 沿用功能的来源，`coverage` 指向覆盖的功能/页面。可用 LlmGateway（text-primary）按功能批量生成 GWT（注意 maxTokens、JSON 兜底，参考 `import-parse.service.ts` 的 prompt+解析模式）。
- 描述路径（`specification.service.ts` generateDraft）也补一版真实场景生成，替代现有占位。
- 验证：导入一份文档走到规格页，acceptanceScenarios 是基于真实功能的多条 GWT、带来源。

**第 2 步 — 验收结果模型 + 报告服务**
- schema：`Specification` 加 `verificationResults: Json?`（`[{scenarioRef, status: pass|fail|manual, checks[], evidence, verifiedAt}]`）+ `passRate: Float?`。db push（项目用 db push，非 migrate）。
- 新增 `AcceptanceVerificationService`（建议放 `apps/api/src/modules/delivery/` 或 specification 模块）：把 sensors 的 `FusedReport.checks` 按场景/功能聚合到每条 acceptanceScenario，产出逐条 `{scenario → provenance 来源 → 实现(关联产物/Build/Demo) → 检查结果}`，计算 `passRate`。
- 关键：让 sensors 结果能按场景关联——可在 sensor 触发时带上 spec 的 scenarios，或在报告服务里用功能名/coverage 做映射（L3 语义检查最适合按场景判定）。

**第 3 步 — 接入交付门控**
- `delivery-evaluation.service.ts requestEvaluation()` 调用报告服务，返回 `{analysis, quality, acceptance}`；`productionDeliver()` 前置：`passRate >= 阈值`（如 0.8）才放行，否则走自愈/迭代。
- 验收结果变更写入 `changeLog`（谁/何时/基于哪版规格）。

**第 4 步 — 前端验收报告页 + 导出**
- 新建 `apps/web/src/app/projects/[id]/acceptance-report/page.tsx`（或在 evaluation 内嵌）：逐条场景卡片（name/GWT）+ 状态（通过/未通过/待人工）+ 来源标签（provenance）+ 检查证据 + 通过率仪表盘 + 导出按钮（先 JSON/结构化，PDF 可后续）。
- 人工确认（待人工场景）回写。

## 接入点小结
- DB：`prisma/schema.prisma`（Specification + verificationResults/passRate）
- Service：新增 AcceptanceVerificationService（聚合 Specification.acceptanceScenarios + SensorService 结果 + 产物）
- API：`delivery.controller` 加 `GET /acceptance-report`、`POST /acceptance-verify`
- 门控：`productionDeliver()` 前置 passRate
- 前端：`/[id]/acceptance-report`

## 验证方式
- 单测：报告服务（场景↔检查聚合、passRate 计算、门控判定）、acceptanceScenarios 生成。
- 端到端（本地栈，沿用既有方式）：起 redis + 后端(3002, DATABASE_URL=localhost:5433, MINIO=minioadmin/minioadmin_secret, DEEPSEEK_MODEL=deepseek-chat) + 前端(3009, NEXT_PUBLIC_API_URL=3002, 后端需 CORS_ORIGIN=http://localhost:3009)。测试账号 `verify-import@test.local` / `verify123`。导入 → 规格(真实场景) → 评估/交付 → 看验收报告 + passRate 门控。验证后清理服务/临时文件/MinIO imports 对象。

## 注意
- 项目用 **db push**（非 prisma migrate）；改 schema 后 `npx prisma db push --skip-generate && npx prisma generate`。
- 响应里 BigInt/Date 序列化、SanitizeInterceptor（Date 已修，见 `apps/api/src/services/sanitize.service.ts`）。
- 存量失败测试（auth.service / delivery-evaluation）与本任务无关，勿被误导。
