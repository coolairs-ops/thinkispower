import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { BuildModuleRef, BuildStepRunner } from './build-step-runner.interface';

/**
 * 真实建造步骤执行器（ADR-0005 下一锤）：
 *   - generate → 分段生成的单页功能界面（CloudecodeClient.generatePageContent）
 *   - test     → 确定性结构门（内容达标 + 含可操作元素 data-module-key）
 * 编排器在 generate 后已把产物落到 BuildModule.result，故 test 直接读库判定。
 */
@Injectable()
export class RealBuildStepRunner implements BuildStepRunner {
  private readonly logger = new Logger(RealBuildStepRunner.name);
  private static readonly MIN_BYTES = 200;

  constructor(
    private prisma: PrismaService,
    private cloudecode: CloudecodeClient,
  ) {}

  async generate(projectId: string, module: BuildModuleRef): Promise<{ ok: boolean; summary?: string; result?: unknown }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, dataModel: true },
    });
    const appName = (project?.name || '应用').slice(0, 20);
    const brief = module.spec || module.name;

    let html = '';
    try {
      html = await this.cloudecode.generatePageContent(appName, brief, project?.dataModel ?? null);
    } catch (e) {
      return { ok: false, summary: `生成调用失败: ${e instanceof Error ? e.message : e}` };
    }
    if (!html || html.length < RealBuildStepRunner.MIN_BYTES) {
      return { ok: false, summary: `生成内容过短(${html?.length ?? 0} bytes)` };
    }
    this.logger.log(`生成页面 ${module.name}: ${html.length} bytes`);
    return { ok: true, summary: `${html.length} bytes`, result: { html, len: html.length } };
  }

  /** 确定性测试门：内容达标长度 + 含可操作元素（data-module-key）才算通过。 */
  async test(_projectId: string, module: BuildModuleRef): Promise<{ passed: boolean; detail?: unknown }> {
    const m = await this.prisma.buildModule.findUnique({ where: { id: module.id }, select: { result: true } });
    const html = (m?.result as { html?: string } | null)?.html;
    const len = html?.length ?? 0;
    const hasAction = !!html && /data-module-key=/.test(html); // 有可操作元素=是功能界面，不是纯介绍
    const passed = len >= RealBuildStepRunner.MIN_BYTES && hasAction;
    return { passed, detail: { len, hasAction } };
  }
}
