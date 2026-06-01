import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SensorService } from '../../sensors/sensor.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/sensors')
export class SensorController {
  constructor(private sensorService: SensorService) {}

  /**
   * 全平台健康检查（无需认证，供运维/监控系统使用）
   */
  @Public()
  @Get('health')
  async health() {
    const report = await this.sensorService.runAll();
    return {
      status: report.passed ? 'healthy' : 'degraded',
      score: report.overallScore,
      layers: {
        l1: report.layer1Score,
        l2: report.layer2Score,
        l3: report.layer3Score,
      },
      recommendations: report.recommendations.slice(0, 5),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 完整传感器报告（需要认证）
   */
  @UseGuards(JwtAuthGuard)
  @Get('report')
  async fullReport(@Req() req: any) {
    return this.sensorService.runAll();
  }

  /**
   * 项目级传感器报告
   */
  @UseGuards(JwtAuthGuard)
  @Get('report/:projectId')
  async projectReport(@Req() req: any, @Param('projectId') projectId: string) {
    return this.sensorService.runAll(projectId);
  }
}
