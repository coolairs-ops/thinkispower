import { ForbiddenException } from '@nestjs/common';
import { assertOrgAccess, orgScope } from './tenant-scope';

describe('assertOrgAccess', () => {
  it('资源 org 与上下文 org 一致 → 放行', () => {
    expect(() => assertOrgAccess('org-1', 'org-1')).not.toThrow();
  });

  it('资源 org 与上下文 org 不一致 → 拒绝(跨租户)', () => {
    expect(() => assertOrgAccess('org-2', 'org-1')).toThrow(ForbiddenException);
  });

  it('无租户上下文 → 拒绝', () => {
    expect(() => assertOrgAccess('org-1', null)).toThrow(ForbiddenException);
    expect(() => assertOrgAccess('org-1', undefined)).toThrow(ForbiddenException);
  });

  it('资源未归属租户(null) 默认拒绝', () => {
    expect(() => assertOrgAccess(null, 'org-1')).toThrow(ForbiddenException);
  });

  it('过渡期 allowLegacyNull 放行未回填的旧数据', () => {
    expect(() => assertOrgAccess(null, 'org-1', { allowLegacyNull: true })).not.toThrow();
  });
});

describe('orgScope', () => {
  it('返回 { orgId } 过滤条件', () => {
    expect(orgScope('org-1')).toEqual({ orgId: 'org-1' });
  });

  it('无上下文 → 拒绝(防止无作用域全表查询)', () => {
    expect(() => orgScope(null)).toThrow(ForbiddenException);
    expect(() => orgScope(undefined)).toThrow(ForbiddenException);
  });
});
