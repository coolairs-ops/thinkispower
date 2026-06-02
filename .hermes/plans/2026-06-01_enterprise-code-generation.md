# 企业级全栈源码生成 — 根因分析与解决方案

> 2026-06-01 | 为什么交付的是 Demo 级别代码，如何做到企业级

---

## 一、事实核查

分步生成 **已经能产出 66 个文件**（日志证据）：

```
[Step 1/4] 生成数据库 Schema...  ✓
[Step 2/4] 生成后端 API...      ✓
[Step 3/4] 生成前端...          ✓
[Step 4/4] 生成集成配置...      ✓
分步生成完成: 66 个文件
企业模板注入: 69 个文件
交付文件保存: 69 → /app/.hermes/deliveries/a07b4f37-xxx
Deployment complete → MinIO
```

**代码确实生成了。** 之所以"看不到"，是因为三个问题：

---

## 二、三个根因

### 🔴 根因1: 交付文件未持久化

```
Docker 容器重建 → /app/.hermes/deliveries/ 丢失
                                  ↓
                          API 查不到文件 → 返回空
```

**修复**: `docker-compose.yml` 添加命名卷

```yaml
volumes:
  deliveries:
services:
  api:
    volumes:
      - deliveries:/app/.hermes/deliveries
```

### 🔴 根因2: 生成后无编译验证

当前流程：DeepSeek 生成 → 保存文件 → 完成。缺少关键步骤：

```
应该有: 生成 → npm install → tsc --noEmit → 报错? → 自动修复 → 再编译
实际:   生成 → 保存 → 完成（不管能不能编译）
```

**修复**: 在 `runProductionDelivery` 中，文件保存后增加编译验证步骤

```typescript
// Step 5: 编译验证
if (hasBackendFiles(files)) {
  const result = execSync('cd /tmp/build && npm install && npx tsc --noEmit', ...)
  if (failed) → autoFix → retry
}
```

### 🟡 根因3: Qwen API Key 无效

Qwen 交叉验证因 401 跳过，缺失独立质量评审。

**修复**: 用户需提供有效的 Qwen API Key（当前 sk-240e52ff... 已失效）

---

## 三、什么是企业级全栈源码

当前产出 vs 企业级标准：

| 维度 | 当前 | 企业级 | 差距 |
|------|------|--------|------|
| 文件数 | 66+ | 20-30 | ✅ 够多(含冗余) |
| 可编译 | ❌ 未验证 | ✅ tsc 通过 | 缺编译验证 |
| 可运行 | ❌ 未验证 | ✅ docker compose up | 缺部署验证 |
| 有测试 | ❌ 无 | ✅ 冒烟测试 | 缺测试生成 |
| 有类型 | ⚠️ 部分 | ✅ 完整 TypeScript | DeepSeek 质量 |
| 持久化 | ❌ 容器内 | ✅ 持久卷 + DB记录 | 缺持久化 |
| 代码审查 | ❌ 无 | ✅ Qwen 双评分 | Qwen Key 无效 |

---

## 四、解决方案（分步执行）

### Step 1: 文件持久化（30分钟）

```
docker-compose.yml: 添加 deliveries 卷
delivery-evaluation.service.ts: 无需改动（已写文件）
delivery.service.ts: 无需改动（已读文件）
```

验证：交付完成后，重启容器，文件仍在。

### Step 2: 编译验证（1小时）

```
delivery-evaluation.service.ts: 新增 verifyCompilation()
  → 检查是否有 package.json + tsconfig.json
  → 在临时目录 npm install + tsc --noEmit
  → 失败 → 提取错误 → DeepSeek 修复 → 重试(最多2次)
```

验证：生成代码 → tsc 有报错 → 自动修复 → 再编译通过。

### Step 3: Qwen Key 更新（5分钟）

用户提供新 Qwen API Key → 更新 `.env` → 重启 API。

### Step 4: 交付页展示修复（30分钟）

见 `2026-06-01_delivery-page-fix.md`

---

## 五、一句话

**代码已经在生成（66个文件），但因为文件没持久化 + 没编译验证 + Qwen Key 失效，看起来像"没生成企业级代码"。修完这三项，docker compose up 就能跑。**
