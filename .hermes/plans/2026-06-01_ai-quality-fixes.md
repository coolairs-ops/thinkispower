# 平台可解决的 AI 生成质量问题 评估

**日期**: 2026-06-01

---

## 一、分类总览

共 18 类问题，其中 **15 类平台可解**，3 类依赖外部。

---

## 二、平台可解决（15类）— 按修复层面分组

### A 层：响应提取与校验（已有基础，增强即可）

| # | 问题 | 平台解法 | 改动点 |
|---|------|----------|--------|
| 1 | HTML片段不完整 | 校验 `<!DOCTYPE` + `</html>` 完整性，不完整则重试 | `deepseek.service.ts` chat() 后置校验 |
| 2 | 代码块混入markdown | 增强 `extractHtml()` 清洗逻辑：去 ```html 标记、去首尾空白 | `cloudecode.client.ts` extractHtml |
| 3 | 文档头丢失 | 合并时保留原始 `<head>` 内容作为兜底 | `demo-generator.service.ts` merge逻辑 |
| 16 | 输出截断(max_tokens) | 提高到 32768 | `deepseek.service.ts` DeepseekOptions |
| 17 | 返回错误信息而非HTML | 校验响应是否含 HTML 标签，非HTML则重试 | `cloudecode.client.ts` |
| 18 | 超时响应不完整 | 已有 timeout+retry，加 backoff | `deepseek.service.ts` |

### B 层：合并逻辑与模块隔离（需加强）

| # | 问题 | 平台解法 | 改动点 |
|---|------|----------|--------|
| 4 | 误删pages定义 | 合并前备份 script 中的已知变量名，合并后校验 | `html-module-extractor.service.ts` |
| 5 | script标签被覆盖 | 合并时保护 `<script>` 块，只替换目标模块HTML | 同上 |
| 7 | 压缩时模块变占位符 | 正则 `moduleKey` 匹配修复，加前后断言避免误匹配 | 同上 |
| 8 | moduleKey匹配失败 | 增强正则：`data-module-key="([^"]+)"` | 同上 |
| 14 | 合并写入其他模块 | 严格限定替换范围：只改匹配到的 module container | 同上 |

### C 层：属性注入与批注保障（关键修复）

| # | 问题 | 平台解法 | 改动点 |
|---|------|----------|--------|
| 10 | 删除已有data属性 | 合并后扫描：无 `data-module-key` 的元素自动补 | `demo-generator.service.ts` 后处理 |
| 11 | 新增元素无data属性 | 同上，新元素注入 `data-module-key` | 同上 |
| 12 | 模板重构遗漏属性 | 模板注入时强制带属性 | `enterprise-template` 逻辑 |

### D 层：Prompt 工程与模型约束（即时生效）

| # | 问题 | 平台解法 | 改动点 |
|---|------|----------|--------|
| 13 | 修改全局样式/脚本 | Prompt 加硬约束：「只修改标记模块内的HTML，不要改任何style/script」 | `cloudecode.client.ts` executeTaskForProject |
| 15 | 模型自行"优化" | Prompt 加：「严格遵守，不要添加未要求的功能，不要重构代码结构」 | 同上 |
| 19 | 理解偏差 | Prompt 加验收标准字段 | 同上 |
| 20 | 修改范围不够 | Prompt 明确：「修改所有相关部分，不只是表面文案」 | 同上 |
| 21 | 方案描述模糊 | 方案生成时要求逐项具体描述 | `plan-generator.service.ts` |

---

## 三、平台不可解（3类）

| # | 问题 | 原因 |
|---|------|------|
| 23 | 网络不稳定 | 外部网络环境，平台只能加重试 |
| 24 | API限流/故障 | DeepSeek 服务端行为 |
| 26-28 | 报表统计复杂度 | 业务需求层面，需用户输入，非技术问题 |

---

## 四、改动文件清单

| 文件 | 改动类型 | 影响 |
|------|----------|------|
| `deepseek.service.ts` | max_tokens ↑, 响应校验, backoff | 全局 |
| `cloudecode.client.ts` | extractHtml增强, Prompt加固 | Demo生成/修复 |
| `demo-generator.service.ts` | 合并逻辑修复, data属性注入 | Demo质量 |
| `html-module-extractor.service.ts` | 正则修复, script保护 | 模块提取 |
| `plan-generator.service.ts` | Prompt具体化 | 方案质量 |

共 **5 个文件**，改动集中在已有服务层，不动架构。

---

## 五、优先级

| 优先级 | 层级 | 原因 |
|--------|------|------|
| 🔴 P0 | D层 Prompt | 最小改动，最大效果——约束模型行为 |
| 🔴 P0 | C层 属性注入 | 批注功能是核心闭环，属性缺失导致反馈失效 |
| 🟡 P1 | A层 响应校验 | 已有基础，增强重试逻辑 |
| 🟡 P1 | B层 合并隔离 | 修复正则和script保护 |
| 🟢 P2 | A层 max_tokens | 简单参数调整 |

---

## 六、结论

**15/18 类问题平台可解**，改动集中在5个已有文件，**不动架构，不新增服务**。

最关键的是 D层 Prompt约束 + C层 属性注入——这两项改动即可解决 🔴 标注的 9 个核心问题。
