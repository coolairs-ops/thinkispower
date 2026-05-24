import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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
}
