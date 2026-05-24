import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '平台遇到了一点问题，正在自动恢复。';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message || message;
      // Keep validation errors structure but sanitize
      if (Array.isArray(message)) {
        message = message.join('；');
      }
    }

    // Log full error internally
    this.logger.error(
      `${request.method} ${request.url} - ${status}`,
      exception instanceof Error ? exception.stack : '',
    );

    response.status(status).json({
      success: false,
      message: this.toUserFriendlyMessage(message, status),
    });
  }

  private toUserFriendlyMessage(message: string, status: number): string {
    if (status === 401) return '请先登录';
    if (status === 403) return '你没有权限执行此操作';
    if (status === 404) return '请求的资源不存在';
    if (status === 429) return '操作太频繁，请稍后再试';
    if (status >= 500) return '平台遇到了一点问题，正在自动恢复。';
    return message;
  }
}
