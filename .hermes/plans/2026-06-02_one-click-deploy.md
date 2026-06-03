# 一键上线方案 可交付代码 → 生产就绪应用

**目标**: PM点"一键上线"→ 5-10分钟后拿到可访问的网址
**现状**: PM拿到源码.zip → 找技术 → 手动部署 → 1-3天

---

## 分三阶段实现

### 阶段1: 容器自动部署 (本周, ~2h)
**目标**: 生成的应用自动docker compose up → 返回URL

**做法**:
1. `deploy-pipeline.service.ts` 已有 `deploy()` 方法
2. 交付完成后自动调用 `deploy()`
3. 前端显示实时部署日志 + 最终URL
4. 为每个交付分配独立端口 (30100-30150)

**改动**:
- `delivery-evaluation.service.ts` — 交付成功后自动部署
- `delivery/page.tsx` — 部署状态面板

---

### 阶段2: 域名 + HTTPS (下周, ~3h)
**目标**: 每个应用有独立子域名 `xxx.think-is-power.com`

**做法**:
1. `nginx-proxy` 容器统一反向代理
2. `acme-companion` 自动申请 Let's Encrypt 证书
3. 部署时自动注册路由: `{project}.think-is-power.com`

**改动**:
- `docker-compose.yml` — 新增 nginx-proxy + acme-companion
- `deploy-pipeline.service.ts` — 注册路由 + SSL

---

### 阶段3: 监控 + 灰度 (下月, ~5h)
**目标**: 应用宕机自动重启，更新无感切换

**做法**:
1. 健康检查: 每30s检查一次，3次失败自动重启
2. 灰度: 新版本先跑在另一个端口 → 验证通过 → 切换流量
3. 通知: WebSocket推送部署状态给前端

**改动**:
- `deploy-pipeline.service.ts` — 健康检查定时器
- 新增 `deploy-watcher.service.ts` — 监控+重启

---

## 推荐先做阶段1

```
现状: 点"开始交付" → 下载源码 → PM自己想办法
阶段1后: 点"开始交付" → 自动生成+编译+部署 → 直接访问 http://host:30150
```

**改动量小**: deploy-pipeline已有关键代码，主要是串联工作流
**效果立竿见影**: PM能看到成果

批准阶段1?
