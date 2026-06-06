import { Injectable } from '@nestjs/common';

/**
 * 交付控制层 — 安全闸门（SecurityGate）
 *
 * 职责：在执行器（Claude Code / Cloudecode 等）改动文件后，校验其是否越界。
 * 这是「给很多人运营」时防止 agent 乱改/泄露的基础安全层。
 *
 * 本文件只实现纯逻辑（glob 边界匹配），不依赖运行态（DB/Redis/Docker），
 * 便于单测验证；尚未接入主交付流程（骨架阶段）。
 */

export type FileScopeReason = 'forbidden' | 'out-of-scope';

export interface FileScopeViolation {
  file: string;
  reason: FileScopeReason;
  /** 命中的 forbidden 模式（reason=forbidden 时存在） */
  pattern?: string;
}

export interface FileScopeResult {
  allowed: boolean;
  violations: FileScopeViolation[];
}

export interface FileScopeParams {
  /** 本次实际改动的文件路径 */
  changedFiles: string[];
  /** 允许改动的 glob；为空表示不限制范围（只做 forbidden 检查） */
  allowedFiles?: string[];
  /** 禁止改动的 glob（优先级高于 allowed） */
  forbiddenFiles?: string[];
}

export interface CommandCheckResult {
  allowed: boolean;
  /** 拒绝原因（allowed=false 时存在） */
  reason?: string;
  /** 命中的规则来源（白名单模式或危险模式） */
  matched?: string;
}

/** 默认允许的命令白名单（构建/测试/类型检查/Prisma/Docker 等交付必需命令） */
const DEFAULT_ALLOWED_COMMANDS: RegExp[] = [
  /^npm\s+(ci|install|i)(\s|$)/i,
  /^npm\s+run\s+(build|test|lint|start)(\s|$)/i,
  /^npm\s+test(\s|$)/i,
  /^npx\s+tsc\b/i,
  /^npx\s+prisma\s+(generate|migrate|db)\b/i,
  /^npx\s+(jest|eslint)\b/i,
  /^docker\s+(build|run)\b/i,
  /^node\s+/i,
];

/** 危险命令模式（优先于白名单，命中即拒绝） */
const DANGEROUS_COMMANDS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-[a-z]*[rf][a-z]*\s+(\/(?!\w)|~|\$HOME)/i, reason: '删除根/家目录' },
  { pattern: /\b(cat|less|more|head|tail|nano|vim?|code)\b[^;|&]*\.env\b/i, reason: '读取 .env 密钥' },
  { pattern: /\bprintenv\b/i, reason: '输出环境变量' },
  { pattern: /(^|[;|&]\s*)env\s*($|[;|&])/i, reason: '输出环境变量' },
  { pattern: /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh)\b/i, reason: '下载脚本直接执行' },
  { pattern: />\s*\/dev\/(sd|nvme|hd|mapper)/i, reason: '写入磁盘设备' },
  { pattern: /\bchmod\s+-R\s+0?777\b/i, reason: '递归 777 危险权限' },
  { pattern: /\b(shutdown|reboot|mkfs\b|dd\s+if=)/i, reason: '系统级危险命令' },
];

@Injectable()
export class SecurityGateService {
  /**
   * 校验改动文件是否在允许范围内、是否触碰禁止区。
   * 规则：forbidden 优先；allowedFiles 非空时，文件必须命中其一，否则判为越界。
   */
  checkFileScope(params: FileScopeParams): FileScopeResult {
    const { changedFiles, allowedFiles = [], forbiddenFiles = [] } = params;
    const violations: FileScopeViolation[] = [];

    for (const file of changedFiles) {
      const path = this.normalize(file);

      const hitForbidden = forbiddenFiles.find((p) =>
        this.matchGlob(this.normalize(p), path),
      );
      if (hitForbidden) {
        violations.push({ file, reason: 'forbidden', pattern: hitForbidden });
        continue;
      }

      if (allowedFiles.length > 0) {
        const inScope = allowedFiles.some((p) =>
          this.matchGlob(this.normalize(p), path),
        );
        if (!inScope) {
          violations.push({ file, reason: 'out-of-scope' });
        }
      }
    }

    return { allowed: violations.length === 0, violations };
  }

  /**
   * 校验单条命令是否允许执行。
   * 规则：危险模式优先拒绝；否则必须命中白名单，未命中亦拒绝。
   */
  checkCommand(command: string, opts: { allow?: RegExp[] } = {}): CommandCheckResult {
    const cmd = command.trim();
    if (!cmd) return { allowed: false, reason: '空命令' };

    for (const d of DANGEROUS_COMMANDS) {
      if (d.pattern.test(cmd)) {
        return { allowed: false, reason: d.reason, matched: d.pattern.source };
      }
    }

    const allow = opts.allow ?? DEFAULT_ALLOWED_COMMANDS;
    const hit = allow.find((p) => p.test(cmd));
    if (hit) return { allowed: true, matched: hit.source };

    return { allowed: false, reason: '不在命令白名单内' };
  }

  /** 统一路径分隔符为 /，并去掉 ./ 前缀 */
  private normalize(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  private matchGlob(pattern: string, path: string): boolean {
    return this.globToRegExp(pattern).test(path);
  }

  /**
   * 最小 glob → 正则：
   *   `**` 跨目录（含 /），`**` + `/` 匹配零或多级目录，`*` 单段内任意（不含 /），其余字面量。
   */
  private globToRegExp(glob: string): RegExp {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          if (glob[i + 2] === '/') {
            re += '(?:.*/)?';
            i += 2;
          } else {
            re += '.*';
            i += 1;
          }
        } else {
          re += '[^/]*';
        }
      } else if ('\\^$.|?+()[]{}'.includes(c)) {
        re += '\\' + c;
      } else {
        re += c;
      }
    }
    return new RegExp('^' + re + '$');
  }
}
