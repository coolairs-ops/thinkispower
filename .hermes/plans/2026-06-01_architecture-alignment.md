# 思想动力 架构对齐与生产级交付路线图

> 2026-06-01 | 对照历史规划，纠正偏差，回归"不辜负你的每个想法"

---

## 一、核心理念（不可偏离）

```
PM 输入需求
    │
    ▼
Hermes 分析需求（完备度引擎 + 决策树）
    │
    ▼
CC Bridge 调度 Claude Code ──► DeepSeek 生成代码
    │                              │
    │                         Qwen 交叉验证
    ▼                              │
企业生产级源码 + 在线部署 ──────────┘
```

**口号**: 思想动力，不辜负你的每个想法。

**交付标准**: 可部署的企业生产级源码，不是 Demo HTML，不是 4 个模板文件。

---

## 二、当前状态 vs 历史规划对照

### 2.1 全链路现状（2026-05-30 全链路改造计划 vs 当前）

| 阶段 | 原始规划 | 当前状态 | 偏差 |
|------|---------|---------|------|
| 需求澄清 | PM只问功能/界面/权限/流程，平台自决技术 | ✅ 10阶段30题引导访谈 | 无偏差 |
| 设计建议 | 导航/布局/字段/流程/配色建议 | ⚠️ DesignSuggestions 组件存在但未接入真实数据 | 功能不完整 |
| 自迭代 | 传感器评估→自动修复→用户决策 | ✅ L1/L2/L3 + autoFix | 修复后可用 |
| 生成树 | 文件结构树 + 阶段流程树 | ✅ FileTreeView + PhaseTreeView | 无偏差 |
| 全栈交付 | CC Bridge → Claude Code → 全栈代码 | ⚠️ 刚改为主路径，但仍是单次 DeepSeek 调用 | **重大偏差** |

### 2.2 平台全民化（2026-05-31 platform-democratize vs 当前）

| 模块 | 原始规划 | 当前状态 | 偏差 |
|------|---------|---------|------|
| P0 完备度引擎 | completeness-checker.service.ts | ⚠️ DecisionEngine 部分实现 | 功能不完整 |
| P0 模板化输入 | suggestion-picker 组件 | ❌ 未实现 | 缺失 |
| P1 对话引导 UI | 对话气泡 + 选项按钮 | ✅ 需求访谈整合到聊天 | 无偏差 |
| P2 首页入口 | 四个入口（快速开始/我有想法/专业用户/看Demo） | ❌ 未实现 | 缺失 |

### 2.3 交付升级（2026-05-31 platform-delivery-gap vs 当前）

| 优先级 | 内容 | 当前状态 |
|--------|------|---------|
| P0 安全模块注入 | Helmet/CORS/RateLimit | ✅ 已注入 |
| P0 可观测性注入 | /health + JSON日志 + 优雅关闭 | ✅ 已注入 |
| P0 Docker升级 | 多阶段Dockerfile + nginx | ✅ 已注入 |
| P1 数据字典表单 | PM结构化输入 | ❌ 未实现 |
| P1 角色权限矩阵 | 角色+CRUD表单 | ❌ 未实现 |
| P2 部署选项 | 单机/集群选择 | ❌ 未实现 |
| P2 评估报价 | AI覆盖率 + 人工工时 + 报价 | ❌ 未实现 |

### 2.4 V1.0 差距评估（2026-06-01 v1-solution-gap-assessment vs 当前）

原始评估: **当前 ~45%**。已完成的模块: 规格确认(6), 决策树(5), 错误模式(4), 部分技术门禁(12), 部分自动修复边界(11)。

**更新后评估: ~55%**（完成规格确认+决策树+警告清理+自迭代修复+交付页重写+CC Bridge主路径）

---

## 三、当前架构的四个关键偏差

### 🔴 偏差1: 代码生成是单次 LLM 调用，不是工程化流水线

**期望**: CC Bridge 调度 Claude Code → 多步骤生成（DB→API→前端→集成）→ 编译验证
**实际**: CC Bridge → Cloudecode → DeepSeek 单次调用生成全部文件，无编译验证

### 🔴 偏差2: Qwen 交叉验证未接入

**期望**: DeepSeek 生成代码 → Qwen 交叉验证 → 反馈修正
**实际**: Qwen 只在传感器评估中用于 CrossValidator，不在交付流程中

### 🔴 偏差3: 交付产物是 Demo 级别，不是企业生产级

**期望**: 多文件项目结构（frontend/backend/database/docker），可 `docker compose up`
**实际**: DeepSeek 生成 7 个文件 + 4 个企业模板注入，经常超时返回 0 文件

### 🟡 偏差4: 在线部署不可用

**期望**: Docker build → 分配临时域名 → HTTPS → 健康检查
**实际**: 只有 MinIO 静态 HTML 部署，无 Docker build + 域名

---

## 四、回归路线图

### 阶段1: 生产级代码生成（本周，P0）

**目标**: 交付产物从"Demo HTML + 模板"升级为"可部署的全栈项目"

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 1.1 | 分步代码生成 | `delivery-evaluation.service.ts` | 不再一次生成全部文件，改为: DB schema → Backend → Frontend → Integration，每步独立调用 DeepSeek |
| 1.2 | 生成后编译验证 | `delivery-evaluation.service.ts` | 生成 package.json + tsconfig → npm install → tsc --noEmit |
| 1.3 | Docker build 验证 | `delivery-evaluation.service.ts` | docker build -t project → 验证能构建 |
| 1.4 | 失败自动修复 | `delivery-evaluation.service.ts` | 编译/build 失败 → 调 DeepSeek 修复 → 重试(最多3次) |

### 阶段2: Qwen 交叉验证接入（本周，P0）

**目标**: 每次代码生成后，Qwen 独立评估质量

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 2.1 | Qwen 代码审查服务 | `services/qwen-reviewer.service.ts` | 输入: 生成的代码 + 规格 → 输出: 问题清单 + 评分 |
| 2.2 | 交叉验证集成 | `delivery-evaluation.service.ts` | DeepSeek 生成 → Qwen 审查 → 对比差异 → 自动修复差异 |
| 2.3 | 前端展示 Qwen 评分 | `delivery/page.tsx` | 交付页显示 DeepSeek vs Qwen 评分对比 |

### 阶段3: 在线部署（下周，P1）

**目标**: 生成的代码可以真正部署访问

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 3.1 | Docker 构建流水线 | `services/deploy-pipeline.service.ts` | docker build → docker run → 端口映射 |
| 3.2 | 临时访问 URL | `deploy.controller.ts` | 返回可访问的 URL + 有效期 |
| 3.3 | 部署状态监控 | `delivery/page.tsx` | 实时显示部署进度 |

### 阶段4: 工程化完善（下周，P1-P2）

| # | 任务 | 说明 |
|---|------|------|
| 4.1 | 完备度引擎补全 | completeness-checker.service.ts 接入需求访谈 |
| 4.2 | 首页入口改造 | 四个入口（快速开始/我有想法/专业用户/看Demo）|
| 4.3 | 评估报价模块 | AI覆盖率 + 人工工时估算 + 报价单 |
| 4.4 | 测试环境自动部署 | Docker + 临时域名 + 健康检查 |

---

## 五、不变的原则

1. **用户只描述需求，平台负责技术** — 不向用户暴露 DeepSeek/Qwen/Claude/CC Bridge 等技术名词
2. **CC Bridge 是主路径** — 交付走 CC Bridge 流水线，Cloudecode 是降级
3. **Qwen 用于交叉验证，不用于生成** — 生成用 DeepSeek，验证用 Qwen
4. **交付物必须是可部署的生产级代码** — docker compose up 就能跑
5. **思想动力，不辜负你的每个想法** — 每个交付都是完整的工程产物

---

## 六、实施顺序

```
阶段1 (生产级代码生成) ──► 阶段2 (Qwen交叉验证) ──► 阶段3 (在线部署) ──► 阶段4 (工程化完善)
     3-4天                      2-3天                    2-3天                  持续
```

**当前立即执行: 阶段1 — 1.1 分步代码生成 + 1.4 失败自动修复**
