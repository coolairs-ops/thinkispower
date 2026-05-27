import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { ProductDiscoveryService } from '../../services/product-discovery.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { HermesQualityService } from '../../services/hermes-quality.service';

@Injectable()
export class MessageService {
  // In-memory quality hints for each project (transient, lost on restart)
  private qualityHints = new Map<string, string[]>();

  constructor(
    private prisma: PrismaService,
    private discovery: ProductDiscoveryService,
    private hermes: HermesClient,
    private hermesQuality: HermesQualityService,
    private statusMapper: StatusMapperService,
  ) {}

  async getMessages(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const messages = await this.prisma.projectMessage.findMany({
      where: { projectId, role: { not: 'system_internal' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    return messages;
  }

  async sendMessage(userId: string, projectId: string, content: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // 1. Save user message
    await this.prisma.projectMessage.create({
      data: { projectId, role: 'user', content },
    });

    // 2. Update status to clarifying
    if (project.status !== 'clarifying') {
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'clarifying',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('clarifying'),
        },
      });
    }

    // 3. Get all messages for context
    const allMessages = await this.prisma.projectMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    // 4. Get quality hints from previous round's Hermes analysis
    const savedHints = this.qualityHints.get(projectId) || [];
    const hintsStr = savedHints.length > 0 ? savedHints.join('\n') : undefined;

    // 5. PM 多轮需求探索（注入 Hermes 质量门禁 hint）
    const result = await this.discovery.processMessages(
      allMessages.map(m => ({ role: m.role, content: m.content })),
      hintsStr,
    );

    // 6. Clear used hints (injected into PM's context for this round)
    this.qualityHints.delete(projectId);

    if (result.needMoreInfo && result.question) {
      // 7a. 还在探索 — 保存 AI 追问
      const assistantContent = result.summary
        ? `${result.summary}\n\n${result.question}`
        : result.question;

      await this.prisma.projectMessage.create({
        data: { projectId, role: 'assistant', content: assistantContent },
      });

      // 7b. Hermes 静默质量门禁 — 分析本轮对话，为下一轮 PM 提供 hint
      const qualityResult = await this.hermesQuality.analyzeResponse(
        allMessages.map(m => ({ role: m.role, content: m.content })),
      );
      if (qualityResult.hints.length > 0) {
        this.qualityHints.set(projectId, qualityResult.hints);
      }
    } else if (result.prd) {
      // 8. PRD 就绪 — 仅保存 PRD，不触发 N8N（等待用户确认方案）
      await this.hermes.handlePrdReady(projectId, result.prd, result.summary);
    }

    // 5. Return filtered messages (no system_internal)
    const returnMessages = await this.prisma.projectMessage.findMany({
      where: { projectId, role: { not: 'system_internal' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    return { messages: returnMessages };
  }
}
