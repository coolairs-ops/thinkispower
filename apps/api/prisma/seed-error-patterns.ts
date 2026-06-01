import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PATTERNS = [
  {
    patternKey: 'requirement_too_vague',
    name: '需求太模糊',
    publicName: '你的需求描述可能还不够清楚',
    stage: 'clarifying',
    signals: { completenessBelow: 30, statusIn: ['needs_input', 'clarifying'] },
    commonCauses: ['不知道如何描述业务需求', '对软件功能不熟悉', '缺少参考案例'],
    recommendedActions: ['多补充一些具体使用场景', '可以看看同行业的参考产品', '平台会继续问你一些问题帮你理清'],
  },
  {
    patternKey: 'too_many_must_functions',
    name: '第一版功能太多',
    publicName: '第一版想做的功能可能有点多',
    stage: 'plan_ready',
    signals: { mustHaveCountAbove: 8, statusIn: ['plan_ready', 'spec_ready'] },
    commonCauses: ['想把所有想法一次做完', '低估了每个功能的开发工作量', '没区分"必须有"和"最好有"'],
    recommendedActions: ['把功能分成"第一版必须有"和"以后再做"', '第一版建议控制在5-8个核心功能', '可以把次要功能放到第二版'],
  },
  {
    patternKey: 'budget_insufficient',
    name: '预算明显不足',
    publicName: '预算可能不够覆盖所有需求',
    stage: 'plan_ready',
    signals: { estimatedCostBelow: 500, highRiskCountAbove: 1, statusIn: ['plan_ready', 'spec_ready'] },
    commonCauses: ['对软件开发成本不了解', '认为AI生成就是零成本', '忽略了测试、部署、维护的成本'],
    recommendedActions: ['重新评估预算或缩小功能范围', '建议预算至少覆盖核心功能的开发和部署', '可以先做一个最小可用版本验证效果'],
  },
  {
    patternKey: 'timeline_too_short',
    name: '上线时间太短',
    publicName: '期望的上线时间可能太紧张',
    stage: 'plan_ready',
    signals: { estimatedDaysBelow: 7, totalFunctionsAbove: 5, statusIn: ['plan_ready', 'spec_ready'] },
    commonCauses: ['低估了开发到上线的完整周期', '没有预留测试和修复时间', '以为AI能瞬间完成所有工作'],
    recommendedActions: ['预留测试和修复的时间（通常是开发时间的30%）', '如果时间紧，建议缩小第一版功能范围', '可以分阶段上线，先上核心功能'],
  },
  {
    patternKey: 'payment_complexity_underestimated',
    name: '支付复杂度被低估',
    publicName: '支付功能比想象中复杂很多',
    stage: 'plan_ready',
    signals: { hasKeyword: ['支付', '付款', '充值', '会员', '订单'], statusIn: ['plan_ready', 'spec_ready', 'spec_confirmed'] },
    commonCauses: ['支付涉及资金安全需要多方审核', '对接微信/支付宝需要企业资质', '退款、对账、异常处理逻辑复杂'],
    recommendedActions: ['第一版可以考虑简化支付（如手动确认）', '支付功能建议有专业技术人员把关', '预留足够的对接和测试时间'],
  },
  {
    patternKey: 'admin_panel_ignored',
    name: '后台管理被忽略',
    publicName: '别忘了后台管理系统',
    stage: 'plan_ready',
    signals: { hasKeyword: ['用户', '客户', '订单', '管理'], missingKeyword: ['后台', '管理后台', '管理员'], statusIn: ['plan_ready', 'spec_ready'] },
    commonCauses: ['只关注用户端功能忽略了运营端', '以为数据可以在数据库里直接改', '没有考虑非技术人员的操作体验'],
    recommendedActions: ['确认是否需要后台管理页面', '后台管理通常包括：数据查看、增删改查、权限管理', '即使管理员只有一个人，也需要基本的管理界面'],
  },
  {
    patternKey: 'permission_complexity_underestimated',
    name: '权限角色复杂度被低估',
    publicName: '权限管理可能比你想的复杂',
    stage: 'plan_ready',
    signals: { hasKeyword: ['管理员', '员工', '角色', '权限', '老板', '经理'], functionCountAbove: 5, statusIn: ['plan_ready', 'spec_ready'] },
    commonCauses: ['角色权限设计需要梳理业务流程', '不同角色看到的数据和功能不同', '权限变更和数据安全需要额外考虑'],
    recommendedActions: ['先列出所有用户角色', '明确每个角色能看什么、能做什么', '简单项目可以先做"管理员"和"普通用户"两个角色'],
  },
  {
    patternKey: 'report_complexity_underestimated',
    name: '报表统计复杂度被低估',
    publicName: '报表和统计功能需要仔细规划',
    stage: 'plan_ready',
    signals: { hasKeyword: ['统计', '报表', '数据', '分析', '图表', '看板'], statusIn: ['plan_ready', 'spec_ready'] },
    commonCauses: ['报表需要明确的数据字段和计算逻辑', '不同角色需要不同的统计维度', '数据量大时性能需要额外优化'],
    recommendedActions: ['明确需要哪些统计指标', '确认数据来源是否在系统中', '第一版先做核心指标，复杂报表后续迭代'],
  },
  {
    patternKey: 'reference_product_overreliance',
    name: '参考产品依赖过强',
    publicName: '只模仿参考产品可能不够',
    stage: 'clarifying',
    signals: { hasKeyword: ['像', '参考', '模仿', '类似', '和...一样'], completenessBelow: 50, statusIn: ['needs_input', 'clarifying'] },
    commonCauses: ['只描述了参考产品但没有说自己的差异化需求', '每个业务的实际流程和参考产品不同', '参考产品可能有自己不需要的功能'],
    recommendedActions: ['描述你和参考产品的业务有什么不同', '哪些功能是你必须有的但参考产品没有', '哪些参考产品的功能你可以不需要'],
  },
  {
    patternKey: 'no_maintenance_plan',
    name: '缺少上线后维护计划',
    publicName: '上线后谁来维护想好了吗',
    stage: 'spec_confirmed',
    signals: { statusIn: ['spec_confirmed', 'developing', 'demo_ready'], missingKeyword: ['维护', '更新', '迭代', '后续'] },
    commonCauses: ['只关注"做出来"没想"做完之后怎么办"', '以为上线后就不用管了', '没有考虑数据备份和安全更新'],
    recommendedActions: ['确认上线后谁来负责日常维护', '考虑数据备份策略', '预留后续功能迭代的预算和周期'],
  },
];

async function main() {
  console.log(`Seeding ${PATTERNS.length} error patterns...`);

  for (const p of PATTERNS) {
    await prisma.errorPattern.upsert({
      where: { patternKey: p.patternKey },
      create: {
        patternKey: p.patternKey,
        name: p.name,
        publicName: p.publicName,
        stage: p.stage,
        signals: p.signals,
        commonCauses: p.commonCauses,
        recommendedActions: p.recommendedActions,
        severity: 'medium',
        autoFixable: false,
      },
      update: {
        name: p.name,
        publicName: p.publicName,
        stage: p.stage,
        signals: p.signals,
        commonCauses: p.commonCauses,
        recommendedActions: p.recommendedActions,
      },
    });
  }

  console.log('Done.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
