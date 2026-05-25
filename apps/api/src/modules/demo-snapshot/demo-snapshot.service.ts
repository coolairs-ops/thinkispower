import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DemoSnapshotService {
  private readonly logger = new Logger(DemoSnapshotService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 将当前 demoHtml 保存为一条快照，version 自动递增。
   * 在修改 demoHtml 之前调用。
   */
  async createSnapshot(
    projectId: string,
    html: string,
    source: 'demo_generate' | 'pipeline_execute' | 'manual_rollback',
    taskId?: string,
  ): Promise<void> {
    // 取当前项目最大版本号
    const last = await this.prisma.demoSnapshot.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    await this.prisma.demoSnapshot.create({
      data: {
        projectId,
        html,
        source,
        taskId,
        version: (last?.version ?? 0) + 1,
      },
    });

    this.logger.log(`Snapshot v${(last?.version ?? 0) + 1} created for project ${projectId} (${source})`);
  }

  /** 返回项目快照列表（不含 html 全文） */
  async findByProject(projectId: string) {
    return this.prisma.demoSnapshot.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        taskId: true,
        createdAt: true,
      },
    });
  }

  /** 查询单条快照（含 html） */
  async findById(id: string) {
    const snapshot = await this.prisma.demoSnapshot.findUnique({
      where: { id },
    });
    if (!snapshot) throw new NotFoundException('快照不存在');
    return snapshot;
  }

  /** 回滚到指定快照 */
  async rollback(projectId: string, snapshotId: string) {
    const snapshot = await this.findById(snapshotId);
    if (snapshot.projectId !== projectId) {
      throw new NotFoundException('快照不属于该项目');
    }

    // 保存回滚前的版本
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true },
    });
    if (!project) throw new NotFoundException('项目不存在');

    if (project.demoHtml) {
      await this.createSnapshot(projectId, project.demoHtml, 'manual_rollback');
    }

    // 执行回滚
    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: snapshot.html },
    });

    this.logger.log(`Project ${projectId} rolled back to snapshot ${snapshotId} (v${snapshot.version})`);
  }
}
