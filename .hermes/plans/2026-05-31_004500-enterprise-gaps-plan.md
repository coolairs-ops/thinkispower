# 企业级交付能力补齐计划

**日期**: 2026-05-31  
**状态**: 待审批  
**预估工时**: 3-4天

---

## 1. 现状重新评估

上轮评估中我给了"企业级就绪度 3/10"，现在看完 Schema 后纠正——**实际是 6/10**。以下能力已就位：

| 能力 | 实现 |
|------|------|
| 决策审计日志 | `DecisionLog` 表 + `PipelineService.logDecision()` ✅ |
| 错误追踪 | `ErrorEvent` 表 + `ErrorPattern` 匹配 ✅ |
| 版本回滚 | `DemoSnapshot` + `rollbackToPreModification()` ✅ |
| 构建追踪 | `Build` 表（版本号、产物URL、测试报告） ✅ |
| 部署追踪 | `Deployment` 表（状态、provider、时间） ✅ |
| 项目复盘 | `CaseReview` 表 ✅ |
| 经验复用 | `ExperienceRecommendation` 表 ✅ |

**真正缺失的只有 3 项**：

---

## 2. 缺口 1: RBAC 角色权限控制

**现状**: `User` 表有 `plan` 字段（free/pro/enterprise）用于计费，但没有角色（admin/developer/viewer）。

**方案**: 最小化 RBAC——不在 User 表加字段（避免改 Schema），而是用 NestJS Guard 基于现有 `plan` 字段做功能门控。

```typescript
// 新增: common/guards/plan.guard.ts
@Injectable()
export class PlanGuard implements CanActivate {
  // 根据 plan 级别限制端点访问
  // free: 只能创建项目和查看 Demo
  // pro: 可使用自迭代、导出源码
  // enterprise: 全部功能 + API 速率不限
}

// 用法
@UseGuards(JwtAuthGuard, PlanGuard)
@RequiredPlan('pro')
@Post('auto-iterate/start')
```

**改动文件**:
- `common/guards/plan.guard.ts` (新增，30行)
- `delivery.controller.ts`: 自迭代/导出端点加 `@RequiredPlan('pro')`
- `deploy.controller.ts`: 部署端点加 `@RequiredPlan('enterprise')`

**收益**: 免费用户浏览 Demo，付费用户自动交付，企业用户全功能。无需改数据库。

---

## 3. 缺口 2: 用户操作审计

**现状**: `DecisionLog` 记录了内部决策（pipeline 执行），但**不记录用户操作**（谁在何时做了什么）。

**方案**: 在现有 `DecisionLog` 上扩展——增加 `userId` 字段（可空），新增 `stage` 值 `user_action`。

```sql
-- Prisma Schema 微调
model DecisionLog {
  userId         String?  @map("user_id")  // 新增：操作用户
  stage          String   // 新增值: 'user_action'
  actionTaken    String?  // 记录: '用户确认方案' / '启动自迭代' / '下载源码'
}
```

**改动文件**:
- `prisma/schema.prisma`: DecisionLog 加 `userId` 字段
- `common/interceptors/audit.interceptor.ts` (新增，40行): 自动记录 POST/PUT/DELETE 请求
- `app.module.ts`: 注册全局拦截器

**收益**: 每次用户操作自动写入审计日志，可追溯"谁在 2026-05-31 14:23 启动了项目 xxx 的自迭代"。

---

## 4. 缺口 3: CI/CD Webhook + 速率限制

### 4.1 CI/CD Webhook

**现状**: 全栈代码生成后手动触发部署。

**方案**: 新增 GitHub/GitLab webhook 端点，接收 push 事件后自动执行交付流水线。

```typescript
// 新增: modules/webhook/webhook.controller.ts
@Public()
@Post('webhook/github')
async githubPush(@Body() payload, @Headers('X-Hub-Signature-256') sig) {
  // 验证签名 → 解析 push event → 触发 PipelineService
}
```

**改动文件**:
- `modules/webhook/webhook.controller.ts` (新增，60行)
- `modules/webhook/webhook.module.ts` (新增)
- `app.module.ts`: 注册 WebhookModule

### 4.2 速率限制

**现状**: 无任何请求频率控制。

**方案**: 用 NestJS 官方 `@nestjs/throttler`。

```bash
npm install @nestjs/throttler
```

```typescript
// app.module.ts
ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }])  // 每分钟 30 次
```

**改动文件**:
- `package.json`: 加 `@nestjs/throttler`
- `app.module.ts`: 注册 ThrottlerModule

**收益**: 防滥用，企业版可提限。

---

## 5. 监控（已有传感器系统，补齐告警）

**现状**: `SensorService.runAll()` 已有完整的 L1/L2/L3 健康检查，但只是被动查询。

**方案**: 利用现有 cron 能力（Hermes 自带 cronjob），每 30 分钟自动执行 `SensorService.runAll()`，score < 60 时通过通知渠道告警。同时用 L2RuntimeSensor 的 `shouldStopIteration` 信号做主动熔断。

```typescript
// 新增: 健康检查定时任务
// cron: 0 */30 * * * *
// curl /api/sensors/health | if score < 60 → 通知
```

**改动**: 无需改代码，一个 cronjob 配置即可。

---

## 6. 实施优先级

| 优先级 | 项目 | 工时 | 依赖 |
|--------|------|------|------|
| P0 | RBAC PlanGuard | 0.5天 | 无 |
| P0 | 速率限制 | 0.5天 | npm install |
| P1 | 用户操作审计 | 1天 | Schema 微调 |
| P1 | CI/CD Webhook | 1天 | PipelineService 已就位 |
| P2 | 监控告警 cron | 0.5天 | SensorService 已就位 |

---

## 7. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `prisma/schema.prisma` | DecisionLog 加 userId |
| `common/guards/plan.guard.ts` | 新增 RBAC Guard |
| `common/decorators/required-plan.decorator.ts` | 新增装饰器 |
| `common/interceptors/audit.interceptor.ts` | 新增审计拦截器 |
| `modules/webhook/webhook.controller.ts` | 新增 CI/CD webhook |
| `modules/webhook/webhook.module.ts` | 新增模块 |
| `app.module.ts` | 注册 ThrottlerModule + WebhookModule + 审计拦截器 |
| `delivery.controller.ts` | 端点加 @RequiredPlan |
| `deploy.controller.ts` | 端点加 @RequiredPlan |
| `package.json` | 加 @nestjs/throttler |

---

## 8. 验证

1. **RBAC**: free 用户调用 `POST auto-iterate/start` → 403 "请升级套餐"
2. **审计**: 任意操作后查询 `decision_logs WHERE stage='user_action'` 有记录
3. **速率限制**: 1分钟内调用 31 次 → 429 Too Many Requests
4. **Webhook**: `curl -X POST /webhook/github` → 触发流水线
5. **监控**: `curl /api/sensors/health` → score < 60 时 cron 自动告警
