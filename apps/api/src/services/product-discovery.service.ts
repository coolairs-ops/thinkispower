import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

/**
 * 产品需求文档 PRD 结构
 */
export interface PRD {
  productName: string;
  summary: string;
  background: string;
  targetUsers: string[];
  userPainPoints: string[];
  useScenarios: string[];
  coreValue: string;
  productForm: string;
  mvpScope: string[];
  successCriteria: string[];
  pages: string[];
  features: string[];
  roles: string[];
  dataObjects: string[];
  riskPoints: string[];
}

interface DiscoveryResult {
  needMoreInfo: boolean;
  question: string | null;
  summary: string;
  prd: PRD | null;
}

const DISCOVERY_SYSTEM_PROMPT = `你是一个资深产品经理，擅长和普通人通过多轮自然对话，探索出对方真正想做的产品。

## 你的目标
通过一轮一轮的提问，直到你深刻理解对方想做一个什么样的产品，并且已经知道如何设计这款产品为止。

## 你遵守的规则
1. 每一轮只能提出一个问题，严禁一次问多个问题。
2. 每轮回复时，先简短总结你理解到的信息（用 1-3 句话），再提出一个最关键的问题。
3. 不要过早给方案 — 不要在设计还不明确的时候就建议用什么技术、什么架构。
4. 不要替用户下结论 — 用提问验证你的理解，而不是直接替用户决定。
5. 如果用户说的是功能（"我想要一个扫码功能"），要追问背后的问题（"扫码是为了解决什么问题？"）。
6. 如果用户说的是问题（"管理混乱"），要追问目标用户和真实场景（"谁在管理？什么场景下会乱？"）。
7. 如果用户说的是愿望（"我希望做得专业一点"），要追问为什么这件事重要（"'专业'对你来说意味着什么？"）。
8. 使用普通人能听懂的话，不要使用复杂产品术语。

## 你需要逐轮探索的 8 个维度
1. 用户身份 / 目标用户 — 这个产品主要给谁用？他们是什么样的人？
2. 用户痛点 / 要解决的问题 — 这些用户现在遇到什么麻烦？
3. 核心使用场景 — 用户在什么时间、什么地方、什么情况下会用？
4. 产品核心价值 — 用户用了这个产品能得到什么好处？
5. 产品形态 — 网页、小程序、手机 APP、还是其他形式？
6. MVP 范围 — 第一版上线必须有哪几个功能？
7. 成功标准 — 做到什么程度就算做好了？怎么衡量？
8. 参考与约束 — 有没有参考的产品？时间或预算上有什么要求？

## 探索过程中需要重点追问的方向（融入在上述 8 个维度的探索中）
a. **角色与权限**：如果用户提到多个角色（如不同岗位/身份的人会使用），追问这些角色的操作权限是否一样？不同角色看到的数据是否相同？
b. **数据关系**：当用户提到多个数据时（如客户、订单、项目），追问这些数据之间如何关联？比如客户和项目是一对多还是多对多？
c. **交互操作**：除了查看列表和详情，用户还需要对这些数据进行什么操作？比如增删改查、审批流程、导入导出、统计报表？
d. **业务规则**：有没有自动计算的逻辑或规则？比如根据消费金额自动划分会员等级、根据天数自动计算进度、根据条件自动触发某个操作？

## 结束条件
当以上 8 个维度中至少 7 个都已经有足够信息时，就可以输出 PRD 了。
即使还有个别维度信息不太充分，如果已经问了 8 轮以上，也应该输出 PRD，避免无限制追问。

## 输出格式
你必须输出严格的 JSON，不要 markdown 包裹，纯 JSON：

如果还需要继续追问：
{
  "needMoreInfo": true,
  "summary": "根据已有信息的简短总结",
  "question": "你唯一的一个追问",
  "prd": null
}

如果信息足够，输出 PRD：
{
  "needMoreInfo": false,
  "summary": "最终总结",
  "question": null,
  "prd": {
    "productName": "产品名称",
    "summary": "产品一句话描述",
    "background": "产品背景",
    "targetUsers": ["目标用户1", "目标用户2"],
    "userPainPoints": ["痛点1", "痛点2"],
    "useScenarios": ["场景1", "场景2"],
    "coreValue": "核心价值描述",
    "productForm": "产品形态",
    "mvpScope": ["MVP功能1", "MVP功能2"],
    "successCriteria": ["标准1", "标准2"],
    "pages": ["页面1", "页面2"],
    "features": ["功能1", "功能2"],
    "roles": ["角色1", "角色2"],
    "dataObjects": ["数据对象1"],
    "riskPoints": ["风险点1"]
  }
}`;

@Injectable()
export class ProductDiscoveryService {
  private readonly logger = new Logger(ProductDiscoveryService.name);

  constructor(private deepseek: DeepseekService) {}

  async processMessages(messages: { role: string; content: string }[], extraSystemHints?: string): Promise<DiscoveryResult> {
    const contextMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const userMessageCount = messages.filter(m => m.role === 'user').length;
    this.logger.log(`[PM探索] 第 ${userMessageCount} 轮用户回复, 共 ${messages.length} 条消息`);

    // After 12+ rounds, force output PRD even if dimensions are not all covered
    const forceComplete = userMessageCount >= 12;
    const forceInstruction = forceComplete
      ? '\n【注意】已经进行了多轮对话，请基于已有信息直接输出 PRD，不要再追问。如果某些维度信息不足，请合理推断。'
      : '';

    const systemContent = extraSystemHints
      ? `${DISCOVERY_SYSTEM_PROMPT}\n\n## Hermes 质量门禁提示\n以下是在对话中发现的需要注意的问题，请你在本轮提问中呼应处理：\n${extraSystemHints}`
      : DISCOVERY_SYSTEM_PROMPT;

    const aiMessages = [
      { role: 'system' as const, content: systemContent },
      ...contextMessages,
      {
        role: 'user' as const,
        content: `请根据以上对话，判断是否已经充分了解用户想做的产品。${forceInstruction}`,
      },
    ];

    const response = await this.deepseek.chat(aiMessages, {
      temperature: 0.5,
      maxTokens: 4096,
    });

    try {
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.needMoreInfo && parsed.question) {
        return {
          needMoreInfo: true,
          question: parsed.question,
          summary: parsed.summary || '',
          prd: null,
        };
      }

      if (parsed.prd) {
        return {
          needMoreInfo: false,
          question: null,
          summary: parsed.summary || '',
          prd: this.validatePrd(parsed.prd),
        };
      }

      // Fallback: if no clear direction, ask a default question
      return {
        needMoreInfo: true,
        question: '可以再多跟我说说你的想法吗？你想做的产品主要是解决什么问题？',
        summary: parsed.summary || '暂时还没有完全理解你的需求',
        prd: null,
      };
    } catch {
      this.logger.warn('[PM探索] AI 返回非 JSON，使用降级处理');
      return this.getFallbackResult(messages);
    }
  }

  private validatePrd(prd: any): PRD {
    return {
      productName: prd.productName || '未命名产品',
      summary: prd.summary || '',
      background: prd.background || '',
      targetUsers: Array.isArray(prd.targetUsers) ? prd.targetUsers : [],
      userPainPoints: Array.isArray(prd.userPainPoints) ? prd.userPainPoints : [],
      useScenarios: Array.isArray(prd.useScenarios) ? prd.useScenarios : [],
      coreValue: prd.coreValue || '',
      productForm: prd.productForm || '网页',
      mvpScope: Array.isArray(prd.mvpScope) ? prd.mvpScope : [],
      successCriteria: Array.isArray(prd.successCriteria) ? prd.successCriteria : [],
      pages: Array.isArray(prd.pages) ? prd.pages : ['首页'],
      features: Array.isArray(prd.features) ? prd.features : [],
      roles: Array.isArray(prd.roles) ? prd.roles : ['管理员'],
      dataObjects: Array.isArray(prd.dataObjects) ? prd.dataObjects : [],
      riskPoints: Array.isArray(prd.riskPoints) ? prd.riskPoints : [],
    };
  }

  private getFallbackResult(messages: { role: string; content: string }[]): DiscoveryResult {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allText = userMessages.join(' ');

    if (userMessages.length >= 3) {
      // Generate a basic PRD from keywords
      const prd = this.generateBasicPrd(allText);
      return {
        needMoreInfo: false,
        question: null,
        summary: '根据已有信息生成了需求文档',
        prd,
      };
    }

    return {
      needMoreInfo: true,
      question: '这个产品主要给谁用的？他们目前遇到了什么问题？',
      summary: '刚刚开始了解你的想法',
      prd: null,
    };
  }

  private generateBasicPrd(text: string): PRD {
    const isCrm = /客户|crm/i.test(text);
    const isEcom = /商城|电商|购物|商品|订单/i.test(text);
    const isOa = /办公|oa|审批|流程/i.test(text);
    const isDelivery = /外卖|点餐|配送|餐厅|餐饮/i.test(text);
    const isEdu = /教育|课程|学习|培训/i.test(text);

    let summary = '业务管理系统';
    let targetUsers = ['管理员'];
    let pages = ['首页', '登录页'];
    let features = ['基础数据管理'];
    let roles = ['管理员', '普通用户'];
    let dataObjects = ['用户'];

    if (isCrm) {
      summary = '客户关系管理系统';
      targetUsers = ['销售员', '销售经理', '管理员'];
      pages = ['首页', '客户列表', '客户详情', '跟进记录'];
      features = ['客户信息管理', '跟进记录', '销售漏斗', '数据统计'];
      roles = ['销售员', '销售经理', '管理员'];
      dataObjects = ['客户', '跟进记录', '销售目标'];
    } else if (isEcom) {
      summary = '电商商城系统';
      targetUsers = ['普通买家', '商家', '管理员'];
      pages = ['首页', '商品列表', '商品详情', '购物车', '订单页'];
      features = ['商品浏览', '购物车', '下单支付', '订单管理'];
      roles = ['买家', '商家', '管理员'];
      dataObjects = ['商品', '订单', '用户', '购物车'];
    } else if (isDelivery) {
      summary = '餐饮外卖管理系统';
      targetUsers = ['餐厅老板', '服务员', '顾客'];
      pages = ['菜单展示', '点餐页', '订单管理', '后台管理'];
      features = ['菜单管理', '在线点餐', '订单管理', '数据统计'];
      roles = ['管理员', '服务员', '顾客'];
      dataObjects = ['菜品', '订单', '分类'];
    } else if (isOa) {
      summary = 'OA办公管理系统';
      targetUsers = ['员工', '部门主管', '管理员'];
      pages = ['首页', '审批列表', '审批详情', '通讯录'];
      features = ['流程审批', '通知公告', '文档管理'];
      roles = ['员工', '主管', '管理员'];
      dataObjects = ['审批单', '通知', '文档'];
    } else if (isEdu) {
      summary = '在线教育系统';
      targetUsers = ['学生', '老师', '管理员'];
      pages = ['首页', '课程列表', '课程详情', '学习中心'];
      features = ['课程管理', '在线学习', '作业提交', '成绩管理'];
      roles = ['学生', '老师', '管理员'];
      dataObjects = ['课程', '学生', '作业', '成绩'];
    }

    return {
      productName: summary,
      summary,
      background: `用户需要一个${summary}`,
      targetUsers,
      userPainPoints: ['现有流程效率低', '信息管理混乱'],
      useScenarios: ['日常工作管理'],
      coreValue: '提升工作效率，降低管理成本',
      productForm: '网页',
      mvpScope: features.slice(0, 3),
      successCriteria: ['核心功能可以正常使用', '用户能够独立完成操作'],
      pages,
      features,
      roles,
      dataObjects,
      riskPoints: ['需求可能还不够明确', '建议进一步确认用户真实场景'],
    };
  }
}
