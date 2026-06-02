import { Injectable } from '@nestjs/common';

export interface CompletenessReport {
  overall: number; // 0-100
  productForm: 'known' | 'missing';
  targetUsers: 'known' | 'missing';
  coreFeatures: 'known' | 'partial' | 'missing';
  dataModel: 'known' | 'partial' | 'missing';
  businessRules: 'known' | 'missing';
  scale: 'known' | 'missing';
  acceptanceCriteria: 'known' | 'missing';
  gaps: string[];
}

@Injectable()
export class CompletenessCheckerService {
  private readonly WEIGHTS = {
    productForm: 15,
    targetUsers: 10,
    coreFeatures: 25,
    dataModel: 20,
    businessRules: 10,
    scale: 10,
    acceptanceCriteria: 10,
  };

  /**
   * 从项目中提取的信息 + 已有的 structuredRequirement 中评估完备度
   */
  evaluate(
    structuredRequirement: any,
    userMessages: string[],
  ): CompletenessReport {
    const prd = structuredRequirement?.prd || structuredRequirement || {};
    const allText = userMessages.join('\n').toLowerCase();
    const gaps: string[] = [];

    // 产品形态（从PRD或消息文本推断）
    const productForm = prd.productForm
      ? 'known' as const
      : allText.includes('网页') || allText.includes('web')
        ? 'known' as const
        : allText.includes('app') || allText.includes('手机')
          ? 'known' as const
          : allText.includes('小程序')
            ? 'known' as const
            : 'missing' as const;
    if (productForm === 'missing') gaps.push('产品形态（网页/App/小程序）');

    // 目标用户
    const targetUsers =
      prd.targetUsers || prd.roles?.length > 0
        ? 'known' as const
        : allText.includes('我自己') || allText.includes('个人')
          ? 'known' as const
          : allText.includes('团队')
            ? 'known' as const
            : 'missing' as const;
    if (targetUsers === 'missing') gaps.push('目标用户（谁会用）');

    // 核心功能（>=2个feature）
    const features = prd.features || [];
    const coreFeatures =
      features.length >= 2
        ? ('known' as const)
        : features.length === 1
          ? ('partial' as const)
          : ('missing' as const);
    if (coreFeatures === 'missing') gaps.push('核心功能（至少列出1-2个）');
    if (coreFeatures === 'partial') gaps.push('核心功能较少，建议补充更多功能点');

    // 数据模型（至少要有dataObjects或pages）
    const dataObjects = prd.dataObjects || [];
    const pages = prd.pages || [];
    const dataModel =
      dataObjects.length >= 2 || pages.length >= 2
        ? ('known' as const)
        : dataObjects.length >= 1 || pages.length >= 1
          ? ('partial' as const)
          : ('missing' as const);
    if (dataModel === 'missing') gaps.push('数据模型（有哪些数据对象/页面）');
    if (dataModel === 'partial') gaps.push('数据模型不完整，建议补充更多数据对象');

    // 业务规则
    const businessRules =
      prd.businessRules?.length > 0 || prd.mvpScope?.length > 0
        ? 'known' as const
        : 'missing' as const;
    if (businessRules === 'missing') gaps.push('业务规则（有哪些特殊处理逻辑）');

    // 规模
    const scale = prd.estimatedUsers || prd.estimatedDataVolume
      ? 'known' as const
      : 'missing' as const;
    if (scale === 'missing') gaps.push('规模预估（大概多少用户/数据量）');

    // 验收标准
    const acceptanceCriteria =
      prd.acceptanceChecklist?.length > 0 || prd.acceptanceCriteria?.length > 0
        ? 'known' as const
        : 'missing' as const;
    if (acceptanceCriteria === 'missing') gaps.push('验收标准（怎么算做完了）');

    // 计算总分
    let overall = 0;
    if (productForm === 'known') overall += this.WEIGHTS.productForm;
    if (targetUsers === 'known') overall += this.WEIGHTS.targetUsers;
    if (coreFeatures === 'known') overall += this.WEIGHTS.coreFeatures;
    else if (coreFeatures === 'partial') overall += Math.floor(this.WEIGHTS.coreFeatures * 0.5);
    if (dataModel === 'known') overall += this.WEIGHTS.dataModel;
    else if (dataModel === 'partial') overall += Math.floor(this.WEIGHTS.dataModel * 0.5);
    if (businessRules === 'known') overall += this.WEIGHTS.businessRules;
    if (scale === 'known') overall += this.WEIGHTS.scale;
    if (acceptanceCriteria === 'known') overall += this.WEIGHTS.acceptanceCriteria;

    return {
      overall,
      productForm,
      targetUsers,
      coreFeatures,
      dataModel,
      businessRules,
      scale,
      acceptanceCriteria,
      gaps,
    };
  }

  /** 判断是否可以生成方案 */
  isReadyForPlan(report: CompletenessReport): boolean {
    return report.overall >= 70;
  }

  /** 判断是否需要继续追问 */
  needsMoreQuestions(report: CompletenessReport): boolean {
    return report.overall < 70 && report.gaps.length > 0;
  }

  /** 获取最优先需要补充的信息 */
  getPriorityGap(report: CompletenessReport): string | null {
    return report.gaps[0] || null;
  }
}
