import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BUILD_STEP_RUNNER, BuildStepRunner, BuildModuleRef } from './build-step-runner.interface';

interface ModuleInput {
  name: string;
  spec?: string;
  deps?: string[]; // 依赖的模块 name
}

/**
 * 自治建造编排器（ADR-0005 第一锤）。
 * 确定性回路：DAG 遍历 → 每模块 生成→测试门→写日志→done|blocked。状态全在库
 * （BuildModule + BuildJournal），runNext/run 无状态可重入，故建造**跨上下文/会话续跑**。
 * 严谨在回路，不在单次 LLM 调用。
 */
@Injectable()
export class BuildOrchestratorService {
  private readonly logger = new Logger(BuildOrchestratorService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(BUILD_STEP_RUNNER) private runner: BuildStepRunner,
  ) {}

  /** 落建造计划（模块 DAG）。已有计划则跳过（幂等，避免重复建造）。 */
  async plan(projectId: string, modules: ModuleInput[]): Promise<{ created: number; skipped: boolean }> {
    const existing = await this.prisma.buildModule.count({ where: { projectId } });
    if (existing > 0) {
      return { created: 0, skipped: true };
    }
    await this.prisma.$transaction(
      modules.map((m, i) =>
        this.prisma.buildModule.create({
          data: { projectId, name: m.name, spec: m.spec ?? null, deps: (m.deps ?? []) as never, orderIdx: i },
        }),
      ),
    );
    await this.journal(projectId, null, 'plan', `建造计划：${modules.length} 个模块`, { modules: modules.map((m) => m.name) });
    return { created: modules.length, skipped: false };
  }

  /**
   * 单步（无状态、可重入）：原子认领下一 ready 模块 → 生成 → 测试门 → done|blocked。
   * 认领用 updateMany(pending→building) 守卫，并发下不会两个 worker 抢到同一模块。
   */
  async runNext(projectId: string): Promise<{ moduleId?: string; name?: string; status?: string; done?: boolean }> {
    const c = await this.claim(projectId);
    if (c === 'done' || c === 'waiting') return { done: true };
    const status = await this.buildClaimed(projectId, c);
    return { moduleId: c.id, name: c.name, status };
  }

  /**
   * 原子认领下一可建模块：pending 且 deps 全 done，updateMany(仅 pending→building) 守卫抢占。
   * 返回模块 / 'waiting'(有 in-progress 依赖在跑、稍后重试) / 'done'(无 pending 或剩余受阻无法推进)。
   */
  private async claim(projectId: string): Promise<BuildModuleRef | 'waiting' | 'done'> {
    const all = await this.prisma.buildModule.findMany({ where: { projectId }, orderBy: { orderIdx: 'asc' } });
    const pending = all.filter((m) => m.status === 'pending');
    if (pending.length === 0) return 'done';
    const doneNames = new Set(all.filter((m) => m.status === 'done').map((m) => m.name));
    const ready = pending.filter((m) => ((m.deps as string[] | null) ?? []).every((d) => doneNames.has(d)));
    for (const cand of ready) {
      // 原子抢占：仅当仍是 pending 才置 building；count===1 表示本 worker 抢到（否则被别人抢走）
      const claimed = await this.prisma.buildModule.updateMany({ where: { id: cand.id, status: 'pending' }, data: { status: 'building' } });
      if (claimed.count === 1) return { id: cand.id, name: cand.name, spec: cand.spec };
    }
    // 没抢到 ready：用「新鲜」状态判定（不能用开头的陈旧快照——并发下会把已被抢占的误判为无进展而提前停机）。
    // 有 building/testing 在跑 → 'waiting'(其完成可能解锁依赖者，稍后重试)；纯 pending 却无可认领 → deps 受阻 → 'done'。
    const fresh = await this.prisma.buildModule.findMany({ where: { projectId }, select: { status: true } });
    const inProgress = fresh.some((m) => m.status === 'building' || m.status === 'testing');
    return inProgress ? 'waiting' : 'done';
  }

  /** 对已认领(状态=building)的模块跑 生成→测试门→done|blocked，写日志。返回最终状态。 */
  private async buildClaimed(projectId: string, ref: BuildModuleRef): Promise<'done' | 'blocked'> {
    const gen = await this.runner
      .generate(projectId, ref)
      .catch((e): { ok: boolean; summary?: string; result?: unknown } => ({ ok: false, summary: String(e) }));
    if (!gen.ok) {
      await this.fail(projectId, ref, 'generate', gen.summary ?? '生成失败');
      return 'blocked';
    }
    // 产物落库（供测试门/后续拼装读取）
    await this.prisma.buildModule.update({ where: { id: ref.id }, data: { status: 'testing', result: (gen.result ?? undefined) as never } });
    await this.journal(projectId, ref.id, 'generate', `生成完成：${ref.name}${gen.summary ? ' — ' + gen.summary : ''}`, gen.summary ? { summary: gen.summary } : undefined);
    const t = await this.runner.test(projectId, ref).catch((e) => ({ passed: false, detail: String(e) }));
    if (!t.passed) {
      await this.fail(projectId, ref, 'test', '测试门未通过', t.detail);
      return 'blocked';
    }
    await this.prisma.buildModule.update({
      where: { id: ref.id },
      data: { status: 'done', result: { ...((gen.result as Record<string, unknown>) ?? {}), test: t.detail } as never },
    });
    await this.journal(projectId, ref.id, 'done', `模块完成：${ref.name}（测试门通过）`, t.detail);
    return 'done';
  }

  /**
   * 建造到无可建模块为止。有界并行：concurrency 个 worker 各自原子认领→建造，尊重 DAG 依赖
   * （依赖未就绪的模块等 in-progress 依赖完成再认领，无可推进则停）。先 reconcile 续跑。
   * 并发可配（BUILD_CONCURRENCY 默认 4，硬顶 8）；扁平模块即纯并行，有依赖时自动按拓扑就绪推进。
   */
  async run(
    projectId: string,
    opts: { concurrency?: number; maxSteps?: number; pollMs?: number } = {},
  ): Promise<{ done: number; blocked: number; pending: number; total: number }> {
    await this.reconcile(projectId);
    const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? (Number(process.env.BUILD_CONCURRENCY) || 4)));
    const maxSteps = opts.maxSteps ?? 1000;
    const pollMs = opts.pollMs ?? 200;
    let steps = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped && steps < maxSteps) {
        const c = await this.claim(projectId);
        if (c === 'done') {
          stopped = true;
          return;
        }
        if (c === 'waiting') {
          await this.delay(pollMs);
          continue;
        }
        steps++;
        await this.buildClaimed(projectId, c);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return this.summary(projectId);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 建造状态：各模块 + 近 30 条日志。 */
  async status(projectId: string) {
    const [modules, journal] = await Promise.all([
      this.prisma.buildModule.findMany({ where: { projectId }, orderBy: { orderIdx: 'asc' } }),
      this.prisma.buildJournalEntry.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    return { modules, journal, summary: await this.summary(projectId) };
  }

  // ─── 内部 ───

  /** 续跑对账：进程被杀/换会话后，卡在 building/testing 的模块重置回 pending 重做。 */
  private async reconcile(projectId: string): Promise<void> {
    const stuck = await this.prisma.buildModule.updateMany({
      where: { projectId, status: { in: ['building', 'testing'] } },
      data: { status: 'pending' },
    });
    if (stuck.count > 0) {
      await this.journal(projectId, null, 'resume', `续跑对账：${stuck.count} 个中断模块重置为 pending 重做`);
    }
  }

  private async summary(projectId: string) {
    const mods = await this.prisma.buildModule.findMany({ where: { projectId }, select: { status: true } });
    return {
      done: mods.filter((m) => m.status === 'done').length,
      blocked: mods.filter((m) => m.status === 'blocked').length,
      pending: mods.filter((m) => m.status === 'pending').length,
      total: mods.length,
    };
  }

  private async fail(projectId: string, ref: BuildModuleRef, phase: string, summary: string, detail?: unknown): Promise<void> {
    await this.prisma.buildModule.update({
      where: { id: ref.id },
      data: { status: 'blocked', result: { failedPhase: phase, detail } as never },
    });
    this.logger.warn(`模块 ${ref.name} 受阻(${phase}): ${summary}`);
    await this.journal(projectId, ref.id, 'blocked', `${ref.name} 受阻（${phase}）：${summary}`, detail);
  }

  private async journal(projectId: string, moduleId: string | null, phase: string, summary: string, detail?: unknown): Promise<void> {
    await this.prisma.buildJournalEntry.create({
      data: { projectId, moduleId: moduleId ?? undefined, phase, summary, detail: (detail ?? undefined) as never },
    });
  }
}
