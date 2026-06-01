import { Controller, Get, Post, Param, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlanGuard, RequiredPlan } from '../../common/guards/plan.guard';
import { Public } from '../../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { DeliveryIterationService } from './delivery-iteration.service';

@Controller('api/projects/:projectId/delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(
    private deliveryService: DeliveryService,
    private evaluationService: DeliveryEvaluationService,
    private iterationService: DeliveryIterationService,
  ) {}

  // ── 交付页面数据 ──
  @Get()
  async getDelivery(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.getDelivery(req.user.id, projectId);
  }

  // ── 唯一交付入口：全栈代码生成 ──
  @UseGuards(PlanGuard)
  @RequiredPlan('enterprise')
  @Post('deliver')
  async deliver(@Req() req: any, @Param('projectId') projectId: string, @Body() body: any) {
    return this.evaluationService.productionDeliver(req.user.id, projectId, body);
  }

  // ── 交付进度 SSE ──
  @Public()
  @Get('progress/:deliveryId')
  async deliveryProgress(@Param('deliveryId') deliveryId: string, @Req() req: any, @Res() res: any) {
    const ccUrl = 'http://cc-bridge:5001';
    const ccRes = await fetch(`${ccUrl}/deliver/progress/${deliveryId}`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const reader = (ccRes as any).body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  }

  // ── 评估 ──
  @Post('evaluate')
  async requestEvaluation(@Req() req: any, @Param('projectId') projectId: string) {
    return this.evaluationService.requestEvaluation(req.user.id, projectId);
  }

  @Post('re-evaluate')
  async reEvaluate(@Req() req: any, @Param('projectId') projectId: string) {
    return this.evaluationService.reEvaluate(req.user.id, projectId);
  }

  @Post('re-evaluate-status')
  async reEvaluateStatus(@Req() req: any, @Param('projectId') projectId: string) {
    return this.evaluationService.getReEvaluateStatus(req.user.id, projectId);
  }

  @Post('accept-risk-fix')
  async acceptRiskFix(@Req() req: any, @Param('projectId') projectId: string, @Body('riskIndex') riskIndex: number, @Body('customFix') customFix?: string) {
    return this.evaluationService.acceptRiskFix(req.user.id, projectId, riskIndex, customFix);
  }

  @Post('accept-suggestion')
  async acceptSuggestion(@Req() req: any, @Param('projectId') projectId: string, @Body('suggestionId') suggestionId: string) {
    return this.evaluationService.acceptSuggestion(req.user.id, projectId, suggestionId);
  }

  // ── 自迭代 ──
  @UseGuards(PlanGuard)
  @RequiredPlan('pro')
  @Get('auto-iterate/status')
  async getAutoIterateStatus(@Param('projectId') projectId: string) {
    return this.iterationService.getAutoIterateStatus(projectId);
  }

  @UseGuards(PlanGuard)
  @RequiredPlan('pro')
  @Post('auto-iterate/start')
  async startAutoIterate(@Req() req: any, @Param('projectId') projectId: string) {
    const result = await this.iterationService.startAutoIterate(projectId);
    return { ...result, status: 'started' };
  }

  @Post('auto-iterate/stop')
  async stopAutoIterate(@Req() req: any, @Param('projectId') projectId: string) {
    return this.iterationService.stopAutoIterate(projectId);
  }

  @Public()
  @Get('auto-iterate/stream/:taskId')
  async autoIterateStream(@Req() req: any, @Param('projectId') projectId: string, @Param('taskId') taskId: string, @Res() res: any, @Query('token') token?: string) {
    if (token) { try { const jwtService = (req as any).jwtService; if (jwtService) req.user = jwtService.verify(token); } catch {} }
    const observable = this.iterationService.subscribeAutoIterate(taskId);
    if (!observable) { res.status(404).json({ message: 'task not found' }); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sub = observable.subscribe({
      next: (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`),
      error: () => { res.write('data: {"type":"error"}\n\n'); res.end(); },
      complete: () => { res.write('data: {"type":"complete"}\n\n'); res.end(); },
    });
    req.on('close', () => sub.unsubscribe());
  }

  @Post('auto-iterate/decide')
  async decideAutoIterate(@Req() req: any, @Param('projectId') projectId: string, @Body('decision') decision: string) {
    return this.iterationService.decideAutoIterate(projectId, decision as any);
  }

  @Get('auto-optimize-stream')
  async autoOptimizeStream(@Req() req: any, @Param('projectId') projectId: string, @Res() res: any) {
    const taskId = await this.iterationService.startAutoOptimize(projectId);
    const sub = this.iterationService.subscribeOptimize(taskId);
    if (!sub) { res.status(404).json({ message: 'task not found' }); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sub2 = sub.subscribe({
      next: (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`),
      error: () => res.end(),
      complete: () => { res.write('data: [DONE]\n\n'); res.end(); },
    });
    req.on('close', () => sub2.unsubscribe());
  }
}
