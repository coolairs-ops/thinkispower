import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';

const HTML_MODIFICATION_PROMPT = `你是一个前端开发工程师。根据任务描述，修改 Demo HTML 文件。

要求：
1. 保持单文件 HTML SPA 结构
2. 保持 data-module-key 和 data-element-path 属性
3. 保持 postMessage 通信机制
4. 保持导航切换方式（onclick + navigate()，不使用 hashchange）
5. **只修改目标模块的内容**，不要改动其他模块、侧边栏导航、样式、脚本
6. 不要改变无关模块的 render() 函数内容
7. 输出完整的 HTML，不要省略任何部分

直接输出 HTML（不要 markdown 包裹）。`;

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
}
