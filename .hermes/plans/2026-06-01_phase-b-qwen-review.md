# Phase B: Qwen 交叉验证 — 执行计划

> 2026-06-01 | 目标: DeepSeek 生成 → Qwen 独立审查 → 自动修复差异

---

## 目标

代码生成后，Qwen 作为独立评审者评估质量，与 DeepSeek 形成交叉验证闭环。

**验证标准**: Qwen 评分 < 60 分 → 自动进入修复循环（最多 3 次）。

---

## 一、当前状态

```
传感器系统已有 QwenClient (qwen-client.service.ts)
  ├── 用于 L3 语义评估中的 CrossValidator
  └── 不参与交付流程

交付流程:
  CC Bridge pipeline → Cloudecode → DeepSeek 生成 → 企业模板注入 → 完成
                                                         ↑
                                                    无独立评审
```

**Qwen 现状**: `QwenClient` 已实现 `chat()` 方法，使用 `qwen-plus` 模型。API Key 存储在环境变量中。当前仅在传感器评估中使用，不在交付流水线中。

---

## 二、目标架构

```
交付流程 (修改后):
  DeepSeek 分步生成 (Phase A)
      │
      ▼
  ┌─────────────────────┐
  │ Qwen 代码审查        │ ← 新增
  │ - 结构完整性检查      │
  │ - 安全性检查          │
  │ - 功能覆盖度检查      │
  │ - 代码风格检查        │
  │ 输出: score (0-100)   │
  └──────┬──────────────┘
         │
    score >= 60? ──No──▶ 自动修复 (DeepSeek, max 3次)
         │                    │
        Yes              score still < 60?
         │                    │
         ▼                   Yes → 标记警告, 继续
  企业模板注入               No → 回到 Qwen 审查
         │
         ▼
      完成交付
```

---

## 三、改动范围

### 3.1 新增文件

| 文件 | 内容 | 风险 |
|------|------|------|
| `services/qwen-reviewer.service.ts` | Qwen 代码审查服务 | 🟢 低 — 新文件，不影响现有流程 |

### 3.2 修改文件

| 文件 | 改动 | 风险 |
|------|------|------|
| `delivery-evaluation.service.ts` | 在分步生成后调用 QwenReviewer，根据评分决定修复 | 🟡 中 |
| `delivery/page.tsx` | 显示 Qwen 评分对比 | 🟢 低 |
| `sensors/qwen-client.service.ts` | 增加 `review()` 方法，返回结构化审查结果 | 🟢 低 |

### 3.3 不影响的模块

所有其他模块不变。

---

## 四、Qwen 审查 Prompt 设计

```typescript
const REVIEW_PROMPT = `你是代码审查专家。请审查以下全栈项目代码，从 4 个维度评分(0-100)。

项目名称: {projectName}
项目方案: {planSummary}

生成的代码文件:
{files}

评分维度:
1. 结构完整性 (25分) — 是否有完整的项目结构、package.json、入口文件
2. 安全性 (25分) — 是否有输入验证、SQL注入防护、认证授权
3. 功能覆盖度 (25分) — 是否覆盖了方案中的所有功能点
4. 代码风格 (25分) — 命名规范、TypeScript 类型、注释

输出 JSON:
{
  "overallScore": 75,
  "dimensions": {
    "structure": 20, "security": 15, "coverage": 20, "style": 20
  },
  "issues": [
    { "severity": "high", "file": "backend/src/user.controller.ts", "description": "缺少输入验证", "suggestion": "添加 class-validator DTO" }
  ],
  "summary": "代码结构完整但安全性不足..."
}`;
```

---

## 五、前端展示

交付页新增"质量审查"区块:

```
┌─────────────────────────────────────────┐
│ 🔍 代码质量审查                           │
│                                         │
│ DeepSeek 生成    ████████████  85 分     │
│ Qwen 交叉验证    ██████████    72 分     │
│                                         │
│ 结构 20/25  ✅  安全 15/25  ⚠️           │
│ 功能 20/25  ✅  风格 17/25  ✅           │
│                                         │
│ ⚠️ 3 个问题待修复                        │
│ 1. [高] 缺少输入验证                      │
│ 2. [中] SQL 注入风险                      │
│ 3. [低] 变量命名不规范                    │
│                                         │
│ [自动修复] [忽略]                         │
└─────────────────────────────────────────┘
```

---

## 六、自动修复逻辑

```typescript
async autoFixFromQwenReview(issues: ReviewIssue[], files: GeneratedFile[]): Promise<GeneratedFile[]> {
  if (issues.length === 0) return files;

  const fixPrompt = `修复以下代码问题:

${issues.map(i => `[${i.severity}] ${i.file}: ${i.description}\n建议: ${i.suggestion}`).join('\n\n')}

当前代码:
${files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

输出修复后的完整文件，用 \`\`\`文件路径 标记。`;

  const response = await this.deepseek.chat([{ role: 'user', content: fixPrompt }], {
    temperature: 0.2, maxTokens: 16384, timeoutMs: 120_000,
  });

  return this.parseFiles(response);
}
```

---

## 七、验证方案

1. 创建测试项目 → 完成全流程
2. 检查交付页显示双评分
3. Qwen 评分 < 60 → 验证自动修复触发
4. 修复 3 次后仍 < 60 → 验证标记警告但不阻塞
5. Qwen API 不可用 → 验证跳过审查, 正常交付

---

## 八、工作量

| 任务 | 预估 |
|------|------|
| qwen-reviewer.service.ts | 1.5h |
| 集成到交付流程 | 1h |
| 前端评分展示 | 1h |
| 自动修复逻辑 | 1h |
| 测试 | 1.5h |
| **合计** | **~6h** |

---

## 九、效果评估

| 指标 | Phase A 后 | Phase B 后 |
|------|-----------|-----------|
| 代码质量保证 | 无 | DeepSeek + Qwen 双评分 |
| 安全漏洞检测 | 无 | Qwen 审查 + 自动修复 |
| 功能覆盖验证 | 无 | Qwen 对比方案 vs 代码 |
| 完整度 | ~72% | ~78% |
