# Phase C: 在线部署 — 执行计划

> 2026-06-01 | 目标: 从"下载源码包"到"docker compose up 可访问"

---

## 目标

生成的代码可以被真正部署和访问。用户拿到的是一个可运行的在线服务，不只是源码压缩包。

**验证标准**: `docker compose up` 后可通过浏览器访问。

---

## 一、当前状态

```
部署现状:
  deployment.service.ts → deploy()
    └── InternalDeploymentProvider
          └── 上传 demoHtml 到 MinIO → 返回静态 URL
                ↓
        只是 HTML 静态托管，不是真正的容器部署

下载:
  GET /api/deploy/:id/delivery/:did → tar.gz 打包
     ✅ 能下载，但只是源码包
```

**缺失**: 无 Docker build、无容器运行、无动态 URL 分配。

---

## 二、目标架构

```
交付完成
    │
    ▼
┌──────────────────────┐
│ 部署流水线 (新增)      │
│                       │
│ 1. docker build       │
│ 2. docker run -d      │
│ 3. 端口映射            │
│ 4. 健康检查            │
│ 5. 生成访问 URL        │
└──────┬───────────────┘
       │
       ▼
   ┌─────────┐
   │ 交付页   │
   │         │
   │ 🌐 在线访问:        │
   │ http://x.x.x.x:xxxx │
   │ [打开] [复制链接]    │
   │ ⏰ 有效期: 24h       │
   └─────────┘
```

---

## 三、改动范围

### 3.1 新增文件

| 文件 | 内容 | 风险 |
|------|------|------|
| `services/deploy-pipeline.service.ts` | Docker 构建 + 运行流水线 | 🟡 中 — 依赖 Docker daemon |

### 3.2 修改文件

| 文件 | 改动 | 风险 |
|------|------|------|
| `deployment.service.ts` | deploy() 改为调用 Docker 流水线 | 🟡 中 |
| `deploy.controller.ts` | 新增 GET /status/:id 端点 | 🟢 低 |
| `delivery/page.tsx` | 显示在线访问 URL + 有效期 | 🟢 低 |

### 3.3 不影响的模块

所有其他模块不变。

---

## 四、Docker 流水线设计

```typescript
class DeployPipelineService {
  async deploy(deliveryId: string, projectId: string): Promise<DeployResult> {
    const deliveryDir = `/app/.hermes/deliveries/${deliveryId}`;
    
    // 1. 确认 Dockerfile 存在
    if (!existsSync(join(deliveryDir, 'Dockerfile'))) {
      // 注入默认 Dockerfile
      writeFileSync(join(deliveryDir, 'Dockerfile'), DEFAULT_DOCKERFILE);
    }

    // 2. Docker build
    const imageTag = `think-is-power-app-${projectId.substring(0, 8)}`;
    execSync(`docker build -t ${imageTag} ${deliveryDir}`, { timeout: 120_000 });

    // 3. 找空闲端口
    const port = await this.findFreePort();

    // 4. Docker run
    const containerName = `app-${projectId.substring(0, 8)}`;
    // 先停掉旧容器
    try { execSync(`docker rm -f ${containerName}`); } catch {}
    
    execSync(
      `docker run -d --name ${containerName} -p ${port}:3000 ${imageTag}`,
      { timeout: 30_000 }
    );

    // 5. 健康检查
    const healthy = await this.waitForHealth(port, 30);
    if (!healthy) {
      return { status: 'deploy_failed', error: '健康检查失败' };
    }

    // 6. 返回访问 URL
    const host = process.env.DEPLOY_HOST || 'localhost';
    const url = `http://${host}:${port}`;
    
    return { status: 'deployed', url, port, containerName };
  }
}
```

---

## 五、降级方案

Docker daemon 不可用时的处理:

```
try docker build:
  ✅ → docker run → 健康检查 → 返回 URL
  ❌ → 降级方案:
        ├── 静态 HTML 部署到 MinIO (现有方案)
        └── 返回源码下载链接 + docker-compose 文件
           用户自行 docker compose up
```

部署状态展示:
- ✅ 已部署 — 显示访问 URL
- ⚠️ 静态部署 — 显示 MinIO URL（降级）
- 📦 仅源码 — 显示下载链接（Docker 不可用）

---

## 六、前端展示

交付页部署区块:

```
┌─────────────────────────────────────────┐
│ 🚀 在线部署                              │
│                                         │
│ 状态: ✅ 已部署                          │
│ 地址: http://localhost:30050             │
│ 容器: app-c52847ea                       │
│ 有效期: 24 小时                          │
│                                         │
│ [打开应用] [复制链接] [停止部署]          │
└─────────────────────────────────────────┘
```

---

## 七、验证方案

1. 完成交付 → 自动触发部署
2. 检查交付页显示访问 URL
3. curl 访问 URL → 返回 200 + 应用内容
4. Docker daemon 不可用 → 降级到 MinIO 静态部署
5. 健康检查失败 → 显示部署失败 + 源码下载备用

---

## 八、工作量

| 任务 | 预估 |
|------|------|
| deploy-pipeline.service.ts | 2h |
| 降级方案 | 1h |
| 健康检查 | 0.5h |
| 前端展示 | 1h |
| 测试 | 1.5h |
| **合计** | **~6h** |

---

## 九、效果评估

| 指标 | Phase B 后 | Phase C 后 |
|------|-----------|-----------|
| 可访问性 | 仅下载源码 | 在线 URL 可访问 |
| 部署方式 | tar.gz 下载 | Docker 容器运行 |
| 用户体验 | 需要自己部署 | 一键打开 |
| 降级能力 | 无 | Docker 不可用 → 静态部署 → 源码下载 |
| 完整度 | ~78% | **~85%** |

---

## 十、三阶段总结

| 阶段 | 核心改动 | 完整度提升 | 工期 |
|------|---------|-----------|------|
| Phase A | 分步代码生成 | 68% → 72% | 1天 |
| Phase B | Qwen 交叉验证 | 72% → 78% | 1天 |
| Phase C | 在线部署 | 78% → 85% | 1天 |
| **合计** | | **68% → 85%** | **3天** |

完成后达到 V1.0 方案定义的 ~85% 完整度（企业生产级可部署源码）。
