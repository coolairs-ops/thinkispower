import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { execSync, exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface DeployResult {
  status: 'deployed' | 'deploy_failed' | 'static_only';
  url?: string;
  port?: number;
  containerName?: string;
  error?: string;
  services?: string[];
}

export interface BuildResult {
  success: boolean;
  imageTag?: string;
  error?: string;
  output?: string;
}

const DOCKERFILE_NODE = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1`;

const DOCKERFILE_NGINX = `FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=2s --retries=3 CMD wget -qO- http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]`;

const NGINX_CONF = `server {
  listen 80;
  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml;
  location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ /index.html;
  }
  location /api/ {
    proxy_pass http://backend:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
  location /health {
    access_log off;
    return 200 "ok";
  }
}`;

@Injectable()
export class DeployPipelineService {
  private readonly logger = new Logger(DeployPipelineService.name);

  constructor(private prisma: PrismaService) {}

  /** 检查 Docker 守护进程是否可用 */
  private dockerAvailable(): boolean {
    try {
      execSync('docker info 2>/dev/null', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /** 构建 Docker 镜像（不部署） */
  async build(deliveryId: string, projectId: string): Promise<BuildResult> {
    const deliveryDir = join(process.cwd(), '.hermes', 'deliveries', deliveryId);
    if (!existsSync(deliveryDir)) {
      return { success: false, error: '交付目录不存在' };
    }

    if (!this.dockerAvailable()) {
      return { success: false, error: 'Docker daemon 不可用' };
    }

    const files = existsSync(join(deliveryDir, 'files.txt'))
      ? readFileSync(join(deliveryDir, 'files.txt'), 'utf-8').split('\n').filter(Boolean)
      : [];

    const hasBackendPkg = files.some(f => f.includes('backend/package.json'));
    const hasFrontend = files.some(f => f.includes('frontend/') && (f.includes('.html') || f.includes('.tsx')));
    const hasDockerCompose = existsSync(join(deliveryDir, 'docker-compose.yml'));

    // 生成缺失文件
    if (!existsSync(join(deliveryDir, 'Dockerfile')) && hasBackendPkg) {
      writeFileSync(join(deliveryDir, 'Dockerfile'), DOCKERFILE_NODE);
      this.logger.log('生成默认 Dockerfile (Node.js)');
    }

    const imageTag = `think-is-power-app-${projectId.substring(0, 8)}`.toLowerCase();

    try {
      this.logger.log(`Docker build: ${imageTag}...`);
      const output = execSync(`docker build -t ${imageTag} "${deliveryDir}" 2>&1`, {
        timeout: 600_000,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      const lastLine = output.trim().split('\n').pop() || '';
      this.logger.log(`✅ Build 成功: ${lastLine}`);
      return { success: true, imageTag, output: lastLine };
    } catch (e: any) {
      const errMsg = e.stderr?.toString() || e.stdout?.toString() || e.message || '';
      const shortErr = errMsg.split('\n').slice(-5).join('\n').substring(0, 300);
      this.logger.warn(`❌ Build 失败: ${shortErr}`);
      return { success: false, error: shortErr };
    }
  }

  /** 
   * 交付部署：docker build → docker run → health check → 返回 URL。
   * 支持多服务（docker-compose）和单服务两种模式。
   */
  async deploy(deliveryId: string, projectId: string): Promise<DeployResult> {
    const deliveryDir = join(process.cwd(), '.hermes', 'deliveries', deliveryId);

    if (!existsSync(deliveryDir)) {
      return { status: 'deploy_failed', error: '交付目录不存在' };
    }

    if (!this.dockerAvailable()) {
      this.logger.warn('Docker daemon 不可用，降级为静态模式');
      return { status: 'static_only', error: 'Docker 未运行，无法部署容器' };
    }

    // 优先使用单服务部署（更可靠），compose 作为备选
    const composeFile = join(deliveryDir, 'docker-compose.yml');
    const hasDockerfile = existsSync(join(deliveryDir, 'Dockerfile'));
    
    // 单服务模式: docker build → docker run (最可靠)
    if (hasDockerfile) {
      return this.deploySingleService(deliveryId, deliveryDir, projectId);
    }
    
    // docker-compose 模式: 仅在没有标准 Dockerfile 时使用
    if (existsSync(composeFile)) {
      return this.deployWithCompose(deliveryDir, projectId);
    }
    
    return { status: 'deploy_failed', error: '无可部署的 Dockerfile 或 docker-compose.yml' };
  }

  /** docker-compose 多服务部署 */
  private async deployWithCompose(deliveryDir: string, projectId: string): Promise<DeployResult> {
    const prefix = `app-${projectId.substring(0, 8)}`.toLowerCase();
    const composeFile = join(deliveryDir, 'docker-compose.yml');

    try {
      // 停止并删除旧容器
      execSync(`docker compose -f "${composeFile}" -p ${prefix} down --remove-orphans 2>/dev/null || true`, {
        timeout: 15_000, stdio: 'pipe',
      });

      // 构建并启动
      this.logger.log(`docker compose up: ${prefix}...`);
      execSync(`docker compose -f "${composeFile}" -p ${prefix} up -d --build 2>&1`, {
        timeout: 180_000,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      // 等待服务启动
      await new Promise(r => setTimeout(r, 8000));

      // 健康检查
      const services = this.extractPorts(composeFile);
      const healthy: string[] = [];
      const failed: string[] = [];

      for (const [name, port] of Object.entries(services)) {
        const ok = await this.checkHealth(port);
        if (ok) {
          healthy.push(`${name}:${port}`);
        } else {
          failed.push(`${name}:${port}`);
        }
      }

      if (healthy.length > 0) {
        const mainPort = services['app'] || services['frontend'] || Object.values(services)[0];
        const host = process.env.DEPLOY_HOST || 'localhost';
        const url = `http://${host}:${mainPort || ''}`;

        this.logger.log(`部署成功 (compose): ${url}, 服务: ${healthy.join(', ')}`);
        return {
          status: 'deployed',
          url,
          port: mainPort,
          containerName: prefix,
          services: healthy,
        };
      }

      return { status: 'deploy_failed', error: `所有服务健康检查失败: ${failed.join(', ')}` };
    } catch (e: any) {
      const errMsg = e.stderr?.toString() || e.message || '';
      this.logger.warn(`docker-compose 部署失败: ${errMsg.substring(0, 200)}`);
      return { status: 'deploy_failed', error: `Docker Compose 部署失败: ${errMsg.substring(0, 150)}` };
    }
  }

  /** 单容器部署 */
  private async deploySingleService(deliveryId: string, deliveryDir: string, projectId: string): Promise<DeployResult> {
    const imageTag = `think-is-power-app-${projectId.substring(0, 8)}`.toLowerCase();

    // Build
    const buildResult = await this.build(deliveryId, projectId);
    if (!buildResult.success) {
      return { status: 'static_only', error: buildResult.error };
    }

    // 找空闲端口
    const port = this.findFreePort();
    const containerName = `app-${projectId.substring(0, 8)}`.toLowerCase();

    try {
      execSync(`docker rm -f ${containerName} 2>/dev/null || true`);
      this.logger.log(`启动容器 ${containerName}:${port}...`);
      execSync(
        `docker run -d --name ${containerName} -p ${port}:3000 ${imageTag}`,
        { timeout: 15_000, stdio: 'pipe' },
      );
    } catch (e: any) {
      return { status: 'deploy_failed', error: '容器启动失败: ' + e.message?.substring(0, 100) };
    }

    // 重试健康检查
    const healthy = await this.retryHealthCheck(port, 10, 2000);
    if (!healthy) {
      return { status: 'deploy_failed', error: '健康检查超时', port, containerName };
    }

    const host = process.env.DEPLOY_HOST || 'localhost';
    const url = `http://${host}:${port}`;

    this.logger.log(`部署成功: ${url}`);
    return { status: 'deployed', url, port, containerName };
  }

  /** 查找空闲端口（30050-30150 范围） */
  private findFreePort(): number {
    for (let port = 30050; port <= 30150; port++) {
      try {
        execSync(`nc -z localhost ${port} 2>/dev/null`, { timeout: 1000, stdio: 'pipe' });
        // nc exit 0 = port in use → skip
      } catch {
        // nc exit 1 = connection refused = port free
        // Also try ss to double check
        try {
          const ssOut = execSync(`ss -tlnp 2>/dev/null | grep ":${port} " || true`, {
            timeout: 1000, stdio: 'pipe', encoding: 'utf-8',
          });
          if (!ssOut.trim()) return port;
        } catch {
          return port;
        }
      }
    }
    return 30050; // fallback
  }

  /** 重试健康检查 */
  private async retryHealthCheck(port: number, maxRetries: number, delayMs: number): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      const ok = await this.checkHealth(port);
      if (ok) {
        this.logger.log(`健康检查通过 (${i + 1}/${maxRetries} 次)`);
        return true;
      }
      if (i < maxRetries - 1) {
        this.logger.log(`健康检查 ${i + 1}/${maxRetries} 未通过，${delayMs}ms 后重试...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return false;
  }

  /** 单次健康检查 */
  private async checkHealth(port: number): Promise<boolean> {
    const urls = [`/health`, `/api/health`, `/`];
    for (const path of urls) {
      try {
        const resp = await fetch(`http://localhost:${port}${path}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) return true;
        // 即使 404 也算容器在运行
        if (resp.status >= 200 && resp.status < 500) return true;
      } catch {
        // 继续尝试下一个路径
      }
    }
    return false;
  }

  /** 从 docker-compose.yml 提取端口映射 */
  private extractPorts(composeFile: string): Record<string, number> {
    try {
      const content = readFileSync(composeFile, 'utf-8');
      const ports: Record<string, number> = {};
      const serviceRegex = /^  (\w+):\s*$/gm;
      const portRegex = /^\s*-\s*"?(\d+):(\d+)"?\s*$/gm;
      let currentService = '';
      
      for (const line of content.split('\n')) {
        const sMatch = line.match(/^  (\w+):\s*$/);
        if (sMatch && sMatch[1] !== 'services' && sMatch[1] !== 'version') {
          currentService = sMatch[1];
        }
        const pMatch = line.match(/^\s*-\s*"?(\d+):(\d+)"?\s*$/);
        if (pMatch && currentService) {
          ports[currentService] = parseInt(pMatch[1]);
        }
      }
      return ports;
    } catch {
      return {};
    }
  }
}
