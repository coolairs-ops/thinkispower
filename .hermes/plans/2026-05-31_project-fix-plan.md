# 项目全面修复方案

> 2026-05-31 | 按重要度排序 | 先探讨后审批

---

## 影响范围总览

| 项 | 级别 | 改文件数 | 影响面 | 风险 | 建议 |
|----|------|---------|--------|------|------|
| P0-1 JWT硬编码 | 🔴 | 2 | 认证全链路 | 低，仅改启动逻辑 | ✅ 必做 |
| P0-2 401自动登出 | 🔴 | 1 | 所有需要auth的前端请求 | 低，纯前端 | ✅ 必做 |
| P1-3 深色主题迁移 | 🟡 | 2 | plan页(40处)+snapshots页(17处) | 中，57处样式替换 | ✅ 做 |
| P1-4 共享类型提取 | 🟡 | 5+2新建 | 6页面改import | 中，类型重构 | ⚠️ 可推迟 |
| P1-5 模板抽取 | 🟡 | 1+新建 | delivery-orchestrator(554行) | 低，纯重构 | ⚠️ 可推迟 |
| P2-6 过时术语清理 | 🟢 | 1 | sanitize.service.ts | 极低，删2条目 | ✅ 顺手做 |
| P2-7 空spec | 🟢 | 0 | 无 | 无 | ✅ 已关闭 |

---

## P0-1 — JWT_SECRET 硬编码 fallback

### 可行性：✅ 低风险，高收益

当前 `.env` 有 `JWT_SECRET`，`dev-secret-change-in-production` fallback 从未被触发。改动纯防御性——生产漏配时给出可读错误而非静默使用弱密钥。

### 影响范围
- `auth.module.ts` 第16行：替换 `config.get('JWT_SECRET', 'dev-secret-...')` → 无fallback
- `jwt.strategy.ts` 第16行：同上
- 没有其他地方引用 `dev-secret-change-in-production`
- `.env` 已有 `JWT_SECRET`，不需要改

### 实现
```typescript
// auth.module.ts
useFactory: (config: ConfigService) => {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET 未配置，请检查 .env 文件');
  return { secret, signOptions: { expiresIn: '7d' } };
}
```

### 验证
- `npm test` 确保 JWT 相关测试通过
- 临时删除 `.env` 中的 JWT_SECRET → 启动报可读错误 → 恢复 `.env`

---

## P0-2 — 前端 401 自动登出

### 可行性：✅ 低风险，高收益

`api.ts` 只有 35 行，改 `request()` 函数加 401 检测。不需要 refresh token——JWT 7天有效。

### 影响范围
- 仅改 `apps/web/src/lib/api.ts` 一个文件
- 所有通过 `api.get/post/put/patch/delete` 发起的请求自动生效
- 不影响页面 render 逻辑
- 不破坏现有错误处理（401 本就被 `!res.ok` 捕获为 Error）

### 实现
```typescript
async function request(path: string, options: RequestInit = {}): Promise<any> {
  // ... existing code ...
  const res = await fetch(path, { ...options, headers });
  
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    throw new Error('登录已过期，请重新登录');
  }
  
  if (!res.ok) {
    // ... existing error handling ...
  }
}
```

### 验证
- 浏览器手动改 localStorage token 为无效值
- 访问任何需要认证的页面 → 自动跳回 `/`
- 确认 localStorage 中 token 被清除

---

## P1-3 — 旧页面迁移深色主题

### 可行性：✅ 可做，57 处样式替换

两个页面与 dashboard/project/evaluation 页割裂——白底蓝字 vs 深色琥珀色。

### 影响范围
- `plan/page.tsx`：40 处 gray/blue/white 类
- `snapshots/page.tsx`：17 处 gray/blue/white 类
- 映射规则已定义，纯机械替换
- 不涉及 JSX 结构或逻辑改动

### 风险
- 手动替换 57 处可能漏改或误改
- 建议用 find-replace 按映射表逐条处理，每页改完后 `rm -rf .next && npm run build` 确认

### 验证
- 访问 `/plan` 和 `/snapshots` → 视觉与 dashboard 一致
- `npm run build` 无 TS 错误

---

## P1-4 — 共享类型提取

### 可行性：⚠️ 可推迟，当前不是瓶颈

### 影响范围
- 新建 2 个类型文件
- 修改 6 个页面的 import 语句
- 涉及类型：Project、PRD、Message、RoundResult、Snapshot、PlanData、DesignSuggestion

### 风险
- 类型名冲突风险（各页面定义的接口字段不完全相同）
- `RoundResult` 在 evaluation 有特定字段，不能简单共享
- 实际共享的只有 `Project` 和 `PRD`（dashboard + project详情页都用）
- `ToastItem` 和 `ExportState` 是单页面专用，不应提取

### 建议
- 当前规模下收益有限——6个接口定义总共 ~100 行
- 等新增 3-4 个页面时再做，收益更大
- 如果做，只提取 `types/project.ts`（Project + PRD），其他不动

---

## P1-5 — DeliveryOrchestrator 模板抽取

### 可行性：⚠️ 可推迟，纯美学重构

12 个 gen* 方法，~200 行硬编码字符串 → 抽取为独立模板文件。

### 影响范围
- delivery-orchestrator.service.ts（554 行）
- 新建 ~12 个模板文件在 `templates/` 目录
- 不改业务逻辑，只改字符串来源

### 风险
- 极低，纯重构
- 但当前 554 行文件没有成为维护障碍
- 改了也不影响交付功能

### 建议
- 推迟。等 delivery-orchestrator 下次有功能改动时顺手重构

---

## P2-6 — SanitizeService 过时术语

### 可行性：✅ 顺手做，3 行改动

### 影响范围
- `sanitize.service.ts` 第 6 行删除 `'GSD', 'GSG'`
- 第 20-21 行删除映射 `'GSD': '平台引擎', 'GSG': '平台生成服务'`
- 不影响任何实际功能——这些术语已经不存在于代码库

### 验证
- `npm test` 确认 sanitize 相关测试通过

---

## 执行顺序建议

```
第一轮（今天）:
  P0-1 JWT 硬编码     ← 安全
  P0-2 401 自动登出   ← 安全
  P2-6 过时术语清理   ← 顺手
  验证：npm test + 浏览器测试

第二轮（改天）:
  P1-3 深色主题迁移   ← UI 一致性
  验证：npm run build + 视觉检查

推迟:
  P1-4 共享类型提取   ← 等更多页面时
  P1-5 模板抽取       ← 等有功能改动时
  P2-7 空 spec        ← 已关闭
```

## 不动项

- Token 刷新机制 — JWT 7天有效，当前规模不需要
- 后端测试覆盖 — 30 个 spec 文件全部有内容
- 空 spec 文件 — 不存在
