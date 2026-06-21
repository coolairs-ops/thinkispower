/**
 * 把实体关系（relation-completion 的产物）消费进若依 codegen 输入（ADR-0003 Phase 2）。
 *
 * 三类关系，三种 codegen 形态：
 *   ① 1—N 主子表（2a）：child 补外键列(DDL) + 父表 gen_table 配 sub(subTableName/subTableFkName)。
 *   ② 自关联/树（2c）：同实体补自外键(parentId,可空) + gen_table 配 tree(treeCode/treeParentCode/treeName)，
 *      走若依原生树表模板。parent===child 即树。
 *   ③ N—N 多对多（2b）：合成中间表实体(两外键)喂 codegen；两端表保持 crud。
 *      跨表 master-detail UI 联动属若依 codegen "更绕"那块（M3c-remaining），本轮只保证中间表落地、双向可查。
 * 纯函数、确定性、零依赖。parent/child 按实体 name 或 table 忽略大小写匹配。
 */
import { ModelField, ParsedModel } from './data-model.types';
import { AppRelation } from './app-spec.types';

export interface RuoyiGenTableMeta {
  tplCategory: 'crud' | 'sub' | 'tree';
  // sub（1—N 主子表）
  subTableName?: string;
  subTableFkName?: string;
  // tree（自关联/树）
  treeCode?: string; // 树主键列 = 实体 pk（如 id）
  treeParentCode?: string; // 树父列 = 自外键（如 parentId）
  treeName?: string; // 树节点显示名列
}

function matches(e: ParsedModel, ref: string): boolean {
  const r = (ref || '').toLowerCase();
  return e.table.toLowerCase() === r || e.name.toLowerCase() === r;
}
function find(entities: ParsedModel[], ref: string): ParsedModel | undefined {
  return entities.find((e) => matches(e, ref));
}
/** 自关联/树：显式 tree 标记，或 parent 与 child 指同一实体。 */
const isTree = (r: AppRelation) => r.tree === true || (r.parent || '').toLowerCase() === (r.child || '').toLowerCase();
/** 1—N 且有外键（含树的自外键）——需要在 child 上补外键列。 */
const oneToMany = (relations: AppRelation[]) => relations.filter((r) => r.cardinality === '1-N' && !!r.fkField);
/** 1—N 主子表（排除树）——父表才配 sub 模板。 */
const subTableRels = (relations: AppRelation[]) => oneToMany(relations).filter((r) => !isTree(r));
const treeRels = (relations: AppRelation[]) => relations.filter((r) => r.cardinality === '1-N' && !!r.fkField && isTree(r));

/**
 * 确保每个 1—N（含树自关联）关系的 child 表含外键列；缺则补 BigInt 外键。返回新实体数组（不改原）。
 * 树的自外键强制可空（根节点无上级）；其余按 required 决定可空。
 */
export function ensureFkColumns(entities: ParsedModel[], relations: AppRelation[] = []): ParsedModel[] {
  const out = entities.map((e) => ({ ...e, fields: [...e.fields] }));
  for (const rel of oneToMany(relations)) {
    const child = find(out, rel.child);
    if (!child) continue;
    if (!child.fields.some((f) => f.name.toLowerCase() === rel.fkField!.toLowerCase())) {
      child.fields.push({
        name: rel.fkField!,
        prismaType: 'BigInt',
        optional: isTree(rel) ? true : rel.required === false,
        isId: false,
        isUnique: false,
      });
    }
  }
  return out;
}

/** 选树节点的显示名列：第一个非主键、非外键的 String 字段，兜底 'name'。 */
function pickTreeName(entity: ParsedModel, parentCode?: string): string {
  const named = entity.fields.find(
    (f) => !f.isId && f.prismaType === 'String' && f.name.toLowerCase() !== (parentCode || '').toLowerCase(),
  );
  return named?.name ?? 'name';
}

/**
 * 实体的若依 gen_table 模板配置：
 *   - 该实体是某自关联/树关系的节点 → tree 模板（treeCode/treeParentCode/treeName）。
 *   - 该实体是某 1—N（非树）的父表 → 主子表 sub（一父仅一子表，多子取第一条，其余仍 crud）。
 *   - 否则 crud。
 * 树优先判（树关系 parent===child，会同时落进 sub 判定，必须先拦）。
 */
export function genTableMeta(entity: ParsedModel, entities: ParsedModel[], relations: AppRelation[] = []): RuoyiGenTableMeta {
  const asTree = treeRels(relations).find((r) => find(entities, r.parent)?.table === entity.table);
  if (asTree) {
    const pk = entity.fields.find((f) => f.isId);
    return {
      tplCategory: 'tree',
      treeCode: pk?.name ?? 'id',
      treeParentCode: asTree.fkField,
      treeName: pickTreeName(entity, asTree.fkField),
    };
  }
  const asParent = subTableRels(relations).find((r) => find(entities, r.parent)?.table === entity.table);
  if (asParent) {
    const child = find(entities, asParent.child);
    if (child) return { tplCategory: 'sub', subTableName: child.table, subTableFkName: asParent.fkField };
  }
  return { tplCategory: 'crud' };
}

/**
 * N—N 多对多 → 合成中间表实体（两端各一 BigInt 外键 + 自增主键）。返回新实体数组（不含原实体）。
 * 中间表名取 relation.joinTable，缺省 `${parentTable}_${childTable}`；外键名 `${端表名}Id`。
 * 已存在同名表（或本批已合成）→ 跳过，幂等。两端实体或缺失 → 跳过。
 */
export function synthesizeJoinEntities(entities: ParsedModel[], relations: AppRelation[] = []): ParsedModel[] {
  const out: ParsedModel[] = [];
  const fk = (e: ParsedModel): ModelField => ({ name: `${e.table}Id`, prismaType: 'BigInt', optional: false, isId: false, isUnique: false });
  for (const rel of relations.filter((r) => r.cardinality === 'N-N')) {
    const p = find(entities, rel.parent);
    const c = find(entities, rel.child);
    if (!p || !c) continue;
    const table = (rel.joinTable || `${p.table}_${c.table}`).toLowerCase();
    if (find(entities, table) || out.some((e) => e.table === table)) continue;
    out.push({
      name: table.replace(/(^|_)([a-z])/g, (_, s, ch) => s.replace('_', '') + ch.toUpperCase()), // snake → Pascal
      table,
      fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: false }, fk(p), fk(c)],
    });
  }
  return out;
}
