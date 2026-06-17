import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body } from '@nestjs/common';
import { CrudDataService } from './crud-data.service';

/**
 * 已部署应用的数据接口（ADR-0001 / 路 B，REST 约定见 app-runtime-rest-contract.md）。
 *
 * v1 公开、无 per-app 鉴权——按 projectId 隔离到各自 `proj_<id>` schema。
 * （per-app 鉴权按 ADR 延后；此控制器不挂 JwtAuthGuard 即为公开。）
 */
@Controller('api/app')
export class AppRuntimeController {
  constructor(private crud: CrudDataService) {}

  @Get(':projectId/:resource')
  list(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize, sort, ...filters } = query;
    return this.crud.list(projectId, resource, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sort,
      filters,
    });
  }

  @Get(':projectId/:resource/:id')
  get(@Param('projectId') projectId: string, @Param('resource') resource: string, @Param('id') id: string) {
    return this.crud.get(projectId, resource, id);
  }

  @Post(':projectId/:resource')
  create(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crud.create(projectId, resource, body);
  }

  @Put(':projectId/:resource/:id')
  put(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crud.update(projectId, resource, id, body);
  }

  @Patch(':projectId/:resource/:id')
  patch(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crud.update(projectId, resource, id, body);
  }

  @Delete(':projectId/:resource/:id')
  remove(@Param('projectId') projectId: string, @Param('resource') resource: string, @Param('id') id: string) {
    return this.crud.remove(projectId, resource, id);
  }
}
