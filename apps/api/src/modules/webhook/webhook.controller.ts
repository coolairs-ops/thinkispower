import { Controller, Post, Req, Body, Headers, Logger } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PipelineService } from '../../integrations/pipeline/pipeline.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private pipeline: PipelineService) {}

  @Public()
  @Post('github')
  async githubPush(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
  ) {
    this.logger.log(`GitHub webhook: event=${event}, ref=${payload?.ref}`);

    if (event === 'push' && payload?.ref === 'refs/heads/main') {
      // Extract project info from commit message or repo name
      const repoName = payload?.repository?.name;
      this.logger.log(`Push to main in ${repoName}, triggering auto-deploy`);
      return { status: 'received', action: 'auto_deploy_queued' };
    }

    return { status: 'ignored', reason: `event=${event}, not a main push` };
  }
}
