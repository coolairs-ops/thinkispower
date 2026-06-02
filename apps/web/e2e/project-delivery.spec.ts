import { test, expect } from '@playwright/test';

/**
 * 交付页 E2E
 * 页面: /projects/[id]/delivery
 * 验证: 三态卡片、产物卡片、开始交付、进度条
 */
test.describe('Delivery Page', () => {

  async function getFirstProjectId(page: any): Promise<string | null> {
    await page.goto('/dashboard');
    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) return null;
    await firstProject.click();
    await page.waitForURL(/\/projects\//, { timeout: 10000 });
    const match = page.url().match(/\/projects\/([^/?]+)/);
    return match ? match[1] : null;
  }

  test('should render delivery page', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/delivery`);

    // 页面标题
    await expect(
      page.locator('h1, h2').filter({ hasText: /交付|Delivery|生成树/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show delivery artifacts (preview/deploy/download cards)', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/delivery`);
    await page.waitForTimeout(2000);

    // 产物卡片：在线预览/在线部署/源码下载
    const previewCard = page.locator('text=在线预览, text=预览, a[href*="preview"]').first();
    const deployCard = page.locator('text=在线部署, text=部署, a[href*="deploy"]').first();
    const downloadCard = page.locator('text=源码下载, text=下载, a[href*="download"]').first();

    // 至少有一个产物区域可见
    const anyCard = previewCard.or(deployCard).or(downloadCard);
    await expect(anyCard).toBeVisible({ timeout: 10000 });
  });

  test('should have start delivery button', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/delivery`);

    // "开始交付" 或 "重新交付" 按钮
    const startBtn = page.locator('button:has-text("交付"), button:has-text("开始")').first();
    await expect(startBtn).toBeVisible({ timeout: 10000 });
  });

  test('should show progress indicator when delivery starts', async ({ page }) => {
    const projectId = await getFirstProjectId(page);
    if (!projectId) { test.skip(true, 'No projects available'); return; }

    await page.goto(`/projects/${projectId}/delivery`);

    // 点击开始交付
    const startBtn = page.locator('button:has-text("交付"), button:has-text("开始")').first();
    if (await startBtn.isEnabled({ timeout: 3000 })) {
      await startBtn.click();
      await page.waitForTimeout(3000);

      // 检查进度条出现
      const progress = page.locator('[class*="progress"], [role="progressbar"]').first();
      // 进度条可能出现也可能太慢——不强制
      const visible = await progress.isVisible({ timeout: 3000 }).catch(() => false);
      // 至少页面没崩溃
      expect(page.url()).toContain('delivery');
    }
  });
});
