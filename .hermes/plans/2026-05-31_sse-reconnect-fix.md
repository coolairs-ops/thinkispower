# 自迭代前端 SSE 断连修复

> 2026-05-31 | P0-P2 分优先级

## 根因

SSE 连接断开后 `onerror` 闭包过期 → 无限重连风暴 → UI 闪回初始态。

完整链条：
```
1. 后端发 done → subject.complete() → SSE 触发 complete 事件
2. onmessage: setIterating(false)  ← React 异步
3. 浏览器关 SSE → 触发 onerror
4. onerror 闭包里 iterating 还是 true → 3s 后重连
5. 后端 taskId 已被 delete → 404 → 又一个 error → 循环
6. 同时 complete 处理器: es.close() → 又触发 onerror
7. UI 在"有数据显示"和"重连覆盖"之间抖动
```

## 改动文件

仅 1 个文件：
`apps/web/src/app/projects/[id]/evaluation/page.tsx`

---

## P0-1 — onerror 不再自动重连

**位置**: `subscribeToIteration` 中的 `es.onerror`

**当前代码**（问题所在）:
```typescript
es.onerror = () => {
  es.close();
  if (iterating) {  // ← 闭包过期
    setTimeout(() => {
      if (taskId) subscribeToIteration(taskId);  // ← 无限循环
    }, 3000);
  }
};
```

**修复后**:
```typescript
es.onerror = () => {
  console.log('[auto-iterate] SSE disconnected');
  es.close();
  // 不再自动重连。done/stuck 事件已结束迭代，
  // 如果是非预期断开，用户点"启动自迭代"重新开始即可。
};
```

**理由**: `done`/`stuck` 事件本身就是迭代结束的信号。非预期断开让用户手动重试比静默死循环更可预测。

---

## P0-2 — 移除 complete 事件对 iterating 的覆盖

**位置**: `subscribeToIteration` 的 `case 'complete'`

**当前代码**:
```typescript
case 'complete':
  setIterating(false);  // ← 覆盖 done/stuck 的状态
  break;
```

**修复后**: 直接删除 `case 'complete'` 分支。`done` 和 `stuck` 已经各自处理了 `setIterating(false)`，`complete` 是多余的重复调用。

---

## P1-3 — SSE 断开指数退避重试

**位置**: `subscribeToIteration` 的 `es.onerror`

增加有限次重试 + 指数退避。仅在没有收到 `done`/`stuck` 时重试：

```typescript
let retryCount = 0;
const MAX_RETRY = 3;

es.onerror = () => {
  es.close();
  if (retryCount < MAX_RETRY && iterating) {
    retryCount++;
    const delay = Math.min(1000 * Math.pow(2, retryCount), 8000);
    console.log(`[auto-iterate] Retry ${retryCount}/${MAX_RETRY} in ${delay}ms`);
    setTimeout(() => {
      if (taskId) subscribeToIteration(taskId);
    }, delay);
  }
};
```

---

## P1-4 — 页面卸载时清理 SSE

**位置**: `useEffect` 自动连接逻辑

**当前代码**（缺失清理）:
```typescript
useEffect(() => {
  // ... auto-check and subscribe
  // 没有 return cleanup
}, [isLoading, token, projectId, subscribeToIteration]);
```

**修复后**:
```typescript
useEffect(() => {
  // ... auto-check and subscribe
  return () => {
    esRef.current?.close();
  };
}, [isLoading, token, projectId, subscribeToIteration]);
```

---

## P2-5 — 初始化静态阶段树占位

**位置**: `phaseStates` 初始化

**当前代码**:
```typescript
const [phaseStates, setPhaseStates] = useState<PhaseState[]>([]);
```

**修复后**:
```typescript
const [phaseStates, setPhaseStates] = useState<PhaseState[]>([
  { id: 'sense-l1', label: 'L1 静态分析', status: 'pending', color: '#3b82f6' },
  { id: 'sense-l2', label: 'L2 运行时',   status: 'pending', color: '#22c55e' },
  { id: 'sense-l3', label: 'L3 语义评估', status: 'pending', color: '#a855f7' },
  { id: 'fix',       label: '定向修复',   status: 'pending', color: '#f97316' },
  { id: 'decide',    label: '达标判定',   status: 'pending', color: '#14b8a6' },
]);
```

**理由**: 跟交付页生成树对齐——始终展示 5 个阶段骨架，后端 `phase_update` 只更新 status 字段。避免空白期。

---

## 验证步骤

1. `rsync` 前端源码到 `/home/coola/think-is-power-web`
2. 浏览器打开评估页 → 确认 5 阶段树占位可见
3. 点"启动自迭代" → 网络面板确认只有 1 个 EventSource
4. 等待 done/stuck → 确认无重连循环
5. 切换到其他页面 → 确认 Network 面板 SSE 连接关闭
