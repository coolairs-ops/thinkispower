import { Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BuildDemoService } from './build-demo.service';
import { PostBuildCritiqueService } from './post-build-critique.service';

/** 自治建造回路触发/查询（ADR-0005）。start 同步跑完（生产应入队）。 */
@Controller('api/projects/:projectId/build')
@UseGuards(JwtAuthGuard)
export class BuildController {
  constructor(
    private demo: BuildDemoService,
    private critique: PostBuildCritiqueService,
  ) {}

  /** 触发一次建造：分解模块 → 逐模块 生成→测试门→续跑 → 拼装成 demo */
  @Post()
  async start(@Req() req: any, @Param('projectId') projectId: string) {
    return this.demo.start(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 建造状态：各模块 + 近 30 条建造日志 */
  @Get()
  async status(@Req() req: any, @Param('projectId') projectId: string) {
    return this.demo.status(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 升级E 后置遍：建造后对产物/状态做完备性批判，产出后置缺口（可触发重建） */
  @Post('critique')
  async postBuildCritique(@Req() req: any, @Param('projectId') projectId: string) {
    return this.critique.critique(req.user.id, req.user.orgId ?? null, projectId);
  }
}
