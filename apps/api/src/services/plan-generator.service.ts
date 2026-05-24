import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

const PLAN_SYSTEM_PROMPT = `你是一个软件方案设计师。基于用户的结构化需求，生成详细的软件方案。

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
1. 输出给用户看的内容必须非技术化，普通人能看懂。
2. 预计费用范围参考国内市场价。
3. 预计天数要合理（简单项目 5-10 天，中等 10-20 天）。
4. 不得出现内部工具名、技术架构名。`;

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
    const context = JSON.stringify(structuredRequirement, null, 2);
    const conversation = userMessages.join('\n');

    const aiMessages = [
      { role: 'system' as const, content: PLAN_SYSTEM_PROMPT },
      { role: 'user' as const, content: `用户的需求描述：\n${conversation}\n\n结构化需求：\n${context}` },
    ];

    const response = await this.deepseek.chat(aiMessages, { temperature: 0.5 });

    try {
      const parsed = JSON.parse(response);
      return {
        summary: parsed.summary || structuredRequirement?.summary || '软件项目',
        pages: Array.isArray(parsed.pages) ? parsed.pages : [],
        features: Array.isArray(parsed.features) ? parsed.features : [],
        roles: Array.isArray(parsed.roles) ? parsed.roles : [],
        dataObjects: Array.isArray(parsed.dataObjects) ? parsed.dataObjects : [],
        estimatedDays: parsed.estimatedDays || 10,
        estimatedPriceRange: parsed.estimatedPriceRange || '¥5,000-¥15,000',
        acceptanceChecklist: Array.isArray(parsed.acceptanceChecklist) ? parsed.acceptanceChecklist : [],
      };
    } catch {
      this.logger.warn('Failed to parse plan response as JSON, using fallback');
      return this.getFallbackPlan(structuredRequirement);
    }
  }

  private getFallbackPlan(req: any): PlanResult {
    const hasCrm = req?.summary?.includes('客户') || req?.features?.some((f: string) => f.includes('客户'));
    return {
      summary: hasCrm ? '客户管理系统' : '业务管理系统',
      pages: ['登录页面', '首页看板', '数据列表页', '详情页', '表单页', '系统设置页'],
      features: hasCrm
        ? ['客户信息管理', '客户分类与标签', '跟进记录', '销售统计报表', '数据导入导出']
        : ['数据管理', '查询与搜索', '报表统计', '系统配置'],
      roles: ['管理员 - 系统全部功能', '普通用户 - 基础业务操作'],
      dataObjects: hasCrm ? ['客户信息', '跟进记录', '标签分类', '用户账号'] : ['业务数据', '用户账号'],
      estimatedDays: 10,
      estimatedPriceRange: '¥5,000-¥15,000',
      acceptanceChecklist: [
        '所有页面可以正常打开',
        '数据增删改查功能正常',
        '搜索和筛选功能正常',
        '页面在不同屏幕尺寸下正常显示',
      ],
    };
  }
}
