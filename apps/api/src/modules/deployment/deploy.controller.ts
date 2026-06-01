import { Controller, Get, Post, Param, Res, Req, Body, NotFoundException, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DeploymentService } from './deployment.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

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
.hint{text-align:center;color:#999;font-size:11px;margin-top:12px}
</style></head>
<body>
<div class="card">
<h2>应用登录</h2>
<form onsubmit="return login(event)">
<input type="email" id="email" placeholder="邮箱" value="admin@123.com" required>
<input type="password" id="pwd" placeholder="密码" value="admin123" required>
<button type="submit">登录</button>
<p class="error" id="err">账号或密码错误</p>
</form>
<p class="hint">默认账号: admin@123.com / admin123</p>
</div>
<script>
function login(e){e.preventDefault();
if(document.getElementById('email').value==='admin@123.com'&&document.getElementById('pwd').value==='admin123')
{document.cookie='deploy_auth=1;path=/;max-age=86400';location.reload()}
else{document.getElementById('err').style.display='block'}}
</script>
</body></html>`;

@Controller('api/deploy')
export class DeployController {
  constructor(private deploymentService: DeploymentService) {}

  @Public()
  @Get(':projectId')
  async serveDeploy(@Param('projectId') projectId: string, @Req() req: Request, @Res() res: Response) {
    // 手动解析 cookie，无需 cookie-parser 依赖
    const cookieHeader = (req.headers.cookie || '');
    const auth = cookieHeader.split(';').find((c: string) => c.trim().startsWith('deploy_auth='));
    const authValue = auth ? auth.split('=')[1]?.trim() : '';
    if (authValue !== '1') {
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
