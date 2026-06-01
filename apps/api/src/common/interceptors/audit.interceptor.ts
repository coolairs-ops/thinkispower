import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, user } = req;

    // Only audit mutating requests with authenticated users
    if (!user || method === 'GET') return next.handle();

    const stage = 'user_action';
    const actionTaken = `${method} ${url}`;
    const projectId = req.params?.projectId || null;

    return next.handle().pipe(
      tap(async () => {
        try {
          await this.prisma.decisionLog.create({
            data: {
              stage,
              actionTaken,
              projectId,
              inputContext: { method, url, userId: user.id, email: user.email },
              decisionResult: { success: true },
            },
          });
        } catch {}
      }),
    );
  }
}
