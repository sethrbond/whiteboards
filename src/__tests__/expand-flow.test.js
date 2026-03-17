import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskEditor } from '../task-editor.js';
import { createDashboard } from '../dashboard.js';
import { PRIORITY_ORDER } from '../constants.js';

/**
 * End-to-end expand flow test:
 * 1. Create a dashboard wired to a real task-editor (renderTaskRow/renderTaskExpanded)
 * 2. Render project view with a task in collapsed state
 * 3. Set expandedTask to that task's ID
 * 4. Re-render and verify it switches to expanded state
 */

const TASK = {
  id: 't_1',
  title: 'Buy groceries',
  notes: 'Milk, eggs, bread',
  status: 'todo',
  priority: 'normal',
  project: 'p_1',
  horizon: 'short',
  dueDate: '2026-03-20',
  createdAt: '2026-03-15T10:00:00Z',
  tags: [],
  subtasks: [],
  blockedBy: [],
};

const PROJECT = { id: 'p_1', name: 'Personal', color: '#22c55e' };

describe('expand flow — end-to-end', () => {
  let expandedTask = null;
  let editor;
  let dashboard;

  beforeEach(() => {
    expandedTask = null;
    document.body.innerHTML =
      '<div id="projectList"></div><div id="archiveBadge"></div><div id="content"></div><div id="modalRoot"></div>';

    const getExpandedTask = () => expandedTask;
    const setExpandedTask = (v) => {
      expandedTask = v;
    };

    const data = { tasks: [TASK], projects: [PROJECT] };

    // Build a real task-editor so renderTaskRow / renderTaskExpanded are genuine
    editor = createTaskEditor({
      $: (sel) => document.querySelector(sel),
      esc: (s) => String(s ?? ''),
      todayStr: () => '2026-03-15',
      fmtDate: (d) => d || '',
      fmtEstimate: (m) => (m < 60 ? m + 'm' : m / 60 + 'h'),
      relativeTime: () => 'just now',
      genId: (prefix) => `${prefix}_gen`,
      getData: () => data,
      findTask: (id) => data.tasks.find((t) => t.id === id) || null,
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addTask: vi.fn(),
      createTask: vi.fn((o) => ({ id: 't_new', ...o })),
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
      getExpandedTask,
      setExpandedTask,
      getBulkMode: () => false,
      getBulkSelected: () => new Set(),
      getProactiveLog: () => [],
      isBlocked: () => false,
      renderSubtaskProgress: () => '',
      renderBlockedBy: () => '',
      renderBlocking: () => '',
      renderTagChips: () => '',
      renderTagPicker: () => '',
      smartDateInput: () => '<input id="fDue" type="date">',
      resolveSmartDate: () => '',
      hasAI: () => false,
      callAI: vi.fn(async () => ''),
      AI_PERSONA_SHORT: 'Test',
      matchTask: () => null,
      maybeProactiveEnhance: vi.fn(),
      predictCompletion: () => null,
    });

    // Build dashboard, injecting the real renderTaskRow from task-editor
    dashboard = createDashboard({
      $: (sel) => document.querySelector(sel),
      $$: (sel) => document.querySelectorAll(sel),
      esc: (s) => String(s ?? ''),
      sanitizeAIHTML: (s) => String(s ?? ''),
      fmtDate: (d) => d || '',
      todayStr: () => '2026-03-15',
      PRIORITY_ORDER,
      getData: () => data,
      userKey: (k) => `user1_${k}`,
      findTask: (id) => data.tasks.find((t) => t.id === id) || null,
      activeTasks: () => data.tasks.filter((t) => t.status !== 'done'),
      doneTasks: () => data.tasks.filter((t) => t.status === 'done'),
      urgentTasks: () => data.tasks.filter((t) => t.priority === 'urgent' && t.status !== 'done'),
      projectTasks: (pid) => data.tasks.filter((t) => t.project === pid && t.status !== 'done'),
      archivedTasks: () => [],
      sortTasksDeps: {
        PRIORITY_ORDER,
        todayStr: () => '2026-03-15',
        userKey: (k) => `user1_${k}`,
        getDataVersion: () => 0,
      },
      hasAI: () => false,
      showToast: vi.fn(),
      render: vi.fn(),
      setView: vi.fn(),
      updateTask: vi.fn(),
      addTask: vi.fn(),
      createTask: vi.fn((o) => ({ id: 't_new', status: 'todo', priority: 'normal', ...o })),
      renderTaskRow: editor.renderTaskRow,
      renderPriorityTag: editor.renderPriorityTag,
      priorityColor: editor.priorityColor,
      renderCalendar: vi.fn(() => '<div>calendar</div>'),
      getCurrentView: () => 'project',
      getCurrentProject: () => 'p_1',
      getDashViewMode: () => 'list',
      getShowCompleted: () => false,
      getProjectViewMode: () => 'list',
      getShowProjectBg: () => false,
      parseProjectBackground: () => null,
      getBulkMode: () => false,
      getSectionShowCount: () => 50,
      getArchiveShowCount: () => 20,
      renderBulkBar: () => '',
      attachListeners: vi.fn(),
      getBrainstormModule: () => ({
        isDumpInProgress: () => false,
        getDumpHistory: () => [],
        shouldShowDumpInvite: () => false,
      }),
      getAIStatusItems: () => [],
      getSmartFeedItems: () => [],
      getSmartNudges: () => [],
      getStuckTasks: () => [],
      nudgeFilterOverdue: vi.fn(),
      nudgeFilterStale: vi.fn(),
      nudgeFilterUnassigned: vi.fn(),
      startFocus: vi.fn(),
      offerStuckHelp: vi.fn(),
      generateAIBriefing: vi.fn(() => Promise.resolve()),
      planMyDay: vi.fn(() => Promise.resolve()),
      runProactiveWorker: vi.fn(),
      getBriefingGenerating: () => false,
      setBriefingGenerating: vi.fn(),
      getBriefingContent: () => null,
      setBriefingContent: vi.fn(),
      getPlanGenerating: () => false,
      setPlanGenerating: vi.fn(),
      getPlanContent: () => null,
      setPlanContent: vi.fn(),
      getNudgeFilter: () => '',
      setNudgeFilter: vi.fn(),
      getSmartFeedExpanded: () => false,
      getTodayBriefingExpanded: () => false,
      getShowTagFilter: () => false,
      getActiveTagFilter: () => '',
      getAllTags: () => [],
      getTagColor: () => ({ bg: '#eee', color: '#333' }),
      getOnboardingStep: () => -1,
      setOnboardingStep: vi.fn(),
      getExpandedTask,
      setExpandedTask,
      openQuickAdd: vi.fn(),
      isComplexInput: () => false,
      parseQuickInput: (v) => ({ title: v, priority: 'normal', dueDate: '' }),
      handleSlashCommand: () => false,
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
    });
  });

  it('renders collapsed task-row, then expanded after setting expandedTask', () => {
    // Step 1: Render project view — task should be in collapsed state
    const collapsedHtml = dashboard.renderProject(PROJECT);

    expect(collapsedHtml).toContain('task-row');
    expect(collapsedHtml).toContain('aria-expanded="false"');
    expect(collapsedHtml).toContain('Buy groceries');
    expect(collapsedHtml).not.toContain('task-expanded');

    // Step 2: Set expanded task and re-render
    expandedTask = TASK.id;
    const expandedHtml = dashboard.renderProject(PROJECT);

    expect(expandedHtml).toContain('task-expanded');
    expect(expandedHtml).toContain('aria-expanded="true"');
    expect(expandedHtml).toContain('Buy groceries');
    expect(expandedHtml).not.toContain('aria-expanded="false"');
    // Expanded view shows detail rows
    expect(expandedHtml).toContain('task-detail-row');
    expect(expandedHtml).toContain('Short-term');

    // Step 3: Collapse again
    expandedTask = null;
    const collapsedAgainHtml = dashboard.renderProject(PROJECT);

    expect(collapsedAgainHtml).toContain('task-row');
    expect(collapsedAgainHtml).toContain('aria-expanded="false"');
    expect(collapsedAgainHtml).not.toContain('task-expanded');
  });
});
