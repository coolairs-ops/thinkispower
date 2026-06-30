# 思想动力 × Agent-Native 思路融合方案

> 用途：把这份文档复制给编程实现对话，作为下一阶段架构补强任务说明。
> 原则：保持思想动力现有优势，不迁移框架，不替换 NestJS/Prisma/BullMQ/若依交付链；只吸收 BuilderIO agent-native 的“统一动作层、运行记录、审批、审计、Agent/UI 同源调用”等设计，补齐当前平台短板。

## 0. 背景结论

思想动力当前已经具备很强的产品闭环：

- 需求澄清 → 规格冻结 → Demo 生成 → 反馈 → 自迭代 → 交付 → 若依控制台 → 上线门 → 守护。
- 后端模块完整，已有 NestJS、Prisma、BullMQ、传感器、若依置备、交付门、Guardian。
- 自迭代已经从 fire-and-forget 迁到 BullMQ，并用 `Project.autoIterateState` 做前端对账真相源。
- 缺口分流已接入：`inferFulfillment -> disposeGap -> auto-iterate / backend-provision / external-adapter / extend-generator / human`。

但当前短板也很明确：

- 平台能力分散在 controller/service/queue 中，没有统一“动作协议”。
- UI 调用、Agent 调用、后台任务、外部工具调用不是同一入口，审计和权限容易漂移。
- 自迭代、交付、若依置备、守护都有各自进度结构，缺少通用 Run/Progress 事实源。
- 高风险动作缺少统一审批门，如重新交付、上线、回滚、生产自动修复、外部系统对接。
- 缺口分流能判断“该去哪”，但还没有形成可追踪的工单/动作闭环。
- 运行过程可观测性不足：能看到结果，但不容易用统一方式解释“为什么卡住、下一步谁处理、处理到了哪”。

BuilderIO agent-native 的核心优势不是它的 UI 或框架，而是：

> 一个 Action 同时服务 UI、Agent、HTTP、MCP、A2A、CLI，并统一 schema、权限、审计、进度、审批、深链和工具暴露。

思想动力应该吸收这个思想，做自己的 `PlatformAction` 和 `PlatformRun` 层。

边界必须先定死：

> `PlatformAction` 不是新的“大脑”，它只是动作封装层和运行事实层。

它不能做需求判断，不能替代 Hermes 生成策略，不能替代传感器判分，不能替代上线门给出交付结论。它只负责动作声明、输入校验、权限、审批、审计、进度、运行记录和调用分发。真正的判断仍然属于原有责任方：

- 需求提升、规格冻结：由需求提升门、规格冻结门和相关传感器负责。
- 生成策略与多智能体编排：由 Hermes 负责。
- DeepSeek/Qwen 的生成与审计分工：由模型编排层负责。
- 质量评分、覆盖率、卡住判定：由传感器和自迭代策略层负责。
- 上线是否通过：由上线门和 Guardian 负责。
- 缺口如何分类：由现有 `inferFulfillment` / `disposeGap` 责任链负责。

## 1. 保留的现有优势

实现时不得破坏以下现有设计：

1. 保留 NestJS 模块体系，不引入 agent-native runtime。
2. 保留 Prisma schema 和现有业务表，不做大迁移。
3. 保留 BullMQ 作为长任务执行队列。
4. 保留若依作为政企交付主底座，`backendRuntime.kind='ruoyi'` 继续作为链 B 分流依据。
5. 保留上线门 `goLiveStatus` 的确定性判据，自迭代分数不能替代上线门。
6. 保留 `disposeGap` 缺口分流，不能把 external/backend/deferred 缺口重新丢回 Demo HTML 自修。
7. 保留“修生成器不修实例”原则。
8. 保留用户可见表达脱敏，不向用户暴露 Docker、Prisma、JWT、SSE、agent、传感器等内部词。

## 2. 总体目标

新增一个“平台动作层”，把当前分散能力统一成可声明、可调用、可审计、可进度追踪的动作。

目标形态：

```text
前端按钮
  ↓
PlatformAction
  ↓
权限/租户边界/输入校验/审批/审计/进度
  ↓
现有 Service / BullMQ Job / Hermes / 若依置备 / 传感器 / 交付门
  ↓
PlatformRun + RunEvent + RunStep
  ↓
前端进度、Agent 工具、守护报告、复盘沉淀
```

这不是重写业务，而是在现有 service 外面加一层统一“动作外壳”。

动作外壳只问三件事：

1. 这个动作谁能调，是否需要审批？
2. 这个动作调用了哪个现有能力，执行到了哪里？
3. 这个动作留下了什么审计、进度和结果事实？

它不回答“需求是否完整”“下一轮该怎么生成”“分数是否达标”“能不能上线”这些业务判断问题。

## 3. 要解决的实际短板

| 当前短板 | 融合方案 | 解决效果 |
|---|---|---|
| UI、后台任务、Agent 调用入口不统一 | 新增 `PlatformActionRegistry` | 同一能力只定义一次，前端/Agent/系统任务共用 |
| 输入校验散落在 DTO 和 service 中 | action input/output schema | 每个关键动作有清晰契约，减少调用漂移 |
| 自迭代状态只挂在 Project 字段里 | 新增通用 `PlatformRun` / `PlatformRunEvent` | 自迭代、交付、置备、守护都可追踪 |
| 高风险操作缺少统一审批 | action `approvalPolicy` | 上线、回滚、生产修复、外部对接可强制人工确认 |
| 审计不成体系 | action `auditPolicy` + `PlatformActionAudit` | 谁触发、改了什么、结果如何可追溯 |
| 缺口分流后缺少闭环 | 新增 `GapWorkItem` 或复用 Task 扩展 | 已经判定的 external/extend-generator/human 缺口进入可处理队列 |
| Agent 能力和 UI 能力分裂 | action `agentExposure` 元数据 | 未来 MCP/A2A/内部 Agent 可发现同一动作，但第一阶段不开放外部协议 |
| 卡住原因不够产品化 | RunEvent + terminal reason + next actions | 用户/运营能看到下一步，而不是只看到“失败” |

## 4. 第一阶段范围

第一阶段只做动作层骨架和两个真实接入点，不追求全平台迁移。

必须接入：

1. 自迭代启动/停止/状态查询。
2. 终稿交付触发与运行记录。
3. Guardian 手动巡检触发与运行记录。

推荐接入：

4. 若依底座指定 `ruoyi/designate`。
5. 缺口工作项创建/更新。

第一阶段验收目标：

- 不改变现有 API 行为。
- 新 action 层可以被现有 controller 内部调用。
- 自迭代、交付、Guardian 至少一个流程能写入通用 run/event。
- action audit 能记录成功/失败。
- 需要审批的动作能返回 `approval_required`，不会直接执行。
- action runner 单测证明：它不调用 Hermes 生成策略、不调用传感器判分、不自行改变上线门结论。

## 5. 新增核心模型

### 5.1 Prisma 模型建议

新增三个模型，字段命名按现有 snake_case map 风格。

```prisma
model PlatformRun {
  id          String   @id @default(uuid()) @db.Uuid
  projectId   String?  @map("project_id") @db.Uuid
  orgId       String?  @map("org_id") @db.Uuid
  actionKey   String   @map("action_key")
  runType     String   @map("run_type") // auto_iterate | delivery | ruoyi_provision | guardian | gap_workflow
  status      String   @default("running") // running | awaiting_approval | awaiting_decision | completed | failed | cancelled | interrupted
  caller      String   @default("system") // frontend | system | agent | webhook | cli
  userId      String?  @map("user_id") @db.Uuid
  taskId      String?  @map("task_id")
  summary     String?
  score       Int?
  progress    Int      @default(0)
  terminal    Json?
  metadata    Json?
  startedAt   DateTime @default(now()) @map("started_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  completedAt DateTime? @map("completed_at")

  events PlatformRunEvent[]
  steps  PlatformRunStep[]

  @@index([projectId, startedAt])
  @@index([orgId, startedAt])
  @@index([actionKey, status])
  @@map("platform_runs")
}

model PlatformRunEvent {
  id        String   @id @default(uuid()) @db.Uuid
  runId     String   @map("run_id") @db.Uuid
  type      String   // started | phase_update | score | gap_routed | approval_required | terminal | error
  message   String?
  payload   Json?
  createdAt DateTime @default(now()) @map("created_at")

  run PlatformRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, createdAt])
  @@map("platform_run_events")
}

model PlatformRunStep {
  id        String   @id @default(uuid()) @db.Uuid
  runId     String   @map("run_id") @db.Uuid
  stepKey   String   @map("step_key")
  name      String
  status    String   @default("pending") // pending | running | done | failed | skipped
  score     Int?
  detail    Json?
  startedAt DateTime? @map("started_at")
  endedAt   DateTime? @map("ended_at")

  run PlatformRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, stepKey])
  @@map("platform_run_steps")
}

model PlatformActionAudit {
  id         String   @id @default(uuid()) @db.Uuid
  actionKey  String   @map("action_key")
  projectId  String?  @map("project_id") @db.Uuid
  orgId      String?  @map("org_id") @db.Uuid
  userId     String?  @map("user_id") @db.Uuid
  caller     String
  status     String   // success | error | approval_required | denied
  input      Json?
  output     Json?
  error      String?
  runId      String?  @map("run_id") @db.Uuid
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([projectId, createdAt])
  @@index([actionKey, createdAt])
  @@map("platform_action_audits")
}
```

如果不想第一阶段增加太多表，可以先只加 `PlatformRun`、`PlatformRunEvent`、`PlatformActionAudit`，`PlatformRunStep` 第二阶段再补。

建议第一阶段采用最小表集：

- `PlatformRun`
- `PlatformRunEvent`
- `PlatformActionAudit`

`PlatformRunStep`、`GapWorkItem` 放到第二阶段，避免一开始把动作层做重。

### 5.2 不要替代现有字段

第一阶段不要删除：

- `Project.autoIterateState`
- `Task`
- `BuildJournalEntry`
- `DecisionLog`

做法是“双写”：

- 现有前端仍读 `autoIterateState`。
- 新平台运行中心写 `PlatformRun/Event`。
- 等前端 Run UI 成熟后，再逐步把状态查询迁到通用 run endpoint。

## 6. 新增 PlatformAction 层

### 6.1 目录建议

```text
apps/api/src/platform-actions/
  platform-action.module.ts
  platform-action.types.ts
  platform-action.registry.ts
  platform-action-runner.service.ts
  platform-run.service.ts
  platform-action-audit.service.ts
  platform-action.controller.ts
  definitions/
    auto-iterate.actions.ts
    delivery.actions.ts
    ruoyi.actions.ts
    guardian.actions.ts
    gap-workflow.actions.ts
```

### 6.2 Action 定义类型

```ts
export type PlatformActionCaller = 'frontend' | 'system' | 'agent' | 'webhook' | 'cli';

export interface PlatformActionContext {
  caller: PlatformActionCaller;
  userId?: string;
  orgId?: string;
  projectId?: string;
  runId?: string;
  requestId?: string;
}

export interface PlatformActionDefinition<I = unknown, O = unknown> {
  key: string;
  title: string;
  description: string;
  runType: 'auto_iterate' | 'delivery' | 'ruoyi_provision' | 'guardian' | 'gap_workflow' | 'project';
  inputSchema: {
    parse(input: unknown): I;
  };
  outputSchema?: {
    parse(output: unknown): O;
  };
  readOnly?: boolean;
  parallelSafe?: boolean;
  requiresProject?: boolean;
  approvalPolicy?: 'never' | 'always' | 'production_only' | 'high_risk_only';
  auditPolicy?: 'none' | 'mutations' | 'always';
  agentExposure?: {
    enabled: boolean;
    readOnly: boolean;
    requiresAuth: boolean;
    metadataOnly?: boolean;
  };
  execute(input: I, ctx: PlatformActionContext): Promise<O>;
}
```

第一阶段可直接用 Zod 作为 schema：

```ts
import { z } from 'zod';

export const StartAutoIterateInput = z.object({
  projectId: z.string().uuid(),
});
```

需要新增依赖时先检查项目是否已有 zod；没有则可用 `class-validator` 或轻量内部 parse。优先保持依赖克制。

### 6.3 Runner 职责

`PlatformActionRunnerService` 统一处理：

1. 查找 action。
2. input schema 校验。
3. project/org 权限检查。
4. approval 判断。
5. 创建 `PlatformRun`。
6. 调用既有 service/job/controller 责任链。
7. 写 `PlatformActionAudit`。
8. 写 run terminal event。
9. output schema 校验。
10. 返回标准结果。

Runner 不允许包含以下逻辑：

- 不根据自然语言推断需求结构。
- 不决定 Hermes 走哪条生成策略。
- 不直接调用 DeepSeek/Qwen 来生成或审计。
- 不重算传感器分数。
- 不根据 coverage/score 决定项目是否完成。
- 不改写上线门 `goLiveStatus` 的判定标准。

标准返回：

```ts
type PlatformActionResult<T> =
  | { ok: true; actionKey: string; runId?: string; data: T }
  | { ok: false; actionKey: string; runId?: string; error: string; code: string }
  | { ok: false; actionKey: string; runId?: string; approvalRequired: true; approvalToken: string; message: string };
```

## 7. 第一批 Action 定义

### 7.1 `auto-iterate.start`

包装现有：

- `DeliveryIterationService.startAutoIterate(projectId)`

输入：

```ts
{ projectId: string }
```

输出：

```ts
{ taskId: string }
```

策略：

- `runType = auto_iterate`
- `approvalPolicy = never`
- `auditPolicy = always`
- `agentExposure.enabled = true`
- `agentExposure.metadataOnly = true`
- `parallelSafe = false`

补强点：

- 创建 `PlatformRun`，metadata 记录 taskId。
- 在 `executeAutoIterate` 里，如果 ctx/runId 可用，同步写 `PlatformRunEvent`。
- 保持 `Project.autoIterateState` 原逻辑不变。

### 7.2 `auto-iterate.stop`

包装现有：

- `DeliveryIterationService.stopAutoIterate(projectId)`

策略：

- `approvalPolicy = never`
- `auditPolicy = always`
- `agentExposure.enabled = true`
- `agentExposure.metadataOnly = true`

### 7.3 `delivery.deliver`

包装现有：

- `DeliveryService.deliver` 或 controller 当前调用链。

策略：

- `runType = delivery`
- `approvalPolicy = production_only`
- `auditPolicy = always`
- `agentExposure.enabled = true`
- `agentExposure.readOnly = false`

规则：

- 如果项目已有 `productionUrl` 且要重新交付，需要 approval。
- 如果会触发若依置备、构建、上线门，需要写 run event。
- 输出可以包含既有交付链返回的 `goLiveStatus`，但该状态必须由交付服务/上线门产生，不能由 PlatformAction 自行判定。

### 7.4 `ruoyi.designate`

包装现有：

- `RuoyiProvisionService.designate` 或对应 controller。

策略：

- `approvalPolicy = never`
- `auditPolicy = always`
- `agentExposure.enabled = true`

解决短板：

- 防止“designate 被 demo/部署路径覆盖”这类问题再次隐形。所有变更 backendRuntime.kind 的动作必须可审计。

### 7.5 `guardian.check.run`

包装现有：

- `GuardianService.runCheck`

策略：

- `runType = guardian`
- `approvalPolicy = never`
- `auditPolicy = always`
- `readOnly = true`，但如果会创建 remediation，则记录 mutation audit。

### 7.6 `gap.workitem.create`

承接现有分流结果：

- `inferFulfillment`
- `disposeGap`

输入：

```ts
{
  projectId: string;
  sourceRunId?: string;
  routed: Array<{
    recommendation: string;
    action: string;
    channel: string;
    customerAction?: string;
    reason?: string;
  }>;
}
```

输出：

```ts
{
  created: number;
  skipped: number;
}
```

关键边界：

- 这个 action 不负责判断缺口应该去哪里。
- 它只把已经由 `disposeGap` 判定的结果落入 `Task` 或第二阶段的 `GapWorkItem`。
- 它是“收口和排队”动作，不是“缺口分类器”。

## 8. 通用 Run 事件设计

自迭代当前已有事件：

- `round`
- `round_result`
- `phase_update`
- `gaps_routed`
- `fix_failed`
- `stuck_progress`
- `done`
- `stuck`
- `routed_stop`
- `needs_human`
- `error`

迁移到通用事件时保持兼容：

```ts
await platformRun.emit(runId, {
  type: 'score',
  message: '第 7 轮评分完成',
  payload: {
    round: 7,
    overallScore: 90,
    coverage: 48,
    l1: 97,
    l2: 100,
    l3: 76,
  },
});
```

推荐通用事件类型：

```text
started
phase_update
step_started
step_completed
score
gap_routed
approval_required
decision_required
artifact_created
terminal
error
```

## 9. 针对 e7ecab0f 自迭代过程的改进点

项目 `e7ecab0f-863e-4499-9441-22ec5b795d5b` 的真实自迭代过程显示：

```text
round 1: score 94, coverage 61
round 2: score 94, coverage 61
round 3: score 90, coverage 39
round 4: score 93, coverage 39
round 5: score 93, coverage 43
round 6: score 90, coverage 48
round 7: score 90, coverage 48
terminal: stuck, 连续3轮无改善
```

暴露的问题：

- overall score 达到 90，但 coverage 只有 48。
- L1/L2 高，说明结构和运行探测不错；L3/Traceability 仍提示核心需求未闭合。
- Excel 导入、快普同步、部门权限、老板只读等不应继续由 Demo HTML 自修。
- 当前卡住后虽然有 `routedGaps`，但还没有变成可持续处理的工作队列。

本方案解决方式：

1. 自迭代 run 终态写入 `PlatformRun.terminal`，明确 `stuck`。
2. `coverage` 作为传感器输出写入 run score，不再只看 overall score。
3. `routedGaps` 每项写成 `PlatformRunEvent(type='gap_routed')`。
4. external/extend-generator/human/backend-provision 缺口进入后续工作项。
5. 前端显示“下一步动作”，而不是“继续迭代”。

建议由传感器/自迭代策略层升级卡住判定：

```text
如果 overall >= 90 但 coverage < 70：
  不允许标记为真正需求完成；
  进入 awaiting_decision 或 routed_stop；
  展示“实现质量达标，但需求覆盖不足”。
```

这能解决当前“分数好看但需求没闭合”的短板。

注意：这条规则不能写进 `PlatformActionRunnerService`。PlatformAction 只能记录该判定结果，并根据已有结果创建 run terminal event 或缺口工作项。

## 10. 缺口工作项设计

第二阶段建议新增 `GapWorkItem`。

```prisma
model GapWorkItem {
  id             String   @id @default(uuid()) @db.Uuid
  projectId      String   @map("project_id") @db.Uuid
  orgId          String?  @map("org_id") @db.Uuid
  sourceRunId    String?  @map("source_run_id") @db.Uuid
  recommendation String
  action         String   // extend-generator | external-adapter | backend-provision | out-of-scope
  channel        String   // gap-workflow | provision | human
  status         String   @default("open") // open | planned | in_progress | resolved | rejected
  customerAction String?  @map("customer_action")
  reason         String?
  ownerType      String?  @map("owner_type") // platform | customer | engineer | system
  result         Json?
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([projectId, status])
  @@index([action, status])
  @@map("gap_work_items")
}
```

这能把现在的“缺口分类展示”升级成“缺口处理闭环”。

## 11. Controller 接入方式

不要一次性改完全部 controller。先在现有 controller 内部调用 action runner。

示例：

```ts
@Post('auto-iterate/start')
async startAutoIterate(@Req() req: any, @Param('projectId') projectId: string) {
  return this.actionRunner.run('auto-iterate.start', {
    projectId,
  }, {
    caller: 'frontend',
    userId: req.user?.id,
    orgId: req.user?.orgId,
    projectId,
  });
}
```

保持旧路由不变，避免前端大改。

## 12. 前端改造建议

第一阶段前端只加一个通用运行视图组件，不重做所有页面。

新增：

```text
apps/web/src/components/run-timeline.tsx
apps/web/src/components/action-result-panel.tsx
```

展示：

- 当前 run status。
- phases/steps。
- score/coverage。
- routed gaps。
- terminal reason。
- next actions。

自迭代页仍可读旧 `auto-iterate/status`，但如果返回 `runId`，优先展示通用 run timeline。

## 13. 审批门策略

第一阶段只实现最小审批：

```ts
type ApprovalPolicy = 'never' | 'always' | 'production_only' | 'high_risk_only';
```

需要审批的动作：

- 重新交付已上线项目。
- 回滚生产产物。
- 对生产项目执行 Guardian 自动修复。
- 外部系统真实对接。
- 删除项目/删除交付产物。

审批返回：

```json
{
  "ok": false,
  "approvalRequired": true,
  "approvalToken": "...",
  "message": "该操作会重新交付已上线项目，需要确认"
}
```

第二阶段再做 approval token 持久化和前端确认弹窗。

## 14. 审计策略

所有 mutation action 默认审计：

- actionKey
- caller
- userId
- orgId
- projectId
- input 摘要
- output 摘要
- error
- runId

不要把密钥、token、密码、完整源码、完整 HTML 写入 audit。

审计摘要需要脱敏：

- console password 只记录是否存在，不记录明文。
- demoHtml 只记录长度/hash。
- LLM prompt 不直接落审计。

## 15. 实施步骤

### Step 1：建表和基础服务

- 添加 Prisma models：`PlatformRun`、`PlatformRunEvent`、`PlatformActionAudit`。
- `prisma generate`。
- 新增 `PlatformActionModule`。
- 新增 `PlatformRunService`。
- 新增 `PlatformActionAuditService`。

### Step 2：实现 Action Registry 和 Runner

- `PlatformActionRegistry` 注册 action definitions。
- `PlatformActionRunnerService.run(actionKey, input, ctx)`。
- 支持 input parse、approval、audit、run 创建、error 捕获。
- 增加边界测试，确保 runner 不直接依赖 Hermes、传感器、LLM 生成服务。

### Step 3：接入自迭代

- 定义 `auto-iterate.start`、`auto-iterate.stop`、`auto-iterate.status`。
- 原 controller 改为调用 action runner。
- `DeliveryIterationService.executeAutoIterate` 可选接收 runId，或通过 taskId 查 PlatformRun。
- 关键事件双写到 `PlatformRunEvent`。

### Step 4：接入交付

- 定义 `delivery.deliver`。
- 对已上线项目重新交付返回 approval_required。
- 交付开始、验收、若依置备、构建、上线门分别写 run event。

### Step 5：接入缺口分流

- 定义 `gap.workitem.create`。
- `triageRecommendations` / `disposeGap` 仍负责分类。
- routed gaps 由原有责任链写 run event。
- action 只负责把 routed gaps 落成 `Task` 或第二阶段的 `GapWorkItem`。

### Step 6：前端最小展示

- 在评估页/交付页展示 run timeline。
- 对 `approval_required` 做基础确认 UI。
- 对 `routedGaps` 展示“下一步动作”。

## 16. 测试要求

必须新增单测：

1. action input 校验失败返回标准错误。
2. mutation action 成功写 audit。
3. action 执行异常写 audit error。
4. production_only 审批门阻止已上线项目重新交付。
5. auto-iterate.start 创建 PlatformRun。
6. 自迭代 `gaps_routed` 写 PlatformRunEvent。
7. `overall >= 90 && coverage < 70` 不被误判为需求完成。
8. PlatformActionRunner 不直接调用 Hermes、传感器判分或 LLM 生成服务。

建议新增 e2e：

- 启动自迭代 → 查询 run timeline → 至少看到 started/score/terminal。
- 对已上线项目触发 deliver → 返回 approval_required。

## 17. 非目标

第一阶段不要做：

- 不迁移到 agent-native。
- 不引入 MCP/A2A 对外协议。
- 不重构所有 controller。
- 不替换现有 `Project.autoIterateState`。
- 不重做前端所有页面。
- 不把缺口工作流做成完整运营后台。
- 不把 PlatformAction 做成需求判断中心。
- 不把 PlatformAction 做成 Hermes 的替代品。
- 不把 PlatformAction 做成传感器评分层。
- 不把 PlatformAction 做成上线门结论层。
- 不让 PlatformAction 直接决定 Demo 是否合格、规格是否冻结、项目是否可上线。

## 18. 最终收益

完成后，思想动力会保留自己的核心护城河：

- 若依交付底座。
- 需求到交付闭环。
- 多传感器自迭代。
- 缺口分流。
- 上线门。
- Guardian 守护。

同时补上 agent-native 最强的工程能力：

- 一个动作，多端复用。
- UI 和 Agent 同源调用。
- 长任务统一运行记录。
- 高风险操作统一审批。
- 变更统一审计。
- 进度和卡点可解释。
- 缺口从“发现”走向“处理闭环”。

一句话：

> 不把思想动力改成 agent-native，而是把思想动力升级成“Agent-Native 式的产品工厂”：人点按钮和 Agent 调工具，本质上都是调用同一套可信平台动作。
