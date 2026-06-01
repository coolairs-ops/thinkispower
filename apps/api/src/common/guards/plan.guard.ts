import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUIRED_PLAN_KEY = 'requiredPlan';
export const RequiredPlan = (plan: string) => SetMetadata(REQUIRED_PLAN_KEY, plan);

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  private readonly PLAN_LEVELS: Record<string, number> = { free: 0, pro: 1, enterprise: 2 };

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PLAN_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) return false;

    const userLevel = this.PLAN_LEVELS[user.plan] ?? 0;
    const requiredLevel = this.PLAN_LEVELS[required] ?? 0;
    return userLevel >= requiredLevel;
  }
}
