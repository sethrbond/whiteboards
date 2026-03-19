import { describe, it, expect, vi, beforeEach } from 'vitest';
// MS_PER_DAY used indirectly via proactive module
import { createProactive } from '../proactive.js';

function makeDeps(overrides = {}) {
  return {
    $: vi.fn((sel) => document.querySelector(sel)),
    esc: vi.fn((s) => (s == null ? '' : String(s))),
    sanitizeAIHTML: vi.fn((s) => s),
    todayStr: vi.fn(() => '2026-03-16'),
    localISO: vi.fn((d) => d.toISOString().slice(0, 10)),
    genId: vi.fn((prefix) => `${prefix}_gen`),
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    userKey: vi.fn((k) => `user1_${k}`),
    hasAI: vi.fn(() => false),
    callAI: vi.fn(async () => ''),
    buildAIContext: vi.fn(() => ''),
    addAIMemory: vi.fn(),
    getAIMemory: vi.fn(() => []),
    findTask: vi.fn(() => null),
    updateTask: vi.fn(),
    addTask: vi.fn(),
    createTask: vi.fn((t) => ({ id: 't_new', ...t })),
    isBlocked: vi.fn(() => false),
    showToast: vi.fn(),
    render: vi.fn(),
    setView: vi.fn(),
    notifyOverdueTasks: vi.fn(),
    getProactiveLog: vi.fn(() => []),
    setProactiveLog: vi.fn(),
    getProactiveRunning: vi.fn(() => false),
    setProactiveRunning: vi.fn(),
    setBriefingGenerating: vi.fn(),
    setPlanGenerating: vi.fn(),
    setNudgeFilter: vi.fn(),
    setProactiveResults: vi.fn(),
    setPlanIndexCache: vi.fn(),
    ...overrides,
  };
}

describe('Smart Auto-Reschedule', () => {
  let proactive;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="modalRoot"></div>';
    deps = makeDeps();
    proactive = createProactive(deps);
  });

  // -- Factory returns new functions --
  it('exports all reschedule functions', () => {
    const keys = [
      'analyzeWorkload',
      'suggestReschedule',
      'showRescheduleModal',
      'acceptReschedule',
      'skipReschedule',
      'acceptAllReschedules',
      'autoRebalanceWeek',
      'isWeekOverloaded',
    ];
    keys.forEach((k) => expect(typeof proactive[k]).toBe('function'));
  });

  // -- analyzeWorkload --
  describe('analyzeWorkload()', () => {
    it('returns correct structure with empty tasks', () => {
      const result = proactive.analyzeWorkload();
      expect(result).toHaveProperty('dailyTasks');
      expect(result).toHaveProperty('overloadedDays');
      expect(result).toHaveProperty('emptyDays');
      expect(result).toHaveProperty('avgCapacity');
      expect(Object.keys(result.dailyTasks)).toHaveLength(7);
    });

    it('identifies overloaded days (>5 tasks)', () => {
      const d = new Date();
      const today =
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const tasks = [];
      for (let i = 0; i < 6; i++) {
        tasks.push({ id: 't' + i, title: 'Task ' + i, status: 'todo', dueDate: today, archived: false });
      }
      deps = makeDeps({
        getData: vi.fn(() => ({ tasks, projects: [] })),
        todayStr: vi.fn(() => today),
      });
      proactive = createProactive(deps);
      const result = proactive.analyzeWorkload();
      expect(result.overloadedDays).toContain(today);
    });

    it('identifies empty days (0 tasks)', () => {
      deps = makeDeps({ getData: vi.fn(() => ({ tasks: [], projects: [] })) });
      proactive = createProactive(deps);
      const result = proactive.analyzeWorkload();
      expect(result.emptyDays.length).toBe(7);
    });

    it('calculates avgCapacity from completion history', () => {
      const today = '2026-03-16';
      const tasks = [];
      for (let i = 0; i < 10; i++) {
        const dayOffset = Math.floor(i / 2);
        const d = new Date('2026-03-10');
        d.setDate(d.getDate() + dayOffset);
        tasks.push({
          id: 'done' + i,
          title: 'Done ' + i,
          status: 'done',
          completedAt: d.toISOString(),
          dueDate: '',
          archived: false,
        });
      }
      deps = makeDeps({ getData: vi.fn(() => ({ tasks, projects: [] })), todayStr: vi.fn(() => today) });
      proactive = createProactive(deps);
      const result = proactive.analyzeWorkload();
      expect(result.avgCapacity).toBe(2);
    });

    it('defaults avgCapacity to 5 when no completion history', () => {
      const result = proactive.analyzeWorkload();
      expect(result.avgCapacity).toBe(5);
    });
  });

  // -- suggestReschedule --
  describe('suggestReschedule()', () => {
    it('returns empty array when no overdue tasks', async () => {
      const result = await proactive.suggestReschedule();
      expect(result).toEqual([]);
    });

    it('generates suggestions for overdue tasks without AI', async () => {
      const today = '2026-03-16';
      const tasks = [
        {
          id: 't1',
          title: 'Urgent task',
          status: 'todo',
          priority: 'urgent',
          dueDate: '2026-03-14',
          archived: false,
          project: '',
        },
        {
          id: 't2',
          title: 'Normal task',
          status: 'todo',
          priority: 'normal',
          dueDate: '2026-03-15',
          archived: false,
          project: '',
        },
        {
          id: 't3',
          title: 'Low task',
          status: 'todo',
          priority: 'low',
          dueDate: '2026-03-13',
          archived: false,
          project: '',
        },
      ];
      deps = makeDeps({
        getData: vi.fn(() => ({ tasks, projects: [] })),
        todayStr: vi.fn(() => today),
        hasAI: vi.fn(() => false),
      });
      proactive = createProactive(deps);
      const suggestions = await proactive.suggestReschedule();
      expect(suggestions.length).toBe(3);
      suggestions.forEach((s) => {
        expect(s).toHaveProperty('taskId');
        expect(s).toHaveProperty('taskTitle');
        expect(s).toHaveProperty('currentDueDate');
        expect(s).toHaveProperty('suggestedDueDate');
        expect(s).toHaveProperty('reason');
      });
      expect(suggestions[0].taskId).toBe('t1');
    });

    it('uses AI when available', async () => {
      const today = '2026-03-16';
      const tasks = [
        {
          id: 't1',
          title: 'Task A',
          status: 'todo',
          priority: 'normal',
          dueDate: '2026-03-14',
          archived: false,
          project: '',
        },
      ];
      deps = makeDeps({
        getData: vi.fn(() => ({ tasks, projects: [] })),
        todayStr: vi.fn(() => today),
        hasAI: vi.fn(() => true),
        findTask: vi.fn((id) => tasks.find((t) => t.id === id)),
        callAI: vi.fn(async () => JSON.stringify([{ id: 't1', suggestedDate: '2026-03-18', reason: 'Balanced load' }])),
      });
      proactive = createProactive(deps);
      const suggestions = await proactive.suggestReschedule();
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].suggestedDueDate).toBe('2026-03-18');
      expect(suggestions[0].reason).toBe('Balanced load');
    });

    it('falls back to simple algorithm when AI fails', async () => {
      const today = '2026-03-16';
      const tasks = [
        {
          id: 't1',
          title: 'Task A',
          status: 'todo',
          priority: 'normal',
          dueDate: '2026-03-15',
          archived: false,
          project: '',
        },
      ];
      deps = makeDeps({
        getData: vi.fn(() => ({ tasks, projects: [] })),
        todayStr: vi.fn(() => today),
        hasAI: vi.fn(() => true),
        callAI: vi.fn(async () => {
          throw new Error('API error');
        }),
      });
      proactive = createProactive(deps);
      const suggestions = await proactive.suggestReschedule();
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].taskId).toBe('t1');
    });

    it('excludes done and archived tasks', async () => {
      const today = '2026-03-16';
      const tasks = [
        { id: 't1', title: 'Done', status: 'done', priority: 'normal', dueDate: '2026-03-14', archived: false },
        { id: 't2', title: 'Archived', status: 'todo', priority: 'normal', dueDate: '2026-03-14', archived: true },
        {
          id: 't3',
          title: 'Active',
          status: 'todo',
          priority: 'normal',
          dueDate: '2026-03-14',
          archived: false,
          project: '',
        },
      ];
      deps = makeDeps({ getData: vi.fn(() => ({ tasks, projects: [] })), todayStr: vi.fn(() => today) });
      proactive = createProactive(deps);
      const suggestions = await proactive.suggestReschedule();
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].taskId).toBe('t3');
    });
  });

  // -- showRescheduleModal --
  describe('showRescheduleModal()', () => {
    it('shows toast when no suggestions', () => {
      proactive.showRescheduleModal([]);
      expect(deps.showToast).toHaveBeenCalledWith('No tasks to reschedule');
    });

    it('renders modal with correct structure', () => {
      const suggestions = [
        {
          taskId: 't1',
          taskTitle: 'Test Task',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'Balance load',
        },
      ];
      proactive.showRescheduleModal(suggestions);
      const modal = document.querySelector('.reschedule-modal');
      expect(modal).not.toBeNull();
      expect(modal._suggestions).toEqual(suggestions);
      expect(document.querySelector('.reschedule-heading').textContent).toBe('Rebalance Your Week');
      expect(document.querySelectorAll('.reschedule-row').length).toBe(1);
    });

    it('renders Accept All and Cancel buttons', () => {
      proactive.showRescheduleModal([
        {
          taskId: 't1',
          taskTitle: 'Test',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'Test',
        },
      ]);
      expect(document.querySelector('[data-action="reschedule-accept-all"]')).not.toBeNull();
      expect(document.querySelector('.reschedule-cancel-btn')).not.toBeNull();
    });

    it('renders multiple rows', () => {
      const suggestions = [
        {
          taskId: 't1',
          taskTitle: 'Task 1',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'R1',
        },
        {
          taskId: 't2',
          taskTitle: 'Task 2',
          currentDueDate: '2026-03-13',
          suggestedDueDate: '2026-03-18',
          reason: 'R2',
        },
        {
          taskId: 't3',
          taskTitle: 'Task 3',
          currentDueDate: '2026-03-12',
          suggestedDueDate: '2026-03-19',
          reason: 'R3',
        },
      ];
      proactive.showRescheduleModal(suggestions);
      expect(document.querySelectorAll('.reschedule-row').length).toBe(3);
    });
  });

  // -- acceptReschedule --
  describe('acceptReschedule()', () => {
    it('updates task due date', () => {
      const suggestions = [
        {
          taskId: 't1',
          taskTitle: 'Test',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'Test',
        },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.acceptReschedule(0);
      expect(deps.updateTask).toHaveBeenCalledWith('t1', { dueDate: '2026-03-17' });
    });

    it('marks suggestion as accepted', () => {
      const suggestions = [
        {
          taskId: 't1',
          taskTitle: 'Test',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'Test',
        },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.acceptReschedule(0);
      const modal = document.querySelector('.reschedule-modal');
      expect(modal._suggestions[0]._accepted).toBe(true);
    });

    it('does nothing when no modal is present', () => {
      proactive.acceptReschedule(0);
      expect(deps.updateTask).not.toHaveBeenCalled();
    });
  });

  // -- skipReschedule --
  describe('skipReschedule()', () => {
    it('removes the row from the DOM', () => {
      const suggestions = [
        {
          taskId: 't1',
          taskTitle: 'Test',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'Test',
        },
        {
          taskId: 't2',
          taskTitle: 'Test2',
          currentDueDate: '2026-03-13',
          suggestedDueDate: '2026-03-18',
          reason: 'Test2',
        },
      ];
      proactive.showRescheduleModal(suggestions);
      expect(document.querySelectorAll('.reschedule-row').length).toBe(2);
      proactive.skipReschedule(0);
      expect(document.querySelectorAll('.reschedule-row').length).toBe(1);
    });

    it('nullifies the suggestion entry', () => {
      const suggestions = [
        {
          taskId: 't1',
          taskTitle: 'Test',
          currentDueDate: '2026-03-14',
          suggestedDueDate: '2026-03-17',
          reason: 'Test',
        },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.skipReschedule(0);
      const modal = document.querySelector('.reschedule-modal');
      expect(modal._suggestions[0]).toBeNull();
    });
  });

  // -- acceptAllReschedules --
  describe('acceptAllReschedules()', () => {
    it('updates all non-accepted suggestions', () => {
      const suggestions = [
        { taskId: 't1', taskTitle: 'T1', currentDueDate: '2026-03-14', suggestedDueDate: '2026-03-17', reason: 'R1' },
        { taskId: 't2', taskTitle: 'T2', currentDueDate: '2026-03-13', suggestedDueDate: '2026-03-18', reason: 'R2' },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.acceptAllReschedules();
      expect(deps.updateTask).toHaveBeenCalledTimes(2);
      expect(deps.updateTask).toHaveBeenCalledWith('t1', { dueDate: '2026-03-17' });
      expect(deps.updateTask).toHaveBeenCalledWith('t2', { dueDate: '2026-03-18' });
    });

    it('skips already accepted suggestions', () => {
      const suggestions = [
        { taskId: 't1', taskTitle: 'T1', currentDueDate: '2026-03-14', suggestedDueDate: '2026-03-17', reason: 'R1' },
        { taskId: 't2', taskTitle: 'T2', currentDueDate: '2026-03-13', suggestedDueDate: '2026-03-18', reason: 'R2' },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.acceptReschedule(0);
      deps.updateTask.mockClear();
      proactive.acceptAllReschedules();
      expect(deps.updateTask).toHaveBeenCalledTimes(1);
      expect(deps.updateTask).toHaveBeenCalledWith('t2', { dueDate: '2026-03-18' });
    });

    it('shows toast with count and clears modal', () => {
      const suggestions = [
        { taskId: 't1', taskTitle: 'T1', currentDueDate: '2026-03-14', suggestedDueDate: '2026-03-17', reason: 'R1' },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.acceptAllReschedules();
      expect(deps.showToast).toHaveBeenCalledWith('Rescheduled 1 task');
      expect(deps.render).toHaveBeenCalled();
    });

    it('skips nullified (skipped) suggestions', () => {
      const suggestions = [
        { taskId: 't1', taskTitle: 'T1', currentDueDate: '2026-03-14', suggestedDueDate: '2026-03-17', reason: 'R1' },
        { taskId: 't2', taskTitle: 'T2', currentDueDate: '2026-03-13', suggestedDueDate: '2026-03-18', reason: 'R2' },
      ];
      proactive.showRescheduleModal(suggestions);
      proactive.skipReschedule(0);
      proactive.acceptAllReschedules();
      expect(deps.updateTask).toHaveBeenCalledTimes(1);
      expect(deps.updateTask).toHaveBeenCalledWith('t2', { dueDate: '2026-03-18' });
    });
  });

  // -- autoRebalanceWeek --
  describe('autoRebalanceWeek()', () => {
    it('shows balanced message when no overdue and no overloaded days', async () => {
      await proactive.autoRebalanceWeek();
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('balanced'));
    });

    it('shows modal when overdue tasks exist', async () => {
      const today = '2026-03-16';
      const tasks = [
        {
          id: 't1',
          title: 'Overdue',
          status: 'todo',
          priority: 'normal',
          dueDate: '2026-03-14',
          archived: false,
          project: '',
        },
      ];
      deps = makeDeps({ getData: vi.fn(() => ({ tasks, projects: [] })), todayStr: vi.fn(() => today) });
      proactive = createProactive(deps);
      await proactive.autoRebalanceWeek();
      const modal = document.querySelector('.reschedule-modal');
      expect(modal).not.toBeNull();
    });
  });

  // -- isWeekOverloaded --
  describe('isWeekOverloaded()', () => {
    it('returns false when no overdue and no overloaded days', () => {
      expect(proactive.isWeekOverloaded()).toBe(false);
    });

    it('returns true when 3+ overdue tasks', () => {
      const today = '2026-03-16';
      const tasks = [
        { id: 't1', title: 'T1', status: 'todo', dueDate: '2026-03-13', archived: false },
        { id: 't2', title: 'T2', status: 'todo', dueDate: '2026-03-14', archived: false },
        { id: 't3', title: 'T3', status: 'todo', dueDate: '2026-03-15', archived: false },
      ];
      deps = makeDeps({ getData: vi.fn(() => ({ tasks, projects: [] })), todayStr: vi.fn(() => today) });
      proactive = createProactive(deps);
      expect(proactive.isWeekOverloaded()).toBe(true);
    });

    it('returns true when a day has >5 tasks', () => {
      const today = '2026-03-19';
      const tasks = [];
      for (let i = 0; i < 6; i++) {
        tasks.push({ id: 'tx' + i, title: 'Task ' + i, status: 'todo', dueDate: '2026-03-22', archived: false });
      }
      deps = makeDeps({ getData: vi.fn(() => ({ tasks, projects: [] })), todayStr: vi.fn(() => today) });
      proactive = createProactive(deps);
      expect(proactive.isWeekOverloaded()).toBe(true);
    });

    it('returns false when overdue < 3 and no overloaded days', () => {
      const today = '2026-03-16';
      const tasks = [
        { id: 't1', title: 'T1', status: 'todo', dueDate: '2026-03-15', archived: false },
        { id: 't2', title: 'T2', status: 'todo', dueDate: '2026-03-18', archived: false },
      ];
      deps = makeDeps({ getData: vi.fn(() => ({ tasks, projects: [] })), todayStr: vi.fn(() => today) });
      proactive = createProactive(deps);
      expect(proactive.isWeekOverloaded()).toBe(false);
    });
  });

  // -- suggestReschedule priority sorting --
  describe('suggestReschedule() priority sorting', () => {
    it('sorts by priority: urgent first, low last', async () => {
      const today = '2026-03-16';
      const tasks = [
        {
          id: 't1',
          title: 'Low',
          status: 'todo',
          priority: 'low',
          dueDate: '2026-03-15',
          archived: false,
          project: '',
        },
        {
          id: 't2',
          title: 'Urgent',
          status: 'todo',
          priority: 'urgent',
          dueDate: '2026-03-15',
          archived: false,
          project: '',
        },
        {
          id: 't3',
          title: 'Important',
          status: 'todo',
          priority: 'important',
          dueDate: '2026-03-15',
          archived: false,
          project: '',
        },
        {
          id: 't4',
          title: 'Normal',
          status: 'todo',
          priority: 'normal',
          dueDate: '2026-03-15',
          archived: false,
          project: '',
        },
      ];
      deps = makeDeps({
        getData: vi.fn(() => ({ tasks, projects: [] })),
        todayStr: vi.fn(() => today),
        hasAI: vi.fn(() => false),
      });
      proactive = createProactive(deps);
      const suggestions = await proactive.suggestReschedule();
      expect(suggestions[0].taskId).toBe('t2');
      expect(suggestions[1].taskId).toBe('t3');
      expect(suggestions[2].taskId).toBe('t4');
      expect(suggestions[3].taskId).toBe('t1');
    });
  });
});
