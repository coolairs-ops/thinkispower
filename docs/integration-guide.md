# 系统集成架构指南

## 概述

本文档描述思想动力平台三大集成组件（Hermes、N8N、Cloudecode）的**当前运行状态**、代码位置、交互流程和配置方式。三个组件均已实现并注册到主模块，非桩代码。

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                     Think-is-power API (port 3001)              │
│                                                                  │
│  EventBus ──→ HermesListener ──→ N8nClient ──→ n8n (port 5678)  │
│      │              │                                            │
│      │              └──→ PipelineService (降级路径)                │
│      │                          │                                │
│      └──────────────────→ CloudecodeClient ──→ DeepSeek API      │
│                                                                  │
│  控制器: HermesClient / ProductDiscovery / PlanGenerator         │
│  执行器: N8N / PipelineService / CloudecodeClient                │
│  传感器: L1StaticSensor / L2RuntimeSensor / L3SemanticSensor     │
└──────────────────────────────────────────────────────────────────┘
```

| 组件 | 职责 | 当前状态 |
|------|------|---------|
| **HermesClient** | 需求分析、反馈拆解、交付分析 | ✅ 已实现，已注册 |
| **HermesListener** | 事件驱动：监听 FEEDBACK_CREATED → 自动拆解 | ✅ 已实现 |
| **N8nClient** | 工作流编排触发 | ✅ 已实现，已注册 |
| **CloudecodeClient** | AI 代码生成与修改 | ✅ 已实现，已注册 |
| **PipelineService** | N8N 不可用时的本地降级执行器 | ✅ 已实现 |

---

## 二、组件详情

### 2.1 HermesClient (`apps/api/src/integrations/hermes/hermes.client.ts`)

AI 驱动的分析与拆解引擎。核心方法：

| 方法 | 触发时机 | 说明 |
|------|---------|------|
| `handleFeedback(feedbackId)` | 用户提交批注意见 | 读取意见 + Demo HTML → 调 DeepSeek 拆解为 Task → 创建任务 → 发 TASKS_CREATED 事件 |
| `handleDeliveryExport(projectId)` | 用户导出交付物 | 分析项目 → 创建导出/部署任务 |
| `handlePrdReady(projectId, prd, summary)` | PRD 确认 | 保存结构化需求 → 推进项目状态 |
| `analyzeSilent(projectId, html, plan, desc)` | 交付分析 | 生成完整性/风险/建议报告（不创建任务） |
| `analyzeProject(projectId)` | 项目摘要 | 查询 Prisma 返回项目概要 |

### 2.2 HermesListener (`apps/api/src/integrations/hermes/hermes.listener.ts`)

事件驱动监听器。订阅 `FEEDBACK_CREATED` 事件：

```
用户提交批注意见
    → FeedbackService.create()
    → 发出 FEEDBACK_CREATED 事件
    → HermesListener.handleFeedbackCreated()
    → HermesClient.handleFeedback() → 拆解为 Task
    → N8nClient.triggerTaskPlanningWorkflow()  [N8N 路径]
    → 或 发出 TASKS_CREATED 事件 [Pipeline 降级路径]
```

### 2.3 N8nClient (`apps/api/src/integrations/n8n/n8n.client.ts`)

Webhook 触发客户端。向运行中的 N8N 实例发送 POST 请求：

| 方法 | HTTP | Webhook 路径 |
|------|------|-------------|
| `triggerTaskPlanningWorkflow(projectId, feedbackId, taskIds)` | POST | `/webhook/task-planning` |
| `triggerDemoGenerateWorkflow(projectId)` | POST | `/webhook/demo-generate` |
| `triggerDeliveryExportWorkflow(projectId, deliveryType)` | POST | `/webhook/delivery-export` |
| `triggerWorkflow(workflowName, payload)` | POST | `/webhook/{workflowName}`（通用） |

所有方法均包含错误处理和请求追踪（UUID）。

### 2.4 CloudecodeClient (`apps/api/src/integrations/cloudecode/cloudecode.client.ts`)

AI 代码生成与修改客户端，不直接调用外部 HTTP 服务，而是封装 DeepSeek API 调用。核心方法：

| 方法 | 用途 |
|------|------|
| `executeTask(taskId)` | 执行单个修改任务：读取任务描述 → 调 DeepSeek 修改 HTML → 保存快照 → 回写 |
| `generateDemoHtmlDirect(projectId, planSummary)` | 从方案生成完整 Demo HTML + 注入批注支持 |
| `deliverFullstack(projectId, opts)` | 全栈交付：生成 DB Schema + Express 后端 + 前端 + Docker + README |
| `generateAsset(taskType, project)` | 导出产物：源码仓库 / 数据库 SQL / 部署配置 |
| `executeTaskForProject(projectId, fixDescription)` | 自迭代引擎中直接修改 HTML（不走 Pipeline） |
| `injectAnnotationSupport(html)` | 为 Demo HTML 注入批注交互支持 |

### 2.5 PipelineService (`apps/api/src/services/pipeline.service.ts`)

N8N 不可用时的本地降级执行器（440+ 行）：

```
TASKS_CREATED 事件
    → PipelineService.handleTasksCreated()
    → 逐任务调用 CloudecodeClient.executeTask()
    → HtmlValidatorService 验证结果
    → 失败重试（最多 3 次）
    → 快照回滚（全部失败时）
    → 发出 TASKS_COMPLETED 事件
```

### 2.6 TaskModule (`apps/api/src/modules/task/`)

已完整实现：`TaskController` + `TaskService` + `CreateTaskDto` + `UpdateTaskDto`

| 方法 | 用途 |
|------|------|
| `create(data)` | 创建任务 |
| `findById(id)` | 查询单个任务 |
| `findByProject(projectId)` | 查询项目所有任务 |
| `getPendingTasks(projectId)` | 查询待处理任务 |
| `updateStatus(id, status, extra?)` | 更新状态 + 结果/错误信息 |

---

## 三、数据流：批注意见处理闭环

```
用户点选 Demo 元素 → 填写意见 → 提交
    │
    ▼
POST /api/projects/:id/feedback
    → 存入 FeedbackItem (status: new)
    → 发出 FEEDBACK_CREATED 事件
    │
    ▼
HermesListener.handleFeedbackCreated()
    → HermesClient.handleFeedback(feedbackId)
    → 查询项目 + 反馈
    → 构建 Prompt: 意见 + Demo HTML
    → 调 DeepSeek → 拆解为 1-N 个任务
    → 创建 Task 记录 (status: pending)
    → FeedbackItem 关联 generatedTaskId
    │
    ├── N8N 可用 → N8nClient.triggerTaskPlanningWorkflow()
    │              → n8n 回调 internal/workflows/run-tasks
    │
    └── N8N 不可用 → 发出 TASKS_CREATED 事件
                     → PipelineService.handleTasksCreated()
                     → 逐任务: CloudecodeClient.executeTask()
                     → HtmlValidator 验证 → 重试 → 快照回滚
                     → 发出 TASKS_COMPLETED 事件
    │
    ▼
FeedbackService 处理 TASKS_COMPLETED
    → 更新 FeedbackItem.status = 'resolved'
    → 更新项目状态
    → 用户刷新 → 看到新版 Demo
```

---

## 四、配置

```env
# N8N 工作流引擎（可选，不可用时自动降级到 PipelineService）
N8N_URL=http://localhost:5678

# Cloudecode 代码执行引擎（内部 HTTP，非必须）
CLOUDECODE_API_URL=http://localhost:5000

# DeepSeek API（核心依赖，所有 AI 能力）
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEY=sk-xxxx
DEEPSEEK_MODEL=deepseek-chat

# Qwen API（传感器交叉验证用，辅助）
QWEN_API_KEY=sk-xxxx
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

---

## 五、对应的 N8N 工作流

| 工作流文件 | Webhook 路径 | 职责 |
|-----------|-------------|------|
| `internal/n8n-workflows/clarify.json` | `clarify` | 需求整理 |
| `internal/n8n-workflows/plan.json` | `plan` | 方案生成 |
| `internal/n8n-workflows/demo-generate.json` | `demo-generate` | Demo 生成（调 cc-bridge） |
| `internal/n8n-workflows/feedback.json` | `feedback` | 批注触发的任务执行 |
| `internal/n8n-workflows/task-planning.json` | `task-planning` | 批注任务编排 |
| `internal/n8n-workflows/delivery-export.json` | `delivery-export` | 交付导出 |
| `internal/n8n-workflows/deploy.json` | `deploy` | 部署上线 |

所有工作流均在 n8n 控制台（`localhost:5678`）导入并激活后生效。N8N 不可用时所有功能通过 PipelineService 降级运行。

---

## 六、代码索引

| 文件 | 内容 |
|------|------|
| `apps/api/src/integrations/n8n/n8n.client.ts` | N8N 客户端（已实现） |
| `apps/api/src/integrations/n8n/n8n.module.ts` | N8N 模块 |
| `apps/api/src/integrations/hermes/hermes.client.ts` | Hermes 客户端（已实现） |
| `apps/api/src/integrations/hermes/hermes.listener.ts` | 事件监听器（已实现） |
| `apps/api/src/integrations/cloudecode/cloudecode.client.ts` | Cloudecode 客户端（已实现） |
| `apps/api/src/modules/task/task.service.ts` | 任务 CRUD（已实现） |
| `apps/api/src/modules/task/task.controller.ts` | 任务 API（已实现） |
| `apps/api/src/modules/feedback/feedback.service.ts` | 反馈处理（含闭环逻辑） |
| `apps/api/src/services/pipeline.service.ts` | 本地降级执行管线（440 行） |
| `apps/api/src/services/delivery-orchestrator.service.ts` | 交付编排（860 行） |
| `apps/api/src/services/deepseek.service.ts` | DeepSeek API 封装 |
| `apps/api/src/services/quality-gate.service.ts` | 质量门禁 |
| `apps/api/src/sensors/` | L1/L2/L3 传感器系统 |
| `apps/api/src/app.module.ts` | 主模块（所有集成已注册） |
