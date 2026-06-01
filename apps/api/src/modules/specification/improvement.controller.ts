import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DecisionEngineService } from '../../services/decision-engine.service';

@Controller('api/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class ImprovementController {
  constructor(private decisionEngine: DecisionEngineService) {}

  @Get('improvement-suggestions')
  async getSuggestions(@Req() req: any, @Param('projectId') projectId: string) {
    const { PrismaService } = require('../../database/prisma.service');
    // Use the prisma from decision engine to get project data
    const project = await (this.decisionEngine as any).prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, description: true, planSummary: true, structuredRequirement: true },
    });
    if (!project) return [];

    const plan = project.planSummary as any || {};
    const breakdown = {
      hasDescription: !!(project.description && project.description.length > 2),
      hasPlan: !!plan && Object.keys(plan).length > 0,
      hasFeatures: !!(plan?.features?.length > 0),
      hasPages: !!(plan?.pages?.length > 0),
      hasPrd: !!((project.structuredRequirement as any)?.prd),
      hasSpec: false,
    };

    // Check all OK
    if (breakdown.hasDescription && breakdown.hasPrd && breakdown.hasFeatures && breakdown.hasPages) {
      return { suggestions: [], complete: true };
    }

    const suggestions = await this.decisionEngine.generateImprovementSuggestions(
      projectId, breakdown as any, project.name, project.description || ''
    );

    return {
      suggestions,
      complete: false,
      missing: Object.entries(breakdown)
        .filter(([k, v]) => !v && k !== 'hasPlan' && k !== 'hasSpec')
        .map(([k]) => k.replace('has', '')),
    };
  }
}
