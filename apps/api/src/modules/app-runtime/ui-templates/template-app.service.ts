import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { SchemaMigrationService } from '../schema-migration.service';
import { renderApp } from './app-template';
import { injectAppData } from './appdata-inject';
import { getTheme } from './theme-tokens';

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
    const columns = primary.fields
      .filter((f) => !f.isId && !SKIP_COLS.has(f.name.toLowerCase()))
      .slice(0, 4)
      .map((f) => ({ key: f.name, label: f.name, badge: BADGE_RE.test(f.name) }));

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
}
