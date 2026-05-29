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

    const url = `${this.baseUrl}/webhook/${workflowName}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
        },
        body: JSON.stringify({ ...payload, requestId }),
      });

      if (!response.ok) {
        this.logger.warn(`[${requestId}] n8n workflow returned ${response.status}`);
        return { success: false };
      }

      const result = await response.json().catch(() => ({}));
      this.logger.log(`[${requestId}] Workflow triggered: ${workflowName}`);
      return { success: true, runId: result.runId || requestId };
    } catch (error) {
      this.logger.error(`[${requestId}] Failed to trigger workflow ${workflowName}: ${(error as Error).message}`);
      return { success: false };
    }
  }

  async triggerTaskPlanningWorkflow(projectId: string, feedbackId: string, taskIds: string[]) {
    return this.triggerWorkflow('task-planning', { projectId, feedbackId, taskIds });
  }

  async triggerDeliveryExportWorkflow(projectId: string, deliveryType: string) {
    return this.triggerWorkflow('delivery-export', { projectId, deliveryType });
  }
}
