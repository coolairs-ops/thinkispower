/**
 * Cloudecode 代码执行引擎
 *
 * 内部服务 — 不直接面向普通用户
 * 接收 Pipeline 任务参数 → 构建 prompt → 调用 DeepSeek → 返回生成结果
 *
 * POST /execute
 *   body: { taskId, taskType, description, acceptanceCriteria?, demoHtml?, moduleKey?, constraints? }
 *   returns: { success, summary, publicSummary, result? }
 */

import express from 'express';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = parseInt(process.env.PORT || '5000', 10);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// ─── DeepSeek 调用 ───

async function callDeepSeek(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature = 0.3,
  maxTokens = 8192,
): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return JSON.stringify({
      needMoreInfo: true,
      question: '当前服务未配置 AI 密钥，请先设置环境变量。',
    });
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} ${body}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// ─── Prompt 构建 ───

const SYSTEM_PROMPTS: Record<string, string> = {
  html_modify: `你是一个前端开发工程师。根据任务描述，修改 Demo HTML 文件。

要求：
1. 保持单文件 HTML SPA 结构
2. 保持 data-module-key 和 data-element-path 属性
3. 保持 postMessage 通信机制
4. 保持导航切换方式（onclick + navigate()，不使用 hashchange）
5. **只修改目标模块的内容**，不要改动其他模块、侧边栏导航、样式、脚本
6. 不要改变无关模块的 render() 函数内容
7. 输出完整的 HTML，不要省略任何部分

直接输出 HTML（不要 markdown 包裹）。`,

  code_generate: `你是一个全栈软件工程师。根据项目需求和 Demo HTML，生成一个完整可运行的项目。

输出格式：用 markdown 代码块标记每个文件名，例如：

\`\`\`javascript:src/index.js
console.log('hello');
\`\`\`

\`\`\`json:package.json
{ "name": "my-app" }
\`\`\`

覆盖以下文件：
- index.html（主页面）
- package.json（项目配置）
- Dockerfile（多阶段构建）
- docker-compose.yml
- nginx.conf
- .gitignore
- README.md
- tests/smoke.test.js

确保所有代码完整、可运行、无占位符。`,

  export_schema: `你是一个数据库工程师。根据项目需求生成完整的数据库 Schema。
输出 SQL，包含：
- 所有表结构（CREATE TABLE），含主键、外键、索引
- 枚举类型（CREATE TYPE）
- 关系定义
- 字段默认值和非空约束

使用 PostgreSQL 语法。直接输出 SQL（不要 markdown 包裹）。`,

  export_deploy: `你是一个 DevOps 工程师。根据项目需求生成部署配置。
输出格式：对每个配置文件用 markdown 代码块标记文件名。

包含：
- Dockerfile（多阶段构建）
- docker-compose.yml（含数据库依赖）
- nginx.conf（反向代理配置）
- .env.example

直接输出配置内容，不要解释。`,
};

function buildUserMessage(params: {
  taskType: string;
  description: string;
  acceptanceCriteria?: string[];
  demoHtml?: string;
  moduleKey?: string;
  constraints?: string[];
}): string {
  const lines: string[] = [];

  if (params.moduleKey) {
    lines.push(`## 目标模块\n${params.moduleKey}`);
  }
  lines.push(`## 任务描述\n${params.description}`);

  if (params.acceptanceCriteria?.length) {
    lines.push(`## 验收标准\n${params.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`);
  }
  if (params.constraints?.length) {
    lines.push(`## 约束条件\n${params.constraints.map((c) => `- ${c}`).join('\n')}`);
  }
  if (params.demoHtml) {
    lines.push(`## 当前 HTML\n${params.demoHtml}`);
  }

  return lines.join('\n\n');
}

// ─── 结果解析 ───

function parseHtmlResult(response: string): { html?: string; error?: string } {
  const trimmed = response.trim();

  // Try ```html code block first
  const htmlMatch = trimmed.match(/```html\s*([\s\S]*?)\s*```/);
  if (htmlMatch) return { html: htmlMatch[1].trim() };

  // Try generic code block
  const codeMatch = trimmed.match(/```\s*([\s\S]*?)\s*```/);
  if (codeMatch) return { html: codeMatch[1].trim() };

  // Check if the response itself looks like HTML
  if (/^<!DOCTYPE|<html/i.test(trimmed)) return { html: trimmed };

  return { error: '未能从 AI 输出中提取有效 HTML' };
}

function parseMultiFileResult(response: string): { files: Array<{ path: string; content: string }>; error?: string } {
  const files: Array<{ path: string; content: string }> = [];
  // Match ```<language>:<filepath> blocks
  const blockRegex = /```(?:\w+)?:([^\n]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = blockRegex.exec(response)) !== null) {
    found = true;
    const path = match[1].trim();
    const content = match[2].trim();
    if (path && content) {
      files.push({ path, content });
    }
  }

  if (!found) {
    return { files: [], error: '未能从 AI 输出中解析出文件列表' };
  }
  return { files };
}

// ─── 路由 ───

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cloudecode' }));

/**
 * 标准执行入口
 * POST /execute
 *
 * 输入:
 *   taskId             - 任务 ID
 *   taskType           - html_modify | code_generate | export_schema | export_deploy
 *   description        - 任务描述
 *   acceptanceCriteria - 验收标准数组（可选）
 *   demoHtml           - 当前 Demo HTML（html_modify 时需要）
 *   moduleKey          - 目标模块（可选）
 *   constraints        - 约束条件（可选）
 *
 * 输出:
 *   success           - 是否成功
 *   summary           - 内部摘要
 *   publicSummary     - 用户可见摘要
 *   html              - 修改后的 HTML（html_modify 时）
 *   files             - 生成的文件列表（code_generate 时）
 *   changedFiles      - 变更文件列表
 */
app.post('/execute', async (req, res) => {
  const { taskId, taskType, description, acceptanceCriteria, demoHtml, moduleKey, constraints } = req.body;

  if (!taskId || !taskType || !description) {
    return res.status(400).json({
      success: false,
      summary: '缺少必要参数',
      publicSummary: '请求参数不完整，请检查后重试。',
    });
  }

  try {
    const systemPrompt = SYSTEM_PROMPTS[taskType] || SYSTEM_PROMPTS.html_modify;
    const userMessage = buildUserMessage({ taskType, description, acceptanceCriteria, demoHtml, moduleKey, constraints });

    console.log(`[Cloudecode] Executing task ${taskId}: ${taskType}`);

    const response = await callDeepSeek(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      0.3,
      8192,
    );

    // Parse result based on task type
    let html: string | undefined;
    let files: Array<{ path: string; content: string }> | undefined;
    let changedFiles: string[] = [];

    if (taskType === 'html_modify') {
      const parsed = parseHtmlResult(response);
      if (parsed.html) {
        html = parsed.html;
        changedFiles = ['index.html'];
      } else {
        console.warn(`[Cloudecode] Task ${taskId}: ${parsed.error}`);
      }
    } else {
      const parsed = parseMultiFileResult(response);
      if (parsed.files.length > 0) {
        files = parsed.files;
        changedFiles = parsed.files.map((f) => f.path);
      } else {
        console.warn(`[Cloudecode] Task ${taskId}: ${parsed.error}`);
      }
    }

    const success = !!(html || files);

    res.json({
      success,
      summary: success ? `Task ${taskId} (${taskType}) 执行完成` : `Task ${taskId} (${taskType}) 执行异常`,
      publicSummary: success ? '相关功能已更新，平台正在检查功能是否正常。' : '平台处理该功能时遇到问题，正在自动修复。',
      html,
      files,
      changedFiles,
      notes: [],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Cloudecode] Task ${taskId} failed:`, msg);

    res.json({
      success: false,
      summary: `Task ${taskId} failed: ${msg}`,
      publicSummary: '平台处理该功能时遇到问题，正在自动修复。',
      rawError: msg,
    });
  }
});

app.listen(PORT, () => console.log(`Cloudecode running on port ${PORT}`));
