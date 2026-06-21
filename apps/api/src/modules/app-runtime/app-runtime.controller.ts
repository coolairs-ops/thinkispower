import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body } from '@nestjs/common';
import { CrudDataService } from './crud-data.service';
import { RuleEvaluationService } from './rule-engine/rule-evaluation.service';

/**
 * 已部署应用的数据接口（ADR-0001 / 路 B，REST 约定见 app-runtime-rest-contract.md）。
 *
 * v1 公开、无 per-app 鉴权——按 projectId 隔离到各自 `proj_<id>` schema。
 * （per-app 鉴权按 ADR 延后；此控制器不挂 JwtAuthGuard 即为公开。）
 */
@Controller('api/app')
export class AppRuntimeController {
  constructor(
    private crud: CrudDataService,
    private ruleEval: RuleEvaluationService,
  ) {}

  /**
   * 形态B 运行态：生成的应用对一个对象跑规则评分（每查一个对象→读规则包+真实数据→八步→结论+证据链）。
   * 4 段路径（_evaluate 字面段），与 2 段 list / 3 段 get 不撞。未配规则包/未启用 → 引擎返 ruleEngineEnabled:false。
   * 前端经注入的 appData.evaluate(resource,id) 调它。
   */
  @Get(':projectId/_evaluate/:resource/:id')
  evaluate(@Param('projectId') projectId: string, @Param('resource') resource: string, @Param('id') id: string) {
    return this.ruleEval.evaluateObject(projectId, resource, id);
  }

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
