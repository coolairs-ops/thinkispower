import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SensorReport, SensorCheck } from './sensor-report.interface';

/**
 * L2 截图对比传感器
 *
 * 对每次迭代前后的 Demo 进行截图，通过像素对比量化改动幅度。
 * 防止 LLM 修一个 bug 拆三个功能（无意的副作用）。
 *
 * ── 接入方式 ──
 * 本服务为桩代码（stub），使用前需要：
 *
 * 1. 安装 Playwright:
 *    npm install playwright
 *    npx playwright install chromium
 *
 * 2. 配置 .env:
 *    SCREENSHOT_COMPARISON_ENABLED=true
 *    SCREENSHOT_OUTPUT_DIR=./data/screenshots
 *
 * 3. 取消下方注释，替换桩实现。
 *
 * ── 推荐流程 ──
 * 1. 迭代前: capture(baseline) → 保存 baseline
 * 2. 迭代后: capture(current) → diff(baseline, current)
 * 3. 输出: diffRatio (0-1), diffImage
 * 4. 反馈: 改动区域占比 > 0.3 → warning (改动过大)
 *           改动区域占比 < 0.01 → warning (可能没改)
 */
@Injectable()
export class ScreenshotComparator {
  private readonly logger = new Logger(ScreenshotComparator.name);
  private enabled: boolean;

  constructor(private config: ConfigService) {
    this.enabled = this.config.get('SCREENSHOT_COMPARISON_ENABLED', 'false') === 'true';
  }

  get available(): boolean {
    return this.enabled;
  }

  /**
   * 比较两版 HTML 的渲染差异（桩实现）
   *
   * 正式实现：
   *   - 将 HTML 写入临时文件
   *   - 用 Playwright 打开并截图（viewport: 1440x900）
   *   - 使用 pixelmatch 对比像素差异
   *   - 返回 diffRatio 和 diffImage
   */
  async compare(
    projectId: string,
    previousHtml: string,
    currentHtml: string,
  ): Promise<SensorReport> {
    if (!this.enabled) {
      return {
        sensorName: 'ScreenshotComparator',
        layer: 2,
        passed: true,
        score: 100,
        checks: [{
          name: '截图对比',
          passed: true,
          score: 100,
          weight: 100,
          detail: 'SCREENSHOT_COMPARISON_ENABLED=false，已跳过。启用需安装 Playwright（见源码注释）',
        }],
      };
    }

    // ──── 以下为桩代码，启用时替换 ────
    this.logger.log(`截图对比: project=${projectId} (stub)`);

    return {
      sensorName: 'ScreenshotComparator',
      layer: 2,
      passed: true,
      score: 75,
      checks: [{
        name: '截图对比',
        passed: true,
        score: 75,
        weight: 100,
        detail: '桩实现：正式启用需要 Playwright 环境',
      }],
    };
  }

  /**
   * 正式实现参考（Playwright + pixelmatch）：
   *
   * import { chromium } from 'playwright';
   * import pixelmatch from 'pixelmatch';
   * import { PNG } from 'pngjs';
   *
   * async function capture(html: string): Promise<Buffer> {
   *   const tmpFile = join(tmpdir(), `shot-${Date.now()}.html`);
   *   writeFileSync(tmpFile, html, 'utf-8');
   *   const browser = await chromium.launch();
   *   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
   *   await page.goto(`file://${tmpFile}`, { waitUntil: 'networkidle' });
   *   const shot = await page.screenshot({ fullPage: true });
   *   await browser.close();
   *   return shot;
   * }
   *
   * async function diff(a: Buffer, b: Buffer): Promise<{ diffRatio: number; diffImage: Buffer }> {
   *   const imgA = PNG.sync.read(a);
   *   const imgB = PNG.sync.read(b);
   *   const { width, height } = imgA;
   *   const diff = new PNG({ width, height });
   *   const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, { threshold: 0.1 });
   *   return { diffRatio: diffPixels / (width * height), diffImage: PNG.sync.write(diff) };
   * }
   */
}
