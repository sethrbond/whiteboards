import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MS_PER_DAY } from '../constants.js';
import { createProactiveNudges } from '../proactive-nudges.js';

function makeDeps(overrides = {}) {
  return {
    esc: vi.fn((s) => (s == null ? '' : String(s))),
    todayStr: vi.fn(() => '2026-03-15'),
    genId: vi.fn((prefix) => `${prefix}_gen`),
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    userKey: vi.fn((k) => `user1_${k}`),
    hasAI: vi.fn(() => false),
    callAI: vi.fn(async () => ''),
    buildAIContext: vi.fn(() => ''),
    addAIMemory: vi.fn(),
    findTask: vi.fn(() => null),
    updateTask: vi.fn(),
    showToast: vi.fn(),
    render: vi.fn(),
    setView: vi.fn(),
    setNudgeFilter: vi.fn(),
    ...overrides,
  };
}

const veryOldDate = new Date(Date.now() - 15 * MS_PER_DAY).toISOString();

describe('proactive-nudges.js — createProactiveNudges()', () => {
  let nudges;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    deps = makeDeps();
    nudges = createProactiveNudges(deps);
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'getSmartNudges',
      'nudgeFilterOverdue',
      'nudgeFilterStale',
      'nudgeFilterUnassigned',
      'maybeReflect',
      'showReflectionToast',
      'getStuckTasks',
      'trackNudgeInteraction',
      'maybeShowCheckIn',
      'dismissCheckIn',
      'detectVagueTasks',
      'breakdownTask',
      'dismissVagueTask',
    ];
    keys.forEach((k) => expect(typeof nudges[k]).toBe('function'));
  });

  // ── getSmartNudges ──────────────────────────────────────────────────
  it('returns empty nudges for no tasks', () => {
    const result = nudges.getSmartNudges();
    expect(result).toEqual([]);
  });

  it('returns overload warning when >30 active tasks', () => {
    const tasks = Array.from({ length: 35 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: 'todo',
      createdAt: new Date().toISOString(),
    }));
    deps.getData.mockReturnValue({ tasks, projects: [] });

    const result = nudges.getSmartNudges();
    const warning = result.find((n) => n.type === 'warning' && n.text.includes('active tasks'));
    expect(warning).toBeDefined();
  });

  it('returns stale nudge when 3+ tasks are untouched for 10+ days', () => {
    const tasks = Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`,
      title: `Stale task ${i}`,
      status: 'todo',
      createdAt: veryOldDate,
    }));
    deps.getData.mockReturnValue({ tasks, projects: [] });

    const result = nudges.getSmartNudges();
    const stale = result.find((n) => n.type === 'stale');
    expect(stale).toBeDefined();
    expect(stale.text).toContain('untouched');
  });

  it('returns action nudge when nothing is in progress', () => {
    deps.getData.mockReturnValue({
      tasks: [{ id: 't1', title: 'Todo', status: 'todo', createdAt: new Date().toISOString() }],
      projects: [],
    });

    const result = nudges.getSmartNudges();
    const action = result.find((n) => n.text.includes('Nothing in progress'));
    expect(action).toBeDefined();
  });

  it('returns warning when >5 tasks in progress', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      title: `IP ${i}`,
      status: 'in-progress',
      createdAt: new Date().toISOString(),
    }));
    deps.getData.mockReturnValue({ tasks, projects: [] });

    const result = nudges.getSmartNudges();
    const warning = result.find((n) => n.text.includes('in progress at once'));
    expect(warning).toBeDefined();
  });

  it('returns overdue nudge when 3+ tasks are overdue', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`,
      title: `Overdue ${i}`,
      status: 'todo',
      dueDate: '2026-03-10',
      createdAt: new Date().toISOString(),
    }));
    deps.getData.mockReturnValue({ tasks, projects: [] });

    const result = nudges.getSmartNudges();
    const urgent = result.find((n) => n.type === 'urgent');
    expect(urgent).toBeDefined();
    expect(urgent.text).toContain('overdue');
  });

  it('returns positive nudge for completed tasks this week', () => {
    const now = new Date();
    // Ensure completedAt is earlier today so it's always within "this week"
    const completedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString();
    deps.getData.mockReturnValue({
      tasks: [{ id: 't1', title: 'Done', status: 'done', completedAt, createdAt: completedAt }],
      projects: [],
    });

    const result = nudges.getSmartNudges();
    const positive = result.find((n) => n.type === 'positive');
    expect(positive).toBeDefined();
    expect(positive.text).toContain('completed this week');
  });

  it('returns unassigned nudge when 3+ tasks lack a project', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`,
      title: `Unassigned ${i}`,
      status: 'todo',
      createdAt: new Date().toISOString(),
    }));
    deps.getData.mockReturnValue({ tasks, projects: [] });

    const result = nudges.getSmartNudges();
    const unassigned = result.find((n) => n.text.includes('without a project'));
    expect(unassigned).toBeDefined();
  });

  it('limits nudges to MAX_NUDGES (4)', () => {
    const tasks = [
      ...Array.from({ length: 35 }, (_, i) => ({
        id: `t${i}`,
        title: `Task ${i}`,
        status: 'todo',
        dueDate: '2026-03-10',
        createdAt: veryOldDate,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `ip${i}`,
        title: `IP ${i}`,
        status: 'in-progress',
        createdAt: new Date().toISOString(),
      })),
    ];
    deps.getData.mockReturnValue({ tasks, projects: [] });

    const result = nudges.getSmartNudges();
    expect(result.length).toBeLessThanOrEqual(4);
  });

  // ── nudgeFilter functions ───────────────────────────────────────────
  it('nudgeFilterOverdue sets filter, view, renders, and toasts', () => {
    nudges.nudgeFilterOverdue();
    expect(deps.setNudgeFilter).toHaveBeenCalledWith('overdue');
    expect(deps.setView).toHaveBeenCalledWith('dashboard');
    expect(deps.render).toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Showing overdue tasks');
  });

  it('nudgeFilterStale sets filter and renders', () => {
    nudges.nudgeFilterStale();
    expect(deps.setNudgeFilter).toHaveBeenCalledWith('stale');
    expect(deps.render).toHaveBeenCalled();
  });

  it('nudgeFilterUnassigned sets filter and renders', () => {
    nudges.nudgeFilterUnassigned();
    expect(deps.setNudgeFilter).toHaveBeenCalledWith('unassigned');
    expect(deps.render).toHaveBeenCalled();
  });

  // ── trackNudgeInteraction ───────────────────────────────────────────
  it('trackNudgeInteraction saves interaction to localStorage', () => {
    nudges.trackNudgeInteraction('stale', true);

    const stored = JSON.parse(localStorage.getItem('user1_wb_nudge_interactions'));
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe('stale');
    expect(stored[0].acted).toBe(true);
  });

  it('trackNudgeInteraction adds AI memory when 5+ interactions with high act rate', () => {
    const existing = Array.from({ length: 4 }, () => ({ type: 'stale', acted: true, ts: Date.now() }));
    localStorage.setItem('user1_wb_nudge_interactions', JSON.stringify(existing));

    nudges.trackNudgeInteraction('stale', true);

    expect(deps.addAIMemory).toHaveBeenCalled();
    const call = deps.addAIMemory.mock.calls[0];
    expect(call[0]).toContain('consistently acts on');
    expect(call[1]).toBe('pattern');
  });

  it('trackNudgeInteraction adds AI memory for low act rate', () => {
    const existing = Array.from({ length: 4 }, () => ({ type: 'urgent', acted: false, ts: Date.now() }));
    localStorage.setItem('user1_wb_nudge_interactions', JSON.stringify(existing));

    nudges.trackNudgeInteraction('urgent', false);

    expect(deps.addAIMemory).toHaveBeenCalled();
    expect(deps.addAIMemory.mock.calls[0][0]).toContain('mostly ignores');
  });

  it('trackNudgeInteraction caps at 100 interactions', () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({ type: 'test', acted: false, ts: i }));
    localStorage.setItem('user1_wb_nudge_interactions', JSON.stringify(existing));

    nudges.trackNudgeInteraction('test', true);

    const stored = JSON.parse(localStorage.getItem('user1_wb_nudge_interactions'));
    expect(stored.length).toBeLessThanOrEqual(100);
  });

  // ── getStuckTasks ───────────────────────────────────────────────────
  it('returns empty for no in-progress tasks', () => {
    deps.getData.mockReturnValue({
      tasks: [{ id: 't1', status: 'todo', createdAt: veryOldDate }],
      projects: [],
    });
    expect(nudges.getStuckTasks()).toEqual([]);
  });

  it('detects tasks in-progress for 3+ days as stuck', () => {
    const fourDaysAgo = new Date(Date.now() - 4 * MS_PER_DAY).toISOString();
    deps.getData.mockReturnValue({
      tasks: [{ id: 't1', status: 'in-progress', createdAt: fourDaysAgo }],
      projects: [],
    });

    const stuck = nudges.getStuckTasks();
    expect(stuck).toHaveLength(1);
    expect(stuck[0].id).toBe('t1');
  });

  it('does not flag recently updated in-progress tasks as stuck', () => {
    deps.getData.mockReturnValue({
      tasks: [
        {
          id: 't1',
          status: 'in-progress',
          createdAt: veryOldDate,
          updates: [{ date: new Date().toISOString() }],
        },
      ],
      projects: [],
    });

    expect(nudges.getStuckTasks()).toEqual([]);
  });

  // ── maybeReflect ────────────────────────────────────────────────────
  it('maybeReflect does nothing when AI unavailable', () => {
    nudges.maybeReflect({ id: 't1', title: 'Done', priority: 'urgent' });
    expect(deps.callAI).not.toHaveBeenCalled();
  });

  // ── maybeShowCheckIn ────────────────────────────────────────────────
  it('returns empty string outside 14-16 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T10:00:00'));
    const result = nudges.maybeShowCheckIn();
    expect(result).toBe('');
    vi.useRealTimers();
  });

  it('returns check-in HTML when conditions are met', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T15:00:00'));

    const plan = [{ id: 't1' }, { id: 't2' }];
    localStorage.setItem('user1_whiteboard_plan_2026-03-15', JSON.stringify(plan));

    deps.findTask.mockImplementation((id) => {
      if (id === 't1') return { id: 't1', title: 'Task 1', status: 'done' };
      if (id === 't2') return { id: 't2', title: 'Task 2', status: 'todo' };
      return null;
    });

    const result = nudges.maybeShowCheckIn();
    expect(result).toContain('Mid-Day Check-In');
    expect(result).toContain('50%');
    expect(result).toContain('Task 2');

    vi.useRealTimers();
  });

  it('returns empty string when check-in already dismissed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T15:00:00'));
    localStorage.setItem('user1_wb_checkin_2026-03-15', '1');

    const result = nudges.maybeShowCheckIn();
    expect(result).toBe('');
    vi.useRealTimers();
  });

  it('returns empty string when no plan exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T15:00:00'));
    const result = nudges.maybeShowCheckIn();
    expect(result).toBe('');
    vi.useRealTimers();
  });

  // ── dismissCheckIn ──────────────────────────────────────────────────
  it('dismissCheckIn stores dismissal in localStorage', () => {
    nudges.dismissCheckIn();
    expect(localStorage.getItem('user1_wb_checkin_2026-03-15')).toBe('1');
  });

  // ── detectVagueTasks ────────────────────────────────────────────────
  it('returns null when no vague tasks exist', () => {
    deps.getData.mockReturnValue({
      tasks: [{ id: 't1', title: 'Buy milk', status: 'todo', createdAt: veryOldDate }],
      projects: [],
    });
    expect(nudges.detectVagueTasks()).toBeNull();
  });

  it('detects a vague task with vague words', () => {
    deps.getData.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'Figure out the deployment process',
          status: 'todo',
          createdAt: veryOldDate,
        },
      ],
      projects: [],
    });

    const result = nudges.detectVagueTasks();
    expect(result).not.toBeNull();
    expect(result.id).toBe('t1');
  });

  it('detects long titles as vague', () => {
    deps.getData.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'A'.repeat(45),
          status: 'todo',
          createdAt: veryOldDate,
        },
      ],
      projects: [],
    });

    const result = nudges.detectVagueTasks();
    expect(result).not.toBeNull();
  });

  it('skips dismissed vague tasks', () => {
    localStorage.setItem('user1_wb_vague_dismissed', JSON.stringify(['t1']));
    deps.getData.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'Figure out the deployment',
          status: 'todo',
          createdAt: veryOldDate,
        },
      ],
      projects: [],
    });

    expect(nudges.detectVagueTasks()).toBeNull();
  });

  it('skips tasks with subtasks', () => {
    deps.getData.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'Figure out deployment',
          status: 'todo',
          createdAt: veryOldDate,
          subtasks: [{ id: 's1', title: 'Step 1', done: false }],
        },
      ],
      projects: [],
    });

    expect(nudges.detectVagueTasks()).toBeNull();
  });

  it('skips recently created tasks', () => {
    deps.getData.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'Figure out deployment',
          status: 'todo',
          createdAt: new Date().toISOString(),
        },
      ],
      projects: [],
    });

    expect(nudges.detectVagueTasks()).toBeNull();
  });

  // ── breakdownTask ───────────────────────────────────────────────────
  it('breakdownTask shows toast when AI unavailable', async () => {
    await nudges.breakdownTask('t1');
    expect(deps.showToast).toHaveBeenCalledWith('AI not available');
  });

  it('breakdownTask parses AI response and adds subtasks', async () => {
    deps.hasAI.mockReturnValue(true);
    deps.findTask.mockReturnValue({ id: 't1', title: 'Big task', subtasks: [] });
    deps.callAI.mockResolvedValue('["Step 1", "Step 2", "Step 3"]');

    await nudges.breakdownTask('t1');

    expect(deps.updateTask).toHaveBeenCalledTimes(1);
    const updateCall = deps.updateTask.mock.calls[0];
    expect(updateCall[0]).toBe('t1');
    expect(updateCall[1].subtasks).toHaveLength(3);
    expect(deps.showToast).toHaveBeenCalledWith('Added 3 subtasks');
    expect(deps.render).toHaveBeenCalled();
  });

  it('breakdownTask handles AI returning markdown-wrapped JSON', async () => {
    deps.hasAI.mockReturnValue(true);
    deps.findTask.mockReturnValue({ id: 't1', title: 'Task', subtasks: [] });
    deps.callAI.mockResolvedValue('```json\n["A", "B"]\n```');

    await nudges.breakdownTask('t1');

    const subs = deps.updateTask.mock.calls[0][1].subtasks;
    expect(subs).toHaveLength(2);
  });

  it('breakdownTask handles AI error gracefully', async () => {
    deps.hasAI.mockReturnValue(true);
    deps.findTask.mockReturnValue({ id: 't1', title: 'Task' });
    deps.callAI.mockRejectedValue(new Error('fail'));

    await nudges.breakdownTask('t1');

    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Breakdown failed'), true);
  });

  it('breakdownTask does nothing when task not found', async () => {
    deps.hasAI.mockReturnValue(true);
    deps.findTask.mockReturnValue(null);

    await nudges.breakdownTask('t_missing');

    expect(deps.callAI).not.toHaveBeenCalled();
  });

  // ── dismissVagueTask ────────────────────────────────────────────────
  it('dismissVagueTask adds task id to dismissed list', () => {
    nudges.dismissVagueTask('t1');

    const dismissed = JSON.parse(localStorage.getItem('user1_wb_vague_dismissed'));
    expect(dismissed).toContain('t1');
  });

  it('dismissVagueTask appends to existing dismissed list', () => {
    localStorage.setItem('user1_wb_vague_dismissed', JSON.stringify(['t0']));
    nudges.dismissVagueTask('t1');

    const dismissed = JSON.parse(localStorage.getItem('user1_wb_vague_dismissed'));
    expect(dismissed).toEqual(['t0', 't1']);
  });
});
