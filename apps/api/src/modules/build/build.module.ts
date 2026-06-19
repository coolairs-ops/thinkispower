import { Module } from '@nestjs/common';
import { BuildOrchestratorService } from './build-orchestrator.service';
import { BuildDemoService } from './build-demo.service';
import { PostBuildCritiqueService } from './post-build-critique.service';
import { BuildController } from './build.controller';
import { RealBuildStepRunner } from './real-build-step-runner';
import { BUILD_STEP_RUNNER } from './build-step-runner.interface';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';

/**
 * 自治建造回路（ADR-0005）。编排器 + 真实执行器（generate→分段生成，test→结构门）
 * + demo 端到端门面（分解→plan→run→拼装）+ 触发/查询控制器。
 * 占位执行器 DefaultBuildStepRunner 保留于文件中，供需要时回退/对照。
 */
@Module({
  imports: [CloudecodeModule],
  controllers: [BuildController],
  providers: [
    BuildOrchestratorService,
    BuildDemoService,
    PostBuildCritiqueService,
    { provide: BUILD_STEP_RUNNER, useClass: RealBuildStepRunner },
  ],
  exports: [BuildOrchestratorService, BuildDemoService, PostBuildCritiqueService],
})
export class BuildModule {}
