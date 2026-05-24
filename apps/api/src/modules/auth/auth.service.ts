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
    if (existing) {
      throw new ConflictException('该邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, name, hashedPassword },
    });

    return { token: this.generateToken(user.id), user: { id: user.id, email: user.email, name: user.name } };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('邮箱或密码不正确');
    }

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) {
      throw new UnauthorizedException('邮箱或密码不正确');
    }

    return { token: this.generateToken(user.id), user: { id: user.id, email: user.email, name: user.name } };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, plan: true, createdAt: true },
    });
    return user;
  }

  private generateToken(userId: string): string {
    return this.jwtService.sign({ sub: userId });
  }
}
