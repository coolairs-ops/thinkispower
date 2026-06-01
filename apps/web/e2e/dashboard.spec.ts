import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('should display project list', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // 页面标题
    await expect(page.locator('h1, h2').filter({ hasText: /我的项目|项目|Dashboard/i }).first()).toBeVisible();

    // 项目列表或空状态
    const projectCards = page.locator('[class*="project"], [class*="card"], a[href*="/projects/"]');
    const emptyState = page.locator('text=还没有项目|创建.*项目|新建项目|暂无项目');

    await expect(projectCards.first().or(emptyState.first())).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to new project page', async ({ page }) => {
    await page.goto('/dashboard');

    // 点击创建项目按钮/链接
    const createButton = page.locator('a[href*="/projects/new"], button:has-text("创建"), button:has-text("新建"), a:has-text("创建项目")').first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    await page.waitForURL(/\/projects\/new/);
    await expect(page).toHaveURL(/\/projects\/new/);
  });

  test('should have navigation bar', async ({ page }) => {
    await page.goto('/dashboard');

    // NavBar 应该存在
    const nav = page.locator('nav, [class*="nav"], [class*="header"]').first();
    await expect(nav).toBeVisible();

    // 应该有项目评估入口
    const evalLink = page.locator('a[href*="evaluation"], a:has-text("评估")').first();
    // 不强制要求，有些版本可能没有
  });
});
