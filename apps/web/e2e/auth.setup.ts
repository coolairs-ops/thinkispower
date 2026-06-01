import { test as setup, expect } from '@playwright/test';
import * as path from 'path';

const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  // 访问首页 → 应自动跳转到登录页
  await page.goto('/');
  await page.waitForURL(/\/login|\/auth/);

  // 填写登录表单
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="邮箱"], input[placeholder*="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="密码"]').first();

  if (await emailInput.isVisible()) {
    await emailInput.fill('admin@quiche.com');
    await passwordInput.fill('admin123');

    // 点击登录按钮
    const loginButton = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Sign in")').first();
    await loginButton.click();

    // 等待跳转到 dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/dashboard/);
  } else {
    // 如果已经是 dashboard（无登录页），直接通过
    console.log('No login form found, assuming already authenticated');
  }

  await page.context().storageState({ path: authFile });
});
