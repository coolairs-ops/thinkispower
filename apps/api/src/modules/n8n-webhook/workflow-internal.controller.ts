import { Controller, Post, Body, Logger } from '@nestjs/common';
import { DemoService } from '../demo/demo.service';

/**
 * N8N 工作流回调的内部端点。
 * 不对外暴露，仅 N8N webhook → API 内部调用。
 */
@Controller('internal/workflows')
export class WorkflowInternalController {
  private readonly logger = new Logger(WorkflowInternalController.name);

  // NOTE: 需要 Auth 模块提供一个 system 级别的 token 或直接绕过鉴权。
  // 临时方案：此端点无鉴权，由 N8N 在内部网络调用。
  constructor(private demoService: DemoService) {}

  @Post('demo-generate')
  async handleDemoGenerate(@Body('projectId') projectId: string) {
    this.logger.log(`[N8N→API] Demo generate triggered for project ${projectId}`);
    if (!projectId) return { error: 'projectId required' };

    // 调用 DemoService 重新生成（绕过鉴权，使用 system 身份）
    await this.demoService.generateDemoInternal(projectId);
    return { success: true, status: 'generating' };
  }
}
