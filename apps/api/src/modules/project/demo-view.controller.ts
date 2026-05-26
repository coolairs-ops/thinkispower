import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/projects')
export class DemoViewController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get(':projectId/demo')
  async serveDemo(@Param('projectId') projectId: string, @Res() res: Response) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true },
      });

      if (!project?.demoHtml) {
        return res.status(404).type('application/json').json({
          message: '该应用尚未就绪',
          statusCode: 404,
        });
      }

      res
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('X-Content-Type-Options', 'nosniff')
        .set('X-Frame-Options', 'SAMEORIGIN')
        .send(project.demoHtml);
    } catch {
      return res.status(404).type('application/json').json({
        message: '该应用尚未就绪',
        statusCode: 404,
      });
    }
  }
}
