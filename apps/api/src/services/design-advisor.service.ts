import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

export interface DesignSuggestion {
  id: string;
  category: 'navigation' | 'layout' | 'fields' | 'flow' | 'color';
  title: string;
  description: string;
  adopted: boolean;
}

interface ColorScheme {
  name: string;
  description: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}

interface SuggestionsOutput {
  suggestions: Array<{
    category: string;
    title: string;
    description: string;
  }>;
  colorSchemes: ColorScheme[];
}

const GENERATE_PROMPT = `你是一个资深产品设计顾问。根据项目方案，输出设计建议。

分类输出以下 5 类建议（每类 2-4 条）：
- navigation: 导航结构 — 页面之间的层级和跳转方式
- layout: 页面布局 — 每个页面的内容区域划分和信息层级
- fields: 核心字段 — 主要数据实体需要包含哪些关键字段
- flow: 操作流程 — 用户完成核心任务的完整操作步骤
- color: 配色风格 — 3 套完整配色方案，使用 Claude Design 设计语言

配色方案格式：
{
  "name": "方案名称（如：极简白/深海蓝/森林绿）",
  "description": "设计理念简述，如'清爽专业，适合企业内部工具'",
  "primary": "主色 HEX",
  "secondary": "次要色 HEX",
  "accent": "强调色 HEX",
  "background": "背景色 HEX",
  "surface": "卡片/表面色 HEX",
  "text": "文字色 HEX"
}

输出严格 JSON 格式：
{
  "suggestions": [{ "category": "navigation", "title": "标题", "description": "具体建议" }],
  "colorSchemes": [{ name, description, primary, secondary, accent, background, surface, text }]
}`;

function toId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now().toString(36)}`;
}

@Injectable()
export class DesignAdvisorService {
  private readonly logger = new Logger(DesignAdvisorService.name);

  constructor(private deepseek: DeepseekService) {}

  async getOrGenerate(projectId: string, planSummary: any, structuredRequirement: any): Promise<DesignSuggestion[]> {
    const existing = (structuredRequirement as any)?.designSuggestions;
    if (existing && Array.isArray(existing) && existing.length > 0) {
      return existing as DesignSuggestion[];
    }
    return this.generate(projectId, planSummary, structuredRequirement);
  }

  private async generate(projectId: string, planSummary: any, structuredRequirement: any): Promise<DesignSuggestion[]> {
    const planText = typeof planSummary === 'object' ? JSON.stringify(planSummary, null, 2) : String(planSummary ?? '');
    const reqText = typeof structuredRequirement === 'object' ? JSON.stringify(structuredRequirement, null, 2) : '';

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: GENERATE_PROMPT },
        { role: 'user', content: `项目方案：\n${planText}\n\n需求文档：\n${reqText}` },
      ],
      { temperature: 0.4, maxTokens: 4096, jsonOnly: true },
    );

    try {
      const parsed = JSON.parse(response) as SuggestionsOutput;
      const suggestions: DesignSuggestion[] = [
        ...parsed.suggestions.map((s, i) => ({
          id: toId(s.category, i),
          category: s.category as DesignSuggestion['category'],
          title: s.title,
          description: s.description,
          adopted: false,
        })),
        ...parsed.colorSchemes.map((cs, i) => ({
          id: toId('color', i),
          category: 'color' as const,
          title: `配色方案 ${i + 1}：${cs.name}`,
          description: `${cs.description}（主色 ${cs.primary} / 辅色 ${cs.secondary} / 强调色 ${cs.accent} / 背景 ${cs.background} / 表面 ${cs.surface} / 文字 ${cs.text}）`,
          adopted: false,
        })),
      ];
      return suggestions;
    } catch {
      this.logger.warn('Failed to parse design suggestions, using fallback');
      return this.getFallback(planSummary);
    }
  }

  private getFallback(planSummary: any): DesignSuggestion[] {
    const pages = (planSummary as any)?.pages ?? [];
    return [
      { id: toId('nav', 0), category: 'navigation', title: '顶部导航栏', description: '所有页面统一顶部导航栏，左侧Logo+项目名称，右侧用户头像+退出', adopted: false },
      { id: toId('nav', 1), category: 'navigation', title: '侧边栏菜单', description: '管理后台采用左侧边栏菜单，收起/展开切换', adopted: false },
      { id: toId('layout', 0), category: 'layout', title: '卡片式布局', description: '列表类页面采用卡片式布局，每项独立卡片，悬停有阴影效果', adopted: false },
      { id: toId('layout', 1), category: 'layout', title: '响应式断点', description: '桌面端多列网格，平板双列，手机单列', adopted: false },
      { id: toId('fields', 0), category: 'fields', title: '核心字段', description: pages.length ? `${pages.join('、')}等页面包含必要的数据展示字段` : '根据业务需求确定各模块的核心字段', adopted: false },
      { id: toId('flow', 0), category: 'flow', title: '操作反馈', description: '每个操作都有 loading/成功/失败三种状态反馈', adopted: false },
      { id: toId('color', 0), category: 'color', title: '配色方案 1：极简白', description: '清爽专业，适合企业内部工具（主色 #2563EB / 辅色 #64748B / 强调色 #F59E0B / 背景 #F8FAFC / 表面 #FFFFFF / 文字 #1E293B）', adopted: false },
      { id: toId('color', 1), category: 'color', title: '配色方案 2：深海蓝', description: '沉稳可靠，适合管理后台（主色 #1E40AF / 辅色 #3B82F6 / 强调色 #06B6D4 / 背景 #0F172A / 表面 #1E293B / 文字 #F1F5F9）', adopted: false },
      { id: toId('color', 2), category: 'color', title: '配色方案 3：森林绿', description: '温和自然，降低视觉疲劳（主色 #059669 / 辅色 #10B981 / 强调色 #F59E0B / 背景 #ECFDF5 / 表面 #FFFFFF / 文字 #064E3B）', adopted: false },
    ];
  }

  async save(projectId: string, suggestions: DesignSuggestion[]): Promise<DesignSuggestion[]> {
    return suggestions;
  }
}
