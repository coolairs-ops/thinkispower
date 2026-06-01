import { Module } from '@nestjs/common';
import { SensorController } from './sensor.controller';

@Module({
  controllers: [SensorController],
})
export class SensorModule {}
