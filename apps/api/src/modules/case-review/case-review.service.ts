import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';

const CASE_REVIEW_PROMPT = `你是一个软件项目复盘分析师。根据项目的完整数据生成复盘报告。

输出 JSON 格式（不要 markdown 包裹）：
{
  "summary": "项目整体复盘总结（2-3句话）",
  "appType": "项目类型（如：CRM、电商、OA等）",
  "mainErrors": [{"stage": "问题出现的阶段", "description": "问题描述", "severity": "high|medium|low"}],
  "fixStrategies": [{"problem": "问题", "solution": "解决方案", "effectiveness": "效果描述"}],
  "reusableLessons": ["经验1", "经验2"],
  "userAcceptanceResult": "用户验收结论"
}`;

@Injectable()
export class CaseReviewService {
  private readonly logger = new Logger(CaseReviewService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  async findByProject(projectId: string) {
    return this.prisma.caseReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async generateReview(projectId: string): Promise<any> {
    this.logger.log(`Generating case review for project ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        description: true,
        planSummary: true,
        structuredRequirement: true,
        feedbackItems: {
          select: { comment: true, status: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        tasks: {
          select: { type: true, status: true, errorMessage: true },
        },
      },
    });

    if (!project) {
      this.logger.error(`Project ${projectId} not found`);
      return null;
    }

    const userMessage = [
      `## 项目描述`,
      project.description || '（未提供）',
      ``,
      `## 项目方案`,
      typeof project.planSummary === 'object' ? JSON.stringify(project.planSummary, null, 2) : (project.planSummary || '（未提供）'),
      ``,
      `## 反馈记录（共 ${project.feedbackItems.length} 条）`,
      project.feedbackItems.map(f => `- [${f.status}] ${f.comment}`).join('\n'),
      ``,
      `## 任务执行情况`,
      project.tasks.map(t => `- ${t.type}: ${t.status}${t.errorMessage ? ` (${t.errorMessage})` : ''}`).join('\n'),
    ].join('\n');

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: CASE_REVIEW_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3, maxTokens: 4096 },
    );

    const parsed = this.parseReview(response, project);

    // Save to database
    const review = await this.prisma.caseReview.upsert({
      where: { id: '' }, // force create new
      update: {},
      create: parsed,
    });

    return review;
  }

  private parseReview(response: string, project: any): any {
    try {
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        projectId: project.id,
        appType: parsed.appType || null,
        summary: parsed.summary || null,
        originalRequirement: project.structuredRequirement || undefined,
        finalPlan: project.planSummary || undefined,
        feedbackCount: project.feedbackItems?.length || 0,
        mainErrors: parsed.mainErrors || undefined,
        fixStrategies: parsed.fixStrategies || undefined,
        userAcceptanceResult: parsed.userAcceptanceResult || null,
        reusableLessons: parsed.reusableLessons || undefined,
      };
    } catch (error) {
      this.logger.error('Failed to parse case review response', error);
      return {
        projectId: project.id,
        summary: 'AI 复盘分析失败，请人工检查。',
        feedbackCount: project.feedbackItems?.length || 0,
      };
    }
  }
}
