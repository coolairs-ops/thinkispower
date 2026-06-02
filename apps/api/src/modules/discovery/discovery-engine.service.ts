import { Injectable, Logger } from '@nestjs/common';
import { CompletenessCheckerService, CompletenessReport } from './completeness-checker.service';
import { DeepseekService } from '../../services/deepseek.service';

export interface DiscoveryResult {
  /** 下一轮要问的问题（null=完备度已达标，无需继续） */
  nextQuestion: string | null;
  /** 问题选项（2-4个，供前端按钮展示） */
  options: string[];
  /** 当前完备度报告 */
  completeness: CompletenessReport;
  /** 是否可以生成方案 */
  readyForPlan: boolean;
}

@Injectable()
export class DiscoveryEngineService {
  private readonly logger = new Logger(DiscoveryEngineService.name);

  constructor(
    private readonly completenessChecker: CompletenessCheckerService,
    private readonly deepseek: DeepseekService,
  ) {}

  /**
   * 根据当前项目信息，决定下一步：继续追问 or 生成方案
   */
  async discover(
    projectName: string,
    description: string,
    structuredRequirement: any,
    userMessages: string[],
  ): Promise<DiscoveryResult> {
    const report = this.completenessChecker.evaluate(structuredRequirement, userMessages);

    if (this.completenessChecker.isReadyForPlan(report)) {
      return {
        nextQuestion: null,
        options: [],
        completeness: report,
        readyForPlan: true,
      };
    }

    // 不完备 → 生成下一个问题
    const priorityGap = this.completenessChecker.getPriorityGap(report);
    const target = priorityGap || '产品需求';

    try {
      const lastMessage = userMessages[userMessages.length - 1] || description || '';
      const response = await this.deepseek.chat(
        [
          {
            role: 'system',
            content: `你是一个产品需求引导助手。你的任务是根据用户的需求描述和缺失的信息，生成一个简短的自然问题来帮用户补充信息。

规则：
1. 问题要简短友好（不超过30字），用口语化中文
2. 附带2-4个选项（多选场景用标签，其他用具体选项）
3. 不要问用户已经回答过的问题
4. 不要用技术术语（数据库、API等）

你需要引导用户补充：${target}

输出格式（纯JSON，不要markdown代码块）：
{
  "question": "你的问题文本",
  "options": ["选项1", "选项2", "选项3"]
}`,
          },
          {
            role: 'user',
            content: `项目：${projectName}\n用户说了：${lastMessage}\n当前缺失：${report.gaps.join('、')}\n请生成下一个引导问题。`,
          },
        ],
        { temperature: 0.7, maxTokens: 256 },
      );

      const parsed = this.parseQuestionResponse(response);
      return {
        nextQuestion: parsed.question || `关于${target}，你能多说说吗？`,
        options: parsed.options || [],
        completeness: report,
        readyForPlan: false,
      };
    } catch (e) {
      this.logger.warn(`Discovery engine failed, using fallback: ${e}`);
      return this.fallbackQuestion(report);
    }
  }

  private parseQuestionResponse(response: string): { question: string; options: string[] } {
    try {
      // 尝试直接解析 JSON
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        question: parsed.question || '',
        options: Array.isArray(parsed.options) ? parsed.options : [],
      };
    } catch {
      // 尝试从文本中提取
      const lines = response.split('\n').filter(l => l.trim());
      const question = lines[0]?.replace(/^["']|["']$/g, '').trim() || '';
      const options = lines.slice(1).map(l => l.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean);
      return { question, options };
    }
  }

  private fallbackQuestion(report: CompletenessReport): DiscoveryResult {
    const gap = this.completenessChecker.getPriorityGap(report);
    const questions: Record<string, { q: string; opts: string[] }> = {
      '产品形态': { q: '你希望做成什么形式？', opts: ['网页版', '手机App', '微信小程序', '都可以'] },
      '目标用户': { q: '谁会用到这个工具？', opts: ['我自己用', '我的小团队', '对外服务客户', '不确定'] },
      '核心功能': { q: '最重要的功能是什么？', opts: ['数据管理', '用户协作', '报表展示', '自动化处理'] },
      '数据模型': { q: '主要管理什么数据？', opts: ['客户信息', '订单/交易', '内容/文章', '库存/物资'] },
      '业务规则': { q: '有什么特殊规则吗？', opts: ['有审批流程', '有权限区分', '有自动通知', '暂时没有'] },
      '规模预估': { q: '预计有多少用户或数据？', opts: ['小于100人', '100-1000人', '1000人以上', '不确定'] },
      '验收标准': { q: '怎么判断做好了？', opts: ['功能能用就行', '需要稳定可靠', '需要好看好用', '不确定'] },
    };

    const fallback = gap ? questions[gap.split('（')[0]] || questions['核心功能'] : questions['核心功能'];
    return {
      nextQuestion: fallback.q,
      options: fallback.opts,
      completeness: report,
      readyForPlan: false,
    };
  }
}
