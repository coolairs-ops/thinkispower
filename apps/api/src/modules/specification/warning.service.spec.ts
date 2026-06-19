import { WarningService } from './warning.service';

describe('WarningService（项目状态提醒面板）', () => {
  let prisma: any;
  let svc: WarningService;

  const businessPattern = {
    patternKey: 'no_maintenance_plan',
    publicName: '上线后谁来维护想好了吗',
    commonCauses: ['只关注"做出来"'],
    recommendedActions: ['确认上线后谁来负责日常维护'],
    severity: 'medium',
    signals: { statusIn: ['spec_confirmed', 'demo_ready'], missingKeyword: ['维护'] },
  };

  // 技术类（生成/验证管线 autoFix），signals 是 regex/keywords 日志匹配型
  const technicalPattern = {
    patternKey: 'html_structure_corrupted',
    publicName: '页面结构异常',
    commonCauses: ['DeepSeek 返回的 HTML 片段不完整'],
    recommendedActions: { fixPrompt: '...', fallbackStrategy: 'retry' },
    severity: 'critical',
    signals: { regex: ['缺少 DOCTYPE'], keywords: ['DOCTYPE', 'html'] },
  };

  const makePrisma = (patterns: any[], status: string) => ({
    project: {
      findUnique: jest.fn().mockResolvedValue({
        status,
        description: '门店巡检系统',
        structuredRequirement: {},
        planSummary: {},
      }),
    },
    errorPattern: { findMany: jest.fn().mockResolvedValue(patterns) },
    specification: { findUnique: jest.fn().mockResolvedValue(null) },
  });

  it('技术类(regex/keywords)模式不出现在用户提醒面板', async () => {
    prisma = makePrisma([technicalPattern], 'demo_ready');
    svc = new WarningService(prisma as never);
    const r = await svc.analyze('p1');
    expect(r).toHaveLength(0);
  });

  it('业务模式在状态命中时出现', async () => {
    prisma = makePrisma([businessPattern], 'spec_confirmed');
    svc = new WarningService(prisma as never);
    const r = await svc.analyze('p1');
    expect(r).toHaveLength(1);
    expect(r[0].patternKey).toBe('no_maintenance_plan');
  });

  it('业务模式在状态不命中时不出现', async () => {
    prisma = makePrisma([businessPattern], 'clarifying');
    svc = new WarningService(prisma as never);
    const r = await svc.analyze('p1');
    expect(r).toHaveLength(0);
  });

  it('混合时只返回命中的业务模式，技术类全过滤', async () => {
    prisma = makePrisma([businessPattern, technicalPattern], 'demo_ready');
    svc = new WarningService(prisma as never);
    const r = await svc.analyze('p1');
    expect(r.map((w) => w.patternKey)).toEqual(['no_maintenance_plan']);
  });
});
