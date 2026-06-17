import { Controller, Get, Post, Param, Res, Req, Body, UseGuards, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { DeploymentService } from './deployment.service';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/** 交付 ID 形如 `<projectId8>-<timestamp>`，只允许字母数字与 - _，阻断路径穿越/命令注入 */
const DELIVERY_ID_RE = /^[A-Za-z0-9_-]+$/;

/** 部署预览登录页：纯服务端校验，前端只负责提交密码（无硬编码凭据） */
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>登录 - Think-is-power</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.card{background:#fff;padding:32px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);width:360px}
h2{text-align:center;margin-bottom:20px;color:#333}
input{width:100%;padding:10px;margin:8px 0;border:1px solid #d9d9d9;border-radius:4px;font-size:14px}
button{width:100%;padding:10px;background:#1890ff;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer;margin-top:8px}
button:hover{background:#40a9ff}
.error{color:#ff4d4f;font-size:12px;text-align:center;margin-top:8px;display:none}
</style></head>
<body>
<div class="card">
<h2>应用登录</h2>
<form onsubmit="return login(event)">
<input type="password" id="pwd" placeholder="访问密码" required autofocus>
<button type="submit">进入</button>
<p class="error" id="err">访问密码不正确</p>
</form>
</div>
<script>
async function login(e){e.preventDefault();
const r=await fetch(location.pathname+'/preview-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pwd').value})});
if(r.ok){location.reload()}else{document.getElementById('err').style.display='block'}
return false}
</script>
</body></html>`;

@Controller('api/deploy')
export class DeployController {
  private readonly logger = new Logger(DeployController.name);

  constructor(
    private deploymentService: DeploymentService,
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  /**
   * 下载交付源码包 — 必须放在 :projectId 路由前，避免被 :projectId 吞掉路径。
   * 浏览器链接无法带 Authorization 头，故用短期签名链接：?token=<访问令牌>，
   * 服务端验签 + 校验项目归属；deliveryId 严格白名单，archiver 流式打包(无 shell)。
   */
  @Public()
  @Get(':projectId/delivery/:deliveryId')
  async downloadDelivery(
    @Param('projectId') projectId: string,
    @Param('deliveryId') deliveryId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!DELIVERY_ID_RE.test(deliveryId)) {
      return res.status(400).json({ message: '非法的交付标识' });
    }

    const token = (req.query.token as string) || '';
    let userId: string;
    try {
      userId = this.jwtService.verify(token).sub;
    } catch {
      return res.status(401).json({ message: '下载链接无效或已过期，请重新进入交付页获取' });
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) return res.status(404).json({ message: '项目不存在' });
    if (project.userId !== userId) return res.status(403).json({ message: '无权下载该交付' });

    const baseDir = path.join(process.cwd(), '.hermes', 'deliveries');
    const deliveryDir = path.join(baseDir, deliveryId);
    // 纵深防御：解析后的目录必须仍在 deliveries 根内
    if (deliveryDir !== path.join(baseDir, deliveryId) || !deliveryDir.startsWith(baseDir + path.sep)) {
      return res.status(400).json({ message: '非法的交付标识' });
    }
    if (!fs.existsSync(deliveryDir)) {
      return res.status(404).json({ message: '交付文件不存在' });
    }

    // deliveryId 已过 DELIVERY_ID_RE 白名单（无 shell 元字符/路径分隔符），tar 拼接无注入面
    const zipPath = path.join(baseDir, `${deliveryId}.tar.gz`);
    try {
      execSync(`tar -czf ${zipPath} -C ${baseDir} ${deliveryId}`, { timeout: 30000 });
    } catch (err) {
      this.logger.error(`打包失败 ${deliveryId}: ${err}`);
      return res.status(500).json({ message: '打包失败' });
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="delivery-${deliveryId.slice(0, 8)}.tar.gz"`);
    const stream = fs.createReadStream(zipPath);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(zipPath); } catch {}
    });
  }

  /** 部署预览登录：校验访问密码(env)，签发短期 httpOnly cookie */
  @Public()
  @Post(':projectId/preview-auth')
  async previewAuth(
    @Param('projectId') projectId: string,
    @Body('password') password: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('DEPLOY_PREVIEW_PASSWORD');
    if (!expected || password !== expected) {
      return res.status(401).json({ message: '访问密码不正确' });
    }
    const token = this.jwtService.sign({ preview: projectId }, { expiresIn: '1d' });
    res.cookie('deploy_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 86400_000 });
    return res.json({ success: true });
  }

  @Public()
  @Get(':projectId')
  async serveDeploy(@Param('projectId') projectId: string, @Req() req: Request, @Res() res: Response) {
    // 未配置访问密码 → 视为公开预览，直接服务（不再有硬编码默认账号兜底）
    const requirePassword = !!this.config.get<string>('DEPLOY_PREVIEW_PASSWORD');
    if (requirePassword && !this.hasValidPreviewToken(req, projectId)) {
      return res.set('Content-Type', 'text/html; charset=utf-8').send(LOGIN_HTML);
    }

    try {
      const html = await this.deploymentService.getDeployedHtml(projectId);
      if (!html) {
        return res.status(404).json({ message: '该应用尚未部署', statusCode: 404 });
      }
      res.set('Content-Type', 'text/html; charset=utf-8').send(html);
    } catch {
      return res.status(404).json({ message: '该应用尚未部署', statusCode: 404 });
    }
  }

  /** 校验服务端签名的预览 cookie（不可伪造，绑定 projectId） */
  private hasValidPreviewToken(req: Request, projectId: string): boolean {
    const cookieHeader = req.headers.cookie || '';
    const entry = cookieHeader.split(';').find((c) => c.trim().startsWith('deploy_token='));
    const token = entry ? entry.split('=').slice(1).join('=').trim() : '';
    if (!token) return false;
    try {
      return this.jwtService.verify(token).preview === projectId;
    } catch {
      return false;
    }
  }

  /** 预留部署启动端点 — 接收部署目标，返回访问 URL */
  @UseGuards(JwtAuthGuard)
  @Post(':projectId/launch')
  async launchDeploy(
    @Param('projectId') projectId: string,
    @Body() body: { target?: string; host?: string; port?: number },
  ) {
    const result = await this.deploymentService.deploy(projectId);
    return { success: true, productionUrl: result.productionUrl, deploymentId: result.deploymentId };
  }
}
