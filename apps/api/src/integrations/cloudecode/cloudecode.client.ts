import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';

/** 所有代码生成 prompt 的公共前缀 — 强制要求文件路径标记 */
const FILE_PATH_REQUIREMENT = `【重要】每个文件必须用 \`\`\`文件路径 格式标记（不要用语言名）。正确格式：\`\`\`backend/src/user/user.service.ts\n内容\n\`\`\`。错误格式：\`\`\`typescript （会被丢弃）。\n`;

const HTML_MODIFICATION_PROMPT = `你是一个前端开发工程师。根据任务描述，生成/修改 Demo HTML 文件。

要求：
1. 单文件 HTML SPA，左侧导航 + 右侧内容区
2. 每个交互元素必须标注 data-module-key 和 data-element-path：
   - 按钮：{key} data-element-path="add-btn"、"save-btn"、"delete-btn"
   - 输入框：data-element-path="search-input"、"name-input"
   - 表格行/单元格：data-element-path="row-1"、"col-name"
   - 卡片/统计块：data-element-path="card-1"、"stat-total"
   - **不要把 data-module-key 挂在整页容器上，挂到具体可操作元素上**
   - **导航菜单项不要加 data-module-key**
3. 保持 onclick + navigate() 导航方式
4. 输出完整 HTML，不要 markdown 包裹`;

@Injectable()
export class CloudecodeClient {
  private readonly logger = new Logger(CloudecodeClient.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private deepseek: DeepseekService,
    private demoSnapshotService: DemoSnapshotService,
    private htmlExtractor: HtmlModuleExtractorService,
  ) {}

  async executeTask(taskId: string): Promise<{
    success: boolean;
    summary?: string;
    changedFiles?: string[];
    rawError?: string;
  }> {
    this.logger.log(`Cloudecode executing task ${taskId}`);

    try {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { project: { select: { demoHtml: true, id: true } } },
      });
      if (!task || !task.project) {
        return { success: false, rawError: `Task ${taskId} not found` };
      }

      const project = task.project;

      // 如果还没有 demoHtml，则是首次 Demo 生成 → 改用 HTML 生成 prompt
      if (!project.demoHtml && task.type === 'frontend') {
        return this.generateDemoHtml(task, project);
      }

      if (!project.demoHtml) {
        return { success: false, rawError: 'No demo HTML found for project' };
      }

      const moduleKey = (task.inputPayload as any)?.moduleKey as string | undefined;
      const elementPath = (task.inputPayload as any)?.elementPath as string | undefined;

      // 如果有 moduleKey，使用精简 HTML（只保留目标模块完整 render 内容）
      const [htmlForPrompt, actualModuleKey] = moduleKey
        ? [this.htmlExtractor.buildCondensedHtml(project.demoHtml, moduleKey), moduleKey]
        : [project.demoHtml, undefined];

      const userMessage = this.buildUserMessage(task.description, task.inputPayload, htmlForPrompt, actualModuleKey, elementPath);

      const response = await this.deepseek.chat(
        [
          { role: 'system', content: HTML_MODIFICATION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.3, maxTokens: 8192 },
      );

      const modifiedHtml = this.extractHtml(response);
      if (!modifiedHtml) {
        return { success: false, rawError: 'Failed to extract HTML from DeepSeek response' };
      }

      // Save pre-modification snapshot
      await this.demoSnapshotService.createSnapshot(
        project.id,
        project.demoHtml,
        'pipeline_execute',
        taskId,
      );

      // 如果有 moduleKey，将修改后的模块内容合并回原始 HTML
      const finalHtml = actualModuleKey
        ? this.htmlExtractor.mergeModuleContent(project.demoHtml, modifiedHtml, actualModuleKey)
        : modifiedHtml;

      await this.prisma.project.update({
        where: { id: project.id },
        data: { demoHtml: finalHtml },
      });

      this.logger.log(
        actualModuleKey
          ? `模块 ${actualModuleKey} 修改完成，合并回原始 HTML`
          : `全量 HTML 替换完成 (${finalHtml.length} bytes)`,
      );

      return {
        success: true,
        summary: `Task "${task.title}" completed: demo HTML updated`,
        changedFiles: ['demo.html'],
      };
    } catch (error) {
      this.logger.error(`Cloudecode task ${taskId} failed`, error);
      return {
        success: false,
        rawError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 首次 Demo 生成 — 从 plan 信息生成完整 HTML（无需 Task，供 DemoService 直调）。
   */
  async generateDemoHtmlDirect(projectId: string, planSummary: any): Promise<{
    success: boolean;
    summary?: string;
    rawError?: string;
  }> {
    this.logger.log(`Cloudecode directly generating demo HTML for project ${projectId}`);

    const pages = Array.isArray(planSummary.pages) ? planSummary.pages : ['首页', '列表页'];
    const features = Array.isArray(planSummary.features) ? planSummary.features : [];
    const name = planSummary.summary || '应用';

    const prompt = `## 项目\n${name}\n\n## 页面\n${pages.map((p: string) => `- ${p}`).join('\n')}\n\n## 功能\n${features.map((f: string) => `- ${f}`).join('\n')}\n\n生成包含所有页面的完整 SPA HTML 预览。`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: HTML_MODIFICATION_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 8192 },
    );

    const html = this.extractHtml(response);
    if (!html) {
      return { success: false, rawError: 'Failed to extract HTML from DeepSeek response' };
    }

    const finalHtml = this.injectAnnotationSupport(html);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: finalHtml, demoUrl: `/demo/${projectId}`, status: 'demo_ready', publicStatusLabel: '预览已生成' },
    });

    this.logger.log(`Demo HTML direct generated for project ${projectId}: ${finalHtml.length} bytes`);
    return { success: true, summary: 'Demo HTML generated' };
  }

  /** @deprecated 保留兼容 Pipeline（通过 executeTask 首次生成），新链路请用 generateDemoHtmlDirect */
  private async generateDemoHtml(task: any, project: any): Promise<{
    success: boolean;
    summary?: string;
    changedFiles?: string[];
    rawError?: string;
  }> {
    this.logger.log(`Cloudecode generating demo HTML for project ${project.id}`);

    const planSummary = (task.inputPayload as any)?.planSummary || {};
    const pages = Array.isArray(planSummary.pages) ? planSummary.pages : ['首页', '列表页'];
    const features = Array.isArray(planSummary.features) ? planSummary.features : [];
    const name = planSummary.summary || '应用';

    const prompt = `## 项目\n${name}\n\n## 页面\n${pages.map((p: string) => `- ${p}`).join('\n')}\n\n## 功能\n${features.map((f: string) => `- ${f}`).join('\n')}\n\n生成包含所有页面的完整 SPA HTML 预览。`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: HTML_MODIFICATION_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 8192 },
    );

    const html = this.extractHtml(response);
    if (!html) {
      return { success: false, rawError: 'Failed to extract HTML from DeepSeek response' };
    }

    // 注入批注高亮支持（AI 生成的 HTML 缺少这部分）
    const finalHtml = this.injectAnnotationSupport(html);

    await this.prisma.project.update({
      where: { id: project.id },
      data: { demoHtml: finalHtml, demoUrl: `/demo/${project.id}`, status: 'demo_ready' },
    });

    this.logger.log(`Demo HTML generated for project ${project.id}: ${finalHtml.length} bytes`);
    return { success: true, summary: 'Demo HTML generated', changedFiles: ['demo.html'] };
  }

  /**
   * 注入批注高亮 CSS + 消息监听器到 AI 生成的 HTML。
   * AI 不会自动生成这部分，需要后处理补上。
   */
  private injectAnnotationSupport(html: string): string {
    const highlightCss = `
.annotation-highlight { outline: 3px solid #3b82f6 !important; outline-offset: 2px; background: rgba(59,130,246,.08) !important; border-radius: 4px; }`;

    const highlightJs = `
// 批注模式：点击元素 → 通知父窗口
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-module-key]');
  if (el) {
    window.parent.postMessage({
      type: 'element-click',
      moduleKey: el.getAttribute('data-module-key'),
      elementPath: el.getAttribute('data-element-path') || ''
    }, '*');
  }
});

// 批注模式：接收父窗口的高亮/取消高亮指令
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'highlight-element') {
    document.querySelectorAll('.annotation-highlight').forEach(function(el) { el.classList.remove('annotation-highlight'); });
    var sel = '[data-module-key="' + e.data.moduleKey + '"]';
    if (e.data.elementPath) sel += '[data-element-path="' + e.data.elementPath + '"]';
    var t = document.querySelector(sel);
    if (t) { t.classList.add('annotation-highlight'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  } else if (e.data && e.data.type === 'clear-highlight') {
    document.querySelectorAll('.annotation-highlight').forEach(function(el) { el.classList.remove('annotation-highlight'); });
  }
});`;

    // 注入 CSS 到 </style> 或 </head> 前
    if (html.includes('</style>')) {
      html = html.replace('</style>', highlightCss + '\n</style>');
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', '<style>' + highlightCss + '\n</style>\n</head>');
    }

    // 注入 JS 到最后一个 </script> 前
    const lastScript = html.lastIndexOf('</script>');
    if (lastScript > 0) {
      html = html.slice(0, lastScript) + highlightJs + '\n' + html.slice(lastScript);
    } else if (html.includes('</body>')) {
      html = html.replace('</body>', '<script>' + highlightJs + '\n</script>\n</body>');
    }

    return html;
  }

  private buildUserMessage(
    description: string,
    inputPayload: any,
    html: string,
    moduleKey?: string,
    elementPath?: string,
  ): string {
    const lines: string[] = [];

    if (moduleKey) {
      lines.push(`## 目标模块\n${moduleKey}`);
    }
    if (elementPath) {
      lines.push(`## 目标元素\n${elementPath}`);
    }

    lines.push(
      `## 任务描述`,
      description,
      ``,
      `## 验收标准`,
      (inputPayload as any)?.acceptanceCriteria?.map((c: string) => `- ${c}`).join('\n') || '无',
      ``,
      `## 当前 HTML`,
      html,
    );

    return lines.join('\n');
  }

  /**
   * 为导出任务生成资产内容（仓库代码/数据库 SQL/部署配置）。
   */
  async generateAsset(
    taskType: string,
    project: { planSummary?: string | null; structuredRequirement?: any; demoHtml?: string | null },
  ): Promise<{ content: string; fileName: string; contentType: string }> {
    const configs: Record<string, { system: string; fileName: string; contentType: string }> = {
      export_repository: {
        system: `你是一个软件工程师。根据项目需求生成一个完整的 Git 仓库初始化文件集。
输出格式：对每个文件用 markdown 代码块标记文件名，例如：

\`\`\`markdown:README.md
# 项目名称
...
\`\`\`

\`\`\`javascript:package.json
...
\`\`\`

包含：README.md、package.json、src/index.js（或主入口）、.gitignore。
确保代码可运行、完整、无占位符。`,
        fileName: 'repository-files.md',
        contentType: 'text/markdown; charset=utf-8',
      },
      export_database_schema: {
        system: `你是一个数据库工程师。根据项目需求生成完整的数据库 Schema。
输出 SQL，包含：
- 所有表结构（CREATE TABLE），含主键、外键、索引
- 枚举类型（CREATE TYPE）
- 关系定义
- 字段默认值和非空约束

使用 PostgreSQL 语法。直接输出 SQL（不要 markdown 包裹）。`,
        fileName: 'schema.sql',
        contentType: 'text/plain; charset=utf-8',
      },
      export_deployment_config: {
        system: `你是一个 DevOps 工程师。根据项目需求生成部署配置。
输出格式：对每个配置文件用 markdown 代码块标记文件名。

包含：
- Dockerfile（多阶段构建）
- docker-compose.yml（含数据库依赖）
- nginx.conf（反向代理配置）
- .env.example

直接输出配置内容，不要解释。`,
        fileName: 'deployment-config.md',
        contentType: 'text/markdown; charset=utf-8',
      },
    };

    const config = configs[taskType];
    if (!config) {
      throw new Error(`Unknown export task type: ${taskType}`);
    }

    const planSummary = project.planSummary || '无';
    const structuredReq = project.structuredRequirement
      ? JSON.stringify(project.structuredRequirement, null, 2)
      : '无';

    const userMessage = `## 项目概要\n${planSummary}\n\n## 需求文档\n${structuredReq}`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: config.system },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3, maxTokens: 4096 },
    );

    return {
      content: response || '# 生成失败（API 返回空）',
      fileName: config.fileName,
      contentType: config.contentType,
    };
  }

  /**
   * 生成完整项目结构（多文件），替代仅优化单个 HTML。
   * 返回文件列表，由调用方打包为 zip。
   */
  async generateProject(
    project: { name?: string; demoHtml?: string | null; planSummary?: any; structuredRequirement?: any },
  ): Promise<Array<{ path: string; content: string }>> {
    const projectName = this.sanitizeProjectName(project.name || 'my-app');
    const demoHtml = project.demoHtml || '<!DOCTYPE html><html><head><title>App</title></head><body><p>No content</p></body></html>';
    const planSummary = project.planSummary || {};

    const files: Array<{ path: string; content: string }> = [];

    // 1. index.html — 核心 Demo
    files.push({ path: 'index.html', content: demoHtml });

    // 2. package.json
    files.push({
      path: 'package.json',
      content: JSON.stringify({
        name: projectName,
        version: '1.0.0',
        description: typeof planSummary === 'object' && planSummary.summary ? planSummary.summary : 'Generated by Think-is-power',
        scripts: {
          start: 'npx serve . -p 3000 -s',
          dev: 'npx serve . -p 3000 -s -l 3000',
          test: 'node tests/smoke.test.js',
          build: 'echo "Static HTML, no build needed"',
        },
        devDependencies: { serve: '^14.2.0' },
      }, null, 2),
    });

    // 3. README.md
    const summaryText = typeof planSummary === 'object' ? (planSummary as any).summary || '' : '';
    files.push({
      path: 'README.md',
      content: `# ${projectName}

${summaryText || '该项目由 Think-is-power 平台自动生成。'}

## 快速启动

\`\`\`bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
\`\`\`

打开浏览器访问 http://localhost:3000

## 部署

\`\`\`bash
# 使用 Docker
docker compose up -d
\`\`\`

## 项目结构

- \`index.html\` — 主页面（单页应用）
- \`package.json\` — 项目配置
- \`Dockerfile\` — 生产部署镜像
- \`docker-compose.yml\` — Docker 编排
- \`nginx.conf\` — Nginx 反向代理配置
- \`tests/smoke.test.js\` — 冒烟测试
`,
    });

    // 4. .gitignore
    files.push({
      path: '.gitignore',
      content: `node_modules/
dist/
.env
*.log
.DS_Store
`,
    });

    // 5. Dockerfile
    files.push({
      path: 'Dockerfile',
      content: `FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`,
    });

    // 6. nginx.conf
    files.push({
      path: 'nginx.conf',
      content: `server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`,
    });

    // 7. docker-compose.yml
    files.push({
      path: 'docker-compose.yml',
      content: `version: '3.8'
services:
  app:
    build: .
    ports:
      - "80:80"
    restart: unless-stopped
`,
    });

    // 8. tests/smoke.test.js
    files.push({
      path: 'tests/smoke.test.js',
      content: `// Basic smoke test — verifies the app starts and responds
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function check() {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const passed = res.statusCode === 200 && data.includes('<!DOCTYPE');
        console.log(passed ? '✓ Smoke test passed' : '✗ Smoke test failed');
        process.exit(passed ? 0 : 1);
      });
    }).on('error', (err) => {
      console.error('✗ Connection failed:', err.message);
      process.exit(1);
    });
  });
}

check();
`,
    });

    return files;
  }

  private sanitizeProjectName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'my-app';
  }

  private extractHtml(response: string): string | null {
    const htmlMatch = response.match(/```html\s*([\s\S]*?)\s*```/);
    if (htmlMatch) return htmlMatch[1].trim();

    const codeMatch = response.match(/```\s*([\s\S]*?)\s*```/);
    if (codeMatch) return codeMatch[1].trim();

    if (response.includes('<html') || response.includes('<!DOCTYPE')) {
      return response.trim();
    }

    return null;
  }

  /** 直接修改 Demo HTML — 绕过 Pipeline，供评估页调用 */
  async executeTaskForProject(projectId: string, fixDescription: string): Promise<{ success: boolean }> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true },
      });
      if (!project?.demoHtml) return { success: false };

      const prompt = `修改以下HTML Demo：\n\n修改需求：${fixDescription}\n\n只修改相关部分，保持其他内容不变。输出完整的修改后HTML。\n\n原始HTML：\n${project.demoHtml.slice(0, 20000)}`;

      const response = await this.deepseek.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 16384 }
      );

      const newHtml = this.extractHtml(response);
      if (!newHtml) return { success: false };

      await this.prisma.project.update({
        where: { id: projectId },
        data: { demoHtml: newHtml, status: 'demo_ready' },
      });

      this.logger.log(`Demo修改完成(${projectId}): ${project.demoHtml.length}→${newHtml.length} bytes`);
      return { success: true };
    } catch (e) {
      this.logger.error(`Demo修改失败: ${e}`);
      return { success: false };
    }
  }

  /** 全栈交付 — 生成完整可运行项目代码（降级路径，主路径使用分步生成） */
  async deliverFullstack(projectId: string, opts: { projectName: string; planSummary: any; demoHtml: string }) {
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${opts.projectName}"生成完整的全栈可运行代码。

计划：${JSON.stringify(opts.planSummary || {}).substring(0, 1500)}
Demo HTML：${opts.demoHtml.substring(0, 1500)}

必须输出以下文件内容，用 \`\`\`文件路径 标记每个文件：
1. database/schema.sql
2. backend/src/index.ts
3. backend/src/routes/ — 所有 API 路由
4. backend/package.json
5. frontend/index.html
6. docker-compose.yml
7. README.md

每个文件必须是完整可运行代码。`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 16384, timeoutMs: 180_000 },
    );

    const files = this.parseFiles(response);
    this.logger.log(`全栈交付(${projectId}): ${files.length} 个文件`);
    return { files, success: files.length > 0 };
  }

  // ═══ Phase A: 分步代码生成 ═══

  /** Step 1: 生成数据库 Schema */
  async generateSchema(projectId: string, payload: { projectName: string; planSummary: any; structuredRequirement?: any }): Promise<{ path: string; content: string } | null> {
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成 PostgreSQL schema.sql。

数据模型: ${JSON.stringify((payload.structuredRequirement as any)?.dataModels || payload.planSummary?.dataObjects || [])}
功能列表: ${JSON.stringify(payload.planSummary?.features || [])}

要求:
- PostgreSQL 16 语法
- 所有表用 UUID 主键: id UUID DEFAULT gen_random_uuid() PRIMARY KEY
- 包含 created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ
- 外键用 REFERENCES
- 用 \`\`\`database/schema.sql 包裹全部 SQL`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000 },
    );
    const match = response.match(/```sql\s*([\s\S]*?)```/) || response.match(/(CREATE\s+TABLE[\s\S]*)/i);
    if (!match) return null;
    return { path: 'database/schema.sql', content: match[1].trim() };
  }

  /** Step 2: 生成后端 API */
  async generateBackend(projectId: string, payload: { projectName: string; planSummary: any; schemaSql?: string }): Promise<Array<{ path: string; content: string }>> {
    const schemaCtx = payload.schemaSql ? `\n数据库 Schema:\n\`\`\`sql\n${payload.schemaSql}\n\`\`\`\n` : '';
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成 NestJS + Prisma 后端代码。${schemaCtx}
功能: ${JSON.stringify(payload.planSummary?.features || [])}
页面: ${JSON.stringify(payload.planSummary?.pages || [])}
角色: ${JSON.stringify(payload.planSummary?.roles || [])}

输出以下文件(每个用 \`\`\`文件路径 标记，路径必须以 backend/ 开头):
1. backend/package.json
2. backend/tsconfig.json
3. backend/src/main.ts
4. backend/src/app.module.ts
5. backend/prisma/schema.prisma
6. backend/src/modules/ — 每个功能一个模块目录，每个模块包含 controller + service + module 三文件

每个文件完整可运行。`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 16384, timeoutMs: 120_000 },
    );
    return this.parseFiles(response);
  }

  /** Step 3: 生成前端 */
  async generateFrontend(projectId: string, payload: { projectName: string; planSummary: any; demoHtml?: string; backendRoutes?: string[] }): Promise<Array<{ path: string; content: string }>> {
    const routesCtx = payload.backendRoutes?.length ? `\nAPI 端点:\n${payload.backendRoutes.join('\n')}\n` : '';
    const demoCtx = payload.demoHtml ? `\nDemo HTML 结构:\n${payload.demoHtml.substring(0, 2500)}\n` : '';
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成 Next.js 14 前端代码。${routesCtx}${demoCtx}
页面: ${JSON.stringify(payload.planSummary?.pages || [])}

输出以下文件(每个用 \`\`\`文件路径 标记，路径必须以 frontend/ 开头):
1. frontend/package.json
2. frontend/tsconfig.json
3. frontend/src/app/layout.tsx
4. frontend/src/app/page.tsx
5. frontend/src/app/ — 每个页面对应路由，使用正确目录结构（如 frontend/src/app/users/page.tsx）

每个文件完整可运行。`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 16384, timeoutMs: 120_000 },
    );
    return this.parseFiles(response);
  }

  /** Step 4: 生成集成配置 */
  async generateIntegration(projectId: string, payload: { projectName: string; planSummary: any; filePaths?: string[] }): Promise<Array<{ path: string; content: string }>> {
    const filesCtx = payload.filePaths?.length ? `\n已生成文件:\n${payload.filePaths.join('\n')}\n` : '';
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成部署配置文件。${filesCtx}
输出以下文件(每个用 \`\`\`文件路径 标记):
1. Dockerfile — 多阶段构建
2. docker-compose.yml — 前端+后端+数据库
3. nginx.conf — 反向代理
4. .gitignore
5. README.md — 含启动步骤`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 8192, timeoutMs: 90_000 },
    );
    return this.parseFiles(response);
  }

  /** 
   * 通用的文件解析器 — 智能推断文件路径。
   * 当 DeepSeek 返回语言名（如 typescript）而非路径时，分析内容推断真实路径。
   */
  private parseFiles(response: string): Array<{ path: string; content: string }> {
    const filePattern = /```(\S+)\s*\n([\s\S]*?)```/g;
    const files: Array<{ path: string; content: string }> = [];
    const generatedFiles = new Set<string>();
    let match;
    let unnamedIdx = 0;
    while ((match = filePattern.exec(response)) !== null) {
      let filePath = match[1].trim();
      const content = match[2].trim();
      if (filePath.length < 2 || filePath.length > 80) continue;
      
      // 已有正确路径（含 / 或 .）→ 直接使用
      if (filePath.includes('/') || filePath.includes('.')) {
        // 去重：同一路径可能因 token 边界重复
        const dedupKey = filePath;
        if (generatedFiles.has(dedupKey)) continue;
        generatedFiles.add(dedupKey);
        files.push({ path: filePath, content });
        continue;
      }
      
      // 语言名标记 → 内容分析推断路径
      const inferred = this.inferFilePath(filePath.toLowerCase(), content, unnamedIdx);
      const dedupKey = inferred;
      if (generatedFiles.has(dedupKey)) continue;
      generatedFiles.add(dedupKey);
      files.push({ path: inferred, content });
      unnamedIdx++;
    }
    return files;
  }

  /** 根据内容推断文件真实路径 */
  private inferFilePath(lang: string, content: string, idx: number): string {
    // ─── SQL → database/schema.sql ───
    if (lang === 'sql' || lang === 'pgsql' || lang === 'plsql') {
      if (content.match(/CREATE\s+(TABLE|TYPE|INDEX|SEQUENCE|TRIGGER)/i)) {
        return 'database/schema.sql';
      }
      return `database/migration_${idx + 1}.sql`;
    }

    // ─── JSON ───
    if (lang === 'json') {
      if (content.includes('"scripts"') && content.includes('"dependencies"')) {
        // package.json → 根据依赖判断前后端
        if (content.includes('next') || content.includes('react')) return 'frontend/package.json';
        if (content.includes('@nestjs') || content.includes('express') || content.includes('prisma')) return 'backend/package.json';
        // 看引用路径
        if (content.includes('frontend') || content.includes('.tsx')) return 'frontend/package.json';
        return 'backend/package.json';
      }
      if (content.includes('"compilerOptions"')) {
        if (content.includes('"jsx"')) return 'frontend/tsconfig.json';
        return 'backend/tsconfig.json';
      }
      return `config/json_${idx + 1}.json`;
    }

    // ─── TypeScript/JavaScript ───
    if (lang === 'typescript' || lang === 'ts' || lang === 'javascript' || lang === 'js') {
      // NestJS 模块文件
      if (content.includes('@Module') || content.includes('@Injectable') || content.includes('@Controller')) {
        const module = this.extractModuleName(content) || 'app';
        if (content.includes('@Controller')) {
          return `backend/src/modules/${module}/${module}.controller.ts`;
        }
        if (content.includes('@Injectable') && (content.includes('Service') || content.includes('Repository'))) {
          return `backend/src/modules/${module}/${module}.service.ts`;
        }
        if (content.includes('@Module')) {
          return `backend/src/modules/${module}/${module}.module.ts`;
        }
        return `backend/src/modules/${module}/${module}.ts`;
      }
      // Express 路由
      if (content.includes('express.Router') || content.match(/router\.(get|post|put|delete|patch)/)) {
        return `backend/src/routes/${this.extractRouteName(content) || `route_${idx + 1}`}.ts`;
      }
      // DTO
      if (content.includes('class-validator') || content.includes('IsString') || content.includes('IsNotEmpty')) {
        const dtoName = this.extractDtoName(content) || `dto_${idx + 1}`;
        return `backend/src/modules/${dtoName}/dto/${dtoName}.dto.ts`;
      }
      // Prisma schema
      if (content.includes('datasource db') || content.includes('generator client')) {
        return 'backend/prisma/schema.prisma';
      }
      // Prisma service
      if (content.includes('PrismaClient') || content.includes('this.prisma')) {
        return 'backend/src/prisma/prisma.service.ts';
      }
      // main 入口
      if (content.includes('NestFactory') || content.includes('bootstrap')) {
        return 'backend/src/main.ts';
      }
      if (content.includes('app.listen') || content.includes('express()')) {
        return 'backend/src/index.ts';
      }
      // app module
      if (content.includes('AppModule') && content.includes('imports:')) {
        return 'backend/src/app.module.ts';
      }
      // 泛型后端文件
      if (content.includes('import') && !content.includes('React') && !content.includes('useState')) {
        const name = this.extractClassName(content) || `module_${idx + 1}`;
        return `backend/src/${name.toLowerCase()}.ts`;
      }
      // 默认 → 后端
      return `backend/src/file_${idx + 1}.ts`;
    }

    // ─── JSX / React ───
    if (lang === 'jsx' || lang === 'tsx') {
      // 页面/路由文件
      if (content.includes('export default function') || content.includes('export default async function')) {
        const pagePath = this.extractPageRoute(content) || `page_${idx + 1}`;
        return `frontend/src/app/${pagePath}/page.tsx`;
      }
      // 组件
      if (content.includes('export') && (content.includes('function') || content.includes('const'))) {
        const compName = this.extractComponentName(content) || `Component${idx + 1}`;
        return `frontend/src/components/${compName}.tsx`;
      }
      // layout
      if (content.includes('children') && content.includes('html')) {
        return 'frontend/src/app/layout.tsx';
      }
      return `frontend/src/app/page_${idx + 1}.tsx`;
    }

    // ─── CSS / Style ───
    if (lang === 'css' || lang === 'scss') {
      if (content.includes('.module')) {
        return `frontend/src/app/globals.css`;
      }
      return `frontend/src/styles/style_${idx + 1}.css`;
    }

    // ─── HTML ───
    if (lang === 'html') {
      if (content.includes('<html') || content.includes('<!DOCTYPE')) {
        return 'frontend/public/index.html';
      }
      return `frontend/src/app/page_${idx + 1}.html`;
    }

    // ─── YAML / Docker ───
    if (lang === 'yaml' || lang === 'yml') {
      if (content.includes('services:') && content.includes('build:')) return 'docker-compose.yml';
      if (content.includes('stages:') || content.includes('script:')) return '.gitlab-ci.yml';
      return `config/config_${idx + 1}.yml`;
    }

    // ─── Dockerfile ───
    if (lang === 'dockerfile' || lang === 'docker') {
      return 'Dockerfile';
    }

    // ─── nginx config ───
    if (lang === 'nginx') {
      return 'nginx.conf';
    }

    // ─── bash / shell ───
    if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      if (content.includes('npm run') || content.includes('docker')) return 'scripts/deploy.sh';
      if (content.includes('migration') || content.includes('prisma')) return 'scripts/migrate.sh';
      return `scripts/script_${idx + 1}.sh`;
    }

    // ─── Markdown ───
    if (lang === 'markdown' || lang === 'md') {
      if (content.includes('# ') && content.includes('## ')) return 'README.md';
      return `docs/doc_${idx + 1}.md`;
    }

    // ─── ENV ───
    if (lang === 'env' || lang === 'dotenv') {
      return '.env.example';
    }

    // ─── Prisma schema ───
    if (lang === 'prisma') {
      return 'backend/prisma/schema.prisma';
    }

    // 兜底
    const extMap: Record<string, string> = {
      'python': '.py', 'rust': '.rs', 'go': '.go', 'java': '.java',
      'xml': '.xml', 'graphql': '.graphql', 'toml': '.toml',
    };
    const ext = extMap[lang] || '.txt';
    return `generated/file_${idx + 1}${ext}`;
  }

  private extractModuleName(content: string): string | null {
    const m = content.match(/export\s+class\s+(\w+)(Controller|Service|Module|Repository)/);
    if (m) return m[1].replace(/(Controller|Service|Module|Repository)$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return null;
  }

  private extractClassName(content: string): string | null {
    const m = content.match(/(?:export\s+)?(?:class|interface|type)\s+(\w+)/);
    return m ? m[1] : null;
  }

  private extractComponentName(content: string): string | null {
    const m = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)/);
    if (m) return m[1];
    const arrow = content.match(/(?:export\s+)?(?:default\s+)?const\s+(\w+)\s*=/);
    return arrow ? arrow[1] : null;
  }

  private extractPageRoute(content: string): string | null {
    // 从函数名推断路由：UserPage → user
    const m = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)Page/);
    if (m) return m[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    const m2 = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)/);
    if (m2 && m2[1] !== 'Home') return m2[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return null;
  }

  private extractRouteName(content: string): string | null {
    const m = content.match(/router\.(?:get|post|put|delete|patch)\s*\(\s*['"`]\/?(?:api\/)?(\w+)/);
    return m ? m[1] : null;
  }

  private extractDtoName(content: string): string | null {
    const m = content.match(/export\s+class\s+(\w+)Dto/);
    if (m) return m[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return null;
  }
}
