import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AcceptanceVerificationService } from './acceptance-verification.service';
import { FusedReport } from '../../sensors/sensor-report.interface';

describe('AcceptanceVerificationService', () => {
  let prisma: {
    project: { findUnique: jest.Mock };
    specification: { findUnique: jest.Mock; update: jest.Mock };
  };
  let sensors: { runAll: jest.Mock };
  let llm: { chat: jest.Mock };
  let service: AcceptanceVerificationService;

  const scenarios = [
    { name: '成功登录', given: '已注册', when: '输入正确密码', then: '进入首页', priority: 'must', coverage: ['登录'], provenance: ['PRD.txt'] },
    { name: '下单', given: '在购物车', when: '点击结算', then: '生成订单', priority: 'must', coverage: ['下单'], provenance: ['PRD.txt', '补充.md'] },
  ];

  const fused: FusedReport = {
    overallScore: 82, layer1Score: 80, layer2Score: 85, layer3Score: 80,
    passed: true, recommendations: [], stopIteration: false,
    reports: [
      { sensorName: 'L3-语义评估', layer: 3, passed: true, score: 80, checks: [
        { name: '登录流程', passed: true, score: 90, weight: 10, detail: '登录入口完整' },
      ] },
    ],
  };

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', demoHtml: '<!DOCTYPE html><body>登录 下单</body>', description: 'shop' }) },
      specification: {
        findUnique: jest.fn().mockResolvedValue({ projectId: 'p1', version: 2, acceptanceScenarios: scenarios, changeLog: [] }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    sensors = { runAll: jest.fn().mockResolvedValue(fused) };
    llm = { chat: jest.fn() };
    service = new AcceptanceVerificationService(prisma as never, sensors as never, llm as never);
  });

  it('项目不存在 → NotFound', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service.verify('u1', null, 'p1')).rejects.toThrow(NotFoundException);
  });

  it('跨用户 → Forbidden', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'other', demoHtml: '', description: '' });
    await expect(service.verify('u1', null, 'p1')).rejects.toThrow(ForbiddenException);
  });

  it('无场景 → hasScenarios=false, passRate=null, 不落库', async () => {
    prisma.specification.findUnique.mockResolvedValue({ projectId: 'p1', version: 1, acceptanceScenarios: [], changeLog: [] });
    const r = await service.verify('u1', null, 'p1');
    expect(r.hasScenarios).toBe(false);
    expect(r.passRate).toBeNull();
    expect(prisma.specification.update).not.toHaveBeenCalled();
  });

  it('LLM 逐条判定 → 计算 passRate 并落库 + changeLog', async () => {
    llm.chat.mockResolvedValue(JSON.stringify({
      verdicts: [
        { index: 1, status: 'pass', evidence: '存在登录表单' },
        { index: 2, status: 'fail', evidence: '未发现结算逻辑' },
      ],
    }));

    const r = await service.verify('u1', null, 'p1');

    expect(r.total).toBe(2);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.passRate).toBe(0.5);
    expect(r.overallScore).toBe(82);

    // 落库 verificationResults + passRate + verifiedAt + changeLog
    const data = prisma.specification.update.mock.calls[0][0].data;
    expect(data.passRate).toBe(0.5);
    expect(data.verificationResults).toHaveLength(2);
    expect(data.verifiedAt).toBeInstanceOf(Date);
    expect(data.changeLog[data.changeLog.length - 1]).toEqual(
      expect.objectContaining({ action: 'acceptance-verify', passRate: 0.5 }),
    );

    // 第一条场景含语义证据 + 命中 coverage 的传感器检查 + 平台旁证
    const s1 = r.scenarios[0];
    expect(s1.status).toBe('pass');
    expect(s1.provenance).toEqual(['PRD.txt']);
    expect(s1.checks.some((c) => c.source === '传感器融合')).toBe(true);
  });

  it('demoHtml 为空 → 全部待人工(manual)，passRate=0', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1', demoHtml: '', description: '' });
    const r = await service.verify('u1', null, 'p1');
    expect(r.manual).toBe(2);
    expect(r.passRate).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('LLM 异常 → 场景降级待人工，不抛错', async () => {
    llm.chat.mockRejectedValue(new Error('llm down'));
    const r = await service.verify('u1', null, 'p1');
    expect(r.manual).toBe(2);
    expect(r.scenarios[0].evidence).toContain('暂不可用');
  });

  it('传感器异常不阻断 → 仍能语义判定落库', async () => {
    sensors.runAll.mockRejectedValue(new Error('sensor down'));
    llm.chat.mockResolvedValue(JSON.stringify({ verdicts: [{ index: 1, status: 'pass', evidence: 'ok' }, { index: 2, status: 'pass', evidence: 'ok' }] }));
    const r = await service.verify('u1', null, 'p1');
    expect(r.passRate).toBe(1);
    expect(r.overallScore).toBeNull();
  });

  it('manualConfirm 回写状态并重算 passRate + changeLog', async () => {
    const existing = [
      { scenarioName: '成功登录', status: 'pass', checks: [], coverage: ['登录'], provenance: [], given: '', when: '', then: '', priority: 'must', evidence: '', verifiedAt: '' },
      { scenarioName: '下单', status: 'manual', checks: [], coverage: ['下单'], provenance: [], given: '', when: '', then: '', priority: 'must', evidence: '', verifiedAt: '' },
    ];
    prisma.specification.findUnique.mockResolvedValue({ projectId: 'p1', version: 2, acceptanceScenarios: scenarios, verificationResults: existing, passRate: 0.5, changeLog: [] });

    const r = await service.manualConfirm('u1', null, 'p1', '下单', 'pass', '已人工核对');

    expect(r.passRate).toBe(1);
    const data = prisma.specification.update.mock.calls[0][0].data;
    expect(data.changeLog[0]).toEqual(expect.objectContaining({ action: 'acceptance-verify', reason: expect.stringContaining('人工裁定') }));
    const updated = r.scenarios.find((s) => s.scenarioName === '下单');
    expect(updated!.status).toBe('pass');
    expect(updated!.checks.some((c) => c.source === '人工')).toBe(true);
  });

  it('getReport 读取已落库结果，不重算/不跑传感器', async () => {
    prisma.specification.findUnique.mockResolvedValue({
      projectId: 'p1', version: 3, acceptanceScenarios: scenarios,
      verificationResults: [{ scenarioName: '成功登录', status: 'pass', checks: [], coverage: [], provenance: [], given: '', when: '', then: '', priority: 'must', evidence: '', verifiedAt: '' }],
      passRate: 1, verifiedAt: new Date('2026-06-06T00:00:00Z'),
    });
    const r = await service.getReport('u1', null, 'p1');
    expect(r.passRate).toBe(1);
    expect(r.total).toBe(1);
    expect(sensors.runAll).not.toHaveBeenCalled();
  });
});
