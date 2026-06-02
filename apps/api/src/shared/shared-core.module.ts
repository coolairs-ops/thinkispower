import { Module, Global } from '@nestjs/common';
import { DeepseekService } from '../services/deepseek.service';
import { StatusMapperService } from '../services/status-mapper.service';
import { BuildService } from '../services/build.service';
import { HtmlValidatorService } from '../services/html-validator.service';
import { ErrorMatcherService } from '../services/error-matcher.service';
import { HtmlModuleExtractorService } from '../services/html-module-extractor.service';
import { SanitizeService } from '../services/sanitize.service';
import { ClarifyService } from '../services/clarify.service';
import { DemoGeneratorService } from '../services/demo-generator.service';
import { QualityGateService } from '../services/quality-gate.service';
import { IterativeOptimizerService } from '../services/iterative-optimizer.service';
import { PrismaService } from '../database/prisma.service';

@Global()
@Module({
  providers: [
    DeepseekService, StatusMapperService, BuildService,
    HtmlValidatorService, ErrorMatcherService, HtmlModuleExtractorService,
    SanitizeService, ClarifyService, DemoGeneratorService,
    QualityGateService, PrismaService,
  ],
  exports: [
    DeepseekService, StatusMapperService, BuildService,
    HtmlValidatorService, ErrorMatcherService, HtmlModuleExtractorService,
    SanitizeService, ClarifyService, DemoGeneratorService,
    QualityGateService,
  ],
})
export class SharedCoreModule {}
