import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExperienceRecommendationController } from './experience-recommendation.controller';

/** A1 安全洞修复：端点原无 owner 校验 → 补 requireOwner，越权读/生成他人项目经验推荐被挡。 */
describe('ExperienceRecommendationController owner 校验 (A1)', () => {
  const make = (projUserId: string | null) => {
    const service = { findByProject: jest.fn().mockResolvedValue({ ok: 1 }), generateRecommendations: jest.fn().mockResolvedValue({ gen: 1 }) };
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue(projUserId === null ? null : { userId: projUserId }) } };
    return { ctrl: new ExperienceRecommendationController(service as any, prisma as any), service };
  };
  const req = { user: { id: 'u1' } };

  it('owner → 放行', async () => {
    const { ctrl, service } = make('u1');
    await ctrl.getRecommendations(req, 'p1');
    expect(service.findByProject).toHaveBeenCalledWith('p1');
  });

  it('非 owner → Forbidden（堵越权读他人项目）', async () => {
    const { ctrl, service } = make('other');
    await expect(ctrl.getRecommendations(req, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findByProject).not.toHaveBeenCalled();
  });

  it('项目不存在 → NotFound', async () => {
    const { ctrl } = make(null);
    await expect(ctrl.generateRecommendations(req, 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
