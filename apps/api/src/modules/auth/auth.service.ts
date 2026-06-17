import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(email: string, name: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('该邮箱已被注册');

    const hashedPassword = await bcrypt.hash(password, 10);
    // 注册即建 personal organization + owner membership（与 2-1b 回填命名一致），保证新用户有租户上下文
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, name, hashedPassword } });
      const org = await tx.organization.create({
        data: { name: `${name || email} 的空间`, slug: `user-${u.id}`, plan: 'free' },
      });
      await tx.membership.create({ data: { userId: u.id, orgId: org.id, role: 'owner' } });
      return u;
    });

    const { accessToken, refreshToken } = await this.generateTokens(user.id, user.role);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    return { accessToken, refreshToken, user: { id: user.id, email, name, role: user.role } };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('邮箱或密码不正确');

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) throw new UnauthorizedException('邮箱或密码不正确');

    const { accessToken, refreshToken } = await this.generateTokens(user.id, user.role);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    return { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token 缺失');

    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET });
    } catch {
      throw new UnauthorizedException('Refresh token 无效或已过期');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.refreshToken !== refreshToken) {
      throw new UnauthorizedException('Refresh token 已失效');
    }

    const tokens = await this.generateTokens(user.id, user.role);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken } });

    return tokens;
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true },
    });
  }

  /** 生成 access(15min) + refresh(7d) token对 */
  private async generateTokens(userId: string, role: string) {
    const payload = { sub: userId, role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      { secret: refreshSecret, expiresIn: '7d' },
    );
    return { accessToken, refreshToken };
  }
}
