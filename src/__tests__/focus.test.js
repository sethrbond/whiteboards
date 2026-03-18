import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFocusMode } from '../focus.js';

function makeDeps(overrides = {}) {
  return {
    $: vi.fn((sel) => document.querySelector(sel)),
    esc: vi.fn((s) => (s == null ? '' : String(s))),
    findTask: vi.fn(() => null),
    updateTask: vi.fn(),
    activeTasks: vi.fn(() => []),
    matchTask: vi.fn(() => null),
    showToast: vi.fn(),
    render: vi.fn(),
    hasAI: vi.fn(() => false),
    callAI: vi.fn(async () => ''),
    buildAIContext: vi.fn(() => ''),
    getAIMemory: vi.fn(() => []),
    PRIORITY_ORDER: { urgent: 0, important: 1, normal: 2, low: 3 },
    AI_PERSONA_SHORT: 'You are a test assistant.',
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    setModalTriggerEl: vi.fn(),
    userKey: vi.fn((k) => 'test_' + k),
    ...overrides,
  };
}

describe('focus.js — createFocusMode()', () => {
  let focus;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    deps = makeDeps();
    focus = createFocusMode(deps);
  });

  afterEach(() => {
    if (window._focusInterval) {
      clearInterval(window._focusInterval);
      window._focusInterval = null;
    }
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'startFocus',
      'openFocusView',
      'renderFocusOverlay',
      'completeFocusTask',
      'skipFocusTask',
      'closeFocus',
      'getFocusTask',
      'resetFocusState',
      'getFocusStats',
      'getFocusHistory',
      'logDistraction',
      'startBreakTimer',
      'endBreak',
      'setSessionGoal',
      'handleGoalPick',
      'handleGoalStart',
    ];
    keys.forEach((k) => expect(typeof focus[k]).toBe('function'));
  });

  // ── getFocusTask ────────────────────────────────────────────────────
  it('getFocusTask returns null initially', () => {
    expect(focus.getFocusTask()).toBeNull();
  });

  // ── resetFocusState ────────────────────────────────────────────────
  it('resetFocusState clears the focus task', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1', 'test reason');
    expect(focus.getFocusTask()).toBe('t_1');

    focus.resetFocusState();
    expect(focus.getFocusTask()).toBeNull();
  });

  // ── openFocusView ──────────────────────────────────────────────────
  it('openFocusView sets the focus task ID', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');
    expect(focus.getFocusTask()).toBe('t_1');
  });

  it('openFocusView calls setModalTriggerEl', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');
    expect(deps.setModalTriggerEl).toHaveBeenCalled();
  });

  it('openFocusView renders the overlay with the task title', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Write report', priority: 'normal' });
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    focus.openFocusView('t_1');
    expect(deps.esc).toHaveBeenCalledWith('Write report');
  });

  it('openFocusView stores the reason when provided', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1', 'This is urgent');
    expect(focus.getFocusTask()).toBe('t_1');
  });

  // ── closeFocus ─────────────────────────────────────────────────────
  it('closeFocus clears focus task and modal', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');
    expect(focus.getFocusTask()).toBe('t_1');

    focus.closeFocus();
    expect(focus.getFocusTask()).toBeNull();
    expect(document.getElementById('modalRoot').innerHTML).toBe('');
  });

  it('closeFocus clears the interval timer', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');
    expect(window._focusInterval).toBeTruthy();

    focus.closeFocus();
    expect(document.getElementById('modalRoot').innerHTML).toBe('');
  });

  // ── completeFocusTask ─────────────────────────────────────────────
  it('completeFocusTask marks the task as done', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');

    focus.completeFocusTask();
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
  });

  it('completeFocusTask shows a toast with the task title and duration', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Finish docs', priority: 'normal' });
    focus.openFocusView('t_1');

    focus.completeFocusTask();
    expect(deps.showToast).toHaveBeenCalled();
    const toastCall = deps.showToast.mock.calls.find((c) => c[0].includes('Finish docs'));
    expect(toastCall).toBeTruthy();
    // Should include duration info
    expect(toastCall[0]).toMatch(/\d+ min/);
  });

  it('completeFocusTask triggers render', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');
    deps.render.mockClear();

    focus.completeFocusTask();
    expect(deps.render).toHaveBeenCalled();
  });

  it('completeFocusTask clears focus state after completing', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    focus.openFocusView('t_1');

    focus.completeFocusTask();
    expect(focus.getFocusTask()).toBeNull();
  });

  // ── skipFocusTask ──────────────────────────────────────────────────
  it('skipFocusTask clears current focus task', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
    deps.activeTasks.mockReturnValue([]);
    focus.openFocusView('t_1');
    // Set session goal to bypass goal prompt
    focus.setSessionGoal(3);

    focus.skipFocusTask();
    expect(focus.getFocusTask()).toBeNull();
  });

  it('skipFocusTask adds current task to skipped list and picks next', () => {
    const task1 = { id: 't_1', title: 'Task 1', priority: 'normal' };
    const task2 = { id: 't_2', title: 'Task 2', priority: 'urgent', dueDate: '2026-03-15' };
    deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
    deps.activeTasks.mockReturnValue([task1, task2]);
    deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });
    focus.openFocusView('t_1');
    // Set session goal to bypass goal prompt
    focus.setSessionGoal(3);

    focus.skipFocusTask();
    // startFocus is called, which should filter out t_1 and pick t_2
    expect(focus.getFocusTask()).toBe('t_2');
  });

  // ── startFocus ─────────────────────────────────────────────────────
  it('startFocus shows session goal prompt first', async () => {
    const tasks = [{ id: 't_1', title: 'Task', priority: 'normal' }];
    deps.activeTasks.mockReturnValue(tasks);
    deps.findTask.mockReturnValue(tasks[0]);
    deps.getData.mockReturnValue({ tasks, projects: [] });

    await focus.startFocus();
    // Should render goal prompt, not task focus
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Focus Session');
    expect(modal.innerHTML).toContain('focus-goal-pick');
  });

  it('startFocus picks highest priority task without AI after goal set', async () => {
    const tasks = [
      { id: 't_1', title: 'Low task', priority: 'low' },
      { id: 't_2', title: 'Urgent task', priority: 'urgent', dueDate: '2026-03-15' },
      { id: 't_3', title: 'Normal task', priority: 'normal' },
    ];
    deps.activeTasks.mockReturnValue(tasks);
    deps.findTask.mockImplementation((id) => tasks.find((t) => t.id === id) || null);
    deps.getData.mockReturnValue({ tasks, projects: [] });

    // Set goal first
    focus.setSessionGoal(3);
    await focus.startFocus();
    expect(focus.getFocusTask()).toBe('t_2');
  });

  it('startFocus uses due date as tiebreaker for same priority', async () => {
    const tasks = [
      { id: 't_1', title: 'Later', priority: 'urgent', dueDate: '2026-04-01' },
      { id: 't_2', title: 'Sooner', priority: 'urgent', dueDate: '2026-03-16' },
    ];
    deps.activeTasks.mockReturnValue(tasks);
    deps.findTask.mockImplementation((id) => tasks.find((t) => t.id === id) || null);
    deps.getData.mockReturnValue({ tasks, projects: [] });

    focus.setSessionGoal(2);
    await focus.startFocus();
    expect(focus.getFocusTask()).toBe('t_2');
  });

  it('startFocus can filter by project ID', async () => {
    const tasks = [{ id: 't_1', title: 'Task', priority: 'normal', project: 'p_1' }];
    deps.activeTasks.mockReturnValue(tasks);
    deps.findTask.mockImplementation((id) => tasks.find((t) => t.id === id) || null);
    deps.getData.mockReturnValue({ tasks, projects: [] });

    focus.setSessionGoal(1);
    await focus.startFocus('p_1');
    expect(deps.activeTasks).toHaveBeenCalledWith('p_1');
  });

  // ── renderFocusOverlay ────────────────────────────────────────────
  it('renderFocusOverlay closes focus if task not found', () => {
    deps.findTask.mockReturnValue(null);
    focus.openFocusView('t_nonexistent');
    expect(focus.getFocusTask()).toBeNull();
  });

  it('renderFocusOverlay renders subtask count in bar', () => {
    const task = {
      id: 't_1',
      title: 'Build feature',
      priority: 'normal',
      subtasks: [
        { id: 'st_1', title: 'Design', done: true },
        { id: 'st_2', title: 'Implement', done: false },
        { id: 'st_3', title: 'Test', done: false },
      ],
    };
    deps.findTask.mockReturnValue(task);
    deps.getData.mockReturnValue({ tasks: [task], projects: [] });
    focus.openFocusView('t_1');
    const bar = document.getElementById('focusBar');
    expect(bar).toBeTruthy();
    expect(bar.innerHTML).toContain('1/3 subtasks');
  });

  // ── Timer tick countdown ──────────────────────────────────────────
  describe('focus timer', () => {
    it('starts an interval timer on openFocusView', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      focus.openFocusView('t_1');
      expect(window._focusInterval).toBeTruthy();
    });

    it('timer updates the focusTimer element', () => {
      vi.useFakeTimers();
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      focus.openFocusView('t_1');
      const timerEl = document.getElementById('focusTimer');
      expect(timerEl).toBeTruthy();
      vi.advanceTimersByTime(65000);
      expect(timerEl.textContent).toBe('1:05');
      vi.useRealTimers();
    });

    it('timer clears itself when focusTimer element is removed', () => {
      vi.useFakeTimers();
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      focus.openFocusView('t_1');
      const timerEl = document.getElementById('focusTimer');
      timerEl.remove();
      vi.advanceTimersByTime(2000);
      vi.useRealTimers();
    });

    it('closeFocus clears the interval', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      focus.openFocusView('t_1');
      const intervalId = window._focusInterval;
      expect(intervalId).toBeTruthy();
      focus.closeFocus();
      expect(document.getElementById('modalRoot').innerHTML).toBe('');
    });
  });

  // ── Focus mode UI rendering ───────────────────────────────────────
  describe('focus mode UI rendering', () => {
    it('renders project name when task has a project', () => {
      const task = { id: 't_1', title: 'My Task', priority: 'normal', project: 'p_1' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({
        tasks: [task],
        projects: [{ id: 'p_1', name: 'Work', color: '#818cf8' }],
      });
      focus.openFocusView('t_1');
      expect(deps.esc).toHaveBeenCalledWith('Work');
    });

    it('renders focus bar with task title', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal', notes: 'Some detailed notes' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.openFocusView('t_1');
      const bar = document.getElementById('focusBar');
      expect(bar).toBeTruthy();
      expect(deps.esc).toHaveBeenCalledWith('Task');
    });

    it('renders session progress when goal is set', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.setSessionGoal(4);
      focus.openFocusView('t_1');
      const bar = document.getElementById('focusBar');
      expect(bar).toBeTruthy();
      expect(bar.innerHTML).toContain('1/4');
    });

    it('does not render reason line when no reason provided', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.openFocusView('t_1');
      const escCalls = deps.esc.mock.calls.map((c) => c[0]);
      expect(escCalls).toContain('Task');
    });
  });

  // ── skipFocusTask resets skipped on empty ─────────────────────────
  describe('skipFocusTask — skip behavior', () => {
    it('resets skipped list when all tasks have been skipped', async () => {
      const task1 = { id: 't_1', title: 'Task 1', priority: 'normal' };
      deps.findTask.mockImplementation((id) => (id === 't_1' ? task1 : null));
      deps.activeTasks.mockReturnValue([task1]);
      deps.getData.mockReturnValue({ tasks: [task1], projects: [] });

      focus.setSessionGoal(3);
      focus.openFocusView('t_1');
      deps.activeTasks.mockReturnValue([task1]);
      focus.skipFocusTask();
      expect(deps.showToast).toHaveBeenCalledWith('No more tasks to focus on');
    });
  });

  // ── startFocus with AI ───────────────────────────────────────────
  describe('startFocus — AI picking', () => {
    it('uses AI to pick task when available', async () => {
      const task1 = { id: 't_1', title: 'Write report', priority: 'normal' };
      const task2 = { id: 't_2', title: 'Review PR', priority: 'urgent', dueDate: '2026-03-15' };
      deps.hasAI.mockReturnValue(true);
      deps.activeTasks.mockReturnValue([task1, task2]);
      deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
      deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });
      deps.callAI.mockResolvedValue(
        '{"title": "Review PR", "reason": "It is urgent", "estimatedMinutes": 15, "tip": "Start with the diff", "skippedNote": null}',
      );
      deps.matchTask.mockReturnValue(task2);

      focus.setSessionGoal(2);
      await focus.startFocus();
      expect(deps.callAI).toHaveBeenCalled();
      expect(focus.getFocusTask()).toBe('t_2');
    });

    it('falls back to priority sort when AI fails', async () => {
      const task1 = { id: 't_1', title: 'Low task', priority: 'low' };
      const task2 = { id: 't_2', title: 'Urgent task', priority: 'urgent', dueDate: '2026-03-15' };
      deps.hasAI.mockReturnValue(true);
      deps.activeTasks.mockReturnValue([task1, task2]);
      deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
      deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });
      deps.callAI.mockRejectedValue(new Error('API error'));

      focus.setSessionGoal(2);
      await focus.startFocus();
      expect(focus.getFocusTask()).toBe('t_2');
    });

    it('falls back when AI returns non-matching title', async () => {
      const task1 = { id: 't_1', title: 'Write code', priority: 'urgent', dueDate: '2026-03-15' };
      deps.hasAI.mockReturnValue(true);
      deps.activeTasks.mockReturnValue([task1]);
      deps.findTask.mockImplementation((id) => (id === 't_1' ? task1 : null));
      deps.getData.mockReturnValue({ tasks: [task1], projects: [] });
      deps.callAI.mockResolvedValue('{"title": "Nonexistent task", "reason": "test"}');
      deps.matchTask.mockReturnValue(null);

      focus.setSessionGoal(1);
      await focus.startFocus();
      expect(focus.getFocusTask()).toBe('t_1');
    });
  });

  // ── completeFocusTask when no focus task ─────────────────────────
  describe('completeFocusTask — edge cases', () => {
    it('completeFocusTask does not call updateTask when no focus task', () => {
      focus.completeFocusTask();
      expect(deps.updateTask).not.toHaveBeenCalled();
      expect(deps.render).toHaveBeenCalled();
    });
  });

  // ── AI coaching tip ──────────────────────────────────────────────
  describe('AI coaching tip', () => {
    it('does not request coaching tip when reason is provided', () => {
      deps.hasAI.mockReturnValue(true);
      const task = { id: 't_1', title: 'Write tests', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });

      focus.openFocusView('t_1', 'Already have a reason');
      expect(deps.callAI).not.toHaveBeenCalled();
    });
  });

  // ── startFocus priority sort tiebreakers ─────────────────────────
  describe('startFocus — fallback sort edge cases', () => {
    it('prefers task with due date over task without', async () => {
      const task1 = { id: 't_1', title: 'No date', priority: 'normal' };
      const task2 = { id: 't_2', title: 'Has date', priority: 'normal', dueDate: '2026-04-01' };
      deps.activeTasks.mockReturnValue([task1, task2]);
      deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
      deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });

      focus.setSessionGoal(1);
      await focus.startFocus();
      expect(focus.getFocusTask()).toBe('t_2');
    });

    it('sorts by due date for tasks with same priority', async () => {
      const task1 = { id: 't_1', title: 'Later', priority: 'normal', dueDate: '2026-05-01' };
      const task2 = { id: 't_2', title: 'Sooner', priority: 'normal', dueDate: '2026-03-20' };
      deps.activeTasks.mockReturnValue([task1, task2]);
      deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
      deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });

      focus.setSessionGoal(1);
      await focus.startFocus();
      expect(focus.getFocusTask()).toBe('t_2');
    });
  });

  // ── clearInterval on repeated openFocusView ──────────────────────
  describe('openFocusView — clears previous interval', () => {
    it('clears existing interval when opening new focus view', () => {
      const task1 = { id: 't_1', title: 'Task 1', priority: 'normal' };
      const task2 = { id: 't_2', title: 'Task 2', priority: 'normal' };
      deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
      deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });

      focus.openFocusView('t_1');
      const firstInterval = window._focusInterval;
      expect(firstInterval).toBeTruthy();

      focus.openFocusView('t_2');
      expect(window._focusInterval).toBeTruthy();
      expect(focus.getFocusTask()).toBe('t_2');
    });
  });

  // ── skipFocusTask clears interval ────────────────────────────────
  describe('skipFocusTask — clears interval', () => {
    it('clears the interval on skip', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.activeTasks.mockReturnValue([]);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });

      focus.openFocusView('t_1');
      expect(window._focusInterval).toBeTruthy();

      focus.setSessionGoal(3);
      focus.skipFocusTask();
      expect(document.getElementById('modalRoot').innerHTML).toBe('');
    });
  });

  // ── Analytics: Focus History ────────────────────────────────────
  describe('Focus Session Analytics', () => {
    it('getFocusHistory returns empty array initially', () => {
      expect(focus.getFocusHistory()).toEqual([]);
    });

    it('records a session on completeFocusTask', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'My Task', priority: 'normal' });
      focus.openFocusView('t_1');
      focus.completeFocusTask();

      const history = focus.getFocusHistory();
      expect(history.length).toBe(1);
      expect(history[0].taskId).toBe('t_1');
      expect(history[0].taskTitle).toBe('My Task');
      expect(history[0].completed).toBe(true);
      expect(history[0].skipped).toBe(false);
      expect(typeof history[0].duration).toBe('number');
      expect(history[0].startedAt).toBeTruthy();
      expect(history[0].endedAt).toBeTruthy();
    });

    it('records a session on skipFocusTask', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Skipped Task', priority: 'normal' });
      deps.activeTasks.mockReturnValue([]);
      focus.openFocusView('t_1');
      focus.setSessionGoal(3);
      focus.skipFocusTask();

      const history = focus.getFocusHistory();
      expect(history.length).toBe(1);
      expect(history[0].completed).toBe(false);
      expect(history[0].skipped).toBe(true);
    });

    it('records distraction count in session', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      focus.openFocusView('t_1');
      focus.logDistraction();
      focus.logDistraction();
      focus.completeFocusTask();

      const history = focus.getFocusHistory();
      expect(history[0].distractions).toBe(2);
    });

    it('records session on closeFocus if task was active', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      focus.openFocusView('t_1');
      focus.closeFocus();

      const history = focus.getFocusHistory();
      expect(history.length).toBe(1);
      expect(history[0].completed).toBe(false);
    });

    it('keeps only last 30 sessions', () => {
      for (let i = 0; i < 35; i++) {
        deps.findTask.mockReturnValue({ id: `t_${i}`, title: `Task ${i}`, priority: 'normal' });
        focus.openFocusView(`t_${i}`);
        focus.completeFocusTask();
      }
      const history = focus.getFocusHistory();
      expect(history.length).toBe(30);
    });

    it('uses userKey for localStorage namespacing', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      focus.openFocusView('t_1');
      focus.completeFocusTask();

      expect(deps.userKey).toHaveBeenCalledWith('wb_focus_history');
      const stored = localStorage.getItem('test_wb_focus_history');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored);
      expect(parsed.length).toBe(1);
    });
  });

  // ── getFocusStats ─────────────────────────────────────────────────
  describe('getFocusStats', () => {
    it('returns null when no history', () => {
      expect(focus.getFocusStats()).toBeNull();
    });

    it('calculates stats from history', () => {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      // Seed some history directly
      const history = [
        {
          taskId: 't_1',
          taskTitle: 'Task 1',
          startedAt: todayStr + 'T09:00:00.000Z',
          endedAt: todayStr + 'T09:25:00.000Z',
          duration: 1500,
          completed: true,
          skipped: false,
          distractions: 0,
        },
        {
          taskId: 't_2',
          taskTitle: 'Task 2',
          startedAt: todayStr + 'T10:00:00.000Z',
          endedAt: todayStr + 'T10:10:00.000Z',
          duration: 600,
          completed: true,
          skipped: false,
          distractions: 1,
        },
        {
          taskId: 't_3',
          taskTitle: 'Task 3',
          startedAt: todayStr + 'T11:00:00.000Z',
          endedAt: todayStr + 'T11:05:00.000Z',
          duration: 300,
          completed: false,
          skipped: true,
          distractions: 0,
        },
      ];
      localStorage.setItem('test_wb_focus_history', JSON.stringify(history));

      const stats = focus.getFocusStats();
      expect(stats).toBeTruthy();
      expect(stats.totalSessions).toBe(3);
      expect(stats.avgSessionLength).toBe(800); // (1500+600+300)/3
      expect(stats.completionRate).toBe(67); // 2/3
      expect(stats.todayFocusTime).toBe(2400); // 1500+600+300
      expect(stats.todayCompleted).toBe(2);
      expect(stats.weekFocusTime).toBe(2400);
      expect(stats.weekCompleted).toBe(2);
      expect(stats.weekCompletionRate).toBe(67);
    });

    it('calculates streak correctly', () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);

      const history = [
        {
          taskId: 't_1',
          taskTitle: 'T1',
          startedAt: twoDaysAgo + 'T10:00:00.000Z',
          endedAt: twoDaysAgo + 'T10:25:00.000Z',
          duration: 1500,
          completed: true,
          skipped: false,
        },
        {
          taskId: 't_2',
          taskTitle: 'T2',
          startedAt: yesterday + 'T10:00:00.000Z',
          endedAt: yesterday + 'T10:25:00.000Z',
          duration: 1500,
          completed: true,
          skipped: false,
        },
        {
          taskId: 't_3',
          taskTitle: 'T3',
          startedAt: today + 'T10:00:00.000Z',
          endedAt: today + 'T10:25:00.000Z',
          duration: 1500,
          completed: true,
          skipped: false,
        },
      ];
      localStorage.setItem('test_wb_focus_history', JSON.stringify(history));

      const stats = focus.getFocusStats();
      expect(stats.streak).toBe(3);
    });

    it('identifies most productive hour', () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      // Use a specific local hour for predictable results
      const targetHour = 10;
      const makeTime = (h) => {
        const d = new Date(today + 'T12:00:00');
        d.setHours(h, 0, 0, 0);
        return d.toISOString();
      };

      const history = [
        {
          taskId: 't_1',
          taskTitle: 'T1',
          startedAt: makeTime(9),
          endedAt: makeTime(targetHour),
          duration: 1500,
          completed: true,
          skipped: false,
        },
        {
          taskId: 't_2',
          taskTitle: 'T2',
          startedAt: makeTime(9),
          endedAt: makeTime(targetHour),
          duration: 1500,
          completed: true,
          skipped: false,
        },
        {
          taskId: 't_3',
          taskTitle: 'T3',
          startedAt: makeTime(11),
          endedAt: makeTime(16),
          duration: 1500,
          completed: true,
          skipped: false,
        },
      ];
      localStorage.setItem('test_wb_focus_history', JSON.stringify(history));

      const stats = focus.getFocusStats();
      expect(stats.mostProductiveHour).toBe(targetHour); // 2 completions at targetHour
    });
  });

  // ── Distraction Log ───────────────────────────────────────────────
  describe('Distraction Log', () => {
    it('logDistraction increments counter and shows toast', () => {
      deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', priority: 'normal' });
      focus.openFocusView('t_1');
      focus.logDistraction();
      expect(deps.showToast).toHaveBeenCalledWith('Noted. Refocus!');
    });
  });

  // ── Break Timer ───────────────────────────────────────────────────
  describe('Break Timer', () => {
    it('startBreakTimer renders break overlay', () => {
      focus.startBreakTimer();
      const modal = document.getElementById('modalRoot');
      expect(modal.innerHTML).toContain('Break Time');
      expect(modal.innerHTML).toContain('focusBreakTimer');
      expect(modal.innerHTML).toContain('end-break');
    });

    it('endBreak starts next focus task', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.activeTasks.mockReturnValue([task]);
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });

      focus.setSessionGoal(3);
      focus.endBreak();
      // Should have tried to find next task
      expect(deps.activeTasks).toHaveBeenCalled();
    });

    it('break timer counts down', () => {
      vi.useFakeTimers();
      focus.startBreakTimer();
      const timerEl = document.getElementById('focusBreakTimer');
      expect(timerEl).toBeTruthy();
      expect(timerEl.textContent).toBe('5:00');
      vi.advanceTimersByTime(60000);
      expect(timerEl.textContent).toBe('4:00');
      vi.useRealTimers();
    });
  });

  // ── Session Goal ──────────────────────────────────────────────────
  describe('Session Goal', () => {
    it('setSessionGoal clamps between 0 and 20', () => {
      focus.setSessionGoal(25);
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.openFocusView('t_1');
      const bar = document.getElementById('focusBar');
      expect(bar).toBeTruthy();
      expect(bar.innerHTML).toContain('1/20');
    });

    it('handleGoalPick starts focus with specified goal', async () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.activeTasks.mockReturnValue([task]);
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });

      await focus.startFocus(); // Shows goal prompt
      focus.handleGoalPick('3');
      expect(focus.getFocusTask()).toBe('t_1');
    });

    it('handleGoalStart reads custom input value', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.activeTasks.mockReturnValue([task]);
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });

      focus.startFocus(); // Shows goal prompt with input
      const input = document.getElementById('focusGoalCustom');
      if (input) input.value = '5';
      focus.handleGoalStart();
      expect(focus.getFocusTask()).toBe('t_1');
    });
  });

  // ── AI Extras ─────────────────────────────────────────────────────
  describe('AI-powered focus suggestions', () => {
    it('renders focus bar with task title from AI extras', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.openFocusView('t_1', 'reason', { estimatedMinutes: 15, tip: 'Stay focused', skippedNote: null });
      const bar = document.getElementById('focusBar');
      expect(bar).toBeTruthy();
      expect(deps.esc).toHaveBeenCalledWith('Task');
    });

    it('opens focus bar even with tip extras', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.openFocusView('t_1', 'reason', { estimatedMinutes: null, tip: 'Break it into chunks', skippedNote: null });
      expect(document.getElementById('focusBar')).toBeTruthy();
    });

    it('opens focus bar with skipped note extras', () => {
      const task = { id: 't_1', title: 'Task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });
      focus.openFocusView('t_1', 'reason', {
        estimatedMinutes: null,
        tip: null,
        skippedNote: 'You skipped this before. Ready to tackle it now?',
      });
      expect(document.getElementById('focusBar')).toBeTruthy();
    });
  });
});

// ── Additional coverage tests ─────────────────────────────────────────

describe('focus.js — additional coverage', () => {
  let focus;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    deps = makeDeps();
    focus = createFocusMode(deps);
  });

  afterEach(() => {
    if (window._focusInterval) {
      clearInterval(window._focusInterval);
      window._focusInterval = null;
    }
  });

  // ── completeFocusTask triggering break timer after 25+ min (lines 524-532) ──
  describe('completeFocusTask triggers break timer after 25+ min session', () => {
    it('starts break timer when session lasted 25+ minutes', () => {
      vi.useFakeTimers();
      const task = { id: 't_1', title: 'Marathon task', priority: 'normal' };
      deps.findTask.mockReturnValue(task);
      deps.getData.mockReturnValue({ tasks: [task], projects: [] });

      focus.openFocusView('t_1');

      // Advance time past 25 minutes so session.duration >= POMODORO_MS/1000
      vi.advanceTimersByTime(25 * 60 * 1000 + 1000);

      // Complete the task
      focus.completeFocusTask();

      // Should have called render
      expect(deps.render).toHaveBeenCalled();

      // Should show break overlay (startBreakTimer was called)
      const modal = document.getElementById('modalRoot');
      expect(modal.innerHTML).toContain('Break Time');
      expect(modal.innerHTML).toContain('focusBreakTimer');

      // focusTask should be null (cleared before break)
      expect(focus.getFocusTask()).toBeNull();

      vi.useRealTimers();
    });
  });

  // ── completeFocusTask auto-continuing to next task (lines 536-544) ──
  describe('completeFocusTask auto-continues to next task with session goal', () => {
    it('auto-continues to next task when session goal is set and not yet met', () => {
      const task1 = { id: 't_1', title: 'Task 1', priority: 'normal' };
      const task2 = { id: 't_2', title: 'Task 2', priority: 'urgent', dueDate: '2026-03-15' };
      deps.findTask.mockImplementation((id) => [task1, task2].find((t) => t.id === id) || null);
      deps.activeTasks.mockReturnValue([task1, task2]);
      deps.getData.mockReturnValue({ tasks: [task1, task2], projects: [] });

      // Set a session goal of 3 (completing 1 still leaves room)
      focus.setSessionGoal(3);

      // Open focus on task1
      focus.openFocusView('t_1');

      // Complete task1 (short session, under 25 min so no break)
      focus.completeFocusTask();

      // Should have marked task1 as done
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });

      // Should have auto-continued to the next task (t_2)
      expect(focus.getFocusTask()).toBe('t_2');
    });

    it('shows session complete toast when goal is met via auto-continue into _startFocusInternal', () => {
      const task1 = { id: 't_1', title: 'Task 1', priority: 'normal' };
      const task2 = { id: 't_2', title: 'Task 2', priority: 'normal' };
      const task3 = { id: 't_3', title: 'Task 3', priority: 'normal' };
      const allTasks = [task1, task2, task3];
      const doneTasks = new Set();
      deps.findTask.mockImplementation((id) => allTasks.find((t) => t.id === id) || null);
      deps.activeTasks.mockImplementation(() => allTasks.filter((t) => !doneTasks.has(t.id)));
      deps.updateTask.mockImplementation((id) => doneTasks.add(id));
      deps.getData.mockReturnValue({ tasks: allTasks, projects: [] });

      // Set a session goal of 2
      focus.setSessionGoal(2);

      // Open and complete task1 — _sessionCompleted becomes 1, auto-continues (1 < 2)
      focus.openFocusView('t_1');
      focus.completeFocusTask();
      // _startFocusInternal picks task2 since task1 is done
      expect(focus.getFocusTask()).toBe('t_2');

      // Complete task2 — _sessionCompleted becomes 2
      // auto-continue check: 2 < 2 is false, so falls through to normal close
      focus.completeFocusTask();

      // focusTask should be null (session ended)
      expect(focus.getFocusTask()).toBeNull();
      // render should have been called
      expect(deps.render).toHaveBeenCalled();
    });
  });
});
