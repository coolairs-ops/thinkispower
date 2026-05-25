import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';

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
export class OpenClawClient {
  private readonly logger = new Logger(OpenClawClient.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  async handleFeedback(feedbackId: string): Promise<string[]> {
    this.logger.log(`OpenClaw analyzing feedback ${feedbackId}`);

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
    this.logger.log(`OpenClaw decomposed into ${tasks.length} tasks`);

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
        data: { generatedTaskId: taskIds[0] },
      });
    }

    return taskIds;
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
}
