import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET 未配置。请在 .env 中设置 JWT_SECRET 环境变量。');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; role?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    // 当前活跃租户：取最早的 membership（2-1b 为每个老用户建了 personal org）；多 org 切换属后续
    const orgId = user.memberships[0]?.orgId ?? null;
    return { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role, orgId };
  }
}
