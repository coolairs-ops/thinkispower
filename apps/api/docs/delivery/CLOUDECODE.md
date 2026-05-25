# Cloudecode 交付集成

## 接口

在 `src/integrations/interfaces/code-generator.interface.ts` 定义：

```typescript
// 代码生成器 — 用于 source / deployment 导出
interface ICodeGenerator {
  generateSource(input: CodeGenInput): Promise<CodeGenResult>;
}

interface IDeploymentConfigGenerator {
  generateConfig(input: CodeGenInput): Promise<CodeGenResult>;
}
```

## 输入格式 (CodeGenInput)

```json
{
  "projectId": "uuid",
  "planSummary": {
    "summary": "项目简介",
    "pages": ["看板", "客户列表", ...],
    "features": ["用户管理", "订单管理", ...],
    "roles": ["管理员", "普通用户"],
    "dataObjects": ["用户", "订单"],
    "estimatedDays": 14,
    "estimatedPriceRange": "¥8,000-¥15,000"
  },
  "demoHtml": "<!DOCTYPE html>...",
  "moduleMap": {
    "dashboard": { "name": "看板", "features": ["统计"] },
    "customer-list": { "name": "客户列表", "features": ["增删改查"] }
  }
}
```

## 输出格式 (CodeGenResult)

```json
{
  "success": true,
  "sourceZipUrl": "https://storage.example.com/builds/xxx/source.zip",
  "fileCount": 42,
  "language": "typescript",
  "framework": "nextjs",
  "error": null
}
```

## 实现指引

### 步骤

1. **实现接口** — 在 `cloudecode.client.ts` 中实现 `ICodeGenerator`
2. **注册到 DeliveryOrchestrator** — 在 `delivery-orchestrator.service.ts` 中注入，替换 `handleCodeGeneration()` 里的 TODO
3. **生成源码** — 根据 `planSummary` 和 `demoHtml` 生成完整项目代码：
   - pages → 页面组件
   - features → API 路由 + 前端功能
   - roles → 权限中间件
   - dataObjects → 数据模型 / Prisma schema
4. **打包** — 将生成的文件压缩为 zip
5. **上传** — zip 上传到存储服务（阿里云OSS / S3 / 本地文件系统）
6. **更新 Build** — 返回的 URL 由 `DeliveryOrchestrator` 写入 `Build.sourceZipUrl`

### 位置

- 接口: `src/integrations/interfaces/code-generator.interface.ts`
- 实现位置: `src/integrations/cloudecode/cloudecode.client.ts`
- 注册位置: `src/services/delivery-orchestrator.service.ts`（`handleCodeGeneration()` 方法）

### 参考

- 现有 `CloudecodeClient.executeTask()` — 参考其 DeepSeek 调用模式
- `DeepseekService` — 复用现有 AI 调用服务
