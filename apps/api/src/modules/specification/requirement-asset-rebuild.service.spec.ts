import { BadRequestException } from '@nestjs/common';
import { RequirementAssetRebuildService } from './requirement-asset-rebuild.service';

describe('RequirementAssetRebuildService', () => {
  const userId = 'u1';
  const orgId = 'o1';
  const projectId = 'p1';
  const answers = [
    { question: '给这个项目起个名字吧？（可以暂时起一个，以后可以改）', answer: '以岭财务大模型' },
    { question: '用一句话描述你的想法——这个产品是做什么的？', answer: '解决财务智能问数的问题' },
    { question: '第一个真实的用户是谁？描述一下这个人。', answer: '公司董事长，随时用各种维度组合查询公司各种来源数据的人' },
    { question: '从头到尾走一遍：用户怎么进入、怎么操作、怎么得到结果？', answer: '用户用自己的账号登入，在智能问数的对话框里输入查询数字，得到来自各个程序和本地知识库的数据，根据问题进行组合和计算，最后呈现' },
    { question: '第一版绝对必须有的功能是哪些？（列2-5个）', answer: '不同权限用户登录，财务是管理和上传数据的，信息中心的是系统管理员，几个部门的领导是问数的' },
    { question: '最小的能验证想法的版本长什么样？', answer: '能对接各种财务软件的接口，能整合各种各样格式的数据' },
    { question: '这个产品需要存储什么数据？比如用户信息、订单、文章？', answer: '财务数据，各种格式的财务文档' },
    { question: '数据是存在本地就够了，还是需要云端同步？', answer: '本地' },
    { question: '怎么判断第一版做成功了？验收标准是什么？', answer: '能把有程序管的数据通过接口接进来，能把散落在各地的pdf、excel以及文档中的财务数据结构化出来并存到知识库' },
    { question: '哪些地方如果出错会让用户失去信任？', answer: '数据的呈现和问题对不上，数据接不进来，散落的数据处理不好' },
    { question: '最后交付时，你希望你能做什么来验证？', answer: '问几个问题' },
  ];

  function makeService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: projectId,
          userId,
          orgId,
          name: '以岭财务管理系统',
          description: '',
          status: 'completed',
          structuredRequirement: { ideaInterview: { answers } },
          planSummary: { pages: [], features: [], roles: [], dataObjects: [] },
          ...overrides,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      specification: {
        findUnique: jest.fn().mockResolvedValue({ version: 2, changeLog: [{ version: 2, action: 'old' }] }),
        upsert: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 's1', ...args.update })),
      },
      projectMessage: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const statusMapper = {
      assertValidTransition: jest.fn(),
      mapProjectStatusToPublicLabel: jest.fn().mockReturnValue('规格已生成，等待确认'),
    };
    return { svc: new RequirementAssetRebuildService(prisma as any, statusMapper as any), prisma, statusMapper };
  }

  it('从访谈答案重建需求资产、方案和规格', async () => {
    const { svc, prisma, statusMapper } = makeService();

    const result = await svc.rebuildFromInterview(userId, orgId, projectId);

    expect(result.success).toBe(true);
    expect(result.counts.roles).toBeGreaterThanOrEqual(3);
    expect(result.counts.coreFunctions).toBeGreaterThanOrEqual(4);
    expect(result.counts.dataModels).toBeGreaterThanOrEqual(4);
    expect(result.counts.businessRules).toBeGreaterThanOrEqual(4);
    expect(result.counts.acceptanceScenarios).toBeGreaterThanOrEqual(4);

    const specUpdate = prisma.specification.upsert.mock.calls[0][0].update;
    expect(specUpdate.version).toBe(3);
    expect(specUpdate.status).toBe('draft');
    expect(specUpdate.frozenAt).toBeNull();
    expect(specUpdate.verificationResults).toBeNull();
    expect(specUpdate.passRate).toBeNull();
    expect(specUpdate.verifiedAt).toBeNull();
    expect(specUpdate.coreFunctions.map((f: any) => f.name)).toEqual(expect.arrayContaining(['智能问数']));
    expect(specUpdate.businessRules.map((r: any) => r.name)).toEqual(expect.arrayContaining(['问数结果一致性规则']));
    expect(specUpdate.acceptanceScenarios.map((s: any) => s.name)).toEqual(expect.arrayContaining(['智能问数验收']));
    expect(specUpdate.changeLog.at(-1).action).toBe('rebuild_from_interview');

    const projectUpdate = prisma.project.update.mock.calls[0][0].data;
    expect(projectUpdate.planSummary.features).toEqual(expect.arrayContaining([expect.stringContaining('智能问数')]));
    expect(projectUpdate.structuredRequirement.roles.length).toBeGreaterThan(0);
    expect(projectUpdate.status).toBe('spec_ready');
    expect(projectUpdate.specConfirmedAt).toBeNull();
    expect(statusMapper.assertValidTransition).toHaveBeenCalledWith('completed', 'spec_ready');
    expect(prisma.projectMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: 'system_internal',
        metadata: expect.objectContaining({ action: 'requirement_asset_rebuild' }),
      }),
    }));
  });

  it('没有访谈答案时不重建', async () => {
    const { svc, prisma } = makeService({ structuredRequirement: { ideaInterview: { answers: [] } } });

    await expect(svc.rebuildFromInterview(userId, orgId, projectId)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.specification.upsert).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
