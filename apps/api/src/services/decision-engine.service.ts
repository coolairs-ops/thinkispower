import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DeepseekService } from './deepseek.service';

export type Level4 = 'missing' | 'partial' | 'good' | 'complete';
export type SpecLevel = 'missing' | 'draft' | 'frozen';
export type DemoLevel = 'missing' | 'generated';

export interface CompletenessBreakdown {
  descriptionLevel: Level4;
  prdLevel: Level4;
  planLevel: Level4;
  featuresLevel: Level4;
  pagesLevel: Level4;
  specLevel: SpecLevel;
  demoLevel: DemoLevel;
  score: number;
}

const LEVEL_COEFF: Record<string, number> = {
  missing: 0, partial: 0.33, good: 0.67, complete: 1,
  draft: 0.5, frozen: 1, generated: 1,
};

const WEIGHTS: Record<string, number> = {
  descriptionLevel: 10, prdLevel: 20, planLevel: 15,
  featuresLevel: 15, pagesLevel: 10, specLevel: 20, demoLevel: 10,
};

const LEVEL_KEYS: (keyof CompletenessBreakdown)[] = [
  'descriptionLevel', 'prdLevel', 'planLevel',
  'featuresLevel', 'pagesLevel', 'specLevel', 'demoLevel',
];

export interface NextStepResult {
  action: 'continue_clarify' | 'narrow_scope' | 'generate_spec' | 'confirm_spec' | 'generate_demo' | 'enter_development' | 'pause' | 'needs_human';
  title: string;
  description: string;
  reasons: string[];
  nextSteps: string[];
  confidence: number;
  severity: 'info' | 'warning' | 'danger';
  completeness: number;
  completenessBreakdown: CompletenessBreakdown;
  actionLinks: Record<string, string>;
  improvementSuggestions?: string[];  // AI生成的具体改进建议
}

@Injectable()
export class DecisionEngineService {
  private readonly logger = new Logger(DecisionEngineService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  // ── 各维度评估函数 ──

  private assessDescription(project: any): Level4 {
    const len = (project.description || '').trim().length;
    if (len < 3) return 'missing';
    if (len < 20) return 'partial';
    if (len < 50) return 'good';
    return 'complete';
  }

  private assessPrd(sr: any): Level4 {
    const fields = ['targetUsers', 'mvpScope', 'features', 'pages', 'businessRules', 'dataObjects'];
    const filled = fields.filter(f => {
      const v = sr?.[f];
      return v !== undefined && v !== null && (typeof v === 'string' ? v.trim().length > 0 : true);
    }).length;
    if (filled === 0) return 'missing';
    if (filled <= 2) return 'partial';
    if (filled <= 4) return 'good';
    return 'complete';
  }

  private assessPlan(plan: any): Level4 {
    if (!plan || Object.keys(plan).length === 0) return 'missing';
    const keys = ['summary', 'pages', 'features', 'roles', 'dataObjects'];
    const filled = keys.filter(k => {
      const v = plan[k];
      return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
    }).length;
    if (filled <= 1) return 'partial';
    if (filled <= 3) return 'good';
    return 'complete';
  }

  private assessFeatures(plan: any): Level4 {
    const n = plan?.features?.length || 0;
    if (n === 0) return 'missing';
    if (n === 1) return 'partial';
    if (n <= 3) return 'good';
    return 'complete';
  }

  private assessPages(plan: any): Level4 {
    const n = plan?.pages?.length || 0;
    if (n === 0) return 'missing';
    if (n === 1) return 'partial';
    if (n <= 3) return 'good';
    return 'complete';
  }

  private assessSpec(spec: any): SpecLevel {
    if (!spec) return 'missing';
    return spec.status === 'frozen' ? 'frozen' : 'draft';
  }

  private assessDemo(project: any): DemoLevel {
    return project.demoHtml && project.demoHtml.length > 100 ? 'generated' : 'missing';
  }

  async evaluate(projectId: string): Promise<NextStepResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, status: true, description: true,
        structuredRequirement: true, planSummary: true, specVersion: true, demoHtml: true,
      },
    });
    if (!project) {
      return this.result('needs_human', '项目不存在', '无法分析', [], [], 0, 'danger', 0, this.emptyBreakdown(), {});
    }

    const sr = (project.structuredRequirement as any) || {};
    const plan = (project.planSummary as any) || {};
    const status = project.status;
    const spec = await this.prisma.specification.findUnique({ where: { projectId } });

    const errorMatches = await this.prisma.errorEvent.count({ where: { projectId, resolved: false } });

    // ── 计算真实完整度（7 维度多级评分） ──
    const breakdown: CompletenessBreakdown = {
      descriptionLevel: this.assessDescription(project),
      prdLevel: this.assessPrd(sr),
      planLevel: this.assessPlan(plan),
      featuresLevel: this.assessFeatures(plan),
      pagesLevel: this.assessPages(plan),
      specLevel: this.assessSpec(spec),
      demoLevel: this.assessDemo(project),
      score: 0,
    };

    // 加权评分：sum(权重 × 等级系数)
    let completeness = 0;
    for (const key of LEVEL_KEYS) {
      const level = breakdown[key] as string;
      completeness += (WEIGHTS[key as keyof typeof WEIGHTS] ?? 0) * (LEVEL_COEFF[level] ?? 0);
    }
    completeness = Math.round(completeness);
    breakdown.score = completeness;

    // 置信度：基于可用数据量（≥partial 的维度数），clamp 到 100
    const dataPoints = (['descriptionLevel', 'prdLevel', 'planLevel', 'featuresLevel', 'pagesLevel'] as const)
      .filter(k => breakdown[k] !== 'missing').length;
    const baseConfidence = Math.min(dataPoints * 15 + 10, 100);

    // ── 决策规则 ──

    if (errorMatches > 5) {
      return this.result('needs_human', '建议暂停，联系平台支持',
        `检测到 ${errorMatches} 个未解决的系统错误`, [],
        ['联系平台支持'], 90, 'danger', completeness, breakdown,
        {});
    }

    if (breakdown.specLevel !== 'missing' && spec) {
      const highRisks = ((spec.primaryRisks as any[]) || []).filter((r: any) => r.severity === 'high').length;
      const cost = spec.estimatedCostRmb || 0;

      if (highRisks >= 3 && cost < 1000) {
        return this.result('pause', '建议先调整范围和预算',
          `检测到 ${highRisks} 个高风险项，预算 ¥${cost} 可能不足`,
          [`${highRisks} 个高风险项`, `预算 ¥${cost} 可能偏低`],
          ['缩小第一版功能范围', '重新评估预算'], 85, 'danger', completeness, breakdown,
          { '缩小范围': `/projects/${projectId}/spec` });
      }
    }

    const coreFunctions = spec?.coreFunctions as any[] || plan?.features as any[] || [];
    const mustHaveCount = coreFunctions.filter((f: any) => (f.priority || 'must') === 'must').length;

    if (completeness < 30 && (status === 'needs_input' || status === 'clarifying')) {
      const gaps: string[] = [];
      if (breakdown.descriptionLevel === 'missing') gaps.push('填写项目描述');
      if (breakdown.prdLevel === 'missing') gaps.push('完善需求文档');

      return this.result('continue_clarify',
        `需求完整度 ${completeness}% — 继续完善`,
        `当前信息还不够生成高质量方案。完整度由以下维度计算：项目描述(15%)、方案(20%)、功能清单(20%)、页面清单(15%)、需求文档(20%)。`,
        gaps.length > 0 ? gaps : ['需求信息不足'],
        ['进入需求对话', '补充项目描述'],
        baseConfidence, 'info', completeness, breakdown,
        { '需求对话': `/projects/${projectId}`, '补充描述': `/projects/${projectId}` });
    }

    if (mustHaveCount > 8 && status !== 'spec_confirmed') {
      return this.result('narrow_scope',
        '建议缩小第一版范围',
        `当前 ${mustHaveCount} 个必须功能，第一版建议 5-8 个`,
        [`${mustHaveCount} 个必须功能超出建议范围`],
        ['标记哪些功能可以第二版再做', '查看功能清单'],
        80, 'warning', completeness, breakdown,
        { '功能清单': `/projects/${projectId}/plan` });
    }

    if (status === 'plan_ready' && (!spec || spec.status !== 'frozen')) {
      return this.result('generate_spec',
        '生成产品规格',
        '方案已确认，下一步是生成详细规格。规格会明确功能、页面、权限、数据模型和验收标准。',
        ['方案已确认', '规格是开发契约'],
        ['生成规格草案', '确认后即可进入开发'],
        88, 'info', completeness, breakdown,
        { '生成规格': `/projects/${projectId}/spec` });
    }

    if (status === 'spec_ready' && spec?.status === 'draft') {
      return this.result('confirm_spec',
        '确认产品规格',
        '规格草稿已生成，确认后进入开发阶段',
        ['规格待确认', '确认后不可随意修改'],
        ['逐项检查规格', '确认无误后冻结'],
        90, 'info', completeness, breakdown,
        { '确认规格': `/projects/${projectId}/spec` });
    }

    if (status === 'spec_confirmed') {
      return this.result('generate_demo',
        '开始生成产品预览',
        '规格已确认，可以生成 Demo 预览',
        ['规格已冻结', '预览生成后可在线体验'],
        ['生成 Demo 预览'],
        95, 'info', completeness, breakdown,
        { '生成预览': `/projects/${projectId}/demo` });
    }

    // 默认：基于完整度推荐
    if (completeness < 50) {
      return this.result('continue_clarify',
        `需求完整度 ${completeness}% — 建议继续完善`,
        `还有 ${100 - completeness}% 的信息待补充。完善后可获得更准确的方案和预测。`,
        [`完整度 ${completeness}%`, `${100 - completeness}% 待补充`],
        ['进入需求对话', '补充项目信息'],
        baseConfidence, 'info', completeness, breakdown,
        { '需求对话': `/projects/${projectId}` });
    }

    // 生成改进建议（模板化，不调AI不阻塞）
    const missingDims: string[] = [];
    if (breakdown.descriptionLevel === 'missing') missingDims.push('项目描述');
    if (breakdown.prdLevel === 'missing') missingDims.push('需求文档');
    if (breakdown.featuresLevel === 'missing') missingDims.push('功能清单');
    if (breakdown.pagesLevel === 'missing') missingDims.push('页面规划');

    const suggestions: string[] = [];
    if (breakdown.descriptionLevel === 'missing') suggestions.push('试试这样写：谁用这个系统？现在怎么解决这个问题的？想达到什么效果？');
    if (breakdown.prdLevel === 'missing') suggestions.push('补充需求文档：列出用户角色、核心操作流程、每个角色能做什么');
    if (breakdown.featuresLevel === 'missing') suggestions.push('列出第一版必须有的3-5个功能，用简单的话描述，比如"客户列表——查看所有客户信息"');
    if (breakdown.pagesLevel === 'missing') suggestions.push('想想用户打开系统后会看到哪些页面？至少要有首页、列表页、详情页');

    return this.result('continue_clarify',
      `需求完整度 ${completeness}% — 建议继续完善`,
      `还有 ${100 - completeness}% 的信息待补充（${missingDims.join('、')}）。完善后可获得更准确的方案。`,
      [`完整度 ${completeness}%`, missingDims.length > 0 ? `缺失: ${missingDims.join('、')}` : '信息基本完整'].filter(Boolean),
      suggestions.length > 0 ? suggestions : ['继续当前流程'],
      baseConfidence, 'info', completeness, breakdown,
      { '需求对话': `/projects/${projectId}` });
  }

  /** AI 生成改进建议 */
  async generateImprovementSuggestions(
    projectId: string, breakdown: CompletenessBreakdown, projectName: string, description: string
  ): Promise<string[]> {
    const missing: string[] = [];
    if (breakdown.descriptionLevel === 'missing') missing.push('项目描述');
    if (breakdown.prdLevel === 'missing') missing.push('需求文档(PRD)');
    if (breakdown.featuresLevel === 'missing') missing.push('功能清单');
    if (breakdown.pagesLevel === 'missing') missing.push('页面规划');
    if (missing.length === 0) return [];

    try {
      const prompt = `你是产品需求分析助手。项目"${projectName}"当前描述："${description || '无'}"。
以下维度信息不足：${missing.join('、')}。
请针对每个缺失维度，用普通人能理解的语言给出1条具体建议（每条不超过40字）。输出JSON数组：["建议1","建议2"]`;

      const resp = await this.deepseek.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 512 },
      );
      const match = resp.match(/\[[\s\S]*\]/);
      if (match) {
        const suggestions = JSON.parse(match[0]);
        return suggestions.slice(0, 4);
      }
    } catch (e) {
      this.logger.warn(`AI suggestions failed: ${e}`);
    }

    // 降级：模板化建议
    const fallback: string[] = [];
    if (breakdown.descriptionLevel === 'missing') fallback.push('试试描述：谁用这个系统？现在怎么解决这个问题的？');
    if (breakdown.prdLevel === 'missing') fallback.push('在项目描述里补充：用户角色、核心流程、必须有的功能');
    if (breakdown.featuresLevel === 'missing') fallback.push('列出3-5个第一版必须有的功能，比如"客户列表""搜索客户""新增客户"');
    if (breakdown.pagesLevel === 'missing') fallback.push('想想用户会看到哪些页面？比如"首页、列表页、详情页"');
    return fallback;
  }

  private result(
    action: NextStepResult['action'], title: string, description: string,
    reasons: string[], nextSteps: string[], confidence: number, severity: NextStepResult['severity'],
    completeness: number, breakdown: CompletenessBreakdown, actionLinks: Record<string, string>,
  ): NextStepResult {
    return { action, title, description, reasons, nextSteps, confidence, severity, completeness, completenessBreakdown: breakdown, actionLinks };
  }

  private emptyBreakdown(): CompletenessBreakdown {
    return {
      descriptionLevel: 'missing', prdLevel: 'missing', planLevel: 'missing',
      featuresLevel: 'missing', pagesLevel: 'missing', specLevel: 'missing', demoLevel: 'missing',
      score: 0,
    };
  }
}
