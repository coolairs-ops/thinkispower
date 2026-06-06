import { Injectable } from '@nestjs/common';

/**
 * 交付控制层 — 执行器路由（ExecutorRouter）
 *
 * 按任务类型与风险等级，决定用哪个执行器：
 *   - claude-code：CC Bridge 全栈执行器（多文件、可运行命令、强约束）
 *   - cloudecode：快速预览/生成
 *   - deepseek：轻量、低成本
 *
 * 取代当前「分步生成失败 → 降级 cloudecode」的硬编码路径（见 cloudecode.client.ts:584）。
 * 纯规则逻辑，不依赖运行态；骨架阶段，尚未接入真实执行器调用。
 */

export type ExecutorKind = 'claude-code' | 'cloudecode' | 'deepseek';

export type TaskKind =
  | 'demo-preview'
  | 'fullstack'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'build-fix'
  | 'ui-tweak'
  | 'security'
  | 'test';

export interface RouteParams {
  /** 任务类型；兼容现有 Task.type 字符串 */
  taskType: TaskKind | string;
  /** 风险等级 1(低)–5(高)，默认 1 */
  riskLevel?: number;
}

export interface RouteDecision {
  executor: ExecutorKind;
  reason: string;
  /** 是否需要强验证（高风险/高危任务） */
  requireStrongVerification: boolean;
}

@Injectable()
export class ExecutorRouterService {
  route(params: RouteParams): RouteDecision {
    const { taskType } = params;
    const risk = this.clampRisk(params.riskLevel ?? 1);

    switch (taskType) {
      case 'security':
        return { executor: 'claude-code', reason: '安全相关修改需强约束与审查', requireStrongVerification: true };
      case 'database':
        return { executor: 'claude-code', reason: '数据库变更风险高，需迁移规则与强验证', requireStrongVerification: true };
      case 'build-fix':
        return { executor: 'claude-code', reason: '编译修复需读错误→改代码→再验证的闭环', requireStrongVerification: risk >= 3 };
      case 'demo-preview':
        return { executor: 'cloudecode', reason: 'Demo 预览追求快速可视结果', requireStrongVerification: false };
      case 'ui-tweak':
        return risk >= 3
          ? { executor: 'claude-code', reason: 'UI 改动风险偏高，改用全栈执行器', requireStrongVerification: false }
          : { executor: 'deepseek', reason: 'UI 小修改成本低、速度优先', requireStrongVerification: false };
      case 'fullstack':
      case 'frontend':
      case 'backend':
        return { executor: 'claude-code', reason: '多文件多步骤生成，需可运行命令的全栈执行器', requireStrongVerification: risk >= 4 };
      case 'test':
        return { executor: 'claude-code', reason: '测试生成需理解代码并运行验证', requireStrongVerification: false };
      default:
        return risk >= 3
          ? { executor: 'claude-code', reason: `未知任务类型(${taskType})且风险较高，保守选全栈执行器`, requireStrongVerification: risk >= 4 }
          : { executor: 'cloudecode', reason: `未知任务类型(${taskType})，默认快速执行器`, requireStrongVerification: false };
    }
  }

  private clampRisk(n: number): number {
    if (Number.isNaN(n)) return 1;
    return Math.max(1, Math.min(5, Math.floor(n)));
  }
}
