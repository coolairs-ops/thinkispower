import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

const MAX_CLARIFY_ROUNDS = 5;

const CLARIFY_SYSTEM_PROMPT = `你是一个软件需求分析师。你的任务是通过对话逐步了解用户需求。

规则（严格遵守）：
1. 【关键】每次输出**只包含 1 个追问**，一次只问一个问题，严禁超过 1 个。
2. 根据已有信息判断还需要了解什么，一次只问最关键的那一个。
3. 每次追问聚焦一个维度：用户角色、核心功能、使用场景、预期效果等。
4. 如果用户提供的信息已经很充分（至少覆盖了"给谁用"和"主要功能"），立即输出结构化需求，不要追问。
5. 如果追问轮数已经比较多，即使信息不完全充分，也应该输出结构化需求，不要无限制追问。
6. 所有输出使用普通中文，不得出现内部工具名或技术术语。

输出格式（严格 JSON）：
{
  "needMoreInfo": true/false,
  "questions": ["追问"],
  "structuredRequirement": null 或 {
    "summary": "项目一句话简介",
    "pages": ["页面1", "页面2"],
    "features": ["功能1", "功能2"],
    "roles": ["角色1", "角色2"],
    "dataObjects": ["数据对象1"]
  }
}`;

export interface ClarifyResult {
  needMoreInfo: boolean;
  questions: string[];
  structuredRequirement: {
    summary: string;
    pages: string[];
    features: string[];
    roles: string[];
    dataObjects: string[];
  } | null;
}

@Injectable()
export class ClarifyService {
  private readonly logger = new Logger(ClarifyService.name);

  constructor(private deepseek: DeepseekService) {}

  async processMessages(messages: { role: string; content: string }[]): Promise<ClarifyResult> {
    // Only use user and assistant messages for AI context
    const contextMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Count clarification rounds (assistant messages excluding the final "已完成" message)
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const currentRound = assistantMessages.length + 1; // This will be the next round

    // If reached max rounds, force generate structured requirement
    if (currentRound > MAX_CLARIFY_ROUNDS) {
      this.logger.log(`Reached max clarify rounds (${MAX_CLARIFY_ROUNDS}), generating requirement automatically`);
      return this.generateRequirementFromHistory(messages);
    }

    const roundInfo = `【这是第 ${currentRound} 轮追问，最多 ${MAX_CLARIFY_ROUNDS} 轮】`;

    const aiMessages = [
      { role: 'system' as const, content: CLARIFY_SYSTEM_PROMPT },
      ...contextMessages,
      { role: 'user' as const, content: `${roundInfo}\n请根据以上对话，判断是否需要继续追问。如果需要，返回 1 个追问问题；如果足够清晰，返回结构化需求。` },
    ];

    const response = await this.deepseek.chat(aiMessages);

    try {
      const parsed = JSON.parse(response);
      return {
        needMoreInfo: parsed.needMoreInfo ?? true,
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        structuredRequirement: parsed.structuredRequirement || null,
      };
    } catch {
      this.logger.warn('Failed to parse DeepSeek response as JSON, using fallback');
      return this.getFallbackResult(messages);
    }
  }

  private getFallbackResult(messages: { role: string; content: string }[]): ClarifyResult {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allText = userMessages.join(' ').toLowerCase();

    // Count answered questions as a proxy for clarity
    if (userMessages.length >= 3) {
      return {
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: allText.includes('客户') ? '客户管理系统' : '软件项目',
          pages: ['登录页', '首页', '列表页', '详情页'],
          features: ['基础数据管理'],
          roles: ['管理员', '普通用户'],
          dataObjects: ['用户', '业务数据'],
        },
      };
    }

    return {
      needMoreInfo: true,
      questions: [
        '这个产品主要给谁用？',
      ],
      structuredRequirement: null,
    };
  }

  private generateRequirementFromHistory(messages: { role: string; content: string }[]): ClarifyResult {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allText = userMessages.join(' ');

    this.logger.log(`Generating requirement from history after max rounds, ${userMessages.length} user messages`);

    // Try to extract key info from conversation
    const summary = this.extractSummary(allText);
    const pages = this.extractPages(allText);
    const features = this.extractFeatures(allText);
    const roles = this.extractRoles(allText);
    const dataObjects = this.extractDataObjects(allText);

    return {
      needMoreInfo: false,
      questions: [],
      structuredRequirement: {
        summary,
        pages,
        features,
        roles,
        dataObjects,
      },
    };
  }

  private extractSummary(text: string): string {
    if (text.includes('客户') || text.includes('crm')) return '客户管理系统';
    if (text.includes('商城') || text.includes('电商') || text.includes('购物')) return '电商商城系统';
    if (text.includes('办公') || text.includes('oa') || text.includes('审批')) return 'OA 办公管理系统';
    if (text.includes('库存') || text.includes('进销存') || text.includes('仓库')) return '进销存管理系统';
    if (text.includes('预约') || text.includes('排号') || text.includes('预定')) return '预约管理系统';
    if (text.includes('外卖') || text.includes('点餐') || text.includes('菜单')) return '外卖点餐系统';
    if (text.includes('博客') || text.includes('文章') || text.includes('资讯')) return '内容管理系统';
    if (text.includes('教育') || text.includes('课程') || text.includes('学习')) return '在线教育系统';
    return '业务管理系统';
  }

  private extractPages(text: string): string[] {
    const pages = ['登录页', '首页'];
    if (text.includes('管理') || text.includes('后台')) pages.push('管理后台');
    if (text.includes('列表') || text.includes('查询')) pages.push('列表页');
    if (text.includes('详情') || text.includes('查看')) pages.push('详情页');
    if (pages.length < 3) pages.push('列表页', '详情页');
    return [...new Set(pages)];
  }

  private extractFeatures(text: string): string[] {
    const features: string[] = [];
    if (text.includes('增') || text.includes('添加') || text.includes('新建')) features.push('数据新增');
    if (text.includes('删') || text.includes('删除')) features.push('数据删除');
    if (text.includes('改') || text.includes('编辑') || text.includes('修改')) features.push('数据编辑');
    if (text.includes('查') || text.includes('搜索') || text.includes('查询')) features.push('数据查询');
    if (text.includes('统计') || text.includes('报表') || text.includes('看板')) features.push('数据统计');
    if (text.includes('登录') || text.includes('注册')) features.push('用户登录注册');
    if (text.includes('权限') || text.includes('角色')) features.push('角色权限管理');
    if (features.length === 0) features.push('基础数据管理');
    return [...new Set(features)];
  }

  private extractRoles(text: string): string[] {
    const roles: string[] = ['管理员'];
    if (text.includes('普通用户') || text.includes('员工') || text.includes('成员')) roles.push('普通用户');
    if (text.includes('主管') || text.includes('经理')) roles.push('主管');
    if (text.includes('访客') || text.includes('游客')) roles.push('访客');
    if (roles.length < 2) roles.push('普通用户');
    return [...new Set(roles)];
  }

  private extractDataObjects(text: string): string[] {
    const objects: string[] = ['用户'];
    if (text.includes('订单') || text.includes('商品')) objects.push('订单', '商品');
    if (text.includes('客户')) objects.push('客户');
    if (text.includes('文章') || text.includes('内容')) objects.push('文章');
    if (text.includes('课程') || text.includes('考试')) objects.push('课程');
    if (objects.length < 2) objects.push('业务数据');
    return [...new Set(objects)];
  }
}
