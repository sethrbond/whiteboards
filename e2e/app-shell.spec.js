// @ts-check
import { test, expect } from '@playwright/test';
import { mockAuthAndGoToDashboard } from './helpers.js';

test.describe('App Shell', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndGoToDashboard(page);
    // Wait for the app to fully hydrate (window API exposed)
    await page.waitForFunction(() => typeof window.render === 'function', null, { timeout: 10000 });
  });

  test('sidebar renders with Brainstorm and Dashboard nav items', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    const brainstormNav = page.locator('[data-view="dump"]');
    await expect(brainstormNav).toBeVisible();
    await expect(brainstormNav).toContainText('Brainstorm');

    const dashboardNav = page.locator('[data-view="dashboard"]');
    await expect(dashboardNav).toBeVisible();
    await expect(dashboardNav).toContainText('Dashboard');
  });

  test('clicking Brainstorm shows brainstorm textarea', async ({ page }) => {
    const brainstormNav = page.locator('[data-view="dump"]');
    await brainstormNav.click();
    await page.waitForTimeout(500);

    const viewTitle = page.locator('#viewTitle');
    await expect(viewTitle).toContainText(/brainstorm/i);

    // The brainstorm view should have a textarea for input
    const textarea = page.locator('#dumpText, textarea[placeholder*="brainstorm" i], textarea[placeholder*="paste" i], .dump-textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('quick capture input exists in project view', async ({ page }) => {
    // Inject a task and switch directly to project view
    await page.evaluate(() => {
      const task = window.createTask({ title: 'Test task for quick add', project: 'life', priority: 'medium' });
      window.data.tasks.push(task);
      if (!window.data.projects.some(p => p.id === 'life')) {
        window.data.projects.push({ id: 'life', name: 'Life', color: '#818cf8' });
      }
      window.setView('project', 'life');
    });
    await page.waitForTimeout(500);

    // Quick add input should be visible in the project view
    const quickAdd = page.locator('#quickAdd');
    await expect(quickAdd).toBeVisible({ timeout: 5000 });
  });

  test('command palette opens with Cmd+K', async ({ page }) => {
    // Ensure focus is on the main area, not on any input
    await page.click('.main');
    await page.waitForTimeout(200);

    await page.keyboard.press('Meta+k');

    const cmdPalette = page.locator('.cmd-palette').first();
    await expect(cmdPalette).toBeVisible({ timeout: 5000 });

    // Command palette should have a search input
    const paletteInput = cmdPalette.locator('input').first();
    await expect(paletteInput).toBeVisible();

    // Close by calling the app's esc function directly (Escape key can be unreliable in Playwright)
    await page.evaluate(() => { window.esc(); });
    await page.waitForTimeout(300);
    await expect(cmdPalette).not.toBeVisible({ timeout: 5000 });
  });

  test('keyboard shortcut ? shows help', async ({ page }) => {
    // Ensure no input is focused so the shortcut fires
    await page.click('.main');
    await page.waitForTimeout(200);

    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(500);

    // The help/shortcut modal should appear
    const helpModal = page.locator('.cmd-palette, .modal-overlay, [data-testid="shortcut-help"]').first();
    await expect(helpModal).toBeVisible({ timeout: 5000 });
  });

  test('sidebar contains Archive and Weekly Review in DOM', async ({ page }) => {
    // Verify these nav items exist in the sidebar DOM (they may be below the fold)
    const archiveNav = page.locator('[data-view="archive"]');
    await expect(archiveNav).toBeAttached({ timeout: 5000 });

    const reviewNav = page.locator('[data-view="review"]');
    await expect(reviewNav).toBeAttached({ timeout: 5000 });

    // Verify text content
    await expect(archiveNav).toContainText('Archive');
    await expect(reviewNav).toContainText('Weekly Review');
  });
});
