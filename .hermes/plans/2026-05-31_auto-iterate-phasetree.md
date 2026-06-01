# 自迭代生成树 + 单任务锁

> 2026-05-31 | 方案A实现计划

## 目标

1. 自迭代评估页展示「生成树」风格实时进度（与交付页统一）
2. 单机环境确保同时只有一个自迭代在跑
3. 页面加载时自动重连已运行的任务
4. 迭代进行中前端有明显提示

## 改动清单

### 后端改动

| 文件 | 改动 |
|------|------|
| `apps/api/src/modules/delivery/delivery.service.ts` | 加单任务锁、推 PhaseState 事件、加 status 端点 |
| `apps/api/src/modules/delivery/delivery.controller.ts` | 加 `GET auto-iterate/status` 端点 |

### 前端改动

| 文件 | 改动 |
|------|------|
| `apps/web/src/app/projects/[id]/evaluation/page.tsx` | 自动连接、PhaseTreeView 替换文字状态、迭代提示横幅 |

---

## 1. 后端：单任务锁

在 `DeliveryService` 加一个 `Map<projectId, taskId>` 追踪活跃任务。

```typescript
// delivery.service.ts 新增
private activeAutoIterations = new Map<string, string>();

async startAutoIterate(projectId: string): Promise<{ taskId: string; replaced?: string }> {
  // 如果已有活跃任务，先停掉旧的
  const existing = this.activeAutoIterations.get(projectId);
  if (existing) {
    const sub = this.iterateSubjects.get(existing);
    sub?.complete();
    this.iterateSubjects.delete(existing);
    this.logger.warn(`替换旧迭代 ${existing}`);
  }

  const taskId = `ai-${projectId.substring(0,8)}-${Date.now().toString(36)}`;
  this.activeAutoIterations.set(projectId, taskId);
  // ... 启动 runAutoIterate
  return { taskId, replaced: existing || undefined };
}
```

`runAutoIterate` 结束时清理：`this.activeAutoIterations.delete(projectId)`。

## 2. 后端：PhaseState 事件推送

在 SSE 事件中增加 PhaseState 数组，让前端直接渲染生成树。

```
PhaseState 定义:
  { id: 'sense-l1', label: 'L1 静态分析', status: 'pending'|'active'|'done'|'failed', color: '#3b82f6' }
  { id: 'sense-l2', label: 'L2 运行时',    status: ..., color: '#22c55e' }
  { id: 'sense-l3', label: 'L3 语义评估', status: ..., color: '#a855f7' }
  { id: 'fix',       label: '定向修复',    status: ..., color: '#f97316' }
  { id: 'decide',    label: '达标判定',    status: ..., color: '#14b8a6' }
```

`runAutoIterate` 每个阶段开始时 push `{ type: 'phase_update', phaseStates }`。

首轮 SSE 事件顺序：
```
1. phase_update (全部 pending)
2. phase_update (sense-l1 active)
3. phase_update (sense-l1 done, sense-l2 active)
4. phase_update (sense-l2 done, sense-l3 active)
5. round_result
6. phase_update (sense-l3 done, fix active)
7. phase_update (fix done, decide active)
8. done / stuck / 下一轮
```

## 3. 后端：状态查询端点

```typescript
// delivery.controller.ts
@Get('auto-iterate/status')
async getAutoIterateStatus(@Param('projectId') projectId: string) {
  return this.deliveryService.getAutoIterateStatus(projectId);
}

// delivery.service.ts
async getAutoIterateStatus(projectId: string) {
  const taskId = this.activeAutoIterations.get(projectId);
  if (!taskId) return { active: false };
  return { active: true, taskId };
}
```

## 4. 前端：自动连接

```typescript
// evaluation/page.tsx — useEffect 加载时自动连接
useEffect(() => {
  if (isLoading || !token) return;
  
  // 1. 查询是否有活跃任务
  api.get(`/api/projects/${projectId}/delivery/auto-iterate/status`)
    .then(res => {
      if (res.active) {
        // 2. 有活跃任务 → 自动订阅 SSE
        setTaskId(res.taskId);
        setIterating(true);
        subscribeToIteration(res.taskId);
      }
    });
}, [projectId, token, isLoading]);
```

`subscribeToIteration(taskId)` 是跟 `startIterate` 里一样的 SSE 订阅逻辑，提取为独立函数。

## 5. 前端：生成树 + 迭代提示横幅

```
┌─────────────────────────────────────────────────┐
│ 🔄 自迭代进行中 — 第 3 轮                        │  ← 横幅(bg-indigo-50)
├─────────────────────────────────────────────────┤
│ 综合评分  65                                    │
│ ████████░░ L1 55  ██████████ L2 65  ████████░░ L3 72 │
├─────────────────────────────────────────────────┤
│ 🌳 生成树                                       │
│ ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐ │
│ │✓L1静态│→│✓L2运行│→│◉L3语义│→│ 修复  │→│ 判定  │ │
│ │ 100   │  │  65  │  │分析中│  │      │  │      │ │
│ └──────┘  └──────┘  └──────┘  └──────┘  └──────┘ │
├─────────────────────────────────────────────────┤
│ 第1轮: Score=65 L1=55 L2=65 L3=72              │  ← 历史轮次
│ 第2轮: Score=70 L1=60 L2=65 L3=78              │
└─────────────────────────────────────────────────┘
```

PhaseTreeView 复用交付页组件，只改 id/label/color。

## 6. 清理现有任务

部署前执行：
```
直接用新任务替换 — startAutoIterate 的新逻辑会自动停掉旧任务
```

---

## 验证步骤

1. 访问评估页 → 看到"就绪"状态 + "启动自迭代"按钮
2. 点启动 → 看到横幅 "自迭代进行中 — 第1轮" + 生成树逐阶段点亮
3. 刷新页面 → 自动重连，横幅和生成树恢复
4. 再点启动 → 旧任务被替换，新任务开始（横幅更新）
5. 达标完成 → 横幅消失，弹出终稿交付确认
