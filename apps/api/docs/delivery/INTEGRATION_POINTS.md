# 交付架构总览

## 系统架构

```
前端交付页面 → DeliveryController → DeliveryService
                                         │
                                    ┌─────┴─────┐
                                    │  BuildService │ (Build 表 CRUD)
                                    └─────┬─────┘
                                          │ 发出 DELIVERY_EXPORT_REQUESTED 事件
                                          ▼
                               DeliveryOrchestrator (事件监听)
                                    │
                      ┌─────────────┼─────────────┐
                      ▼              ▼             ▼
               Cloudecode       Hermes        N8N
               (源码/部署)       (打包拆任务)    (仓库/数据库)
```

## 事件流

| 事件 | 触发时机 | 监听者 | 说明 |
|------|---------|--------|------|
| `delivery.export.requested` | 用户点击导出 | DeliveryOrchestrator | 开始处理导出 |
| `delivery.export.completed` | 导出成功 | — | Build 更新完毕 |
| `delivery.export.failed` | 导出失败 | — | Build 标记 failed |
| `build.created` | Build 记录创建 | — | 暂未使用 |

## Build 模型字段映射

每个导出类型对应 Build 表的不同 URL 字段：

| 导出类型 | 前端按钮 | Build 字段 |
|---------|---------|-----------|
| `source` | 下载源码 | `sourceZipUrl` |
| `package` | 导出项目包 | `packageZipUrl` |
| `repository` | 交付到代码仓库 | `repositoryUrl` |
| `database` | 导出数据库结构 | `databaseSchemaUrl` |
| `deployment` | 导出部署配置 | `deploymentConfigUrl` |

## 集成点一览

见各份独立文档：

- [CLOUDECODE.md](./CLOUDECODE.md) — 代码生成集成
- [HERMES.md](./HERMES.md) — 任务分解集成
- [N8N.md](./N8N.md) — 工作流集成

## 开发指引

1. **实现一个集成点**：阅读对应接口文档 → 实现接口 → 注入到 `DeliveryOrchestrator`
2. **新增导出类型**：在 `event-types.ts` 的 `ExportType` 类型中添加 → `build.service.ts` 的字段映射表添加 → `DeliveryOrchestrator` 路由添加 → 控制器添加端点
3. **测试导出**：`POST /api/projects/:id/delivery/request-{type}` → 查 Build 表记录 → 查项目状态变化
