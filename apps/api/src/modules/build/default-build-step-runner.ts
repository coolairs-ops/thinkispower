import { Injectable, Logger } from '@nestjs/common';
import { BuildModuleRef, BuildStepRunner } from './build-step-runner.interface';

/**
 * 默认占位执行器（ADR-0005 第一锤）：让编排器回路可独立跑通与单测。
 * generate/test 暂为占位（恒成功），**下一锤替换为**：generate→分段生成、test→传感器/验收。
 */
@Injectable()
export class DefaultBuildStepRunner implements BuildStepRunner {
  private readonly logger = new Logger(DefaultBuildStepRunner.name);

  async generate(projectId: string, module: BuildModuleRef): Promise<{ ok: boolean; summary?: string }> {
    this.logger.log(`[占位] 生成模块 ${module.name} (project ${projectId})——待接分段生成`);
    return { ok: true, summary: '占位生成（待接分段生成）' };
  }

  async test(projectId: string, module: BuildModuleRef): Promise<{ passed: boolean; detail?: unknown }> {
    this.logger.log(`[占位] 测试门 ${module.name}——待接传感器/验收`);
    return { passed: true, detail: { placeholder: true } };
  }
}
