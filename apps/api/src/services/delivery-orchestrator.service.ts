import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database/prisma.service';
import { BuildService } from './build.service';
import { StatusMapperService } from './status-mapper.service';
import { DeepseekService } from './deepseek.service';
import { CloudecodeClient } from '../integrations/cloudecode/cloudecode.client';
import { HermesClient } from '../integrations/hermes/hermes.client';
import { MinioService } from '../integrations/minio/minio.service';
import { DeploymentService } from '../modules/deployment/deployment.service';
import { createZipBuffer } from '../common/utils/zip';
import {
  EVENTS,
  DeliveryExportRequestedPayload,
  DeliveryExportCompletedPayload,
  DeliveryExportFailedPayload,
  ExportType,
} from '../events/event-types';

/**
 * 执行器接口 — 每个执行器都是一个"被控对象"的驱动。
 * 可替换、可测试，为未来的自适应控制律提供基础。
 */
export interface ICodeGenerator {
  generate(buildId: string, projectId: string): Promise<{ success: boolean; artifactUrl?: string }>;
}

export interface IPackageExporter {
  export(buildId: string, projectId: string): Promise<{ success: boolean; artifactUrl?: string }>;
}

export interface IN8nWorkflowDriver {
  run(projectId: string, exportType: string): Promise<{ success: boolean; runId?: string }>;
}

/**
 * 交付导出编排器 — 工程控制论的"控制器"环节。
 *
 * 监听 DELIVERY_EXPORT_REQUESTED 事件，按 exportType 路由到对应执行器，
 * 每个执行器完成后通过反馈回路（事件）上报状态。
 *
 * ── 工程控制论映射 ──
 * 控制器（Controller）    → DeliveryOrchestrator.handleExportRequest()
 * 被控对象（Plant）       → 三个执行器（CodeGen / PackageExport / N8nWorkflow）
 * 反馈信道（Feedback）    → DELIVERY_EXPORT_COMPLETED / DELIVERY_EXPORT_FAILED 事件
 * 状态观测器（Observer）  → Build 状态 + project.status
 */
@Injectable()
export class DeliveryOrchestrator {
  private readonly logger = new Logger(DeliveryOrchestrator.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private prisma: PrismaService,
    private buildService: BuildService,
    private statusMapper: StatusMapperService,
    private deepseek: DeepseekService,
    private cloudecode: CloudecodeClient,
    private hermes: HermesClient,
    private minio: MinioService,
    private deploymentService: DeploymentService,
  ) {}

  @OnEvent(EVENTS.DELIVERY_EXPORT_REQUESTED)
  async handleExportRequest(payload: DeliveryExportRequestedPayload): Promise<void> {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`[控制器] 交付导出请求: ${exportType} 项目 ${projectId} 构建 ${buildId}`);

    try {
      // 1. 更新 Build 状态为 building
      await this.buildService.updateBuildStatus(buildId, 'building');

      let artifactUrl: string | undefined;

      // 2. 异步导出类型 — 本地生成资产（原 N8N 异步路径已弃用）
      if (exportType === 'repository' || exportType === 'database') {
        artifactUrl = await this.handleN8nWorkflow(payload);
        // 本地生成完成，流入完成逻辑
      } else {
        // 3. 同步导出类型 — 等待执行结果
        switch (exportType) {
        case 'source':
        case 'deployment':
          artifactUrl = await this.handleCodeGeneration(payload);
          break;

        case 'package':
          artifactUrl = await this.handlePackageExport(payload);
          break;

        default:
          throw new Error(`Unknown export type: ${exportType}`);
        }
      }

      // 4. 更新 Build artifact
      if (artifactUrl) {
        await this.buildService.updateBuildArtifact(buildId, exportType, artifactUrl);
      }

      // 5. 更新 Build 状态 + 项目状态
      await this.buildService.updateBuildStatus(buildId, 'success');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'demo_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
        },
      });

      // 5.5 自动部署到在线访问
      try {
        const deployResult = await this.deploymentService.deploy(projectId, buildId);
        this.logger.log(`[部署] 项目 ${projectId} 已上线: ${deployResult.productionUrl}`);
      } catch (deployErr) {
        this.logger.warn(`[部署] 项目 ${projectId} 部署失败(不阻断交付): ${deployErr}`);
      }

      // 6. 发出完成事件 — 正向通道完成
      const completedPayload: DeliveryExportCompletedPayload = { projectId, buildId, exportType, artifactUrl };
      this.eventEmitter.emit(EVENTS.DELIVERY_EXPORT_COMPLETED, completedPayload);
      this.logger.log(`[反馈] 交付导出完成: ${exportType} project=${projectId}`);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[异常] 交付导出失败 ${exportType} (build ${buildId}): ${msg}`);

      // 误差修正：更新为失败状态
      await this.buildService.updateBuildStatus(buildId, 'failed');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'build_failed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('build_failed'),
        },
      });

      const failedPayload: DeliveryExportFailedPayload = { projectId, buildId, exportType, error: msg };
      this.eventEmitter.emit(EVENTS.DELIVERY_EXPORT_FAILED, failedPayload);
    }
  }

  // ═══════════ 执行机构 1：真实项目代码生成（不再是仅优化 HTML）═══════════
  /**
   * 使用 CloudecodeClient.generateProject() 生成完整项目结构：
   * index.html + package.json + Dockerfile + nginx.conf + README + .gitignore + 测试
   * 打包为 zip 上传到 MinIO。
   */
  private async handleCodeGeneration(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`[执行机构] 源码生成: ${exportType} 项目 ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, planSummary: true, name: true, structuredRequirement: true },
    });

    if (!project?.demoHtml) {
      this.logger.warn(`[执行机构] 项目 ${projectId} 无 Demo HTML，跳过代码生成`);
      return undefined;
    }

    // 1. 生成全栈项目（前端 + 后端 API + 数据库 + 部署配置）
    const files = await this.generateFullstackProject(project);

    // 2. 打包为 zip
    const zipBuffer = await createZipBuffer(project.name || 'project', files);

    // 3. 上传到 MinIO
    const url = await this.buildService.uploadArtifact(
      buildId, projectId, exportType,
      zipBuffer, `${project.name || 'project'}-source.zip`,
      'application/zip',
    );

    this.logger.log(`[执行机构] 源码生成完成: ${url || '无 MinIO'} (${zipBuffer.length} bytes, ${files.length} files)`);
    return url;
  }

  // ═══════════ 执行机构 2：项目包导出（完整项目 zip，而非仅 HTML）═══════════
  private async handlePackageExport(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, buildId } = payload;
    this.logger.log(`[执行机构] 项目包导出: 项目 ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, name: true, planSummary: true, structuredRequirement: true },
    });

    if (!project?.demoHtml) {
      this.logger.warn(`[执行机构] 项目 ${projectId} 无 Demo HTML，跳过打包`);
      return undefined;
    }

    // 生成全栈项目代码（前端 + 后端 + 数据库 + 部署配置）
    const files = await this.generateFullstackProject(project);

    // 打包为 zip
    const zipBuffer = await createZipBuffer(project.name || 'project', files);
    const url = await this.buildService.uploadArtifact(
      buildId, projectId, 'package',
      zipBuffer, `${project.name || 'project'}-package.zip`,
      'application/zip',
    );

    this.logger.log(`[执行机构] 项目包导出完成: ${url || '无 MinIO'} (${zipBuffer.length} bytes)`);
    return url;
  }

  // ═══════════ 执行机构 3：N8N 工作流（异步 + 反馈闭环）═══════════
  /**
   * 异步导出类型 — 本地生成资产（N8N 已弃用，直接使用本地引擎）。
   *
   * 注意：此方法不在此处标记 Build 完成，由 caller handleExportRequest 统一处理。
   */
  private async handleN8nWorkflow(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, exportType, buildId } = payload;
    this.logger.log(`[执行机构] 本地资产生成: ${exportType} 项目 ${projectId}`);

    // 本地生成资产（原 N8N 降级路径，现在作为主路径）
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, demoHtml: true, planSummary: true, structuredRequirement: true },
    });
    if (!project) throw new Error(`Project ${projectId} not found`);

    const assetTaskType = exportType === 'database' ? 'export_database_schema' : `export_${exportType}`;
    const asset = await this.cloudecode.generateAsset(assetTaskType, {
      planSummary: project.planSummary as string | null,
      structuredRequirement: project.structuredRequirement,
      demoHtml: project.demoHtml,
    });

    const buffer = Buffer.from(asset.content, 'utf-8');
    const url = await this.buildService.uploadArtifact(
      buildId, projectId, exportType,
      buffer, asset.fileName, asset.contentType,
    );

    this.logger.log(`[降级] 本地 ${exportType} 资产生成完成: ${url}`);
    return url;
  }

  // ═══════════ 全栈项目补充生成（在 generateProject 基础上扩展）═══════════
  private async generateFullstackProject(
    project: { name?: string | null; demoHtml?: string | null; planSummary?: any; structuredRequirement?: any },
  ): Promise<Array<{ path: string; content: string }>> {
    const files = await this.cloudecode.generateProject({
      name: project.name || undefined,
      demoHtml: project.demoHtml,
      planSummary: project.planSummary,
      structuredRequirement: project.structuredRequirement,
    });

    const safeName = this.safeProjectName(project.name || 'my-app');

    // 后端 Express API
    files.push(...this.genBackendFiles(safeName));

    // 数据库 Schema
    files.push({ path: 'database/schema.sql', content: this.genDatabaseSchema() });

    // 模板化基础设施（变量替换硬编码值）
    this.upsertFile(files, 'docker-compose.yml', this.genDockerCompose());
    this.upsertFile(files, 'nginx.conf', this.genNginxConfig());
    this.upsertFile(files, 'README.md', this.genReadme(safeName));
    this.upsertFile(files, '.gitignore', this.genGitignore());

    return files;
  }

  private upsertFile(files: Array<{ path: string; content: string }>, path: string, content: string) {
    const i = files.findIndex(f => f.path === path);
    if (i >= 0) files[i] = { path, content };
    else files.push({ path, content });
  }

  private safeProjectName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'my-app';
  }

  private genBackendFiles(projectName: string): Array<{ path: string; content: string }> {
    return [
      {
        path: 'backend/package.json',
        content: JSON.stringify({
          name: `${projectName}-api`,
          version: '1.0.0',
          private: true,
          scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js' },
          dependencies: { express: '^4.18.2', cors: '^2.8.5', pg: '^8.12.0' },
        }, null, 2),
      },
      {
        path: 'backend/src/index.js',
        content: [
          "const express = require('express');",
          "const cors = require('cors');",
          '',
          'const app = express();',
          'const PORT = process.env.PORT || 4000;',
          '',
          'app.use(cors());',
          'app.use(express.json());',
          "app.use('/api', require('./routes/api'));",
          '',
          "app.get('/health', (_req, res) => {",
          "  res.json({ status: 'ok', timestamp: new Date().toISOString() });",
          '});',
          '',
          'app.listen(PORT, () => {',
          '  console.log(`Backend API running on port ${PORT}`);',
          '});',
          '',
        ].join('\n'),
      },
      {
        path: 'backend/src/routes/api.js',
        content: [
          "const express = require('express');",
          "const { Pool } = require('pg');",
          'const router = express.Router();',
          '',
          'const pool = new Pool({',
          "  host: process.env.DB_HOST || 'postgres',",
          '  port: parseInt(process.env.DB_PORT || \'5432\'),',
          "  database: process.env.DB_NAME || 'app',",
          "  user: process.env.DB_USER || 'app',",
          "  password: process.env.DB_PASSWORD || 'change-me',",
          '});',
          '',
          "router.get('/ping', (_req, res) => {",
          "  res.json({ message: 'pong' });",
          '});',
          '',
          "router.get('/data', async (_req, res) => {",
          '  try {',
          "    const r = await pool.query('SELECT NOW() AS time');",
          '    res.json({ success: true, data: r.rows });',
          '  } catch (err) {',
          '    res.status(500).json({ success: false, error: err.message });',
          '  }',
          '});',
          '',
          'module.exports = router;',
        ].join('\n'),
      },
    ];
  }

  private genDatabaseSchema(): string {
    return [
      '-- PostgreSQL Schema',
      '-- Generated by Think-is-power',
      '',
      'CREATE EXTENSION IF NOT EXISTS "pgcrypto";',
      '',
      'CREATE TABLE IF NOT EXISTS users (',
      '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  email VARCHAR(255) UNIQUE NOT NULL,',
      '  name VARCHAR(255) NOT NULL DEFAULT \'\',',
      '  role VARCHAR(50) NOT NULL DEFAULT \'user\',',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
      '',
      'CREATE INDEX idx_users_email ON users(email);',
      '',
    ].join('\n');
  }

  private genDockerCompose(): string {
    return [
      "version: '3.8'",
      '',
      'services:',
      '  frontend:',
      '    build:',
      '      context: .',
      '      dockerfile: Dockerfile',
      '    ports:',
      '      - "${FRONTEND_PORT:-8080}:80"',
      '    depends_on:',
      '      - backend',
      '    restart: unless-stopped',
      '',
      '  backend:',
      '    build:',
      '      context: backend',
      '      dockerfile: Dockerfile',
      '    ports:',
      '      - "${BACKEND_PORT:-4000}:4000"',
      '    environment:',
      '      PORT: "4000"',
      '      DB_HOST: postgres',
      '      DB_PORT: "5432"',
      '      DB_NAME: "${DB_NAME:-app}"',
      '      DB_USER: "${DB_USER:-app}"',
      '      DB_PASSWORD: "${DB_PASSWORD:-change-me}"',
      '    depends_on:',
      '      postgres:',
      '        condition: service_healthy',
      '    restart: unless-stopped',
      '',
      '  postgres:',
      '    image: postgres:16-alpine',
      '    environment:',
      '      POSTGRES_DB: "${DB_NAME:-app}"',
      '      POSTGRES_USER: "${DB_USER:-app}"',
      '      POSTGRES_PASSWORD: "${DB_PASSWORD:-change-me}"',
      '    volumes:',
      '      - pgdata:/var/lib/postgresql/data',
      '      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql',
      '    ports:',
      '      - "${DB_PORT:-5432}:5432"',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U app"]',
      '      interval: 5s',
      '      timeout: 5s',
      '      retries: 5',
      '    restart: unless-stopped',
      '',
      'volumes:',
      '  pgdata:',
    ].join('\n');
  }

  private genNginxConfig(): string {
    return [
      'server {',
      '    listen 80;',
      '    server_name localhost;',
      '    root /usr/share/nginx/html;',
      '    index index.html;',
      '',
      '    # SPA fallback',
      '    location / {',
      '        try_files $uri $uri/ /index.html;',
      '    }',
      '',
      '    # API reverse proxy',
      '    location /api/ {',
      '        proxy_pass http://backend:4000/;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Upgrade $http_upgrade;',
      '        proxy_set_header Connection "upgrade";',
      '        proxy_set_header Host $host;',
      '        proxy_cache_bypass $http_upgrade;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '    }',
      '',
      '    # Cache static assets',
      "    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {",
      '        expires 30d;',
      '        add_header Cache-Control "public, immutable";',
      '    }',
      '}',
    ].join('\n');
  }

  private genReadme(projectName: string): string {
    return [
      `# ${projectName}`,
      '',
      '由 Think-is-power 平台全栈生成。',
      '',
      '## 项目结构',
      '',
      '- `index.html` — 前端页面（SPA）',
      '- `backend/` — Express API 后端',
      '- `database/` — 数据库 Schema',
      '- `docker-compose.yml` — Docker 编排（支持环境变量覆盖）',
      '- `nginx.conf` — Nginx 反向代理（前端 + API 代理）',
      '- `Dockerfile` — 前端容器镜像',
      '',
      '## 快速启动',
      '',
      '### Docker Compose（推荐）',
      '',
      '```bash',
      'docker compose up -d',
      '```',
      '',
      '访问 http://localhost:8080',
      '',
      '### 本地开发',
      '',
      '**后端：**',
      '```bash',
      'cd backend',
      'npm install',
      'npm run dev',
      '```',
      '',
      '**前端：**',
      '```bash',
      '# 使用 serve 启动',
      'npx serve . -p 3000 -s',
      '```',
      '',
      '## 环境变量',
      '',
      '| 变量 | 默认值 | 说明 |',
      '|------|--------|------|',
      '| FRONTEND_PORT | 8080 | 前端端口 |',
      '| BACKEND_PORT | 4000 | 后端端口 |',
      '| DB_NAME | app | 数据库名 |',
      '| DB_USER | app | 数据库用户 |',
      '| DB_PASSWORD | change-me | 数据库密码 |',
      '| DB_PORT | 5432 | 数据库端口 |',
    ].join('\n');
  }

  private genGitignore(): string {
    return [
      'node_modules/',
      'dist/',
      'build/',
      '.env',
      '.env.local',
      '*.log',
      '.DS_Store',
      '.idea/',
      '.vscode/',
      '*.swp',
      '*.swo',
      '__pycache__/',
      '*.pyc',
      '.coverage',
      'coverage/',
      '.tmp',
      '.temp',
    ].join('\n');
  }
}
