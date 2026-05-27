import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { EVENTS } from '../../events/event-types';

const DELIVERY_DECOMPOSITION_PROMPT = `你是一个软件项目技术负责人（总工），负责项目的交付评估和任务分解。

你需要：
1. 分析项目的完整性 — 评估 Demo 对原始需求的覆盖程度
2. 识别风险点 — 哪些功能还不完整、不够健壮或有潜在问题
3. 生成交付任务清单 — 确保项目可以顺利交付

请用 JSON 格式输出，严格遵循以下结构（不要 markdown 包裹，纯 JSON）：
{
  "completeness": 0-100之间的整数（评估完成度百分比），
  "risks": [{"severity": "high|medium|low", "description": "风险描述"}],
  "recommendations": ["建议1", "建议2"],
  "tasks": [
    {
      "type": "deploy|export_source|export_package|export_repository|export_database_schema|export_deployment_config",
      "title": "任务标题",
      "description": "任务详细描述",
      "moduleKey": "对应的模块key（如适用）",
      "priority": 100
    }
  ]
}`;

const TASK_DECOMPOSITION_PROMPT = `你是一个软件项目技术负责人（总工）。用户对 Demo 页面提出了修改意见。你需要：
1. 分析意见，判断用户想改什么
2. 参考当前 Demo HTML，确认改动位置
3. 把意见拆解为 1～N 个具体子任务

子任务类型：
- frontend: 前端 UI 修改
- backend: 后端逻辑修改
- database: 数据模型修改
- test: 测试
- fix: 修复问题

请用 JSON 格式输出，严格遵循以下结构（不要 markdown 包裹，纯 JSON）：
{
  "tasks": [
    {
      "type": "frontend",
      "title": "简短的标题",
      "description": "详细的修改描述，说明改哪里、怎么改",
      "moduleKey": "对应的模块key",
      "acceptanceCriteria": ["条件1", "条件2"],
      "priority": 100
    }
  ]
}`;

@Injectable()
export class HermesClient {
  private readonly logger = new Logger(HermesClient.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private deepseek: DeepseekService,
    private eventEmitter: EventEmitter2,
    private statusMapper: StatusMapperService,
  ) {}

  async handleFeedback(feedbackId: string): Promise<string[]> {
    this.logger.log(`Hermes analyzing feedback ${feedbackId}`);

    const feedback = await this.prisma.feedbackItem.findUnique({
      where: { id: feedbackId },
      include: { project: { select: { demoHtml: true, id: true } } },
    });
    if (!feedback || !feedback.project) {
      this.logger.error(`Feedback ${feedbackId} not found`);
      return [];
    }

    const project = feedback.project;

    const userMessage = [
      `## 用户的修改意见`,
      feedback.comment,
      ``,
      `## 模块标识`,
      feedback.moduleKey ? `模块: ${feedback.moduleKey}` : '未指定',
      feedback.elementPath ? `元素路径: ${feedback.elementPath}` : '',
      ``,
      `## 当前 Demo HTML 结构`,
      project.demoHtml ? project.demoHtml.slice(0, 3000) : '（暂无 Demo）',
    ].filter(Boolean).join('\n');

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: TASK_DECOMPOSITION_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3, maxTokens: 4096 },
    );

    const tasks = this.parseTasks(response, feedback.projectId);
    this.logger.log(`Hermes decomposed into ${tasks.length} tasks`);

    const taskIds: string[] = [];
    for (const task of tasks) {
      const created = await this.prisma.task.create({
        data: {
          projectId: feedback.projectId,
          type: task.type,
          title: task.title,
          description: task.description,
          priority: task.priority ?? 100,
          inputPayload: { feedbackId, moduleKey: feedback.moduleKey || undefined, elementPath: feedback.elementPath || undefined },
        },
      });
      taskIds.push(created.id);
    }

    // Link feedback to first task
    if (taskIds.length > 0) {
      await this.prisma.feedbackItem.update({
        where: { id: feedbackId },
        data: { generatedTaskId: taskIds[0], status: 'processing' },
      });
    }

    return taskIds;
  }

  async handleDeliveryExport(projectId: string): Promise<{
    taskIds: string[];
    analysis: { completeness: number; risks: Array<{ severity: string; description: string }>; recommendations: string[] };
  }> {
    this.logger.log(`Hermes analyzing delivery readiness for project ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, planSummary: true, moduleMap: true, description: true },
    });

    if (!project) {
      this.logger.error(`Project ${projectId} not found`);
      return { taskIds: [], analysis: { completeness: 0, risks: [{ severity: 'high', description: '项目不存在' }], recommendations: [] } };
    }

    const userMessage = [
      `## 项目描述`,
      project.description || '（未提供）',
      ``,
      `## 项目计划`,
      typeof project.planSummary === 'object' ? JSON.stringify(project.planSummary, null, 2) : (project.planSummary || '（未提供）'),
      ``,
      `## 模块映射`,
      typeof project.moduleMap === 'object' ? JSON.stringify(project.moduleMap, null, 2) : (project.moduleMap || '（未提供）'),
      ``,
      `## 当前 Demo HTML（前 5000 字符）`,
      project.demoHtml ? project.demoHtml.slice(0, 5000) : '（暂无 Demo）',
    ].join('\n');

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: DELIVERY_DECOMPOSITION_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3, maxTokens: 4096 },
    );

    const parsed = this.parseDeliveryResponse(response);
    this.logger.log(`Hermes delivery analysis: ${parsed.completeness}% complete, ${parsed.tasks.length} tasks, ${parsed.risks.length} risks`);

    // Create Task records
    const taskIds: string[] = [];
    for (const task of parsed.tasks) {
      const created = await this.prisma.task.create({
        data: {
          projectId,
          type: task.type,
          title: task.title,
          description: task.description,
          priority: task.priority ?? 100,
          inputPayload: { moduleKey: task.moduleKey || undefined, source: 'delivery-export' },
        },
      });
      taskIds.push(created.id);
    }

    // Store analysis in project structuredRequirement for frontend consumption
    const analysis = {
      completeness: parsed.completeness,
      risks: parsed.risks,
      recommendations: parsed.recommendations,
    };

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        structuredRequirement: {
          ...(typeof project.planSummary === 'object' ? project.planSummary : {}),
          deliveryAnalysis: analysis,
        } as any,
      },
    });

    return { taskIds, analysis };
  }

  private parseDeliveryResponse(response: string): {
    completeness: number;
    risks: Array<{ severity: string; description: string }>;
    recommendations: string[];
    tasks: Array<{ type: string; title: string; description: string; moduleKey?: string; priority?: number }>;
  } {
    const fallback = {
      completeness: 50,
      risks: [{ severity: 'medium' as const, description: 'AI 分析失败，请人工检查项目完整性' }],
      recommendations: ['人工检查交付物'],
      tasks: [{
        type: 'deploy' as const,
        title: '最终部署',
        description: 'AI 自动分析失败，执行标准部署流程',
        priority: 100,
      }],
    };

    try {
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        completeness: typeof parsed.completeness === 'number' ? Math.max(0, Math.min(100, parsed.completeness)) : fallback.completeness,
        risks: Array.isArray(parsed.risks) ? parsed.risks : fallback.risks,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : fallback.recommendations,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : fallback.tasks,
      };
    } catch {
      this.logger.error('Failed to parse delivery decomposition response, using fallback');
      return fallback;
    }
  }

  private parseTasks(response: string, projectId: string): Array<{
    type: string; title: string; description: string; moduleKey?: string;
    acceptanceCriteria?: string[]; priority?: number;
  }> {
    try {
      // Try direct JSON parse first
      const parsed = JSON.parse(response);
      if (parsed.tasks && Array.isArray(parsed.tasks)) return parsed.tasks;
      return [];
    } catch {
      // Try cleaning markdown fences
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.tasks && Array.isArray(parsed.tasks)) return parsed.tasks;
        return [];
      } catch {
        this.logger.error('Failed to parse task decomposition response');
        // Fallback: create a single task with the whole feedback
        return [{
          type: 'frontend',
          title: '处理批注意见',
          description: response.slice(0, 500),
          priority: 100,
        }];
      }
    }
  }

  /**
   * PRD 就绪 — 保存 PRD + 更新项目状态（不触发 N8N，等用户确认方案）
   */
  async handlePrdReady(projectId: string, prd: any, summary: string): Promise<void> {
    this.logger.log(`[Hermes] PRD 就绪, 项目 ${projectId}`);

    await this.prisma.projectMessage.create({
      data: {
        projectId,
        role: 'system_internal',
        content: 'PRD 已生成',
        metadata: { prd } as any,
      },
    });

    const completionMessage = summary
      ? `${summary}\n\n我已经对你想做的产品有了全面了解。下面是我整理的需求文档，你看看是否准确？如果有需要修改的地方，直接告诉我，我可以帮你调整。`
      : '我已经对你想做的产品有了全面了解。下面是我整理的需求文档，你看看是否准确？如果有需要修改的地方，直接告诉我，我可以帮你调整。';

    await this.prisma.projectMessage.create({
      data: { projectId, role: 'assistant', content: completionMessage },
    });

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'prd_ready',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('prd_ready'),
        structuredRequirement: { prd } as any,
      },
    });

    this.logger.log(`[Hermes] PRD 已保存, 等待用户确认方案, 项目 ${projectId}`);
  }
}
