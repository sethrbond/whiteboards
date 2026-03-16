// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Auth UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const landing = page.locator('#landingPage');
    await expect(landing).toBeVisible({ timeout: 10000 });
    // Navigate to auth screen via Sign In button
    await page.click('[data-action="auth-landing-login"]');
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 5000 });
  });

  test('auth form shows email and password inputs', async ({ page }) => {
    const emailInput = page.locator('#authEmail');
    const passwordInput = page.locator('#authPassword');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Verify input types
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Verify placeholders
    await expect(emailInput).toHaveAttribute('placeholder', 'Email');
    await expect(passwordInput).toHaveAttribute('placeholder', 'Password');
  });

  test('can toggle between Sign In and Sign Up', async ({ page }) => {
    // Initially should show Sign In
    await expect(page.locator('#authBtn')).toHaveText('Sign In');
    await expect(page.locator('#authSwitchText')).toContainText("Don't have an account?");
    await expect(page.locator('#authSwitchLink')).toHaveText('Sign Up');

    // Toggle to Sign Up
    await page.click('[data-action="toggle-auth"]');
    await expect(page.locator('#authBtn')).toHaveText('Sign Up');
    await expect(page.locator('#authSwitchLink')).toHaveText('Sign In');

    // Toggle back
    await page.click('[data-action="toggle-auth"]');
    await expect(page.locator('#authBtn')).toHaveText('Sign In');
  });

  test('forgot password link exists and is clickable', async ({ page }) => {
    const forgotLink = page.locator('[data-action="forgot-password"]');
    await expect(forgotLink).toBeVisible();
    await expect(forgotLink).toContainText('Forgot password');
  });

  test('empty form submission shows validation', async ({ page }) => {
    // Try to submit empty form — browser validation should prevent submission
    const submitBtn = page.locator('#authBtn');
    await submitBtn.click();

    // Auth screen should still be visible (form was not submitted)
    await expect(page.locator('#authScreen')).toBeVisible();

    // Email input should be marked invalid by browser validation (required + empty)
    const isEmailInvalid = await page.locator('#authEmail').evaluate(
      (el) => !el.validity.valid
    );
    expect(isEmailInvalid).toBe(true);
  });
});
