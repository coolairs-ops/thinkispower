import { Injectable, Logger } from '@nestjs/common';
import { QwenClient } from '../sensors/qwen-client.service';

export interface ReviewIssue {
  severity: 'high' | 'medium' | 'low';
  file: string;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  overallScore: number;
  dimensions: { structure: number; security: number; coverage: number; style: number };
  issues: ReviewIssue[];
  summary: string;
}

const REVIEW_PROMPT = `你是代码审查专家。审查以下全栈项目代码，从 4 个维度评分(0-100)。

评分维度:
1. 结构完整性 (25分) — package.json、入口文件、模块组织
2. 安全性 (25分) — 输入验证、SQL注入防护、认证授权
3. 功能覆盖度 (25分) — 是否覆盖了所有功能点
4. 代码风格 (25分) — 命名规范、TypeScript 类型、注释

输出 JSON (只输出 JSON):
{
  "overallScore": 75,
  "dimensions": { "structure": 20, "security": 15, "coverage": 20, "style": 20 },
  "issues": [
    { "severity": "high", "file": "path", "description": "问题", "suggestion": "建议" }
  ],
  "summary": "总体评价"
}`;

@Injectable()
export class QwenReviewerService {
  private readonly logger = new Logger(QwenReviewerService.name);

  constructor(private qwen: QwenClient) {}

  async review(
    files: Array<{ path: string; content: string }>,
    projectName: string,
    planSummary: any,
  ): Promise<ReviewResult | null> {
    if (!this.qwen.available) {
      this.logger.warn('Qwen 不可用，跳过代码审查');
      return null;
    }

    // 构建审查上下文
    const fileList = files
      .slice(0, 20)
      .map(f => `### ${f.path}\n\`\`\`\n${f.content.substring(0, 1500)}\n\`\`\``)
      .join('\n\n');

    const prompt = `项目: ${projectName}\n方案: ${JSON.stringify(planSummary || {}).substring(0, 1000)}\n\n生成的文件:\n${fileList}`;

    try {
      const response = await this.qwen.chat(
        [
          { role: 'system', content: REVIEW_PROMPT },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 4096 },
      );

      if (!response) return null;

      const match = response.match(/\{[\s\S]*\}/);
      if (!match) {
        this.logger.warn('Qwen 返回非 JSON 格式');
        return null;
      }

      const parsed = JSON.parse(match[0]);
      return {
        overallScore: parsed.overallScore || 0,
        dimensions: {
          structure: parsed.dimensions?.structure || 0,
          security: parsed.dimensions?.security || 0,
          coverage: parsed.dimensions?.coverage || 0,
          style: parsed.dimensions?.style || 0,
        },
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        summary: parsed.summary || '',
      };
    } catch (e) {
      this.logger.warn(`Qwen 审查失败: ${e}`);
      return null;
    }
  }
}
