import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoSnapshotService } from '../demo-snapshot/demo-snapshot.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { isProjectLocked } from '../../common/utils/project-status';
import { DEMO_QUEUE, DemoGenerateJob } from './demo.queue';

/** 预览生成进度（写入 project.demoProgress，供前端进度条/阶段文案展示） */
export interface DemoProgress {
  phase: 'queued' | 'generating' | 'done' | 'failed';
  percent: number;
  message: string;
  startedAt: string;
}

/** 单次生成的最坏耗时：chatWithRetry 最多 3 次 × 240s = 12 分钟。BullMQ 重试次数见 GEN_ATTEMPTS。 */
const SINGLE_GEN_TIMEOUT_MS = 12 * 60 * 1000;
/** BullMQ 重试次数（含首次）。job 持久化、进程重启可恢复，stalled 由 BullMQ 自愈。 */
const GEN_ATTEMPTS = 2;
/**
 * stale 兜底：worker 永久挂掉（非进程重启，BullMQ 能恢复）时让前端脱离死循环。
 * 必须覆盖所有重试预算：GEN_ATTEMPTS × 单次最坏 + 余量。
 */
const DEMO_GENERATION_TIMEOUT_MS = GEN_ATTEMPTS * SINGLE_GEN_TIMEOUT_MS + 60 * 1000;

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private demoSnapshotService: DemoSnapshotService,
    private cloudecode: CloudecodeClient,
    @InjectQueue(DEMO_QUEUE) private demoQueue: Queue<DemoGenerateJob>,
  ) {}

  async getDemo(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, publicStatusLabel: true, demoUrl: true, demoHtml: true, demoProgress: true, updatedAt: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    let status = project.status;
    let publicStatusLabel = project.publicStatusLabel;
    let progress = project.demoProgress as DemoProgress | null;
    // 兜底：worker 永久挂掉时让前端脱离死循环（进程重启时 BullMQ 会自行恢复 job，正常不会走到这）。
    if (status === 'demo_generating' && Date.now() - project.updatedAt.getTime() > DEMO_GENERATION_TIMEOUT_MS) {
      progress = { phase: 'failed', percent: progress?.percent ?? 0, message: '预览生成超时，请重试', startedAt: progress?.startedAt ?? new Date().toISOString() };
      await this.prisma.project.update({
        where: { id: project.id },
        data: { status: 'demo_failed', publicStatusLabel: '预览生成超时，请重试', demoProgress: progress as never },
      });
      status = 'demo_failed';
      publicStatusLabel = '预览生成超时，请重试';
      this.logger.warn(`Demo generation stale for ${projectId}, marked as failed`);
    }

    const ready = ['demo_ready', 'awaiting_demo_feedback', 'developing', 'completed'];
    return { status, publicStatusLabel, progress, demoUrl: project.demoUrl, html: ready.includes(status) ? project.demoHtml : null };
  }

  async generateDemo(userId: string, projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, userId: true, status: true, planSummary: true } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new ForbiddenException('无权访问');
    return this.doGenerate(p);
  }

  async generateDemoInternal(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, status: true, planSummary: true } });
    if (!p) throw new NotFoundException('项目不存在');
    return this.doGenerate(p);
  }

  /** N8N 回调：保存已生成的 Demo HTML */
  async saveDemoHtml(projectId: string, html: string) {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: html, demoUrl: `/demo/${projectId}`, status: 'demo_ready', publicStatusLabel: '预览已生成' },
    });
    this.logger.log(`Demo HTML saved for ${projectId}: ${html.length} bytes`);
  }

  private async doGenerate(p: { id: string; status: string; planSummary: any }) {
    // 终态保护：已进入开发/交付的项目不应被打回 demo 生成（与 confirmPlan 一致）
    if (isProjectLocked(p.status)) throw new BadRequestException('项目已进入开发/交付阶段，如需修改请使用迭代功能');
    const allowed = ['prd_ready', 'plan_ready', 'spec_confirmed', 'demo_generating', 'demo_ready', 'awaiting_demo_feedback', 'demo_failed'];
    if (!allowed.includes(p.status)) throw new BadRequestException('当前状态不允许');
    if (!p.planSummary) throw new BadRequestException('方案尚未生成');

    const progress: DemoProgress = { phase: 'queued', percent: 5, message: '已加入生成队列，即将开始…', startedAt: new Date().toISOString() };
    await this.prisma.project.update({
      where: { id: p.id },
      data: { status: 'demo_generating', publicStatusLabel: '正在生成预览', demoProgress: progress as never },
    });
    // 入队 BullMQ：持久化、进程重启可恢复、失败自动重试，取代原 fire-and-forget
    await this.demoQueue.add(
      'generate',
      { projectId: p.id },
      { attempts: GEN_ATTEMPTS, backoff: { type: 'fixed', delay: 3000 }, removeOnComplete: true, removeOnFail: 50 },
    );
    return { status: 'demo_generating', message: '预览正在生成中...' };
  }

  /** 队列消费的实际执行：更新进度 + 调生成（成功时 cloudecode 自身已写 demo_ready + demoHtml） */
  async executeGeneration(projectId: string): Promise<void> {
    await this.markProgress(projectId, { phase: 'generating', percent: 30, message: '正在生成页面内容，复杂应用通常需要 1-2 分钟…' });
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { planSummary: true } });
    const result = await this.cloudecode.generateDemoHtmlDirect(projectId, p?.planSummary);
    if (!result.success) throw new Error(result.rawError || '预览生成失败');
    await this.markProgress(projectId, { phase: 'done', percent: 100, message: '预览已生成' });
  }

  /** 生成出错：还会重试 → 提示重试中；终态失败 → 置 demo_failed（由 processor 按重试预算调用） */
  async onGenerationError(projectId: string, willRetry: boolean, nextAttempt: number): Promise<void> {
    if (willRetry) {
      await this.markProgress(projectId, { phase: 'generating', percent: 25, message: `生成遇到问题，正在重试（第 ${nextAttempt} 次）…` });
      return;
    }
    await this.markProgress(projectId, { phase: 'failed', percent: 100, message: '预览生成失败，请重试' });
    await this.prisma.project.update({ where: { id: projectId }, data: { status: 'demo_failed', publicStatusLabel: '预览生成失败' } });
  }

  /** 合并更新进度，保留 startedAt */
  private async markProgress(projectId: string, patch: Partial<DemoProgress>): Promise<void> {
    const cur = await this.prisma.project.findUnique({ where: { id: projectId }, select: { demoProgress: true } });
    const prev = (cur?.demoProgress as DemoProgress | null) ?? ({ startedAt: new Date().toISOString() } as DemoProgress);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoProgress: { ...prev, ...patch } as never },
    });
  }

  /** 从 Claude Code 输出中提取 HTML */
  private extractHtmlFromClaude(text: string): string {
    // 尝试提取 ```html 代码块
    const match = text.match(/```html\s*([\s\S]*?)\s*```/);
    if (match) return match[1].trim();
    // 尝试提取 ``` 代码块
    const match2 = text.match(/```\s*([\s\S]*?)\s*```/);
    if (match2) return match2[1].trim();
    // 检查是否直接是 HTML
    if (/<!DOCTYPE|<html/i.test(text)) return text.trim();
    // 返回原文
    return text.trim();
  }
}
