import { Injectable, BadRequestException } from '@nestjs/common';

const STATUS_LABEL_MAP: Record<string, string> = {
  needs_input: '正在了解需求',
  clarifying: '正在帮你整理需求',
  prd_ready: '需求文档已确认',
  plan_ready: '方案已生成',
  awaiting_plan_confirmation: '等待你确认方案',
  demo_generating: '正在生成预览',
  demo_ready: '预览已准备好',
  awaiting_demo_feedback: '预览已准备好，可以开始批注',
  developing: '正在自动开发',
  testing: '正在检查功能是否正常',
  fixing: '正在根据反馈修改',
  exporting: '正在打包导出',
  build_pending: '构建队列中',
  build_failed: '构建失败',
  deploying: '正在上线',
  completed: '软件已准备好',
  paused: '项目已暂停',
  failed: '遇到问题，平台正在自动处理',
};

/** 合法状态转换表 */
const TRANSITIONS: Record<string, string[]> = {
  needs_input:              ['clarifying'],
  clarifying:               ['prd_ready', 'needs_input'],
  prd_ready:                ['plan_ready', 'clarifying'],
  plan_ready:               ['demo_generating', 'awaiting_plan_confirmation'],
  awaiting_plan_confirmation: ['plan_ready'],
  demo_generating:          ['demo_ready'],
  demo_ready:               ['awaiting_demo_feedback', 'exporting', 'build_failed'],
  awaiting_demo_feedback:   ['fixing', 'developing'],
  developing:               ['testing', 'demo_ready'],
  testing:                  ['demo_ready', 'completed', 'fixing'],
  fixing:                   ['demo_ready'],
  exporting:                ['completed', 'build_failed', 'deploying'],
  build_pending:            ['exporting', 'build_failed'],
  build_failed:             ['exporting'],
  deploying:                ['completed', 'build_failed'],
  paused:                   ['needs_input', 'clarifying', 'prd_ready', 'plan_ready', 'demo_ready', 'exporting'],
  failed:                   ['needs_input', 'clarifying', 'fixing'],
};

@Injectable()
export class StatusMapperService {
  mapProjectStatusToPublicLabel(status: string): string {
    return STATUS_LABEL_MAP[status] || '正在处理';
  }

  getAllStatusLabels(): Record<string, string> {
    return { ...STATUS_LABEL_MAP };
  }

  /**
   * 校验项目状态转换是否合法。
   * 工程控制论 — 防止被控对象进入未定义状态。
   */
  validateTransition(current: string, next: string): boolean {
    if (current === next) return true; // 幂等
    const allowed = TRANSITIONS[current];
    if (!allowed) return false;
    return allowed.includes(next);
  }

  /**
   * 带校验的状态转换，非法时抛出 BadRequestException。
   * 统一所有状态更新的入口，避免散布在各处的直接 prisma.update。
   */
  assertValidTransition(current: string, next: string): void {
    if (!this.validateTransition(current, next)) {
      throw new BadRequestException(
        `非法的项目状态转换: "${current}" → "${next}"`,
      );
    }
  }

  /** 返回状态机定义的副本 */
  getTransitionTable(): Record<string, string[]> {
    return { ...TRANSITIONS };
  }
}
