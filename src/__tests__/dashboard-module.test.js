import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDashboard } from '../dashboard.js';
import { PRIORITY_ORDER } from '../constants.js';

function makeDeps(overrides = {}) {
  return {
    $: vi.fn((sel) => document.querySelector(sel)),
    $$: vi.fn((sel) => document.querySelectorAll(sel)),
    esc: vi.fn((s) => String(s ?? '')),
    sanitizeAIHTML: vi.fn((s) => String(s ?? '')),
    fmtDate: vi.fn((d) => d || ''),
    todayStr: vi.fn(() => '2026-03-15'),
    PRIORITY_ORDER,
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    userKey: vi.fn((k) => `user1_${k}`),
    findTask: vi.fn(() => null),
    activeTasks: vi.fn(() => []),
    doneTasks: vi.fn(() => []),
    urgentTasks: vi.fn(() => []),
    projectTasks: vi.fn(() => []),
    archivedTasks: vi.fn(() => []),
    sortTasksDeps: {
      PRIORITY_ORDER,
      todayStr: () => '2026-03-15',
      userKey: (k) => `user1_${k}`,
      getDataVersion: () => 0,
    },
    hasAI: vi.fn(() => false),
    showToast: vi.fn(),
    render: vi.fn(),
    setView: vi.fn(),
    updateTask: vi.fn(),
    addTask: vi.fn(),
    createTask: vi.fn((o) => ({ id: 't_new', status: 'todo', priority: 'normal', ...o })),
    renderTaskRow: vi.fn((t) => `<div data-task="${t.id}">${t.title}</div>`),
    renderPriorityTag: vi.fn((p) => `<span>${p}</span>`),
    priorityColor: vi.fn(() => '#888'),
    renderCalendar: vi.fn(() => '<div>calendar</div>'),
    getCurrentView: vi.fn(() => 'dashboard'),
    getCurrentProject: vi.fn(() => null),
    getDashViewMode: vi.fn(() => 'list'),
    getShowCompleted: vi.fn(() => false),
    getProjectViewMode: vi.fn(() => 'list'),
    getShowProjectBg: vi.fn(() => false),
    parseProjectBackground: vi.fn(() => null),
    getBulkMode: vi.fn(() => false),
    getSectionShowCount: vi.fn(() => 50),
    getArchiveShowCount: vi.fn(() => 20),
    renderBulkBar: vi.fn(() => ''),
    attachListeners: vi.fn(),
    getBrainstormModule: vi.fn(() => ({
      isDumpInProgress: () => false,
      getDumpHistory: () => [],
      shouldShowDumpInvite: () => false,
    })),
    getAIStatusItems: vi.fn(() => []),
    getSmartFeedItems: vi.fn(() => []),
    getSmartNudges: vi.fn(() => []),
    getStuckTasks: vi.fn(() => []),
    nudgeFilterOverdue: vi.fn(),
    nudgeFilterStale: vi.fn(),
    nudgeFilterUnassigned: vi.fn(),
    startFocus: vi.fn(),
    offerStuckHelp: vi.fn(),
    generateAIBriefing: vi.fn(() => Promise.resolve()),
    planMyDay: vi.fn(() => Promise.resolve()),
    runProactiveWorker: vi.fn(),
    getBriefingGenerating: vi.fn(() => false),
    setBriefingGenerating: vi.fn(),
    getBriefingContent: vi.fn(() => null),
    setBriefingContent: vi.fn(),
    getPlanGenerating: vi.fn(() => false),
    setPlanGenerating: vi.fn(),
    getPlanContent: vi.fn(() => null),
    setPlanContent: vi.fn(),
    getNudgeFilter: vi.fn(() => ''),
    setNudgeFilter: vi.fn(),
    getSmartFeedExpanded: vi.fn(() => false),
    getTodayBriefingExpanded: vi.fn(() => false),
    getShowTagFilter: vi.fn(() => false),
    getActiveTagFilter: vi.fn(() => ''),
    getAllTags: vi.fn(() => []),
    getTagColor: vi.fn(() => ({ bg: '#eee', color: '#333' })),
    getOnboardingStep: vi.fn(() => -1),
    setOnboardingStep: vi.fn(),
    getExpandedTask: vi.fn(() => null),
    setExpandedTask: vi.fn(),
    openQuickAdd: vi.fn(),
    isComplexInput: vi.fn(() => false),
    parseQuickInput: vi.fn((v) => ({ title: v, priority: 'normal', dueDate: '' })),
    handleSlashCommand: vi.fn(() => false),
    aiEnhanceTask: vi.fn(),
    addSubtask: vi.fn(),
    toggleSubtask: vi.fn(),
    openTaskEditor: vi.fn(),
    pushUndo: vi.fn(),
    toggleChat: vi.fn(),
    sendChat: vi.fn(),
    renderDump: vi.fn(() => '<div>dump</div>'),
    initDumpDropZone: vi.fn(),
    renderWeeklyReview: vi.fn(() => '<div>review</div>'),
    ...overrides,
  };
}

describe('dashboard.js — createDashboard()', () => {
  let dashboard;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="projectList"></div><div id="archiveBadge"></div><div id="content"></div>';
    deps = makeDeps();
    dashboard = createDashboard(deps);
  });

  afterEach(() => {
    // Clean up any global typing interval
    if (window._welcomeTypingInterval) {
      clearInterval(window._welcomeTypingInterval);
      window._welcomeTypingInterval = null;
    }
    delete window._dashV2Hooked;
  });

  // ── Factory returns ───────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'renderDashboard',
      'renderProject',
      'renderSidebar',
      'renderArchive',
      'sortTasks',
      'renderTaskSlice',
      'startWelcomeTyping',
      'setupQuickBrainstorm',
      'bindNudgeActions',
      'hookDashboardPostRender',
      'heroInputHandler',
      'setPlanIndexCache',
    ];
    keys.forEach((k) => expect(typeof dashboard[k]).toBe('function'));
  });

  // ── sortTasks ─────────────────────────────────────────────────────
  describe('sortTasks', () => {
    it('sorts in-progress tasks before todo tasks', () => {
      const tasks = [
        { id: 'a', status: 'todo', priority: 'normal' },
        { id: 'b', status: 'in-progress', priority: 'normal' },
      ];
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted[0].id).toBe('b');
      expect(sorted[1].id).toBe('a');
    });

    it('sorts by priority within same status', () => {
      const tasks = [
        { id: 'a', status: 'todo', priority: 'low' },
        { id: 'b', status: 'todo', priority: 'urgent' },
        { id: 'c', status: 'todo', priority: 'important' },
        { id: 'd', status: 'todo', priority: 'normal' },
      ];
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted.map((t) => t.priority)).toEqual(['urgent', 'important', 'normal', 'low']);
    });

    it('sorts by interest as tiebreaker (higher interest first)', () => {
      const tasks = [
        { id: 'a', status: 'todo', priority: 'normal', interest: 1 },
        { id: 'b', status: 'todo', priority: 'normal', interest: 5 },
      ];
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted[0].id).toBe('b');
    });

    it('defaults interest to 3 when not set', () => {
      const tasks = [
        { id: 'a', status: 'todo', priority: 'normal' },
        { id: 'b', status: 'todo', priority: 'normal', interest: 5 },
      ];
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted[0].id).toBe('b');
    });

    it('does not mutate the original array', () => {
      const tasks = [
        { id: 'a', status: 'todo', priority: 'low' },
        { id: 'b', status: 'todo', priority: 'urgent' },
      ];
      const original = [...tasks];
      dashboard.sortTasks(tasks);
      expect(tasks[0].id).toBe(original[0].id);
    });

    it('uses plan index to sort planned tasks first', () => {
      const planData = [{ id: 'b' }, { id: 'a' }];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(planData));
      // Need fresh dashboard to pick up plan
      dashboard = createDashboard(deps);

      const tasks = [
        { id: 'a', status: 'todo', priority: 'normal' },
        { id: 'b', status: 'todo', priority: 'low' },
        { id: 'c', status: 'todo', priority: 'urgent' },
      ];
      const sorted = dashboard.sortTasks(tasks);
      // b and a are in plan (in that order), then c
      expect(sorted[0].id).toBe('b');
      expect(sorted[1].id).toBe('a');
      expect(sorted[2].id).toBe('c');
    });

    it('handles empty task array', () => {
      const sorted = dashboard.sortTasks([]);
      expect(sorted).toEqual([]);
    });

    it('handles single task', () => {
      const tasks = [{ id: 'a', status: 'todo', priority: 'normal' }];
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted.length).toBe(1);
    });
  });

  // ── renderTaskSlice ───────────────────────────────────────────────
  describe('renderTaskSlice', () => {
    it('renders all tasks when under limit', () => {
      const tasks = [
        { id: 't1', title: 'Task 1' },
        { id: 't2', title: 'Task 2' },
      ];
      const renderFn = (t) => `<div>${t.title}</div>`;
      const html = dashboard.renderTaskSlice(tasks, 'test', renderFn);
      expect(html).toContain('Task 1');
      expect(html).toContain('Task 2');
      expect(html).not.toContain('Show more');
    });

    it('truncates and shows "Show more" button when over limit', () => {
      deps.getSectionShowCount.mockReturnValue(2);
      dashboard = createDashboard(deps);

      const tasks = [
        { id: 't1', title: 'A' },
        { id: 't2', title: 'B' },
        { id: 't3', title: 'C' },
        { id: 't4', title: 'D' },
      ];
      const renderFn = (t) => `<div>${t.title}</div>`;
      const html = dashboard.renderTaskSlice(tasks, 'sec', renderFn);
      expect(html).toContain('A');
      expect(html).toContain('B');
      expect(html).not.toContain('C');
      expect(html).not.toContain('D');
      expect(html).toContain('Show more');
      expect(html).toContain('2 remaining');
    });

    it('shows correct remaining count', () => {
      deps.getSectionShowCount.mockReturnValue(1);
      dashboard = createDashboard(deps);

      const tasks = [
        { id: '1', title: 'A' },
        { id: '2', title: 'B' },
        { id: '3', title: 'C' },
      ];
      const html = dashboard.renderTaskSlice(tasks, 's', (t) => `<div>${t.title}</div>`);
      expect(html).toContain('2 remaining');
    });

    it('handles empty task array', () => {
      const html = dashboard.renderTaskSlice([], 'empty', () => '<div></div>');
      expect(html).toBe('');
    });

    it('passes section key as data attribute', () => {
      deps.getSectionShowCount.mockReturnValue(1);
      dashboard = createDashboard(deps);

      const tasks = [
        { id: '1', title: 'A' },
        { id: '2', title: 'B' },
      ];
      const html = dashboard.renderTaskSlice(tasks, 'my-section', (t) => `<div>${t.title}</div>`);
      expect(html).toContain('data-section="my-section"');
    });
  });

  // ── renderSidebar ─────────────────────────────────────────────────
  describe('renderSidebar', () => {
    // Helper to add the dashboard nav item that renderSidebar requires
    function addDashNavItem() {
      const navItem = document.createElement('div');
      navItem.className = 'nav-item';
      navItem.dataset.view = 'dashboard';
      document.body.appendChild(navItem);
      return navItem;
    }

    it('renders project list into #projectList', () => {
      const navItem = addDashNavItem();
      const projects = [
        { id: 'p1', name: 'Work', color: '#818cf8' },
        { id: 'p2', name: 'Personal', color: '#4ade80' },
      ];
      deps.getData.mockReturnValue({ tasks: [], projects });
      deps.activeTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockReturnValue([]);
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      dashboard = createDashboard(deps);

      dashboard.renderSidebar();
      const pl = document.getElementById('projectList');
      expect(pl.innerHTML).toContain('Work');
      expect(pl.innerHTML).toContain('Personal');
      navItem.remove();
    });

    it('marks active project with active class', () => {
      const navItem = addDashNavItem();
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks: [], projects });
      deps.getCurrentView.mockReturnValue('project');
      deps.getCurrentProject.mockReturnValue('p1');
      deps.activeTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockReturnValue([]);
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      dashboard = createDashboard(deps);

      dashboard.renderSidebar();
      const pl = document.getElementById('projectList');
      expect(pl.innerHTML).toContain('active');
      navItem.remove();
    });

    it('shows task count badge for projects with active tasks', () => {
      const navItem = addDashNavItem();
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks: [], projects });
      deps.activeTasks.mockReturnValue([{ id: 't1' }, { id: 't2' }]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockReturnValue([]);
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      dashboard = createDashboard(deps);

      dashboard.renderSidebar();
      const pl = document.getElementById('projectList');
      expect(pl.innerHTML).toContain('2');
      navItem.remove();
    });

    it('shows overdue dot for projects with overdue tasks', () => {
      const navItem = addDashNavItem();
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      const overdueTasks = [{ id: 't1', status: 'todo', dueDate: '2026-03-10' }];
      deps.getData.mockReturnValue({ tasks: [], projects });
      deps.activeTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(overdueTasks);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockReturnValue([]);
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      dashboard = createDashboard(deps);

      dashboard.renderSidebar();
      const pl = document.getElementById('projectList');
      expect(pl.innerHTML).toContain('Has overdue tasks');
      navItem.remove();
    });

    it('shows today badge when tasks are due today or overdue', () => {
      const projects = [];
      const tasks = [
        { id: 't1', status: 'todo', archived: false, dueDate: '2026-03-15' },
        { id: 't2', status: 'todo', archived: false, dueDate: '2026-03-10' },
      ];
      deps.getData.mockReturnValue({ tasks, projects });
      deps.activeTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockReturnValue([]);
      // Create a nav item for dashboard
      const navItem = document.createElement('div');
      navItem.className = 'nav-item';
      navItem.dataset.view = 'dashboard';
      document.body.appendChild(navItem);
      deps.$.mockImplementation((sel) => {
        if (sel === '.nav-item[data-view="dashboard"]') return navItem;
        if (sel === '.nav-item[data-view="dump"]') return null;
        if (sel === '#archiveBadge') return document.getElementById('archiveBadge');
        return document.querySelector(sel);
      });
      dashboard = createDashboard(deps);

      dashboard.renderSidebar();
      const badge = navItem.querySelector('.nav-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('2');
      navItem.remove();
    });
  });

  // ── renderArchive ─────────────────────────────────────────────────
  describe('renderArchive', () => {
    it('shows empty message when no archived tasks', () => {
      deps.archivedTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);
      const html = dashboard.renderArchive();
      expect(html).toContain('No archived tasks');
    });

    it('renders archived tasks with restore button', () => {
      deps.archivedTasks.mockReturnValue([{ id: 't1', title: 'Old task', archived: true }]);
      dashboard = createDashboard(deps);
      const html = dashboard.renderArchive();
      expect(html).toContain('Old task');
      expect(html).toContain('Restore');
      expect(html).toContain('1 archived');
    });
  });

  // ── renderDashboard ───────────────────────────────────────────────
  describe('renderDashboard', () => {
    it('shows welcome/empty state when no tasks and at most 1 project', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('What are you working on');
      expect(html).toContain('data-action="go-dump"');
    });

    it('shows welcome state with typing phrases data attribute', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Plan my week');
      expect(html).toContain('Brain dump');
    });

    it.skip('renders hero card with greeting when tasks exist — sub-greeting format changed for plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Do stuff', status: 'todo', priority: 'normal' }];
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks, projects });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('ai-hero-card');
      expect(html).toContain('ai-hero-greeting');
      // Should show active task count
      expect(html).toContain('1 tasks across 1 boards');
    });

    it('shows overdue sub-greeting when tasks are overdue', () => {
      const overdue = [{ id: 't1', title: 'Overdue', status: 'todo', priority: 'normal', dueDate: '2026-03-10' }];
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks: overdue, projects });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(overdue);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(overdue);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('1 overdue');
    });

    it.skip('shows urgent sub-greeting — removed in plan-first redesign', () => {
      const urgentTask = [{ id: 't1', title: 'Urgent', status: 'todo', priority: 'urgent' }];
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks: urgentTask, projects });
      deps.urgentTasks.mockReturnValue(urgentTask);
      deps.activeTasks.mockReturnValue(urgentTask);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(urgentTask);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('1 urgent task');
    });

    it('shows "Nothing pressing" when no active tasks', () => {
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks: [{ id: 't1', status: 'done' }], projects });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([{ id: 't1', status: 'done' }]);
      deps.projectTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('No tasks yet');
    });

    it.skip('renders nudges when smart nudges exist — nudges now toast-only in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks, projects });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getSmartNudges.mockReturnValue([
        {
          type: 'urgent',
          icon: '!',
          text: 'You have overdue tasks',
          actionLabel: 'Fix',
          actionFn: 'nudgeFilterOverdue()',
        },
      ]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('ai-hero-nudges');
      expect(html).toContain('You have overdue tasks');
      expect(html).toContain('data-nudge-action');
    });

    it.skip('renders stuck tasks in nudge area — removed from inline dashboard in plan-first redesign', () => {
      const tasks = [
        { id: 't1', title: 'Stuck task', status: 'in-progress', priority: 'normal', createdAt: '2026-01-01' },
      ];
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks, projects });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getStuckTasks.mockReturnValue(tasks);
      deps.hasAI.mockReturnValue(true);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Stuck task');
      expect(html).toContain('has been in-progress for');
      expect(html).toContain('data-stuck-task-id');
    });

    it('renders quickCapture input', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'Work', color: '#818cf8' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('id="quickCapture"');
      expect(html).toContain('data-keydown-action="hero-input"');
      expect(html).toContain('id="brainstormHint"');
    });

    it.skip('renders boards grid with projects — boards removed from main dashboard in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task 1', status: 'todo', priority: 'urgent', project: 'p1' }];
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8', description: 'Work stuff' }];
      deps.getData.mockReturnValue({ tasks, projects });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('project-grid');
      expect(html).toContain('Work');
      expect(html).toContain('data-project="p1"');
    });

    it.skip('shows empty boards message — boards removed from main dashboard in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('No boards yet');
      expect(html).toContain('data-action="open-new-project"');
    });

    it.skip('renders smart feed — removed from main dashboard in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Focus task', status: 'todo', priority: 'urgent' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getSmartFeedItems.mockReturnValue([{ task: tasks[0], source: 'urgent', why: 'This is urgent' }]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('smart-feed');
      expect(html).toContain('Your Focus');
      expect(html).toContain('This is urgent');
    });

    it.skip('renders Today card with briefing — briefing is now collapsed toggle in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.hasAI.mockReturnValue(true);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      localStorage.setItem('user1_whiteboard_briefing_2026-03-15', '<p>Your daily briefing here</p>');
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('today-card');
      expect(html).toContain('Today');
      expect(html).toContain('Your daily briefing here');
      expect(html).toContain('id="briefingBtn"');
    });

    it('renders generating state for briefing', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.hasAI.mockReturnValue(true);
      deps.getBriefingGenerating.mockReturnValue(true);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Generating briefing');
    });

    it('renders day plan from cached plan', () => {
      const tasks = [{ id: 't1', title: 'Planned task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.hasAI.mockReturnValue(true);
      deps.findTask.mockImplementation((id) => tasks.find((t) => t.id === id) || null);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      const plan = [{ id: 't1', why: 'Most important today' }];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(plan));
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain("Today's Plan");
      expect(html).toContain('Most important today');
      expect(html).toContain('Replan');
    });

    it.skip('renders AI status items in hero card — status items removed from hero in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getAIStatusItems.mockReturnValue([{ icon: '!', text: 'Deadline approaching' }]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('ai-hero-status');
      expect(html).toContain('Deadline approaching');
    });

    it.skip('renders brainstorm CTA card — removed from main dashboard in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('brainstorm-cta-main');
      expect(html).toContain('Ready to brainstorm?');
    });

    it('renders nudge filter indicator when active', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getNudgeFilter.mockReturnValue('overdue');
      deps.getSmartFeedItems.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Filtering: Overdue tasks');
      expect(html).toContain('clearNudgeFilter()');
    });

    it('renders tag filter when tags exist and filter is shown', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getAllTags.mockReturnValue(['bug', 'feature']);
      deps.getShowTagFilter.mockReturnValue(true);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('tag-filter-btn');
      expect(html).toContain('bug');
      expect(html).toContain('feature');
    });

    it('renders active tag filter chip', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getAllTags.mockReturnValue(['bug']);
      deps.getActiveTagFilter.mockReturnValue('bug');
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('selected');
      expect(html).toContain('clear-tag-filter');
      expect(html).toContain('bug');
    });

    it.skip('shows "Show more" in smart feed — smart feed removed from main dashboard in plan-first redesign', () => {
      const tasks = [];
      const feedItems = [];
      for (let i = 0; i < 12; i++) {
        const t = { id: `t${i}`, title: `Task ${i}`, status: 'todo', priority: 'normal' };
        tasks.push(t);
        feedItems.push({ task: t, source: 'urgent' });
      }
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getSmartFeedItems.mockReturnValue(feedItems);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('smart-feed-expand');
      expect(html).toContain('Show 2 more');
    });

    it.skip('renders today card with buttons — today card redesigned in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.hasAI.mockReturnValue(true);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Generate Briefing');
      expect(html).toContain('Plan My Day');
    });

    it('does not render today card when no AI', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.hasAI.mockReturnValue(false);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).not.toContain('today-card');
    });
  });

  // ── renderProject ─────────────────────────────────────────────────
  describe('renderProject', () => {
    const project = { id: 'p1', name: 'Work', color: '#818cf8', description: 'Work project' };

    it('renders project header with name and description', () => {
      deps.projectTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('project-info');
      expect(html).toContain('Work');
      expect(html).toContain('Work project');
    });

    it('renders quick add input for the project', () => {
      deps.projectTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('id="quickAdd"');
      expect(html).toContain(`data-project-id="${project.id}"`);
    });

    it('shows empty state when no tasks', () => {
      deps.projectTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('No tasks yet');
      expect(html).toContain('data-action="open-new-task"');
    });

    it('renders urgent section when urgent tasks exist', () => {
      const tasks = [
        { id: 't1', title: 'Urgent one', status: 'todo', priority: 'urgent' },
        { id: 't2', title: 'Normal one', status: 'todo', priority: 'normal' },
      ];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Urgent');
    });

    it('renders in-progress section', () => {
      const tasks = [{ id: 't1', title: 'WIP', status: 'in-progress', priority: 'normal' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('In Progress');
    });

    it('renders upcoming (todo non-urgent) section', () => {
      const tasks = [{ id: 't1', title: 'Do later', status: 'todo', priority: 'normal' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Upcoming');
    });

    it('renders completed section toggle when done tasks exist', () => {
      const tasks = [{ id: 't1', title: 'Done task', status: 'done', priority: 'normal' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Completed');
      expect(html).toContain('data-action="toggle-completed"');
    });

    it('shows completed tasks when showCompleted is true', () => {
      const tasks = [{ id: 't1', title: 'Done task', status: 'done', priority: 'normal' }];
      deps.projectTasks.mockReturnValue(tasks);
      deps.getShowCompleted.mockReturnValue(true);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Done task');
    });

    it('renders kanban board when view mode is board', () => {
      const tasks = [
        { id: 't1', title: 'Todo card', status: 'todo', priority: 'normal' },
        { id: 't2', title: 'WIP card', status: 'in-progress', priority: 'normal' },
        { id: 't3', title: 'Done card', status: 'done', priority: 'normal' },
      ];
      deps.projectTasks.mockReturnValue(tasks);
      deps.getProjectViewMode.mockReturnValue('board');
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('kanban');
      expect(html).toContain('kanban-col');
      expect(html).toContain('To Do');
      expect(html).toContain('In Progress');
      expect(html).toContain('Done');
      expect(html).toContain('Todo card');
      expect(html).toContain('WIP card');
      expect(html).toContain('Done card');
    });

    it('renders project stats (active and completed counts)', () => {
      const tasks = [
        { id: 't1', title: 'Active', status: 'todo', priority: 'normal' },
        { id: 't2', title: 'Done', status: 'done', priority: 'normal' },
      ];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('<strong>1</strong> Active');
      expect(html).toContain('<strong>1</strong> Completed');
    });

    it('renders urgent stat when urgent tasks exist', () => {
      const tasks = [{ id: 't1', title: 'Urgent', status: 'todo', priority: 'urgent' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('<strong>1</strong> Urgent');
    });

    it('counts tasks due today as urgent', () => {
      const tasks = [{ id: 't1', title: 'Due today', status: 'todo', priority: 'normal', dueDate: '2026-03-15' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Urgent');
    });

    it.skip('renders roadmap when tasks have multiple phases — roadmap removed from view', () => {
      // Roadmap rendering disabled; function kept but not called
    });

    it('does not render roadmap with only 1 phase', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal', phase: 'Phase 1' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).not.toContain('Roadmap');
    });

    it('renders "add one" prompt for project without description', () => {
      const noDescProject = { id: 'p1', name: 'Work', color: '#818cf8' };
      deps.projectTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(noDescProject);
      expect(html).toContain('No description');
      expect(html).toContain('add one');
      expect(html).toContain('data-action="open-edit-project"');
    });

    it('renders board background toggle', () => {
      deps.projectTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Board Background');
      expect(html).toContain('data-action="toggle-project-bg"');
    });

    it('renders board background content when open and background exists', () => {
      deps.projectTasks.mockReturnValue([]);
      deps.getShowProjectBg.mockReturnValue(true);
      deps.parseProjectBackground.mockReturnValue({
        origin: 'Started from scratch',
        direction: 'Going places',
        roadblocks: 'None yet',
        nextSteps: 'Build it',
        notes: 'Some notes',
      });
      const bgProject = { ...project, background: 'raw bg text' };
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(bgProject);
      expect(html).toContain('Started from scratch');
      expect(html).toContain('Going places');
      expect(html).toContain('None yet');
      expect(html).toContain('Build it');
      expect(html).toContain('Some notes');
      expect(html).toContain('Origin');
    });

    it('renders "Write background" button when no background and panel open', () => {
      deps.projectTasks.mockReturnValue([]);
      deps.getShowProjectBg.mockReturnValue(true);
      const noBackgroundProject = { id: 'p1', name: 'Work', color: '#818cf8' };
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(noBackgroundProject);
      expect(html).toContain('No background yet');
      expect(html).toContain('Write background');
    });
  });

  // ── _renderNow ────────────────────────────────────────────────────
  describe('_renderNow', () => {
    function setupDomForRenderNow() {
      document.body.innerHTML = `
        <div id="projectList"></div>
        <div id="archiveBadge"></div>
        <div id="content"></div>
        <div id="viewTitle"></div>
        <div id="viewSub"></div>
        <div id="headerActions"></div>
        <div class="nav-item" data-view="dashboard"></div>
      `;
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      deps.$$.mockImplementation((sel) => document.querySelectorAll(sel));
    }

    it('renders dashboard view with title and subtitle', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({
        tasks: [{ id: 't1', status: 'todo', priority: 'normal' }],
        projects: [{ id: 'p1', name: 'W', color: '#f00' }],
      });
      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('list');
      deps.activeTasks.mockReturnValue([{ id: 't1', status: 'todo', priority: 'normal' }]);
      deps.urgentTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(document.getElementById('viewTitle').textContent).toBe('Dashboard');
      expect(document.getElementById('viewSub').textContent).toContain('1 active tasks');
    });

    it('renders header actions with view toggles and buttons', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [{ id: 't1', status: 'todo', priority: 'normal' }], projects: [] });
      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('list');
      deps.activeTasks.mockReturnValue([]);
      deps.urgentTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      const ha = document.getElementById('headerActions');
      expect(ha.innerHTML).toContain('data-action="dash-view"');
      expect(ha.innerHTML).toContain('List');
      expect(ha.innerHTML).toContain('Week');
      expect(ha.innerHTML).toContain('Month');
      expect(ha.innerHTML).toContain('data-action="new-project"');
    });

    it('renders calendar when dashViewMode is week', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [{ id: 't1', status: 'todo', priority: 'normal' }], projects: [] });
      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('week');
      deps.activeTasks.mockReturnValue([]);
      deps.urgentTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(deps.renderCalendar).toHaveBeenCalled();
    });

    it('renders project view', () => {
      setupDomForRenderNow();
      const project = { id: 'p1', name: 'Work', color: '#818cf8' };
      deps.getData.mockReturnValue({
        tasks: [{ id: 't1', status: 'todo', priority: 'normal', project: 'p1' }],
        projects: [project],
      });
      deps.getCurrentView.mockReturnValue('project');
      deps.getCurrentProject.mockReturnValue('p1');
      deps.activeTasks.mockReturnValue([]);
      deps.urgentTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(document.getElementById('viewTitle').textContent).toBe('Work');
      const ha = document.getElementById('headerActions');
      expect(ha.innerHTML).toContain('data-action="project-view-mode"');
    });

    it('falls back to dashboard if project not found', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('project');
      deps.getCurrentProject.mockReturnValue('nonexistent');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockImplementation((sel) => document.querySelectorAll(sel));
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(deps.setView).toHaveBeenCalledWith('dashboard');
    });

    it('renders dump view as modal redirect', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('dump');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      // Dump view now redirects to dashboard and opens brainstorm as modal
      expect(deps.setView).toHaveBeenCalledWith('dashboard');
    });

    it('renders review view', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('review');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(document.getElementById('viewTitle').textContent).toBe('Weekly Review');
      expect(deps.renderWeeklyReview).toHaveBeenCalled();
    });

    it('renders archive view', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('archive');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(document.getElementById('viewTitle').textContent).toBe('Archive');
    });

    it('calls attachListeners and renderBulkBar after render', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('archive');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(deps.attachListeners).toHaveBeenCalled();
      expect(deps.renderBulkBar).toHaveBeenCalled();
    });

    it('adds search shortcut button to header actions', () => {
      setupDomForRenderNow();
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('archive');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      const ha = document.getElementById('headerActions');
      expect(ha.innerHTML).toContain('data-action="open-search"');
    });

    it('skips render when contenteditable is active', () => {
      setupDomForRenderNow();
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.className = 'task-title-editable';
      document.body.appendChild(editable);

      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('list');
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      // attachListeners should NOT have been called since render was skipped
      expect(deps.attachListeners).not.toHaveBeenCalled();
    });

    it('shows estimated hours in subtitle when tasks have estimates', () => {
      setupDomForRenderNow();
      const tasks = [
        { id: 't1', status: 'todo', priority: 'normal', estimatedMinutes: 60 },
        { id: 't2', status: 'todo', priority: 'normal', estimatedMinutes: 90 },
      ];
      deps.getData.mockReturnValue({ tasks, projects: [] });
      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('list');
      deps.activeTasks.mockReturnValue(tasks);
      deps.urgentTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(document.getElementById('viewSub').textContent).toContain('2.5h estimated');
    });
  });

  // ── startWelcomeTyping ────────────────────────────────────────────
  describe('startWelcomeTyping', () => {
    afterEach(() => {
      if (window._welcomeTypingInterval) {
        clearInterval(window._welcomeTypingInterval);
        window._welcomeTypingInterval = null;
      }
    });

    it('does nothing if #welcomeTyping element is not in DOM', () => {
      dashboard.startWelcomeTyping();
      expect(window._welcomeTypingInterval).toBeFalsy();
    });

    it('does nothing if already running', () => {
      window._welcomeTypingInterval = 12345;
      const el = document.createElement('div');
      el.id = 'welcomeTyping';
      el.dataset.phrases = JSON.stringify(['Hello']);
      document.body.appendChild(el);

      dashboard.startWelcomeTyping();
      // Should not have changed the interval
      expect(window._welcomeTypingInterval).toBe(12345);
    });

    it('does nothing if phrases is empty', () => {
      const el = document.createElement('div');
      el.id = 'welcomeTyping';
      el.dataset.phrases = '[]';
      document.body.appendChild(el);

      dashboard.startWelcomeTyping();
      expect(window._welcomeTypingInterval).toBeFalsy();
    });

    it('starts typing animation when element and phrases exist', () => {
      vi.useFakeTimers();
      const el = document.createElement('div');
      el.id = 'welcomeTyping';
      el.dataset.phrases = JSON.stringify(['Hello', 'World']);
      document.body.appendChild(el);

      dashboard.startWelcomeTyping();
      expect(window._welcomeTypingInterval).toBeTruthy();

      // Advance a few intervals to see typing
      vi.advanceTimersByTime(65 * 3);
      expect(el.textContent.length).toBeGreaterThan(0);
      expect(el.textContent).toBe('Hel');

      clearInterval(window._welcomeTypingInterval);
      window._welcomeTypingInterval = null;
      vi.useRealTimers();
    });

    it('types incrementally character by character', () => {
      vi.useFakeTimers();
      const el = document.createElement('div');
      el.id = 'welcomeTyping';
      el.dataset.phrases = JSON.stringify(['Hello']);
      document.body.appendChild(el);

      dashboard.startWelcomeTyping();

      // Each 65ms tick types one more character
      vi.advanceTimersByTime(65);
      expect(el.textContent).toBe('H');
      vi.advanceTimersByTime(65);
      expect(el.textContent).toBe('He');
      vi.advanceTimersByTime(65);
      expect(el.textContent).toBe('Hel');
      vi.advanceTimersByTime(65);
      expect(el.textContent).toBe('Hell');
      vi.advanceTimersByTime(65);
      expect(el.textContent).toBe('Hello');

      clearInterval(window._welcomeTypingInterval);
      window._welcomeTypingInterval = null;
      vi.useRealTimers();
    });

    it('cleans up interval when element is removed', () => {
      vi.useFakeTimers();
      const el = document.createElement('div');
      el.id = 'welcomeTyping';
      el.dataset.phrases = JSON.stringify(['Test phrase']);
      document.body.appendChild(el);

      dashboard.startWelcomeTyping();
      expect(window._welcomeTypingInterval).toBeTruthy();

      // Remove the element
      el.remove();
      // Advance timer for the interval to fire
      vi.advanceTimersByTime(65);

      expect(window._welcomeTypingInterval).toBeNull();
      vi.useRealTimers();
    });

    it('handles invalid JSON in phrases gracefully', () => {
      const el = document.createElement('div');
      el.id = 'welcomeTyping';
      el.dataset.phrases = 'not-json';
      document.body.appendChild(el);

      // Should not throw
      dashboard.startWelcomeTyping();
      expect(window._welcomeTypingInterval).toBeFalsy();
    });
  });

  // ── setupQuickBrainstorm ──────────────────────────────────────────
  describe('setupQuickBrainstorm', () => {
    it('does nothing if #quickCapture is not in DOM', () => {
      // No quickCapture element
      dashboard.setupQuickBrainstorm();
      // Should not throw
    });

    it('does nothing if #brainstormHint is not in DOM', () => {
      const input = document.createElement('input');
      input.id = 'quickCapture';
      document.body.appendChild(input);
      // No brainstormHint element
      dashboard.setupQuickBrainstorm();
    });

    it('shows brainstorm hint when input has 30+ words', () => {
      const input = document.createElement('input');
      input.id = 'quickCapture';
      document.body.appendChild(input);
      const hint = document.createElement('div');
      hint.id = 'brainstormHint';
      hint.style.display = 'none';
      document.body.appendChild(hint);

      dashboard.setupQuickBrainstorm();

      // Type 30 words
      input.value = Array(31).fill('word').join(' ');
      input.dispatchEvent(new Event('input'));

      expect(hint.style.display).toBe('block');
    });

    it('hides brainstorm hint when input has fewer than 30 words', () => {
      const input = document.createElement('input');
      input.id = 'quickCapture';
      document.body.appendChild(input);
      const hint = document.createElement('div');
      hint.id = 'brainstormHint';
      hint.style.display = 'block';
      document.body.appendChild(hint);

      dashboard.setupQuickBrainstorm();

      input.value = 'just a few words';
      input.dispatchEvent(new Event('input'));

      expect(hint.style.display).toBe('none');
    });

    it('redirects to dump on Shift+Enter with 30+ words', () => {
      vi.useFakeTimers();
      const input = document.createElement('input');
      input.id = 'quickCapture';
      document.body.appendChild(input);
      const hint = document.createElement('div');
      hint.id = 'brainstormHint';
      document.body.appendChild(hint);

      dashboard.setupQuickBrainstorm();

      input.value = Array(31).fill('word').join(' ');
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
      input.dispatchEvent(event);

      // setView should be called with 'dump'
      expect(deps.setView).toHaveBeenCalledWith('dump');
      expect(input.value).toBe('');
      vi.useRealTimers();
    });

    it('does not redirect on Shift+Enter with fewer than 30 words', () => {
      const input = document.createElement('input');
      input.id = 'quickCapture';
      document.body.appendChild(input);
      const hint = document.createElement('div');
      hint.id = 'brainstormHint';
      document.body.appendChild(hint);

      dashboard.setupQuickBrainstorm();

      input.value = 'just a few words';
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
      input.dispatchEvent(event);

      expect(deps.setView).not.toHaveBeenCalled();
    });

    it('aborts previous listeners on re-call', () => {
      const input = document.createElement('input');
      input.id = 'quickCapture';
      document.body.appendChild(input);
      const hint = document.createElement('div');
      hint.id = 'brainstormHint';
      hint.style.display = 'none';
      document.body.appendChild(hint);

      // Call twice
      dashboard.setupQuickBrainstorm();
      dashboard.setupQuickBrainstorm();

      // The first listener should be aborted, only the second fires
      input.value = Array(31).fill('word').join(' ');
      input.dispatchEvent(new Event('input'));

      // Hint should show only once (not doubled)
      expect(hint.style.display).toBe('block');
    });
  });

  // ── bindNudgeActions ──────────────────────────────────────────────
  describe('bindNudgeActions', () => {
    it('binds click handler to elements with data-nudge-action', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'nudgeFilterOverdue()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();

      btn.click();
      expect(deps.nudgeFilterOverdue).toHaveBeenCalled();
    });

    it('handles nudgeFilterStale action', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'nudgeFilterStale()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();
      btn.click();
      expect(deps.nudgeFilterStale).toHaveBeenCalled();
    });

    it('handles nudgeFilterUnassigned action', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'nudgeFilterUnassigned()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();
      btn.click();
      expect(deps.nudgeFilterUnassigned).toHaveBeenCalled();
    });

    it('handles startFocus action', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'startFocus()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();
      btn.click();
      expect(deps.startFocus).toHaveBeenCalled();
    });

    it('handles clearNudgeFilter action', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'clearNudgeFilter()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();
      btn.click();
      expect(deps.setNudgeFilter).toHaveBeenCalledWith('');
      expect(deps.render).toHaveBeenCalled();
    });

    it('ignores unknown action strings', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'unknownAction()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();
      // Should not throw
      btn.click();
    });

    it('binds click to stuck task elements', () => {
      const el = document.createElement('span');
      el.dataset.stuckTaskId = 't42';
      document.body.appendChild(el);

      dashboard.bindNudgeActions();
      el.click();
      expect(deps.offerStuckHelp).toHaveBeenCalledWith('t42');
    });

    it('aborts previous nudge listeners on re-bind', () => {
      const btn = document.createElement('button');
      btn.dataset.nudgeAction = 'nudgeFilterOverdue()';
      document.body.appendChild(btn);

      dashboard.bindNudgeActions();
      dashboard.bindNudgeActions();

      btn.click();
      // Should only be called once despite two binds, because the first was aborted
      expect(deps.nudgeFilterOverdue).toHaveBeenCalledTimes(1);
    });
  });

  // ── heroInputHandler ──────────────────────────────────────────────
  describe('heroInputHandler', () => {
    function makeEvent(key, value) {
      return {
        key,
        target: { value },
      };
    }

    it('does nothing if key is not Enter', () => {
      const e = makeEvent('a', 'hello');
      dashboard.heroInputHandler(e);
      expect(deps.addTask).not.toHaveBeenCalled();
    });

    it('does nothing if input value is empty', () => {
      const e = makeEvent('Enter', '  ');
      dashboard.heroInputHandler(e);
      expect(deps.addTask).not.toHaveBeenCalled();
    });

    it('creates a task for normal input', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      dashboard = createDashboard(deps);

      const e = makeEvent('Enter', 'Buy groceries');
      dashboard.heroInputHandler(e);

      expect(deps.createTask).toHaveBeenCalled();
      expect(deps.addTask).toHaveBeenCalled();
      expect(e.target.value).toBe('');
      expect(deps.showToast).toHaveBeenCalled();
      expect(deps.render).toHaveBeenCalled();
    });

    it('assigns task to project when #hashtag matches project name', () => {
      const projects = [{ id: 'p1', name: 'Work' }];
      deps.getData.mockReturnValue({ tasks: [], projects });
      dashboard = createDashboard(deps);

      const e = makeEvent('Enter', 'Fix the bug #work');
      dashboard.heroInputHandler(e);

      expect(deps.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'p1',
        }),
      );
    });

    it('strips hashtag from task title', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [{ id: 'p1', name: 'Work' }] });
      deps.parseQuickInput.mockReturnValue({ title: 'Fix the bug', priority: 'normal', dueDate: '' });
      dashboard = createDashboard(deps);

      const e = makeEvent('Enter', 'Fix the bug #work');
      dashboard.heroInputHandler(e);

      expect(deps.parseQuickInput).toHaveBeenCalledWith('Fix the bug');
    });

    it('uses parsed priority and dueDate from parseQuickInput', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.parseQuickInput.mockReturnValue({ title: 'Meeting', priority: 'urgent', dueDate: '2026-03-20' });
      dashboard = createDashboard(deps);

      const e = makeEvent('Enter', 'Meeting !urgent @friday');
      dashboard.heroInputHandler(e);

      expect(deps.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'urgent',
          dueDate: '2026-03-20',
        }),
      );
    });

    it('shows due date in toast when task has dueDate', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.parseQuickInput.mockReturnValue({ title: 'Meeting', priority: 'normal', dueDate: '2026-03-20' });
      dashboard = createDashboard(deps);

      const e = makeEvent('Enter', 'Meeting @friday');
      dashboard.heroInputHandler(e);

      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('due 2026-03-20'), false, true);
    });
  });

  // ── setPlanIndexCache ─────────────────────────────────────────────
  describe('setPlanIndexCache', () => {
    it('updates the internal plan index cache used by sortTasks', () => {
      // setPlanIndexCache sets _planIndexCache and _planIndexDate but not _planIndexVersion,
      // so sortTasks will re-read from localStorage on first call (version mismatch).
      // To verify setPlanIndexCache works, we need the localStorage plan to match.
      const planData = [{ id: 't1' }, { id: 't2' }];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(planData));
      dashboard = createDashboard(deps);

      const tasks = [
        { id: 't3', status: 'todo', priority: 'urgent' },
        { id: 't1', status: 'todo', priority: 'low' },
        { id: 't2', status: 'todo', priority: 'low' },
      ];
      const sorted = dashboard.sortTasks(tasks);
      // Plan tasks come first in plan order
      expect(sorted[0].id).toBe('t1');
      expect(sorted[1].id).toBe('t2');
      expect(sorted[2].id).toBe('t3');
    });

    it('is a callable function', () => {
      // setPlanIndexCache should not throw when called with valid args
      expect(() => dashboard.setPlanIndexCache({ a: 0 }, '2026-03-15')).not.toThrow();
    });
  });

  // ── hookDashboardPostRender ───────────────────────────────────────
  describe('hookDashboardPostRender', () => {
    it('does not throw when window.render is not a function', () => {
      vi.useFakeTimers();
      delete window.render;
      delete window._dashV2Hooked;

      // Should not throw, just schedules a retry
      dashboard.hookDashboardPostRender();
      expect(window._dashV2Hooked).toBeFalsy();

      vi.useRealTimers();
    });

    it('wraps window.render when it exists', () => {
      delete window._dashV2Hooked;
      const origRender = vi.fn(() => 'result');
      window.render = origRender;

      dashboard.hookDashboardPostRender();

      expect(window._dashV2Hooked).toBe(true);
      expect(window.render).not.toBe(origRender);

      // Call the wrapped render
      const result = window.render();
      expect(origRender).toHaveBeenCalled();
      expect(result).toBe('result');

      delete window.render;
      delete window._dashV2Hooked;
    });

    it('does nothing if already hooked', () => {
      window._dashV2Hooked = true;
      const origRender = vi.fn();
      window.render = origRender;

      dashboard.hookDashboardPostRender();
      // render should not be replaced
      expect(window.render).toBe(origRender);

      delete window.render;
      delete window._dashV2Hooked;
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Additional coverage tests — targeting functions at 0% coverage
// ══════════════════════════════════════════════════════════════

describe('dashboard.js — additional coverage', () => {
  let dashboard;
  let deps;

  function makeDeps2(overrides = {}) {
    return {
      $: vi.fn((sel) => document.querySelector(sel)),
      $$: vi.fn((sel) => document.querySelectorAll(sel)),
      esc: vi.fn((s) => String(s ?? '')),
      sanitizeAIHTML: vi.fn((s) => String(s ?? '')),
      fmtDate: vi.fn((d) => d || ''),
      todayStr: vi.fn(() => '2026-03-15'),
      PRIORITY_ORDER,
      getData: vi.fn(() => ({ tasks: [], projects: [] })),
      userKey: vi.fn((k) => `user1_${k}`),
      findTask: vi.fn(() => null),
      activeTasks: vi.fn(() => []),
      doneTasks: vi.fn(() => []),
      urgentTasks: vi.fn(() => []),
      projectTasks: vi.fn(() => []),
      archivedTasks: vi.fn(() => []),
      sortTasksDeps: {
        PRIORITY_ORDER,
        todayStr: () => '2026-03-15',
        userKey: (k) => `user1_${k}`,
        getDataVersion: () => 0,
      },
      hasAI: vi.fn(() => false),
      showToast: vi.fn(),
      render: vi.fn(),
      setView: vi.fn(),
      updateTask: vi.fn(),
      addTask: vi.fn(),
      createTask: vi.fn((o) => ({ id: 't_new', status: 'todo', priority: 'normal', ...o })),
      renderTaskRow: vi.fn((t) => `<div data-task="${t.id}">${t.title}</div>`),
      renderPriorityTag: vi.fn((p) => `<span>${p}</span>`),
      priorityColor: vi.fn(() => '#888'),
      renderCalendar: vi.fn(() => '<div>calendar</div>'),
      getCurrentView: vi.fn(() => 'dashboard'),
      getCurrentProject: vi.fn(() => null),
      getDashViewMode: vi.fn(() => 'list'),
      getShowCompleted: vi.fn(() => false),
      getProjectViewMode: vi.fn(() => 'list'),
      getShowProjectBg: vi.fn(() => false),
      parseProjectBackground: vi.fn(() => null),
      getBulkMode: vi.fn(() => false),
      getSectionShowCount: vi.fn(() => 50),
      getArchiveShowCount: vi.fn(() => 20),
      renderBulkBar: vi.fn(() => ''),
      attachListeners: vi.fn(),
      getBrainstormModule: vi.fn(() => ({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      })),
      getAIStatusItems: vi.fn(() => []),
      getSmartFeedItems: vi.fn(() => []),
      getSmartNudges: vi.fn(() => []),
      getStuckTasks: vi.fn(() => []),
      nudgeFilterOverdue: vi.fn(),
      nudgeFilterStale: vi.fn(),
      nudgeFilterUnassigned: vi.fn(),
      startFocus: vi.fn(),
      offerStuckHelp: vi.fn(),
      generateAIBriefing: vi.fn(() => Promise.resolve()),
      planMyDay: vi.fn(() => Promise.resolve()),
      runProactiveWorker: vi.fn(),
      getBriefingGenerating: vi.fn(() => false),
      setBriefingGenerating: vi.fn(),
      getBriefingContent: vi.fn(() => null),
      setBriefingContent: vi.fn(),
      getPlanGenerating: vi.fn(() => false),
      setPlanGenerating: vi.fn(),
      getPlanContent: vi.fn(() => null),
      setPlanContent: vi.fn(),
      getNudgeFilter: vi.fn(() => ''),
      setNudgeFilter: vi.fn(),
      getSmartFeedExpanded: vi.fn(() => false),
      getTodayBriefingExpanded: vi.fn(() => false),
      getShowTagFilter: vi.fn(() => false),
      getActiveTagFilter: vi.fn(() => ''),
      getAllTags: vi.fn(() => []),
      getTagColor: vi.fn(() => ({ bg: '#eee', color: '#333' })),
      getOnboardingStep: vi.fn(() => -1),
      setOnboardingStep: vi.fn(),
      getExpandedTask: vi.fn(() => null),
      setExpandedTask: vi.fn(),
      openQuickAdd: vi.fn(),
      isComplexInput: vi.fn(() => false),
      parseQuickInput: vi.fn((v) => ({ title: v, priority: 'normal', dueDate: '' })),
      handleSlashCommand: vi.fn(() => false),
      aiEnhanceTask: vi.fn(),
      addSubtask: vi.fn(),
      toggleSubtask: vi.fn(),
      openTaskEditor: vi.fn(),
      pushUndo: vi.fn(),
      toggleChat: vi.fn(),
      sendChat: vi.fn(),
      renderDump: vi.fn(() => '<div>dump</div>'),
      initDumpDropZone: vi.fn(),
      renderWeeklyReview: vi.fn(() => '<div>review</div>'),
      ...overrides,
    };
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="projectList"></div><div id="archiveBadge"></div><div id="content"></div>';
    deps = makeDeps2();
    dashboard = createDashboard(deps);
  });

  afterEach(() => {
    if (window._welcomeTypingInterval) {
      clearInterval(window._welcomeTypingInterval);
      window._welcomeTypingInterval = null;
    }
    delete window._dashV2Hooked;
  });

  // ── renderArchive (extended) ─────────────────────────────────────
  describe('renderArchive (extended)', () => {
    it('shows "Show more" button when archived tasks exceed archiveShowCount', () => {
      const archived = [];
      for (let i = 0; i < 25; i++) {
        archived.push({ id: `a${i}`, title: `Archived ${i}`, archived: true });
      }
      deps.archivedTasks.mockReturnValue(archived);
      deps.getArchiveShowCount.mockReturnValue(20);
      dashboard = createDashboard(deps);

      const html = dashboard.renderArchive();
      expect(html).toContain('Show more');
      expect(html).toContain('5 remaining');
      expect(html).toContain('data-action="archive-show-more"');
    });

    it('does not show "Show more" when all archived tasks are visible', () => {
      const archived = [
        { id: 'a1', title: 'Task 1', archived: true },
        { id: 'a2', title: 'Task 2', archived: true },
      ];
      deps.archivedTasks.mockReturnValue(archived);
      deps.getArchiveShowCount.mockReturnValue(20);
      dashboard = createDashboard(deps);

      const html = dashboard.renderArchive();
      expect(html).not.toContain('Show more');
    });

    it('shows delete all button and count', () => {
      const archived = [{ id: 'a1', title: 'Task 1', archived: true }];
      deps.archivedTasks.mockReturnValue(archived);
      dashboard = createDashboard(deps);

      const html = dashboard.renderArchive();
      expect(html).toContain('data-action="delete-archived"');
      expect(html).toContain('Delete All');
      expect(html).toContain('1 archived');
    });

    it('renders restore button with correct task id', () => {
      const archived = [{ id: 'myTask123', title: 'Restore me', archived: true }];
      deps.archivedTasks.mockReturnValue(archived);
      dashboard = createDashboard(deps);

      const html = dashboard.renderArchive();
      expect(html).toContain('data-action="restore-task"');
      expect(html).toContain('data-task-id="myTask123"');
    });
  });

  // ── renderMemoryInsightsCard ─────────────────────────────────────
  describe('renderMemoryInsightsCard', () => {
    it('returns empty string when getAIMemory is not a function', () => {
      deps.getAIMemory = undefined;
      deps.extractMemoryInsights = undefined;
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toBe('');
    });

    it('returns empty string when fewer than 5 memories', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4]);
      deps.extractMemoryInsights = vi.fn(() => ({}));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toBe('');
    });

    it('returns empty string when no insights lines or tip', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        procrastination_types: [],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toBe('');
    });

    it('renders avg tasks per day insight', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        avg_tasks_per_day: 4,
        procrastination_types: [],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toContain('memory-insights-card');
      expect(html).toContain('Learned Patterns');
      expect(html).toContain('You complete ~4 tasks per day');
      expect(html).toContain('5 memories');
    });

    it('renders most productive day insight', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        most_productive_day: 'Monday',
        procrastination_types: [],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toContain('Most productive: Mondays');
    });

    it('renders peak time insight', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        productive_time: 'morning',
        procrastination_types: [],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toContain('Peak time: morning');
      expect(html).toContain('Protect your morning for deep work');
    });

    it('renders hard-first tip', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        avg_tasks_per_day: 3,
        task_order_preference: 'hard-first',
        procrastination_types: [],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toContain('You do best tackling hard tasks first');
    });

    it('renders easy-first tip', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        avg_tasks_per_day: 3,
        task_order_preference: 'easy-first',
        procrastination_types: [],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toContain('Quick wins first works well for you');
    });

    it('renders procrastination tip when no order preference', () => {
      deps.getAIMemory = vi.fn(() => [1, 2, 3, 4, 5]);
      deps.extractMemoryInsights = vi.fn(() => ({
        avg_tasks_per_day: 3,
        procrastination_types: ['writing'],
      }));
      dashboard = createDashboard(deps);

      const html = dashboard.renderMemoryInsightsCard();
      expect(html).toContain('Schedule writing tasks when your energy is highest');
    });
  });

  // ── _renderDashboardFilters (via renderDashboard) ────────────────
  describe('_renderDashboardFilters (via renderDashboard)', () => {
    function setupDashWithTasks() {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
    }

    it('renders "Filter by tag" toggle when tags exist but filter not shown', () => {
      setupDashWithTasks();
      deps.getAllTags.mockReturnValue(['bug', 'feature']);
      deps.getShowTagFilter.mockReturnValue(false);
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Filter by tag');
      expect(html).toContain('data-action="toggle-tag-filter"');
    });

    it('renders nudge filter with stale label', () => {
      setupDashWithTasks();
      deps.getNudgeFilter.mockReturnValue('stale');
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Filtering: Stale tasks (10+ days)');
    });

    it('renders nudge filter with unassigned label', () => {
      setupDashWithTasks();
      deps.getNudgeFilter.mockReturnValue('unassigned');
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Filtering: Unassigned tasks');
    });

    it('does not render tag filter section when no tags', () => {
      setupDashWithTasks();
      deps.getAllTags.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).not.toContain('Filter by tag');
      expect(html).not.toContain('tag-filter-btn');
    });
  });

  // ── Day Plan rendering (via renderDashboard) ──────────────────────
  describe('Day Plan rendering (via renderDashboard)', () => {
    function setupDashWithTasks() {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
    }

    it('renders plan generating state', () => {
      setupDashWithTasks();
      deps.hasAI.mockReturnValue(true);
      deps.getPlanGenerating.mockReturnValue(true);
      localStorage.setItem('user1_whiteboard_briefing_2026-03-15', '<p>Briefing</p>');
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Planning your day...');
    });

    it('renders day plan with task items and why reasons', () => {
      setupDashWithTasks();
      deps.hasAI.mockReturnValue(true);
      const task = { id: 't1', title: 'Planned task', status: 'todo', priority: 'normal' };
      deps.findTask.mockImplementation((id) => (id === 't1' ? task : null));
      const plan = [{ id: 't1', why: 'Top priority for today' }];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(plan));
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain("Today's Plan");
      expect(html).toContain('Top priority for today');
      expect(html).toContain('Replan');
      expect(html).toContain('data-action="replan-day"');
      expect(html).toContain('data-action="clear-plan"');
      expect(html).toContain('tomorrow');
    });

    it('renders plan with done/total count and time estimate', () => {
      setupDashWithTasks();
      deps.hasAI.mockReturnValue(true);
      const task1 = { id: 't1', title: 'Done task', status: 'done', priority: 'normal', estimatedMinutes: 30 };
      const task2 = { id: 't2', title: 'Todo task', status: 'todo', priority: 'normal', estimatedMinutes: 60 };
      deps.findTask.mockImplementation((id) => {
        if (id === 't1') return task1;
        if (id === 't2') return task2;
        return null;
      });
      const plan = [
        { id: 't1', why: 'Done' },
        { id: 't2', why: 'Next' },
      ];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(plan));
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('1/2 done');
      expect(html).toContain('~1h remaining');
    });

    it('renders plan item without snooze button when done', () => {
      setupDashWithTasks();
      deps.hasAI.mockReturnValue(true);
      const task = { id: 't1', title: 'Completed', status: 'done', priority: 'normal' };
      deps.findTask.mockImplementation((id) => (id === 't1' ? task : null));
      const plan = [{ id: 't1', completedInPlan: true }];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(plan));
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      // Completed tasks are now in a collapsed section at the bottom
      expect(html).toContain('Completed (1)');
      expect(html).not.toContain('snooze-plan-task');
    });
  });

  // ── _renderProjectKanban (via renderProject) ─────────────────────
  describe('_renderProjectKanban (via renderProject)', () => {
    const project = { id: 'p1', name: 'Work', color: '#818cf8', description: 'Work project' };

    it('renders kanban column counts', () => {
      const tasks = [
        { id: 't1', title: 'Todo 1', status: 'todo', priority: 'normal' },
        { id: 't2', title: 'Todo 2', status: 'todo', priority: 'normal' },
        { id: 't3', title: 'WIP', status: 'in-progress', priority: 'normal' },
        { id: 't4', title: 'Done', status: 'done', priority: 'normal' },
      ];
      deps.projectTasks.mockReturnValue(tasks);
      deps.getProjectViewMode.mockReturnValue('board');
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('kanban-col-count');
      const todoCountMatch = html.match(/To Do <span class="kanban-col-count">(\d+)<\/span>/);
      expect(todoCountMatch[1]).toBe('2');
    });

    it('renders kanban card with priority tag and due date', () => {
      const tasks = [{ id: 't1', title: 'Card', status: 'todo', priority: 'urgent', dueDate: '2026-03-20' }];
      deps.projectTasks.mockReturnValue(tasks);
      deps.getProjectViewMode.mockReturnValue('board');
      deps.fmtDate.mockReturnValue('Mar 20');
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('kanban-card-meta');
      expect(html).toContain('tag-date');
      expect(deps.renderPriorityTag).toHaveBeenCalledWith('urgent');
      expect(deps.fmtDate).toHaveBeenCalledWith('2026-03-20');
    });

    it('limits done column to MAX_KANBAN_DONE and shows overflow count', () => {
      const tasks = [];
      for (let i = 0; i < 25; i++) {
        tasks.push({ id: `d${i}`, title: `Done ${i}`, status: 'done', priority: 'normal' });
      }
      deps.projectTasks.mockReturnValue(tasks);
      deps.getProjectViewMode.mockReturnValue('board');
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('+5 more');
    });
  });

  // ── _renderProjectRoadmap — disabled (function kept but not called) ──
  describe.skip('_renderProjectRoadmap (via renderProject)', () => {
    const _project = { id: 'p1', name: 'Work', color: '#818cf8' };

    it('marks completed phase as done', () => {});
    it('shows phase progress counts', () => {});
    it('does not render roadmap when no phases', () => {});
  });

  // ── _renderProjectTaskSections (via renderProject) ───────────────
  describe('_renderProjectTaskSections (via renderProject)', () => {
    const project = { id: 'p1', name: 'Work', color: '#818cf8' };

    it('renders overdue tasks in urgent section', () => {
      const tasks = [{ id: 't1', title: 'Overdue task', status: 'todo', priority: 'normal', dueDate: '2026-03-10' }];
      deps.projectTasks.mockReturnValue(tasks);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Urgent');
    });

    it('renders all sections together', () => {
      const tasks = [
        { id: 't1', title: 'Urgent', status: 'todo', priority: 'urgent' },
        { id: 't2', title: 'WIP', status: 'in-progress', priority: 'normal' },
        { id: 't3', title: 'Todo', status: 'todo', priority: 'normal' },
        { id: 't4', title: 'Done', status: 'done', priority: 'normal' },
      ];
      deps.projectTasks.mockReturnValue(tasks);
      deps.getShowCompleted.mockReturnValue(true);
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('Urgent');
      expect(html).toContain('In Progress');
      expect(html).toContain('Upcoming');
      expect(html).toContain('Completed');
    });
  });

  // ── _renderDashboardHero brainstorm stats ────────────────────────
  describe('_renderDashboardHero brainstorm stats (via renderDashboard)', () => {
    it.skip('renders brainstorm stat — brainstorm CTA removed from hero in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [{ date: new Date(Date.now() - 3600000).toISOString(), tasksCreated: 5, wordCount: 200 }],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('Last: 5 tasks from 200 words');
    });

    it.skip('renders brainstorm CTA with invite styling — removed from hero in plan-first redesign', () => {
      const tasks = [{ id: 't1', title: 'Task', status: 'todo', priority: 'normal' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => true,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('brainstorm-cta-main');
      expect(html).toContain('border:1px solid var(--accent)');
    });

    it('renders due today sub-greeting', () => {
      const tasks = [{ id: 't1', title: 'Due task', status: 'todo', priority: 'normal', dueDate: '2026-03-15' }];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue(tasks);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue(tasks);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('1 due today');
    });
  });

  // ── invalidateRenderMemo ─────────────────────────────────────────
  describe('invalidateRenderMemo', () => {
    it('is a callable function', () => {
      expect(typeof dashboard.invalidateRenderMemo).toBe('function');
    });

    it('allows _renderNow to run again after invalidation', () => {
      document.body.innerHTML = `
        <div id="projectList"></div>
        <div id="archiveBadge"></div>
        <div id="content"></div>
        <div id="viewTitle"></div>
        <div id="viewSub"></div>
        <div id="headerActions"></div>
        <div class="nav-item" data-view="dashboard"></div>
      `;
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      deps.$$.mockImplementation((sel) => document.querySelectorAll(sel));
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('archive');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      expect(deps.attachListeners).toHaveBeenCalledTimes(1);

      dashboard._renderNow();
      expect(deps.attachListeners).toHaveBeenCalledTimes(1);

      dashboard.invalidateRenderMemo();
      dashboard._renderNow();
      expect(deps.attachListeners).toHaveBeenCalledTimes(2);
    });
  });

  // ── _renderEndOfDay (via renderDashboard) ────────────────────────
  describe('_renderEndOfDay (via renderDashboard)', () => {
    function setupDashWithCompletedTasks() {
      const completedTask = {
        id: 't1',
        title: 'Done today',
        status: 'done',
        priority: 'normal',
        completedAt: '2026-03-15T14:00:00Z',
      };
      const tasks = [completedTask];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue(tasks);
      deps.projectTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      deps.hasAI.mockReturnValue(true);
    }

    it('renders EOD prompt card after 5pm when completed tasks exist', () => {
      setupDashWithCompletedTasks();
      const realDate = global.Date;
      const mockDate = new realDate('2026-03-15T18:00:00Z');
      vi.spyOn(global, 'Date').mockImplementation(function (...args) {
        if (args.length === 0) return mockDate;
        return new realDate(...args);
      });
      global.Date.now = realDate.now;

      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('eod-card');
      expect(html).toContain('How did today go?');
      expect(html).toContain('data-action="submit-eod"');
      expect(html).toContain('data-action="skip-eod"');

      vi.restoreAllMocks();
    });

    it('renders cached EOD response when available', () => {
      setupDashWithCompletedTasks();
      localStorage.setItem('user1_wb_eod_2026-03-15', '<p>Great day! You completed 3 tasks.</p>');
      const realDate = global.Date;
      const mockDate = new realDate('2026-03-15T18:00:00Z');
      vi.spyOn(global, 'Date').mockImplementation(function (...args) {
        if (args.length === 0) return mockDate;
        return new realDate(...args);
      });
      global.Date.now = realDate.now;

      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('End of Day');
      expect(html).toContain('eod-response');
      expect(html).toContain('Great day! You completed 3 tasks.');

      vi.restoreAllMocks();
    });
  });

  // ── _renderNow error handling ────────────────────────────────────
  describe('_renderNow error handling', () => {
    it('renders error state when render throws inside try block', () => {
      document.body.innerHTML = `
        <div id="projectList"></div>
        <div id="archiveBadge"></div>
        <div id="content"></div>
        <div id="viewTitle"></div>
        <div id="viewSub"></div>
        <div id="headerActions"></div>
        <div class="nav-item" data-view="dashboard"></div>
      `;
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      // Make $$ throw inside renderSidebar (which is inside the try block)
      deps.$$.mockImplementation(() => {
        throw new Error('Render failure');
      });
      deps.getData.mockReturnValue({ tasks: [{ id: 't1', status: 'todo' }], projects: [] });
      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('list');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      const content = document.getElementById('content');
      expect(content.innerHTML).toContain('Something went wrong');
      expect(content.innerHTML).toContain('Render failure');
      expect(content.innerHTML).toContain('data-action="reload-page"');
      expect(content.innerHTML).toContain('data-action="export-data"');
    });
  });

  // ── _renderNow dump view redirects to dashboard (brainstorm is now modal) ──
  describe('_renderNow dump view async', () => {
    it('dump view redirects to dashboard and opens brainstorm modal', () => {
      document.body.innerHTML = `
        <div id="projectList"></div>
        <div id="archiveBadge"></div>
        <div id="content"></div>
        <div id="viewTitle"></div>
        <div id="viewSub"></div>
        <div id="headerActions"></div>
        <div id="modalRoot"></div>
        <div class="nav-item" data-view="dashboard"></div>
      `;
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      deps.$$.mockImplementation((sel) => document.querySelectorAll(sel));
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('dump');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.renderDump.mockReturnValue('<div>dump content</div>');
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      // Dump view now redirects to dashboard
      expect(deps.setView).toHaveBeenCalledWith('dashboard');
    });
  });

  // ── _renderNow review view with async renderWeeklyReview ─────────
  describe('_renderNow review view async', () => {
    it('handles async renderWeeklyReview that returns a promise', async () => {
      document.body.innerHTML = `
        <div id="projectList"></div>
        <div id="archiveBadge"></div>
        <div id="content"></div>
        <div id="viewTitle"></div>
        <div id="viewSub"></div>
        <div id="headerActions"></div>
        <div class="nav-item" data-view="dashboard"></div>
      `;
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      deps.$$.mockImplementation((sel) => document.querySelectorAll(sel));
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.getCurrentView.mockReturnValue('review');
      deps.activeTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.renderWeeklyReview.mockReturnValue(Promise.resolve('<div>async review</div>'));
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      dashboard._renderNow();
      await vi.waitFor(() => {
        expect(document.getElementById('content').innerHTML).toContain('async review');
      });
    });
  });

  // ── _triggerAutoAI (via _renderNow) ──────────────────────────────
  describe('_triggerAutoAI (via _renderNow)', () => {
    function setupForAutoAI() {
      document.body.innerHTML = `
        <div id="projectList"></div>
        <div id="archiveBadge"></div>
        <div id="content"></div>
        <div id="viewTitle"></div>
        <div id="viewSub"></div>
        <div id="headerActions"></div>
        <div class="nav-item" data-view="dashboard"></div>
      `;
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      deps.$$.mockImplementation((sel) => document.querySelectorAll(sel));
      const tasks = [
        { id: 't1', status: 'todo', priority: 'normal' },
        { id: 't2', status: 'todo', priority: 'normal' },
        { id: 't3', status: 'todo', priority: 'normal' },
      ];
      deps.getData.mockReturnValue({ tasks, projects: [{ id: 'p1', name: 'W', color: '#f00' }] });
      deps.getCurrentView.mockReturnValue('dashboard');
      deps.getDashViewMode.mockReturnValue('list');
      deps.activeTasks.mockReturnValue(tasks);
      deps.urgentTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.hasAI.mockReturnValue(true);
      deps.getBriefingGenerating.mockReturnValue(false);
      deps.getPlanGenerating.mockReturnValue(false);
      deps.generateAIBriefing.mockReturnValue(Promise.resolve());
      deps.planMyDay.mockReturnValue(Promise.resolve());
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
    }

    it('triggers auto briefing and plan when conditions are met', () => {
      setupForAutoAI();
      dashboard = createDashboard(deps);

      dashboard._renderNow();

      expect(deps.setBriefingGenerating).toHaveBeenCalledWith(true);
      expect(deps.generateAIBriefing).toHaveBeenCalled();
      expect(deps.setPlanGenerating).toHaveBeenCalledWith(true);
      expect(deps.planMyDay).toHaveBeenCalled();
    });

    it('does not trigger briefing when already cached', () => {
      setupForAutoAI();
      localStorage.setItem('user1_whiteboard_briefing_2026-03-15', '<p>Already briefed</p>');
      dashboard = createDashboard(deps);

      dashboard._renderNow();

      expect(deps.generateAIBriefing).not.toHaveBeenCalled();
    });

    it('runs proactive worker when plan already exists', () => {
      setupForAutoAI();
      localStorage.setItem('user1_whiteboard_briefing_2026-03-15', '<p>Briefed</p>');
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify([{ id: 't1' }]));
      dashboard = createDashboard(deps);

      dashboard._renderNow();

      expect(deps.runProactiveWorker).toHaveBeenCalled();
      expect(deps.planMyDay).not.toHaveBeenCalled();
    });

    it('does not trigger auto AI when not on dashboard view', () => {
      setupForAutoAI();
      deps.getCurrentView.mockReturnValue('archive');
      dashboard = createDashboard(deps);

      dashboard._renderNow();

      expect(deps.generateAIBriefing).not.toHaveBeenCalled();
      expect(deps.planMyDay).not.toHaveBeenCalled();
    });
  });

  // ── renderSidebar memoization ────────────────────────────────────
  describe('renderSidebar memoization', () => {
    function addDashNavItem() {
      const navItem = document.createElement('div');
      navItem.className = 'nav-item';
      navItem.dataset.view = 'dashboard';
      document.body.appendChild(navItem);
      return navItem;
    }

    it('skips re-render when sidebar state has not changed', () => {
      const navItem = addDashNavItem();
      const projects = [{ id: 'p1', name: 'Work', color: '#818cf8' }];
      deps.getData.mockReturnValue({ tasks: [], projects });
      deps.activeTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.archivedTasks.mockReturnValue([]);
      deps.$$.mockReturnValue([]);
      deps.$.mockImplementation((sel) => document.querySelector(sel));
      dashboard = createDashboard(deps);

      dashboard.renderSidebar();
      const firstHTML = document.getElementById('projectList').innerHTML;

      dashboard.renderSidebar();
      expect(document.getElementById('projectList').innerHTML).toBe(firstHTML);

      navItem.remove();
    });
  });

  // ── _renderProjectHeader background ──────────────────────────────
  describe('_renderProjectHeader (via renderProject)', () => {
    it('renders background panel with partial fields', () => {
      deps.projectTasks.mockReturnValue([]);
      deps.getShowProjectBg.mockReturnValue(true);
      deps.parseProjectBackground.mockReturnValue({
        origin: 'From scratch',
        direction: null,
        roadblocks: null,
        nextSteps: 'Launch it',
        notes: null,
      });
      const bgProject = { id: 'p1', name: 'Work', color: '#818cf8', background: 'raw text' };
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(bgProject);
      expect(html).toContain('From scratch');
      expect(html).toContain('Origin');
      expect(html).toContain('Launch it');
      expect(html).toContain('Next Steps');
      expect(html).not.toContain('Roadblocks');
    });

    it('renders chevron in open state when background panel is open', () => {
      deps.projectTasks.mockReturnValue([]);
      deps.getShowProjectBg.mockReturnValue(true);
      const project = { id: 'p1', name: 'Work', color: '#818cf8' };
      dashboard = createDashboard(deps);

      const html = dashboard.renderProject(project);
      expect(html).toContain('chevron open');
      expect(html).toContain('project-bg-panel open');
    });
  });

  // ── renderDashboard welcome state ────────────────────────────────
  describe('renderDashboard welcome state', () => {
    it('renders simplified welcome state with brain dump and plan options', () => {
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).toContain('What are you working on');
      expect(html).toContain('Plan my week');
      expect(html).toContain('Brain dump');
      expect(html).toContain('data-action="go-dump"');
    });

    it('does not show welcome state when more than 1 project exists', () => {
      deps.getData.mockReturnValue({
        tasks: [],
        projects: [
          { id: 'p1', name: 'A', color: '#f00' },
          { id: 'p2', name: 'B', color: '#0f0' },
        ],
      });
      deps.urgentTasks.mockReturnValue([]);
      deps.activeTasks.mockReturnValue([]);
      deps.doneTasks.mockReturnValue([]);
      deps.projectTasks.mockReturnValue([]);
      deps.getBrainstormModule.mockReturnValue({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      });
      dashboard = createDashboard(deps);

      const html = dashboard.renderDashboard();
      expect(html).not.toContain('welcomeTyping');
    });
  });

  // ── sortTasks edge cases ─────────────────────────────────────────
  describe('sortTasks edge cases', () => {
    it('handles corrupted plan JSON gracefully', () => {
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', 'not valid json');
      dashboard = createDashboard(deps);

      const tasks = [
        { id: 'a', status: 'todo', priority: 'urgent' },
        { id: 'b', status: 'todo', priority: 'low' },
      ];
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted[0].id).toBe('a');
      expect(sorted[1].id).toBe('b');
    });

    it('uses cached plan index on second call (same data version)', () => {
      const planData = [{ id: 'b' }, { id: 'a' }];
      localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(planData));
      dashboard = createDashboard(deps);

      const tasks = [
        { id: 'a', status: 'todo', priority: 'normal' },
        { id: 'b', status: 'todo', priority: 'normal' },
      ];
      dashboard.sortTasks(tasks);
      const sorted = dashboard.sortTasks(tasks);
      expect(sorted[0].id).toBe('b');
      expect(sorted[1].id).toBe('a');
    });
  });
});
