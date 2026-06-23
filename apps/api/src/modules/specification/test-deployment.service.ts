import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const execAsync = promisify(exec);
// api 容器内探测测试容器健康（其端口映射在宿主机）：默认 host.docker.internal；
// 生产 Linux Docker 需 docker run 配 --add-host=host.docker.internal:host-gateway，或改用同 docker 网络的容器名。
const HEALTHCHECK_HOST = process.env.TEST_DEPLOY_HEALTHCHECK_HOST || 'host.docker.internal';

@Injectable()
export class TestDeploymentService {
  private readonly logger = new Logger(TestDeploymentService.name);

  constructor(private prisma: PrismaService) {}

  /** 启动测试环境部署 */
  async deploy(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true, demoHtml: true, name: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);
    if (!project.demoHtml) throw new NotFoundException('请先生成 Demo 预览');

    // 检查是否已有活跃部署
    const active = await this.prisma.testDeployment.findFirst({
      where: { projectId, status: { in: ['preparing', 'building', 'deploying', 'ready'] } },
    });
    if (active) {
      return { alreadyDeployed: true, deploymentId: active.id, testUrl: active.testUrl, status: active.status };
    }

    const port = 10000 + Math.floor(Math.random() * 10000);
    const adminUser = 'admin';
    const adminPass = crypto.randomBytes(6).toString('hex');

    const deployment = await this.prisma.testDeployment.create({
      data: {
        projectId,
        status: 'preparing',
        port,
        adminUser,
        adminPass,
        currentStep: '准备构建',
        stepsLog: [{ step: 'init', status: 'done', message: '部署任务已创建', ts: new Date().toISOString() }],
      },
    });

    // 异步执行部署流水线（demoHtml 已在上面校验过非空）
    const safe = { id: project.id, name: project.name, demoHtml: project.demoHtml! };
    this.runDeployment(deployment.id, safe).catch(e =>
      this.logger.error(`部署失败: ${deployment.id} ${e}`));

    return {
      deploymentId: deployment.id,
      status: 'preparing',
      port,
      message: '测试环境部署已启动',
    };
  }

  /** 查询部署状态 */
  async getStatus(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const deployment = await this.prisma.testDeployment.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    if (!deployment) {
      return { exists: false, message: '暂无部署记录' };
    }

    return {
      exists: true,
      ...deployment,
      adminPass: undefined, // 不返回密码给前端（仅在首次创建时返回）
    };
  }

  /** 销毁测试环境 */
  async destroy(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const deployment = await this.prisma.testDeployment.findFirst({
      where: { projectId, status: { in: ['ready', 'failed'] } },
    });
    if (!deployment) return { success: false, message: '没有可销毁的部署' };

    // 尝试停止容器
    if (deployment.containerId) {
      try {
        await execAsync(`docker stop ${deployment.containerId} && docker rm ${deployment.containerId}`);
        this.logger.log(`容器已销毁: ${deployment.containerId}`);
      } catch {
        this.logger.warn(`容器可能已不存在: ${deployment.containerId}`);
      }
    }

    await this.prisma.testDeployment.update({
      where: { id: deployment.id },
      data: { status: 'destroyed', destroyedAt: new Date() },
    });

    return { success: true, message: '测试环境已销毁' };
  }

  /** 异步执行部署流水线 */
  private async runDeployment(deploymentId: string, project: { id: string; demoHtml: string; name: string }) {
    const logStep = async (step: string, status: string, message: string) => {
      const dep = await this.prisma.testDeployment.findUnique({ where: { id: deploymentId }, select: { stepsLog: true } });
      const log = (dep?.stepsLog as any[]) || [];
      log.push({ step, status, message, ts: new Date().toISOString() });
      await this.prisma.testDeployment.update({
        where: { id: deploymentId },
        data: { currentStep: message, stepsLog: log, progress: Math.min(log.length * 10, 90) },
      });
    };

    try {
      await this.prisma.testDeployment.update({
        where: { id: deploymentId },
        data: { status: 'building', startedAt: new Date() },
      });

      // Step 1: 构建 Docker 镜像
      await logStep('build', 'running', '正在构建 Docker 镜像...');
      const workDir = path.join(process.cwd(), '.hermes', 'test-deployments', deploymentId);
      fs.mkdirSync(workDir, { recursive: true });

      // 写入 Demo HTML
      fs.writeFileSync(path.join(workDir, 'index.html'), project.demoHtml);

      // 写入 nginx 配置
      const nginxConf = `server {
  listen 80;
  server_name localhost;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /health { return 200 '{"status":"ok"}'; add_header Content-Type application/json; }
}`;
      fs.writeFileSync(path.join(workDir, 'nginx.conf'), nginxConf);

      // 写入 Dockerfile
      const dockerfile = `FROM nginx:alpine
COPY index.html /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost/health || exit 1
EXPOSE 80`;
      fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);

      await logStep('build', 'done', '镜像文件已准备');

      // Step 2: 尝试 Docker 构建（如果 Docker 可用）
      await logStep('docker_build', 'running', '正在构建容器...');
      let containerId: string | null = null;
      try {
        const imageName = `think-is-power-test-${deploymentId.substring(0, 8)}`;
        await execAsync(`docker build -t ${imageName} ${workDir}`, { timeout: 120000 });

        await logStep('docker_build', 'done', '镜像构建完成');

        // Step 3: 启动容器
        await logStep('deploy', 'running', '正在启动测试环境...');
        const port = (await this.prisma.testDeployment.findUnique({ where: { id: deploymentId }, select: { port: true } }))?.port || 18080;
        const { stdout } = await execAsync(
          `docker run -d -p ${port}:80 --name test-${deploymentId.substring(0, 8)} ${imageName}`,
          { timeout: 30000 },
        );
        containerId = stdout.trim();

        await this.prisma.testDeployment.update({
          where: { id: deploymentId },
          data: { containerId },
        });

        await logStep('deploy', 'done', `容器已启动: ${containerId.substring(0, 12)}`);

        // Step 4: 健康检查
        await logStep('health', 'running', '正在健康检查...');
        let healthy = false;
        let lastHc = '';
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 2000));
          // 用 Node http（api 容器无 curl）访问 host.docker.internal（容器端口映射在宿主机，localhost 到不了）
          const code = await new Promise<number>((resolve) => {
            const req = http.get(`http://${HEALTHCHECK_HOST}:${port}/health`, (res) => { res.resume(); resolve(res.statusCode || 0); });
            req.on('error', () => resolve(0));
            req.setTimeout(4000, () => { req.destroy(); resolve(0); });
          });
          if (code === 200) { healthy = true; break; }
          lastHc = `code=${code}`;
        }
        if (!healthy) this.logger.warn(`健康检查失败 (port ${port}, host ${HEALTHCHECK_HOST}): ${lastHc}`);

        await this.prisma.testDeployment.update({
          where: { id: deploymentId },
          data: { healthStatus: healthy ? 'healthy' : 'unhealthy', lastHealthAt: new Date() },
        });

        if (healthy) {
          await logStep('health', 'done', '健康检查通过 ✅');

          const testUrl = `http://localhost:${port}`;
          await this.prisma.testDeployment.update({
            where: { id: deploymentId },
            data: {
              status: 'ready',
              testUrl,
              progress: 100,
              readyAt: new Date(),
            },
          });
          this.logger.log(`测试环境就绪: ${testUrl}`);
        } else {
          await logStep('health', 'failed', '健康检查未通过');
          await this.prisma.testDeployment.update({
            where: { id: deploymentId },
            data: { status: 'failed', errorMessage: '健康检查未通过' },
          });
        }
      } catch (dockerErr: any) {
        this.logger.warn(`Docker 不可用，跳过容器启动: ${dockerErr.message}`);
        await logStep('docker_build', 'failed', 'Docker 不可用（开发环境正常）');
        await logStep('deploy', 'skipped', '跳过容器部署（Docker 不可用）');

        // Docker 不可用时的降级：返回文件系统路径
        const testUrl = `file://${path.join(workDir, 'index.html')}`;
        await this.prisma.testDeployment.update({
          where: { id: deploymentId },
          data: {
            status: 'ready',
            testUrl,
            progress: 100,
            readyAt: new Date(),
            healthStatus: 'unknown',
          },
        });
      }
    } catch (e: any) {
      this.logger.error(`部署流水线失败: ${e.message}`);
      await this.prisma.testDeployment.update({
        where: { id: deploymentId },
        data: { status: 'failed', errorMessage: e.message },
      });
    }
  }
}
