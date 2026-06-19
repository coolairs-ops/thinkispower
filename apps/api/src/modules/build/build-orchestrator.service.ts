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
   * 单步（无状态、可重入）：挑下一 ready 模块 → 生成 → 测试门 → 写日志 → done|blocked。
   * 返回本步动作；done=true 表示已无 ready 模块（全 done 或剩受阻）。
   */
  async runNext(projectId: string): Promise<{ moduleId?: string; name?: string; status?: string; done?: boolean }> {
    const m = await this.nextReady(projectId);
    if (!m) return { done: true };
    const ref: BuildModuleRef = { id: m.id, name: m.name, spec: m.spec };

    // 生成
    await this.prisma.buildModule.update({ where: { id: m.id }, data: { status: 'building' } });
    const gen = await this.runner
      .generate(projectId, ref)
      .catch((e): { ok: boolean; summary?: string; result?: unknown } => ({ ok: false, summary: String(e) }));
    if (!gen.ok) {
      await this.fail(projectId, ref, 'generate', gen.summary ?? '生成失败');
      return { moduleId: m.id, name: m.name, status: 'blocked' };
    }
    await this.journal(projectId, m.id, 'generate', `生成完成：${m.name}${gen.summary ? ' — ' + gen.summary : ''}`, gen.result);

    // 测试门
    await this.prisma.buildModule.update({ where: { id: m.id }, data: { status: 'testing' } });
    const t = await this.runner.test(projectId, ref).catch((e) => ({ passed: false, detail: String(e) }));
    if (!t.passed) {
      await this.fail(projectId, ref, 'test', '测试门未通过', t.detail);
      return { moduleId: m.id, name: m.name, status: 'blocked' };
    }

    await this.prisma.buildModule.update({
      where: { id: m.id },
      data: { status: 'done', result: { test: t.detail } as never },
    });
    await this.journal(projectId, m.id, 'done', `模块完成：${m.name}（测试门通过）`, t.detail);
    return { moduleId: m.id, name: m.name, status: 'done' };
  }

  /** 跑到没有 ready 模块为止（确定性循环）。先对账续跑：把上次中断、卡在进行中的模块重置。 */
  async run(projectId: string, maxSteps = 100): Promise<{ done: number; blocked: number; pending: number; total: number }> {
    await this.reconcile(projectId);
    let steps = 0;
    while (steps++ < maxSteps) {
      const r = await this.runNext(projectId);
      if (r.done) break;
    }
    return this.summary(projectId);
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

  /** 下一个可建模块：pending 且所有 deps 都 done（拓扑就绪）；按 orderIdx 取最靠前。 */
  private async nextReady(projectId: string) {
    const all = await this.prisma.buildModule.findMany({ where: { projectId }, orderBy: { orderIdx: 'asc' } });
    const done = new Set(all.filter((m) => m.status === 'done').map((m) => m.name));
    for (const m of all) {
      if (m.status !== 'pending') continue;
      const deps = (m.deps as string[] | null) ?? [];
      if (deps.every((d) => done.has(d))) return m;
    }
    return null;
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
