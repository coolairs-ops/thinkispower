import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, BadRequestException } from '@nestjs/common';
import { CrudDataService } from './crud-data.service';
import { RuleEvaluationService } from './rule-engine/rule-evaluation.service';
import { KnowledgeSourceService } from './knowledge/knowledge-source.service';
import { QaService } from './qa/qa.service';

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
    private knowledgeSource: KnowledgeSourceService,
    private qa: QaService,
  ) {}

  /** 形态B/活数据：知识库（原件/证据/事实 + 证据链）。字面段，声明在通用 CRUD 之前避免被 :resource 吃掉。 */
  @Get(':projectId/_knowledge')
  knowledge(@Param('projectId') projectId: string) {
    return this.knowledgeSource.loadWithTrace(projectId);
  }

  /** 活数据：智能问答（基于本项目数据模型/规则回答）。 */
  @Post(':projectId/_qa')
  ask(@Param('projectId') projectId: string, @Body() body: { question?: string }) {
    if (!body?.question?.trim()) throw new BadRequestException('需要 question');
    return this.qa.answer(projectId, body.question.trim());
  }

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
