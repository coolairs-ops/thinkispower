import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ClarifyService } from '../../services/clarify.service';
import { StatusMapperService } from '../../services/status-mapper.service';

@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    private clarify: ClarifyService,
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
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'clarifying',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('clarifying'),
      },
    });

    // 3. Get all messages for context
    const allMessages = await this.prisma.projectMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    // 4. Call clarify service
    const result = await this.clarify.processMessages(
      allMessages.map(m => ({ role: m.role, content: m.content })),
    );

    if (result.needMoreInfo && result.questions.length > 0) {
      // Save assistant questions
      const questionText = result.questions.join('\n\n');
      await this.prisma.projectMessage.create({
        data: { projectId, role: 'assistant', content: questionText },
      });
    } else if (result.structuredRequirement) {
      // Save structured requirement as system_internal
      await this.prisma.projectMessage.create({
        data: {
          projectId,
          role: 'system_internal',
          content: '结构化需求已生成',
          metadata: { structuredRequirement: result.structuredRequirement },
        },
      });

      // Save success message to user
      await this.prisma.projectMessage.create({
        data: {
          projectId,
          role: 'assistant',
          content: '我已经了解了你的需求，可以查看方案了。',
        },
      });

      // Update project with structured requirement
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'plan_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('plan_ready'),
          structuredRequirement: result.structuredRequirement as any,
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
