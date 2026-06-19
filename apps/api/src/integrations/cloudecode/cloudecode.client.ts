import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';
import { BACKEND_RUNTIME, BackendRuntime } from '../../modules/app-runtime/backend-runtime.interface';

/** 所有代码生成 prompt 的公共前缀 — 强制要求文件路径标记 */
const FILE_PATH_REQUIREMENT = `【重要】每个文件必须用 \`\`\`文件路径 格式标记（不要用语言名）。正确格式：\`\`\`backend/src/user/user.service.ts\n内容\n\`\`\`。错误格式：\`\`\`typescript （会被丢弃）。\n`;

import { tailwindCdnUrl, daisyuiCssUrl } from '../../common/asset-urls';
import { adoptedDesignNotes } from '../../common/design-notes';
import { buildDemoShell, assembleDemoPages } from './demo-shell';

const HTML_MODIFICATION_PROMPT = `你是一个前端开发工程师。根据任务描述，生成/修改 Demo HTML 文件。

要求：
1. 单文件 HTML SPA，左侧导航 + 右侧内容区
2. 每个交互元素必须标注 data-module-key 和 data-element-path：
   - 按钮：{key} data-element-path="add-btn"、"save-btn"、"delete-btn"
   - 输入框：data-element-path="search-input"、"name-input"
   - 表格行/单元格：data-element-path="row-1"、"col-name"
   - 卡片/统计块：data-element-path="card-1"、"stat-total"
   - **不要把 data-module-key 挂在整页容器上，挂到具体可操作元素上**
   - **导航菜单项不要加 data-module-key**
3. 保持 onclick + navigate() 导航方式
4. 若现有 HTML 用了 daisyUI（<head> 含 daisyUI/tailwind CDN）：沿用 daisyUI 组件 class（btn/card/navbar 等）与语义色类，保留 CDN 与 <html> 的 data-theme，不要写死 hex 颜色、不要改回裸 CSS
5. 输出完整 HTML，不要 markdown 包裹`;

/** Demo 首次生成专用：基于 daisyUI 组件库（CDN 可配置/可域内自托管），产出可一键换肤的 SPA 预览 */
const buildDemoDaisyuiPrompt = (): string => `你是一名资深售前产品经理 + UI/UX 设计师 + 前端工程师。根据任务描述，生成一个**高保真售前演示样机**（单文件 HTML SPA）。客户领导与技术负责人打开后，要感觉这是接近真实产品的前端、30 秒看懂价值——不是后台管理系统，不是测试页。

## 视觉与产品感（必须）
- 风格现代、专业、高级、简洁、留白充足；卡片化布局、清晰标题层级、统一圆角与轻微阴影（daisyUI card / shadow-sm）。
- **首屏（总览页）必须有产品感**：产品名 + 一句话价值主张 + 3-4 个核心能力卡 + 一组关键指标（daisyUI stats/stat，含数值与趋势）+ 醒目的"开始演示/进入"入口。
- 看板页用图表感呈现趋势与异常（纯 CSS/SVG 条形或进度条即可，不必引图表库）；避免大面积灰色表格堆砌。

## 样式与技术（必须）
- 在 <head> 按此顺序引入 CDN：
  <script src="${tailwindCdnUrl()}"></script>
  <link href="${daisyuiCssUrl()}" rel="stylesheet" type="text/css" />
- 根元素写 <html lang="zh-CN" data-theme="corporate">（主题由系统切换，不要写死内联颜色）
- 组件一律用 daisyUI 语义 class：按钮 btn/btn-primary、卡片 card、顶栏 navbar、侧栏 menu、表格 table、统计 stats/stat、输入 input input-bordered、徽章 badge、提示 alert、开关 toggle 等
- 布局用 Tailwind 工具类（flex/grid/gap-*/p-*/w-*）
- 颜色一律用 daisyUI 语义色类（text-primary、bg-base-100、text-base-content、border-base-300 等），**不要写死 hex 颜色**，以便一键换肤

## 结构（必须）
- 单文件 HTML：左侧 daisyUI menu 导航 + 右侧内容区；多页面 SPA，点菜单经 navigate() 整页切换（不要 display:none）。
- 至少覆盖这 4 类视角（结合需求页面、按业务命名，不要照抄通用名）：① 总览首页 ② 核心业务流程（一条从输入到结果的完整路径，带"下一步"推进）③ 结果/报告页（展示处理后的价值结果）④ 管理看板（指标·趋势·异常提醒）。可选：技术与安全页（架构/数据流/权限/数据不出域，静态展示即可）。

## 交互（必须）
- 核心按钮必须可点击且有明确反馈；至少包含：Tab 切换、流程下一步、模拟生成结果、弹窗/详情面板（daisyUI modal）、看板筛选。**严禁核心按钮点击无反应。**

## 真实数据（必须）
- 先输出一段数据模型，用 \`\`\`prisma 代码块包裹，定义应用核心数据表；每个 model 必须有 id 主键，字段只用 Prisma 标量类型（String/Int/Float/Boolean/DateTime/Json）。示例：
  \`\`\`prisma
  model Todo {
    id        String   @id @default(uuid())
    title     String
    done      Boolean  @default(false)
    createdAt DateTime @default(now())
  }
  \`\`\`
- HTML 里所有数据读写都通过平台已注入的全局异步对象 \`appData\` 调真实接口，**禁止内联写死的假数据数组**：
  - 列表：const { items, total } = await appData.list('todo', { page:1, pageSize:20, sort:'createdAt:desc' });
  - 读取：const row = await appData.get('todo', id);
  - 新建：await appData.create('todo', { title:'买菜', done:false });
  - 更新：await appData.update('todo', id, { done:true });
  - 删除：await appData.remove('todo', id);
- 资源名 = 数据模型中对应 model 名的小写（model Todo → 'todo'）。
- 页面渲染时 await appData 拉取并填充；对调用做错误处理（失败时显示空状态或提示，不要让页面崩）。
- appData 由平台注入，**不要自己定义它**。
- **首屏要饱满**：页面加载时若 appData.list 返回空，**用 appData.create 播种 5-10 条贴近真实业务的演示数据**（真实感名称/时间/状态/数量/趋势），使首屏即有内容、且后续操作可持续。**严禁 Lorem Ipsum、严禁“测试1/测试2”占位数据。**

## 批注就绪（必须，勿省略）
- 每个按钮 / 输入框 / 表格行 / 统计卡 / 可操作项加 data-module-key="{模块key}" 和 data-element-path="{kebab-case}"；侧栏菜单项与页面大标题不加。

## 禁止
- 不要后台管理模板风、不要灰色表格堆砌、不要粗糙默认按钮、不要 Lorem Ipsum、不要大量“开发中/暂无数据”、不要只有静态页而无交互。

先输出 \`\`\`prisma 数据模型代码块，再输出完整 HTML（HTML 不要 markdown 包裹）。`;

/** 分段生成 · 第一段：只产数据模型（小输出，独立调用） */
const DEMO_DATAMODEL_PROMPT = `你是数据建模工程师。根据项目/页面/功能，只输出一段 \`\`\`prisma 数据模型代码块，定义应用核心数据表。
- 每个 model 必须有 id 主键，字段只用 Prisma 标量类型（String/Int/Float/Boolean/DateTime/Json）。
- 覆盖页面/功能涉及的核心实体（如门店、任务、记录、统计等），3-6 个 model 为宜。
只输出 \`\`\`prisma 代码块，不要任何其它文字或 HTML。`;

/** 分段生成 · 第二段：为单个页面生成**可操作的功能界面**（不是介绍页）。各页独立调用，绕开单次 8K 上限 */
const buildDemoPagePrompt = (isFirst: boolean): string => `你是前端工程师。只为**一个页面**生成**可操作的功能界面** HTML，不要 <html>/<head>/侧栏导航/<script> 外壳——平台已搭好，你只产这一页 <section> 内部内容。

## 必须是"能用的应用界面"，不是"介绍页"
- 做：数据**列表/表格**、**表单输入框**、**操作按钮**（新增/编辑/删除/查询/提交）、**筛选条**、**详情/编辑弹窗**（daisyUI modal）、关键**数值统计卡**。
${isFirst ? '- 本页=**数据看板**：几个真实统计数值（从 appData 数据算出）+ 近期记录列表 / 简单趋势条（纯 CSS 条即可），可点进。' : '- 本页做成对应的**功能操作界面**（列表 + 增删改查，或表单填写提交）。'}
- **严禁**：欢迎页 / “只需三步”引导 / 价值主张 / 大段功能描述文字 / 纯装饰大图标 / 占位文案。要像真在用的业务后台界面，不是落地页。

## 数据（必须真接口）
- 用平台已注入的全局 \`appData\`（list/get/create/update/remove），资源名=数据模型 model 名小写，**禁止写死假数据数组**；appData 已注入，不要自定义。
- **加载时若 appData.list 为空，用 appData.create 播种 5-10 条贴近真实业务的数据**（真实感名称/时间/状态/数量），让表格/列表饱满。**严禁 Lorem Ipsum / 测试1测试2。**
- 渲染做错误处理（失败显空状态，别崩）。

## 视觉 + 批注
- daisyUI 语义 class（table/btn/input/select/card/stat/modal/badge 等）+ daisyUI 语义色类（**不写死 hex**，便于换肤）；简洁专业、留白、轻阴影。
- 可操作元素（按钮/输入/表格行/统计卡）加 data-module-key="{key}" 和 data-element-path="{kebab-case}"。

只输出本页内容 HTML（可含本页所需 <script>），不要 markdown 包裹、不要外壳标签。`;

@Injectable()
export class CloudecodeClient {
  private readonly logger = new Logger(CloudecodeClient.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private deepseek: DeepseekService,
    private demoSnapshotService: DemoSnapshotService,
    private htmlExtractor: HtmlModuleExtractorService,
    @Inject(BACKEND_RUNTIME) private backend: BackendRuntime,
  ) {}

  async executeTask(taskId: string): Promise<{
    success: boolean;
    summary?: string;
    changedFiles?: string[];
    rawError?: string;
  }> {
    this.logger.log(`Cloudecode executing task ${taskId}`);

    try {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { project: { select: { demoHtml: true, id: true } } },
      });
      if (!task || !task.project) {
        return { success: false, rawError: `Task ${taskId} not found` };
      }

      const project = task.project;

      // 如果还没有 demoHtml，则是首次 Demo 生成 → 改用 HTML 生成 prompt
      if (!project.demoHtml && task.type === 'frontend') {
        return this.generateDemoHtml(task, project);
      }

      if (!project.demoHtml) {
        return { success: false, rawError: 'No demo HTML found for project' };
      }

      const moduleKey = (task.inputPayload as any)?.moduleKey as string | undefined;
      const elementPath = (task.inputPayload as any)?.elementPath as string | undefined;

      // 如果有 moduleKey，使用精简 HTML（只保留目标模块完整 render 内容）
      const [htmlForPrompt, actualModuleKey] = moduleKey
        ? [this.htmlExtractor.buildCondensedHtml(project.demoHtml, moduleKey), moduleKey]
        : [project.demoHtml, undefined];

      const userMessage = this.buildUserMessage(task.description, task.inputPayload, htmlForPrompt, actualModuleKey, elementPath);

      const response = await this.deepseek.chat(
        [
          { role: 'system', content: HTML_MODIFICATION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.3, maxTokens: 8192 },
      );

      const modifiedHtml = this.extractHtml(response);
      if (!modifiedHtml) {
        return { success: false, rawError: 'Failed to extract HTML from DeepSeek response' };
      }

      // Save pre-modification snapshot
      await this.demoSnapshotService.createSnapshot(
        project.id,
        project.demoHtml,
        'pipeline_execute',
        taskId,
      );

      // 如果有 moduleKey，将修改后的模块内容合并回原始 HTML
      const finalHtml = actualModuleKey
        ? this.htmlExtractor.mergeModuleContent(project.demoHtml, modifiedHtml, actualModuleKey)
        : modifiedHtml;

      await this.prisma.project.update({
        where: { id: project.id },
        data: { demoHtml: finalHtml },
      });

      this.logger.log(
        actualModuleKey
          ? `模块 ${actualModuleKey} 修改完成，合并回原始 HTML`
          : `全量 HTML 替换完成 (${finalHtml.length} bytes)`,
      );

      return {
        success: true,
        summary: `Task "${task.title}" completed: demo HTML updated`,
        changedFiles: ['demo.html'],
      };
    } catch (error) {
      this.logger.error(`Cloudecode task ${taskId} failed`, error);
      return {
        success: false,
        rawError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 首次 Demo 生成 — 从 plan 信息生成完整 HTML（无需 Task，供 DemoService 直调）。
   */
  async generateDemoHtmlDirect(projectId: string, planSummary: any): Promise<{
    success: boolean;
    summary?: string;
    rawError?: string;
  }> {
    this.logger.log(`Cloudecode directly generating demo HTML for project ${projectId}`);

    // 分段生成（确定性外壳 + 每页一次调用，绕开单次 8K 输出上限）。默认关，env DEMO_STAGED=1 开。
    if (this.config.get('DEMO_STAGED') === '1') {
      return this.generateDemoStaged(projectId, planSummary);
    }

    const pageNames = this.itemNames(planSummary?.pages);
    const pages = pageNames.length ? pageNames : ['首页', '列表页'];
    const features = this.itemNames(planSummary?.features);
    const name = planSummary?.summary || planSummary?.positioning || '应用';

    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const designNotes = adoptedDesignNotes(project?.structuredRequirement);
    const designBlock = designNotes ? `\n\n## 设计约束（用户已采纳，务必遵循）\n${designNotes}` : '';

    const prompt = `## 项目\n${name}\n\n## 页面\n${pages.map((p) => `- ${p}`).join('\n')}\n\n## 功能\n${features.map((f) => `- ${f}`).join('\n')}${designBlock}\n\n生成包含所有页面的完整 SPA HTML 预览。`;

    const response = await this.deepseek.chatWithRetry(
      [
        { role: 'system', content: buildDemoDaisyuiPrompt() },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 32768, expectHtml: true, timeoutMs: 240_000 },
    );
    if (!response) {
      return { success: false, rawError: 'Demo HTML generation failed after 3 retries' };
    }

    // 先抽走 ```prisma 数据模型块（否则 extractHtml 的兜底会误把它当 HTML），再提取 HTML
    const { dataModel, rest } = this.extractDataModel(response);
    const html = this.extractHtml(rest);
    if (!html) {
      return { success: false, rawError: 'Failed to extract HTML from DeepSeek response' };
    }

    // 数据模型 → 持久 + 置备真实后端（失败则降级为无数据后端，不阻断 demo 生成 / 向后兼容）
    if (dataModel) {
      try {
        await this.prisma.project.update({ where: { id: projectId }, data: { dataModel } });
        await this.backend.provision(projectId, dataModel);
        this.logger.log(`Demo 数据后端已置备 for project ${projectId}`);
      } catch (e) {
        this.logger.warn(`Demo 数据后端置备失败（降级为无数据后端）: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 注入 appData 客户端（指向 /api/app/<projectId>/）+ 批注支持
    const finalHtml = this.injectAnnotationSupport(this.injectAppDataClient(html, projectId));

    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: finalHtml, demoUrl: `/demo/${projectId}`, status: 'demo_ready', publicStatusLabel: '预览已生成' },
    });

    this.logger.log(`Demo HTML direct generated for project ${projectId}: ${finalHtml.length} bytes`);
    return { success: true, summary: 'Demo HTML generated' };
  }

  /**
   * 分段生成（ADR-0002 柱三）：数据模型一次小调用 → 确定性外壳 → 每页一次 LLM 调用 → 拼装。
   * 每页各享完整 ~8K 输出预算，绕开单次生成整 SPA 的输出上限，让售前 demo 真正丰富。
   */
  async generateDemoStaged(projectId: string, planSummary: any): Promise<{
    success: boolean;
    summary?: string;
    rawError?: string;
  }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, structuredRequirement: true } });
    const designNotes = adoptedDesignNotes(project?.structuredRequirement);
    const labels = this.itemNames(planSummary?.pages);
    const pageLabels = (labels.length ? labels : ['总览', '列表']).slice(0, 6);
    const features = this.itemNames(planSummary?.features);
    // 应用名用短项目名（别把整句价值描述塞进侧栏标题）；菜单取页面短名，完整描述单独传给每页 prompt
    const appName = (project?.name || planSummary?.positioning || '应用').slice(0, 20);
    const shortLabel = (s: string) => ((s.split(/[—–\-:：(（\s]/)[0].trim() || s).slice(0, 8));
    const pages = pageLabels.map((label, i) => ({ key: `p${i}`, label: shortLabel(label), brief: label }));
    this.logger.log(`分段生成 demo for project ${projectId}: ${pages.length} 页`);

    // 1. 数据模型（独立小调用）→ 持久 + 置备
    let dataModel: string | null = null;
    try {
      const resp = await this.deepseek.chatWithRetry(
        [
          { role: 'system', content: DEMO_DATAMODEL_PROMPT },
          { role: 'user', content: `## 项目\n${appName}\n## 页面\n${pageLabels.join('、')}\n## 功能\n${features.join('、') || '无'}` },
        ],
        { temperature: 0.2, maxTokens: 4096 },
      );
      dataModel = this.extractDataModel(resp || '').dataModel;
    } catch (e) {
      this.logger.warn(`分段生成数据模型失败（降级无数据后端）: ${e instanceof Error ? e.message : e}`);
    }
    if (dataModel) {
      try {
        await this.prisma.project.update({ where: { id: projectId }, data: { dataModel } });
        await this.backend.provision(projectId, dataModel);
      } catch (e) {
        this.logger.warn(`分段生成置备后端失败（降级）: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 2. 确定性外壳
    const shell = buildDemoShell({ appName, tailwindCdn: tailwindCdnUrl(), daisyuiCss: daisyuiCssUrl(), pages });

    // 3. 每页一次调用
    const pageHtmls: Record<string, string> = {};
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      try {
        const content = await this.generatePageContent(appName, p.brief, dataModel, i === 0, designNotes);
        pageHtmls[p.key] = content || `<div class="alert">「${p.label}」内容暂未生成</div>`;
      } catch (e) {
        this.logger.warn(`分段生成页「${p.label}」失败: ${e instanceof Error ? e.message : e}`);
        pageHtmls[p.key] = `<div class="alert alert-warning">「${p.label}」生成失败，可重试</div>`;
      }
    }

    // 4. 拼装 + 注入 appData/批注 + 保存
    const assembled = assembleDemoPages(shell, pageHtmls);
    const finalHtml = this.injectAnnotationSupport(this.injectAppDataClient(assembled, projectId));
    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: finalHtml, demoUrl: `/demo/${projectId}`, status: 'demo_ready', publicStatusLabel: '预览已生成' },
    });
    this.logger.log(`分段生成完成 for project ${projectId}: ${pages.length} 页 / ${finalHtml.length} bytes`);
    return { success: true, summary: `分段生成 ${pages.length} 页` };
  }

  /**
   * 生成单个页面的功能界面 HTML（一次 LLM 调用，各享完整预算）。
   * 供分段生成与自治建造回路（ADR-0005 的 generate 步）共用。
   */
  async generatePageContent(appName: string, brief: string, dataModel: string | null, isFirst = false, designNotes = ''): Promise<string> {
    const designBlock = designNotes ? `\n## 设计约束（用户已采纳，务必遵循）\n${designNotes}` : '';
    const resp = await this.deepseek.chatWithRetry(
      [
        { role: 'system', content: buildDemoPagePrompt(isFirst) },
        { role: 'user', content: `## 应用\n${appName}\n## 本页\n${brief}\n## 数据模型\n${dataModel || '（无，本页用静态内容即可）'}${designBlock}\n\n只输出本页的**功能界面** HTML（列表/表单/按钮，不是介绍页）。` },
      ],
      { temperature: 0.3, maxTokens: 8192, timeoutMs: 180_000 },
    );
    return this.extractPageContent(resp || '');
  }

  /** 从单页 LLM 响应抽出内容 HTML：去 ```html 围栏，去掉误带的 <html>/<head>/<body> 外壳，保留内容 */
  private extractPageContent(resp: string): string {
    let s = resp.trim();
    const fence = s.match(/```html?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // 若模型误带整页外壳，取 <body> 内或剥掉 <head>
    const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (body) return body[1].trim();
    s = s.replace(/<!DOCTYPE[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<head>[\s\S]*?<\/head>/i, '').trim();
    return s;
  }

  /** @deprecated 保留兼容 Pipeline（通过 executeTask 首次生成），新链路请用 generateDemoHtmlDirect */
  private async generateDemoHtml(task: any, project: any): Promise<{
    success: boolean;
    summary?: string;
    changedFiles?: string[];
    rawError?: string;
  }> {
    this.logger.log(`Cloudecode generating demo HTML for project ${project.id}`);

    const planSummary = (task.inputPayload as any)?.planSummary || {};
    const pageNames = this.itemNames(planSummary?.pages);
    const pages = pageNames.length ? pageNames : ['首页', '列表页'];
    const features = this.itemNames(planSummary?.features);
    const name = planSummary?.summary || planSummary?.positioning || '应用';

    const prompt = `## 项目\n${name}\n\n## 页面\n${pages.map((p) => `- ${p}`).join('\n')}\n\n## 功能\n${features.map((f) => `- ${f}`).join('\n')}\n\n生成包含所有页面的完整 SPA HTML 预览。`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: HTML_MODIFICATION_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 8192 },
    );

    const html = this.extractHtml(response);
    if (!html) {
      return { success: false, rawError: 'Failed to extract HTML from DeepSeek response' };
    }

    // 注入批注高亮支持（AI 生成的 HTML 缺少这部分）
    const finalHtml = this.injectAnnotationSupport(html);

    await this.prisma.project.update({
      where: { id: project.id },
      data: { demoHtml: finalHtml, demoUrl: `/demo/${project.id}`, status: 'demo_ready' },
    });

    this.logger.log(`Demo HTML generated for project ${project.id}: ${finalHtml.length} bytes`);
    return { success: true, summary: 'Demo HTML generated', changedFiles: ['demo.html'] };
  }

  /**
   * 注入批注高亮 CSS + 消息监听器到 AI 生成的 HTML。
   * AI 不会自动生成这部分，需要后处理补上。
   */
  injectAnnotationSupport(html: string): string {
    const highlightCss = `
.annotation-highlight { outline: 3px solid #3b82f6 !important; outline-offset: 2px; background: rgba(59,130,246,.08) !important; border-radius: 4px; }`;

    const highlightJs = `
var __tipCurrentEl = null;
// 批注/编辑：点任意元素都能选中（无 data-module-key 时回退到被点元素本身），
// 点击即直接高亮（不依赖父窗口回选），moduleKey 缺省用标签名兜底，保证编辑不被标注密度卡住。
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-module-key]') || e.target;
  if (el && el !== document.body && el !== document.documentElement) {
    __tipCurrentEl = el;
    document.querySelectorAll('.annotation-highlight').forEach(function(n) { n.classList.remove('annotation-highlight'); });
    el.classList.add('annotation-highlight');
    window.parent.postMessage({
      type: 'element-click',
      moduleKey: el.getAttribute('data-module-key') || el.tagName.toLowerCase(),
      elementPath: el.getAttribute('data-element-path') || ''
    }, '*');
  }
});

// 批注模式：接收父窗口指令（高亮 / 取消 / 档位调整）
window.addEventListener('message', function(e) {
  var d = e.data || {};
  if (d.type === 'highlight-element') {
    document.querySelectorAll('.annotation-highlight').forEach(function(el) { el.classList.remove('annotation-highlight'); });
    var sel = '[data-module-key="' + d.moduleKey + '"]';
    if (d.elementPath) sel += '[data-element-path="' + d.elementPath + '"]';
    var t = document.querySelector(sel) || __tipCurrentEl; // 标签名兜底选中时回选不到，保留点击时已选元素
    if (t) { __tipCurrentEl = t; t.classList.add('annotation-highlight'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  } else if (d.type === 'clear-highlight') {
    document.querySelectorAll('.annotation-highlight').forEach(function(el) { el.classList.remove('annotation-highlight'); });
  } else if (d.type === 'adjust-element' && __tipCurrentEl) {
    // 档位调整：对齐 / 字号（class 切换）；颜色：文字 / 背景（inline style，支持任意取色，保存时随 outerHTML 持久化）
    if (d.group === 'color' && d.value) {
      __tipCurrentEl.style.color = d.value;
    } else if (d.group === 'bg' && d.value) {
      __tipCurrentEl.style.backgroundColor = d.value;
    } else {
      var groups = { align: ['text-left','text-center','text-right'], size: ['text-xs','text-sm','text-base','text-lg','text-xl','text-2xl'] };
      var g = groups[d.group];
      if (g && d.value) { g.forEach(function(c){ __tipCurrentEl.classList.remove(c); }); __tipCurrentEl.classList.add('text-' + d.value); }
    }
  }
});`;

    // 注入 CSS 到 </style> 或 </head> 前
    if (html.includes('</style>')) {
      html = html.replace('</style>', highlightCss + '\n</style>');
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', '<style>' + highlightCss + '\n</style>\n</head>');
    }

    // 注入 JS 到最后一个 </script> 前
    const lastScript = html.lastIndexOf('</script>');
    if (lastScript > 0) {
      html = html.slice(0, lastScript) + highlightJs + '\n' + html.slice(lastScript);
    } else if (html.includes('</body>')) {
      html = html.replace('</body>', '<script>' + highlightJs + '\n</script>\n</body>');
    }

    return html;
  }

  /** 从 LLM 响应里抽出 ```prisma 数据模型块，并返回剩余文本（供后续提取 HTML）。 */
  private extractDataModel(response: string): { dataModel: string | null; rest: string } {
    const m = response.match(/```prisma\s*([\s\S]*?)```/i);
    if (!m) return { dataModel: null, rest: response };
    const dataModel = m[1].trim();
    return { dataModel: dataModel || null, rest: response.replace(m[0], '') };
  }

  /**
   * 注入 appData 客户端（ADR-0001 / slice 5）——已部署应用数据接口的薄封装。
   * 指向 /api/app/<projectId>/，须与 API 同源托管（部署编排 slice 7 保证）。
   * 注入到 <head> 内，确保先于页面脚本定义。list 失败静默回退空集合（避免页面崩），
   * 写操作失败抛错以便 UI 提示。路 C 切换后端实现后，本客户端与所有前端调用无需改动。
   */
  injectAppDataClient(html: string, projectId: string): string {
    const safeId = projectId.replace(/[^a-zA-Z0-9-]/g, ''); // 防御性：projectId 只允许 uuid 字符
    const js = `<script>/* appData: 已部署应用数据接口客户端 (ADR-0001) */
(function(){
  var BASE='/api/app/${safeId}/';
  function toQuery(o){o=o||{};var p=[];if(o.page)p.push('page='+encodeURIComponent(o.page));if(o.pageSize)p.push('pageSize='+encodeURIComponent(o.pageSize));if(o.sort)p.push('sort='+encodeURIComponent(o.sort));var f=o.filters||{};for(var k in f){if(Object.prototype.hasOwnProperty.call(f,k))p.push(encodeURIComponent(k)+'='+encodeURIComponent(f[k]));}return p.length?('?'+p.join('&')):'';}
  async function req(method,path,body){var res=await fetch(BASE+path,{method:method,headers:{'Content-Type':'application/json'},body:body!=null?JSON.stringify(body):undefined});var json=await res.json().catch(function(){return {};});if(!res.ok){throw new Error((json&&json.error&&json.error.message)||res.statusText||('HTTP '+res.status));}return json;}
  window.appData={
    list:function(resource,opts){return req('GET',resource+toQuery(opts)).then(function(r){return {items:r.data||[],total:r.total||0,page:r.page||1,pageSize:r.pageSize||0};}).catch(function(){return {items:[],total:0,page:1,pageSize:0};});},
    get:function(resource,id){return req('GET',resource+'/'+encodeURIComponent(id)).then(function(r){return r.data;});},
    create:function(resource,data){return req('POST',resource,data).then(function(r){return r.data;});},
    update:function(resource,id,data){return req('PATCH',resource+'/'+encodeURIComponent(id),data).then(function(r){return r.data;});},
    remove:function(resource,id){return req('DELETE',resource+'/'+encodeURIComponent(id)).then(function(){return true;});}
  };
})();
</script>`;
    if (html.includes('</head>')) return html.replace('</head>', js + '\n</head>');
    const bodyOpen = html.match(/<body[^>]*>/);
    if (bodyOpen) return html.replace(bodyOpen[0], bodyOpen[0] + '\n' + js);
    return js + html;
  }

  private buildUserMessage(
    description: string,
    inputPayload: any,
    html: string,
    moduleKey?: string,
    elementPath?: string,
  ): string {
    const lines: string[] = [];

    if (moduleKey) {
      lines.push(`## 目标模块\n${moduleKey}`);
    }
    if (elementPath) {
      lines.push(`## 目标元素\n${elementPath}`);
    }

    lines.push(
      `## 任务描述`,
      description,
      ``,
      `## 验收标准`,
      (inputPayload as any)?.acceptanceCriteria?.map((c: string) => `- ${c}`).join('\n') || '无',
      ``,
      `## 当前 HTML`,
      html,
    );

    return lines.join('\n');
  }

  /**
   * 为导出任务生成资产内容（仓库代码/数据库 SQL/部署配置）。
   */
  async generateAsset(
    taskType: string,
    project: { planSummary?: string | null; structuredRequirement?: any; demoHtml?: string | null },
  ): Promise<{ content: string; fileName: string; contentType: string }> {
    const configs: Record<string, { system: string; fileName: string; contentType: string }> = {
      export_repository: {
        system: `你是一个软件工程师。根据项目需求生成一个完整的 Git 仓库初始化文件集。
输出格式：对每个文件用 markdown 代码块标记文件名，例如：

\`\`\`markdown:README.md
# 项目名称
...
\`\`\`

\`\`\`javascript:package.json
...
\`\`\`

包含：README.md、package.json、src/index.js（或主入口）、.gitignore。
确保代码可运行、完整、无占位符。`,
        fileName: 'repository-files.md',
        contentType: 'text/markdown; charset=utf-8',
      },
      export_database_schema: {
        system: `你是一个数据库工程师。根据项目需求生成完整的数据库 Schema。
输出 SQL，包含：
- 所有表结构（CREATE TABLE），含主键、外键、索引
- 枚举类型（CREATE TYPE）
- 关系定义
- 字段默认值和非空约束

使用 PostgreSQL 语法。直接输出 SQL（不要 markdown 包裹）。`,
        fileName: 'schema.sql',
        contentType: 'text/plain; charset=utf-8',
      },
      export_deployment_config: {
        system: `你是一个 DevOps 工程师。根据项目需求生成部署配置。
输出格式：对每个配置文件用 markdown 代码块标记文件名。

包含：
- Dockerfile（多阶段构建）
- docker-compose.yml（含数据库依赖）
- nginx.conf（反向代理配置）
- .env.example

直接输出配置内容，不要解释。`,
        fileName: 'deployment-config.md',
        contentType: 'text/markdown; charset=utf-8',
      },
    };

    const config = configs[taskType];
    if (!config) {
      throw new Error(`Unknown export task type: ${taskType}`);
    }

    const planSummary = project.planSummary || '无';
    const structuredReq = project.structuredRequirement
      ? JSON.stringify(project.structuredRequirement, null, 2)
      : '无';

    const userMessage = `## 项目概要\n${planSummary}\n\n## 需求文档\n${structuredReq}`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: config.system },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3, maxTokens: 4096 },
    );

    return {
      content: response || '# 生成失败（API 返回空）',
      fileName: config.fileName,
      contentType: config.contentType,
    };
  }

  /**
   * 生成完整项目结构（多文件），替代仅优化单个 HTML。
   * 返回文件列表，由调用方打包为 zip。
   */
  async generateProject(
    project: { name?: string; demoHtml?: string | null; planSummary?: any; structuredRequirement?: any },
  ): Promise<Array<{ path: string; content: string }>> {
    const projectName = this.sanitizeProjectName(project.name || 'my-app');
    const demoHtml = project.demoHtml || '<!DOCTYPE html><html><head><title>App</title></head><body><p>No content</p></body></html>';
    const planSummary = project.planSummary || {};

    const files: Array<{ path: string; content: string }> = [];

    // 1. index.html — 核心 Demo
    files.push({ path: 'index.html', content: demoHtml });

    // 2. package.json
    files.push({
      path: 'package.json',
      content: JSON.stringify({
        name: projectName,
        version: '1.0.0',
        description: typeof planSummary === 'object' && planSummary.summary ? planSummary.summary : 'Generated by Think-is-power',
        scripts: {
          start: 'npx serve . -p 3000 -s',
          dev: 'npx serve . -p 3000 -s -l 3000',
          test: 'node tests/smoke.test.js',
          build: 'echo "Static HTML, no build needed"',
        },
        devDependencies: { serve: '^14.2.0' },
      }, null, 2),
    });

    // 3. README.md
    const summaryText = typeof planSummary === 'object' ? (planSummary as any).summary || '' : '';
    files.push({
      path: 'README.md',
      content: `# ${projectName}

${summaryText || '该项目由 Think-is-power 平台自动生成。'}

## 快速启动

\`\`\`bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
\`\`\`

打开浏览器访问 http://localhost:3000

## 部署

\`\`\`bash
# 使用 Docker
docker compose up -d
\`\`\`

## 项目结构

- \`index.html\` — 主页面（单页应用）
- \`package.json\` — 项目配置
- \`Dockerfile\` — 生产部署镜像
- \`docker-compose.yml\` — Docker 编排
- \`nginx.conf\` — Nginx 反向代理配置
- \`tests/smoke.test.js\` — 冒烟测试
`,
    });

    // 4. .gitignore
    files.push({
      path: '.gitignore',
      content: `node_modules/
dist/
.env
*.log
.DS_Store
`,
    });

    // 5. Dockerfile
    files.push({
      path: 'Dockerfile',
      content: `FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`,
    });

    // 6. nginx.conf
    files.push({
      path: 'nginx.conf',
      content: `server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`,
    });

    // 7. docker-compose.yml
    files.push({
      path: 'docker-compose.yml',
      content: `version: '3.8'
services:
  app:
    build: .
    ports:
      - "80:80"
    restart: unless-stopped
`,
    });

    // 8. tests/smoke.test.js
    files.push({
      path: 'tests/smoke.test.js',
      content: `// Basic smoke test — verifies the app starts and responds
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function check() {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const passed = res.statusCode === 200 && data.includes('<!DOCTYPE');
        console.log(passed ? '✓ Smoke test passed' : '✗ Smoke test failed');
        process.exit(passed ? 0 : 1);
      });
    }).on('error', (err) => {
      console.error('✗ Connection failed:', err.message);
      process.exit(1);
    });
  });
}

check();
`,
    });

    return files;
  }

  private sanitizeProjectName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'my-app';
  }

  /** planSummary 的 features/pages 可能是 string[]（描述路径）或 [{name}]（导入路径），统一取名字 */
  private itemNames(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === 'string' ? x : ((x as { name?: string })?.name ?? '')))
      .map((s) => String(s).trim())
      .filter(Boolean);
  }

  private extractHtml(response: string): string | null {
    const htmlMatch = response.match(/```html\s*([\s\S]*?)\s*```/);
    if (htmlMatch) return htmlMatch[1].trim();

    const codeMatch = response.match(/```\s*([\s\S]*?)\s*```/);
    if (codeMatch) return codeMatch[1].trim();

    if (response.includes('<html') || response.includes('<!DOCTYPE')) {
      // 输出被截断时代码块未闭合，上面两个正则会失配；这里兜底剥掉首尾残留的 ``` 围栏
      return response
        .replace(/^\s*```(?:html)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
    }

    return null;
  }

  /** 直接修改 Demo HTML — 绕过 Pipeline，供评估页调用 */
  async executeTaskForProject(projectId: string, fixDescription: string): Promise<{ success: boolean }> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true },
      });
      if (!project?.demoHtml) return { success: false };

      const prompt = `修改以下HTML Demo：\n\n修改需求：${fixDescription}\n\n只修改相关部分，保持其他内容不变。输出完整的修改后HTML。\n\n原始HTML：\n${project.demoHtml.slice(0, 20000)}`;

      const response = await this.deepseek.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 32768 }
      );

      const newHtml = this.extractHtml(response);
      if (!newHtml) return { success: false };

      await this.prisma.project.update({
        where: { id: projectId },
        data: { demoHtml: newHtml, status: 'demo_ready' },
      });

      this.logger.log(`Demo修改完成(${projectId}): ${project.demoHtml.length}→${newHtml.length} bytes`);
      return { success: true };
    } catch (e) {
      this.logger.error(`Demo修改失败: ${e}`);
      return { success: false };
    }
  }

  /** 全栈交付 — 生成完整可运行项目代码（降级路径，主路径使用分步生成） */
  async deliverFullstack(projectId: string, opts: { projectName: string; planSummary: any; demoHtml: string }) {
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${opts.projectName}"生成完整的全栈可运行代码。

计划：${JSON.stringify(opts.planSummary || {}).substring(0, 1500)}
Demo HTML：${opts.demoHtml.substring(0, 1500)}

必须输出以下文件内容，用 \`\`\`文件路径 标记每个文件：
1. database/schema.sql
2. backend/src/index.ts
3. backend/src/routes/ — 所有 API 路由
4. backend/package.json
5. frontend/index.html
6. docker-compose.yml
7. README.md

每个文件必须是完整可运行代码。`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 32768, timeoutMs: 180_000 },
    );

    const files = this.parseFiles(response);
    this.logger.log(`全栈交付(${projectId}): ${files.length} 个文件`);
    return { files, success: files.length > 0 };
  }

  // ═══ Phase A: 分步代码生成 ═══

  /** Step 1: 生成数据库 Schema */
  async generateSchema(projectId: string, payload: { projectName: string; planSummary: any; structuredRequirement?: any }): Promise<{ path: string; content: string } | null> {
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成 PostgreSQL schema.sql。

数据模型: ${JSON.stringify((payload.structuredRequirement as any)?.dataModels || payload.planSummary?.dataObjects || [])}
功能列表: ${JSON.stringify(payload.planSummary?.features || [])}

要求:
- PostgreSQL 16 语法
- 所有表用 UUID 主键: id UUID DEFAULT gen_random_uuid() PRIMARY KEY
- 包含 created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ
- 外键用 REFERENCES
- 用 \`\`\`database/schema.sql 包裹全部 SQL`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000 },
    );
    const match = response.match(/```sql\s*([\s\S]*?)```/) || response.match(/(CREATE\s+TABLE[\s\S]*)/i);
    if (!match) return null;
    return { path: 'database/schema.sql', content: match[1].trim() };
  }

  /** Step 2: 生成后端 API */
  async generateBackend(projectId: string, payload: { projectName: string; planSummary: any; schemaSql?: string }): Promise<Array<{ path: string; content: string }>> {
    const schemaCtx = payload.schemaSql ? `\n数据库 Schema:\n\`\`\`sql\n${payload.schemaSql}\n\`\`\`\n` : '';
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成 Express.js + Prisma 后端代码。${schemaCtx}
功能: ${JSON.stringify(payload.planSummary?.features || [])}
页面: ${JSON.stringify(payload.planSummary?.pages || [])}
角色: ${JSON.stringify(payload.planSummary?.roles || [])}

输出以下文件(每个用 \`\`\`文件路径 标记，路径必须以 backend/ 开头):
1. backend/package.json
2. backend/tsconfig.json
3. backend/src/main.ts
4. backend/src/app.module.ts
5. backend/prisma/schema.prisma
6. backend/src/modules/ — 每个功能一个模块目录，每个模块包含 controller + service + module 三文件

每个文件完整可运行。`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 32768, timeoutMs: 120_000 },
    );
    return this.parseFiles(response);
  }

  /** Step 3: 生成前端 */
  async generateFrontend(projectId: string, payload: { projectName: string; planSummary: any; demoHtml?: string; backendRoutes?: string[] }): Promise<Array<{ path: string; content: string }>> {
    const routesCtx = payload.backendRoutes?.length ? `\nAPI 端点:\n${payload.backendRoutes.join('\n')}\n` : '';
    const demoCtx = payload.demoHtml ? `\nDemo HTML 结构:\n${payload.demoHtml.substring(0, 2500)}\n` : '';
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成 Next.js 14 前端代码。${routesCtx}${demoCtx}
页面: ${JSON.stringify(payload.planSummary?.pages || [])}

输出以下文件(每个用 \`\`\`文件路径 标记，路径必须以 frontend/ 开头):
1. frontend/package.json
2. frontend/tsconfig.json
3. frontend/src/app/layout.tsx
4. frontend/src/app/page.tsx
5. frontend/src/app/ — 每个页面对应路由，使用正确目录结构（如 frontend/src/app/users/page.tsx）

每个文件完整可运行。`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 32768, timeoutMs: 120_000 },
    );
    return this.parseFiles(response);
  }

  /** Step 4: 生成集成配置 */
  async generateIntegration(projectId: string, payload: { projectName: string; planSummary: any; filePaths?: string[] }): Promise<Array<{ path: string; content: string }>> {
    const filesCtx = payload.filePaths?.length ? `\n已生成文件:\n${payload.filePaths.join('\n')}\n` : '';
    const prompt = `${FILE_PATH_REQUIREMENT}为项目"${payload.projectName}"生成部署配置文件。${filesCtx}
输出以下文件(每个用 \`\`\`文件路径 标记):
1. Dockerfile — 多阶段构建
2. docker-compose.yml — 前端+后端+数据库
3. nginx.conf — 反向代理
4. .gitignore
5. README.md — 含启动步骤`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 8192, timeoutMs: 90_000 },
    );
    return this.parseFiles(response);
  }

  /** 
   * 通用的文件解析器 — 智能推断文件路径。
   * 当 DeepSeek 返回语言名（如 typescript）而非路径时，分析内容推断真实路径。
   */
  private parseFiles(response: string): Array<{ path: string; content: string }> {
    const filePattern = /```(\S+)\s*\n([\s\S]*?)```/g;
    const files: Array<{ path: string; content: string }> = [];
    const generatedFiles = new Set<string>();
    let match;
    let unnamedIdx = 0;
    while ((match = filePattern.exec(response)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      if (filePath.length < 2 || filePath.length > 80) continue;
      
      // 已有正确路径（含 / 或 .）→ 直接使用
      if (filePath.includes('/') || filePath.includes('.')) {
        // 去重：同一路径可能因 token 边界重复
        const dedupKey = filePath;
        if (generatedFiles.has(dedupKey)) continue;
        generatedFiles.add(dedupKey);
        files.push({ path: filePath, content });
        continue;
      }
      
      // 语言名标记 → 内容分析推断路径
      const inferred = this.inferFilePath(filePath.toLowerCase(), content, unnamedIdx);
      const dedupKey = inferred;
      if (generatedFiles.has(dedupKey)) continue;
      generatedFiles.add(dedupKey);
      files.push({ path: inferred, content });
      unnamedIdx++;
    }
    return files;
  }

  /** 根据内容推断文件真实路径 */
  private inferFilePath(lang: string, content: string, idx: number): string {
    // ─── SQL → database/schema.sql ───
    if (lang === 'sql' || lang === 'pgsql' || lang === 'plsql') {
      if (content.match(/CREATE\s+(TABLE|TYPE|INDEX|SEQUENCE|TRIGGER)/i)) {
        return 'database/schema.sql';
      }
      return `database/migration_${idx + 1}.sql`;
    }

    // ─── JSON ───
    if (lang === 'json') {
      if (content.includes('"scripts"') && content.includes('"dependencies"')) {
        // package.json → 根据依赖判断前后端
        if (content.includes('next') || content.includes('react')) return 'frontend/package.json';
        if (content.includes('@nestjs') || content.includes('express') || content.includes('prisma')) return 'backend/package.json';
        // 看引用路径
        if (content.includes('frontend') || content.includes('.tsx')) return 'frontend/package.json';
        return 'backend/package.json';
      }
      if (content.includes('"compilerOptions"')) {
        if (content.includes('"jsx"')) return 'frontend/tsconfig.json';
        return 'backend/tsconfig.json';
      }
      return `config/json_${idx + 1}.json`;
    }

    // ─── TypeScript/JavaScript ───
    if (lang === 'typescript' || lang === 'ts' || lang === 'javascript' || lang === 'js') {
      // NestJS 模块文件
      if (content.includes('@Module') || content.includes('@Injectable') || content.includes('@Controller')) {
        const module = this.extractModuleName(content) || 'app';
        if (content.includes('@Controller')) {
          return `backend/src/modules/${module}/${module}.controller.ts`;
        }
        if (content.includes('@Injectable') && (content.includes('Service') || content.includes('Repository'))) {
          return `backend/src/modules/${module}/${module}.service.ts`;
        }
        if (content.includes('@Module')) {
          return `backend/src/modules/${module}/${module}.module.ts`;
        }
        return `backend/src/modules/${module}/${module}.ts`;
      }
      // Express 路由
      if (content.includes('express.Router') || content.match(/router\.(get|post|put|delete|patch)/)) {
        return `backend/src/routes/${this.extractRouteName(content) || `route_${idx + 1}`}.ts`;
      }
      // DTO
      if (content.includes('class-validator') || content.includes('IsString') || content.includes('IsNotEmpty')) {
        const dtoName = this.extractDtoName(content) || `dto_${idx + 1}`;
        return `backend/src/modules/${dtoName}/dto/${dtoName}.dto.ts`;
      }
      // Prisma schema
      if (content.includes('datasource db') || content.includes('generator client')) {
        return 'backend/prisma/schema.prisma';
      }
      // Prisma service
      if (content.includes('PrismaClient') || content.includes('this.prisma')) {
        return 'backend/src/prisma/prisma.service.ts';
      }
      // main 入口
      if (content.includes('NestFactory') || content.includes('bootstrap')) {
        return 'backend/src/main.ts';
      }
      if (content.includes('app.listen') || content.includes('express()')) {
        return 'backend/src/index.ts';
      }
      // app module
      if (content.includes('AppModule') && content.includes('imports:')) {
        return 'backend/src/app.module.ts';
      }
      // 泛型后端文件
      if (content.includes('import') && !content.includes('React') && !content.includes('useState')) {
        const name = this.extractClassName(content) || `module_${idx + 1}`;
        return `backend/src/${name.toLowerCase()}.ts`;
      }
      // 默认 → 后端
      return `backend/src/file_${idx + 1}.ts`;
    }

    // ─── JSX / React ───
    if (lang === 'jsx' || lang === 'tsx') {
      // 页面/路由文件
      if (content.includes('export default function') || content.includes('export default async function')) {
        const pagePath = this.extractPageRoute(content) || `page_${idx + 1}`;
        return `frontend/src/app/${pagePath}/page.tsx`;
      }
      // 组件
      if (content.includes('export') && (content.includes('function') || content.includes('const'))) {
        const compName = this.extractComponentName(content) || `Component${idx + 1}`;
        return `frontend/src/components/${compName}.tsx`;
      }
      // layout
      if (content.includes('children') && content.includes('html')) {
        return 'frontend/src/app/layout.tsx';
      }
      return `frontend/src/app/page_${idx + 1}.tsx`;
    }

    // ─── CSS / Style ───
    if (lang === 'css' || lang === 'scss') {
      if (content.includes('.module')) {
        return `frontend/src/app/globals.css`;
      }
      return `frontend/src/styles/style_${idx + 1}.css`;
    }

    // ─── HTML ───
    if (lang === 'html') {
      if (content.includes('<html') || content.includes('<!DOCTYPE')) {
        return 'frontend/public/index.html';
      }
      return `frontend/src/app/page_${idx + 1}.html`;
    }

    // ─── YAML / Docker ───
    if (lang === 'yaml' || lang === 'yml') {
      if (content.includes('services:') && content.includes('build:')) return 'docker-compose.yml';
      if (content.includes('stages:') || content.includes('script:')) return '.gitlab-ci.yml';
      return `config/config_${idx + 1}.yml`;
    }

    // ─── Dockerfile ───
    if (lang === 'dockerfile' || lang === 'docker') {
      return 'Dockerfile';
    }

    // ─── nginx config ───
    if (lang === 'nginx') {
      return 'nginx.conf';
    }

    // ─── bash / shell ───
    if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      if (content.includes('npm run') || content.includes('docker')) return 'scripts/deploy.sh';
      if (content.includes('migration') || content.includes('prisma')) return 'scripts/migrate.sh';
      return `scripts/script_${idx + 1}.sh`;
    }

    // ─── Markdown ───
    if (lang === 'markdown' || lang === 'md') {
      if (content.includes('# ') && content.includes('## ')) return 'README.md';
      return `docs/doc_${idx + 1}.md`;
    }

    // ─── ENV ───
    if (lang === 'env' || lang === 'dotenv') {
      return '.env.example';
    }

    // ─── Prisma schema ───
    if (lang === 'prisma') {
      return 'backend/prisma/schema.prisma';
    }

    // 兜底
    const extMap: Record<string, string> = {
      'python': '.py', 'rust': '.rs', 'go': '.go', 'java': '.java',
      'xml': '.xml', 'graphql': '.graphql', 'toml': '.toml',
    };
    const ext = extMap[lang] || '.txt';
    return `generated/file_${idx + 1}${ext}`;
  }

  private extractModuleName(content: string): string | null {
    const m = content.match(/export\s+class\s+(\w+)(Controller|Service|Module|Repository)/);
    if (m) return m[1].replace(/(Controller|Service|Module|Repository)$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return null;
  }

  private extractClassName(content: string): string | null {
    const m = content.match(/(?:export\s+)?(?:class|interface|type)\s+(\w+)/);
    return m ? m[1] : null;
  }

  private extractComponentName(content: string): string | null {
    const m = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)/);
    if (m) return m[1];
    const arrow = content.match(/(?:export\s+)?(?:default\s+)?const\s+(\w+)\s*=/);
    return arrow ? arrow[1] : null;
  }

  private extractPageRoute(content: string): string | null {
    // 从函数名推断路由：UserPage → user
    const m = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)Page/);
    if (m) return m[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    const m2 = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)/);
    if (m2 && m2[1] !== 'Home') return m2[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return null;
  }

  private extractRouteName(content: string): string | null {
    const m = content.match(/router\.(?:get|post|put|delete|patch)\s*\(\s*['"`]\/?(?:api\/)?(\w+)/);
    return m ? m[1] : null;
  }

  private extractDtoName(content: string): string | null {
    const m = content.match(/export\s+class\s+(\w+)Dto/);
    if (m) return m[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return null;
  }
}
