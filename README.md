# 思想动力 (Think-is-power)

**让你的每个想法都不被辜负。**

面向普通人的 AI 驱动软件生成与交付平台。不是只生成 Demo 的工具，而是把软件生产设计为闭环控制系统：用户提出模糊需求，平台持续澄清意图、生成方案、产出演示、接收反馈、拆解任务、执行修改、验证结果，最终交付可运行、可部署、可下载源码的软件资产。

---

## 当前状态（2026-06）

```
注册 → 创建项目 → 需求聊天澄清 → PRD 确认 → 方案生成 → Demo 预览
                                                         ↓
                                             ┌───────────────────┐
                                             │ 批注反馈 → AI 拆解 │
                                             │ → 自动修改 → 刷新  │
                                             └───────────────────┘
                                                         ↓
                                             ┌───────────────────┐
                                             │ 自迭代评估(L1/L2/L3)│
                                             │ → AI 修复 → 评分≥90│
                                             └───────────────────┘
                                                         ↓
                                             ┌───────────────────┐
                                             │ 终稿交付 → 源码导出 │
                                             │ → 包导出 → 部署上线 │
                                             └───────────────────┘
```

### 已实现的核心能力

| 阶段 | 状态 | 说明 |
|------|------|------|
| 需求澄清 | ✅ | Discovery 对话引擎，7 维度完备度评估，结构化 PRD |
| 方案生成 | ✅ | 页面清单、功能、角色、数据对象等 |
| 设计建议 | ✅ | AI 风格、布局、组件建议 |
| Demo 生成 | ✅ | DeepSeek 直调生成 SPA HTML，Cloudecode 引擎 |
| 批注反馈闭环 | ✅ | 点选元素 → 意见 → AI 拆任务 → Pipeline 执行 → Demo 更新 |
| 版本快照 | ✅ | 每次修改前自动快照，支持回滚 |
| 自迭代评估 | ✅ | L1静态/L2运行时/L3语义 三级传感器加权评分，AI 自动修复 |
| 终稿交付 | ✅ | 全栈代码生成、企业模板注入、包导出、部署配置 |
| 案例复盘 | ✅ | AI 复盘报告 |
| 经验推荐 | ✅ | 跨项目可复用经验沉淀 |

---

## 项目结构

```
apps/
├── api/          # NestJS 后端 (port 3001) — 16 模块, 30+ 服务
└── web/          # Next.js 前端 (port 3003) — 9 页面, 4 组件
internal/
├── cloudecode/     # AI 代码执行引擎 (Express, port 5000)
├── cc-bridge/      # Claude Code 桥接服务 (Express, port 5001)
│   ├── src/
│   │   ├── index.ts              # HTTP 路由 + SSE 进度推送
│   │   ├── delivery-pipeline.ts  # 全栈交付流水线
│   │   ├── executor.ts           # 任务执行器 + 重试/降级
│   │   └── queue.ts              # 并发任务队列
│   └── Dockerfile
└── templates/     # 企业级部署模板
docs/             # 架构图 + 集成文档
```

---

## 架构：工程控制论模型

```
用户 ──→ [控制器: Hermes/DeepSeek] ──→ [被控对象: Project]
                      ↑                        │
                      │                        ▼
               [反馈信道: EventEmitter] ←── [执行器: Pipeline/Cloudecode/CC Bridge]
                      │                        │
                      └────────────────────────┘
                                      ↑
                            [传感器: L1静态/L2运行时/L3语义]
```

| 角色 | 组件 | 职责 |
|------|------|------|
| **控制器** | HermesClient / ProductDiscovery | 澄清需求、生成方案、拆解任务 |
| **执行器** | PipelineService / CloudecodeClient / CC Bridge | 执行代码修改、全栈交付导出 |
| **传感器** | L1/L2/L3 Sensor + SensorFusion + CrossValidator | 全方位质量评估 |
| **反馈信道** | EventEmitter + SSE | 事件驱动闭环 |

---

## 服务架构

| 服务 | 端口 | 运行方式 | 说明 |
|------|------|----------|------|
| 前端 (Next.js 14) | 3003 | 本地 `npm run dev` | React 18, Tailwind CSS |
| API (NestJS 11) | 3001 | Docker | Prisma ORM, 17 数据模型 |
| Cloudecode | 5000 | Docker | DeepSeek 驱动代码生成引擎 |
| CC Bridge | 5001 | Docker | 交付流水线 + SSE 进度推送 |
| PostgreSQL 16 | 5433 | Docker | 主数据库 (17 表) |
| Redis 7 | 内部 | Docker | 缓存/队列 |
| MinIO | 9000/9001 | Docker | 对象存储 (构建产物、截图) |

---

## 依赖的外部服务

| 服务 | 用途 | 状态 |
|------|------|------|
| **DeepSeek API** | 所有 AI 能力（对话、生成、分析、修复） | 核心依赖 |
| **PostgreSQL 16** | 主数据库（17 个模型） | docker compose |
| **Redis 7** | 缓存/队列 | docker compose |
| **MinIO** | 对象存储（构建产物、截图） | docker compose |
| **Qwen API** | 交叉验证（仅传感器系统使用） | 辅助 |

---

## 本地启动

```bash
# 1. 配置环境变量
cp .env.example apps/api/.env
# 编辑 apps/api/.env 填入 DEEPSEEK_API_KEY 等

# 2. 启动基础设施 + 核心服务
docker compose up -d

# 3. 启动前端（从 Linux 原生路径，非 /mnt/d/）
cd /home/coola/think-is-power-web
echo 'NEXT_PUBLIC_API_URL=http://localhost:3002' > .env.local
npm run dev

# 4. CC Bridge 也可以本地启动 (如不容器化)
cd internal/cc-bridge && npm run dev
```

---

## 常用命令

```bash
# 后端
cd apps/api && npm run start:dev    # 开发模式
cd apps/api && npm run build        # 构建
cd apps/api && npm test             # 测试 (28 spec files)

# 前端
cd apps/web && npm run dev          # 开发模式 (port 3003)
cd apps/web && npm run build        # 构建

# Docker 全栈 (6 服务)
docker compose up -d
```

---

## 技术栈

| 层 | 技术 |
|------|------|
| 后端框架 | NestJS 11.x, TypeScript |
| 前端框架 | Next.js 14.x, React 18.x, Tailwind CSS 3 |
| 数据库 | PostgreSQL 16, Prisma 6.x ORM |
| AI | DeepSeek API (主), Qwen API (辅) |
| 代码执行 | Cloudecode (DeepSeek 驱动), CC Bridge (降级) |
| 工作流 | PipelineService (本地编排), EventEmitter (事件驱动) |
| 存储 | MinIO (S3 兼容) |
| CI | GitHub Actions (lint + test + build) |
| 部署 | Docker Compose (6 服务) |
