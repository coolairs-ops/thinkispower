import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import {
  buildRequirementUplift,
  mergeRequirementUplift,
} from './requirement-uplift.service';

export interface InterviewState {
  stage: string;
  questionIndex: number;
  answers: { question: string; answer: string }[];
}

const QUESTION_BANK: Record<string, string[]> = {
  capture: [
    '给这个项目起个名字吧？（可以暂时起一个，以后可以改）',
    '用一句话描述你的想法——这个产品是做什么的？',
    '谁会用它？是给你自己用、团队用、还是公开给所有人？',
  ],
  philosophy: [
    '是什么让你想做这个产品？背后有什么痛点或信念？',
    '如果这个产品做得很完美，用户会有什么不同的感受？',
    '你希望它给人什么感觉：专业工具、轻快助手、数据看板、还是别的？',
  ],
  user: [
    '第一个真实的用户是谁？描述一下这个人。',
    '他们现在是怎么解决这个问题的？',
    '当前方案哪里最让人受不了？',
  ],
  flow: [
    '用户打开产品后，第一个要完成的任务是什么？',
    '从头到尾走一遍：用户怎么进入、怎么操作、怎么得到结果？',
    '新用户第一次打开时，应该看到什么、能做什么？',
  ],
  scope: [
    '第一版绝对必须有的功能是哪些？（列2-5个）',
    '哪些功能听起来很酷但可以以后再做？',
    '最小的能验证想法的版本长什么样？',
  ],
  ux: [
    '大概有几个主要页面或区域？分别是什么？',
    '用户一眼能看到的最重要的信息是什么？',
    '空白状态（还没数据时）应该展示什么？',
  ],
  data: [
    '这个产品需要存储什么数据？比如用户信息、订单、文章？',
    '数据是存在本地就够了，还是需要云端同步？',
    '需要对接外部系统吗？比如支付、邮件、地图？',
  ],
  platform: [
    '主要在电脑上用还是手机用？还是都要？',
    '需要登录/注册吗？还是可以免登录使用？',
    '需要离线使用吗？',
  ],
  technical: [
    '你有偏好的技术吗？没有的话平台会帮你选择最合适的。',
    '需要多用户权限吗？比如管理员和普通用户看到的不一样？',
    '对成本有要求吗？尽量免费还是可以接受一定费用？',
  ],
  quality: [
    '怎么判断第一版做成功了？验收标准是什么？',
    '哪些地方如果出错会让用户失去信任？',
    '最后交付时，你希望你能做什么来验证？',
  ],
};

const STAGE_ORDER = ['capture', 'philosophy', 'user', 'flow', 'scope', 'ux', 'data', 'platform', 'technical', 'quality'];

const STAGE_LABELS: Record<string, string> = {
  capture: '想法捕捉', philosophy: '产品理念', user: '目标用户',
  flow: '核心流程', scope: '范围边界', ux: '体验设计',
  data: '数据需求', platform: '平台选择', technical: '技术偏好',
  quality: '验收标准',
};

@Injectable()
export class IdeaInterviewService {
  private readonly logger = new Logger(IdeaInterviewService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
    private statusMapper: StatusMapperService,
  ) {}

  /** 获取或创建访谈状态 */
  async getState(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { structuredRequirement: true },
    });
    const sr = (project?.structuredRequirement as any) || {};
    const state: InterviewState = sr.ideaInterview || {
      stage: 'capture', questionIndex: 0, answers: [],
    };

    // 检查是否所有阶段都完成了
    const stageIdx = STAGE_ORDER.indexOf(state.stage);
    const done = stageIdx >= STAGE_ORDER.length - 1
      && state.questionIndex >= (QUESTION_BANK[state.stage]?.length || 0);

    const question = this.getCurrentQuestion(state);

    return {
      ...state,
      done,
      question,
      stageLabel: STAGE_LABELS[state.stage] || state.stage,
      totalStages: STAGE_ORDER.length,
      stageIndex: STAGE_ORDER.indexOf(state.stage),
      questionNumber: state.questionIndex + 1,
      totalInStage: QUESTION_BANK[state.stage]?.length || 0,
    };
  }

  /** 获取当前问题 */
  getCurrentQuestion(state: InterviewState): string | null {
    const questions = QUESTION_BANK[state.stage];
    if (!questions || state.questionIndex >= questions.length) return null;
    return questions[state.questionIndex];
  }

  /** 提交回答，返回下一个问题或完成状态 */
  async answer(projectId: string, answer: string) {
    const current = await this.getState(projectId);
    const question = this.getCurrentQuestion(current);
    if (!question) {
      // 当前阶段已完成，推进到下一阶段
      return this.advanceStage(projectId, current);
    }

    current.answers.push({ question, answer });
    current.questionIndex++;

    // 保存状态
    await this.saveState(projectId, current);

    // 检查当前阶段是否还有问题
    const nextQ = this.getCurrentQuestion(current);
    if (nextQ) {
      return {
        done: false,
        stage: current.stage,
        stageLabel: STAGE_LABELS[current.stage],
        question: nextQ,
        questionNumber: current.questionIndex + 1,
        totalInStage: QUESTION_BANK[current.stage].length,
        progress: Math.round((STAGE_ORDER.indexOf(current.stage) / STAGE_ORDER.length) * 100),
      };
    }

    // 当前阶段完成，推进
    return this.advanceStage(projectId, current);
  }

  private async advanceStage(projectId: string, state: InterviewState) {
    const currentIdx = STAGE_ORDER.indexOf(state.stage);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= STAGE_ORDER.length) {
      // 全部完成 — 生成结构化需求并更新项目状态
      await this.generateStructuredRequirement(projectId, state.answers);
      // 更新项目状态为 prd_ready，触发PRD确认流程
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'prd_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('prd_ready'),
        },
      });
      return {
        done: true,
        message: '🎉 需求访谈完成！平台已根据你的回答生成了结构化需求文档。',
        answersCount: state.answers.length,
      };
    }

    state.stage = STAGE_ORDER[nextIdx];
    state.questionIndex = 0;
    await this.saveState(projectId, state);

    const nextQ = QUESTION_BANK[state.stage]?.[0];
    return {
      done: false,
      stage: state.stage,
      stageLabel: STAGE_LABELS[state.stage],
      question: nextQ,
      questionNumber: 1,
      totalInStage: QUESTION_BANK[state.stage].length,
      progress: Math.round((nextIdx / STAGE_ORDER.length) * 100),
    };
  }

  private async saveState(projectId: string, state: InterviewState) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { structuredRequirement: true },
    });
    const sr = (project?.structuredRequirement as any) || {};
    sr.ideaInterview = state;
    const draft = buildRequirementUplift(state.answers);
    sr.requirementUpliftDraft = {
      source: 'deterministic_interview_uplift',
      answerCount: state.answers.length,
      signals: draft.signals,
      missingSlots: draft.missingSlots,
      counts: {
        roles: draft.roles.length,
        coreFunctions: draft.coreFunctions.length,
        dataModels: draft.dataModels.length,
        businessRules: draft.businessRules.length,
        acceptanceScenarios: draft.acceptanceScenarios.length,
      },
    };
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: sr as any },
    });
  }

  /** 访谈完成后，用AI生成结构化需求文档 */
  private async generateStructuredRequirement(
    projectId: string,
    answers: { question: string; answer: string }[],
  ) {
    const qa = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');

    const prompt = `根据以下用户访谈问答，生成产品需求文档（JSON格式）：

${qa}

输出JSON（只输出JSON，不要其他内容）：
{
  "prd": "产品需求简述(一段话)",
  "targetUsers": [{"role": "角色", "description": "描述"}],
  "coreFunctions": [{"name": "功能", "description": "描述", "priority": "must|nice|later"}],
  "outOfScope": [{"name": "暂不做", "reason": "原因"}],
  "pages": [{"name": "页面", "route": "/path", "description": "描述"}],
  "roles": [{"name": "角色", "permissions": ["权限"]}],
  "acceptanceScenarios": [{"name": "场景", "given": "前置", "when": "操作", "then": "预期", "priority": "must"}],
  "completeness": {"overall": 评估百分比数字}
}`;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { structuredRequirement: true, name: true },
    });
    const uplift = buildRequirementUplift(answers, { projectName: project?.name });
    const sr = (project?.structuredRequirement as any) || {};
    let parsed: any = null;

    try {
      const response = await this.deepseek.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 4096 },
      );
      const match = response.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    } catch (e) {
      this.logger.warn(`AI生成结构化需求失败，使用确定性需求提升结果: ${e}`);
    }

    if (parsed && typeof parsed === 'object') {
      Object.assign(sr, parsed);
    }
    sr.ideaInterview = {
      ...(sr.ideaInterview || {}),
      done: true,
      answers,
      completedAt: new Date().toISOString(),
    };
    const merged = mergeRequirementUplift(sr, uplift, { projectName: project?.name });
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: merged as any },
    });
    this.logger.log(
      `结构化需求已生成(需求提升门): project ${projectId} roles=${uplift.roles.length} functions=${uplift.coreFunctions.length} dataModels=${uplift.dataModels.length} rules=${uplift.businessRules.length} acceptance=${uplift.acceptanceScenarios.length}`,
    );
  }
}
