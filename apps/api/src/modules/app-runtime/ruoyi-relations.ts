/**
 * 把实体关系（relation-completion 的产物）消费进若依 codegen 输入（ADR-0003 Phase 2a）。
 *
 * 1—N 主子表两件事：
 *   ① 子表补外键列（DDL）——relation.fkField 在 child 实体里若没有就加。
 *   ② 父表算出若依 gen_table 的主子表配置（tplCategory=sub + subTableName + subTableFkName），
 *      M3c-remaining 经 editSave(PUT /tool/gen) 推给若依，让它产 master-detail。
 * 纯函数、确定性、零依赖。parent/child 按实体 name 或 table 忽略大小写匹配。
 */
import { ParsedModel } from './data-model.types';
import { AppRelation } from './app-spec.types';

export interface RuoyiGenTableMeta {
  tplCategory: 'crud' | 'sub' | 'tree';
  subTableName?: string;
  subTableFkName?: string;
}

function matches(e: ParsedModel, ref: string): boolean {
  const r = (ref || '').toLowerCase();
  return e.table.toLowerCase() === r || e.name.toLowerCase() === r;
}
function find(entities: ParsedModel[], ref: string): ParsedModel | undefined {
  return entities.find((e) => matches(e, ref));
}
const oneToMany = (relations: AppRelation[]) => relations.filter((r) => r.cardinality === '1-N' && !!r.fkField);

/** 确保每个 1—N 关系的 child 表含外键列；缺则补 BigInt 外键（required 决定可空）。返回新实体数组（不改原）。 */
export function ensureFkColumns(entities: ParsedModel[], relations: AppRelation[] = []): ParsedModel[] {
  const out = entities.map((e) => ({ ...e, fields: [...e.fields] }));
  for (const rel of oneToMany(relations)) {
    const child = find(out, rel.child);
    if (!child) continue;
    if (!child.fields.some((f) => f.name.toLowerCase() === rel.fkField!.toLowerCase())) {
      child.fields.push({ name: rel.fkField!, prismaType: 'BigInt', optional: rel.required === false, isId: false, isUnique: false });
    }
  }
  return out;
}

/**
 * 实体的若依 gen_table 模板配置：该实体作为某 1—N 关系的父表 → 主子表(sub)；否则 crud。
 * 若依标准 codegen「一父仅一子表」，多子取第一条（其余子表仍可独立 CRUD，外键已在 → 关联查询可用）。
 */
export function genTableMeta(entity: ParsedModel, entities: ParsedModel[], relations: AppRelation[] = []): RuoyiGenTableMeta {
  const asParent = oneToMany(relations).find((r) => find(entities, r.parent)?.table === entity.table);
  if (asParent) {
    const child = find(entities, asParent.child);
    if (child) return { tplCategory: 'sub', subTableName: child.table, subTableFkName: asParent.fkField };
  }
  return { tplCategory: 'crud' };
}
