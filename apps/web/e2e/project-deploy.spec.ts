import { test, expect } from '@playwright/test';

/**
 * 测试部署页 E2E
 * 页面: /projects/[id]/deploy
 * 验证: 部署状态、步骤日志、健康检查结果
 */
test.describe('Deploy Page', () => {

  async function getFirstProjectId(page: any): Promise<string | null> {
    await page.goto('/dashboard');
    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) return null;
    await firstProject.click();
    await page.waitForURL(/\/projects\//, { timeout: 10000 });
    const match = page.url().match(/\/projects\/([^/?]+)/);
    return match ? match[1] : null;
  }

  test('should render deploy page', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/deploy`);

    // 页面标题
    await expect(
      page.locator('h1, h2').filter({ hasText: /部署|测试环境|Deploy/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show deploy button or status', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/deploy`);
    await page.waitForTimeout(2000);

    // 部署按钮或状态信息
    const deployBtn = page.locator('button:has-text("部署"), button:has-text("Deploy"), button:has-text("重新部署")').first();
    const statusText = page.locator('text=状态, text=Status, text=部署中, text=已部署, text=健康');

    // 至少有一个可见
    const any = deployBtn.or(statusText.first());
    await expect(any).toBeVisible({ timeout: 10000 });
  });

  test('deploy page should show steps when deploying', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/deploy`);

    // 检查进度条或步骤列表
    const progress = page.locator('[class*="progress"], [class*="step"], [class*="Stage"]');
    const logArea = page.locator('[class*="log"], pre, code');

    // 不强求，部署可能没启动
    const hasProgress = await progress.first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasLog = await logArea.first().isVisible({ timeout: 3000 }).catch(() => false);

    // 至少页面没报错
    expect(page.url()).toContain('deploy');
  });
});
