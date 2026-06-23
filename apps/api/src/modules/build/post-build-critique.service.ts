import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';

/**
 * 需求补全 v2 · 升级E（后置遍）：建造完成后，对**产物/建造状态**做完备性批判，
 * 产出"前置 IR 扫描看不见、渲染/建造后才暴露"的 gap，回到用户采纳→可触发重建。
 *
 * 严守 ADR-0005：只聚合建造回路**自身已算出的真信号**（测试门 blocked / 覆盖缺口），
 * 不发明靠正则猜"按钮死活"的高误报扫描器（那是代理信号，会重蹈负优化/噪音覆辙）。
 */
@Injectable()
export class PostBuildCritiqueService {
  private readonly logger = new Logger(PostBuildCritiqueService.name);
  private static readonly MIN_BYTES = 200;

  constructor(private prisma: PrismaService) {}

  /** 跑一次后置批判（确定性，无 LLM）。ownership 校验。 */
  async critique(userId: string, orgId: string | null, projectId: string): Promise<{ gaps: PostBuildGap[]; summary: PostBuildSummary }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const modules = await this.prisma.buildModule.findMany({ where: { projectId }, orderBy: { orderIdx: 'asc' } });
    const gaps: PostBuildGap[] = [];

    for (const m of modules) {
      if (m.status === 'blocked') {
        gaps.push({
          source: 'post-build',
          kind: 'blocked',
          moduleName: m.name,
          issue: `未通过测试门：${this.describeFail(m.result)}`,
          suggestion: '重新生成该模块（产出更完整、含可操作元素的功能界面）',
          rebuildable: true,
        });
      } else if (m.status !== 'done') {
        // pending / building / testing：建造未跑完（依赖未就绪或被中断）
        gaps.push({
          source: 'post-build',
          kind: 'pending',
          moduleName: m.name,
          issue: '建造尚未完成（依赖未就绪或上次被中断）',
          suggestion: '重新触发建造，编排器会从交接日志续跑',
          rebuildable: true,
        });
      } else {
        const html = (m.result as { html?: string } | null)?.html;
        if (!html || html.length < PostBuildCritiqueService.MIN_BYTES || html.includes('暂无内容')) {
          gaps.push({
            source: 'post-build',
            kind: 'empty',
            moduleName: m.name,
            issue: '页面内容疑似为空或仅占位',
            suggestion: '重新生成该模块',
            rebuildable: true,
          });
        }
      }
    }

    // 覆盖缺口：需求里的页面多于实际建造的模块（如超出页数上限被砍 / 未纳入计划）。
    // 兑现"不静默截断"——把被丢掉的页面显式报给用户，而不是装作全覆盖了。
    const planned = this.plannedLabels(project.planSummary);
    if (planned.length > modules.length) {
      for (const label of planned.slice(modules.length)) {
        gaps.push({
          source: 'post-build',
          kind: 'uncovered-page',
          moduleName: label,
          issue: '需求中的该页面未纳入本次建造（超出当前页数上限或未进入计划）',
          suggestion: '放开页数上限后重建，或留待下一版补建',
          rebuildable: false,
        });
      }
    }

    const summary: PostBuildSummary = {
      total: gaps.length,
      blocked: gaps.filter((g) => g.kind === 'blocked').length,
      pending: gaps.filter((g) => g.kind === 'pending').length,
      empty: gaps.filter((g) => g.kind === 'empty').length,
      uncovered: gaps.filter((g) => g.kind === 'uncovered-page').length,
      modules: modules.length,
    };

    await this.prisma.buildJournalEntry.create({
      data: { projectId, phase: 'critique', summary: `后置批判：发现 ${gaps.length} 处后置缺口`, detail: { gaps, summary } as never },
    });
    this.logger.log(`后置批判 ${projectId}: ${JSON.stringify(summary)}`);
    return { gaps, summary };
  }

  /** 从 blocked 模块的 result 里读出可读的失败原因。 */
  private describeFail(result: unknown): string {
    const r = (result as { failedPhase?: string; detail?: { len?: number; hasAction?: boolean } } | null) || {};
    if (r.failedPhase === 'test') {
      if (r.detail && r.detail.hasAction === false) return '缺少可操作元素（疑似纯静态/介绍页，非功能界面）';
      if (r.detail && typeof r.detail.len === 'number' && r.detail.len < PostBuildCritiqueService.MIN_BYTES) return '内容过短';
      return '内容不达标';
    }
    if (r.failedPhase === 'generate') return '生成调用失败或内容过短';
    return '未通过测试门';
  }

  /** 提取 planSummary.pages 的全部页面名（不截断），用于覆盖缺口比对。 */
  private plannedLabels(planSummary: unknown): string[] {
    const raw = (planSummary as { pages?: unknown } | null)?.pages;
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((p) => (typeof p === 'string' ? p : (p as { name?: string } | null)?.name || ''))
      .filter(Boolean);
  }
}

export interface PostBuildGap {
  source: 'post-build';
  kind: 'blocked' | 'pending' | 'empty' | 'uncovered-page';
  moduleName: string;
  issue: string;
  suggestion: string;
  rebuildable: boolean;
}

export interface PostBuildSummary {
  total: number;
  blocked: number;
  pending: number;
  empty: number;
  uncovered: number;
  modules: number;
}
