import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface ProjectWarning {
  patternKey: string;
  publicName: string;
  description: string;
  recommendations: string[];
  severity: 'high' | 'medium' | 'low';
}

@Injectable()
export class WarningService {
  private readonly logger = new Logger(WarningService.name);

  constructor(private prisma: PrismaService) {}

  /** 分析项目并返回匹配的系统提醒 */
  async analyze(projectId: string): Promise<ProjectWarning[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        status: true,
        description: true,
        structuredRequirement: true,
        planSummary: true,
      },
    });
    if (!project) return [];

    const sr = (project.structuredRequirement as any) || {};
    const plan = (project.planSummary as any) || {};

    // 拉取所有错误模式
    const patterns = await this.prisma.errorPattern.findMany();

    // 提取项目特征
    const allText = [
      project.description || '',
      sr?.prd || '',
      JSON.stringify(plan),
    ].join(' ').toLowerCase();

    const completeness = sr?.completeness?.overall || sr?.completeness || 0;
    const mustHaveCount = ((plan?.features || []) as any[]).filter((f: any) => (f.priority || 'must') === 'must').length;
    const totalFunctions = ((plan?.features || []) as any[]).length;
    const estimatedCost = plan?.estimatedCostRmb || plan?.estimatedCost || sr?.estimatedCostRmb || 0;
    const estimatedDays = plan?.estimatedDays || plan?.estimatedDuration || sr?.estimatedDays || 0;

    // 获取规格
    const spec = await this.prisma.specification.findUnique({ where: { projectId } });
    const highRiskCount = ((spec?.primaryRisks || plan?.risks || []) as any[])
      .filter((r: any) => r.severity === 'high').length;

    const warnings: ProjectWarning[] = [];

    for (const p of patterns) {
      const signals = (p.signals as any) || {};
      if (this.matchPattern(signals, {
        status: project.status,
        completeness,
        mustHaveCount,
        totalFunctions,
        estimatedCost,
        estimatedDays,
        highRiskCount,
        allText,
      })) {
        warnings.push({
          patternKey: p.patternKey,
          publicName: p.publicName || p.name,
          description: ((p.commonCauses as string[]) || []).join('；'),
          recommendations: (p.recommendedActions as string[]) || [],
          severity: (p.severity as any) || 'medium',
        });
      }
    }

    this.logger.log(`项目 ${projectId}: 匹配 ${warnings.length} 条提醒`);
    return warnings;
  }

  /** 模式匹配 */
  private matchPattern(signals: any, ctx: any): boolean {
    // 状态过滤
    if (signals.statusIn && !signals.statusIn.includes(ctx.status)) return false;

    // 完整度阈值
    if (signals.completenessBelow !== undefined && ctx.completeness >= signals.completenessBelow) return false;

    // 功能数量阈值
    if (signals.mustHaveCountAbove !== undefined && ctx.mustHaveCount <= signals.mustHaveCountAbove) return false;
    if (signals.totalFunctionsAbove !== undefined && ctx.totalFunctions <= signals.totalFunctionsAbove) return false;

    // 预算阈值
    if (signals.estimatedCostBelow !== undefined && ctx.estimatedCost >= signals.estimatedCostBelow) return false;

    // 周期阈值
    if (signals.estimatedDaysBelow !== undefined && ctx.estimatedDays >= signals.estimatedDaysBelow) return false;

    // 高风险计数
    if (signals.highRiskCountAbove !== undefined && ctx.highRiskCount <= signals.highRiskCountAbove) return false;

    // 关键词匹配
    if (signals.hasKeyword) {
      const kw: string[] = signals.hasKeyword;
      if (!kw.some(k => ctx.allText.includes(k))) return false;
    }

    // 缺失关键词
    if (signals.missingKeyword) {
      const mk: string[] = signals.missingKeyword;
      // 至少有一个缺失关键词没出现
      if (mk.some(k => ctx.allText.includes(k))) return false;
    }

    // 功能数条件
    if (signals.functionCountAbove !== undefined && (ctx.totalFunctions || 0) <= signals.functionCountAbove) return false;

    // 完整度条件
    if (signals.completenessBelow !== undefined && ctx.completeness >= signals.completenessBelow) return false;

    return true;
  }
}
