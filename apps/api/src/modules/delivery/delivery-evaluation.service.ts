import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { QualityGateService } from '../../services/quality-gate.service';
import { DeepseekService } from '../../services/deepseek.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { DeploymentService } from '../deployment/deployment.service';
import { DeliveryService } from './delivery.service';

@Injectable()
export class DeliveryEvaluationService {
  private readonly logger = new Logger(DeliveryEvaluationService.name);

  constructor(
    private prisma: PrismaService,
    private hermes: HermesClient,
    private qualityGate: QualityGateService,
    private deepseek: DeepseekService,
    private cloudecodeClient: CloudecodeClient,
    private deploymentService: DeploymentService,
  ) {}

  /** 请求评估 — 只分析不交付，返回风险+修复建议 */
  async requestEvaluation(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, demoHtml: true, planSummary: true, description: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    let analysis: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        analysis = await this.hermes.analyzeSilent(projectId, project.demoHtml || '', project.planSummary, project.description);
        if (analysis?.risks?.length > 0) break;
      } catch { }
    }

    if (!analysis) {
      analysis = {
        completeness: 0,
        risks: [{ severity: 'high', description: '评估服务暂时不可用，请稍后点击「重新评估」重试', fixTitle: '重试', fixDescription: '', fixContent: '' }],
        recommendations: [],
        suggestions: [],
        tasks: [],
      };
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: { deliveryAnalysis: analysis } as any },
    });

    const quality = await this.qualityGate.runAllChecks(projectId, project.demoHtml || '');

    return { analysis, quality };
  }

  /** 终稿生产交付 — 异步执行 */
  async productionDeliver(userId: string, projectId: string, payload: {
    projectName?: string; planSummary?: any; demoHtml?: string;
  }) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, demoHtml: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    if (!project.demoHtml) throw new BadRequestException('请先生成 Demo 预览');

    const deliveryId = `${projectId.substring(0, 8)}-${Date.now()}`;
    this.logger.log(`[生产交付] 异步启动: ${deliveryId}`);

    this.runProductionDelivery(deliveryId, projectId, {
      projectName: payload.projectName || 'app',
      planSummary: payload.planSummary,
      demoHtml: project.demoHtml,
    }).catch(e => this.logger.error(`生产交付异常: ${e}`));

    return { success: true, deliveryId, message: '生产交付已启动' };
  }

  private async runProductionDelivery(deliveryId: string, projectId: string, payload: any) {
    try {
      const result = await this.cloudecodeClient.deliverFullstack(projectId, {
        projectName: payload.projectName || 'app',
        planSummary: payload.planSummary,
        demoHtml: payload.demoHtml,
      });
      this.logger.log(`全栈生成完成: ${result.files?.length || 0} 个文件`);

      const injectedFiles = await this.injectEnterprisePack(result.files || []);
      this.logger.log(`企业模板注入: ${injectedFiles.length} 个文件`);

      // 保存生成的文件
      const fs = require('fs');
      const path = require('path');
      const outputDir = path.join(process.cwd(), '.hermes', 'deliveries', deliveryId);
      fs.mkdirSync(outputDir, { recursive: true });

      for (const file of injectedFiles) {
        const fp = path.join(outputDir, file.path);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, file.content, 'utf-8');
      }

      // 写入文件清单
      const manifest = injectedFiles.map(f => f.path).join('\n');
      fs.writeFileSync(path.join(outputDir, 'files.txt'), manifest, 'utf-8');
      this.logger.log(`交付文件保存: ${injectedFiles.length} → ${outputDir}`);

      // 创建 Build 记录
      const latestBuild = await this.prisma.build.findFirst({
        where: { projectId }, orderBy: { version: 'desc' }, select: { version: true },
      });
      const build = await this.prisma.build.create({
        data: {
          projectId,
          version: (latestBuild?.version || 0) + 1,
          status: 'success',
          sourceZipUrl: `/api/deploy/${projectId}/delivery/${deliveryId}`,
        },
      });

      let productionUrl = '';
      try {
        const dr = await this.deploymentService.deploy(projectId);
        productionUrl = dr.productionUrl;
      } catch (e) {
        this.logger.warn(`部署失败: ${e}`);
      }

      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'completed',
          productionUrl: productionUrl || `http://localhost:3001/api/deploy/${projectId}`,
          latestBuildId: build.id,
        },
      });

      this.logger.log(`交付完成: ${injectedFiles.length} 文件 → ${outputDir}`);
    } catch (e) {
      this.logger.error(`全栈生成失败: ${e}`);
    }
  }

  /** 加入修复队列 */
  async acceptRiskFix(userId: string, projectId: string, riskIndex: number, customFix?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, structuredRequirement: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const analysis = (project.structuredRequirement as any)?.deliveryAnalysis;
    const risks = analysis?.risks || [];
    const risk = risks[riskIndex];
    if (!risk) throw new NotFoundException('风险项不存在');

    const fixContent = customFix || risk.fixContent || risk.description;
    const sr = (project.structuredRequirement as any) || {};
    const queue = sr.fixQueue || [];
    queue.push({ riskIndex, fixContent, fixTitle: risk.fixTitle });
    sr.fixQueue = queue;
    sr.deliveryAnalysis = analysis;

    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: sr as any },
    });

    return { success: true, queued: queue.length, message: `已加入修复队列(${queue.length}项)` };
  }

  /** 异步批量执行修复 + 重新评估 */
  async reEvaluate(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, structuredRequirement: true, demoHtml: true, planSummary: true, description: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const sr = (project.structuredRequirement as any) || {};
    const queue = sr.fixQueue || [];
    const taskId = `${projectId.substring(0, 8)}-re-${Date.now()}`;
    this.runReEvaluate(taskId, projectId, sr, queue, project.demoHtml ?? '', project.planSummary, project.description).catch(e =>
      this.logger.error(`re Evaluate failed: ${e}`));

    return { success: true, taskId, queuedCount: queue.length, message: `已启动 ${queue.length} 项修复，完成后请重新评估` };
  }

  /** 查询修复状态 */
  async getReEvaluateStatus(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { structuredRequirement: true },
    });
    const sr = (project?.structuredRequirement as any) || {};
    const lastResult = sr.lastReEvaluate;
    const queue = sr.fixQueue || [];
    const analysis = sr.deliveryAnalysis;
    return {
      done: !!(lastResult?.completedAt),
      queuedCount: queue.length,
      fixResults: lastResult?.results || [],
      completeness: analysis?.completeness ?? 0,
      riskCount: analysis?.risks?.length ?? 0,
    };
  }

  private async runReEvaluate(taskId: string, projectId: string, sr: any, queue: any[], demoHtml: string, planSummary: any, description: string | null) {
    const results: string[] = [];

    if (queue.length > 0) {
      this.logger.log(`异步批量执行 ${queue.length} 项修复: ${projectId}`);
      const fixesText = queue.map((item, i) =>
        `${i + 1}. ${item.fixTitle}\n   ${item.fixContent}`
      ).join('\n\n');

      let succeeded = false;
      for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
        if (attempt > 0) {
          this.logger.warn(`批量修复重试 ${attempt + 1}/3`);
          await new Promise(r => setTimeout(r, 3000));
        }
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: projectId }, select: { demoHtml: true },
          });
          const currentHtml = project?.demoHtml ?? '';

          const prompt = `修改以下HTML：\n\n${fixesText}\n\n输出完整HTML，不要省略。\n\n原始HTML：\n${currentHtml.slice(0, 25000)}`;
          const response = await this.deepseek.chat(
            [{ role: 'user', content: prompt }],
            { temperature: 0.3, maxTokens: 16384 },
          );

          const m = response.match(/```html\s*([\s\S]*?)```/) || response.match(/<!DOCTYPE[\s\S]*?<\/html>/i);
          const newHtml = m ? (m[1] || m[0]).replace(/```html\s*/, '').replace(/```$/, '').trim() : '';

          if (newHtml && newHtml.includes('<!DOCTYPE')) {
            await this.prisma.project.update({
              where: { id: projectId }, data: { demoHtml: newHtml, status: 'demo_ready' },
            });
            results.push(`✅ 已完成 ${queue.length} 项修复`);
            succeeded = true;
          }
        } catch (e) {
          this.logger.warn(`批量修复失败 (attempt ${attempt + 1}): ${e}`);
        }
      }

      if (!succeeded) {
        results.push(`❌ 修复失败(重试3次)，请稍后重试`);
        return;
      }

      sr.fixQueue = [];
    }

    // 重新评估
    const latestProject = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true },
    });
    const latestDemoHtml = latestProject?.demoHtml ?? demoHtml;

    const analysis = await this.hermes.analyzeSilent(projectId, latestDemoHtml, planSummary, description);
    const quality = await this.qualityGate.runAllChecks(projectId, latestDemoHtml);

    sr.deliveryAnalysis = analysis;
    sr.lastReEvaluate = { taskId, results, completedAt: new Date().toISOString() };
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: sr as any },
    });

    this.logger.log(`re Evaluate完成: ${analysis.completeness}%, ${results.length} 项修复`);
  }

  /** 导入 AI 建议 */
  async acceptSuggestion(userId: string, projectId: string, suggestionId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, structuredRequirement: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const analysis = (project.structuredRequirement as any)?.deliveryAnalysis;
    const suggestions = analysis?.suggestions || [];
    const suggestion = suggestions.find((s: any) => s.id === suggestionId);
    if (!suggestion) throw new NotFoundException('建议不存在');

    const feedback = await this.prisma.feedbackItem.create({
      data: {
        projectId,
        comment: `[AI建议] ${suggestion.title}: ${suggestion.content}`,
        moduleKey: suggestion.moduleKey || null,
        status: 'new',
      },
    });

    this.hermes.handleFeedback(feedback.id).then(taskIds => {
      this.logger.log(`[导入] 建议 ${suggestionId} → ${taskIds.length} 个任务创建`);
    }).catch(err => {
      this.logger.error(`[导入] 建议 ${suggestionId} 处理失败: ${err.message}`);
    });

    return { success: true, feedbackId: feedback.id, message: `已导入"${suggestion.title}"，正在生成修改方案` };
  }

  /** 注入企业级模板到交付产物 */
  async injectEnterprisePack(files: Array<{ path: string; content: string }>): Promise<Array<{ path: string; content: string }>> {
    const securityContent = `import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

export const setupSecurity = (app: any) => {
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
  app.use('/api/', rateLimit({ windowMs: 1000, max: 100, standardHeaders: true, legacyHeaders: false }));
};`;

    const observabilityContent = `export const healthCheck = (req: any, res: any) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
};

const fmt = (level: string, msg: string, meta?: any) =>
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message: msg, trace_id: (global as any).traceId || '-', ...meta }));
export const logger = { info: (m: string, d?: any) => fmt('info', m, d), warn: (m: string, d?: any) => fmt('warn', m, d), error: (m: string, d?: any) => fmt('error', m, d) };

export const traceMiddleware = (req: any, res: any, next: any) => {
  (global as any).traceId = req.headers['x-trace-id'] || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9);
  res.setHeader('X-Trace-Id', (global as any).traceId);
  next();
};

export const gracefulShutdown = (server: any) => {
  ['SIGTERM','SIGINT'].forEach(s => process.on(s, () => { logger.info('收到'+s); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10000); }));
};`;

    const nginxContent = `server {
  listen 80;
  gzip on; gzip_types text/plain text/css application/json application/javascript text/xml;
  location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://backend:3000; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
  location /nginx-health { access_log off; return 200 "ok"; }
}`;

    const dockerfileProd = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app
COPY package*.json ./
RUN npm ci --production && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
EXPOSE 3000
CMD ["node", "dist/index.js"]`;

    const templates: Array<{ path: string; content: string }> = [
      { path: 'backend/src/middleware/security.ts', content: securityContent },
      { path: 'backend/src/middleware/observability.ts', content: observabilityContent },
    ];

    templates.push({ path: 'Dockerfile.prod', content: dockerfileProd });
    templates.push({ path: 'nginx.conf', content: nginxContent });

    for (const t of templates) {
      const exists = files.some(f => f.path === t.path);
      if (!exists) {
        files.push(t);
      }
    }

    const dockerfile = files.find(f => f.path.includes('Dockerfile') && !f.path.includes('.prod'));
    if (dockerfile && !dockerfile.content.includes('HEALTHCHECK')) {
      dockerfile.content += '\nHEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1\n';
    }

    return files;
  }
}
