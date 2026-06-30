import {
  buildRequirementUplift,
  mergeRequirementUplift,
  buildPlanSeedFromRequirement,
} from './requirement-uplift.service';

describe('requirement uplift', () => {
  const answers = [
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

  it('从访谈答案提升五类核心结构化资产', () => {
    const uplift = buildRequirementUplift(answers, { projectName: '以岭财务管理系统' });

    expect(uplift.roles.map((r) => r.role)).toEqual(expect.arrayContaining(['领导用户', '财务人员', '信息中心管理员']));
    expect(uplift.coreFunctions.map((f) => f.name)).toEqual(expect.arrayContaining(['智能问数', '多源系统数据接入', '文档结构化与知识库沉淀']));
    expect(uplift.dataObjects).toEqual(expect.arrayContaining(['财务数据', '财务文档', '知识库条目', '外部数据源']));
    expect(uplift.businessRules.map((r) => r.name)).toEqual(expect.arrayContaining(['角色数据权限规则', '问数结果一致性规则', '文档结构化入库规则']));
    expect(uplift.acceptanceScenarios.map((s) => s.name)).toEqual(expect.arrayContaining(['智能问数验收', '外部数据接入验收', '文档结构化验收']));
    expect(uplift.missingSlots).toEqual([]);
  });

  it('合并时不能让空结构覆盖提升结果，并能生成方案种子', () => {
    const uplift = buildRequirementUplift(answers, { projectName: '以岭财务管理系统' });
    const merged = mergeRequirementUplift(
      {
        coreFunctions: [],
        roles: [],
        dataModels: [],
        businessRules: [],
        acceptanceScenarios: [],
        prd: { features: [], roles: [], dataObjects: [] },
      },
      uplift,
      { projectName: '以岭财务管理系统' },
    );
    const seed = buildPlanSeedFromRequirement(merged);

    expect((merged.coreFunctions as unknown[]).length).toBeGreaterThan(0);
    expect((merged.roles as unknown[]).length).toBeGreaterThan(0);
    expect((merged.dataModels as unknown[]).length).toBeGreaterThan(0);
    expect((merged.businessRules as unknown[]).length).toBeGreaterThan(0);
    expect((merged.acceptanceScenarios as unknown[]).length).toBeGreaterThan(0);
    expect(seed.features).toEqual(expect.arrayContaining([expect.stringContaining('智能问数')]));
    expect(seed.acceptanceChecklist.length).toBeGreaterThan(0);
  });
});
