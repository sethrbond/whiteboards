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

    const textarea = page.locator('#dumpText, textarea[placeholder*="brainstorm" i], textarea[placeholder*="paste" i], .dump-textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('quick capture input exists in project view', async ({ page }) => {
    await page.evaluate(() => {
      const task = window.createTask({ title: 'Test task for quick add', project: 'life', priority: 'medium' });
      window.data.tasks.push(task);
      if (!window.data.projects.some(p => p.id === 'life')) {
        window.data.projects.push({ id: 'life', name: 'Life', color: '#818cf8' });
      }
      window.setView('project', 'life');
    });
    await page.waitForTimeout(500);

    const quickAdd = page.locator('#quickAdd');
    await expect(quickAdd).toBeVisible({ timeout: 5000 });
  });

  test('command palette opens and contains search input', async ({ page }) => {
    // Use the app's openSearch function for reliability
    await page.evaluate(() => { window.openSearch(); });
    await page.waitForTimeout(300);

    const cmdPalette = page.locator('.cmd-palette').first();
    await expect(cmdPalette).toBeVisible({ timeout: 5000 });

    // Command palette should have a search input with placeholder
    const paletteInput = cmdPalette.locator('input').first();
    await expect(paletteInput).toBeVisible();

    // Should show command items
    const commands = cmdPalette.locator('.cmd-palette-item, .cmd-item, [data-action]');
    const count = await commands.count();
    expect(count).toBeGreaterThan(0);
  });

  test('settings panel opens', async ({ page }) => {
    await page.evaluate(() => { window.openSettings(); });
    await page.waitForTimeout(500);

    const settingsModal = page.locator('.modal-overlay').first();
    await expect(settingsModal).toBeVisible({ timeout: 5000 });
  });

  test('chat toggle button exists', async ({ page }) => {
    const chatToggle = page.locator('#chatToggle');
    await expect(chatToggle).toBeAttached();
  });
});
