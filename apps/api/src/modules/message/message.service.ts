import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { ProductDiscoveryService, PRD } from '../../services/product-discovery.service';
import { StatusMapperService } from '../../services/status-mapper.service';

@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    private discovery: ProductDiscoveryService,
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

    // 4. Call ProductDiscoveryService (PM deep exploration)
    const result = await this.discovery.processMessages(
      allMessages.map(m => ({ role: m.role, content: m.content })),
    );

    if (result.needMoreInfo && result.question) {
      // 4a. Still exploring — save the AI question
      const assistantContent = result.summary
        ? `${result.summary}\n\n${result.question}`
        : result.question;

      await this.prisma.projectMessage.create({
        data: { projectId, role: 'assistant', content: assistantContent },
      });
    } else if (result.prd) {
      // 4b. PRD ready — save it and update status
      await this.prisma.projectMessage.create({
        data: {
          projectId,
          role: 'system_internal',
          content: 'PRD 已生成',
          metadata: { prd: result.prd } as any,
        },
      });

      // Save completion message
      const completionMessage = result.summary
        ? `${result.summary}\n\n我已经对你想做的产品有了全面了解。下面是我整理的需求文档，你看看是否准确？如果有需要修改的地方，直接告诉我，我可以帮你调整。`
        : '我已经对你想做的产品有了全面了解。下面是我整理的需求文档，你看看是否准确？如果有需要修改的地方，直接告诉我，我可以帮你调整。';

      await this.prisma.projectMessage.create({
        data: {
          projectId,
          role: 'assistant',
          content: completionMessage,
        },
      });

      // Update project with PRD and status
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'prd_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('prd_ready'),
          structuredRequirement: { prd: result.prd } as unknown as Prisma.JsonNullValueInput,
        },
      });
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
