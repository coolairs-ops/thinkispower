import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface CachedPattern {
  id: string;
  patternKey: string;
  signals: { regex?: string[]; keywords?: string[] };
  recommendedActions: { fixPrompt?: string; fallbackStrategy?: string };
  autoFixable: boolean;
  severity: string;
}

@Injectable()
export class ErrorMatcherService implements OnModuleInit {
  private readonly logger = new Logger(ErrorMatcherService.name);
  private patterns: CachedPattern[] = [];

  constructor(private prisma: PrismaService) {}

  /** 启动时加载所有 autoFixable 的 ErrorPattern */
  async onModuleInit() {
    try {
      const patterns = await this.prisma.errorPattern.findMany();
      this.patterns = patterns.map((p) => ({
        id: p.id,
        patternKey: p.patternKey,
        signals: (p.signals as any) || {},
        recommendedActions: (p.recommendedActions as any) || {},
        autoFixable: p.autoFixable,
        severity: p.severity,
      }));
      this.logger.log(`加载了 ${this.patterns.length} 个错误模式`);
    } catch (error) {
      this.logger.warn(`加载 ErrorPattern 失败（首次启动可能无数据）: ${error}`);
    }
  }

  /**
   * 将错误文本匹配到 ErrorPattern。
   * 遍历所有缓存模式，用 signals.regex 和 signals.keywords 匹配。
   */
  async matchError(
    errorText: string,
  ): Promise<{ pattern: CachedPattern; confidence: number } | null> {
    const lower = errorText.toLowerCase();

    for (const pattern of this.patterns) {
      // 正则匹配
      if (pattern.signals.regex) {
        for (const reStr of pattern.signals.regex) {
          try {
            const re = new RegExp(reStr, 'i');
            if (re.test(errorText)) {
              return { pattern, confidence: 0.9 };
            }
          } catch {
            // 无效正则跳过
          }
        }
      }

      // 关键词匹配（至少匹配 2 个关键词才计为命中）
      if (pattern.signals.keywords) {
        const matched = pattern.signals.keywords.filter((kw) =>
          lower.includes(kw.toLowerCase()),
        );
        if (matched.length >= 2) {
          const confidence = Math.min(0.5 + matched.length * 0.15, 0.95);
          return { pattern, confidence };
        }
      }
    }

    return null;
  }

  /**
   * 创建 ErrorEvent 记录，关联 project/task/pattern。
   */
  async recordError(params: {
    projectId: string;
    taskId: string;
    rawError: string;
    patternId?: string;
    stage: string;
    actionTaken?: string;
  }): Promise<void> {
    await this.prisma.errorEvent.create({
      data: {
        projectId: params.projectId,
        taskId: params.taskId,
        patternId: params.patternId,
        rawError: params.rawError,
        sanitizedError: this.sanitize(params.rawError),
        stage: params.stage,
        actionTaken: params.actionTaken || 'pending_review',
      },
    });
  }

  /**
   * 根据 ErrorPattern 生成修复提示，附加到 DeepSeek prompt 中。
   */
  buildFixPrompt(pattern: CachedPattern, originalError: string): string {
    const actions = pattern.recommendedActions;
    const lines: string[] = [
      `\n## 上次修改出现以下问题，请修复`,
      originalError,
    ];
    if (actions.fixPrompt) {
      lines.push(``, `## 修复建议`, actions.fixPrompt);
    }
    return lines.join('\n');
  }

  /** 刷新缓存（供 seed 脚本或管理接口调用） */
  async refreshCache(): Promise<void> {
    await this.onModuleInit();
  }

  private sanitize(raw: string): string {
    // 移除可能的敏感信息（邮箱、API key 模式等）
    return raw
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/(sk-[a-zA-Z0-9]{20,})/g, '[api-key]')
      .slice(0, 2000);
  }
}
