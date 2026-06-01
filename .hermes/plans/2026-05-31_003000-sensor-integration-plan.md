# Phase 1: 传感器接入自迭代 + 跨模型交叉验证 + 需求追溯闭环

**日期**: 2026-05-31  
**状态**: 待审批  
**预估工时**: 2-3天

---

## 目标

将已完成的 L1/L2/L3 传感器系统接入自迭代引擎，用 Qwen 做跨模型交叉验证，用 TraceabilityValidator 做需求-实现追溯，实现"评估→修复→再评估"闭环，将质量上限推到 95%+。

---

## 当前状态

| 组件 | 文件 | 状态 |
|------|------|------|
| QwenClient | `sensors/qwen-client.service.ts` | ✅ 已实现，支持 DashScope API |
| CrossValidator | `sensors/cross-validator.service.ts` | ✅ Qwen 交叉验证 DeepSeek 输出 |
| TraceabilityValidator | `sensors/traceability-validator.service.ts` | ✅ 需求-实现追溯矩阵 |
| L1StaticSensor | `sensors/l1-static.sensor.ts` | ✅ HTML结构/批注/导航/体积 |
| L2RuntimeSensor | `sensors/l2-runtime.sensor.ts` | ✅ DB/EventBus/MinIO/N8N健康 |
| L3SemanticSensor | `sensors/l3-semantic.sensor.ts` | ✅ Demo完整性/反馈闭环/项目健康 |
| SensorFusionService | `sensors/sensor-fusion.service.ts` | ✅ 加权融合 L1*30+L2*20+L3*50 |
| SensorService | `sensors/sensor.service.ts` | ✅ 统一入口，支持单项目/全平台 |
| 自迭代引擎 | `delivery.service.ts:631` | ❌ 未接入传感器，用旧评分 |
| PlanGenerator | `plan-generator.service.ts` | ✅ 已输出 `acceptanceChecklist` |

**关键缺口**: 传感器与自迭代引擎之间没有连线。新系统全部就位但处于闲置状态。

---

## 实施步骤

### Step 1: 配置 Qwen API Key

**文件**: `apps/api/.env`

```bash
QWEN_API_KEY=sk-c35cb7e122044ad6bcba34ca4bf50be
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

**Docker 启动**: 在 `docker run` 命令中增加 `-e QWEN_API_KEY -e QWEN_BASE_URL -e QWEN_MODEL`

**验证**: `curl http://localhost:3002/api/sensors/health` 应返回包含 L3 评分的完整报告

---

### Step 2: 将 SensorFusionService 注入 DeliveryService

**文件**: `modules/delivery/delivery.service.ts`

在构造函数中注入：

```typescript
constructor(
  // ... 现有依赖 ...
  private sensorService: SensorService,
) {}
```

---

### Step 3: 改造 runAutoIterate() 核心循环

**文件**: `modules/delivery/delivery.service.ts` (行 631-710)

**改动**: 将每个迭代轮次从"analyzeSilent + qualityGate"替换为三步：

```
每轮迭代:
  1. SENSE  — SensorService.runAll(projectId)
     → 获取 FusedReport { overallScore, layer1Score, layer2Score, layer3Score,
                          recommendations, stopIteration, reports }
  
  2. DECIDE — 检查退出条件:
     - stopIteration=true 且 overallScore ≥ 90 → 达标，进入交付
     - stopIteration=true 且 overallScore < 90 → 用户介入
     - 连续3轮 overallScore 不变 → 用户介入
  
  3. FIX — 提取 recommendations 中可修复的问题:
     - TraceabilityValidator 返回的未实现需求 → 构造修复 prompt
     - CrossValidator 检测的 hallucination → 定向修复
     - L1 静态检查未通过项 → 传给 Cloudecode 修复
     - 调用 cloudecodeClient.executeTask() 定向修复
     - 等待修复完成 → 获取新 Demo HTML → 保存 Snapshot
     - 进入下一轮
```

**替换的旧代码**:

| 旧 | 新 |
|---|---|
| `analyzeSilent()` | `sensorService.runAll(projectId)` |
| `qualityGate.runAllChecks()` | 已在 L1StaticSensor 中复用 |
| `computeMixedScore(AI*0.4 + Q*0.3 + F*0.3)` | `FusedReport.overallScore` (L1*30+L2*20+L3*50) |
| 简单风险列表 | `recommendations` 数组（含需求级追溯） |

---

### Step 4: SSE 事件格式升级

**前端文件**: `projects/[id]/evaluation/page.tsx`

新 `round_result` 事件格式：

```typescript
{
  type: 'round_result',
  round: number,
  overallScore: number,
  scores: {
    l1: number,  // 静态检查
    l2: number,  // 运行时检查  
    l3: number,  // 语义检查
  },
  coverage: number,        // 需求覆盖率 % (TraceabilityValidator)
  passedChecks: number,
  totalChecks: number,
  recommendations: string[],
  missingRequirements: string[],  // 未实现的需求
  hallucinations: string[],       // 疑似幻觉
}
```

前端进度条改为三段式（L1 蓝 / L2 绿 / L3 紫）。

---

### Step 5: 新增验收标准提取增强

**文件**: `services/plan-generator.service.ts`

在 PlanPrompt 中增加验收标准要求（已有 `acceptanceChecklist` 字段），TraceabilityValidator 已支持从中提取。无需改代码，只需确保 plan 生成时 acceptanceChecklist 非空。

---

### Step 6: 修复闭环实施

**文件**: `modules/delivery/delivery.service.ts`（新增方法）

```typescript
private async autoFix(
  projectId: string, 
  recommendations: string[], 
  missingRequirements: string[]
): Promise<string | null> {
  // 构造定向修复 prompt
  const fixPrompt = [
    '请修复以下问题:',
    ...recommendations.map((r, i) => `${i + 1}. ${r}`),
    missingRequirements.length > 0 ? `\n缺失功能:\n${missingRequirements.join('\n')}` : '',
  ].join('\n');

  // 调用 Cloudecode 定向修复
  const taskId = await this.cloudecode.executeTask(...);
  // 等待修复完成
  // 返回新 Demo HTML
}
```

---

## 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `apps/api/.env` | 新增 QWEN_API_KEY 等 3 行 |
| `apps/api/src/modules/delivery/delivery.service.ts` | 重写 runAutoIterate (50行)+新增 autoFix (30行) |
| `apps/api/src/sensors/qwen-client.service.ts` | 加 shared httpAgent (同 DeepSeek 的修复) |
| `apps/web/src/app/projects/[id]/evaluation/page.tsx` | 升级 round_result 处理 + 三段进度条 |
| `apps/web/src/app/projects/[id]/delivery/page.tsx` | 无需改动（已有生成树） |

---

## 验证步骤

1. **API 健康检查**: `curl /api/sensors/health` → 返回 `{ status: "healthy", score: XX, layers: { l1, l2, l3 } }`
2. **单项目传感器**: `curl /api/sensors/report/:projectId` → 返回完整传感器报告含 Traceability
3. **自迭代端到端**: 
   - 登录 → 创建项目 → 确认方案 → Demo → 评估页 → 启动自迭代
   - 观察 SSE 流中的 `round_result` 是否包含 L1/L2/L3 分项评分
   - 观察是否有 `missingRequirements` 和 `hallucinations` 字段
   - 观察评分是否在迭代中上升
4. **交叉验证验证**: 检查 API 日志确认 Qwen 被调用（`[QwenClient]` 日志）
5. **交付页生成树**: 启动生产交付后，树面板应显示文件结构和阶段流程

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Qwen API 不可用 | 低 | QwenClient.available 检查，不可用时降级为 DeepSeek 自评 |
| 修复循环无限进行 | 中 | MAX_ROUNDS=10 + 连续3轮评分不涨则停止 |
| DeepSeek 修复不精准 | 高 | 修复后立即重新评估，不通过则标记为"需人工介入" |
| L2RuntimeSensor 依赖外部服务 | 中 | L2 失败不影响整体评分（只影响权重 20%） |
| ScreenshotComparator 在 Docker 不可用 | 高 | 暂不启用，仅用 L2RuntimeSensor 的 DB/EventBus 检查 |

---

## 成本估算

- Qwen Plus API: ¥0.0008/1K tokens → 每次交叉验证约 6000 tokens 输入 + 500 tokens 输出 ≈ ¥0.005/次
- 每次完整迭代（L1+L2+L3）≈ 2 次 LLM 调用（DeepSeek + Qwen）× ¥0.01 ≈ ¥0.02/轮
- 10 轮完整自迭代 ≈ ¥0.20
