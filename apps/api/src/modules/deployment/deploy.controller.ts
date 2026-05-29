import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DeploymentService } from './deployment.service';

@Controller('api/deploy')
export class DeployController {
  constructor(private deploymentService: DeploymentService) {}

  @Public()
  @Get(':projectId')
  async serveDeploy(@Param('projectId') projectId: string, @Res() res: Response) {
    try {
      const html = await this.deploymentService.getDeployedHtml(projectId);

      if (!html) {
        return res.status(404).type('application/json').json({
          message: '该应用尚未部署',
          statusCode: 404,
        });
      }

      res
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('X-Content-Type-Options', 'nosniff')
        .set('X-Frame-Options', 'SAMEORIGIN')
        .send(html);
    } catch {
      return res.status(404).type('application/json').json({
        message: '该应用尚未部署',
        statusCode: 404,
      });
    }
  }
}
