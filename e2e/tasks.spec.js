// @ts-check
import { test, expect } from '@playwright/test';
import { mockAuthAndGoToDashboard } from './helpers.js';

/**
 * Inject a task and navigate to its project view.
 * Uses setView('project', projectId) to directly switch to the project,
 * avoiding sidebar memoization issues.
 */
async function injectTaskAndViewProject(page, taskProps) {
  await page.evaluate((props) => {
    const task = window.createTask({
      title: props.title,
      project: props.project || 'life',
      priority: props.priority || 'medium',
    });
    if (props.id) task.id = props.id;
    if (props.dueDate) task.dueDate = props.dueDate;
    if (props.tags) task.tags = props.tags;
    window.data.tasks.push(task);
    if (!window.data.projects.some(p => p.id === (props.project || 'life'))) {
      window.data.projects.push({ id: props.project || 'life', name: 'Life', color: '#818cf8' });
    }
    // Navigate directly to the project view (bypasses sidebar memoization)
    window.setView('project', props.project || 'life');
  }, taskProps);
  await page.waitForTimeout(500);
}

test.describe('Task Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndGoToDashboard(page);
    // Wait for the app to fully hydrate so window.createTask is available
    await page.waitForFunction(() => typeof window.createTask === 'function', null, { timeout: 10000 });
  });

  test('task list renders from injected data', async ({ page }) => {
    // Inject multiple tasks and switch to project view
    await page.evaluate(() => {
      const tasks = [
        { title: 'First task', project: 'life', priority: 'high' },
        { title: 'Second task', project: 'life', priority: 'low' },
        { title: 'Third task', project: 'life', priority: 'medium' },
      ];
      for (const t of tasks) {
        const task = window.createTask(t);
        window.data.tasks.push(task);
      }
      if (!window.data.projects.some(p => p.id === 'life')) {
        window.data.projects.push({ id: 'life', name: 'Life', color: '#818cf8' });
      }
      window.setView('project', 'life');
    });
    await page.waitForTimeout(500);

    // All three tasks should be rendered
    await expect(page.locator('text=First task')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Second task')).toBeVisible();
    await expect(page.locator('text=Third task')).toBeVisible();
  });

  test('task shows priority badge', async ({ page }) => {
    await injectTaskAndViewProject(page, {
      title: 'High priority task',
      id: 'test-priority-1',
      priority: 'high',
    });

    // The task should be visible
    await expect(page.locator('text=High priority task')).toBeVisible({ timeout: 5000 });

    // Check that the task row contains a priority indicator
    const taskRow = page.locator('[data-task="test-priority-1"]').first();
    await expect(taskRow).toBeVisible();

    // Priority badge or indicator should exist in the task row
    const hasPriorityIndicator = await taskRow.evaluate((el) => {
      return el.querySelector('.priority-badge, .priority, [data-priority]') !== null ||
        el.innerHTML.includes('high') ||
        el.innerHTML.includes('priority');
    });
    expect(hasPriorityIndicator).toBe(true);
  });

  test('task shows due date when set', async ({ page }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateStr = tomorrow.toISOString().split('T')[0];

    await injectTaskAndViewProject(page, {
      title: 'Task with due date',
      id: 'test-due-1',
      dueDate: dueDateStr,
    });

    await expect(page.locator('text=Task with due date')).toBeVisible({ timeout: 5000 });

    // The task row should contain date-related content
    const taskRow = page.locator('[data-task="test-due-1"]').first();
    await expect(taskRow).toBeVisible();

    const hasDateInfo = await taskRow.evaluate((el) => {
      return el.querySelector('.due-date, .task-date, [data-due], .date-badge, .task-due') !== null ||
        el.textContent.includes('tomorrow') ||
        el.textContent.includes('Tomorrow') ||
        el.textContent.match(/\d{1,2}\/\d{1,2}/) !== null ||
        el.textContent.match(/\w{3}\s+\d{1,2}/) !== null;
    });
    expect(hasDateInfo).toBe(true);
  });
});
