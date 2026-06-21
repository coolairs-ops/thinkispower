import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DeepseekService } from '../../../services/deepseek.service';

const QA_PROMPT = `你是这个业务系统的智能助手。基于给定的应用数据模型与规则回答用户问题，简明、专业、口语化。
铁律：不要编造数据或数字；涉及评分/分级结论时，提示"结论可溯源、默认待人工确认"；信息不足就直说需要哪些数据。`;

/**
 * 生成 app 的智能问答（活数据端点 2b）：基于本项目的数据模型/规则上下文回答。
 * 最小实现——真实证据引用待接知识库/规则评估，prompt 已要求不编造。
 */
@Injectable()
export class QaService {
  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  async answer(projectId: string, question: string): Promise<{ answer: string }> {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, dataModel: true, structuredRequirement: true } });
    if (!p) throw new NotFoundException('项目不存在');
    const sr = (p.structuredRequirement ?? {}) as Record<string, unknown>;
    const hasRules = !!sr.rulePack;
    const ctx = [
      `应用：${p.name || '未命名'}`,
      `数据模型：\n${(p.dataModel || '（无）').slice(0, 1500)}`,
      hasRules ? '本应用启用了风险评分/分级（规则引擎），结论需可溯源、待人工确认。' : '',
    ].filter(Boolean).join('\n');
    const answer = await this.deepseek.chat(
      [
        { role: 'system', content: QA_PROMPT },
        { role: 'user', content: `${ctx}\n\n用户问题：${question}` },
      ],
      { temperature: 0.3, maxTokens: 800 },
    );
    return { answer: answer?.trim() || '暂时无法回答，请补充更具体的问题。' };
  }
}
