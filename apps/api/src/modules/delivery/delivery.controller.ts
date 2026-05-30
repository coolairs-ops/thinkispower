import { Controller, Get, Post, Param, Body, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';

@Controller('api/projects/:projectId/delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(private deliveryService: DeliveryService) {}

  @Get()
  async getDelivery(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.getDelivery(req.user.id, projectId);
  }

  @Post('confirm')
  async confirmDelivery(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.confirmDelivery(req.user.id, projectId);
  }

  @Post('request-source-download')
  async requestSourceDownload(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.requestExport(req.user.id, projectId, 'source');
  }

  @Post('request-package-export')
  async requestPackageExport(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.requestExport(req.user.id, projectId, 'package');
  }

  @Post('request-repository-transfer')
  async requestRepositoryTransfer(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.requestExport(req.user.id, projectId, 'repository');
  }

  @Post('request-database-export')
  async requestDatabaseExport(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.requestExport(req.user.id, projectId, 'database');
  }

  @Post('request-deployment-config')
  async requestDeploymentConfig(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.requestExport(req.user.id, projectId, 'deployment');
  }

  @Post('evaluate')
  async requestEvaluation(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.requestEvaluation(req.user.id, projectId);
  }

  @Post('production-deliver')
  async productionDeliver(@Req() req: any, @Param('projectId') projectId: string, @Body() body: any, @Res() res?: any) {
    return this.deliveryService.productionDeliver(req.user.id, projectId, body);
  }

  @Public()
  @Get('delivery-progress/:deliveryId')
  async deliveryProgress(@Param('deliveryId') deliveryId: string, @Req() req: any, @Res() res: any) {
    const ccUrl = 'http://host.docker.internal:5001';
    const ccRes = await fetch(`${ccUrl}/deliver/progress/${deliveryId}`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const reader = (ccRes as any).body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  }

  @Post('re-evaluate')
  async reEvaluate(@Req() req: any, @Param('projectId') projectId: string) {
  return this.deliveryService.reEvaluate(req.user.id, projectId);
  }

  @Get('re-evaluate-status')
  async reEvaluateStatus(@Req() req: any, @Param('projectId') projectId: string) {
  return this.deliveryService.getReEvaluateStatus(req.user.id, projectId);
  }

  @Post('accept-risk-fix')
  async acceptRiskFix(@Req() req: any, @Param('projectId') projectId: string, @Body('riskIndex') riskIndex: number, @Body('customFix') customFix?: string) {
    return this.deliveryService.acceptRiskFix(req.user.id, projectId, riskIndex, customFix);
  }

  @Post('accept-suggestion')
  async acceptSuggestion(@Req() req: any, @Param('projectId') projectId: string, @Body('suggestionId') suggestionId: string) {
    return this.deliveryService.acceptSuggestion(req.user.id, projectId, suggestionId);
  }
}
