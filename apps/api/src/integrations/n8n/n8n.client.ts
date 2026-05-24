import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class N8nClient {
  private readonly logger = new Logger(N8nClient.name);
  private baseUrl: string;
  private apiKey: string;

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get('N8N_URL', 'http://localhost:5678');
    this.apiKey = this.config.get('N8N_API_KEY', '');
  }

  async triggerWorkflow(workflowName: string, payload: Record<string, any>): Promise<{ success: boolean; runId?: string }> {
    const requestId = crypto.randomUUID();
    this.logger.log(`[${requestId}] Triggering n8n workflow: ${workflowName}`);

    try {
      // TODO: Implement actual n8n webhook call
      // const response = await fetch(`${this.baseUrl}/webhook/${workflowName}`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
      //   body: JSON.stringify({ ...payload, requestId }),
      // });
      this.logger.log(`[${requestId}] Workflow triggered: ${workflowName}`);
      return { success: true, runId: requestId };
    } catch (error) {
      this.logger.error(`[${requestId}] Failed to trigger workflow: ${workflowName}`, error);
      return { success: false };
    }
  }

  async triggerClarifyWorkflow(projectId: string) {
    return this.triggerWorkflow('clarify', { projectId });
  }

  async triggerPlanWorkflow(projectId: string) {
    return this.triggerWorkflow('plan', { projectId });
  }

  async triggerDemoWorkflow(projectId: string) {
    return this.triggerWorkflow('demo-generate', { projectId });
  }

  async triggerTaskPlanningWorkflow(projectId: string) {
    return this.triggerWorkflow('task-planning', { projectId });
  }

  async triggerFeedbackWorkflow(projectId: string, feedbackId: string) {
    return this.triggerWorkflow('feedback', { projectId, feedbackId });
  }

  async triggerDeployWorkflow(projectId: string) {
    return this.triggerWorkflow('deploy', { projectId });
  }

  async triggerDeliveryExportWorkflow(projectId: string, deliveryType: string) {
    return this.triggerWorkflow('delivery-export', { projectId, deliveryType });
  }

  async triggerCaseReviewWorkflow(projectId: string) {
    return this.triggerWorkflow('case-review', { projectId });
  }

  async triggerExperienceRecommendationWorkflow(projectId: string, stage: string) {
    return this.triggerWorkflow('experience-recommend', { projectId, stage });
  }
}
