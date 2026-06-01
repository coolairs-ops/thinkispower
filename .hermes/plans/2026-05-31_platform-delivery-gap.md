# Think-is-power 平台标准化交付 — 待补充工作清单

> 2026-05-31 | 从"Demo生成器"到"PM自助交付平台"

---

## 当前状态 vs 目标

```
当前:
  描述文本 → Plan → Demo → 自迭代 → 基础全栈代码(7类文件)
  人工: 90% (需要工程师读代码、加固安全、配部署)

目标:
  PRD + 数据字典 + 状态机 + Demo + 部署选择 → 标准化全栈代码(20+文件) + 成本报价
  人工: 15%（只做AI覆盖不了的索引优化、复杂校验）
```

## 待补充工作（按优先级）

---

### P0 — 交付产物升级（本周可做）

当前 `deliverFullstack` 生成 7 类文件，缺少生产必需的模板注入。

**1. 安全模块自动注入** (3个子项)

| 子项 | 注入方式 | 文件 |
|------|---------|------|
| Helmet + CORS + Rate Limit | 后端模板内置 | `apps/api/src/services/templates/security.middleware.ts` |
| class-validator DTO | 根据 schema 自动生成校验 | prompt 追加指令 |
| JWT 认证骨架 | 模板注入 | 同上 |

**2. 可观测性注入** (3个子项)

| 子项 | 注入方式 | 文件 |
|------|---------|------|
| /health 端点 | 模板注入 | `apps/api/src/services/templates/health.controller.ts` |
| JSON 结构化日志 | NestJS Logger 配置 | prompt 追加 "所有日志必须JSON格式，含trace_id" |
| 优雅关闭 | NestJS enableShutdownHooks | `main.ts` 模板 |

**3. Docker 产物升级** (2个子项)

| 子项 | 注入方式 | 文件 |
|------|---------|------|
| 多阶段 Dockerfile（build → production） | 模板注入 | `apps/api/src/services/templates/Dockerfile.prod` |
| nginx.conf（前端静态文件 + API 代理） | 模板注入 | `apps/api/src/services/templates/nginx.conf` |

**实现方式**：不调用 DeepSeek 生成这些文件，直接模板注入。在 `runProductionDelivery` 的末尾追加一个 `injectEnterprisePack(injectedFiles)` 步骤。

---

### P1 — PM 输入结构化（本周-下周）

**4. 数据字典表单** (新增页面)

当前 PM 只有一个文本框写描述。需要：
- 数据对象列表（名称、字段、类型、必填、关联）
- 自动生成 Prisma schema
- 前端表单：`apps/web/src/app/projects/[id]/data-dictionary/page.tsx`

**5. 角色权限矩阵** (新增表单)
- 角色列表 + 每个角色对每个资源的 CRUD 权限
- 自动生成 NestJS Guard + Prisma 中间层
- 前端表单：`apps/web/src/app/projects/[id]/roles/page.tsx`

**6. 业务规则编辑器** (新增表单)
- 自然语言规则 + 触发条件（如"订单创建后发送邮件"→ 自动映射到 hook）
- 规则模板：`apps/api/src/services/templates/business-rules.guard.ts`

---

### P2 — 部署选项 + 成本评估（下周）

**7. 部署类型选择** (前端单选组件)
- "单机部署（适合内部工具）" / "集群部署（适合对外服务）"
- 选择后自动切换 Docker Compose ↔ K8s 配置
- 注入对应的连接池、缓存、日志策略

**8. 自动化评估 + 报价** (新增模块)
- 扫描交付产物 → 识别 AI 覆盖度
- 列出"需人工"清单（索引、校验、特殊逻辑）
- 按工时计价输出报价单

```
评估模块：apps/api/src/services/delivery-assessment.service.ts
  输入：项目ID → 扫描 demoHtml + planSummary + 生成的代码
  输出：
    - AI 覆盖率: 85%
    - 需人工: 索引优化(0.5h) + 复杂校验(1h) + 上线验证(0.5h)
    - 报价: ¥600
```

**9. 人工交付工作流** (新增模块)
- PM 确认报价 → 创建工单 → 分配工程师
- 工程师标记完成 → PM 确认验收
- 工单模块：`apps/api/src/modules/work-order/`

---

### P3 — 质量门禁升级（两周）

**10. 交付前自动检查清单**

当前只有 4 项 HTML 检查。升级为：

```
静态层:  Lint + Semgrep安全扫描 + 硬编码密钥检测
功能层:  API端点是否覆盖所有feature
安全层:  Helmet/CORS/RateLimit/InputValidation 是否注入
运维层:  /health端点存在 + JSON日志 + 优雅关闭
部署层:  Dockerfile多阶段 + nginx配置 + env模板
```

**11. 契约测试骨架**
- 自动从 data-dictionary 生成 PBT 测试
- 从 API 端点生成 basic 集成测试

---

### P4 — 长期（一月+）

**12. 交付质量知识库**
- 收集每次人工修复 → 学习 → 下次自动处理
- 典型场景：索引模式、常见校验逻辑、部署配置

---

## 改动文件汇总

| 优先级 | 改动 | 文件数 | 预估工时 |
|--------|------|--------|---------|
| P0 | 安全/监控/Docker 模板注入 | 4新建 + 1改 | 2h |
| P1 | 数据字典+权限+业务规则表单 | 3新建 + 2改 | 4h |
| P2 | 部署选择+评估报价+工单 | 4新建 + 1改 | 4h |
| P3 | 质量门禁升级 | 2改 | 2h |
| | **合计** | | **12h** |

---

## 实施建议

**本周**：P0 模板注入。改动最小（不改核心逻辑），效果最大（交付产物立刻从"能用"升级为"接近生产"）。

**下周**：P1 PM 表单 + P2 评估报价。这两个是"产品化"的关键，让 PM 感觉这是个产品而不是工具。

**P0 执行顺序**：
1. 写 5 个模板文件（security.middleware.ts, health.controller.ts, Dockerfile.prod, nginx.conf, main.ts 补丁）
2. 在 `delivery.service.ts` 加 `injectEnterprisePack()` 方法
3. 在 `runProductionDelivery` 末尾调用
4. 验证：重新跑一次闭环 → 检查交付产物是否包含所有注入文件
