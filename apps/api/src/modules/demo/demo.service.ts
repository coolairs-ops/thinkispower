import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoSnapshotService } from '../demo-snapshot/demo-snapshot.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { isProjectLocked } from '../../common/utils/project-status';

/**
 * demo 生成超过此时长仍未完成，判定为卡死（后台任务因进程重启等丢失），自愈为 failed。
 * 必须大于生成自身的最坏耗时，否则「还活着只是慢」的复杂规格会被提前判死：
 * generateDemoHtmlDirect → chatWithRetry 最多 3 次 × 240s/次 = 12 分钟。
 * 取 13 分钟留余量；真正的生成失败由 generateAsync 自己写 demo_failed，此处只兜底进程丢失。
 */
const DEMO_GENERATION_TIMEOUT_MS = 13 * 60 * 1000;

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private demoSnapshotService: DemoSnapshotService,
    private cloudecode: CloudecodeClient,
  ) {}

  async getDemo(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, publicStatusLabel: true, demoUrl: true, demoHtml: true, updatedAt: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    let status = project.status;
    let publicStatusLabel = project.publicStatusLabel;
    // 自愈：demo 生成是后台异步任务，进程中途重启会丢失，导致 status 永久卡在 demo_generating。
    // 超时仍未完成则判定失败，让前端脱离死循环、可重试。
    if (status === 'demo_generating' && Date.now() - project.updatedAt.getTime() > DEMO_GENERATION_TIMEOUT_MS) {
      await this.prisma.project.update({
        where: { id: project.id },
        data: { status: 'demo_failed', publicStatusLabel: '预览生成超时，请重试' },
      });
      status = 'demo_failed';
      publicStatusLabel = '预览生成超时，请重试';
      this.logger.warn(`Demo generation stale for ${projectId}, marked as failed`);
    }

    const ready = ['demo_ready', 'awaiting_demo_feedback', 'developing', 'completed'];
    return { status, publicStatusLabel, demoUrl: project.demoUrl, html: ready.includes(status) ? project.demoHtml : null };
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

    await this.prisma.project.update({ where: { id: p.id }, data: { status: 'demo_generating', publicStatusLabel: '正在生成预览' } });
    this.generateAsync(p.id, p.planSummary).catch(err => this.logger.error(`Demo失败:`, err));
    return { status: 'demo_generating', message: '预览正在生成中...' };
  }

  private async generateAsync(projectId: string, planSummary: any) {
    try {
      // Demo 生成直调 Cloudecode（快，27s），交付走 CC Bridge（全栈）
      const result = await this.cloudecode.generateDemoHtmlDirect(projectId, planSummary);
      if (!result.success) {
        await this.prisma.project.update({
          where: { id: projectId },
          data: { status: 'demo_failed', publicStatusLabel: '预览生成失败' },
        });
      }
    } catch (err) {
      this.logger.error(`Demo失败(${projectId}):`, err);
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'demo_failed', publicStatusLabel: '预览生成失败' },
      });
    }
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
