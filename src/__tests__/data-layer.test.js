import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MS_PER_DAY } from '../constants.js';
import { createDataLayer } from '../data.js';

// Stable id counter for deterministic tests
let idCounter = 0;
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    genId: (prefix = 't') => `${prefix}_${++idCounter}`,
  };
});

vi.mock('../dates.js', () => ({
  todayStr: () => '2026-03-15',
}));

vi.mock('../migrations.js', () => ({
  CURRENT_SCHEMA_VERSION: 1,
  migrateData: (d) => d,
}));

function makeDeps(overrides = {}) {
  return {
    userKey: vi.fn((k) => `user1_${k}`),
    getCurrentUser: vi.fn(() => ({ id: 'u1' })),
    getScheduleSyncToCloud: vi.fn(() => vi.fn()),
    getShowToast: vi.fn(() => vi.fn()),
    getRender: vi.fn(() => vi.fn()),
    getMaybeReflect: vi.fn(() => null),
    getMaybeLearnPattern: vi.fn(() => null),
    getSuppressCloudSync: vi.fn(() => false),
    getBatchMode: vi.fn(() => false),
    getActiveTagFilter: vi.fn(() => null),
    getNudgeFilter: vi.fn(() => null),
    getPruneStaleMemories: vi.fn(() => null),
    getExpandedTask: vi.fn(() => null),
    setExpandedTask: vi.fn(),
    esc: vi.fn((s) => String(s ?? '')),
    confirmAction: vi.fn(async () => true),
    ...overrides,
  };
}

describe('data.js — createDataLayer()', () => {
  let dl;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    idCounter = 0;
    deps = makeDeps();
    dl = createDataLayer(deps);
  });

  // ── Factory returns ───────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'loadData',
      'saveData',
      'loadSettings',
      'saveSettings',
      'validateTaskFields',
      'createTask',
      'createProject',
      'addTask',
      'updateTask',
      'deleteTask',
      'pushUndo',
      'undo',
      'findSimilarTask',
      'findSimilarProject',
      'findTask',
      'activeTasks',
      'doneTasks',
      'urgentTasks',
      'archivedTasks',
      'projectTasks',
      'cleanupArchive',
      'getData',
      'setData',
      'getSettings',
      'setSettings',
    ];
    keys.forEach((k) => expect(typeof dl[k]).toBe('function'));
  });

  // ── validateTaskFields ────────────────────────────────────────────
  describe('validateTaskFields', () => {
    it('corrects invalid status to todo', () => {
      const t = dl.validateTaskFields({ status: 'garbage' });
      expect(t.status).toBe('todo');
    });

    it('leaves valid status unchanged', () => {
      const t = dl.validateTaskFields({ status: 'in-progress' });
      expect(t.status).toBe('in-progress');
    });

    it('corrects invalid priority to normal', () => {
      const t = dl.validateTaskFields({ priority: 'extreme' });
      expect(t.priority).toBe('normal');
    });

    it('resets invalid dueDate to empty string', () => {
      const t = dl.validateTaskFields({ dueDate: 'not-a-date' });
      expect(t.dueDate).toBe('');
    });

    it('allows valid dueDate', () => {
      const t = dl.validateTaskFields({ dueDate: '2026-03-20' });
      expect(t.dueDate).toBe('2026-03-20');
    });

    it('allows empty dueDate', () => {
      const t = dl.validateTaskFields({ dueDate: '' });
      expect(t.dueDate).toBe('');
    });

    it('resets negative estimatedMinutes to 0', () => {
      const t = dl.validateTaskFields({ estimatedMinutes: -5 });
      expect(t.estimatedMinutes).toBe(0);
    });

    it('resets NaN estimatedMinutes to 0', () => {
      const t = dl.validateTaskFields({ estimatedMinutes: NaN });
      expect(t.estimatedMinutes).toBe(0);
    });

    it('resets Infinity estimatedMinutes to 0', () => {
      const t = dl.validateTaskFields({ estimatedMinutes: Infinity });
      expect(t.estimatedMinutes).toBe(0);
    });

    it('resets invalid horizon to short', () => {
      const t = dl.validateTaskFields({ horizon: 'forever' });
      expect(t.horizon).toBe('short');
    });

    it('resets invalid recurrence to empty', () => {
      const t = dl.validateTaskFields({ recurrence: 'biweekly' });
      expect(t.recurrence).toBe('');
    });

    it('resets non-array tags to empty array', () => {
      const t = dl.validateTaskFields({ tags: 'work' });
      expect(t.tags).toEqual([]);
    });

    it('resets non-array subtasks to empty array', () => {
      const t = dl.validateTaskFields({ subtasks: 'step1' });
      expect(t.subtasks).toEqual([]);
    });

    it('resets non-array blockedBy to empty array', () => {
      const t = dl.validateTaskFields({ blockedBy: 'id1' });
      expect(t.blockedBy).toEqual([]);
    });

    it('resets non-array updates to empty array', () => {
      const t = dl.validateTaskFields({ updates: 'u1' });
      expect(t.updates).toEqual([]);
    });

    it('resets non-boolean archived to false', () => {
      const t = dl.validateTaskFields({ archived: 'yes' });
      expect(t.archived).toBe(false);
    });

    it('truncates title longer than 500 chars', () => {
      const t = dl.validateTaskFields({ title: 'a'.repeat(600) });
      expect(t.title.length).toBe(500);
    });

    it('truncates notes longer than 10000 chars', () => {
      const t = dl.validateTaskFields({ notes: 'b'.repeat(11000) });
      expect(t.notes.length).toBe(10000);
    });
  });

  // ── createTask ────────────────────────────────────────────────────
  describe('createTask', () => {
    it('returns a task with sensible defaults', () => {
      const t = dl.createTask();
      expect(t.id).toMatch(/^t_/);
      expect(t.status).toBe('todo');
      expect(t.priority).toBe('normal');
      expect(t.tags).toEqual([]);
      expect(t.subtasks).toEqual([]);
      expect(t.archived).toBe(false);
    });

    it('merges provided overrides', () => {
      const t = dl.createTask({ title: 'My Task', priority: 'urgent' });
      expect(t.title).toBe('My Task');
      expect(t.priority).toBe('urgent');
    });

    it('truncates long title in override', () => {
      const t = dl.createTask({ title: 'x'.repeat(600) });
      expect(t.title.length).toBe(500);
    });

    it('truncates long notes in override', () => {
      const t = dl.createTask({ notes: 'y'.repeat(11000) });
      expect(t.notes.length).toBe(10000);
    });

    it('generates unique ids', () => {
      const a = dl.createTask();
      const b = dl.createTask();
      expect(a.id).not.toBe(b.id);
    });
  });

  // ── loadData / saveData round-trip ────────────────────────────────
  describe('loadData / saveData', () => {
    it('round-trips task data through localStorage', () => {
      const data = dl.getData();
      const task = dl.createTask({ title: 'Test task' });
      data.tasks.push(task);
      dl.saveData(data);

      // Create a new data layer to re-load from storage
      const dl2 = createDataLayer(makeDeps());
      const loaded = dl2.getData();
      expect(loaded.tasks.length).toBe(1);
      expect(loaded.tasks[0].title).toBe('Test task');
    });

    it('returns empty data when localStorage is empty', () => {
      localStorage.clear();
      const dl2 = createDataLayer(makeDeps());
      const data = dl2.getData();
      expect(data.tasks).toEqual([]);
      expect(data.projects).toEqual([]);
    });

    it('filters out corrupt tasks (missing id or title)', () => {
      const raw = JSON.stringify({
        _schemaVersion: 1,
        tasks: [
          { id: 't1', title: 'Good' },
          { id: '', title: 'No id' },
          { id: 't3', title: '' },
          { title: 'No id field' },
        ],
        projects: [],
      });
      localStorage.setItem('user1_taskboard_data', raw);
      const dl2 = createDataLayer(makeDeps());
      expect(dl2.getData().tasks.length).toBe(1);
      expect(dl2.getData().tasks[0].title).toBe('Good');
    });
  });

  // ── Settings ──────────────────────────────────────────────────────
  describe('loadSettings / saveSettings', () => {
    it('returns defaults when storage is empty', () => {
      const s = dl.getSettings();
      expect(s.apiKey).toBe('');
      expect(s.aiModel).toBe('claude-haiku-4-5-20251001');
    });

    it('round-trips settings', () => {
      dl.saveSettings({ apiKey: 'abc', aiModel: 'test-model' });
      const dl2 = createDataLayer(makeDeps());
      const s = dl2.getSettings();
      expect(s.apiKey).toBe('abc');
      expect(s.aiModel).toBe('test-model');
    });
  });

  // ── addTask / findTask ────────────────────────────────────────────
  describe('addTask / findTask', () => {
    it('adds a task and can find it by id', () => {
      const t = dl.createTask({ title: 'Find me' });
      dl.addTask(t);
      expect(dl.findTask(t.id)).toBeTruthy();
      expect(dl.findTask(t.id).title).toBe('Find me');
    });

    it('does not add task when no user is logged in', () => {
      deps.getCurrentUser.mockReturnValue(null);
      dl = createDataLayer(deps);
      const t = dl.createTask({ title: 'Ghost' });
      dl.addTask(t);
      expect(dl.getData().tasks.length).toBe(0);
    });
  });

  // ── updateTask ────────────────────────────────────────────────────
  describe('updateTask', () => {
    it('updates task fields', () => {
      const t = dl.createTask({ title: 'Original' });
      dl.addTask(t);
      dl.updateTask(t.id, { title: 'Updated' });
      expect(dl.findTask(t.id).title).toBe('Updated');
    });

    it('sets completedAt when marking done', () => {
      const t = dl.createTask({ title: 'Do it' });
      dl.addTask(t);
      dl.updateTask(t.id, { status: 'done' });
      expect(dl.findTask(t.id).completedAt).toBeTruthy();
    });

    it('clears completedAt when unmarking done', () => {
      const t = dl.createTask({ title: 'Do it' });
      dl.addTask(t);
      dl.updateTask(t.id, { status: 'done' });
      dl.updateTask(t.id, { status: 'todo' });
      expect(dl.findTask(t.id).completedAt).toBeNull();
    });

    it('calls maybeReflect and maybeLearnPattern on completion', () => {
      const reflect = vi.fn();
      const learn = vi.fn();
      deps.getMaybeReflect.mockReturnValue(reflect);
      deps.getMaybeLearnPattern.mockReturnValue(learn);
      dl = createDataLayer(deps);
      const t = dl.createTask({ title: 'Complete me' });
      dl.addTask(t);
      dl.updateTask(t.id, { status: 'done' });
      expect(reflect).toHaveBeenCalled();
      expect(learn).toHaveBeenCalled();
    });

    it('does not call reflect when task was already done', () => {
      const reflect = vi.fn();
      deps.getMaybeReflect.mockReturnValue(reflect);
      dl = createDataLayer(deps);
      const t = dl.createTask({ title: 'Already done', status: 'done' });
      dl.addTask(t);
      reflect.mockClear();
      dl.updateTask(t.id, { status: 'done' });
      expect(reflect).not.toHaveBeenCalled();
    });
  });

  // ── Undo system ───────────────────────────────────────────────────
  describe('pushUndo / undo', () => {
    it('undo restores data to prior state', () => {
      const t = dl.createTask({ title: 'Keep me' });
      dl.addTask(t);
      dl.pushUndo('Before delete');
      dl.getData().tasks.length = 0;
      dl.saveData(dl.getData());
      expect(dl.getData().tasks.length).toBe(0);

      dl.undo();
      expect(dl.getData().tasks.length).toBe(1);
      expect(dl.getData().tasks[0].title).toBe('Keep me');
    });

    it('undo does nothing when stack is empty', () => {
      const tasksBefore = dl.getData().tasks.length;
      dl.undo(); // should not throw
      expect(dl.getData().tasks.length).toBe(tasksBefore);
    });

    it('limits undo stack to 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        dl.pushUndo(`action ${i}`);
      }
      expect(dl.getUndoStack().length).toBe(20);
    });

    it('clearUndoStack empties the stack', () => {
      dl.pushUndo('test');
      dl.clearUndoStack();
      expect(dl.getUndoStack().length).toBe(0);
    });
  });

  // ── findSimilarTask ───────────────────────────────────────────────
  describe('findSimilarTask', () => {
    it('returns null when no tasks exist', () => {
      expect(dl.findSimilarTask('anything')).toBeNull();
    });

    it('returns a task with high title similarity', () => {
      const t = dl.createTask({ title: 'Buy groceries', project: 'p1' });
      dl.addTask(t);
      const found = dl.findSimilarTask('Buy groceries', 'p1');
      expect(found).toBeTruthy();
      expect(found.id).toBe(t.id);
    });

    it('returns null for low similarity', () => {
      const t = dl.createTask({ title: 'Buy groceries' });
      dl.addTask(t);
      expect(dl.findSimilarTask('Schedule meeting')).toBeNull();
    });

    it('falls back to cross-project search when project match is weak', () => {
      const t = dl.createTask({ title: 'Buy groceries', project: 'p2' });
      dl.addTask(t);
      // Search with a different project — should still find via cross-project fallback
      const found = dl.findSimilarTask('Buy groceries', 'p1');
      expect(found).toBeTruthy();
      expect(found.id).toBe(t.id);
    });
  });

  // ── Task queries ──────────────────────────────────────────────────
  describe('task queries', () => {
    let t1, t2, t3, t4;

    beforeEach(() => {
      t1 = dl.createTask({ title: 'Active', status: 'todo', project: 'p1' });
      t2 = dl.createTask({ title: 'Done', status: 'done', project: 'p1', completedAt: '2026-03-14T00:00:00Z' });
      t3 = dl.createTask({ title: 'Urgent', status: 'todo', priority: 'urgent', project: 'p1' });
      t4 = dl.createTask({ title: 'Archived', status: 'done', archived: true, project: 'p1' });
      dl.setData({ tasks: [t1, t2, t3, t4], projects: [{ id: 'p1', name: 'Work' }] });
    });

    it('activeTasks returns non-done, non-archived tasks', () => {
      const active = dl.activeTasks();
      expect(active.length).toBe(2);
      expect(active.find((t) => t.title === 'Done')).toBeUndefined();
      expect(active.find((t) => t.title === 'Archived')).toBeUndefined();
    });

    it('activeTasks filters by project', () => {
      const t5 = dl.createTask({ title: 'Other project', status: 'todo', project: 'p2' });
      dl.getData().tasks.push(t5);
      const active = dl.activeTasks('p1');
      expect(active.every((t) => t.project === 'p1')).toBe(true);
    });

    it('doneTasks returns done non-archived tasks', () => {
      const done = dl.doneTasks();
      expect(done.length).toBe(1);
      expect(done[0].title).toBe('Done');
    });

    it('urgentTasks returns urgent or overdue tasks', () => {
      const urgent = dl.urgentTasks();
      expect(urgent.length).toBe(1);
      expect(urgent[0].title).toBe('Urgent');
    });

    it('urgentTasks includes overdue tasks', () => {
      const overdueTask = dl.createTask({ title: 'Overdue', status: 'todo', dueDate: '2026-03-10' });
      dl.getData().tasks.push(overdueTask);
      // Bump data version so cache is invalidated
      dl.setDataVersion(dl.getDataVersion() + 1);
      const urgent = dl.urgentTasks();
      expect(urgent.find((t) => t.title === 'Overdue')).toBeTruthy();
    });

    it('archivedTasks returns only archived tasks', () => {
      const archived = dl.archivedTasks();
      expect(archived.length).toBe(1);
      expect(archived[0].title).toBe('Archived');
    });

    it('projectTasks returns non-archived tasks for a project', () => {
      const tasks = dl.projectTasks('p1');
      expect(tasks.find((t) => t.title === 'Archived')).toBeUndefined();
      expect(tasks.length).toBe(3); // Active, Done, Urgent
    });
  });

  // ── Tag filter ────────────────────────────────────────────────────
  describe('applyTagFilter', () => {
    it('filters by active tag', () => {
      deps.getActiveTagFilter.mockReturnValue('work');
      dl = createDataLayer(deps);
      const tasks = [{ tags: ['work', 'home'] }, { tags: ['personal'] }, { tags: [] }];
      const filtered = dl.applyTagFilter(tasks);
      expect(filtered.length).toBe(1);
      expect(filtered[0].tags).toContain('work');
    });

    it('returns all tasks when no tag filter is active', () => {
      const tasks = [{ tags: ['a'] }, { tags: ['b'] }];
      expect(dl.applyTagFilter(tasks).length).toBe(2);
    });

    it('filters overdue tasks via nudge filter', () => {
      deps.getNudgeFilter.mockReturnValue('overdue');
      dl = createDataLayer(deps);
      const tasks = [
        { status: 'todo', dueDate: '2026-03-10' }, // overdue
        { status: 'todo', dueDate: '2026-03-20' }, // not overdue
        { status: 'done', dueDate: '2026-03-10' }, // done, excluded
      ];
      const filtered = dl.applyTagFilter(tasks);
      expect(filtered.length).toBe(1);
      expect(filtered[0].dueDate).toBe('2026-03-10');
    });

    it('filters unassigned tasks via nudge filter', () => {
      deps.getNudgeFilter.mockReturnValue('unassigned');
      dl = createDataLayer(deps);
      const tasks = [
        { status: 'todo', project: '' },
        { status: 'todo', project: 'p1' },
        { status: 'done', project: '' },
      ];
      const filtered = dl.applyTagFilter(tasks);
      expect(filtered.length).toBe(1);
      expect(filtered[0].project).toBe('');
    });
  });

  // ── cleanupArchive ────────────────────────────────────────────────
  describe('cleanupArchive', () => {
    it('archives done tasks older than 30 days', () => {
      const old = new Date(Date.now() - 31 * MS_PER_DAY).toISOString();
      const t = dl.createTask({ title: 'Old done', status: 'done', completedAt: old });
      dl.addTask(t);
      dl.cleanupArchive();
      expect(dl.findTask(t.id).archived).toBe(true);
    });

    it('does not archive recent done tasks', () => {
      const recent = new Date(Date.now() - 5 * MS_PER_DAY).toISOString();
      const t = dl.createTask({ title: 'Recent done', status: 'done', completedAt: recent });
      dl.addTask(t);
      dl.cleanupArchive();
      expect(dl.findTask(t.id).archived).toBe(false);
    });

    it('does not archive active tasks', () => {
      const old = new Date(Date.now() - 31 * MS_PER_DAY).toISOString();
      const t = dl.createTask({ title: 'Still active', status: 'todo', completedAt: old });
      dl.addTask(t);
      dl.cleanupArchive();
      expect(dl.findTask(t.id).archived).toBe(false);
    });

    it('shows toast with count of archived tasks', () => {
      const showToast = vi.fn();
      deps.getShowToast.mockReturnValue(showToast);
      dl = createDataLayer(deps);
      const old = new Date(Date.now() - 31 * MS_PER_DAY).toISOString();
      dl.addTask(dl.createTask({ title: 'Old 1', status: 'done', completedAt: old }));
      dl.addTask(dl.createTask({ title: 'Old 2', status: 'done', completedAt: old }));
      dl.cleanupArchive();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('2'));
    });
  });

  // ── createProject ─────────────────────────────────────────────────
  describe('createProject', () => {
    it('creates a project with defaults', () => {
      const p = dl.createProject();
      expect(p.id).toMatch(/^p_/);
      expect(p.name).toBe('');
      expect(p.color).toBeTruthy();
    });

    it('merges overrides', () => {
      const p = dl.createProject({ name: 'Work', description: 'Work stuff' });
      expect(p.name).toBe('Work');
      expect(p.description).toBe('Work stuff');
    });
  });

  // ── Render cache ──────────────────────────────────────────────────
  describe('render cache (_rc)', () => {
    it('caches and returns computed value', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 42;
      };
      expect(dl._rc('test', fn)).toBe(42);
      expect(dl._rc('test', fn)).toBe(42);
      expect(callCount).toBe(1);
    });

    it('invalidates cache when data version changes', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 'v' + callCount;
      };
      dl._rc('key', fn);
      dl.setDataVersion(dl.getDataVersion() + 1);
      const result = dl._rc('key', fn);
      expect(result).toBe('v2');
    });
  });

  // ── deleteTask ────────────────────────────────────────────────────
  describe('deleteTask', () => {
    it('archives a task instead of removing', () => {
      const t = dl.createTask({ title: 'Delete me' });
      dl.addTask(t);
      dl.deleteTask(t.id, true);
      const found = dl.findTask(t.id);
      expect(found).toBeDefined();
      expect(found.archived).toBe(true);
      expect(found.status).toBe('done');
    });

    it('cleans up blockedBy references', () => {
      const t1 = dl.createTask({ title: 'Blocker' });
      const t2 = dl.createTask({ title: 'Blocked', blockedBy: [t1.id] });
      dl.addTask(t1);
      dl.addTask(t2);
      dl.deleteTask(t1.id, true);
      expect(dl.findTask(t2.id).blockedBy).toEqual([]);
    });

    it('clears expandedTask if deleted task was expanded', () => {
      deps.getExpandedTask.mockReturnValue('t_99');
      dl = createDataLayer(deps);
      const t = dl.createTask({ title: 'Expanded' });
      // Manually set id to match
      t.id = 't_99';
      dl.addTask(t);
      dl.deleteTask('t_99', true);
      expect(deps.setExpandedTask).toHaveBeenCalledWith(null);
    });
  });

  // ── ensureLifeProject ─────────────────────────────────────────────
  describe('ensureLifeProject', () => {
    it('creates Life project if missing', () => {
      dl.ensureLifeProject();
      const data = dl.getData();
      expect(data.projects.find((p) => p.name === 'Life')).toBeTruthy();
    });

    it('does not duplicate Life project', () => {
      dl.ensureLifeProject();
      dl.ensureLifeProject();
      const data = dl.getData();
      expect(data.projects.filter((p) => p.name === 'Life').length).toBe(1);
    });
    it('getLifeProjectId returns the id of the Life project', () => {
      dl.ensureLifeProject();
      const id = dl.getLifeProjectId();
      expect(id).toMatch(/^p_/);
    });

    it('getLifeProjectId returns empty string when no Life project', () => {
      expect(dl.getLifeProjectId()).toBe('');
    });
  });

  // ── _flushSave debounce behavior ────────────────────────────────
  describe('_flushSave debounce behavior', () => {
    it('_flushSave with no pending data returns true', () => {
      expect(dl._flushSave()).toBe(true);
    });

    it('saveData writes immediately on first call, debounces subsequent', () => {
      const data = dl.getData();
      const t1 = dl.createTask({ title: 'First' });
      data.tasks.push(t1);
      // First save — immediate
      dl.saveData(data);
      const stored1 = JSON.parse(localStorage.getItem('user1_taskboard_data'));
      expect(stored1.tasks.find((t) => t.title === 'First')).toBeTruthy();

      // Second save within debounce window — should be deferred
      const t2 = dl.createTask({ title: 'Second' });
      data.tasks.push(t2);
      dl.saveData(data);
      // But _flushSave should write it
      dl._flushSave();
      const stored2 = JSON.parse(localStorage.getItem('user1_taskboard_data'));
      expect(stored2.tasks.find((t) => t.title === 'Second')).toBeTruthy();
    });

    it('saveData handles localStorage quota error gracefully', () => {
      const showToast = vi.fn();
      deps.getShowToast.mockReturnValue(showToast);
      dl = createDataLayer(deps);

      // Mock localStorage.setItem to throw
      const origSetItem = Storage.prototype.setItem;

      Storage.prototype.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      const result = dl.saveData(dl.getData());
      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Storage full'), true);
      Storage.prototype.setItem = origSetItem;
    });

    it('_flushSave handles localStorage quota error gracefully', () => {
      const showToast = vi.fn();
      deps.getShowToast.mockReturnValue(showToast);
      dl = createDataLayer(deps);
      const data = dl.getData();

      // First save to start debounce timer
      dl.saveData(data);
      // Second save within debounce to set _saveDebounceData
      dl.saveData(data);

      // Mock setItem to fail on flush
      const origSetItem = Storage.prototype.setItem;

      Storage.prototype.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      const result = dl._flushSave();
      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Storage full'), true);
      Storage.prototype.setItem = origSetItem;
    });

    it('saveData skips cloud sync in batch mode', () => {
      const syncFn = vi.fn();
      deps.getScheduleSyncToCloud.mockReturnValue(syncFn);
      deps.getBatchMode.mockReturnValue(true);
      dl = createDataLayer(deps);
      dl.saveData(dl.getData());
      expect(syncFn).not.toHaveBeenCalled();
    });

    it('saveData skips cloud sync when suppressed', () => {
      const syncFn = vi.fn();
      deps.getScheduleSyncToCloud.mockReturnValue(syncFn);
      deps.getSuppressCloudSync.mockReturnValue(true);
      dl = createDataLayer(deps);
      dl.saveData(dl.getData());
      expect(syncFn).not.toHaveBeenCalled();
    });
  });

  // ── Render cache invalidation ────────────────────────────────────
  describe('render cache invalidation', () => {
    it('_rc recomputes after saveData bumps version', () => {
      let callCount = 0;
      const fn = () => ++callCount;
      dl._rc('key', fn);
      expect(callCount).toBe(1);

      // saveData increments _dataVersion
      dl.saveData(dl.getData());
      dl._rc('key', fn);
      expect(callCount).toBe(2);
    });

    it('setRenderCache / getRenderCache work', () => {
      dl.setRenderCache({ version: 99, custom: true });
      expect(dl.getRenderCache().custom).toBe(true);
    });
  });

  // ── Task ID map rebuilding ───────────────────────────────────────
  describe('task map rebuilding', () => {
    it('getTaskMap rebuilds after data version change', () => {
      const t = dl.createTask({ title: 'Mapped' });
      dl.addTask(t);
      const map1 = dl.getTaskMap();
      expect(map1.get(t.id)).toBeTruthy();

      // Manually bump version and add task to data
      const t2 = dl.createTask({ title: 'New one' });
      dl.getData().tasks.push(t2);
      dl.setDataVersion(dl.getDataVersion() + 1);
      const map2 = dl.getTaskMap();
      expect(map2.get(t2.id)).toBeTruthy();
    });

    it('getTaskMapState / setTaskMapState work', () => {
      const t = dl.createTask({ title: 'Test' });
      dl.addTask(t);
      dl.getTaskMap(); // force build
      const state = dl.getTaskMapState();
      expect(state.map.size).toBeGreaterThan(0);

      dl.setTaskMapState(-1, new Map());
      expect(dl.getTaskMapState().map.size).toBe(0);
    });
  });

  // ── deleteTask with blockedBy cleanup ────────────────────────────
  describe('deleteTask — blockedBy cleanup (extended)', () => {
    it('removes deleted task from multiple tasks blockedBy arrays', () => {
      const blocker = dl.createTask({ title: 'Blocker' });
      const blocked1 = dl.createTask({ title: 'Blocked 1', blockedBy: [blocker.id] });
      const blocked2 = dl.createTask({ title: 'Blocked 2', blockedBy: [blocker.id, 'other_id'] });
      dl.addTask(blocker);
      dl.addTask(blocked1);
      dl.addTask(blocked2);
      dl.deleteTask(blocker.id, true);
      expect(dl.findTask(blocked1.id).blockedBy).toEqual([]);
      expect(dl.findTask(blocked2.id).blockedBy).toEqual(['other_id']);
    });

    it('deleteTask shows undo toast when not silent', () => {
      const t = dl.createTask({ title: 'Removed' });
      dl.addTask(t);
      dl.deleteTask(t.id, false);
      const toast = document.querySelector('.toast-undo');
      expect(toast).toBeTruthy();
      if (toast) toast.remove();
    });

    it('deleteTask pushes undo snapshot', () => {
      const t = dl.createTask({ title: 'Snapshottable' });
      dl.addTask(t);
      const stackBefore = dl.getUndoStack().length;
      dl.deleteTask(t.id, true);
      expect(dl.getUndoStack().length).toBe(stackBefore + 1);
    });
  });

  // ── updateTask plan cache ────────────────────────────────────────
  describe('updateTask — plan cache update', () => {
    it('marks task as completedInPlan when completing a planned task', () => {
      const t = dl.createTask({ title: 'Planned' });
      dl.addTask(t);
      const planKey = 'user1_whiteboard_plan_2026-03-15';
      localStorage.setItem(planKey, JSON.stringify([{ id: t.id, completedInPlan: false }]));
      dl.updateTask(t.id, { status: 'done' });
      const plan = JSON.parse(localStorage.getItem(planKey));
      expect(plan[0].completedInPlan).toBe(true);
    });

    it('does not crash on invalid plan cache JSON', () => {
      const t = dl.createTask({ title: 'Bad plan' });
      dl.addTask(t);
      const planKey = 'user1_whiteboard_plan_2026-03-15';
      localStorage.setItem(planKey, 'not json');
      dl.updateTask(t.id, { status: 'done' });
      // Should not throw
    });

    it('skips saveData in batch mode', () => {
      deps.getBatchMode.mockReturnValue(true);
      dl = createDataLayer(deps);
      const t = dl.createTask({ title: 'Batch' });
      dl.addTask(t);
      dl.updateTask(t.id, { title: 'Updated' });
      expect(dl.findTask(t.id).title).toBe('Updated');
    });
  });

  // ── undo with corrupted snapshot ─────────────────────────────────
  describe('undo — error handling', () => {
    it('shows error toast on corrupted snapshot', () => {
      const showToast = vi.fn();
      deps.getShowToast.mockReturnValue(showToast);
      dl = createDataLayer(deps);
      dl.getUndoStack().push({ label: 'bad', snapshot: 'not json{{{' });
      dl.undo();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('corrupted'), true);
    });
  });

  // ── findSimilarProject ──────────────────────────────────────────
  describe('findSimilarProject', () => {
    it('finds a project with similar name', () => {
      const data = dl.getData();
      data.projects.push({ id: 'p1', name: 'Work Projects' });
      const found = dl.findSimilarProject('Work Projects');
      expect(found).toBeTruthy();
      expect(found.id).toBe('p1');
    });

    it('returns null for dissimilar names', () => {
      const data = dl.getData();
      data.projects.push({ id: 'p1', name: 'Work Projects' });
      expect(dl.findSimilarProject('Vacation Plans')).toBeNull();
    });
  });

  // ── addProject / updateProject / deleteProject ──────────────────
  describe('addProject / updateProject / deleteProject', () => {
    it('addProject does nothing without current user', () => {
      deps.getCurrentUser.mockReturnValue(null);
      dl = createDataLayer(deps);
      const p = dl.createProject({ name: 'Ghost' });
      dl.addProject(p);
      expect(dl.getData().projects.length).toBe(0);
    });

    it('updateProject modifies project fields', () => {
      const p = dl.createProject({ name: 'Old' });
      dl.addProject(p);
      dl.updateProject(p.id, { name: 'New' });
      expect(dl.getData().projects.find((x) => x.id === p.id).name).toBe('New');
    });

    it('deleteProject removes project and archives its tasks', () => {
      const p = dl.createProject({ name: 'Doomed' });
      dl.addProject(p);
      const t = dl.createTask({ title: 'Project task', project: p.id });
      dl.addTask(t);
      dl.deleteProject(p.id);
      expect(dl.getData().projects.find((x) => x.id === p.id)).toBeUndefined();
      const archivedTask = dl.getData().tasks.find((x) => x.project === p.id);
      expect(archivedTask).toBeDefined();
      expect(archivedTask.archived).toBe(true);
      expect(archivedTask.archivedAt).toBeTruthy();
      expect(archivedTask.status).toBe('done');
    });
  });

  // ── addSubtask / toggleSubtask ──────────────────────────────────
  describe('addSubtask / toggleSubtask', () => {
    it('addSubtask adds subtask to task', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Child step');
      expect(dl.findTask(t.id).subtasks.length).toBe(1);
      expect(dl.findTask(t.id).subtasks[0].title).toBe('Child step');
    });

    it('addSubtask does nothing for nonexistent task', () => {
      dl.addSubtask('nonexistent', 'Step');
    });

    it('toggleSubtask toggles subtask done state', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Sub');
      const stId = dl.findTask(t.id).subtasks[0].id;
      dl.toggleSubtask(t.id, stId);
      expect(dl.findTask(t.id).subtasks[0].done).toBe(true);
      dl.toggleSubtask(t.id, stId);
      expect(dl.findTask(t.id).subtasks[0].done).toBe(false);
    });

    it('toggleSubtask does nothing for nonexistent task', () => {
      dl.toggleSubtask('nonexistent', 'st1');
    });

    it('toggleSubtask does nothing for nonexistent subtask', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.toggleSubtask(t.id, 'nonexistent');
    });
  });

  // ── Nested subtasks (addSubtask with parentSubtaskId, deleteSubtask, renameSubtask, updateSubtaskNotes) ──
  describe('nested subtask operations', () => {
    it('addSubtask with parentSubtaskId nests under parent', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Level 1');
      const st1Id = dl.findTask(t.id).subtasks[0].id;
      dl.addSubtask(t.id, 'Level 2', st1Id);
      const st1 = dl.findTask(t.id).subtasks[0];
      expect(st1.subtasks).toBeDefined();
      expect(st1.subtasks.length).toBe(1);
      expect(st1.subtasks[0].title).toBe('Level 2');
    });

    it('addSubtask falls back to root if parent not found', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Orphan', 'nonexistent_parent');
      expect(dl.findTask(t.id).subtasks.length).toBe(1);
      expect(dl.findTask(t.id).subtasks[0].title).toBe('Orphan');
    });

    it('addSubtask rejects nesting beyond MAX_SUBTASK_DEPTH', () => {
      const t = dl.createTask({ title: 'Deep' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'L0');
      let parentId = dl.findTask(t.id).subtasks[0].id;
      for (let i = 1; i < 4; i++) {
        dl.addSubtask(t.id, 'L' + i, parentId);
        const parent = dl.findTask(t.id).subtasks[0];
        let node = parent;
        for (let j = 0; j < i; j++) node = node.subtasks[0];
        parentId = node.id;
      }
      // L0(d0) → L1(d1) → L2(d2) → L3(d3) → now add L4 at depth 4 (should succeed, limit is depth >= 4)
      dl.addSubtask(t.id, 'L4', parentId);
      const countAll = (subs) => subs.reduce((n, s) => n + 1 + (s.subtasks ? countAll(s.subtasks) : 0), 0);
      expect(countAll(dl.findTask(t.id).subtasks)).toBe(5); // L0-L4 all added
      // Now try L5 at depth 5 — THIS should be rejected
      let deepNode = dl.findTask(t.id).subtasks[0];
      for (let j = 0; j < 4; j++) deepNode = deepNode.subtasks[0];
      dl.addSubtask(t.id, 'L5 too deep', deepNode.id);
      expect(countAll(dl.findTask(t.id).subtasks)).toBe(5); // L5 rejected
    });

    it('deleteSubtask removes subtask at root level', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'To delete');
      dl.addSubtask(t.id, 'To keep');
      const delId = dl.findTask(t.id).subtasks[0].id;
      dl.deleteSubtask(t.id, delId);
      expect(dl.findTask(t.id).subtasks.length).toBe(1);
      expect(dl.findTask(t.id).subtasks[0].title).toBe('To keep');
    });

    it('deleteSubtask removes nested subtask', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'L1');
      const l1Id = dl.findTask(t.id).subtasks[0].id;
      dl.addSubtask(t.id, 'L2', l1Id);
      const l2Id = dl.findTask(t.id).subtasks[0].subtasks[0].id;
      dl.deleteSubtask(t.id, l2Id);
      expect(dl.findTask(t.id).subtasks[0].subtasks.length).toBe(0);
    });

    it('deleteSubtask does nothing for nonexistent task', () => {
      dl.deleteSubtask('nonexistent', 'st1');
    });

    it('renameSubtask changes title', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Old name');
      const stId = dl.findTask(t.id).subtasks[0].id;
      dl.renameSubtask(t.id, stId, 'New name');
      expect(dl.findTask(t.id).subtasks[0].title).toBe('New name');
    });

    it('renameSubtask does nothing with empty title', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Keep');
      const stId = dl.findTask(t.id).subtasks[0].id;
      dl.renameSubtask(t.id, stId, '');
      expect(dl.findTask(t.id).subtasks[0].title).toBe('Keep');
    });

    it('updateSubtaskNotes sets notes on subtask', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'Has notes');
      const stId = dl.findTask(t.id).subtasks[0].id;
      dl.updateSubtaskNotes(t.id, stId, 'Some context here');
      expect(dl.findTask(t.id).subtasks[0].notes).toBe('Some context here');
    });

    it('updateSubtaskNotes works on nested subtask', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'L1');
      const l1Id = dl.findTask(t.id).subtasks[0].id;
      dl.addSubtask(t.id, 'L2', l1Id);
      const l2Id = dl.findTask(t.id).subtasks[0].subtasks[0].id;
      dl.updateSubtaskNotes(t.id, l2Id, 'Deep notes');
      expect(dl.findTask(t.id).subtasks[0].subtasks[0].notes).toBe('Deep notes');
    });

    it('toggleSubtask works on nested subtask', () => {
      const t = dl.createTask({ title: 'Parent' });
      dl.addTask(t);
      dl.addSubtask(t.id, 'L1');
      const l1Id = dl.findTask(t.id).subtasks[0].id;
      dl.addSubtask(t.id, 'L2', l1Id);
      const l2Id = dl.findTask(t.id).subtasks[0].subtasks[0].id;
      dl.toggleSubtask(t.id, l2Id);
      expect(dl.findTask(t.id).subtasks[0].subtasks[0].done).toBe(true);
    });
  });

  // ── unarchiveTask / deleteArchivedPermanently ───────────────────
  describe('unarchiveTask / deleteArchivedPermanently', () => {
    it('unarchiveTask restores an archived task', () => {
      const t = dl.createTask({ title: 'Archived', archived: true });
      dl.addTask(t);
      dl.unarchiveTask(t.id);
      expect(dl.findTask(t.id).archived).toBe(false);
    });

    it('deleteArchivedPermanently removes all archived tasks', async () => {
      const t1 = dl.createTask({ title: 'Archived 1', archived: true });
      const t2 = dl.createTask({ title: 'Active', archived: false });
      dl.addTask(t1);
      dl.addTask(t2);
      await dl.deleteArchivedPermanently();
      expect(dl.getData().tasks.length).toBe(1);
      expect(dl.getData().tasks[0].title).toBe('Active');
    });

    it('deleteArchivedPermanently does nothing when user cancels', async () => {
      deps.confirmAction.mockResolvedValue(false);
      dl = createDataLayer(deps);
      const t = dl.createTask({ title: 'Archived', archived: true });
      dl.addTask(t);
      await dl.deleteArchivedPermanently();
      expect(dl.getData().tasks.length).toBe(1);
    });
  });

  // ── applyTagFilter — stale nudge filter ─────────────────────────
  describe('applyTagFilter — stale nudge filter', () => {
    it('filters stale tasks (no updates for > 10 days)', () => {
      deps.getNudgeFilter.mockReturnValue('stale');
      dl = createDataLayer(deps);
      const old = new Date(Date.now() - 11 * MS_PER_DAY).toISOString();
      const recent = new Date(Date.now() - 1 * MS_PER_DAY).toISOString();
      const tasks = [
        { status: 'todo', createdAt: old, updates: [] },
        { status: 'todo', createdAt: recent, updates: [] },
        { status: 'done', createdAt: old, updates: [] },
      ];
      const filtered = dl.applyTagFilter(tasks);
      expect(filtered.length).toBe(1);
      expect(filtered[0].createdAt).toBe(old);
    });
  });

  // ── loadData backup on schema mismatch ──────────────────────────
  describe('loadData — schema backup', () => {
    it('creates backup when schema version differs', () => {
      const raw = JSON.stringify({
        _schemaVersion: 0,
        tasks: [{ id: 't1', title: 'Existing' }],
        projects: [],
      });
      localStorage.setItem('user1_taskboard_data', raw);
      createDataLayer(makeDeps());
      const backup = localStorage.getItem('user1_taskboard_data_backup');
      expect(backup).toBeTruthy();
      expect(JSON.parse(backup)._schemaVersion).toBe(0);
    });
  });

  // ── saveSettings triggers cloud sync ────────────────────────────
  describe('saveSettings', () => {
    it('triggers cloud sync after saving', () => {
      const syncFn = vi.fn();
      deps.getScheduleSyncToCloud.mockReturnValue(syncFn);
      dl = createDataLayer(deps);
      dl.saveSettings({ apiKey: 'test' });
      expect(syncFn).toHaveBeenCalled();
    });
  });

  // ── loadSettings error handling ─────────────────────────────────
  describe('loadSettings — error handling', () => {
    it('returns defaults on parse error', () => {
      localStorage.setItem('user1_taskboard_settings', 'bad json{{{');
      const dl2 = createDataLayer(makeDeps());
      expect(dl2.getSettings().apiKey).toBe('');
    });
  });

  // ── Saved views CRUD ──────────────────────────────────────────
  describe('saved views', () => {
    it('starts with empty savedViews', () => {
      expect(dl.getSavedViews()).toEqual([]);
    });

    it('adds a saved view', () => {
      dl.addSavedView({ id: 'sv1', name: 'Urgent', filters: { priority: 'urgent' } });
      expect(dl.getSavedViews().length).toBe(1);
      expect(dl.getSavedViews()[0].name).toBe('Urgent');
    });

    it('deletes a saved view', () => {
      dl.addSavedView({ id: 'sv1', name: 'Urgent', filters: { priority: 'urgent' } });
      dl.addSavedView({ id: 'sv2', name: 'Waiting', filters: { status: 'waiting' } });
      dl.deleteSavedView('sv1');
      expect(dl.getSavedViews().length).toBe(1);
      expect(dl.getSavedViews()[0].id).toBe('sv2');
    });

    it('updates a saved view', () => {
      dl.addSavedView({ id: 'sv1', name: 'Old Name', filters: { priority: 'urgent' } });
      dl.updateSavedView('sv1', { name: 'New Name' });
      expect(dl.getSavedViews()[0].name).toBe('New Name');
    });

    it('initializes savedViews on loadData', () => {
      localStorage.setItem('user1_taskboard_data', JSON.stringify({
        _schemaVersion: 1,
        tasks: [{ id: 't1', title: 'A' }],
        projects: [],
      }));
      const dl2 = createDataLayer(makeDeps());
      dl2.setData(dl2.loadData());
      expect(dl2.getSavedViews()).toEqual([]);
    });

    it('preserves savedViews from storage', () => {
      localStorage.setItem('user1_taskboard_data', JSON.stringify({
        _schemaVersion: 1,
        tasks: [{ id: 't1', title: 'A' }],
        projects: [],
        savedViews: [{ id: 'sv1', name: 'Test', filters: { priority: 'urgent' } }],
      }));
      const dl2 = createDataLayer(makeDeps());
      const loaded = dl2.loadData();
      expect(loaded.savedViews.length).toBe(1);
      expect(loaded.savedViews[0].name).toBe('Test');
    });
  });

  // ── applyFilters — multi-dimension filter ─────────────────────
  describe('applyFilters', () => {
    it('filters by status', () => {
      const tasks = [
        { status: 'todo', priority: 'normal' },
        { status: 'waiting', priority: 'normal' },
        { status: 'in-progress', priority: 'normal' },
      ];
      expect(dl.applyFilters(tasks, { status: 'waiting' }).length).toBe(1);
    });

    it('filters by priority', () => {
      const tasks = [
        { priority: 'urgent' },
        { priority: 'normal' },
        { priority: 'low' },
      ];
      expect(dl.applyFilters(tasks, { priority: 'urgent' }).length).toBe(1);
    });

    it('filters by project', () => {
      const tasks = [
        { project: 'p1' },
        { project: 'p2' },
        { project: '' },
      ];
      expect(dl.applyFilters(tasks, { project: 'p1' }).length).toBe(1);
    });

    it('filters by tags (all must match)', () => {
      const tasks = [
        { tags: ['work', 'urgent'] },
        { tags: ['work'] },
        { tags: ['personal'] },
      ];
      expect(dl.applyFilters(tasks, { tags: ['work', 'urgent'] }).length).toBe(1);
      expect(dl.applyFilters(tasks, { tags: ['work'] }).length).toBe(2);
    });

    it('filters by dueBefore', () => {
      const tasks = [
        { dueDate: '2026-03-10' },
        { dueDate: '2026-03-20' },
        { dueDate: '' },
      ];
      expect(dl.applyFilters(tasks, { dueBefore: '2026-03-15' }).length).toBe(1);
    });

    it('filters by dueAfter', () => {
      const tasks = [
        { dueDate: '2026-03-10' },
        { dueDate: '2026-03-20' },
        { dueDate: '' },
      ];
      expect(dl.applyFilters(tasks, { dueAfter: '2026-03-15' }).length).toBe(1);
    });

    it('filters by hasSubtasks', () => {
      const tasks = [
        { subtasks: [{ id: 's1', title: 'Sub' }] },
        { subtasks: [] },
        {},
      ];
      expect(dl.applyFilters(tasks, { hasSubtasks: true }).length).toBe(1);
      expect(dl.applyFilters(tasks, { hasSubtasks: false }).length).toBe(2);
    });

    it('filters by noDate', () => {
      const tasks = [
        { dueDate: '2026-03-10' },
        { dueDate: '' },
        {},
      ];
      expect(dl.applyFilters(tasks, { noDate: true }).length).toBe(2);
    });

    it('combines multiple filters', () => {
      const tasks = [
        { status: 'todo', priority: 'urgent', dueDate: '2026-03-10' },
        { status: 'todo', priority: 'normal', dueDate: '2026-03-10' },
        { status: 'waiting', priority: 'urgent', dueDate: '2026-03-10' },
      ];
      expect(dl.applyFilters(tasks, { status: 'todo', priority: 'urgent' }).length).toBe(1);
    });

    it('returns all tasks with empty filters', () => {
      const tasks = [{ id: '1' }, { id: '2' }];
      expect(dl.applyFilters(tasks, {}).length).toBe(2);
      expect(dl.applyFilters(tasks, null).length).toBe(2);
    });
  });
});
