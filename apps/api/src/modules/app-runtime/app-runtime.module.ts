import { Module } from '@nestjs/common';
import { SchemaMigrationService } from './schema-migration.service';
import { CrudRuntime } from './crud-runtime.service';
import { CrudDataService } from './crud-data.service';
import { AppRuntimeController } from './app-runtime.controller';
import { BACKEND_RUNTIME } from './backend-runtime.interface';

/**
 * 应用后端运行时模块（ADR-0001 / 路 B）。
 *
 * BACKEND_RUNTIME 令牌当前绑定到固定 CrudRuntime；路 C 换绑"生成代码容器"实现，
 * 契约/前端/部署不变（约束②）。PrismaService 由全局 SharedCoreModule 提供。
 */
@Module({
  controllers: [AppRuntimeController],
  providers: [
    SchemaMigrationService,
    CrudRuntime,
    CrudDataService,
    { provide: BACKEND_RUNTIME, useExisting: CrudRuntime },
  ],
  exports: [SchemaMigrationService, CrudRuntime, CrudDataService, BACKEND_RUNTIME],
})
export class AppRuntimeModule {}
