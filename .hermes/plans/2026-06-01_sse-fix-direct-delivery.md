# SSE进度流 + 免迭代直通交付 评估与方案

**日期**: 2026-06-01
**状态**: 方案待审批
**目的**: (1) 修复自迭代SSE进度不显示 (2) 实现免自迭代直通交付

---

## 一、问题诊断：SSE进度流不工作

### 现象
前端评估页点击「启动自迭代」→ 显示「等待交付启动，阶段将在此实时展示」→ 无任何进度更新。

### 根因分析

追踪全链路：

```
前端: new EventSource(`/api/projects/${id}/delivery/auto-iterate/stream/${tid}?token=...`)
  ↓ Next.js rewrites 代理
API DeliveryController.autoIterateStream()
  ↓ @Public() + @Query('token') 手动验签
  ↓ this.iterationService.subscribeAutoIterate(taskId)
DeliveryIterationService.subscribeAutoIterate()
  ↓ this.iterateSubjects.get(taskId)?.asObservable()
ReplaySubject → SSE data 事件
```

**可能断点（按概率排序）**：

| # | 断点 | 概率 | 原因 |
|---|------|------|------|
| 1 | Next.js 代理不支持 SSE 流式转发 | **高** | Next.js rewrites 在开发模式下对 EventSource 的 `text/event-stream` 响应可能缓冲而非流式推送。Node.js http-proxy 默认会缓冲直到响应结束。 |
| 2 | EventSource 连接时 ReplaySubject 已关闭 | 中 | `runAutoIterate` 完成后 `subject.complete()`，但 ReplaySubject 会重放历史事件给新订阅者。如果迭代已完成且 subject 被 delete，则 `subscribeAutoIterate` 返回 null。 |
| 3 | CORS 阻止 SSE | 低 | SSE 的 `Access-Control-Allow-Origin` 可能缺失，但 EventSource 默认不带自定义头所以 CORS 预检不触发。 |
| 4 | token 验签失败 | 低 | query param 的 token 解析失败导致 req.user 为空，但 `@Public()` 跳过 JwtAuthGuard。 |

### 根因确认（通过已有日志推断）

SSE流端点可以返回200并开始写数据，但前端收不到——这强烈指向 **断点1**：Next.js rewrites 代理缓冲了 SSE 流。Next.js 的 `rewrites()` 使用 node-http-proxy，默认会等待后端响应完成才转发给客户端——SSE 的长连接被当作普通 HTTP 请求处理。

### 验证方法

```bash
# 绕过 Next.js 代理，直接连 API 的 SSE 端点
curl -N "http://localhost:3001/api/projects/{pid}/delivery/auto-iterate/stream/{tid}?token={tok}"
```

如果直接连 API 有数据但通过前端代理没有，就是 Next.js 代理问题。

---

## 二、方案：修复 SSE 进度流

### 方案 A：绕过 Next.js 代理（推荐，改动最小）

**思路**：前端 EventSource 直接连 API 端口，不经过 Next.js rewrites。

**改动**：
- 前端 `evaluation/page.tsx`：EventSource URL 从相对路径 `/api/...` 改为绝对路径 `http://localhost:3001/api/...`
- 不需要后端改动

**影响**：
- 仅改 1 个文件，2 行代码
- EventSource 直接连 API 端口，绕过 Next.js 代理
- 需要在 API 的 CORS 白名单中允许 `localhost:3003`（已验证已配置）

**风险**：
- 暴露 API 端口给前端（开发环境可接受）
- 生产环境需配置反向代理

### 方案 B：修复 Next.js 代理 SSE 支持

**思路**：在 next.config.js 中配置代理选项禁用缓冲。

**改动**：
- `next.config.js`：添加代理配置
- 需要研究 Next.js 内置代理的 SSE 支持

**影响**：
- 可能不兼容（Next.js 内置代理功能有限）
- 试验性改动

### 建议：方案 A

改动最小、最高效。1 文件 2 行改完即生效。

---

## 三、免自迭代直通交付

### 现状

自迭代和交付是**两个独立路径**，互不依赖：

```
方案确认 → 生成规格 → 确认规格
                          ↓
                    ┌─────┴─────┐
                    ↓           ↓
              自迭代评估      Demo预览
              (质量优化)    (即时生成)
                    ↓           ↓
                    └─────┬─────┘
                          ↓
                     终稿交付
```

当前 Demo 预览和终稿交付都**不需要**先跑自迭代：
- Demo 页：`spec_confirmed` 状态即可生成预览（已验证通过）
- 交付页：直接调 `production-deliver`（已验证通过）

### 用户困惑来源

评估页(`/evaluation`)的「启动自迭代」按钮让用户以为这是交付前的**必须步骤**。实际上：
- 自迭代 = 自动检查质量 + 自动修复 + 再检查（可选优化）
- 交付 = 直接生成全栈代码（独立路径）

### 方案：优化页面引导

| 页面 | 当前问题 | 改动 |
|------|----------|------|
| `/spec` | 「确认规格」后无明确下一步指引 | 确认后弹出提示「规格已确认！下一步：生成预览 → 查看交付」 |
| `/demo` | 「生成预览」按钮在 spec_confirmed 状态可能不显示 | 已修复 |
| `/evaluation` | 用户以为必须点「启动自迭代」才能交付 | 页面顶部加提示：「自迭代是可选的优化步骤，你也可以直接去交付页生成最终代码」 |
| `/delivery` | 无问题，直接可用 | 不变 |

**改动范围**：
- `spec/page.tsx`：确认后弹窗提示下一步（+15行）
- `evaluation/page.tsx`：加可选提示（+5行）
- `delivery/page.tsx`：无改动

**工作量**：~30 分钟

---

## 四、影响评估

| 维度 | SSE修复 | 免迭代直通 |
|------|---------|-----------|
| 后端改动 | 0 文件 | 0 文件 |
| 前端改动 | 1 文件 2 行 | 2 文件 ~20 行 |
| 风险 | 低（仅改URL） | 极低（仅加提示文案） |
| 测试 | EventSource直连验证 | 页面文案检查 |
| 部署 | 无需重建API | HMR热更新 |

---

## 五、建议执行顺序

1. **先修 SSE**：evaluation/page.tsx 改 EventSource URL → 立即验证进度流
2. **再改引导**：spec页 + evaluation页 加文案提示
3. **验证全流程**：规格确认 → Demo预览 → 终稿交付（跳过自迭代）
