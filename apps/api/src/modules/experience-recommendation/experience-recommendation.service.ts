import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';

const EXPERIENCE_PROMPT = `你是一个软件工程知识库管理员。根据项目的复盘数据和执行情况，提取可复用的经验推荐。

输出 JSON 数组格式（不要 markdown 包裹）：
[
  {
    "recommendationType": "question | module_template | test_case | fix_strategy | delivery_check | risk_warning",
    "stage": "clarify | plan | demo | feedback | delivery",
    "recommendation": {
      "title": "推荐标题",
      "content": "推荐详细内容",
      "tags": ["标签1", "标签2"]
    }
  }
]

推荐应具体、可操作，基于该项目的实际经验。`;

@Injectable()
export class ExperienceRecommendationService {
  private readonly logger = new Logger(ExperienceRecommendationService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  async findByProject(projectId: string) {
    return this.prisma.experienceRecommendation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async generateRecommendations(projectId: string): Promise<any[]> {
    this.logger.log(`Generating experience recommendations for project ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        description: true,
        planSummary: true,
        feedbackItems: {
          select: { comment: true, status: true },
        },
        tasks: {
          select: { type: true, status: true, errorMessage: true },
        },
      },
    });

    if (!project) {
      this.logger.error(`Project ${projectId} not found`);
      return [];
    }

    const userMessage = [
      `## 项目描述`,
      project.description || '（未提供）',
      ``,
      `## 项目方案`,
      typeof project.planSummary === 'object' ? JSON.stringify(project.planSummary, null, 2) : (project.planSummary || '（未提供）'),
      ``,
      `## 反馈记录`,
      project.feedbackItems.map(f => `- [${f.status}] ${f.comment}`).join('\n') || '无',
      ``,
      `## 任务执行情况`,
      project.tasks.map(t => `${t.type}: ${t.status}${t.errorMessage ? ` - ${t.errorMessage}` : ''}`).join('\n') || '无',
    ].join('\n');

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: EXPERIENCE_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3, maxTokens: 4096 },
    );

    return this.saveRecommendations(response, projectId);
  }

  private async saveRecommendations(response: string, projectId: string): Promise<any[]> {
    try {
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];

      const saved: any[] = [];
      for (const item of parsed) {
        const created = await this.prisma.experienceRecommendation.create({
          data: {
            projectId,
            stage: item.stage || 'delivery',
            recommendationType: item.recommendationType || 'risk_warning',
            recommendation: item.recommendation || {},
          },
        });
        saved.push(created);
      }
      this.logger.log(`Saved ${saved.length} experience recommendations`);
      return saved;
    } catch (error) {
      this.logger.error('Failed to parse experience recommendations', error);
      return [];
    }
  }
}
