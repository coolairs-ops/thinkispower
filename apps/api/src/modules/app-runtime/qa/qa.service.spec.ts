import { NotFoundException } from '@nestjs/common';
import { QaService } from './qa.service';

describe('QaService（生成 app 智能问答活数据）', () => {
  function build(project: any, answer = 'AI 回答') {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue(project) } };
    const deepseek = { chat: jest.fn().mockResolvedValue(answer) };
    return { svc: new QaService(prisma as any, deepseek as any), deepseek };
  }

  it('基于项目数据模型/规则上下文回答', async () => {
    const { svc, deepseek } = build({ name: '监管平台', dataModel: 'model Company { id String @id }', structuredRequirement: { rulePack: { meta: {} } } });
    const r = await svc.answer('p1', '这家为什么高风险？');
    expect(r.answer).toBe('AI 回答');
    const userMsg = deepseek.chat.mock.calls[0][0][1].content;
    expect(userMsg).toContain('model Company'); // 注入数据模型
    expect(userMsg).toContain('启用了风险评分'); // 规则上下文
    expect(userMsg).toContain('这家为什么高风险？');
  });

  it('空回答兜底', async () => {
    const { svc } = build({ name: 'X', dataModel: null, structuredRequirement: {} }, '');
    expect((await svc.answer('p1', 'hi')).answer).toContain('暂时无法回答');
  });

  it('项目不存在 → 404', async () => {
    const { svc } = build(null);
    await expect(svc.answer('p1', 'hi')).rejects.toBeInstanceOf(NotFoundException);
  });
});
