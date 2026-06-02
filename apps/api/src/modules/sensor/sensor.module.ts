import { Module } from '@nestjs/common';
import { SensorController } from './sensor.controller';
import { QwenClient } from '../../sensors/qwen-client.service';
import { CompileValidator } from '../../sensors/compile-validator.service';
import { CrossValidator } from '../../sensors/cross-validator.service';
import { TraceabilityValidator } from '../../sensors/traceability-validator.service';
import { ScreenshotComparator } from '../../sensors/screenshot-comparator.service';
import { SensorFusionService } from '../../sensors/sensor-fusion.service';
import { L1StaticSensor } from '../../sensors/l1-static.sensor';
import { L2RuntimeSensor } from '../../sensors/l2-runtime.sensor';
import { L3SemanticSensor } from '../../sensors/l3-semantic.sensor';
import { SensorService } from '../../sensors/sensor.service';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule],
  controllers: [SensorController],
  providers: [
    QwenClient, CompileValidator, CrossValidator, TraceabilityValidator,
    ScreenshotComparator, SensorFusionService, L1StaticSensor, L2RuntimeSensor,
    L3SemanticSensor, SensorService,
  ],
  exports: [
    QwenClient, CompileValidator, CrossValidator, TraceabilityValidator,
    ScreenshotComparator, SensorFusionService, L1StaticSensor, L2RuntimeSensor,
    L3SemanticSensor, SensorService,
  ],
})
export class SensorModule {}
