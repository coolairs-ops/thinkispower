import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SchemaMigrationService } from './schema-migration.service';
import { AppSpec, AppRelation, AppRole, AppMenu, RuoyiDataScope } from './app-spec.types';
import { ParsedModel } from './data-model.types';

/**
 * IR → AppSpec 组装器（适配器①）。
 *
 * 把一个已有项目的 IR（dataModel + structuredRequirement.relations + planSummary.roles/pages）
 * 自动组装成 AppSpec，喂 RuoyiRuntime.provisionApp ——让"现有项目一键嫁接若依"、"以后生成的程序自动出若依版"。
 * 复用路B 已有的 Prisma 解析（SchemaMigrationService.parseAndValidate），不重造。
 * 纯函数 assemble() 可单测；fromProject() 负责载项目 + ownership。
 */
@Injectable()
export class AppSpecAssemblerService {
  private readonly logger = new Logger(AppSpecAssemblerService.name);

  constructor(
    private prisma: PrismaService,
    private schema: SchemaMigrationService,
  ) {}

  /** 载项目（校 ownership）→ 组装 AppSpec。 */
  async fromProject(userId: string, projectId: string): Promise<AppSpec> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, dataModel: true, structuredRequirement: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    if (!project.dataModel?.trim()) throw new NotFoundException('项目无数据模型（dataModel 为空，先完成建模）');

    const entities = this.schema.parseAndValidate(project.dataModel);
    const spec = this.assemble(entities, project.structuredRequirement, project.planSummary);
    this.logger.log(
      `组装 AppSpec ${projectId}: 实体 ${spec.entities.length} / 关系 ${spec.relations?.length ?? 0} / 角色 ${spec.roles.length} / 菜单 ${spec.menus.length}`,
    );
    return spec;
  }

  /** 纯组装：实体 + IR 的 relations/roles/pages → AppSpec。 */
  assemble(rawEntities: ParsedModel[], structuredRequirement: unknown, planSummary: unknown): AppSpec {
    const sr = (structuredRequirement as Record<string, unknown>) || {};
    const plan = (planSummary as Record<string, unknown>) || {};

    // 过滤与若依内置 /system/* 冲突的实体（user/role/menu/dept/dict…），否则生成的 Controller 撞内置映射、若依起不来。
    // 这些能力若依开箱即有（如用户管理），不该再生成 CRUD；其外键列仍保留在引用方。
    const entities = rawEntities.filter((e) => {
      const collide = RUOYI_RESERVED.has(e.table.toLowerCase());
      if (collide) this.logger.warn(`实体 ${e.table} 与若依内置冲突，跳过 codegen（若依已自带该能力）`);
      return !collide;
    });

    // relations：relation-completion 的 Relation 与 AppRelation 字段同构，直接映射（丢弃 none/未确认）
    const rawRels = (sr.relations as Array<Record<string, unknown>>) || [];
    const relations: AppRelation[] = rawRels
      .filter((r) => r && typeof r.parent === 'string' && typeof r.child === 'string' && r.cardinality !== 'none')
      .map((r) => ({
        parent: r.parent as string,
        child: r.child as string,
        cardinality: r.cardinality as string,
        fkField: r.fkField as string | undefined,
        tree: r.tree === true || undefined,
        joinTable: r.joinTable as string | undefined,
        required: r.required as boolean | undefined,
        onDelete: r.onDelete as string | undefined,
      }));

    // roles：planSummary.roles 优先，退 sr.roles；条目可为字符串或 {name}；dataScope 按角色名推
    const rawRoles = firstNonEmptyArray(plan.roles, sr.roles);
    const roles: AppRole[] = rawRoles
      .map((r) => (typeof r === 'string' ? r : ((r as { name?: string; role?: string })?.name ?? (r as { role?: string })?.role ?? '')))
      .filter(Boolean)
      .map((full) => ({ name: cleanRoleName(full), dataScope: deriveDataScope(full) })); // dataScope 用全名(关键词多)，roleName 取清洗后的短名

    // menus：planSummary.pages 优先，退 sr.pages；page {name,route} → menu {name,path,entity?}
    const rawPages = firstNonEmptyArray(plan.pages, sr.pages);
    const menus: AppMenu[] = rawPages
      .map((p) => (typeof p === 'string' ? { name: p } : (p as { name?: string; route?: string; path?: string })))
      .filter((p) => p && p.name)
      .map((p) => ({
        name: p.name!,
        path: p.route || p.path || '/' + p.name!,
        entity: matchEntity(p.name!, entities),
      }));

    const rawRules = firstNonEmptyArray(sr.businessRules, plan.businessRules);
    const businessRules = rawRules
      .map((rule) => typeof rule === 'string'
        ? { name: rule }
        : {
            name: String((rule as { name?: unknown }).name ?? '').trim(),
            trigger: String((rule as { trigger?: unknown }).trigger ?? '').trim() || undefined,
            outcome: String((rule as { outcome?: unknown }).outcome ?? '').trim() || undefined,
          })
      .filter((rule) => rule.name || rule.trigger || rule.outcome);

    return { entities, relations, roles, menus, businessRules };
  }
}

/** 与若依内置 /system/* 业务名冲突的表名（生成 CRUD 会撞内置 Controller 映射→若依起不来）。 */
const RUOYI_RESERVED = new Set(['user', 'role', 'menu', 'dept', 'dict', 'post', 'notice', 'config', 'profile', 'tenant', 'client', 'oss']);

/** 清洗角色名：IR 里角色常是整句描述（"管理员：查看所有…" 或 "销售管理员 — 规划任务…"），按冒号/括号/破折号取短名；
 *  截到 18，给项目标签拼接留余量（若依 role_name ≤30，置备时会拼 `·<项目标签>`）。 */
export function cleanRoleName(full: string): string {
  const head = (full || '').split(/\s*[：:（(，,。、—–-]\s*/)[0].trim();
  return (head || full || '角色').slice(0, 18);
}

/** 角色名 → 若依 data_scope：管理员→全部，仅本人类→仅本人，部门类→本部门(及以下)，默认全部。 */
export function deriveDataScope(name: string): RuoyiDataScope {
  const n = name || '';
  if (/(仅本人|本人|个人|自己|普通员工|^员工$)/.test(n)) return '5';
  if (/(本部门及以下|部门及以下)/.test(n)) return '4';
  if (/(本部门|部门)/.test(n)) return '3';
  if (/(管理员|超级|admin|总|主管|经理)/i.test(n)) return '1';
  return '1'; // 默认全部（不破坏一般管理系统；需收紧的角色由名字关键词命中或后续显式配）
}

/** 页面名 → 关联实体（best-effort，按实体名/表名包含匹配，匹配不到留空）。 */
function matchEntity(pageName: string, entities: ParsedModel[]): string | undefined {
  const p = pageName.toLowerCase();
  const hit = entities.find((e) => p.includes(e.name.toLowerCase()) || p.includes(e.table.toLowerCase()));
  return hit?.table;
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}
