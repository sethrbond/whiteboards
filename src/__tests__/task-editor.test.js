import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskEditor } from '../task-editor.js';

function makeDeps(overrides = {}) {
  return {
    $: vi.fn((sel) => document.querySelector(sel)),
    esc: vi.fn((s) => (s == null ? '' : String(s))),
    todayStr: vi.fn(() => '2026-03-15'),
    fmtDate: vi.fn((d) => d),
    fmtEstimate: vi.fn((m) => (m < 60 ? m + 'm' : m / 60 + 'h')),
    relativeTime: vi.fn(() => 'just now'),
    genId: vi.fn((prefix) => `${prefix}_gen`),
    getData: vi.fn(() => ({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    })),
    findTask: vi.fn(() => null),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTask: vi.fn(),
    createTask: vi.fn((t) => ({ id: 't_new', ...t })),
    saveData: vi.fn(),
    render: vi.fn(),
    showToast: vi.fn(),
    setModalLabel: vi.fn(),
    pushModalState: vi.fn(),
    closeModal: vi.fn(),
    trapFocus: vi.fn(() => vi.fn()),
    getTrapFocusCleanup: vi.fn(() => null),
    setTrapFocusCleanup: vi.fn(),
    setModalTriggerEl: vi.fn(),
    getExpandedTask: vi.fn(() => null),
    setExpandedTask: vi.fn(),
    getBulkMode: vi.fn(() => false),
    getBulkSelected: vi.fn(() => new Set()),
    getProactiveLog: vi.fn(() => []),
    isBlocked: vi.fn(() => false),
    renderSubtaskProgress: vi.fn(() => ''),
    renderBlockedBy: vi.fn(() => ''),
    renderBlocking: vi.fn(() => ''),
    renderTagChips: vi.fn(() => ''),
    renderTagPicker: vi.fn(() => '<div id="fTagPicker"></div>'),
    smartDateInput: vi.fn((_id, _val) => '<input id="fDue" type="date">'),
    resolveSmartDate: vi.fn(() => ''),
    hasAI: vi.fn(() => false),
    callAI: vi.fn(async () => ''),
    AI_PERSONA_SHORT: 'You are a test assistant.',
    matchTask: vi.fn(() => null),
    maybeProactiveEnhance: vi.fn(),
    ...overrides,
  };
}

describe('task-editor.js — createTaskEditor()', () => {
  let editor;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    document.getElementById('modalRoot').innerHTML = '';
    deps = makeDeps();
    editor = createTaskEditor(deps);
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'openNewTask',
      'saveNewTask',
      'openEditTask',
      'saveEditTask',
      'autoClassifyTask',
      'attachInlineEdit',
      'renderTaskExpanded',
      'renderTaskRow',
      'renderPriorityTag',
      'priorityColor',
      'taskNudge',
      'runTaskCmd',
      'runTaskCmdAI',
      'addDep',
      'removeDep',
      'showDepResults',
      'selectDep',
      'wouldCreateCircularDep',
    ];
    keys.forEach((k) => expect(typeof editor[k]).toBe('function'));
  });

  // ── renderPriorityTag ─────────────────────────────────────────────
  it('renderPriorityTag returns HTML with capitalized priority', () => {
    const tag = editor.renderPriorityTag('urgent');
    expect(tag).toContain('Urgent');
    expect(tag).toContain('tag-urgent');
  });

  it('renderPriorityTag handles normal priority', () => {
    const tag = editor.renderPriorityTag('normal');
    expect(tag).toContain('Normal');
  });

  it('renderPriorityTag handles low priority', () => {
    const tag = editor.renderPriorityTag('low');
    expect(tag).toContain('Low');
    expect(tag).toContain('tag-low');
  });

  it('renderPriorityTag handles important priority', () => {
    const tag = editor.renderPriorityTag('important');
    expect(tag).toContain('Important');
    expect(tag).toContain('tag-important');
  });

  // ── priorityColor ─────────────────────────────────────────────────
  it('priorityColor returns red for urgent', () => {
    expect(editor.priorityColor('urgent')).toBe('var(--red)');
  });

  it('priorityColor returns orange for important', () => {
    expect(editor.priorityColor('important')).toBe('var(--orange)');
  });

  it('priorityColor returns accent for normal', () => {
    expect(editor.priorityColor('normal')).toBe('var(--accent)');
  });

  it('priorityColor returns text3 for low', () => {
    expect(editor.priorityColor('low')).toBe('var(--text3)');
  });

  it('priorityColor returns text3 for unknown priority', () => {
    expect(editor.priorityColor('unknown')).toBe('var(--text3)');
  });

  // ── taskNudge ─────────────────────────────────────────────────────
  it('taskNudge returns empty string for done tasks', () => {
    expect(editor.taskNudge({ id: 't_1', status: 'done' })).toBe('');
  });

  it('taskNudge suggests adding deadline for high-priority tasks without dueDate', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'Short',
      priority: 'urgent',
    });
    expect(nudge).toContain('deadline');
  });

  it('taskNudge suggests adding details for short-titled tasks without notes', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'Short',
      priority: 'normal',
    });
    expect(nudge).toContain('details');
  });

  it('taskNudge suggests adding project when none assigned', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'Short',
      priority: 'normal',
    });
    expect(nudge).toContain('project');
  });

  it('taskNudge returns empty when all fields are filled', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'A sufficiently long task title here',
      notes: 'some notes',
      dueDate: '2026-03-20',
      project: 'p_1',
      priority: 'normal',
    });
    expect(nudge).toBe('');
  });

  it('taskNudge does not suggest deadline for low priority', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'Short',
      priority: 'low',
    });
    expect(nudge).not.toContain('deadline');
  });

  it('taskNudge does not suggest details for long titles', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'This is a very long task title that exceeds thirty characters',
      priority: 'normal',
      dueDate: '2026-03-20',
      project: 'p_1',
    });
    expect(nudge).toBe('');
  });

  it('taskNudge does not suggest details when notes are present', () => {
    const nudge = editor.taskNudge({
      id: 't_1',
      status: 'todo',
      title: 'Short',
      priority: 'low',
      notes: 'Has notes',
      project: 'p_1',
    });
    expect(nudge).toBe('');
  });

  it('taskNudge includes data-action and task id', () => {
    const nudge = editor.taskNudge({
      id: 't_42',
      status: 'todo',
      title: 'Short',
      priority: 'normal',
    });
    expect(nudge).toContain('data-action="task-nudge"');
    expect(nudge).toContain('data-task-id="t_42"');
  });

  // ── renderTaskRow ─────────────────────────────────────────────────
  it('renderTaskRow returns HTML with task title', () => {
    const t = { id: 't_1', title: 'Test task', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('Test task');
    expect(html).toContain('data-task="t_1"');
  });

  it('renderTaskRow applies done-text class for completed tasks', () => {
    const t = { id: 't_1', title: 'Done task', priority: 'normal', status: 'done' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('done-text');
    expect(html).toContain('done');
  });

  it('renderTaskRow shows project tag when showProject is true', () => {
    const t = { id: 't_1', title: 'Work task', priority: 'normal', status: 'todo', project: 'p_1' };
    deps.getData.mockReturnValue({
      tasks: [t],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const html = editor.renderTaskRow(t, true);
    expect(html).toContain('Work');
  });

  it('renderTaskRow delegates to renderTaskExpanded when task is expanded', () => {
    deps.getExpandedTask.mockReturnValue('t_1');
    const t = {
      id: 't_1',
      title: 'Expanded task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskRow(t);
    expect(html).toContain('task-expanded');
  });

  it('renderTaskRow shows red left border for urgent tasks', () => {
    const t = { id: 't_1', title: 'Urgent task', priority: 'urgent', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('var(--red)');
  });

  it('renderTaskRow shows orange left border for important tasks', () => {
    const t = { id: 't_1', title: 'Important task', priority: 'important', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('var(--orange)');
  });

  it('renderTaskRow shows transparent border for normal tasks', () => {
    const t = { id: 't_1', title: 'Normal task', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('border-left:3px solid transparent');
  });

  it('renderTaskRow does not show priority label for low tasks', () => {
    const t = { id: 't_1', title: 'Low task', priority: 'low', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).not.toContain('P1');
    expect(html).not.toContain('P2');
    expect(html).not.toContain('P3');
  });

  it('renderTaskRow does not show priority label for done tasks', () => {
    const t = { id: 't_1', title: 'Done urgent', priority: 'urgent', status: 'done' };
    const html = editor.renderTaskRow(t);
    expect(html).not.toContain('P1');
  });

  it('renderTaskRow uses subtle left-border for urgent tasks', () => {
    const t = { id: 't_1', title: 'Urgent', priority: 'urgent', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('border-left:3px solid var(--red)');
  });

  it('renderTaskRow uses subtle left-border for important tasks', () => {
    const t = { id: 't_1', title: 'Important', priority: 'important', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('border-left:3px solid var(--orange)');
  });

  it('renderTaskRow shows blocked indicator', () => {
    deps.isBlocked.mockReturnValue(true);
    const t = { id: 't_1', title: 'Blocked', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('opacity:0.55');
  });

  it('renderTaskRow shows bulk check when bulk mode is on', () => {
    deps.getBulkMode.mockReturnValue(true);
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('bulk-check');
    expect(html).toContain('data-bulk="t_1"');
  });

  it('renderTaskRow shows selected bulk check', () => {
    deps.getBulkMode.mockReturnValue(true);
    deps.getBulkSelected.mockReturnValue(new Set(['t_1']));
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('bulk-check on');
  });

  it('renderTaskRow renders clean task title without AI badge', () => {
    deps.getProactiveLog.mockReturnValue([{ taskId: 't_1' }]);
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('Task');
    // AI badge removed in v3 calm aesthetic
    expect(html).not.toContain('AI prepared');
  });

  it('renderTaskRow shows notes', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo', notes: 'My notes' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('task-note');
    expect(html).toContain('My notes');
  });

  it('renderTaskRow shows recurrence tag', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo', recurrence: 'weekly' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('weekly');
  });

  it('renderTaskRow shows estimated time as subtle text', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo', estimatedMinutes: 30 };
    const html = editor.renderTaskRow(t);
    // Estimated time shown as simple text, not a titled tag
    expect(html).toContain('30m');
  });

  it('renderTaskRow shows overdue class for past due tasks', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo', dueDate: '2026-03-10' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('overdue');
  });

  it('renderTaskRow does not show overdue for done tasks', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'done', dueDate: '2026-03-10' };
    const html = editor.renderTaskRow(t);
    expect(html).not.toContain('overdue');
  });

  it('renderTaskRow omits phase tag from row (shown in expanded view only)', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo', phase: 'Phase 1' };
    const html = editor.renderTaskRow(t);
    // Phase moved to expanded view in v3
    expect(html).not.toContain('Phase 1');
  });

  it('renderTaskRow hides done button for completed tasks', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'done' };
    const html = editor.renderTaskRow(t);
    expect(html).not.toContain('complete-task');
  });

  it('renderTaskRow shows done button for non-done tasks', () => {
    const t = { id: 't_1', title: 'Task', priority: 'normal', status: 'todo' };
    const html = editor.renderTaskRow(t);
    expect(html).toContain('complete-task');
  });

  it('renderTaskRow calls renderSubtaskProgress for tasks with subtasks', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      subtasks: [{ id: 's1', title: 'Sub', done: false }],
    };
    editor.renderTaskRow(t);
    expect(deps.renderSubtaskProgress).toHaveBeenCalledWith(t.subtasks);
  });

  // ── renderTaskExpanded ────────────────────────────────────────────
  it('renderTaskExpanded returns expanded HTML with detail rows', () => {
    const t = {
      id: 't_1',
      title: 'Expanded task',
      priority: 'urgent',
      status: 'todo',
      createdAt: '2026-03-10T10:00:00Z',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('task-expanded');
    expect(html).toContain('Priority');
    expect(html).toContain('Horizon');
  });

  it('renderTaskExpanded shows done-text for completed tasks', () => {
    const t = {
      id: 't_1',
      title: 'Done',
      priority: 'normal',
      status: 'done',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('done-text');
    expect(html).toContain('done');
  });

  it('renderTaskExpanded shows project tag when showProject is true', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      project: 'p_1',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({
      tasks: [t],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const html = editor.renderTaskExpanded(t, true);
    expect(html).toContain('Work');
    expect(html).toContain('tag-project');
  });

  it('renderTaskExpanded shows due date', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      dueDate: '2026-03-20',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('Due');
    expect(html).toContain('2026-03-20');
  });

  it('renderTaskExpanded shows estimated minutes', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      estimatedMinutes: 60,
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('Estimate');
  });

  it('renderTaskExpanded shows phase', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      phase: 'Phase 2',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('Phase');
    expect(html).toContain('Phase 2');
  });

  it('renderTaskExpanded shows completedAt for done tasks', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'done',
      completedAt: '2026-03-14',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('Done');
  });

  it('renderTaskExpanded shows in-progress tag', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'in-progress',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('In Progress');
  });

  it('renderTaskExpanded shows subtasks', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'short',
      subtasks: [
        { id: 's1', title: 'Sub 1', done: false },
        { id: 's2', title: 'Sub 2', done: true },
      ],
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('SUBTASKS');
    expect(html).toContain('Sub 1');
    expect(html).toContain('Sub 2');
    expect(html).toContain('toggle-subtask');
  });

  it('renderTaskExpanded shows updates', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'short',
      updates: [{ date: '2026-03-14', text: 'Made progress' }],
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('UPDATES');
    expect(html).toContain('Made progress');
  });

  it('renderTaskExpanded shows command input', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('task-cmd');
    expect(html).toContain('data-cmd="t_1"');
  });

  it('renderTaskExpanded shows short-term horizon label', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('Short-term');
  });

  it('renderTaskExpanded shows long-term horizon label', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'long',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    const html = editor.renderTaskExpanded(t);
    expect(html).toContain('Long-term');
  });

  it('renderTaskExpanded calls renderBlockedBy and renderBlocking', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-03-10',
      horizon: 'short',
    };
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    editor.renderTaskExpanded(t);
    expect(deps.renderBlockedBy).toHaveBeenCalledWith(t);
    expect(deps.renderBlocking).toHaveBeenCalledWith(t);
  });

  // ── openNewTask ───────────────────────────────────────────────────
  it('openNewTask renders the new task modal', () => {
    editor.openNewTask('p_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('New Task');
    expect(modal.innerHTML).toContain('fTitle');
  });

  it('openNewTask pre-selects the project', () => {
    editor.openNewTask('p_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('selected');
  });

  it('openNewTask calls pushModalState', () => {
    editor.openNewTask();
    expect(deps.pushModalState).toHaveBeenCalledWith('new-task');
  });

  it('openNewTask sets up focus trapping', () => {
    editor.openNewTask();
    expect(deps.trapFocus).toHaveBeenCalled();
    expect(deps.setTrapFocusCleanup).toHaveBeenCalled();
  });

  it('openNewTask with prefillDate sets the date value', () => {
    editor.openNewTask('', '2026-04-01');
    expect(deps.smartDateInput).toHaveBeenCalledWith('fDue', '2026-04-01');
  });

  // ── saveNewTask ───────────────────────────────────────────────────
  it('saveNewTask does nothing when title is empty', () => {
    editor.openNewTask('');
    document.getElementById('fTitle').value = '';
    editor.saveNewTask();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it('saveNewTask creates task with provided title', () => {
    editor.openNewTask('');
    document.getElementById('fTitle').value = 'New task title';
    document.getElementById('fNotes').value = 'Some notes';
    editor.saveNewTask();
    expect(deps.createTask).toHaveBeenCalled();
    expect(deps.addTask).toHaveBeenCalled();
    expect(deps.closeModal).toHaveBeenCalled();
    expect(deps.render).toHaveBeenCalled();
  });

  it('saveNewTask calls maybeProactiveEnhance', () => {
    editor.openNewTask('');
    document.getElementById('fTitle').value = 'Task';
    editor.saveNewTask();
    expect(deps.maybeProactiveEnhance).toHaveBeenCalled();
  });

  it('saveNewTask triggers autoClassify when AI available, normal priority, no project', () => {
    deps.hasAI.mockReturnValue(true);
    editor = createTaskEditor(deps);
    editor.openNewTask('');
    document.getElementById('fTitle').value = 'Task to classify';
    editor.saveNewTask();
    // autoClassifyTask was called (we can check callAI was invoked indirectly)
    expect(deps.callAI).toHaveBeenCalled();
  });

  it('saveNewTask does not autoClassify when project is selected', () => {
    deps.hasAI.mockReturnValue(true);
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    editor = createTaskEditor(deps);
    editor.openNewTask('p_1');
    document.getElementById('fTitle').value = 'Task';
    // fProject should be selected to p_1
    editor.saveNewTask();
    // callAI should not be called because project is set
    expect(deps.callAI).not.toHaveBeenCalled();
  });

  // ── openEditTask ──────────────────────────────────────────────────
  it('openEditTask does nothing when task is not found', () => {
    document.getElementById('modalRoot').innerHTML = '';
    deps.findTask.mockReturnValue(null);
    editor.openEditTask('t_nonexistent');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toBe('');
  });

  it('openEditTask renders edit modal for existing task', () => {
    const t = {
      id: 't_1',
      title: 'Edit me',
      notes: 'notes',
      priority: 'normal',
      status: 'todo',
      project: 'p_1',
      dueDate: '2026-03-20',
      phase: '',
      recurrence: '',
      estimatedMinutes: 30,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({
      tasks: [t],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    editor.openEditTask('t_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Edit Task');
    expect(modal.innerHTML).toContain('Edit me');
  });

  it('openEditTask shows status selector', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'in-progress',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    editor.openEditTask('t_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('fStatus');
    expect(modal.innerHTML).toContain('In Progress');
  });

  it('openEditTask shows recurrence selector', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: 'weekly',
      estimatedMinutes: 0,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    editor.openEditTask('t_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('fRecurrence');
  });

  it('openEditTask shows estimate input with quick buttons', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 60,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    editor.openEditTask('t_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('fEstimate');
    expect(modal.innerHTML).toContain('set-estimate');
  });

  it('openEditTask shows blocked-by dependencies', () => {
    const blocker = { id: 't_2', title: 'Blocker task' };
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: [],
      blockedBy: ['t_2'],
    };
    deps.findTask.mockImplementation((id) => {
      if (id === 't_1') return t;
      if (id === 't_2') return blocker;
      return null;
    });
    editor.openEditTask('t_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Blocker task');
    expect(modal.innerHTML).toContain('data-dep="t_2"');
  });

  it('openEditTask calls setModalTriggerEl and pushModalState', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    editor.openEditTask('t_1');
    expect(deps.setModalTriggerEl).toHaveBeenCalled();
    expect(deps.setModalLabel).toHaveBeenCalledWith('Edit task');
    expect(deps.pushModalState).toHaveBeenCalledWith('edit-task');
  });

  it('openEditTask shows delete button', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    editor.openEditTask('t_1');
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('delete-task-confirm');
  });

  // ── saveEditTask ──────────────────────────────────────────────────
  it('saveEditTask updates task and closes modal', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: [],
    };
    deps.findTask.mockReturnValue(t);
    editor.openEditTask('t_1');
    document.getElementById('fTitle').value = 'Updated title';
    document.getElementById('fNotes').value = 'Updated notes';
    editor.saveEditTask('t_1');
    expect(deps.updateTask).toHaveBeenCalledWith(
      't_1',
      expect.objectContaining({
        title: 'Updated title',
        notes: 'Updated notes',
      }),
    );
    expect(deps.closeModal).toHaveBeenCalled();
    expect(deps.render).toHaveBeenCalled();
  });

  it('saveEditTask collects tags from selected chips', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: ['work'],
    };
    deps.findTask.mockReturnValue(t);
    // Mock renderTagPicker to produce selectable chips
    deps.renderTagPicker.mockReturnValue(
      '<span class="tag-chip selected" data-tag="work">work</span><span class="tag-chip" data-tag="personal">personal</span>',
    );
    editor = createTaskEditor(deps);
    editor.openEditTask('t_1');
    editor.saveEditTask('t_1');
    expect(deps.updateTask).toHaveBeenCalledWith(
      't_1',
      expect.objectContaining({
        tags: ['work'],
      }),
    );
  });

  it('saveEditTask collects blocked-by dependencies', () => {
    const t = {
      id: 't_1',
      title: 'Task',
      notes: '',
      priority: 'normal',
      status: 'todo',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '',
      estimatedMinutes: 0,
      tags: [],
      blockedBy: ['t_2'],
    };
    deps.findTask.mockImplementation((id) => {
      if (id === 't_1') return t;
      if (id === 't_2') return { id: 't_2', title: 'Blocker' };
      return null;
    });
    editor.openEditTask('t_1');
    editor.saveEditTask('t_1');
    expect(deps.updateTask).toHaveBeenCalledWith(
      't_1',
      expect.objectContaining({
        blockedBy: ['t_2'],
      }),
    );
  });

  // ── attachInlineEdit ──────────────────────────────────────────────
  it('attachInlineEdit does not throw when no elements exist', () => {
    expect(() => editor.attachInlineEdit()).not.toThrow();
  });

  it('attachInlineEdit binds dblclick on inline-edit elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Task Title</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    const el = container.querySelector('[data-inline-edit]');
    expect(el._inlineEditBound).toBe(true);
    container.remove();
  });

  it('attachInlineEdit does not rebind already-bound elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Task Title</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    editor.attachInlineEdit(); // second call should not rebind
    const el = container.querySelector('[data-inline-edit]');
    expect(el._inlineEditBound).toBe(true);
    container.remove();
  });

  it('attachInlineEdit dblclick makes element editable', () => {
    const t = { id: 't_1', title: 'Original' };
    deps.findTask.mockReturnValue(t);
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Original</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    const el = container.querySelector('[data-inline-edit]');
    el.dispatchEvent(new Event('dblclick', { bubbles: true }));
    expect(el.contentEditable).toBe('true');
    expect(el.classList.contains('task-title-editable')).toBe(true);
    container.remove();
  });

  it('attachInlineEdit blur saves updated title', () => {
    const t = { id: 't_1', title: 'Original' };
    deps.findTask.mockReturnValue(t);
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Original</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    const el = container.querySelector('[data-inline-edit]');
    el.dispatchEvent(new Event('dblclick', { bubbles: true }));
    el.textContent = 'Updated Title';
    el.dispatchEvent(new Event('blur'));
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { title: 'Updated Title' });
    expect(deps.showToast).toHaveBeenCalledWith('Title updated', false, true);
    container.remove();
  });

  it('attachInlineEdit blur reverts if title unchanged', () => {
    const t = { id: 't_1', title: 'Original' };
    deps.findTask.mockReturnValue(t);
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Original</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    const el = container.querySelector('[data-inline-edit]');
    el.dispatchEvent(new Event('dblclick', { bubbles: true }));
    // Keep same text
    el.dispatchEvent(new Event('blur'));
    expect(deps.updateTask).not.toHaveBeenCalled();
    expect(el.textContent).toBe('Original');
    container.remove();
  });

  it('attachInlineEdit blur reverts if title is empty', () => {
    const t = { id: 't_1', title: 'Original' };
    deps.findTask.mockReturnValue(t);
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Original</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    const el = container.querySelector('[data-inline-edit]');
    el.dispatchEvent(new Event('dblclick', { bubbles: true }));
    el.textContent = '   ';
    el.dispatchEvent(new Event('blur'));
    expect(deps.updateTask).not.toHaveBeenCalled();
    expect(el.textContent).toBe('Original');
    container.remove();
  });

  it('attachInlineEdit dblclick does nothing if task not found', () => {
    deps.findTask.mockReturnValue(null);
    const container = document.createElement('div');
    container.innerHTML = '<div data-inline-edit="t_1">Title</div>';
    document.body.appendChild(container);
    editor.attachInlineEdit();
    const el = container.querySelector('[data-inline-edit]');
    el.dispatchEvent(new Event('dblclick', { bubbles: true }));
    expect(el.contentEditable).not.toBe('true');
    container.remove();
  });

  // ── wouldCreateCircularDep ────────────────────────────────────────
  it('wouldCreateCircularDep returns false for unrelated tasks', () => {
    deps.findTask.mockReturnValue(null);
    expect(editor.wouldCreateCircularDep('t_1', 't_2')).toBe(false);
  });

  it('wouldCreateCircularDep detects direct circular dependency', () => {
    deps.findTask.mockImplementation((id) => {
      if (id === 't_2') return { id: 't_2', blockedBy: ['t_1'] };
      return null;
    });
    expect(editor.wouldCreateCircularDep('t_1', 't_2')).toBe(true);
  });

  it('wouldCreateCircularDep detects indirect circular dependency', () => {
    deps.findTask.mockImplementation((id) => {
      if (id === 't_2') return { id: 't_2', blockedBy: ['t_3'] };
      if (id === 't_3') return { id: 't_3', blockedBy: ['t_1'] };
      return null;
    });
    expect(editor.wouldCreateCircularDep('t_1', 't_2')).toBe(true);
  });

  it('wouldCreateCircularDep handles visited nodes (avoids infinite loop)', () => {
    deps.findTask.mockImplementation((id) => {
      if (id === 't_2') return { id: 't_2', blockedBy: ['t_3'] };
      if (id === 't_3') return { id: 't_3', blockedBy: ['t_2'] }; // cycle not involving t_1
      return null;
    });
    expect(editor.wouldCreateCircularDep('t_1', 't_2')).toBe(false);
  });

  it('wouldCreateCircularDep handles tasks without blockedBy', () => {
    deps.findTask.mockImplementation((id) => {
      if (id === 't_2') return { id: 't_2' }; // no blockedBy
      return null;
    });
    expect(editor.wouldCreateCircularDep('t_1', 't_2')).toBe(false);
  });

  it('wouldCreateCircularDep detects deep chain', () => {
    deps.findTask.mockImplementation((id) => {
      if (id === 't_2') return { id: 't_2', blockedBy: ['t_3'] };
      if (id === 't_3') return { id: 't_3', blockedBy: ['t_4'] };
      if (id === 't_4') return { id: 't_4', blockedBy: ['t_5'] };
      if (id === 't_5') return { id: 't_5', blockedBy: ['t_1'] };
      return null;
    });
    expect(editor.wouldCreateCircularDep('t_1', 't_2')).toBe(true);
  });

  // ── addDep ────────────────────────────────────────────────────────
  it('addDep shows toast when blocker is not found', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task 1' });
    deps.matchTask.mockReturnValue(null);
    editor.addDep('t_1', 'nonexistent');
    expect(deps.showToast).toHaveBeenCalledWith('Task not found', true);
  });

  it('addDep shows toast when trying to block task by itself', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task 1' });
    deps.matchTask.mockReturnValue({ id: 't_1', title: 'Task 1' });
    editor.addDep('t_1', 'Task 1');
    expect(deps.showToast).toHaveBeenCalledWith('Task not found', true);
  });

  it('addDep adds blocker to task', () => {
    const t = { id: 't_1', title: 'Task 1' };
    deps.findTask.mockReturnValue(t);
    deps.matchTask.mockReturnValue({ id: 't_2', title: 'Blocker' });
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    editor.addDep('t_1', 'Blocker');
    expect(t.blockedBy).toContain('t_2');
    expect(deps.saveData).toHaveBeenCalled();
  });

  it('addDep does nothing when task is not found', () => {
    deps.findTask.mockReturnValue(null);
    editor.addDep('t_nonexistent', 'Blocker');
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.saveData).not.toHaveBeenCalled();
  });

  it('addDep does not add duplicate blocker', () => {
    const t = { id: 't_1', title: 'Task 1', blockedBy: ['t_2'] };
    deps.findTask.mockReturnValue(t);
    deps.matchTask.mockReturnValue({ id: 't_2', title: 'Blocker' });
    editor.addDep('t_1', 'Blocker');
    expect(t.blockedBy).toEqual(['t_2']); // still just one entry
    expect(deps.saveData).not.toHaveBeenCalled();
  });

  it('addDep initializes blockedBy array if not present', () => {
    const t = { id: 't_1', title: 'Task 1' };
    deps.findTask.mockReturnValue(t);
    deps.matchTask.mockReturnValue({ id: 't_2', title: 'Blocker' });
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    editor.addDep('t_1', 'Blocker');
    expect(Array.isArray(t.blockedBy)).toBe(true);
    expect(t.blockedBy).toContain('t_2');
  });

  it('addDep shows confirmation toast', () => {
    const t = { id: 't_1', title: 'Task 1' };
    deps.findTask.mockReturnValue(t);
    deps.matchTask.mockReturnValue({ id: 't_2', title: 'Blocker' });
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    editor.addDep('t_1', 'Blocker');
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('blocked by'), false, true);
  });

  // ── removeDep ─────────────────────────────────────────────────────
  it('removeDep removes a blocker from the task', () => {
    const t = { id: 't_1', title: 'Task 1', blockedBy: ['t_2', 't_3'] };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    editor.removeDep('t_1', 't_2');
    expect(t.blockedBy).toEqual(['t_3']);
    expect(deps.saveData).toHaveBeenCalled();
  });

  it('removeDep does nothing when task has no blockedBy', () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task 1' });
    editor.removeDep('t_1', 't_2');
    expect(deps.saveData).not.toHaveBeenCalled();
  });

  it('removeDep does nothing when task is not found', () => {
    deps.findTask.mockReturnValue(null);
    editor.removeDep('t_nonexistent', 't_2');
    expect(deps.saveData).not.toHaveBeenCalled();
  });

  it('removeDep calls render after removal', () => {
    const t = { id: 't_1', title: 'Task 1', blockedBy: ['t_2'] };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    editor.removeDep('t_1', 't_2');
    expect(deps.render).toHaveBeenCalled();
  });

  // ── showDepResults ────────────────────────────────────────────────
  it('showDepResults clears results for empty query', () => {
    // Create depResults element
    const el = document.createElement('div');
    el.id = 'depResults';
    el.innerHTML = '<div>old</div>';
    document.body.appendChild(el);
    editor.showDepResults('', 't_1');
    expect(el.innerHTML).toBe('');
    el.remove();
  });

  it('showDepResults does nothing when no depResults element', () => {
    // Should not throw
    expect(() => editor.showDepResults('test', 't_1')).not.toThrow();
  });

  it('showDepResults shows matching tasks', () => {
    const el = document.createElement('div');
    el.id = 'depResults';
    document.body.appendChild(el);
    const fBlockedBy = document.createElement('div');
    fBlockedBy.id = 'fBlockedBy';
    document.body.appendChild(fBlockedBy);
    deps.getData.mockReturnValue({
      tasks: [
        { id: 't_1', title: 'Search target', status: 'todo' },
        { id: 't_2', title: 'Another task', status: 'todo' },
        { id: 't_3', title: 'Search match too', status: 'done' },
      ],
      projects: [],
    });
    editor.showDepResults('search', 't_99');
    expect(el.innerHTML).toContain('Search target');
    expect(el.innerHTML).toContain('Search match too');
    expect(el.innerHTML).not.toContain('Another task');
    el.remove();
    fBlockedBy.remove();
  });

  it('showDepResults excludes the current task', () => {
    const el = document.createElement('div');
    el.id = 'depResults';
    document.body.appendChild(el);
    const fBlockedBy = document.createElement('div');
    fBlockedBy.id = 'fBlockedBy';
    document.body.appendChild(fBlockedBy);
    deps.getData.mockReturnValue({
      tasks: [{ id: 't_1', title: 'Search me', status: 'todo' }],
      projects: [],
    });
    editor.showDepResults('search', 't_1');
    expect(el.innerHTML).toBe('');
    el.remove();
    fBlockedBy.remove();
  });

  // ── selectDep ─────────────────────────────────────────────────────
  it('selectDep adds a dependency chip to the container', () => {
    const fBlockedBy = document.createElement('div');
    fBlockedBy.id = 'fBlockedBy';
    document.body.appendChild(fBlockedBy);
    const fDepSearch = document.createElement('input');
    fDepSearch.id = 'fDepSearch';
    document.body.appendChild(fDepSearch);
    const depResults = document.createElement('div');
    depResults.id = 'depResults';
    depResults.innerHTML = '<div>results</div>';
    document.body.appendChild(depResults);
    editor.selectDep('t_2', 'Blocker Task');
    expect(fBlockedBy.querySelector('[data-dep="t_2"]')).not.toBeNull();
    expect(fBlockedBy.textContent).toContain('Blocker Task');
    expect(fDepSearch.value).toBe('');
    expect(depResults.innerHTML).toBe('');
    fBlockedBy.remove();
    fDepSearch.remove();
    depResults.remove();
  });

  it('selectDep does not add duplicate dependency', () => {
    const fBlockedBy = document.createElement('div');
    fBlockedBy.id = 'fBlockedBy';
    fBlockedBy.innerHTML = '<span data-dep="t_2">Existing</span>';
    document.body.appendChild(fBlockedBy);
    const fDepSearch = document.createElement('input');
    fDepSearch.id = 'fDepSearch';
    document.body.appendChild(fDepSearch);
    const depResults = document.createElement('div');
    depResults.id = 'depResults';
    document.body.appendChild(depResults);
    editor.selectDep('t_2', 'Blocker');
    expect(fBlockedBy.querySelectorAll('[data-dep="t_2"]').length).toBe(1);
    fBlockedBy.remove();
    fDepSearch.remove();
    depResults.remove();
  });

  it('selectDep does nothing when fBlockedBy is missing', () => {
    expect(() => editor.selectDep('t_2', 'Task')).not.toThrow();
  });

  it('selectDep chip can be removed by clicking it', () => {
    const fBlockedBy = document.createElement('div');
    fBlockedBy.id = 'fBlockedBy';
    document.body.appendChild(fBlockedBy);
    const fDepSearch = document.createElement('input');
    fDepSearch.id = 'fDepSearch';
    document.body.appendChild(fDepSearch);
    const depResults = document.createElement('div');
    depResults.id = 'depResults';
    document.body.appendChild(depResults);
    editor.selectDep('t_2', 'Blocker');
    const chip = fBlockedBy.querySelector('[data-dep="t_2"]');
    chip.onclick();
    expect(fBlockedBy.querySelector('[data-dep="t_2"]')).toBeNull();
    fBlockedBy.remove();
    fDepSearch.remove();
    depResults.remove();
  });

  // ── runTaskCmd ────────────────────────────────────────────────────
  it('runTaskCmd does nothing for empty input', async () => {
    await editor.runTaskCmd('t_1', '');
    expect(deps.updateTask).not.toHaveBeenCalled();
  });

  it('runTaskCmd does nothing for whitespace input', async () => {
    await editor.runTaskCmd('t_1', '   ');
    expect(deps.updateTask).not.toHaveBeenCalled();
  });

  it('runTaskCmd marks task as done for "done" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'done');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
    expect(deps.showToast).toHaveBeenCalledWith('Task completed');
  });

  it('runTaskCmd marks task as done for "complete" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'complete');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
  });

  it('runTaskCmd marks task as done for "finished" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'finished');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
  });

  it('runTaskCmd marks task as done for "finish" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'finish');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
  });

  it('runTaskCmd marks task as done for "completed" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'completed');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
  });

  it('runTaskCmd collapses expanded task after done', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'done');
    expect(deps.setExpandedTask).toHaveBeenCalledWith(null);
  });

  it('runTaskCmd sets status to in-progress for "start" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'start');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
  });

  it('runTaskCmd sets status to in-progress for "wip" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'wip');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
  });

  it('runTaskCmd sets status to in-progress for "in progress" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'in progress');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
  });

  it('runTaskCmd sets status to in-progress for "begin" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'begin');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
  });

  it('runTaskCmd sets status to in-progress for "working" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'working');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
  });

  it('runTaskCmd deletes task for "delete" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'delete');
    expect(deps.deleteTask).toHaveBeenCalledWith('t_1');
    expect(deps.showToast).toHaveBeenCalledWith('Task deleted');
  });

  it('runTaskCmd deletes task for "remove" command', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'remove');
    expect(deps.deleteTask).toHaveBeenCalledWith('t_1');
    expect(deps.showToast).toHaveBeenCalledWith('Task deleted');
  });

  it('runTaskCmd collapses expanded task after delete', async () => {
    deps.findTask.mockReturnValue({ id: 't_1', title: 'Task', status: 'todo' });
    await editor.runTaskCmd('t_1', 'delete');
    expect(deps.setExpandedTask).toHaveBeenCalledWith(null);
  });

  it('runTaskCmd falls back to update note when no AI', async () => {
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmd('t_1', 'need to check with Alice');
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].text).toBe('need to check with Alice');
    expect(deps.showToast).toHaveBeenCalledWith('Update logged');
  });

  it('runTaskCmd does nothing when task not found', async () => {
    deps.findTask.mockReturnValue(null);
    await editor.runTaskCmd('t_1', 'done');
    expect(deps.updateTask).not.toHaveBeenCalled();
  });

  it('runTaskCmd delegates to runTaskCmdAI when AI is available', async () => {
    deps.hasAI.mockReturnValue(true);
    deps.callAI.mockResolvedValue('{"action":"update","fields":{"priority":"urgent"}}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmd('t_1', 'make this urgent');
    expect(deps.callAI).toHaveBeenCalled();
  });

  // ── runTaskCmdAI ──────────────────────────────────────────────────
  it('runTaskCmdAI handles update action', async () => {
    deps.callAI.mockResolvedValue('{"action":"update","fields":{"priority":"urgent"}}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [{ id: 'p_1', name: 'Work' }] });
    await editor.runTaskCmdAI('t_1', 'make this urgent');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { priority: 'urgent' });
    expect(deps.render).toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Updated');
  });

  it('runTaskCmdAI handles log action', async () => {
    deps.callAI.mockResolvedValue('{"action":"log","text":"Started research"}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'log: started research');
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].text).toBe('Started research');
    expect(deps.saveData).toHaveBeenCalled();
  });

  it('runTaskCmdAI handles both action', async () => {
    deps.callAI.mockResolvedValue('{"action":"both","fields":{"status":"in-progress"},"text":"Working on it"}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'start working on it');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].text).toBe('Working on it');
  });

  it('runTaskCmdAI handles subtasks action', async () => {
    deps.callAI.mockResolvedValue('{"action":"subtasks","add":["Step 1","Step 2","Step 3"]}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'break this down');
    expect(t.subtasks).toHaveLength(3);
    expect(t.subtasks[0].title).toBe('Step 1');
    expect(t.subtasks[0].done).toBe(false);
    expect(deps.saveData).toHaveBeenCalled();
  });

  it('runTaskCmdAI handles break action', async () => {
    deps.callAI.mockResolvedValue(
      '{"action":"break","into":[{"title":"Part A","priority":"normal"},{"title":"Part B","priority":"urgent"}]}',
    );
    const t = { id: 't_1', title: 'Big Task', status: 'todo', project: 'p_1', priority: 'normal' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [{ id: 'p_1', name: 'Work' }] });
    await editor.runTaskCmdAI('t_1', 'break into parts');
    expect(deps.addTask).toHaveBeenCalledTimes(2);
    expect(deps.deleteTask).toHaveBeenCalledWith('t_1');
  });

  it('runTaskCmdAI falls back to logging on AI error', async () => {
    deps.callAI.mockRejectedValue(new Error('API error'));
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'some command');
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].text).toBe('some command');
    expect(deps.showToast).toHaveBeenCalledWith('Logged (AI unavailable)');
  });

  it('runTaskCmdAI does nothing when task not found', async () => {
    deps.findTask.mockReturnValue(null);
    await editor.runTaskCmdAI('t_1', 'command');
    expect(deps.callAI).not.toHaveBeenCalled();
  });

  it('runTaskCmdAI filters fields to allowed list', async () => {
    deps.callAI.mockResolvedValue('{"action":"update","fields":{"priority":"urgent","__proto__":"bad","id":"hack"}}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'make urgent');
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { priority: 'urgent' });
  });

  it('runTaskCmdAI initializes updates array if not present for log', async () => {
    deps.callAI.mockResolvedValue('{"action":"log","text":"Note"}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'note');
    expect(t.updates).toHaveLength(1);
  });

  it('runTaskCmdAI initializes subtasks array if not present', async () => {
    deps.callAI.mockResolvedValue('{"action":"subtasks","add":["Sub1"]}');
    const t = { id: 't_1', title: 'Task', status: 'todo' };
    deps.findTask.mockReturnValue(t);
    deps.getData.mockReturnValue({ tasks: [t], projects: [] });
    await editor.runTaskCmdAI('t_1', 'add subtask');
    expect(Array.isArray(t.subtasks)).toBe(true);
  });

  // ── autoClassifyTask ──────────────────────────────────────────────
  it('autoClassifyTask updates task with AI classification', async () => {
    deps.callAI.mockResolvedValue('{"project":"p_1","priority":"urgent","reason":"time sensitive"}');
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const task = { id: 't_1', title: 'Fix production bug' };
    await editor.autoClassifyTask(task);
    expect(deps.updateTask).toHaveBeenCalledWith(
      't_1',
      expect.objectContaining({
        project: 'p_1',
        priority: 'urgent',
      }),
    );
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Auto-classified'));
    expect(deps.render).toHaveBeenCalled();
  });

  it('autoClassifyTask only saves reason when AI returns normal priority', async () => {
    deps.callAI.mockResolvedValue('{"project":"","priority":"normal","reason":"nothing special"}');
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const task = { id: 't_1', title: 'Some task' };
    await editor.autoClassifyTask(task);
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { priorityReason: 'nothing special' });
  });

  it('autoClassifyTask does nothing when AI returns no response', async () => {
    deps.callAI.mockResolvedValue('');
    const task = { id: 't_1', title: 'Task' };
    await editor.autoClassifyTask(task);
    expect(deps.updateTask).not.toHaveBeenCalled();
  });

  it('autoClassifyTask does nothing on AI error', async () => {
    deps.callAI.mockRejectedValue(new Error('fail'));
    const task = { id: 't_1', title: 'Task' };
    await editor.autoClassifyTask(task);
    expect(deps.updateTask).not.toHaveBeenCalled();
  });

  it('autoClassifyTask ignores invalid project id', async () => {
    deps.callAI.mockResolvedValue('{"project":"p_nonexistent","priority":"important","reason":"test"}');
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const task = { id: 't_1', title: 'Task' };
    await editor.autoClassifyTask(task);
    // Only priority should be updated, not project
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { priority: 'important', priorityReason: 'test' });
  });

  it('autoClassifyTask does nothing when AI returns invalid JSON', async () => {
    deps.callAI.mockResolvedValue('not json at all');
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    const task = { id: 't_1', title: 'Task' };
    await editor.autoClassifyTask(task);
    expect(deps.updateTask).not.toHaveBeenCalled();
  });

  it('autoClassifyTask only sets project when valid', async () => {
    deps.callAI.mockResolvedValue('{"project":"p_1","priority":"normal","reason":"work related"}');
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const task = { id: 't_1', title: 'Task' };
    await editor.autoClassifyTask(task);
    // project changed but priority is normal so only project
    expect(deps.updateTask).toHaveBeenCalledWith('t_1', { project: 'p_1', priorityReason: 'work related' });
  });

  it('autoClassifyTask shows project name in toast', async () => {
    deps.callAI.mockResolvedValue('{"project":"p_1","priority":"important","reason":"test"}');
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    const task = { id: 't_1', title: 'Task' };
    await editor.autoClassifyTask(task);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Work'));
  });
});
