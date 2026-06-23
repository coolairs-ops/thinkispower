import { ForbiddenException } from '@nestjs/common';
import { assertOrgAccess, orgScope, assertResourceAccess } from './tenant-scope';

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

describe('assertResourceAccess（A3 共用：org 边界 + userId 归属二维）', () => {
  const res = (orgId: string | null, userId: string) => ({ orgId, userId });

  it('同租户 + 同 owner → 放行', () => {
    expect(() => assertResourceAccess(res('org-1', 'u1'), 'u1', 'org-1')).not.toThrow();
  });

  it('跨租户（资源 org 与上下文 org 不符）→ 拒绝', () => {
    expect(() => assertResourceAccess(res('org-2', 'u1'), 'u1', 'org-1')).toThrow(ForbiddenException);
  });

  it('同租户但非 owner → 拒绝(组织内归属)', () => {
    expect(() => assertResourceAccess(res('org-1', 'other'), 'u1', 'org-1')).toThrow(ForbiddenException);
  });

  it('无 org 上下文（旧会话）→ 退回纯 userId 归属', () => {
    expect(() => assertResourceAccess(res('org-1', 'u1'), 'u1', null)).not.toThrow();
    expect(() => assertResourceAccess(res('org-1', 'other'), 'u1', null)).toThrow(ForbiddenException);
  });

  it('过渡期：资源 orgId 未回填(null)但有 org 上下文 → allowLegacyNull 放行后查 owner', () => {
    expect(() => assertResourceAccess(res(null, 'u1'), 'u1', 'org-1')).not.toThrow();
    expect(() => assertResourceAccess(res(null, 'other'), 'u1', 'org-1')).toThrow(ForbiddenException);
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
