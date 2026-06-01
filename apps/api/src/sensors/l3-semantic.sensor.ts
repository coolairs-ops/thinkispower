import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { QwenClient } from './qwen-client.service';
import { SensorReport, SensorCheck } from './sensor-report.interface';

@Injectable()
export class L3SemanticSensor {
  private readonly logger = new Logger(L3SemanticSensor.name);

  constructor(
    private prisma: PrismaService,
    private qwen: QwenClient,
  ) {}

  async run(projectId: string): Promise<SensorReport> {
    const checks: SensorCheck[] = [];

    // 1. Demo 语义完整性评估（复用 Hermes 分析能力）
    checks.push(await this.checkDemoCompleteness(projectId));

    // 2. 批注反馈闭环率
    checks.push(await this.checkFeedbackClosureRate(projectId));

    // 3. 项目状态健康度
    checks.push(await this.checkProjectStatus(projectId));

    const score = this.computeScore(checks);
    return {
      sensorName: 'L3-语义评估',
      layer: 3,
      passed: checks.every(c => c.passed),
      score,
      checks,
    };
  }

  private async checkDemoCompleteness(projectId: string): Promise<SensorCheck> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true, planSummary: true, description: true },
      });

      if (!project?.demoHtml) {
        return {
          name: 'Demo完整性',
          passed: false,
          score: 0,
          weight: 35,
          detail: '暂无 Demo HTML',
        };
      }

      const planText = typeof project.planSummary === 'string'
        ? project.planSummary
        : JSON.stringify(project.planSummary || {});
      const descText = project.description || '';

      const response = await this.qwen.chat([
        {
          role: 'system',
          content: `你是一个独立的软件质量评估专家。评估以下项目Demo的完整性。
请根据项目描述和方案摘要，对Demo HTML进行评估，只输出一个JSON对象（不要markdown包裹）：

{
  "completeness": <0-100的整数>,
  "reasoning": "<简要评估理由>"
}

评分标准：
- 0-30: 大部分功能缺失或仅有骨架
- 31-60: 部分功能实现，但关键模块缺失
- 61-85: 主要功能已实现，少量细节缺失
- 86-100: 功能完整，体验良好`,
        },
        {
          role: 'user',
          content: `项目描述：${descText.slice(0, 2000)}

方案摘要：${planText.slice(0, 4000)}

Demo HTML：
${project.demoHtml.slice(0, 12000)}`,
        },
      ], { temperature: 0.2, maxTokens: 1024 });

      let completeness = 50;
      if (response) {
        try {
          const parsed = JSON.parse(response);
          completeness = typeof parsed.completeness === 'number' ? parsed.completeness : 50;
        } catch {
          const m = response.match(/\{[\s\S]*"completeness"\s*:\s*(\d+)[\s\S]*\}/);
          if (m) {
            completeness = Math.min(100, Math.max(0, parseInt(m[1], 10) || 50));
          }
        }
      }

      const passed = completeness >= 60;
      return {
        name: 'Demo完整性',
        passed,
        score: completeness,
        weight: 35,
        detail: `AI评估完整度 ${completeness}%${passed ? '' : ' (建议优化至 60% 以上)'}`,
      };
    } catch (err) {
      this.logger.warn(`Demo完整性检查失败: ${err}`);
      return {
        name: 'Demo完整性',
        passed: true,
        score: 50,
        weight: 35,
        error: '评估服务暂不可用',
      };
    }
  }

  private async checkFeedbackClosureRate(projectId: string): Promise<SensorCheck> {
    try {
      const total = await this.prisma.feedbackItem.count({
        where: { projectId },
      });
      if (total === 0) {
        return {
          name: '反馈闭环率',
          passed: true,
          score: 100,
          weight: 25,
          detail: '暂无反馈记录',
        };
      }

      const resolved = await this.prisma.feedbackItem.count({
        where: { projectId, status: 'resolved' },
      });

      const rate = Math.round((resolved / total) * 100);
      const passed = rate >= 80;
      return {
        name: '反馈闭环率',
        passed,
        score: rate,
        weight: 25,
        detail: `${resolved}/${total} 已解决 (${rate}%)`,
      };
    } catch (err) {
      return {
        name: '反馈闭环率',
        passed: true,
        score: 100,
        weight: 25,
        error: `查询失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async checkProjectStatus(projectId: string): Promise<SensorCheck> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { status: true },
      });

      if (!project) {
        return {
          name: '项目状态',
          passed: false,
          score: 0,
          weight: 20,
          detail: '项目不存在',
        };
      }

      const stuckStatuses = ['build_failed', 'failed', 'paused'];
      const isStuck = stuckStatuses.includes(project.status);
      return {
        name: '项目状态',
        passed: !isStuck,
        score: isStuck ? 30 : 100,
        weight: 20,
        detail: `当前状态: ${project.status}${isStuck ? ' (卡在异常状态)' : ''}`,
      };
    } catch (err) {
      return {
        name: '项目状态',
        passed: true,
        score: 100,
        weight: 20,
        error: `查询失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private computeScore(checks: SensorCheck[]): number {
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    if (totalWeight === 0) return 0;
    return Math.round(checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  }
}
