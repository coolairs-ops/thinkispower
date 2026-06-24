import { inferFulfillment } from './capability-provenance';

describe('inferFulfillment（能力来源分类 · ADR-0008 D1）', () => {
  describe('backend（后端底座能力，HTML 看不见，已由若依交付）', () => {
    it.each([
      '功能: 多用户权限管理',
      '页面: 登录页',
      '权限控制: 操作被拒绝，仅管理员可执行',
      'MVP: 多用户权限管理',
      '数据隔离：普通用户只看自己的数据',
      '功能: RBAC 角色权限',
    ])('%s → backend', (c) => {
      expect(inferFulfillment(c).fulfilledBy).toBe('backend');
    });
  });

  describe('external（必须外部对接，带协议端口）', () => {
    it.each([
      ['工单支持语音转写', 'asr'],
      ['拍照识别身份证自动填表', 'ocr'],
      ['审批对接外部 OA 系统', 'oa'],
      ['提交前做行业规则包合规校验', 'rulepack'],
      ['注册发短信验证码', 'sms'],
      ['门店地图服务定位', 'map'],
      ['订单在线支付', 'payment'],
      ['数据同步至外部系统对接', 'generic'],
    ])('%s → external/%s', (c, protocol) => {
      const v = inferFulfillment(c);
      expect(v.fulfilledBy).toBe('external');
      expect(v.protocol).toBe(protocol);
    });
  });

  describe('deferred（本期不做，移出分母）', () => {
    it.each(['功能: 数据大屏（本期不做）', '高级报表 二期 再做', '多语言暂不支持'])('%s → deferred', (c) => {
      expect(inferFulfillment(c).fulfilledBy).toBe('deferred');
    });

    it('延期优先于其它信号（即便含后端词）', () => {
      expect(inferFulfillment('权限控制本期不做').fulfilledBy).toBe('deferred');
    });
  });

  describe('self（前端可实现，保守默认）', () => {
    it.each([
      '页面: 咨询回复',
      '功能: 产品和功能咨询',
      'MVP: 售后咨询',
      '功能: 售前自动回复',
      '录入产品信息',
      '已录入产品列表',
      '随便一句没有任何信号的需求',
    ])('%s → self', (c) => {
      expect(inferFulfillment(c).fulfilledBy).toBe('self');
    });

    it('空串 → self', () => {
      expect(inferFulfillment('').fulfilledBy).toBe('self');
      expect(inferFulfillment(undefined as never).fulfilledBy).toBe('self');
    });
  });

  it('命中注册表时带 capId + maturity（供 gap_workflow 回指）', () => {
    const login = inferFulfillment('页面: 登录页');
    expect(login.fulfilledBy).toBe('backend');
    expect(login.capId).toBe('PLG-rbac');
    expect(login.reason).toMatch(/green/); // maturity 进 reason
    const asr = inferFulfillment('工单语音转写');
    expect(asr.capId).toBe('PLG-asr');
    expect(asr.reason).toMatch(/red/);
  });

  it('品类外 → deferred（OUT_OF_SCOPE）', () => {
    expect(inferFulfillment('支持实时音视频通话').fulfilledBy).toBe('deferred');
    expect(inferFulfillment('高并发C端秒杀').fulfilledBy).toBe('deferred');
  });

  // 截图实测：11 项「未实现」分类后，backend 类应被救出（不再算 self 的 HTML 未实现）
  it('截图 11 项 missing：权限/登录类归 backend，咨询类留 self', () => {
    const missing = [
      '售前自动回复', '售后问题处理', '权限控制', '页面: 咨询回复', '页面: 登录页',
      '功能: 产品和功能咨询', '功能: 售后咨询', '功能: 多用户权限管理',
      'MVP: 产品和功能咨询', 'MVP: 售后咨询', 'MVP: 多用户权限管理',
    ];
    const byBucket = missing.map((m) => inferFulfillment(m).fulfilledBy);
    // 登录页 + 权限控制 + 多用户权限管理×2 = 4 项归 backend（若依已交付，应被信用）
    expect(byBucket.filter((b) => b === 'backend')).toHaveLength(4);
    // 其余咨询/回复类留 self（HTML 缺 UI，迭代该补）
    expect(byBucket.filter((b) => b === 'self')).toHaveLength(7);
  });
});

describe('生成器缺口（self 但缺 block，maturity=red · ADR-0008 D6）', () => {
  it.each([
    ['多步向导填报', 'PLG-wizard'],
    ['销售趋势图表', 'PLG-chart'],
    ['任务拖拽看板', 'PLG-kanban'],
    ['审批流程图可视化', 'PLG-flow'],
  ])('%s → self + red + %s', (c, capId) => {
    const v = inferFulfillment(c);
    expect(v.fulfilledBy).toBe('self'); // 仍是前端 UI（self），不是 external
    expect(v.maturity).toBe('red'); // 但生成器产不出 → 缺口
    expect(v.capId).toBe(capId);
  });

  it('问答/聊天已补第 7 块 qa → PLG-chat-qa 翻 green（自迭代能闭合）', () => {
    const v = inferFulfillment('售前自动回复');
    expect(v.fulfilledBy).toBe('self');
    expect(v.capId).toBe('PLG-chat-qa');
    expect(v.maturity).toBe('green'); // 🔴→🟢：生成器现已能产
  });

  it('生成器能产的 self 仍是 green（录入/列表/看板）', () => {
    expect(inferFulfillment('录入产品信息').maturity).toBe('green');
    expect(inferFulfillment('数据看板展示').maturity).toBe('green');
  });
});
