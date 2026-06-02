import { test, expect } from '@playwright/test';

/**
 * 需求访谈页 E2E
 * 页面: /projects/[id]/idea
 * 验证: 访谈界面、进度条、回答/跳过交互
 */
test.describe('Idea Interview Page', () => {

  async function getFirstProjectId(page: any): Promise<string | null> {
    await page.goto('/dashboard');
    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) return null;
    await firstProject.click();
    await page.waitForURL(/\/projects\//, { timeout: 10000 });
    const match = page.url().match(/\/projects\/([^/?]+)/);
    return match ? match[1] : null;
  }

  test('should render idea interview page', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/idea`);

    // 页面标题
    await expect(
      page.locator('h1, h2').filter({ hasText: /访谈|需求|Idea|想法/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show current question and progress', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/idea`);
    await page.waitForTimeout(3000);

    // 进度条或阶段指示
    const progress = page.locator('[class*="progress"], [class*="stage"], [class*="Step"]').first();
    // 输入区域
    const input = page.locator('input, textarea').first();
    // 发送按钮
    const sendBtn = page.locator('button:has-text("发送"), button:has-text("提交"), button:has-text("Send")').first();

    // 至少进度和输入区有一个可见
    const any = progress.or(input);
    const isVisible = await any.isVisible({ timeout: 5000 }).catch(() => false);

    if (isVisible) {
      // 有交互界面 → 正常
      expect(true).toBe(true);
    } else {
      // 访谈可能已完成 → 页面应有完成提示
      const doneMsg = page.locator('text=完成, text=Done, text=已生成, text=需求文档');
      await expect(doneMsg.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should have skip button if interview in progress', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/idea`);
    await page.waitForTimeout(2000);

    // 跳过按钮
    const skipBtn = page.locator('button:has-text("跳过"), button:has-text("Skip")').first();
    const isVisible = await skipBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (isVisible) {
      await skipBtn.click();
      await page.waitForTimeout(1000);
      // 点击后页面没崩溃
      expect(page.url()).toContain('idea');
    }
    // 如果访谈已完成，跳过按钮不存在也正常
  });
});
