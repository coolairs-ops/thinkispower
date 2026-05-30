import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

/** 内部错误 → 用户友好文案映射 */
const ERROR_MAP: Record<number, string> = {
  400: '请求有误，请检查后重试',
  401: '请先登录',
  403: '没有权限执行此操作',
  404: '请求的内容不存在',
  409: '数据冲突，请刷新后重试',
  413: '上传内容过大',
  429: '操作太频繁，请稍后重试',
  500: '系统繁忙，请稍后重试',
  502: '服务暂时不可用',
  503: '服务维护中',
};

const KNOWN_CAUSES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /Authentication Fails|api key.*invalid/i, message: 'AI服务连接异常，请联系管理员' },
  { pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND/i, message: '服务暂时不可用，请稍后重试' },
  { pattern: /timeout|TIMEOUT/i, message: '处理超时，请简化需求后重试' },
  { pattern: /too many requests|rate limit/i, message: '请求太频繁，请稍后重试' },
  { pattern: /prisma|database|connection/i, message: '数据服务异常，请稍后重试' },
];

@Catch()
export class UserFriendlyExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(UserFriendlyExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // HttpException → 用预定义映射
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const defaultMsg = ERROR_MAP[status] || '操作失败，请重试';
      
      this.logger.warn(`HTTP ${status}: ${exception.message}`);
      
      return response.status(status).json({
        statusCode: status,
        message: defaultMsg,
      });
    }

    // 其他错误 → 尝试匹配已知模式
    const errorStr = String(exception?.message || exception || '');
    for (const cause of KNOWN_CAUSES) {
      if (cause.pattern.test(errorStr)) {
        this.logger.error(`Mapped error: ${errorStr.substring(0, 200)}`);
        return response.status(500).json({
          statusCode: 500,
          message: cause.message,
        });
      }
    }

    // 未知错误 → 通用提示，不暴露详情
    this.logger.error(`Unhandled error: ${errorStr.substring(0, 500)}`, exception?.stack?.substring(0, 500));
    return response.status(500).json({
      statusCode: 500,
      message: '系统繁忙，请稍后重试',
    });
  }
}
