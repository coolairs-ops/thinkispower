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
import { RequirementCompletionController } from './requirement-completion.controller';
import { RequirementCompletionService } from './requirement-completion.service';
import { RelationCompletionController } from './relation-completion.controller';
import { RelationCompletionService } from './relation-completion.service';
import { BusinessRuleCompletionController } from './business-rule-completion.controller';
import { BusinessRuleCompletionService } from './business-rule-completion.service';
import { FollowUpQuestionController } from './followup-question.controller';
import { FollowUpQuestionService } from './followup-question.service';
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
    RequirementCompletionController,
    RelationCompletionController,
    BusinessRuleCompletionController,
    FollowUpQuestionController,
  ],
  providers: [
    SpecificationService,
    DecisionEngineService,
    WarningService,
    TestDeploymentService,
    IdeaInterviewService,
    RequirementCompletionService,
    RelationCompletionService,
    BusinessRuleCompletionService,
    FollowUpQuestionService,
  ],
  exports: [SpecificationService],
})
export class SpecificationModule {}
