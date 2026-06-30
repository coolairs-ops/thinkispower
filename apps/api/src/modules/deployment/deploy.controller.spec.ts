import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DeployController } from './deploy.controller';
import { DeploymentService } from './deployment.service';
import { PrismaService } from '../../database/prisma.service';
import { DeliveryPackageCheckService } from '../delivery/delivery-package-check.service';

/** 链式 res mock：status().json()、setHeader、cookie、set().send() */
function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.set = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.headersSent = false;
  return res;
}

describe('DeployController — 安全边界', () => {
  let controller: DeployController;
  let jwt: { verify: jest.Mock; sign: jest.Mock };
  let prisma: { project: { findUnique: jest.Mock } };
  let deployment: { getDeployedHtml: jest.Mock };
  let packageCheck: { attachReportToDeliveryDir: jest.Mock };
  let configValue: Record<string, string | undefined>;

  beforeEach(async () => {
    jwt = { verify: jest.fn(), sign: jest.fn().mockReturnValue('signed-token') };
    prisma = { project: { findUnique: jest.fn() } };
    deployment = { getDeployedHtml: jest.fn() };
    packageCheck = { attachReportToDeliveryDir: jest.fn().mockResolvedValue({}) };
    configValue = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeployController],
      providers: [
        { provide: DeploymentService, useValue: deployment },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: (k: string) => configValue[k] } },
        { provide: DeliveryPackageCheckService, useValue: packageCheck },
      ],
    }).compile();

    controller = module.get(DeployController);
  });

  describe('downloadDelivery', () => {
    it('非法 deliveryId(含路径穿越/注入字符) → 400，且不验签', async () => {
      const res = mockRes();
      await controller.downloadDelivery('p1', '../../etc; rm -rf', {} as any, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('token 无效 → 401', async () => {
      jwt.verify.mockImplementation(() => { throw new Error('invalid'); });
      const res = mockRes();
      await controller.downloadDelivery('p1', 'abcd1234-1700000000000', { query: { token: 'bad' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('非项目所有者 → 403', async () => {
      jwt.verify.mockReturnValue({ sub: 'attacker' });
      prisma.project.findUnique.mockResolvedValue({ userId: 'owner' });
      const res = mockRes();
      await controller.downloadDelivery('p1', 'abcd1234-1700000000000', { query: { token: 't' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('项目不存在 → 404', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1' });
      prisma.project.findUnique.mockResolvedValue(null);
      const res = mockRes();
      await controller.downloadDelivery('p1', 'abcd1234-1700000000000', { query: { token: 't' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('previewAuth', () => {
    it('未配置密码 → 401（不放行）', async () => {
      const res = mockRes();
      await controller.previewAuth('p1', 'anything', res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('密码错误 → 401', async () => {
      configValue.DEPLOY_PREVIEW_PASSWORD = 'secret';
      const res = mockRes();
      await controller.previewAuth('p1', 'wrong', res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('密码正确 → 签发 httpOnly cookie + success', async () => {
      configValue.DEPLOY_PREVIEW_PASSWORD = 'secret';
      const res = mockRes();
      await controller.previewAuth('p1', 'secret', res);
      expect(jwt.sign).toHaveBeenCalledWith({ preview: 'p1' }, { expiresIn: '1d' });
      expect(res.cookie).toHaveBeenCalledWith('deploy_token', 'signed-token', expect.objectContaining({ httpOnly: true }));
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('serveDeploy', () => {
    it('未配置密码 → 直接服务部署内容(无登录门)', async () => {
      deployment.getDeployedHtml.mockResolvedValue('<html>app</html>');
      const res = mockRes();
      await controller.serveDeploy('p1', { headers: {} } as any, res);
      expect(deployment.getDeployedHtml).toHaveBeenCalledWith('p1');
      expect(res.send).toHaveBeenCalledWith('<html>app</html>');
    });

    it('配置了密码但 cookie 缺失 → 返回登录页(不泄露内容)', async () => {
      configValue.DEPLOY_PREVIEW_PASSWORD = 'secret';
      const res = mockRes();
      await controller.serveDeploy('p1', { headers: {} } as any, res);
      expect(deployment.getDeployedHtml).not.toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('应用登录'));
    });

    it('配置了密码且 cookie 签名有效且绑定本项目 → 放行', async () => {
      configValue.DEPLOY_PREVIEW_PASSWORD = 'secret';
      jwt.verify.mockReturnValue({ preview: 'p1' });
      deployment.getDeployedHtml.mockResolvedValue('<html>app</html>');
      const res = mockRes();
      await controller.serveDeploy('p1', { headers: { cookie: 'deploy_token=valid' } } as any, res);
      expect(res.send).toHaveBeenCalledWith('<html>app</html>');
    });

    it('cookie 绑定的是其他项目 → 拒绝(返回登录页)', async () => {
      configValue.DEPLOY_PREVIEW_PASSWORD = 'secret';
      jwt.verify.mockReturnValue({ preview: 'other-project' });
      const res = mockRes();
      await controller.serveDeploy('p1', { headers: { cookie: 'deploy_token=valid' } } as any, res);
      expect(deployment.getDeployedHtml).not.toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('应用登录'));
    });
  });
});
