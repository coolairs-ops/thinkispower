# Phase A: 分步代码生成 — 执行计划

> 2026-06-01 | 目标: 从单次 LLM 调用 → 多步工程化生成

---

## 目标

将 `deliverFullstack` 从"一次 DeepSeek 调用生成 7 个文件"改为 **4 步串行生成**，每步独立 prompt + 上下文累加。

**验证标准**: 生成的代码 `npm install && tsc --noEmit` 无报错。

---

## 一、当前状态

```
delivery-evaluation.service.ts :: runProductionDelivery()
  └── cloudecodeClient.deliverFullstack()  ← 单次调用
        └── DeepSeek chat({ maxTokens: 16384, timeoutMs: 180_000 })
              └── 一次生成: schema.sql + index.ts + routes + package.json + index.html + docker-compose.yml + README.md
```

**问题**:
- 单次 prompt 要求生成 7 个完全不相关的文件，质量天花板低
- 无编译验证，生成即交付
- DeepSeek 经常超时返回 0 文件
- 企业模板是事后注入的，不是生成时考虑的

---

## 二、目标架构

```
delivery-evaluation.service.ts :: runProductionDelivery()
  │
  ├── Step 1: DB Schema (DeepSeek)
  │     prompt: "根据数据模型生成 PostgreSQL schema.sql"
  │     output: database/schema.sql
  │
  ├── Step 2: Backend API (DeepSeek + schema context)
  │     prompt: "根据 schema + 功能列表生成 NestJS API"
  │     context: schema.sql 内容
  │     output: backend/src/*.ts, backend/package.json
  │
  ├── Step 3: Frontend (DeepSeek + schema + API context)
  │     prompt: "根据 API 端点 + Demo HTML 生成 Next.js 前端"
  │     context: API 路由列表
  │     output: frontend/src/*.tsx, frontend/package.json
  │
  └── Step 4: Integration (DeepSeek + all context)
        prompt: "根据所有产物生成 Docker/nginx/README"
        output: Dockerfile, docker-compose.yml, nginx.conf, README.md
```

每步失败 → 重试(最多 3 次) → 3 次全败 → 降级到旧路径(单次调用)。

---

## 三、改动范围

### 3.1 核心改动

| 文件 | 改动内容 | 风险 |
|------|---------|------|
| `delivery-evaluation.service.ts` | 新增 `stepwiseGenerate()` 方法，替代 `deliverFullstack` 调用 | 🔴 高 — 核心交付路径重构 |
| `cloudecode.client.ts` | 新增 `generateSchema()`, `generateBackend()`, `generateFrontend()`, `generateIntegration()` 四个方法 | 🟡 中 |
| `deepseek.service.ts` | 增加 `context` 参数支持，传递上一步生成的代码作为上下文 | 🟢 低 |

### 3.2 不影响的模块

- `delivery.controller.ts` — 接口不变
- `delivery/page.tsx` — 前端不变
- `sensor/*` — 传感器不变
- `specification/*`, `demo/*`, `plan/*` — 全部不变

### 3.3 新增文件

无新增文件。所有改动在现有文件中。

---

## 四、步骤详细设计

### Step 1: DB Schema 生成

```typescript
async generateSchema(projectId: string, payload: DeliveryPayload): Promise<{ path: string; content: string }> {
  const prompt = `为项目"${payload.projectName}"生成 PostgreSQL schema.sql。

数据模型: ${JSON.stringify(payload.structuredRequirement?.dataModels || [])}
功能列表: ${JSON.stringify(payload.planSummary?.features || [])}

要求:
- 使用 PostgreSQL 16 语法
- 包含主键 UUID, created_at, updated_at
- 外键关系用 REFERENCES
- 输出纯 SQL, 用 \`\`\`sql 包裹`;

  const response = await this.deepseek.chat([{ role: 'user', content: prompt }], {
    temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000,
  });
  // 提取 SQL
  const match = response.match(/```sql\s*([\s\S]*?)```/);
  return { path: 'database/schema.sql', content: match?.[1]?.trim() || response };
}
```

### Step 2: Backend API 生成

```typescript
async generateBackend(payload: DeliveryPayload, schemaSql: string): Promise<Array<{ path: string; content: string }>> {
  const prompt = `为项目"${payload.projectName}"生成 NestJS + Prisma 后端代码。

数据库 Schema:
\`\`\`sql
${schemaSql}
\`\`\`

功能列表: ${JSON.stringify(payload.planSummary?.features || [])}
页面: ${JSON.stringify(payload.planSummary?.pages || [])}
角色: ${JSON.stringify(payload.planSummary?.roles || [])}

必须输出以下文件（每个文件用 \`\`\`文件路径 标记）:
1. backend/prisma/schema.prisma — 从 SQL 转换的 Prisma schema
2. backend/src/app.module.ts — NestJS 模块入口
3. backend/src/main.ts — 启动文件(含 Swagger)
4. backend/src/modules/ — 每个功能一个模块(controller + service)
5. backend/package.json — 依赖
6. backend/tsconfig.json

每个文件完整可运行，无占位符。`;

  const response = await this.deepseek.chat([{ role: 'user', content: prompt }], {
    temperature: 0.3, maxTokens: 16384, timeoutMs: 120_000,
  });
  return this.parseFiles(response);
}
```

### Step 3: Frontend 生成

```typescript
async generateFrontend(payload: DeliveryPayload, backendRoutes: string[]): Promise<Array<{ path: string; content: string }>> {
  const prompt = `为项目"${payload.projectName}"生成 Next.js 14 前端代码。

API 端点:
${backendRoutes.join('\n')}

Demo HTML 结构:
${(payload.demoHtml || '').substring(0, 3000)}

页面: ${JSON.stringify(payload.planSummary?.pages || [])}

必须输出:
1. frontend/src/app/page.tsx — 首页
2. frontend/src/app/layout.tsx — 布局
3. frontend/src/app/ — 每个页面对应路由
4. frontend/package.json
5. frontend/tsconfig.json

每个文件完整可运行。`;

  const response = await this.deepseek.chat([{ role: 'user', content: prompt }], {
    temperature: 0.3, maxTokens: 16384, timeoutMs: 120_000,
  });
  return this.parseFiles(response);
}
```

### Step 4: Integration 生成

```typescript
async generateIntegration(payload: DeliveryPayload, allFiles: Array<{ path: string }>): Promise<Array<{ path: string; content: string }>> {
  const prompt = `为项目"${payload.projectName}"生成部署配置。

已生成的文件:
${allFiles.map(f => f.path).join('\n')}

必须输出:
1. Dockerfile — 多阶段构建(Node.js)
2. docker-compose.yml — 前端 + 后端 + 数据库
3. nginx.conf — 反向代理配置
4. .gitignore
5. README.md — 项目说明(含启动步骤)`;

  const response = await this.deepseek.chat([{ role: 'user', content: prompt }], {
    temperature: 0.3, maxTokens: 8192, timeoutMs: 90_000,
  });
  return this.parseFiles(response);
}
```

---

## 五、重试与降级策略

```
stepwiseGenerate():
  files = []
  for step in [Schema, Backend, Frontend, Integration]:
    for attempt in 1..3:
      result = step.generate()
      if result.valid: files += result.files; break
    if attempt == 3 and not valid:
      // 该步失败 → 全部降级
      return fallbackToSingleCall()
  
  // 全部成功
  return files

fallbackToSingleCall():
  // 降级到原来的 deliverFullstack 单次调用
  return cloudecodeClient.deliverFullstack()
```

---

## 六、验证方案

### 6.1 单元测试

```typescript
// delivery-evaluation.service.spec.ts
describe('stepwiseGenerate', () => {
  it('应生成至少 15 个文件', async () => { /* ... */ });
  it('应包含 schema.sql 且语法正确', async () => { /* ... */ });
  it('应包含 package.json 且依赖正确', async () => { /* ... */ });
  it('应包含 Dockerfile', async () => { /* ... */ });
  it('某步失败 3 次应降级到单次调用', async () => { /* ... */ });
});
```

### 6.2 集成测试

1. 创建新项目 → 完成访谈 → 生成方案 → Demo → 交付
2. 检查交付产物文件数量 >= 15
3. 检查 `database/schema.sql` 含 CREATE TABLE
4. 检查 `backend/package.json` 含 nestjs 依赖
5. 检查 `frontend/package.json` 含 next 依赖
6. 检查 `Dockerfile` 含多阶段构建

### 6.3 回归测试

- 现有交付功能不受影响（降级路径保留）
- CC Bridge 主路径正常工作
- 企业模板注入照常执行

---

## 七、工作量估算

| 任务 | 预估 |
|------|------|
| 4 个生成方法 | 2h |
| stepwiseGenerate 编排逻辑 | 1h |
| 重试 + 降级逻辑 | 1h |
| 单元测试 | 1h |
| 集成测试 + 调试 | 2h |
| **合计** | **~7h (1 天)** |

---

## 八、效果评估

| 指标 | 当前 | Phase A 后 |
|------|------|-----------|
| 交付文件数 | 4-7 个(含模板) | 15-20 个 |
| 生成方式 | 单次 LLM 调用 | 4 步串行 + 上下文累加 |
| 每步 prompt 相关性 | 混杂(所有文件一起) | 专注(每步只生成一类文件) |
| 失败处理 | 0 文件 → build_failed | 3 次重试 → 降级 |
| 完整度提升 | 68.5% | ~72% |

**关键改进**: 从"让 AI 一次猜 7 种文件"变为"让 AI 专注做一件事，做完交给下一步"，每步质量可控。
