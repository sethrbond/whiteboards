// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('landing page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Whiteboards/);
    const landing = page.locator('#landingPage');
    await expect(landing).toBeVisible({ timeout: 10000 });
  });

  test('"Get Started" button navigates to auth form', async ({ page }) => {
    await page.goto('/');
    const landing = page.locator('#landingPage');
    await expect(landing).toBeVisible({ timeout: 10000 });

    // Click the "Get Started Free" CTA button
    await page.click('[data-action="auth-landing"]');

    const authScreen = page.locator('#authScreen');
    await expect(authScreen).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#authEmail')).toBeVisible();
    await expect(page.locator('#authPassword')).toBeVisible();
  });

  test('feature cards are visible with correct content', async ({ page }) => {
    await page.goto('/');
    const landing = page.locator('#landingPage');
    await expect(landing).toBeVisible({ timeout: 10000 });

    // Should have exactly 3 feature cards
    const features = page.locator('.landing-feature');
    await expect(features).toHaveCount(3);

    // Verify feature headings exist
    await expect(page.locator('.landing-feature h2').nth(0)).toContainText('Drop your chaos');
    await expect(page.locator('.landing-feature h2').nth(1)).toContainText('AI that actually helps');
    await expect(page.locator('.landing-feature h2').nth(2)).toContainText('From brainstorm to done');

    // Each feature should have a description paragraph
    const descriptions = page.locator('.landing-feature p');
    await expect(descriptions).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const text = await descriptions.nth(i).textContent();
      expect(text.length).toBeGreaterThan(20);
    }
  });

  test('landing page is responsive at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const landing = page.locator('#landingPage');
    await expect(landing).toBeVisible({ timeout: 10000 });

    // CTA button should still be visible and clickable at mobile size
    const cta = page.locator('.landing-cta');
    await expect(cta).toBeVisible();

    // Feature cards should still be rendered
    const features = page.locator('.landing-feature');
    await expect(features).toHaveCount(3);

    // The headline should be visible
    const headline = page.locator('.landing-h1');
    await expect(headline).toBeVisible();
  });
});
