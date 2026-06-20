import { ParsedModel } from './data-model.types';

/**
 * 应用数据契约（前端契约桥，ADR-0007 候选 / ADR-0003 缺口的最小实证）。
 *
 * 把"填槽+校验门"纪律从后端 codegen 扩到前端迭代：从实体模型导出一份**数据契约**
 * （资源名 + 字段），① 注入前端生成/迭代 prompt → 前端从一开始就用对的资源名/字段；
 * ② 确定性校验前端产物里 appData 调用是否 ⊆ 契约 → 不符即门驳回、迭代朝契约收敛。
 * 纯函数、零依赖、确定性（符合 ADR-0002「hard enforcement 靠校验器不靠提示词」）。
 */
export interface DataContract {
  resources: { name: string; fields: string[] }[];
}

/** 若依基础列 / 审计列：契约里不暴露给前端（由后端自动填）。 */
const HIDDEN_FIELDS = new Set(['create_dept', 'create_by', 'create_time', 'update_by', 'update_time', 'tenant_id', 'del_flag']);

/** 实体模型 → 数据契约（资源名 = 表名；字段去掉基础列）。 */
export function buildDataContract(entities: ParsedModel[]): DataContract {
  return {
    resources: entities.map((e) => ({
      name: e.table,
      fields: e.fields.map((f) => f.name).filter((n) => !HIDDEN_FIELDS.has(n.toLowerCase())),
    })),
  };
}

/** 契约 → 注入生成/迭代 prompt 的硬约束文本块。 */
export function contractPromptBlock(contract: DataContract): string {
  if (!contract.resources.length) return '';
  const lines = contract.resources.map((r) => `- ${r.name}：${r.fields.join('、')}`);
  return [
    '# 数据契约（必须严格遵守，否则验收驳回）',
    'appData 的资源名**只能**取下列之一，读写字段**只能**用对应资源列出的字段：',
    ...lines,
    '禁止使用未列出的资源名或字段（后端只服务这些）。',
  ].join('\n');
}

/** 从 HTML 抽出 appData 调用引用的资源名（list/get/create/update/remove 第一个参数）。 */
export function extractAppDataResources(html: string): string[] {
  const set = new Set<string>();
  const re = /appData\s*\.\s*(?:list|get|create|update|remove)\s*\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return [...set];
}

/** 校验 HTML 的 appData 资源是否 ⊆ 契约。返回不在契约里的资源（空=一致）。 */
export function checkContractConformance(html: string, contract: DataContract): { ok: boolean; unknownResources: string[] } {
  const allowed = new Set(contract.resources.map((r) => r.name.toLowerCase()));
  const unknown = extractAppDataResources(html).filter((r) => !allowed.has(r.toLowerCase()));
  return { ok: unknown.length === 0, unknownResources: unknown };
}
