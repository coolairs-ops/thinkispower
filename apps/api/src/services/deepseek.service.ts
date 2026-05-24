import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DeepseekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepseekOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);
  private apiKey: string;
  private baseUrl = 'https://api.deepseek.com/v1';

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('DEEPSEEK_API_KEY', '');
  }

  async chat(messages: DeepseekMessage[], options?: DeepseekOptions): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured, using fallback response');
      return this.getFallbackResponse(messages);
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options?.model || 'deepseek-chat',
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2048,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`DeepSeek API error: ${response.status} ${errorText}`);
        return this.getFallbackResponse(messages);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      this.logger.error('DeepSeek API call failed', error);
      return this.getFallbackResponse(messages);
    }
  }

  /**
   * Fallback when API key is missing or API call fails
   */
  private getFallbackResponse(messages: DeepseekMessage[]): string {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return '请描述你想要的软件功能。';

    const content = lastUserMsg.content.toLowerCase();

    // Keyword-based fallback for common app types
    if (content.includes('客户') || content.includes('crm') || content.includes('销售') || content.includes('客')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '客户管理系统',
          pages: ['登录页', '客户列表页', '客户详情页', '新增客户页', '统计看板'],
          features: ['客户增删改查', '客户分类与标签', '跟进记录', '销售统计'],
          roles: ['管理员', '销售员'],
          dataObjects: ['客户', '跟进记录', '标签'],
          estimatedDays: 10,
          estimatedPriceRange: '¥8,000-¥15,000',
        },
      });
    }

    if (content.includes('商城') || content.includes('电商') || content.includes('购物') || content.includes('订单') || content.includes('商品')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '电商商城系统',
          pages: ['首页', '商品列表页', '商品详情页', '购物车页', '订单页', '个人中心'],
          features: ['商品浏览与搜索', '购物车管理', '下单支付', '订单管理', '用户中心'],
          roles: ['管理员', '普通用户'],
          dataObjects: ['商品', '订单', '用户', '购物车'],
          estimatedDays: 15,
          estimatedPriceRange: '¥12,000-¥25,000',
        },
      });
    }

    if (content.includes('办公') || content.includes('oa') || content.includes('审批') || content.includes('考勤') || content.includes('流程')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: 'OA 办公管理系统',
          pages: ['登录页', '首页看板', '审批流程页', '考勤管理页', '公告页', '通讯录页'],
          features: ['流程审批', '考勤管理', '公告通知', '员工通讯录', '文件共享'],
          roles: ['管理员', '部门主管', '普通员工'],
          dataObjects: ['用户', '审批单', '考勤记录', '公告'],
          estimatedDays: 12,
          estimatedPriceRange: '¥10,000-¥20,000',
        },
      });
    }

    if (content.includes('库存') || content.includes('进销存') || content.includes('仓库') || content.includes('入库') || content.includes('出库')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '进销存管理系统',
          pages: ['登录页', '库存看板', '入库管理页', '出库管理页', '商品管理页', '报表统计页'],
          features: ['商品管理', '入库管理', '出库管理', '库存预警', '销售统计'],
          roles: ['管理员', '仓库管理员'],
          dataObjects: ['商品', '入库单', '出库单', '库存记录'],
          estimatedDays: 10,
          estimatedPriceRange: '¥8,000-¥15,000',
        },
      });
    }

    if (content.includes('预约') || content.includes('排号') || content.includes('预定') || content.includes('挂号')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '预约管理系统',
          pages: ['首页', '预约页', '预约记录页', '管理后台'],
          features: ['在线预约', '排号管理', '预约提醒', '数据统计'],
          roles: ['管理员', '普通用户'],
          dataObjects: ['用户', '预约单', '服务项目'],
          estimatedDays: 8,
          estimatedPriceRange: '¥6,000-¥12,000',
        },
      });
    }

    if (content.includes('外卖') || content.includes('点餐') || content.includes('菜单') || content.includes('餐厅')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '外卖点餐系统',
          pages: ['首页', '菜单页', '下单页', '订单追踪页', '商家后台'],
          features: ['菜单浏览', '在线点餐', '订单追踪', '评价系统'],
          roles: ['管理员', '商家', '普通用户'],
          dataObjects: ['菜单', '订单', '用户', '商家'],
          estimatedDays: 12,
          estimatedPriceRange: '¥10,000-¥20,000',
        },
      });
    }

    if (content.includes('博客') || content.includes('文章') || content.includes('资讯') || content.includes('新闻') || content.includes('内容')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '内容管理系统',
          pages: ['首页', '文章列表页', '文章详情页', '分类页', '管理后台'],
          features: ['文章发布与管理', '分类标签', '评论管理', '搜索功能'],
          roles: ['管理员', '编辑', '普通用户'],
          dataObjects: ['文章', '分类', '标签', '评论', '用户'],
          estimatedDays: 8,
          estimatedPriceRange: '¥5,000-¥12,000',
        },
      });
    }

    if (content.includes('教育') || content.includes('课程') || content.includes('培训') || content.includes('学生') || content.includes('学习')) {
      return JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '在线教育系统',
          pages: ['首页', '课程列表页', '课程详情页', '学习中心', '管理后台'],
          features: ['课程管理', '学员管理', '在线学习', '考试测评', '数据统计'],
          roles: ['管理员', '讲师', '学员'],
          dataObjects: ['课程', '学员', '考试', '学习记录'],
          estimatedDays: 15,
          estimatedPriceRange: '¥12,000-¥25,000',
        },
      });
    }

    return JSON.stringify({
      needMoreInfo: true,
      questions: [
        '这个产品主要给谁用？',
        '用户现在遇到什么问题？',
        '你希望第一版上线后能达到什么效果？',
        '需要用户登录吗？',
        '需要后台管理吗？',
      ],
      structuredRequirement: null,
    });
  }
}
