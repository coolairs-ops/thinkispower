import { Module } from '@nestjs/common';
import { BuildOrchestratorService } from './build-orchestrator.service';
import { RealBuildStepRunner } from './real-build-step-runner';
import { BUILD_STEP_RUNNER } from './build-step-runner.interface';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';

/**
 * 自治建造回路（ADR-0005）。编排器 + 真实执行器（generate→分段生成，test→结构门）。
 * 占位执行器 DefaultBuildStepRunner 保留于文件中，供需要时回退/对照。
 */
@Module({
  imports: [CloudecodeModule],
  providers: [
    BuildOrchestratorService,
    { provide: BUILD_STEP_RUNNER, useClass: RealBuildStepRunner },
  ],
  exports: [BuildOrchestratorService],
})
export class BuildModule {}
