# Think-is-power

Think-is-power 是一个面向普通人的软件交付平台。它不是只生成 Demo 的工具，而是把软件生产过程设计成一个闭环控制系统：用户提出模糊需求，平台持续澄清意图、生成方案、产出演示、接收反馈、拆解任务、执行修改、验证结果，最终交付可运行、可部署、可下载源码的软件资产。

## 项目结构

- `apps/api` - NestJS 后端，包含 Prisma 数据模型、项目流程、批注反馈闭环和交付编排。
- `apps/web` - Next.js 前端，包含登录、项目看板、项目流程、Demo 预览批注和交付页面。
- `internal/n8n-workflows` - n8n 工作流导出文件，用作平台的流程通道。
- `internal/cloudecode` - 未来 Cloudecode 编程执行运行时的占位服务。
- `docs` - 架构说明与集成文档。

## 闭环控制角色

- Hermes 是控制器和规划大脑，负责把模糊想法转成清晰需求、产品方案、开发任务、验收标准和返工决策。
- n8n 是可靠流程通道，负责接收 webhook 触发，并用可观测、可重试、可审计的工作流推进任务。
- Cloudecode 是执行器，负责修改代码或 Demo 资产、报告执行结果，并把输出交给平台验证。

## 当前 MVP 闭环

当前已经实现的最小闭环如下：

1. 用户提交项目需求。
2. API 澄清需求并生成方案。
3. API 生成 Demo HTML 预览。
4. 用户点击带标记的 Demo 元素并提交批注反馈。
5. Hermes 将反馈拆解成 `Task` 记录。
6. n8n 接收 `task-planning` 触发，并调用平台任务管线。
7. Pipeline 通过 Cloudecode 执行任务，验证 HTML，失败时重试，并在需要时从快照回滚。
8. 反馈被标记为 `resolved`，项目回到 `demo_ready` 状态。

如果 n8n 暂不可用，平台会降级到本地 Pipeline，保证 MVP 闭环仍然可以继续运行。

## 本地启动

先参考 `.env.example` 配置环境变量，并设置 `apps/api/.env`。

```bash
docker compose up -d
cd apps/api && npm install && npm run prisma:generate && npm run build
cd ../web && npm install && npm run build
```

如果 Windows PowerShell 因执行策略拦截 `npm.ps1`，可以使用 `npm.cmd`。

## 常用命令

```bash
cd apps/api && npm.cmd test -- --runInBand
cd apps/api && npm.cmd run build
cd apps/web && npm.cmd run build
```

## n8n 工作流

将 `internal/n8n-workflows` 目录下的 JSON 文件导入 n8n，并在 n8n 中配置环境变量：

```bash
PLATFORM_API_URL=http://host.docker.internal:3001
```

如果 n8n 不是在 Docker 中运行，通常可以改成：

```bash
PLATFORM_API_URL=http://localhost:3001
```

## 下一阶段

下一阶段的工程目标是把内部占位的 Cloudecode 服务替换成真实运行时，让平台能够创建完整源码工程、修改前端/后端/数据库代码、运行测试、生成文档，并打包出可部署的软件资产。
