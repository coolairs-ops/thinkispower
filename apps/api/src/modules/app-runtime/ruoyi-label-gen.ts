import { Logger } from '@nestjs/common';
import { DeepseekService } from '../../services/deepseek.service';
import { ParsedModel } from './data-model.types';

/**
 * 控制台中文标签（ADR-0012 ① 自动化）：LLM 据表/字段英文名产中文 functionName + 字段标签。
 * 用于若依 codegen：写进 gen_table.function_name / gen_table_column.column_comment → vue/弹窗/列头自动中文。
 * 无 deepseek 或失败 → 返回 {}（回退英文，不阻断置备）。
 */
export type ConsoleLabels = Record<string, { functionName: string; columns: Record<string, string> }>;

/** 若依框架列已自带中文注释，不送 LLM、不覆盖。 */
const FRAMEWORK = new Set(['create_dept', 'create_by', 'create_time', 'update_by', 'update_time', 'tenant_id', 'del_flag', 'version']);
const logger = new Logger('RuoyiLabelGen');

export async function generateConsoleLabels(deepseek: DeepseekService | undefined, entities: ParsedModel[]): Promise<ConsoleLabels> {
  if (!deepseek || !entities?.length) return {};
  const spec = entities.map((e) => ({
    table: e.table,
    name: e.name,
    fields: e.fields.map((f) => f.name).filter((n) => !FRAMEWORK.has(n.toLowerCase())),
  }));
  const system =
    '你是中文业务系统的标签生成器。给定数据库表与字段(英文)，产出简洁中文标签。' +
    '只输出一个 JSON 对象、无任何解释：{"表名":{"functionName":"中文业务名","columns":{"字段名":"中文标签"}}}。' +
    'functionName 用业务名词(如 客户/项目/订单)；字段标签简短(name→名称, amount→金额, contactInfo→联系方式, userId→负责人, createdAt→创建时间, status→状态)。表名/字段名必须原样作 key、不要翻译 key。';
  const user = '表与字段：\n' + spec.map((e) => `表 ${e.table}(${e.name})：${e.fields.join(', ') || '(无业务字段)'}`).join('\n');
  try {
    const resp = await deepseek.chatWithRetry(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.2, maxTokens: 1500 },
    );
    if (!resp) return {};
    const s = resp.indexOf('{'), en = resp.lastIndexOf('}');
    if (s < 0 || en <= s) return {};
    const raw = JSON.parse(resp.slice(s, en + 1)) as Record<string, { functionName?: string; columns?: Record<string, string> }>;
    const out: ConsoleLabels = {};
    for (const e of entities) {
      const r = raw[e.table];
      if (!r) continue;
      const cols: Record<string, string> = {};
      for (const f of e.fields) {
        const v = r.columns?.[f.name];
        if (typeof v === 'string' && v) cols[f.name] = v;
      }
      out[e.table] = { functionName: typeof r.functionName === 'string' && r.functionName ? r.functionName : e.name, columns: cols };
    }
    logger.log(`LLM 中文标签生成: ${Object.keys(out).length} 表`);
    return out;
  } catch (e) {
    logger.warn(`LLM 中文标签生成失败，回退英文: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}
