import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchemaMigrationService } from './schema-migration.service';
import { CrudRuntime } from './crud-runtime.service';
import { CrudDataService } from './crud-data.service';
import { AppRuntimeController } from './app-runtime.controller';
import { BACKEND_RUNTIME } from './backend-runtime.interface';
import { RuoyiClient } from './ruoyi-client.service';
import { RuoyiRuntime } from './ruoyi-runtime.service';
import { RuoyiProvisionService } from './ruoyi-provision.service';
import { RuoyiProvisionProcessor } from './ruoyi-provision.processor';
import { RuoyiProvisionController } from './ruoyi-provision.controller';
import { AppSpecAssemblerService } from './app-spec-assembler.service';
import { RuoyiAppDataService } from './ruoyi-appdata.service';
import { RuleEngineService } from './rule-engine/rule-engine.service';
import { RuleEvaluationService } from './rule-engine/rule-evaluation.service';
import { RuleEvalController } from './rule-engine/rule-eval.controller';
import { RUOYI_PROVISION_QUEUE } from './ruoyi-provision.queue';

/**
 * 应用后端运行时模块（ADR-0001 路 B + ADR-0003 路 C 若依）。
 *
 * BACKEND_RUNTIME 令牌当前绑定到固定 CrudRuntime（路 B）；路 C 若依走独立 RuoyiProvisionService
 * （全自动 provision：建表→codegen→部署→重启→RBAC），入队后台跑。PrismaService 由全局 SharedCoreModule 提供。
 */
@Module({
  imports: [BullModule.registerQueue({ name: RUOYI_PROVISION_QUEUE })],
  controllers: [AppRuntimeController, RuoyiProvisionController, RuleEvalController],
  providers: [
    SchemaMigrationService,
    CrudRuntime,
    CrudDataService,
    { provide: BACKEND_RUNTIME, useExisting: CrudRuntime },
    RuoyiClient,
    RuoyiRuntime,
    RuoyiProvisionService,
    RuoyiProvisionProcessor,
    AppSpecAssemblerService,
    RuoyiAppDataService,
    RuleEngineService,
    RuleEvaluationService,
  ],
  exports: [SchemaMigrationService, CrudRuntime, CrudDataService, BACKEND_RUNTIME, RuoyiProvisionService, AppSpecAssemblerService, RuoyiAppDataService, RuleEngineService, RuleEvaluationService],
})
export class AppRuntimeModule {}
