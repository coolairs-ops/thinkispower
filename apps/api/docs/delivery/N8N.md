# N8N 交付集成

## 接口

`N8nClient` 已有 `triggerDeliveryExportWorkflow()` 方法：

```typescript
async triggerDeliveryExportWorkflow(
  projectId: string,
  deliveryType: string,
  extraPayload?: Record<string, any>,
): Promise<{ success: boolean; runId?: string }>
```

## 工作流触发器

| 导出类型 | 工作流 | 触发方法 |
|---------|--------|---------|
| `repository` | Git Push | `triggerDeliveryExportWorkflow(projectId, 'repository')` |
| `database` | 数据库 Schema 导出 | `triggerDeliveryExportWorkflow(projectId, 'database')` |
| `package` | 构建打包 | `triggerDeliveryExportWorkflow(projectId, 'package')` |

## Payload 格式

```json
{
  "projectId": "uuid",
  "exportType": "repository",
  "buildId": "uuid",
  "planSummary": { ... },
  "demoHtml": "..."
}
```

## 实现指引

### 步骤

1. **搭建 N8N** — 部署 N8N 服务，创建对应工作流
2. **配置 URL** — 在 `.env` 中设置：
   ```
   N8N_URL=http://192.168.124.126:15678
   ```
3. **取消注释 fetch** — 在 `n8n.client.ts` 的 `triggerWorkflow()` 方法中，取消注释第 21-25 行的 `fetch()` 调用
4. **注册到 DeliveryOrchestrator** — 注入 `N8nClient`，在 `handleN8nWorkflow()` 中调用对应的 trigger 方法
5. **回调更新** — 工作流完成后回调 `POST /api/webhooks/delivery-complete` 来更新 Build 记录（需要实现该端点，或让 N8N 直接调用 `POST /api/projects/:id/delivery/build/:buildId/status`）

### 现有代码位置

- Client: `src/integrations/n8n/n8n.client.ts`
- Module: `src/integrations/n8n/n8n.module.ts`
- 注意：`N8nModule` 需要在 `AppModule` 中导入才能使用

### 工作流模板参考

`d:/myown/gsd-product-builder/n8n/workflows/gsd-product-delivery-template.json` 包含一个 12 步的交付工作流模板（需求澄清 → 方案 → 原型 → 架构 → 任务 → 测试 → 部署 → 交付包）。
