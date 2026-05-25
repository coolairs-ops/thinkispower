# OpenClaw 交付集成

## 用途

将复杂的交付导出任务（如 project-package）分解为多个子任务。

## 当前状态

`DeliveryOrchestrator.handlePackageExport()` 中有一个 TODO 存根。

## 任务类型（Prisma Task.type 已定义）

```
export_source | export_package | export_repository | export_database_schema | export_deployment_config
```

这些类型已存在于 schema 中，但 `PipelineService` 还没有处理它们的路由。

## 实现指引

### 步骤

1. **添加分解方法** — 在 `openclaw.client.ts` 中添加 `handleDeliveryExport()` 方法：

```typescript
async handleDeliveryExport(projectId: string, exportType: string): Promise<string[]> {
  // 1. 加载项目数据（planSummary, demoHtml）
  // 2. 调用 DeepSeek 分解导出任务
  // 3. 创建 Task 记录，type = export_*
  // 4. 发出 TASKS_CREATED 事件
}
```

2. **扩展 PipelineService** — 在 `pipeline.service.ts` 中添加对 `export_*` 任务类型的处理：

```typescript
// 当前 executeTask 硬编码调用 cloudecode.executeTask()
// 需要判断 task.type:
// - frontend → cloudecode.executeTask() (现有逻辑)
// - export_* → cloudecode.executeExportTask()
```

3. **在 DeliveryOrchestrator 中注册** — 调用 `handleDeliveryExport()` 替代 TODO：

```typescript
const taskIds = await this.openclaw.handleDeliveryExport(projectId, 'package');
this.eventEmitter.emit(EVENTS.TASKS_CREATED, { projectId, feedbackId: null, taskIds });
```

### 参考

- 现有 `OpenClawClient.handleFeedback()` — 参考其 DeepSeek 调用 + JSON 解析模式
- `openclaw.client.ts` 中的任务分解 prompt — 参考其格式，替换任务类型为 `export_*`
- PipelineService — 需要添加任务类型路由
