import { NotFoundException } from '@nestjs/common';
import { RuleTemplateController } from './rule-template.controller';
import { RULE_TEMPLATES } from './rule-templates';
import { RuleEngineService } from './rule-engine.service';

describe('RuleTemplateController + 行业模板注册表（机制1）', () => {
  const ctrl = new RuleTemplateController();

  it('列表：返回模板元数据（不含完整 rulePack，轻量）', () => {
    const { templates } = ctrl.list();
    expect(templates.length).toBeGreaterThanOrEqual(1);
    const yj = templates.find((t) => t.industryTag === '药监')!;
    expect(yj.id).toBe('yaojian-risk');
    expect((yj as any).rulePack).toBeUndefined(); // 列表不带重内容
  });

  it('取单个：返回完整 rulePack + 样例案例', () => {
    const t = ctrl.get('yaojian-risk');
    expect(t.rulePack.meta.industry_tag).toBe('药监');
    expect(t.sample.related['检查记录'].length).toBeGreaterThan(0);
  });

  it('未知模板 → 404', () => {
    expect(() => ctrl.get('nope')).toThrow(NotFoundException);
  });

  it('每个模板都能被引擎跑通（模板自洽，样例真能出结论）', () => {
    const engine = new RuleEngineService();
    for (const t of RULE_TEMPLATES) {
      const r = engine.evaluate(t.rulePack, t.sample, '2026-06-21');
      expect(r.ruleEngineEnabled).toBe(true);
      expect(r.finalConclusions.length).toBeGreaterThan(0); // 模板+样例必出至少一个结论
    }
  });
});
