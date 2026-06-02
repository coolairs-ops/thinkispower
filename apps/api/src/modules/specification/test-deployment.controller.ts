import { Controller, Get, Post, Delete, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TestDeploymentService } from './test-deployment.service';

@Controller('api/projects/:projectId/test-deploy')
@UseGuards(JwtAuthGuard)
export class TestDeploymentController {
  constructor(private deployService: TestDeploymentService) {}

  /** 启动测试环境部署 */
  @Post()
  async deploy(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deployService.deploy(req.user.id, projectId);
  }

  /** 查询部署状态 */
  @Get()
  async getStatus(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deployService.getStatus(req.user.id, projectId);
  }

  /** 销毁测试环境 */
  @Delete()
  async destroy(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deployService.destroy(req.user.id, projectId);
  }
}
