import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Headers, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CrudDataService } from './crud-data.service';
import { RuoyiDataProxyService } from './ruoyi-data-proxy.service';
import { RuleEvaluationService } from './rule-engine/rule-evaluation.service';
import { KnowledgeSourceService } from './knowledge/knowledge-source.service';
import { QaService } from './qa/qa.service';
import { isDefaultAppLogin } from './app-login-defaults';

/**
 * 已部署应用的数据接口（ADR-0001 / 路 B，REST 约定见 app-runtime-rest-contract.md）。
 *
 * v1 公开、无 per-app 鉴权——路 B 按 projectId 隔离到各自 `proj_<id>` schema。
 * 若依底座（backendRuntime.kind='ruoyi' 且 ready）：同一条 /api/app 路由**分流到 RuoyiDataProxyService**，
 *   按终端用户登录态（x-app-session 头）代持本人若依 token 转发，data_scope 真按人生效（A 架构）。
 */
@Controller('api/app')
export class AppRuntimeController {
  constructor(
    private prisma: PrismaService,
    private crud: CrudDataService,
    private ruoyiProxy: RuoyiDataProxyService,
    private ruleEval: RuleEvaluationService,
    private knowledgeSource: KnowledgeSourceService,
    private qa: QaService,
  ) {}

  /** 该项目是否以若依为后端且已就绪（决定 /api/app CRUD 走代理还是路B）。未配若依则快速否决，不打 DB。 */
  private async getRuoyiRuntime(projectId: string): Promise<{ kind?: string; status?: string; initialUsers?: Array<{ userName?: string; password?: string }> } | null> {
    if (!this.ruoyiProxy.enabled) return null;
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { backendRuntime: true } });
    return p?.backendRuntime as { kind?: string; status?: string; initialUsers?: Array<{ userName?: string; password?: string }> } | null;
  }

  private async isRuoyi(projectId: string): Promise<boolean> {
    const be = await this.getRuoyiRuntime(projectId);
    return be?.kind === 'ruoyi' && be?.status === 'ready';
  }

  /** 终端用户登录（仅若依后端需要）：换本人 token，回 session（浏览器不见若依 token）。 */
  @Post(':projectId/_login')
  async login(@Param('projectId') projectId: string, @Body() body: { username?: string; password?: string }) {
    const be = await this.getRuoyiRuntime(projectId);
    if (be?.kind !== 'ruoyi' || be?.status !== 'ready') throw new BadRequestException('该应用无需登录（非若依后端）');
    if (!body?.username || !body?.password) throw new BadRequestException('需要 username/password');
    const firstUser = be.initialUsers?.[0];
    const mapped = isDefaultAppLogin(body.username, body.password) && firstUser?.userName && firstUser?.password
      ? { username: firstUser.userName, password: firstUser.password }
      : { username: body.username, password: body.password };
    return this.ruoyiProxy.login(mapped.username, mapped.password);
  }

  /** 终端用户登出：作废服务端 session。 */
  @Post(':projectId/_logout')
  logout(@Headers('x-app-session') session?: string) {
    if (session) this.ruoyiProxy.logout(session);
    return { ok: true };
  }

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
  async list(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Query() query: Record<string, string>,
    @Headers('x-app-session') session?: string,
  ) {
    const { page, pageSize, sort, ...filters } = query;
    const opts = { page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined, sort, filters };
    if (await this.isRuoyi(projectId)) return this.ruoyiProxy.list(resource, session, opts);
    return this.crud.list(projectId, resource, opts);
  }

  @Get(':projectId/:resource/:id')
  async get(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Headers('x-app-session') session?: string,
  ) {
    if (await this.isRuoyi(projectId)) return this.ruoyiProxy.get(resource, session, id);
    return this.crud.get(projectId, resource, id);
  }

  @Post(':projectId/:resource')
  async create(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-app-session') session?: string,
  ) {
    if (await this.isRuoyi(projectId)) return this.ruoyiProxy.create(resource, session, body);
    return this.crud.create(projectId, resource, body);
  }

  @Put(':projectId/:resource/:id')
  async put(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-app-session') session?: string,
  ) {
    if (await this.isRuoyi(projectId)) return this.ruoyiProxy.update(resource, session, id, body);
    return this.crud.update(projectId, resource, id, body);
  }

  @Patch(':projectId/:resource/:id')
  async patch(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-app-session') session?: string,
  ) {
    if (await this.isRuoyi(projectId)) return this.ruoyiProxy.update(resource, session, id, body);
    return this.crud.update(projectId, resource, id, body);
  }

  @Delete(':projectId/:resource/:id')
  async remove(
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Headers('x-app-session') session?: string,
  ) {
    if (await this.isRuoyi(projectId)) return this.ruoyiProxy.remove(resource, session, id);
    return this.crud.remove(projectId, resource, id);
  }
}
