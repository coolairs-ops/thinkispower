import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';
import { buildPlanSeedFromRequirement } from '../modules/specification/requirement-uplift.service';

const PLAN_SYSTEM_PROMPT = `你是一个软件方案设计师。基于用户的产品需求文档（PRD），生成详细的软件方案。

输出格式（严格 JSON，字段名使用中文）：
{
  "summary": "项目一句话简介",
  "pages": ["页面1 - 页面说明", "页面2 - 页面说明"],
  "features": ["功能1", "功能2"],
  "roles": ["角色1 - 权限说明", "角色2 - 权限说明"],
  "dataObjects": ["数据对象1", "数据对象2"],
  "estimatedDays": 数字（预计开发天数）,
  "estimatedPriceRange": "¥xxx-¥xxx",
  "acceptanceChecklist": ["验收标准1", "验收标准2"]
}

要求：
1. 基于 PRD 中的 targetUsers、userPainPoints、useScenarios、mvpScope 来设计页面和功能
2. 页面和功能要贴合目标用户的使用场景
3. 输出给用户看的内容必须非技术化，普通人能看懂
4. 预计费用范围参考国内市场价
5. 预计天数要合理（简单项目 5-10 天，中等 10-20 天）
6. 不得出现内部工具名、技术架构名`;

export interface PlanResult {
  summary: string;
  pages: string[];
  features: string[];
  roles: string[];
  dataObjects: string[];
  estimatedDays: number;
  estimatedPriceRange: string;
  acceptanceChecklist: string[];
}

@Injectable()
export class PlanGeneratorService {
  private readonly logger = new Logger(PlanGeneratorService.name);

  constructor(private deepseek: DeepseekService) {}

  async generatePlan(structuredRequirement: any, userMessages: string[]): Promise<PlanResult> {
    // Detect if input is PRD-wrapped
    const prd = structuredRequirement?.prd || structuredRequirement;
    const seed = buildPlanSeedFromRequirement(structuredRequirement);
    const context = JSON.stringify(prd, null, 2);
    const conversation = userMessages.join('\n');

    const aiMessages = [
      { role: 'system' as const, content: PLAN_SYSTEM_PROMPT },
      { role: 'user' as const, content: `用户的需求描述：\n${conversation}\n\n产品需求文档（PRD）：\n${context}` },
    ];

    let response: string;
    try {
      response = await this.deepseek.chat(aiMessages, { temperature: 0.5 });
    } catch (e) {
      this.logger.warn(`Plan generation LLM failed, using requirement uplift fallback: ${e}`);
      return this.getFallbackPlan(structuredRequirement);
    }

    try {
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        summary: parsed.summary || seed.summary || prd?.summary || '软件项目',
        pages: firstNonEmptyArray(parsed.pages, seed.pages, this.extractPagesFromPrd(prd)),
        features: firstNonEmptyArray(parsed.features, seed.features, prd?.mvpScope, prd?.features, ['基础数据管理']),
        roles: firstNonEmptyArray(parsed.roles, seed.roles, prd?.roles, ['管理员 - 系统全部功能', '普通用户 - 基础业务操作']),
        dataObjects: firstNonEmptyArray(parsed.dataObjects, seed.dataObjects, prd?.dataObjects, ['用户', '业务数据']),
        estimatedDays: parsed.estimatedDays || 10,
        estimatedPriceRange: parsed.estimatedPriceRange || '¥5,000-¥15,000',
        acceptanceChecklist: firstNonEmptyArray(parsed.acceptanceChecklist, seed.acceptanceChecklist, prd?.successCriteria, ['核心功能可用']),
      };
    } catch {
      this.logger.warn('Failed to parse plan response as JSON, using fallback');
      return this.getFallbackPlan(structuredRequirement);
    }
  }

  private extractPagesFromPrd(prd: any): string[] {
    if (Array.isArray(prd?.pages) && prd.pages.length > 0) return prd.pages;
    return ['登录页面', '首页看板', '列表页', '详情页'];
  }

  private getFallbackPlan(req: any): PlanResult {
    const prd = req?.prd || req;
    const seed = buildPlanSeedFromRequirement(req);
    const summary = seed.summary || prd?.summary || prd?.productName || '业务管理系统';
    const features = firstNonEmptyArray(seed.features, prd?.mvpScope, prd?.features, ['基础数据管理']);
    const roles = firstNonEmptyArray(seed.roles, prd?.roles, ['管理员 - 系统全部功能', '普通用户 - 基础业务操作']);
    const pages = firstNonEmptyArray(seed.pages, prd?.pages, ['登录页面', '首页看板', '数据列表页', '详情页']);
    const dataObjects = firstNonEmptyArray(seed.dataObjects, prd?.dataObjects, ['业务数据', '用户账号']);
    const successCriteria = firstNonEmptyArray(seed.acceptanceChecklist, prd?.successCriteria);

    return {
      summary,
      pages,
      features,
      roles,
      dataObjects,
      estimatedDays: 10,
      estimatedPriceRange: '¥5,000-¥15,000',
      acceptanceChecklist: successCriteria.length > 0
        ? successCriteria
        : ['所有页面可以正常打开', '核心功能可用', '页面在不同屏幕尺寸下正常显示'],
    };
  }
}

function firstNonEmptyArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const normalized = value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const record = item as { name?: unknown; role?: unknown; title?: unknown; description?: unknown };
          const head = String(record.name ?? record.role ?? record.title ?? '').trim();
          const desc = String(record.description ?? '').trim();
          return head && desc ? `${head} - ${desc}` : head;
        }
        return '';
      })
      .filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  return [];
}
