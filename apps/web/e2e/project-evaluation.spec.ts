import { test, expect } from '@playwright/test';

test.describe('Project Evaluation', () => {
  test('should render evaluation page', async ({ page }) => {
    await page.goto('/dashboard');

    // 找到第一个项目
    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) {
      test.skip(true, 'No projects available');
      return;
    }

    await firstProject.click();
    await page.waitForURL(/\/projects\//);

    const currentUrl = page.url();
    const projectId = currentUrl.match(/\/projects\/([^/]+)/)?.[1];

    if (projectId) {
      await page.goto(`/projects/${projectId}/evaluation`);

      // 页面标题
      await expect(page.locator('h1, h2').filter({ hasText: /评估|Evaluation/i }).first()).toBeVisible({ timeout: 10000 });

      // 应该有完整性进度条或风险列表
      const progressBar = page.locator('[class*="progress"], [class*="bar"], [role="progressbar"]');
      const riskList = page.locator('text=风险, text=问题, [class*="risk"]');

      await expect(progressBar.first().or(riskList.first())).toBeVisible({ timeout: 10000 });
    }
  });

  test('evaluation page should have action buttons', async ({ page }) => {
    await page.goto('/dashboard');

    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) {
      test.skip(true, 'No projects available');
      return;
    }

    await firstProject.click();
    const currentUrl = page.url();
    const projectId = currentUrl.match(/\/projects\/([^/]+)/)?.[1];

    if (projectId) {
      await page.goto(`/projects/${projectId}/evaluation`);

      // 检查关键操作按钮
      const reEvalBtn = page.locator('button:has-text("重新评估"), button:has-text("评估")').first();
      const deliverBtn = page.locator('button:has-text("交付"), button:has-text("终稿"), a[href*="delivery"]').first();

      // 至少有一个可见
      const anyBtn = reEvalBtn.or(deliverBtn);
      await expect(anyBtn).toBeVisible({ timeout: 10000 });
    }
  });

  test('should navigate to delivery page', async ({ page }) => {
    await page.goto('/dashboard');

    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) {
      test.skip(true, 'No projects available');
      return;
    }

    await firstProject.click();
    const currentUrl = page.url();
    const projectId = currentUrl.match(/\/projects\/([^/]+)/)?.[1];

    if (projectId) {
      // 直接访问交付页
      await page.goto(`/projects/${projectId}/delivery`);

      await expect(page.locator('h1, h2').filter({ hasText: /交付|Delivery|生成树/i }).first()).toBeVisible({ timeout: 10000 });

      // 应该有交付选项或进度面板
      const deliveryOptions = page.locator('[class*="option"], [class*="delivery"], button');
      await expect(deliveryOptions.first()).toBeVisible({ timeout: 5000 });
    }
  });
});
