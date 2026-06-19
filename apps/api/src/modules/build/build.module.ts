import { Module } from '@nestjs/common';
import { BuildOrchestratorService } from './build-orchestrator.service';
import { DefaultBuildStepRunner } from './default-build-step-runner';
import { BUILD_STEP_RUNNER } from './build-step-runner.interface';

/**
 * 自治建造回路（ADR-0005）。第一锤：编排器 + 默认占位执行器。
 * 下一锤把 BUILD_STEP_RUNNER 换成接分段生成(generate)+传感器/验收(test)的真实现。
 */
@Module({
  providers: [
    BuildOrchestratorService,
    { provide: BUILD_STEP_RUNNER, useClass: DefaultBuildStepRunner },
  ],
  exports: [BuildOrchestratorService],
})
export class BuildModule {}
