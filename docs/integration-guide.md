# n8n + Hermes + ClaudeCode 集成指南

## 概述

本系统目前使用 DeepSeek API 直接完成需求澄清、方案生成、Demo HTML 生成。以下流程**尚未接入**自动化编排：

```
用户提交批注意见 → n8n 触发 → Hermes 拆解任务 → ClaudeCode 修改代码 → 重新生成 Demo
```

本文档说明这三个组件的作用、现有代码中的集成点、以及如何接入。

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────┐
│  Think-is-power (NestJS API, port 3001)                 │
│                                                         │
│  N8nClient ───→ n8n (port 5678) ───→ Webhook 触发工作流 │
│  HermesClient ─→ Hermes (port 4000) ─── 任务编排    │
│  CloudecodeClient ─→ ClaudeCode (port 5000) ─── 代码执行 │
│                                                         │
│  各 client 位于 apps/api/src/integrations/              │
│  均已定义但未启用（TODO 桩代码）                          │
└──────────────────────────────────────────────────────────┘
```

**关键原则：** 每个组件只做一件事，通过 HTTP API 通信。

| 组件 | 职责 | 当前状态 |
|------|------|---------|
| **n8n** | 工作流编排、状态回调、定时轮询 | N8nClient 已定义，N8nModule 未注册 |
| **Hermes** | 解析批注意见 → 拆解为具体代码修改任务 | HermesClient 已定义（桩代码） |
| **ClaudeCode** | 接收任务 → 读取上下文 → 修改代码 → 报告结果 | CloudecodeClient 已定义（桩代码） |

---

## 二、现有集成点

### 2.1 N8nClient (`apps/api/src/integrations/n8n/n8n.client.ts`)

已定义 9 个 webhook 触发方法，全部为空实现（TODO）：

| 方法 | 触发时机 | 对应 n8n workflow |
|------|---------|-------------------|
| `triggerClarifyWorkflow(projectId)` | 用户第一次提交需求 | `clarify` |
| `triggerPlanWorkflow(projectId)` | 需求澄清完成 | `plan` |
| `triggerDemoWorkflow(projectId)` | 方案确认后 | `demo-generate` |
| `triggerTaskPlanningWorkflow(projectId)` | 批注意见提交后 | `task-planning` |
| `triggerFeedbackWorkflow(projectId, feedbackId)` | 批注意见提交后 | `feedback` |
| `triggerDeployWorkflow(projectId)` | 开发/测试完成 | `deploy` |
| `triggerDeliveryExportWorkflow(projectId, deliveryType)` | 用户请求导出 | `delivery-export` |
| `triggerCaseReviewWorkflow(projectId)` | 项目完成后 | `case-review` |
| `triggerExperienceRecommendationWorkflow(projectId, stage)` | 各阶段完成时 | `experience-recommend` |

**接入方式：**

```typescript
// 当前：直接调用 DeepSeek
const html = await this.demoGenerator.generateDemoHtml(plan);

// 接入后：通过 n8n 编排
await this.n8nClient.triggerDemoWorkflow(projectId);
// n8n → Hermes → ClaudeCode → 回调 API 更新 demoHtml
```

### 2.2 HermesClient (`apps/api/src/integrations/hermes/hermes.client.ts`)

用于将任务拆解为可执行的子任务。主要方法：

- `createJob(taskId, payload)` → 创建任务编排作业
- `getJob(jobId)` → 查询作业状态

Hermes 的职责：
1. 接收批注意见（如"表格增加一列操作按钮"）
2. 拆解为具体任务（"修改 list 页面的 render 函数，在表格最后加一列操作按钮"）
3. 创建 Task 记录到数据库
4. 调用 ClaudeCode 执行

### 2.3 CloudecodeClient (`apps/api/src/integrations/cloudecode/cloudecode.client.ts`)

接收 Hermes 拆解后的任务，执行实际代码修改。

`executeTask()` 接收参数：

```typescript
{
  projectId: string;
  taskId: string;
  jobId: string;
  workspacePath: string;      // 代码工作目录
  taskType: string;           // frontend | backend | fix
  moduleKey: string;          // 对应的模块
  title: string;
  description: string;
  acceptanceCriteria: string[];
  context?: Record<string, any>;
  constraints?: Record<string, any>;
}
```

### 2.4 TaskModule (`apps/api/src/modules/task/task.module.ts`)

**当前为空模块**。需要实现：

- `TaskService` — 创建/更新/查询 Task 记录
- `TaskController` — 供 n8n/Hermes/ClaudeCode 回调时查询和更新任务状态
- 与 FeedbackItem 的关联（`generatedTask` 关系）

### 2.5 N8nModule (`apps/api/src/integrations/n8n/n8n.module.ts`)

已定义但**未在 AppModule 中注册**。接入时需要：

```typescript
// apps/api/src/app.module.ts
import { N8nModule } from './integrations/n8n/n8n.module';

@Module({
  imports: [
    // ... 现有模块
    N8nModule,  // ← 添加
  ],
})
```

---

## 三、数据模型

### 3.1 Task (`prisma/schema.prisma`)

```prisma
model Task {
  id            String   @id @default(uuid())
  projectId     String   @map("project_id")
  moduleId      String?  @map("module_id")
  type          String   // frontend | backend | database | test | fix | deploy | export_source | ...
  title         String
  description   String
  priority      Int      @default(100)
  dependencies  Json?    // 依赖的其他任务 ID 列表
  status        String   @default("pending") // pending | running | completed | failed | blocked
  inputPayload  Json?    // 任务输入参数
  resultPayload Json?    // 执行结果
  retryCount    Int      @default(0)
  maxRetries    Int      @default(3)
  errorMessage  String?
}
```

Task 创建时机：
- FeedbackItem 提交后 → Hermes 解析意见 → 创建 Task
- 方案确认后 → 创建所有模块的初始 Task 列表

### 3.2 FeedbackItem

```prisma
model FeedbackItem {
  id              String   @id @default(uuid())
  projectId       String
  moduleKey       String?  // 对应 Demo HTML 的 data-module-key
  elementPath     String?  // 对应 Demo HTML 的 data-element-path
  comment         String   // 用户的修改意见
  status          String   @default("new")  // new → processing → resolved
  generatedTaskId String?  // 关联的 Task（意见处理完后关联）
}
```

### 3.3 DecisionLog（审计日志）

每次 n8n/Hermes 做出决策都应记录一条 DecisionLog：

```prisma
model DecisionLog {
  id             String
  projectId      String?
  taskId         String?
  ruleKey        String?   // 触发的决策规则
  stage          String    // clarify | plan | development | fix | deploy
  inputContext   Json      // 决策输入
  decisionResult Json      // 决策结果
  actionTaken    String?   // 执行的动作
  outcome        String?   // 执行结果
}
```

---

## 四、流程详解

### 4.1 批注意见处理流程（核心）

```
用户点击元素 → 填写意见 → 点击提交
    │
    ▼
POST /api/projects/:id/feedback  →  存入 FeedbackItem (status: new)
    │
    ▼
更新 Project.status = 'awaiting_demo_feedback'
    │
    ▼
调用 N8nClient.triggerFeedbackWorkflow(projectId, feedbackId)
    │  [当前：方法为空，不执行任何操作]
    ▼
n8n 接收 webhook → 编排工作流:
    │
    ├─ 1. 调用 Hermes API 解析意见
    │    Hermes:
    │    - 读取 FeedbackItem.comment
    │    - 读取当前 Project.demoHtml（批注的 HTML）
    │    - 根据 moduleKey / elementPath 定位修改范围
    │    - 拆解为 1-N 个 Task（设置 type、title、description）
    │    - 写入 Task 表 (status: pending)
    │    - 返回任务列表给 n8n
    │
    ├─ 2. 逐个执行 Task
    │    n8n 调用 Hermes → Hermes 调用 CloudecodeClient:
    │    - ClaudeCode 读取 Task 描述
    │    - 读取当前 demoHtml
    │    - 执行修改（调用 DeepSeek 生成修改后的 HTML）
    │    - 写入结果到 Task.resultPayload
    │    - 更新 Task.status = 'completed'
    │
    ├─ 3. 全部 Task 完成后
    │    n8n 回调 Think-is-power API:
    │    PATCH /api/projects/:id/feedback/:id (status: resolved)
    │    PUT /api/projects/:id/demo/html (更新 demoHtml)
    │    PATCH /api/projects/:id/status (更新项目状态)
    │
    └─ 4. 用户刷新页面看到新版 Demo
```

### 4.2 完整项目生命周期

```
                        n8n参与        当前实现
needs_input ───────────────────────────────────────
    │ 用户输入需求                               DeepSeek
    ▼
clarifying ───────────────────────────────────────
    │ 逐轮追问（最多 5 轮）                      DeepSeek
    ▼
plan_ready ──────────────────────────────────────
    │ 生成方案（页面清单、功能、角色等）          DeepSeek
    ▼
awaiting_plan_confirmation
    │ 用户编辑并确认方案
    ▼
demo_generating ───── n8n 可接手 ─────────────── DeepSeek 直接生成
    │ 生成 SPA HTML 预览
    ▼
demo_ready ──────────────────────────────────────
    │ 用户预览，可切换批注模式
    ▼
awaiting_demo_feedback ─── n8n 接手 ──────────── 未实现
    │ 用户提交批注意见 → 自动修改 → 重新生成
    ▼
developing ─────────── n8n 接手 ──────────────── 未实现
testing ───────────── n8n 接手 ──────────────── 未实现
fixing ────────────── n8n 接手 ──────────────── 未实现
deploying ─────────── n8n 接手 ──────────────── 未实现
completed
```

---

## 五、API 端点清单

接入 n8n/Hermes/ClaudeCode 时需要使用的端点：

### 现有端点

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/projects/:id/feedback` | 获取项目所有批注意见 |
| `POST` | `/api/projects/:id/feedback` | 创建批注意见 |
| `PATCH` | `/api/projects/:id/feedback/:fid` | 更新意见状态 |
| `GET` | `/api/projects/:id/demo` | 获取 demo HTML |
| `POST` | `/api/projects/:id/demo/generate` | 触发 demo 重新生成 |
| `GET` | `/api/projects/:id/plan` | 获取方案 |
| `GET` | `/api/projects/:id` | 获取项目详情 |
| `PATCH` | `/api/projects/:id/status` | 更新项目状态 |

### 需新增的端点

| 方法 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| `POST` | `/api/projects/:id/tasks` | Hermes 创建任务 | P3 |
| `GET` | `/api/projects/:id/tasks` | 查询任务列表 | P3 |
| `PATCH` | `/api/projects/:id/tasks/:tid` | ClaudeCode 更新任务状态 | P3 |
| `PUT` | `/api/projects/:id/demo/html` | n8n 回调更新 demo HTML | P3 |
| `POST` | `/api/projects/:id/feedback/:fid/process` | **手动处理一条意见**（不接 n8n 时的替代方案） | 可选 |
| `POST` | `/api/n8n/webhook/:workflow` | n8n 回调 webhook，接收工作流执行结果 | P4 |

---

## 六、环境变量

当前 `.env` 中的配置：

```env
# 已有（但未使用）
N8N_URL=http://192.168.124.126:15678
HERMES_URL=http://localhost:4000
CLOUDECODE_API_URL=http://localhost:5000

# 需新增
N8N_API_KEY=your_n8n_api_key
HERMES_API_KEY=your_hermes_api_key
CLOUDECODE_API_KEY=your_cloudecode_api_key  # 若需认证
N8N_WEBHOOK_BASE_URL=http://192.168.124.126:3001   # n8n 回调 API 的地址
```

---

## 七、n8n 工作流建议

### 7.1 需要创建的工作流

| 工作流名称 | 触发方式 | 职责 |
|-----------|---------|------|
| `feedback` | Webhook（由 N8nClient.triggerFeedbackWorkflow 触发） | 收到批注意见 → 调用 Hermes 拆解 → 执行 Task → 回调更新 |
| `demo-generate` | Webhook | 生成 Demo HTML（可用 DeepSeek 替代） |
| `deploy` | Webhook | 部署到生产环境 |
| `delivery-export` | Webhook | 导出源码/数据库/配置文件 |
| `case-review` | Webhook | 项目复盘 |
| `experience-recommend` | Webhook | 生成经验推荐 |

### 7.2 Feedback 工作流设计

```json
{
  "name": "批注意见处理流程",
  "nodes": [
    {
      "id": "webhook-trigger",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "feedback-{projectId}"
      }
    },
    {
      "id": "call-hermes",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://localhost:4000/hermes/jobs",
        "method": "POST",
        "body": "={{ $json }}"
      }
    },
    {
      "id": "poll-hermes",
      "type": "n8n-nodes-base.wait",
      "parameters": {
        "resume": "webhook",
        "options": { "interval": 5000 }
      }
    },
    {
      "id": "process-tasks",
      "type": "n8n-nodes-base.splitInBatches",
      "parameters": {
        "batchSize": 1
      }
    },
    {
      "id": "call-cloudecode",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://localhost:5000/cloudecode/execute",
        "method": "POST"
      }
    },
    {
      "id": "callback-api",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "={{ $env.N8N_WEBHOOK_BASE_URL }}/api/n8n/webhook/feedback-complete",
        "method": "POST"
      }
    }
  ]
}
```

### 7.3 已有模板参考

已有 n8n 工作流模板位于：
`d:/myown/gsd-product-builder/n8n/workflows/gsd-product-delivery-template.json`

该模板包含 GSD 产品交付流程的基本框架（scope-definition → task-breakdown → cloudecode-execution → quality-review），可参考其节点结构搭建新的工作流。

---

## 八、Hermes 职责

Hermes 在系统中扮演"任务拆解器"角色，**不是代码执行者**。

### 8.1 需要实现的能力

| 输入 | 输出 |
|------|------|
| 批注意见（"表格加一列操作按钮"） | 1 个或多个 Task |
| Demo HTML 当前内容 | 修改范围描述 |
| moduleKey + elementPath | 定位到具体代码位置 |

### 8.2 示例：意见拆解

**用户意见：** "列表页增加一列操作按钮，包含编辑和删除"

**Hermes 输出：**
```json
[
  {
    "type": "frontend",
    "title": "列表页表格增加操作按钮列",
    "description": "在 list 页面的表格 thead 增加'操作'列，每行末尾增加编辑和删除按钮，带 data-module-key 和 data-element-path 属性",
    "moduleKey": "list",
    "acceptanceCriteria": [
      "表格 thead 有'操作'列",
      "每行末尾有编辑和删除按钮",
      "按钮有 data-module-key='list' 和 data-element-path 属性"
    ]
  }
]
```

### 8.3 API 接口约定

Hermes 需要暴露的端点：

| 方法 | 路径 | 用途 |
|------|------|------|
| `POST` | `/hermes/jobs` | 创建拆解任务，返回 jobId |
| `GET` | `/hermes/jobs/:jobId` | 查询作业状态和结果 |
| `DELETE` | `/hermes/jobs/:jobId` | 取消作业 |

Think-is-power 侧的 HermesClient 已定义好这些方法。

---

## 九、ClaudeCode 职责

ClaudeCode 是"代码执行者"，接收具体任务、读取上下文、修改代码、报告结果。

### 9.1 执行流程

```
1. 接收 Task（通过 HTTP 或 CLI）
2. 读取项目代码（demoHtml 或源码）
3. 调用 DeepSeek API 生成修改后的代码
4. 写回文件/数据库
5. 执行测试（若有）
6. 返回结果（成功/失败、变更文件、测试报告）
```

### 9.2 API 接口约定

ClaudeCode 需要暴露的端点：

| 方法 | 路径 | 用途 |
|------|------|------|
| `POST` | `/cloudecode/execute` | 执行一个 Task，返回执行结果 |
| `GET` | `/cloudecode/tasks/:taskId` | 查询任务执行状态 |

Think-is-power 侧的 CloudecodeClient 已定义好 `executeTask()` 方法。

### 9.3 批量处理意见的策略

当用户提交多条意见时，可选的三种策略：

| 策略 | 方式 | 优缺点 |
|------|------|--------|
| **逐一执行** | 每个 Task 依次执行，每次重新生成完整 HTML | 稳定性好，但慢 |
| **批量合并** | 将多条意见合并为一个 Prompt，一次性生成 | 快，但 AI 可能遗漏部分意见 |
| **增量修改** | 逐个执行，每次在上次结果上修改 | 平衡方案，推荐 |

---

## 十、接入步骤

### 阶段 1：准备（1-2 天）

1. **启动 n8n**
   ```bash
   # 方式一：Docker
   docker run -d --name n8n -p 5678:5678 n8nio/n8n

   # 方式二：本地安装
   npm install -g n8n
   n8n start
   ```

2. **启动 Hermes**
   ```bash
   cd d:/app-factory/hermes-skills
   # 初始化项目（需自行搭建）
   ```

3. **启动 ClaudeCode Service**
   ```bash
   cd d:/app-factory/server
   # 初始化项目（需自行搭建）
   ```

4. **注册 N8nModule 到 AppModule**
   ```typescript
   // apps/api/src/app.module.ts
   import { N8nModule } from './integrations/n8n/n8n.module';
   @Module({ imports: [..., N8nModule] })
   ```

### 阶段 2：核心流程（2-3 天）

1. **实现 TaskModule** — TaskService（CRUD）、TaskController
2. **实现 N8nClient 的真实 HTTP 调用** — 替换 TODO 为 fetch
3. **实现 HermesClient 的真实 HTTP 调用**
4. **实现 CloudecodeClient 的真实 HTTP 调用**
5. **创建 n8n Feedback 工作流**
6. **端到端测试**：提交意见 → 自动修改 → 刷新看到新版

### 阶段 3：增强（可选）

1. 决策日志（DecisionLog）自动记录
2. 错误模式匹配（ErrorPattern + ErrorEvent）
3. 项目复盘（CaseReview）
4. 经验推荐（ExperienceRecommendation）
5. Delivery 导出流水线

---

## 十一、不做 n8n/Hermes/ClaudeCode 的替代方案

如果想跳过这三个组件，直接在系统内部完成闭环，可以做以下改动：

| 需要做的事 | 涉及文件 | 工作量 |
|-----------|---------|--------|
| 添加`POST /api/projects/:id/feedback/:fid/process`端点，调用 DeepSeek 修改 HTML 并更新 | `feedback.controller.ts` + `feedback.service.ts` | ~半天 |
| 在 `FeedbackService.create()` 中直接调用 process（自动模式） | `feedback.service.ts` | ~2 小时 |
| 或改为手动触发（用户在界面上点"处理意见"按钮） | 前端 `demo/page.tsx` | ~半天 |

**方式一（手动处理）** 推荐作为过渡方案，因为它：
1. 验证了整个闭环逻辑（意见→修改→新 Demo）
2. 接口不变，未来 n8n 只需调用同一个处理端点
3. 团队先行验证 AI 修改代码的效果

---

## 十二、文件索引

| 文件 | 内容 |
|------|------|
| `apps/api/src/integrations/n8n/n8n.client.ts` | n8n 客户端（桩代码） |
| `apps/api/src/integrations/n8n/n8n.module.ts` | n8n 模块定义 |
| `apps/api/src/integrations/hermes/hermes.client.ts` | Hermes 客户端（桩代码） |
| `apps/api/src/integrations/cloudecode/cloudecode.client.ts` | ClaudeCode 客户端（桩代码） |
| `apps/api/src/modules/task/task.module.ts` | 任务模块（空壳） |
| `apps/api/src/modules/feedback/feedback.service.ts` | 意见处理服务（已实现 CRUD） |
| `apps/api/prisma/schema.prisma` | Task、FeedbackItem、DecisionLog 等模型 |
| `apps/api/src/app.module.ts` | 主模块，N8nModule 需在此注册 |
| `d:/myown/gsd-product-builder/n8n/workflows/gsd-product-delivery-template.json` | n8n 工作流模板参考 |
| `.env` | 集成相关环境变量 |

---

## 十三、现有客户端方法速查

### N8nClient

```typescript
class N8nClient {
  // 通用触发
  triggerWorkflow(workflowName: string, payload: Record<string, any>)
  // 各阶段专用
  triggerClarifyWorkflow(projectId)
  triggerPlanWorkflow(projectId)
  triggerDemoWorkflow(projectId)
  triggerTaskPlanningWorkflow(projectId)
  triggerFeedbackWorkflow(projectId, feedbackId)
  triggerDeployWorkflow(projectId)
  triggerDeliveryExportWorkflow(projectId, deliveryType)
  triggerCaseReviewWorkflow(projectId)
  triggerExperienceRecommendationWorkflow(projectId, stage)
}
```

### HermesClient

```typescript
class HermesClient {
  createJob(taskId: string, payload: Record<string, any>)  // 创建编排作业
  getJob(jobId: string)                                      // 查询作业状态
  cancelJob(jobId: string)                                   // 取消作业
}
```

### CloudecodeClient

```typescript
class CloudecodeClient {
  executeTask(taskInput: {
    projectId, taskId, jobId, workspacePath,
    taskType, moduleKey, title, description,
    acceptanceCriteria, context?, constraints?
  })  // 执行代码修改任务
}
```
