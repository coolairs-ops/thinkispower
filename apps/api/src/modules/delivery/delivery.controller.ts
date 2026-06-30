import { BadRequestException, Controller, Get, Post, Param, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlanGuard, RequiredPlan } from '../../common/guards/plan.guard';
import { Public } from '../../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { DeliveryIterationService } from './delivery-iteration.service';
import { AcceptanceVerificationService, ScenarioStatus } from './acceptance-verification.service';
import { DeliveryCheckMode, DeliveryPackageCheckService } from './delivery-package-check.service';
import { UnresolvedRequirementsService } from './unresolved-requirements.service';

@Controller('api/projects/:projectId/delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(
    private deliveryService: DeliveryService,
    private evaluationService: DeliveryEvaluationService,
    private iterationService: DeliveryIterationService,
    private acceptanceService: AcceptanceVerificationService,
    private packageCheckService: DeliveryPackageCheckService,
    private unresolvedRequirementsService: UnresolvedRequirementsService,
  ) {}

  // ── 验收报告（P15-Y 可验收/可追溯）──
  @Get('acceptance-report')
  async getAcceptanceReport(@Req() req: any, @Param('projectId') projectId: string) {
    return this.acceptanceService.getReport(req.user.id, req.user.orgId ?? null, projectId);
  }

  @Post('acceptance-verify')
  async runAcceptanceVerify(@Req() req: any, @Param('projectId') projectId: string) {
    return this.acceptanceService.verify(req.user.id, req.user.orgId ?? null, projectId);
  }

  @Post('acceptance-manual-confirm')
  async manualConfirmScenario(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body('scenarioName') scenarioName: string,
    @Body('status') status: ScenarioStatus,
    @Body('note') note?: string,
  ) {
    return this.acceptanceService.manualConfirm(req.user.id, req.user.orgId ?? null, projectId, scenarioName, status, note);
  }

  @Post('package-check')
  async runPackageCheck(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body('mode') mode: DeliveryCheckMode = 'package',
  ) {
    if (mode !== 'inspect' && mode !== 'package') {
      throw new BadRequestException('mode 只能是 inspect 或 package');
    }
    return this.packageCheckService.runForUser(req.user.id, req.user.orgId ?? null, projectId, { mode });
  }

  @Get('unresolved-requirements')
  async getUnresolvedRequirements(@Req() req: any, @Param('projectId') projectId: string) {
    return this.unresolvedRequirementsService.getForUser(req.user.id, req.user.orgId ?? null, projectId);
  }

  // ── 交付页面数据 ──
  @Get()
  async getDelivery(@Req() req: any, @Param('projectId') projectId: string) {
    return this.deliveryService.getDelivery(req.user.id, req.user.orgId ?? null, projectId);
  }

  // ── 唯一交付入口：全栈代码生成 ──
  @UseGuards(PlanGuard)
  @RequiredPlan('enterprise')
  @Post('deliver')
  async deliver(@Req() req: any, @Param('projectId') projectId: string, @Body() body: any) {
    return this.evaluationService.productionDeliver(req.user.id, req.user.orgId ?? null, projectId, body);
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
    return this.evaluationService.requestEvaluation(req.user.id, req.user.orgId ?? null, projectId);
  }

  @Post('re-evaluate')
  async reEvaluate(@Req() req: any, @Param('projectId') projectId: string) {
    return this.evaluationService.reEvaluate(req.user.id, req.user.orgId ?? null, projectId);
  }

  @Post('re-evaluate-status')
  async reEvaluateStatus(@Req() req: any, @Param('projectId') projectId: string) {
    return this.evaluationService.getReEvaluateStatus(req.user.id, req.user.orgId ?? null, projectId);
  }

  @Post('accept-risk-fix')
  async acceptRiskFix(@Req() req: any, @Param('projectId') projectId: string, @Body('riskIndex') riskIndex: number, @Body('customFix') customFix?: string) {
    return this.evaluationService.acceptRiskFix(req.user.id, req.user.orgId ?? null, projectId, riskIndex, customFix);
  }

  @Post('accept-suggestion')
  async acceptSuggestion(@Req() req: any, @Param('projectId') projectId: string, @Body('suggestionId') suggestionId: string) {
    return this.evaluationService.acceptSuggestion(req.user.id, req.user.orgId ?? null, projectId, suggestionId);
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
