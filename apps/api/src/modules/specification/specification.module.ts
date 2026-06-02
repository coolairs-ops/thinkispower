import { Module } from '@nestjs/common';
import { SpecificationController } from './specification.controller';
import { SpecificationService } from './specification.service';
import { DecisionController } from './decision.controller';
import { WarningController } from './warning.controller';
import { TestDeploymentController } from './test-deployment.controller';
import { IdeaInterviewController } from './idea-interview.controller';
import { ImprovementController } from './improvement.controller';
import { DecisionEngineService } from './decision-engine.service';
import { WarningService } from './warning.service';
import { TestDeploymentService } from './test-deployment.service';
import { IdeaInterviewService } from './idea-interview.service';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule],
  controllers: [
    SpecificationController,
    DecisionController,
    WarningController,
    TestDeploymentController,
    IdeaInterviewController,
    ImprovementController,
  ],
  providers: [
    SpecificationService,
    DecisionEngineService,
    WarningService,
    TestDeploymentService,
    IdeaInterviewService,
  ],
  exports: [SpecificationService],
})
export class SpecificationModule {}
