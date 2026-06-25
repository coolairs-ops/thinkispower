import { Injectable, Logger, Optional } from '@nestjs/common';
import { SchemaMigrationService } from '../schema-migration.service';
import { DeepseekService } from '../../../services/deepseek.service';
import { buildDataContract, normalizeContractForRuntime, DataContract } from '../app-contract';
import { AppSchema } from './page-schema.types';
import { coerceSchema, fallbackSchema, ensureCreateForm, extractJson, buildComposePrompt, buildRevisePrompt } from './schema-composer';

/**
 * Schema 编排服务（Schema 驱动 S2）：需求/数据模型 → AppSchema。
 *
 * LLM 编排页面结构 → coerceSchema 确定性校验门（越界丢弃）→ 无合法页则确定性兜底。
 * 契约按 backendKind 归一（若依→字段名小写），故 schema 路径天然带字段名归一。
 * 不接生产路径（S3 再路由 generateDemo 过来）。DeepseekService 全局可注入；无则纯兜底。
 */
@Injectable()
export class SchemaComposerService {
  private readonly logger = new Logger(SchemaComposerService.name);

  constructor(
    private schema: SchemaMigrationService,
    @Optional() private deepseek?: DeepseekService,
  ) {}

  async compose(input: {
    appName: string;
    dataModel: string | null | undefined;
    backendKind?: string;
    pageLabels?: string[];
    features?: string[];
  }): Promise<{ schema: AppSchema; source: 'llm' | 'fallback'; dropped: string[] }> {
    const contract = this.contractOf(input.dataModel, input.backendKind);

    if (!this.deepseek || !input.dataModel) {
      return { schema: ensureCreateForm(fallbackSchema(input.appName, contract), contract), source: 'fallback', dropped: [] };
    }

    try {
      const { system, user } = buildComposePrompt(input.appName, input.pageLabels ?? [], input.features ?? [], contract);
      const resp = await this.deepseek.chatWithRetry(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { temperature: 0.3, maxTokens: 4096 },
      );
      const { schema, dropped } = coerceSchema(extractJson(resp || ''), contract);
      if (schema && schema.pages.length) {
        if (dropped.length) this.logger.warn(`schema 编排丢弃越界项 ${dropped.length}: ${dropped.slice(0, 5).join(' | ')}`);
        const withForm = ensureCreateForm(schema, contract);
        this.logger.log(`schema 编排完成 (LLM): ${withForm.pages.length} 页`);
        return { schema: withForm, source: 'llm', dropped };
      }
      this.logger.warn(`LLM schema 无合法页（${dropped.join('；') || '空'}），退回确定性兜底`);
    } catch (e) {
      this.logger.warn(`LLM schema 编排失败，退回兜底: ${e instanceof Error ? e.message : e}`);
    }
    return { schema: ensureCreateForm(fallbackSchema(input.appName, contract), contract), source: 'fallback', dropped: [] };
  }

  /**
   * 据传感器建议修订现有 schema（S5 自迭代用）：LLM 改 schema → coerceSchema 校验门。
   * 无 deepseek / 无建议 / 产物无合法页 / 出错 → 原样返回（changed=false），调用方回退 HTML 修复。
   */
  async reviseSchema(
    current: AppSchema,
    recommendations: string[],
    dataModel: string | null | undefined,
    backendKind?: string,
  ): Promise<{ schema: AppSchema; dropped: string[]; changed: boolean }> {
    if (!this.deepseek || !recommendations.length) return { schema: current, dropped: [], changed: false };
    const contract = this.contractOf(dataModel, backendKind);
    try {
      const { system, user } = buildRevisePrompt(current, recommendations, contract);
      const resp = await this.deepseek.chatWithRetry(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { temperature: 0.3, maxTokens: 4096 },
      );
      const { schema, dropped } = coerceSchema(extractJson(resp || ''), contract);
      if (schema && schema.pages.length) {
        this.logger.log(`schema 修订完成: ${schema.pages.length} 页 丢弃越界 ${dropped.length}`);
        return { schema, dropped, changed: true };
      }
      this.logger.warn('schema 修订无合法页，保留原 schema');
    } catch (e) {
      this.logger.warn(`schema 修订失败，保留原 schema: ${e instanceof Error ? e.message : e}`);
    }
    return { schema: current, dropped: [], changed: false };
  }

  /** 数据模型 → 按底座方言归一的数据契约（解析失败 → 空契约，不抛）。 */
  private contractOf(dataModel: string | null | undefined, backendKind?: string): DataContract {
    try {
      return normalizeContractForRuntime(buildDataContract(this.schema.parseAndValidate(dataModel || '')), backendKind);
    } catch (e) {
      this.logger.warn(`数据模型解析失败，用空契约: ${e instanceof Error ? e.message : e}`);
      return { resources: [] };
    }
  }
}
