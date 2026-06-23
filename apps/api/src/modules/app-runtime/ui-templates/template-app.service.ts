import { Injectable, Logger, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { SchemaMigrationService } from '../schema-migration.service';
import { DeepseekService } from '../../../services/deepseek.service';
import { renderApp } from './app-template';
import { renderAdminApp, deriveAdminCaps } from './admin-template';
import { renderSchema } from './schema-renderer';
import { SchemaComposerService } from './schema-composer.service';
import { coerceSchema } from './schema-composer';
import { AppSchema } from './page-schema.types';
import { injectAppData } from './appdata-inject';
import { getTheme } from './theme-tokens';
import { pickFeatureSections, renderFeatureSection, FeatureSection } from './feature.template';
import { esc } from './app-shell.template';
import { ParsedModel } from '../data-model.types';
import { ruoyiFieldName, buildDataContract, normalizeContractForRuntime, DataContract } from '../app-contract';

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
    @Optional() private readonly deepseek?: DeepseekService,
    @Optional() private readonly composer?: SchemaComposerService,
  ) {}

  async buildAndStore(projectId: string, themeId?: string): Promise<{ theme: string; resource: string; columns: number }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, dataModel: true, themeConfig: true, planSummary: true, backendRuntime: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!project.dataModel) throw new BadRequestException('项目还没有数据模型，先生成方案/数据模型');
    const entities = this.schema.parseAndValidate(project.dataModel);
    if (!entities.length) throw new BadRequestException('数据模型未解析出实体');

    // 主资源选业务实体：跳过通用的 user/auth 类（几乎每个数据模型都有且常排第一，
    // 否则所有 demo 工作台都成"用户表(email/password/name)"、只有标题变）。全是通用则退回第一个。
    const GENERIC_TABLES = new Set(['user', 'users', 'account', 'accounts', 'auth', 'role', 'roles', 'permission', 'permissions', 'sysuser']);
    const primary = entities.find((e) => !GENERIC_TABLES.has(e.table.toLowerCase())) ?? entities[0];
    const backendKind = (project.backendRuntime as { kind?: string } | null)?.kind;

    const tc = (project.themeConfig ?? {}) as Record<string, unknown>;
    const theme = getTheme(themeId || (tc.templateTheme as string)).id;

    let html: string | null = null;
    let metric = 0;
    let appSchemaToStore: AppSchema | undefined;

    // Schema 驱动（S3）：compose（按需求/契约编排页面结构 + 校验门 + 兜底）→ renderSchema（确定性渲染）。
    // 替掉固定骨架(工作台+知识库+问答)与 feature.template 静态占位——按需求出页、块真绑 appData。
    // 失败/未注入 composer → 回退旧确定性模板（零风险）；env DEMO_SCHEMA_DRIVEN=0 可强制走旧路径。
    if (this.composer && process.env.DEMO_SCHEMA_DRIVEN !== '0') {
      try {
        const ps = (project.planSummary ?? {}) as { features?: unknown; pages?: unknown };
        const { schema, source, dropped } = await this.composer.compose({
          appName: project.name || '应用',
          dataModel: project.dataModel,
          backendKind,
          pageLabels: this.itemNames(ps.pages),
          features: this.itemNames(ps.features),
        });
        schema.themeId = theme;
        html = renderSchema(schema);
        appSchemaToStore = schema; // S4：落库供编辑面板读改
        metric = schema.pages.length;
        this.logger.log(`模板出页(schema/${source}) ${projectId}: 主题=${theme} ${metric}页 越界丢弃=${dropped.length} → ${html.length} bytes`);
      } catch (e) {
        this.logger.warn(`schema 驱动出页失败，回退旧模板: ${e instanceof Error ? e.message : e}`);
        html = null;
      }
    }

    if (!html) {
      // ── 旧确定性模板（回退路径）：推导工作台配置 + 签名功能段（静态占位）+ renderApp ──
      const columns = this.deriveColumns(primary, backendKind);
      const dash = {
        title: '工作台',
        primaryResource: primary.table,
        kpis: [{ label: `${primary.name} 总数`, resource: primary.table }],
        columns: columns.length ? columns : [{ key: 'id', label: 'ID' }],
      };
      const ps = (project.planSummary ?? {}) as { features?: unknown; summary?: unknown };
      const features = Array.isArray(ps.features) ? ps.features.map((f) => (typeof f === 'string' ? f : String((f as { name?: string })?.name ?? ''))) : [];
      const summary = typeof ps.summary === 'string' ? ps.summary : '';
      const picked = pickFeatureSections(features);
      const featureSections = await Promise.all(
        picked.map(async (f) => ({
          key: f.key,
          label: f.label,
          icon: f.icon,
          html: (await this.enrichFeature(f, project.name || '应用', summary, theme)) ?? renderFeatureSection(f),
        })),
      );
      html = renderApp({ appName: project.name || '应用', themeId: theme, dashboard: dash, featureSections });
      metric = columns.length;
      this.logger.log(`模板出页(legacy) ${projectId}: 主题=${theme} 资源=${primary.table} 列=${columns.length} 功能段=${featureSections.length} → ${html.length} bytes`);
    }

    html = injectAppData(html, projectId);

    const data: Record<string, unknown> = {
      demoHtml: html,
      demoUrl: `/demo/${projectId}`,
      status: 'demo_ready',
      publicStatusLabel: '预览已生成',
      themeConfig: { ...tc, templateTheme: theme },
    };
    if (appSchemaToStore) data.appSchema = appSchemaToStore; // S4：schema 落库
    await this.prisma.project.update({ where: { id: projectId }, data: data as never });
    return { theme, resource: primary.table, columns: metric };
  }

  /**
   * AI 增强一个签名功能段（方案 C 的 AI 刀）：DeepSeek 按功能描述生成更贴合的内容，
   * **约束在模板组件内**（已有 CSS 类 + var(--t-*)，无 script/style/外链）。
   * 无 LLM / 超时 / 产物不合法 → 返 null，由 buildAndStore 回退到确定性页型（永不空/不崩）。
   */
  private async enrichFeature(f: FeatureSection, appName: string, summary: string, themeId: string): Promise<string | null> {
    if (!this.deepseek) return null;
    const sys = [
      '你是政企应用的前端片段生成器。只输出一个 HTML 片段，严格遵守：',
      '1) 不要 <html>/<head>/<body>/<script>/<style>/<link>/<iframe>，不要 markdown 代码围栏；',
      '2) 只用这些已有 CSS 类：card h1 btn muted grid kpi badge，表格用 <table><th><td>；',
      '3) 颜色只用 CSS 变量 var(--t-primary)/var(--t-text)/var(--t-text-2)/var(--t-card-border)/var(--t-surface)，不要写死颜色；',
      '4) 片段要体现该功能的真实交互（输入区/操作按钮/结果或列表区），贴合业务、可读、克制；',
      '5) 用中文；不超过约 1500 字符。',
    ].join('\n');
    const user = `应用：${appName}${summary ? `（${summary.slice(0, 80)}）` : ''}\n功能：${f.title} —— ${f.desc}\n请生成「${f.title}」功能页的内容片段。`;
    try {
      const raw = await this.deepseek.chat(
        [{ role: 'system', content: sys }, { role: 'user', content: user }],
        { timeoutMs: 15_000, temperature: 0.4 },
      );
      const frag = this.sanitizeFragment(raw);
      if (!frag) return null;
      return `<div class="h1">${esc(f.title)}</div>${frag}`;
    } catch (e) {
      this.logger.warn(`功能段 AI 增强失败(${f.title})，回退确定性页型: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** 消毒 AI 片段：去代码围栏/危险标签/整页包裹；不合法（无标签/过短）返 null。 */
  private sanitizeFragment(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let s = String(raw).trim();
    s = s.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim(); // 去 markdown 围栏
    s = s.replace(/<\/?(?:html|head|body|!doctype)[^>]*>/gi, ''); // 去整页包裹
    s = s.replace(/<(script|style|iframe|link|meta)[\s\S]*?<\/\1>/gi, '').replace(/<(?:script|style|iframe|link|meta)[^>]*>/gi, ''); // 去危险标签
    s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/\son\w+\s*=\s*'[^']*'/gi, ''); // 去内联事件
    s = s.trim();
    if (s.length < 30 || !/<\w+[\s\S]*>/.test(s)) return null; // 不像 HTML 片段
    return s.slice(0, 8000);
  }

  /** 后台管理控制台（按需渲染，不存库）：数据模型 → 套后台外壳(管理侧栏+业务列表) → 注入 appData。 */
  async renderAdmin(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, dataModel: true, themeConfig: true, backendRuntime: true, structuredRequirement: true, planSummary: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!project.dataModel) throw new BadRequestException('项目还没有数据模型');
    const entities = this.schema.parseAndValidate(project.dataModel);
    if (!entities.length) throw new BadRequestException('数据模型未解析出实体');
    const primary = entities[0];
    const tc = (project.themeConfig ?? {}) as Record<string, unknown>;
    const backendKind = (project.backendRuntime as { kind?: string } | null)?.kind;
    const html = renderAdminApp({
      appName: project.name || '应用',
      themeId: getTheme(tc.templateTheme as string).id,
      resource: primary.table,
      resourceLabel: primary.name,
      columns: this.deriveColumns(primary, backendKind),
      caps: deriveAdminCaps(project.structuredRequirement, project.planSummary),
    });
    return injectAppData(html, projectId);
  }

  /**
   * 从实体推导前 4 列（剔主键/审计列；分级类字段标徽章）。前台/后台共用。
   *
   * key 是运行时数据访问键（模板 JS 用 `row[key]` 取值），label 是表头展示名。
   * 若依底座：codegen 把无下划线驼峰列名小写（`userId`→`userid`），代理返回的行键即小写；
   * 故 key 须按底座方言归一，否则 `row['userId']` 取不到 `row.userid` → 整列空白。
   * label 仍用模型原名（展示不受影响）。路B 等：key=label=原名，不变。
   */
  /**
   * 读项目页面 schema + 可绑数据契约（编辑面板 S4 用）。
   * 返回 contract 让面板的 bind 只能从契约资源/字段里选 = 可引用、不臆造。
   */
  async getAppSchema(projectId: string): Promise<{ schema: AppSchema | null; contract: DataContract }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    return { schema: ((project as Record<string, unknown>).appSchema as AppSchema) ?? null, contract: this.contractOf(project.dataModel, project.backendRuntime) };
  }

  /**
   * 保存编辑后的 schema（S4 可编辑闭环）：经 coerceSchema 校验门（越界块/资源/字段丢弃）→
   * renderSchema 重渲染 demoHtml → 落库 appSchema + demoHtml。前端面板改一行即重出页，不碰 HTML。
   */
  async saveAppSchema(projectId: string, raw: unknown): Promise<{ schema: AppSchema; dropped: string[] }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, dataModel: true, themeConfig: true, backendRuntime: true } });
    if (!project) throw new NotFoundException('项目不存在');
    const { schema, dropped } = coerceSchema(raw, this.contractOf(project.dataModel, project.backendRuntime));
    if (!schema || !schema.pages.length) throw new BadRequestException('schema 非法或无合法页（检查块类型/资源/字段是否都在数据契约内）');

    const tc = (project.themeConfig ?? {}) as Record<string, unknown>;
    schema.themeId = getTheme(tc.templateTheme as string).id;
    schema.appName = project.name || '应用';
    const html = injectAppData(renderSchema(schema), projectId);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { appSchema: schema, demoHtml: html, demoUrl: `/demo/${projectId}`, status: 'demo_ready', publicStatusLabel: '预览已生成' } as never,
    });
    this.logger.log(`保存编辑 schema ${projectId}: ${schema.pages.length}页 越界丢弃=${dropped.length} → ${html.length} bytes`);
    return { schema, dropped };
  }

  /** 数据模型 → 按底座方言归一的数据契约（解析失败 → 空契约，不抛）。 */
  private contractOf(dataModel: string | null | undefined, backendRuntime: unknown): DataContract {
    if (!dataModel) return { resources: [] };
    try {
      const backendKind = (backendRuntime as { kind?: string } | null)?.kind;
      return normalizeContractForRuntime(buildDataContract(this.schema.parseAndValidate(dataModel)), backendKind);
    } catch (e) {
      this.logger.warn(`契约解析失败，用空契约: ${e instanceof Error ? e.message : e}`);
      return { resources: [] };
    }
  }

  /** 取 planSummary.pages/features 的名字数组（字符串或 {name|label} 对象）。 */
  private itemNames(arr: unknown): string[] {
    return Array.isArray(arr)
      ? arr.map((x) => (typeof x === 'string' ? x : String((x as { name?: string; label?: string })?.name ?? (x as { label?: string })?.label ?? ''))).filter(Boolean)
      : [];
  }

  private deriveColumns(primary: ParsedModel, backendKind?: string) {
    return primary.fields
      .filter((f) => !f.isId && !SKIP_COLS.has(f.name.toLowerCase()))
      .slice(0, 4)
      .map((f) => ({
        key: backendKind === 'ruoyi' ? ruoyiFieldName(f.name) : f.name,
        label: f.name,
        badge: BADGE_RE.test(f.name),
      }));
  }
}
