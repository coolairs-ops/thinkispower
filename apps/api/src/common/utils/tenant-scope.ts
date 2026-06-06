import { ForbiddenException } from '@nestjs/common';

/**
 * 租户作用域 —— 统一取代分散的 `if (resource.userId !== userId) throw Forbidden` 检查。
 *
 * 用法：
 *   - 资源归属校验：assertOrgAccess(project.orgId, ctx.orgId)
 *   - 查询作用域：prisma.project.findMany({ where: orgScope(ctx.orgId) })
 *
 * 这是应用层防线（2-1c-1）；2-1c-2 会用 Postgres RLS 做 DB 层兜底。
 */

export interface TenantContext {
  userId: string;
  /** 当前活跃租户；2-1b 后每个老用户都有 personal org，理论上非空 */
  orgId: string | null;
}

/**
 * 校验资源是否属于当前租户。
 * @param resourceOrgId 资源的 orgId
 * @param ctxOrgId 当前请求的 orgId
 * @param opts.allowLegacyNull 过渡期：是否放行尚未回填 orgId 的旧数据（默认 false）
 */
export function assertOrgAccess(
  resourceOrgId: string | null | undefined,
  ctxOrgId: string | null | undefined,
  opts: { allowLegacyNull?: boolean } = {},
): void {
  if (!ctxOrgId) throw new ForbiddenException('无有效的租户上下文');
  if (resourceOrgId == null) {
    if (opts.allowLegacyNull) return;
    throw new ForbiddenException('资源未归属租户');
  }
  if (resourceOrgId !== ctxOrgId) {
    throw new ForbiddenException('无权访问该租户的资源');
  }
}

/** 租户作用域过滤条件（用于 prisma where） */
export function orgScope(ctxOrgId: string | null | undefined): { orgId: string } {
  if (!ctxOrgId) throw new ForbiddenException('无有效的租户上下文');
  return { orgId: ctxOrgId };
}
