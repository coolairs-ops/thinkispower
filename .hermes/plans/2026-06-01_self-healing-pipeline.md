# 平台自愈流水线 — 执行计划

> 2026-06-01 | 目标: AI 调用 → 自动质检 → 不合格? → 自动修复 → 再质检 → 交付

---

## 一、与已有三阶段的关系

```
                    Demo 层                          全栈层
              ┌──────────────┐              ┌──────────────────┐
              │ 自愈流水线    │              │ Phase A/B/C       │
              │ (本次计划)    │              │ 分步生成+Qwen+部署 │
              │              │              │                  │
AI响应 ──────▶│ 闸门1 结构    │   方案确认   │ Schema生成        │
              │ 闸门2 内容    │────▶Demo──▶│ Backend生成       │
              │ 闸门3 隔离    │              │ Frontend生成      │
              │ 闸门4 验收    │              │ Integration      │
              │              │              │ Qwen审查          │
              │ ↓ 交付Demo   │              │ Docker部署        │
              └──────────────┘              └──────────────────┘
                    互补关系，非替代关系
```

**自愈流水线**: 保证 Demo HTML 质量（面向 PM 验收）
**Phase A/B/C**: 保证全栈代码质量（面向生产交付）

---

## 二、四道闸门设计

### 闸门1: 结构完整性

| 检查项 | 规则 | 失败处理 |
|--------|------|---------|
| DOCTYPE | 含 `<!DOCTYPE html>` | 自动重试(Prompt+"上次输出不完整，请输出完整HTML") |
| html/head/body | 含 `<html>`, `<head>`, `<body>` | 同上 |
| 结束标签 | 以 `</html>` 结束 | 同上 |
| 长度 | > 500 字节 | 同上 |
| Markdown 污染 | 不含 ``` 标记 | 同上 |

**实现位置**: `deepseek.service.ts` — 在 `chat()` 方法返回前增加 `validateStructure()` 调用

```typescript
// 新增 ~30 行
private validateStructure(response: string): { valid: boolean; reason?: string } {
  if (response.length < 500) return { valid: false, reason: '响应过短' };
  if (!/<!DOCTYPE\s+html/i.test(response)) return { valid: false, reason: '缺少 DOCTYPE' };
  if (!/<html[\s>]/i.test(response)) return { valid: false, reason: '缺少 html 标签' };
  if (!/<\/html>\s*$/i.test(response.trim())) return { valid: false, reason: '未以 </html> 结束' };
  if (/```[a-z]*\s*[\s\S]*```/.test(response)) return { valid: false, reason: '含 markdown 代码块' };
  return { valid: true };
}
```

### 闸门2: 内容有效性

| 检查项 | 规则 | 失败处理 |
|--------|------|---------|
| 错误文本检测 | 不含 "抱歉"/"error"/"超时"/"无法" | 清洗或重试 |
| data-module-key 保留 | 所有原有元素的属性不丢失 | 脚本补属性 |
| 新增元素属性 | 所有交互元素注入 data-module-key | DeepSeek 修复 |

**实现位置**: `demo-generator.service.ts` — Demo 生成后增加 `validateContent()` 调用

```typescript
// 新增 ~50 行
private async validateAndFixContent(html: string, originalModules: string[]): Promise<string> {
  // 检查错误文本
  const errorPatterns = ['抱歉', 'error', '超时', '无法完成', 'I cannot'];
  for (const p of errorPatterns) {
    if (html.toLowerCase().includes(p.toLowerCase())) {
      throw new ValidationError(`响应含错误文本: "${p}"`);
    }
  }
  
  // 检查 data-module-key
  const missingKeys = originalModules.filter(m => !html.includes(`data-module-key="${m}"`));
  if (missingKeys.length > 0) {
    html = this.injectMissingAttributes(html, missingKeys);
  }
  
  return html;
}
```

### 闸门3: 模块隔离

| 检查项 | 规则 | 失败处理 |
|--------|------|---------|
| 非目标模块 script | 内容与快照一致 | 用快照版本覆盖 |
| pages/state 定义 | `var pages = {...}` 完整 | 用快照版本覆盖 |
| 其他模块 HTML | 内容与修改前一致 | 快照回退 |

**实现位置**: `html-module-extractor.service.ts` — 合并时增加 `isolateModules()` 调用

```typescript
// 新增 ~20 行
private isolateModules(newHtml: string, snapshot: string, targetModuleKey: string): string {
  const snapshotModules = this.extractModules(snapshot);
  const newModules = this.extractModules(newHtml);
  
  // 非目标模块被污染 → 回退
  for (const [key, content] of Object.entries(snapshotModules)) {
    if (key !== targetModuleKey && newModules[key] !== content) {
      this.logger.warn(`模块 ${key} 被污染，回退到快照版本`);
      newHtml = this.replaceModule(newHtml, key, content);
    }
  }
  
  return newHtml;
}
```

### 闸门4: 功能验收

| 检查项 | 规则 | 失败处理 |
|--------|------|---------|
| 要求的关键词 | 修改需求的关键词出现在 HTML 中 | 强化Prompt重试 |
| 验收场景 | 规格中的场景可在 HTML 中验证 | 强化Prompt重试 |

**实现位置**: `demo-generator.service.ts` — 生成后增加 `validateAcceptance()` 调用

```typescript
// 通过 QualityGateService 的 checkAcceptanceScenarios() 复用
// 已存在于 quality-gate.service.ts 中
```

---

## 三、重试策略

```
retryLoop(prompt, maxRetries=3):
  for attempt in 1..maxRetries:
    response = deepseek.chat(prompt, { temperature: 0.3 + attempt*0.1 })
    
    validation = validateAllGates(response)
    
    if validation.passed:
      return response
    
    if attempt == 1:
      prompt = originalPrompt                          // 原Prompt重试
    elif attempt == 2:
      prompt = enhancePrompt(originalPrompt, validation.reason)  // 强化Prompt
    elif attempt == 3:
      return fallbackToCloudecodeDirect(originalPrompt)          // 降级
  
  return { status: 'NEEDS_HUMAN', reason: validation.reason }
```

**与现有 autoFix 的区别**:
- 现有 `autoFix()`: 自迭代评估中的修复（传感器发现→DeepSeek修复HTML）
- 新增自愈流水线: AI 响应产生时就质检+修复（在自迭代之前）

---

## 四、与现有系统集成

| 现有能力 | 自愈流水线中的角色 | 增强方式 |
|---------|-------------------|---------|
| `QualityGateService` (12项检查) | 闸门1部分检查 + 闸门4验收检查 | 新增 `validateContent()` `validateStructure()` |
| `DemoSnapshot` (版本快照) | 闸门3模块隔离回退 | 新增 `isolateModules()` |
| `autoFix()` (自迭代修复) | 闸门2修复能力复用 | 新增 `validateAndFixContent()` |
| `ErrorPattern` (11条模式) | 闸门1/2失败规则沉淀 | 新增 `STRUCTURE_INCOMPLETE` 等模式 |
| `SensorFusion` (传感器) | 闸门4复用L1/L3传感器结果 | 不变 |

---

## 五、改动范围

| 文件 | 改动 | 行数 |
|------|------|------|
| `deepseek.service.ts` | `validateStructure()` + `chat()` 集成 | +30 |
| `demo-generator.service.ts` | `validateAndFixContent()` + 重试循环 | +50 |
| `html-module-extractor.service.ts` | `isolateModules()` | +20 |
| `quality-gate.service.ts` | `validateStructure()` 扩展 | +30 |
| | **合计** | **~130 行** |

**不动**: 架构、API 接口、状态机、前端页面均不变。

---

## 六、与 Phase A 的协同

Phase A 和自愈流水线可以**并行执行**，不冲突:

| | 自愈流水线 | Phase A |
|---|---|---|
| 改动文件 | deepseek, demo-generator, html-extractor, quality-gate | delivery-evaluation, cloudecode |
| 作用层 | Demo HTML | 全栈代码 |
| 冲突点 | 无 — 改动完全不重叠 | |

**建议先执行自愈流水线**（改动小、风险低、立刻提升 Demo 质量），再执行 Phase A（改动大、需要更多测试）。

---

## 七、验证方案

1. 故意截断 DeepSeek 响应 → 验证闸门1触发重试
2. 注入错误文本到响应 → 验证闸门2检测并修复
3. 修改非目标模块 → 验证闸门3回退
4. 缺失功能实现 → 验证闸门4强化重试
5. 3次全部失败 → 验证 NEEDS_HUMAN 标记

---

## 八、效果评估

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| HTML 截断 | 用户看到乱码，手动重试 | 自动重试，用户无感 |
| 属性丢失 | 批注功能失效 | 自动补属性 |
| 模块污染 | 其他页面被改坏 | 自动回退到快照 |
| API 超时 | 报错"生成失败" | 自动重试 3 次，仍失败才通知 |
| Demo 可用率 | ~60% (需人工修复) | ~90% (自动修复) |
| 完整度提升 | — | **~72%**（与 Phase A 并行可达 ~78%）|

---

## 九、执行顺序建议

```
1. 自愈流水线 (本次) — 1天, ~130行, 4个文件
2. Phase A 分步生成 — 1天, 3个文件
3. Phase B Qwen交叉验证 — 1天, 3+1个文件
4. Phase C 在线部署 — 1天, 3+1个文件
```

**完整度演进**: 68.5% → (自愈) 72% → (Phase A) 78% → (Phase B) 82% → (Phase C) **85%**
