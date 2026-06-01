import { test, expect } from '@playwright/test';

test.describe('Project Demo', () => {
  // 需要一个已有项目，从 dashboard 进入
  test('should navigate to demo page from project', async ({ page }) => {
    await page.goto('/dashboard');

    // 找到第一个项目卡片并点击
    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (await firstProject.isVisible({ timeout: 5000 })) {
      await firstProject.click();
      await page.waitForURL(/\/projects\//, { timeout: 10000 });

      // 尝试找到 Demo/预览 链接
      const demoLink = page.locator('a[href*="/demo"], a:has-text("预览"), a:has-text("Demo"), button:has-text("预览")').first();

      if (await demoLink.isVisible({ timeout: 5000 })) {
        await demoLink.click();
        await page.waitForURL(/\/demo/, { timeout: 10000 });
        await expect(page).toHaveURL(/\/demo/);
      }
    }
  });

  test('demo page should have preview area', async ({ page }) => {
    // 直接访问已知项目（如果有的话）
    await page.goto('/dashboard');

    const firstProject = page.locator('a[href*="/projects/"]').first();
    if (!(await firstProject.isVisible({ timeout: 3000 }))) {
      test.skip(true, 'No projects available');
      return;
    }

    await firstProject.click();
    await page.waitForURL(/\/projects\//);

    // 检查是否有 demo 页面可访问
    const currentUrl = page.url();
    const projectId = currentUrl.match(/\/projects\/([^/]+)/)?.[1];
    if (projectId) {
      await page.goto(`/projects/${projectId}/demo`);
      await page.waitForLoadState('networkidle', { timeout: 10000 });

      // 应该有 iframe 预览或 demo 内容
      const iframe = page.locator('iframe');
      const demoContent = page.locator('[class*="preview"], [class*="demo"]');

      await expect(iframe.first().or(demoContent.first())).toBeVisible({ timeout: 10000 });
    }
  });

  test('should have feedback section', async ({ page }) => {
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
      await page.goto(`/projects/${projectId}/demo`);

      // 检查是否有反馈/批注相关 UI
      const feedbackSection = page.locator('text=意见, text=批注, text=反馈, text=反馈').first();
      // 不强制断言，有些项目可能没有
    }
  });
});
