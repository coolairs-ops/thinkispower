import { buildDataContract, contractPromptBlock, extractAppDataResources, checkContractConformance } from './app-contract';
import { ParsedModel, ModelField } from './data-model.types';

const f = (name: string): ModelField => ({ name, prismaType: 'String', optional: false, isId: false, isUnique: false });
const entities: ParsedModel[] = [
  { name: 'Customer', table: 'customer', fields: [f('id'), f('name'), f('level'), f('create_by'), f('tenant_id')] },
  { name: 'Project', table: 'project', fields: [f('id'), f('amount'), f('customerId')] },
];

describe('app-contract（前端契约桥）', () => {
  it('buildDataContract：资源=表名，字段去掉基础列', () => {
    const c = buildDataContract(entities);
    expect(c.resources).toEqual([
      { name: 'customer', fields: ['id', 'name', 'level'] }, // create_by/tenant_id 被滤
      { name: 'project', fields: ['id', 'amount', 'customerId'] },
    ]);
  });

  it('contractPromptBlock：列出资源+字段的硬约束文本', () => {
    const block = contractPromptBlock(buildDataContract(entities));
    expect(block).toContain('数据契约');
    expect(block).toContain('- customer：id、name、level');
    expect(block).toContain('- project：id、amount、customerId');
    expect(block).toContain('禁止使用未列出的资源名或字段');
  });

  it('contractPromptBlock：空契约 → 空串', () => {
    expect(contractPromptBlock({ resources: [] })).toBe('');
  });

  it('extractAppDataResources：抽出 appData 调用的资源名（去重）', () => {
    const html = `<script>
      appData.list('customer',{}); appData.create("project",{}); appData.get('customer', id);
      appData.remove('order', 1);
    </script>`;
    expect(extractAppDataResources(html).sort()).toEqual(['customer', 'order', 'project']);
  });

  it('checkContractConformance：资源 ⊆ 契约 → ok；越界资源被揪出', () => {
    const c = buildDataContract(entities);
    const good = `appData.list('customer'); appData.create('project',{})`;
    expect(checkContractConformance(good, c)).toEqual({ ok: true, unknownResources: [] });
    const bad = `appData.list('customer'); appData.list('order'); appData.get('invoice',1)`;
    expect(checkContractConformance(bad, c)).toEqual({ ok: false, unknownResources: ['order', 'invoice'] });
  });
});
