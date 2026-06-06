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
