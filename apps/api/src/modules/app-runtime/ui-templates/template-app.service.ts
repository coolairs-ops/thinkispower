import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { SchemaMigrationService } from '../schema-migration.service';
import { renderApp } from './app-template';
import { renderAdminApp } from './admin-template';
import { injectAppData } from './appdata-inject';
import { getTheme } from './theme-tokens';
import { ParsedModel } from '../data-model.types';

const BADGE_RE = /level|grade|等级|分级|风险|评级/i;
const SKIP_COLS = new Set(['createdat', 'updatedat', 'created_at', 'updated_at']);

/**
 * 模板出页（"套模板填数据"接进 serve 链，替代 DeepSeek 即兴出 HTML）。
 *
 * buildAndStore：读项目数据模型 → 推导工作台配置(主资源/列/KPI) → 选主题 → renderApp 出整页 →
 * 注入 appData → 存 project.demoHtml（与 DeepSeek 路径同出口，serve/部署照旧）。
 * 确定性、零 LLM。
 */
@Injectable()
export class TemplateAppService {
  private readonly logger = new Logger(TemplateAppService.name);

  constructor(
    private prisma: PrismaService,
    private schema: SchemaMigrationService,
  ) {}

  async buildAndStore(projectId: string, themeId?: string): Promise<{ theme: string; resource: string; columns: number }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, dataModel: true, themeConfig: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!project.dataModel) throw new BadRequestException('项目还没有数据模型，先生成方案/数据模型');
    const entities = this.schema.parseAndValidate(project.dataModel);
    if (!entities.length) throw new BadRequestException('数据模型未解析出实体');

    const primary = entities[0];
    const columns = this.deriveColumns(primary);

    const tc = (project.themeConfig ?? {}) as Record<string, unknown>;
    const theme = getTheme(themeId || (tc.templateTheme as string)).id;

    const dash = {
      title: '工作台',
      primaryResource: primary.table,
      kpis: [{ label: `${primary.name} 总数`, resource: primary.table }],
      columns: columns.length ? columns : [{ key: 'id', label: 'ID' }],
    };
    let html = renderApp({ appName: project.name || '应用', themeId: theme, dashboard: dash });
    html = injectAppData(html, projectId);

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        demoHtml: html,
        demoUrl: `/demo/${projectId}`,
        status: 'demo_ready',
        publicStatusLabel: '预览已生成',
        themeConfig: { ...tc, templateTheme: theme } as never,
      },
    });
    this.logger.log(`模板出页 ${projectId}: 主题=${theme} 资源=${primary.table} 列=${columns.length} → ${html.length} bytes`);
    return { theme, resource: primary.table, columns: columns.length };
  }

  /** 后台管理控制台（按需渲染，不存库）：数据模型 → 套后台外壳(管理侧栏+业务列表) → 注入 appData。 */
  async renderAdmin(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, dataModel: true, themeConfig: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!project.dataModel) throw new BadRequestException('项目还没有数据模型');
    const entities = this.schema.parseAndValidate(project.dataModel);
    if (!entities.length) throw new BadRequestException('数据模型未解析出实体');
    const primary = entities[0];
    const tc = (project.themeConfig ?? {}) as Record<string, unknown>;
    const html = renderAdminApp({
      appName: project.name || '应用',
      themeId: getTheme(tc.templateTheme as string).id,
      resource: primary.table,
      resourceLabel: primary.name,
      columns: this.deriveColumns(primary),
    });
    return injectAppData(html, projectId);
  }

  /** 从实体推导前 4 列（剔主键/审计列；分级类字段标徽章）。前台/后台共用。 */
  private deriveColumns(primary: ParsedModel) {
    return primary.fields
      .filter((f) => !f.isId && !SKIP_COLS.has(f.name.toLowerCase()))
      .slice(0, 4)
      .map((f) => ({ key: f.name, label: f.name, badge: BADGE_RE.test(f.name) }));
  }
}
