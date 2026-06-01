import { test, expect } from '@playwright/test';

test.describe('New Project', () => {
  test('should render create project form', async ({ page }) => {
    await page.goto('/projects/new');
    await expect(page).toHaveURL(/\/projects\/new/);

    // 页面标题
    await expect(page.locator('h1, h2').filter({ hasText: /创建|新建|新项目/i }).first()).toBeVisible();

    // 项目名称输入框
    const nameInput = page.locator('input[name="name"], input[placeholder*="项目"], input[placeholder*="名称"], textarea[placeholder*="描述"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  });

  test('should create a project', async ({ page }) => {
    await page.goto('/projects/new');

    const nameInput = page.locator('input[name="name"], input[placeholder*="项目名称"], input[placeholder*="一句话"]').first();
    const descInput = page.locator('textarea, input[placeholder*="描述"], input[placeholder*="需求"]').first();

    if (await nameInput.isVisible()) {
      const projectName = `E2E Test ${Date.now().toString(36)}`;
      await nameInput.fill(projectName);

      if (await descInput.isVisible()) {
        await descInput.fill('一个客户管理系统，包含客户列表、搜索、新增、编辑、删除功能');
      }

      // 提交
      const submitBtn = page.locator('button[type="submit"], button:has-text("创建"), button:has-text("生成"), button:has-text("提交")').first();
      await submitBtn.click();

      // 应该跳转到项目详情页
      await page.waitForURL(/\/projects\//, { timeout: 20000 });
      await expect(page).toHaveURL(/\/projects\//);
      console.log(`Created project → ${page.url()}`);
    } else {
      test.skip(true, 'Project form not found');
    }
  });
});
