# P2-P6 技术债务影响面评估

**日期**: 2026-06-02
**状态**: 评估，待审批

---

## P2 核心服务零集成测试

### 影响面
`delivery-evaluation.service.ts` 的编译修复闭环、功能覆盖率、冒烟测试三项能力**只在单元测试层面验证了逻辑**，未在真实全链路中跑过。

### 风险
- 编译修复：`execSync('npx tsc')` 在 Docker Alpine 容器内可能无 `npx`
- 功能覆盖率：中文关键词提取依赖 `extractKeywords`，对英文功能描述覆盖率低
- 冒烟测试：生成的 `smoke.test.js` 引用 Node 内置 `http` 模块，但生成的后端可能是 Express/NestJS/Koa

### 改进后效果
- 端到端验证交付流水线 → 发现环境差异问题 → 修复后真实可用
- **完整性 +5%**，从"代码写到"到"功能验证过"

### 工作量
~2h，需 Docker 环境可用

---

## P3 Prisma 迁移管理

### 影响面
当前无 `prisma/migrations/` 目录，Schema 变更零追溯。

### 风险
- 新环境部署需手动 `db push`（非幂等）
- 无法回滚
- 19个模型的变更历史全黑盒

### 改进后效果
- `prisma migrate dev` 生成可追溯的 SQL 迁移文件
- CI/CD 可自动 `prisma migrate deploy`
- **运维安全 +10%**，可回滚可审计

### 工作量
~1h，执行一次 `prisma migrate dev --name init` 生成基线迁移

---

## P4 API 文档 (Swagger)

### 影响面
25 个控制器，零 API 文档。外部调用全靠猜。

### 风险
- 交付给客户的代码无接口说明
- 前端开发需查源码找端点
- CC Bridge/Cloudecode 调用方无契约

### 改进后效果
- `http://localhost:3001/api/docs` 可交互 Swagger UI
- 每个端点含参数/返回值/认证要求
- **对外交付 +15%**，从"能跑"到"有文档"

### 工作量
~2h，安装 `@nestjs/swagger` + 为25个控制器加装饰器

---

## P5 认证安全加固

### 影响面
当前 JWT 无过期刷新、无角色权限控制。

### 风险
- JWT 泄露后永久有效
- `admin@123.com` 和普通用户同权
- 无 rate limiting 精细化控制

### 改进后效果
- JWT access(15min) + refresh(7d) 双 token
- RBAC: admin / developer / viewer 三级
- **安全合规 +20%**，满足企业级最低安全标准

### 工作量
~3h，新增 refresh token 逻辑 + 角色装饰器 + `@Roles()` guard

---

## P6 前端 SSR 优化

### 影响面
12 个页面全部 `'use client'`，首屏白屏 2-4s。

### 风险
- PM 用户首次访问体验差
- SEO 完全失效（搜索引擎看不到内容）
- Lighthouse 评分 < 50

### 改进后效果
- Dashboard/项目列表首屏 SSR
- 首屏时间 2s → 0.5s
- **用户体验 +25%**，直接影响 PM 留存

### 工作量
~4h，改造 Dashboard + 项目页为 Server Component，其余页面懒加载

---

## 优先级排序

```
                   影响面    工作量    性价比
P5 安全加固       ★★★★★    3h       极高 ← 企业交付刚需
P4 Swagger        ★★★★☆    2h       高   ← 对外交付必备
P6 SSR优化        ★★★★☆    4h       中   ← 体验提升
P3 Prisma迁移     ★★★☆☆    1h       中   ← 运维规范
P2 集成测试       ★★★☆☆    2h       低   ← 需要Docker
```

**建议顺序: P5 → P4 → P6 → P3 → P2**
