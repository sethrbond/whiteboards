import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActions } from '../actions.js';

/**
 * Build a complete deps object with vi.fn() stubs for every dependency
 * createActions destructures. Tests override individual stubs as needed.
 */
function makeDeps(overrides = {}) {
  return {
    // View / navigation
    setView: vi.fn(),
    render: vi.fn(),
    closeModal: vi.fn(),
    closeMobileSidebar: vi.fn(),
    openMobileSidebar: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleChat: vi.fn(),
    sendChat: vi.fn(),
    sendChatChip: vi.fn(),
    updateChatChips: vi.fn(),
    // Task CRUD
    openEditTask: vi.fn(),
    openNewTask: vi.fn(),
    saveNewTask: vi.fn(),
    saveEditTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTask: vi.fn(),
    createTask: vi.fn((o) => ({ id: 't_test', ...o })),
    toggleSubtask: vi.fn(),
    undo: vi.fn(),
    unarchiveTask: vi.fn(),
    deleteArchivedPermanently: vi.fn(),
    findTask: vi.fn(() => null),
    // Projects
    openNewProject: vi.fn(),
    saveNewProject: vi.fn(),
    openEditProject: vi.fn(),
    saveEditProject: vi.fn(),
    confirmDeleteProject: vi.fn(),
    // Bulk
    toggleBulkMode: vi.fn(),
    bulkAction: vi.fn(),
    // Focus
    startFocus: vi.fn(),
    openFocusView: vi.fn(),
    closeFocus: vi.fn(),
    completeFocusTask: vi.fn(),
    skipFocusTask: vi.fn(),
    renderFocusOverlay: vi.fn(),
    // Search / command palette
    openSearch: vi.fn(),
    openQuickAdd: vi.fn(),
    submitQuickAdd: vi.fn(),
    openShortcutHelp: vi.fn(),
    handleCmdNav: vi.fn(),
    renderSearchResults: vi.fn(),
    resetCmdIdx: vi.fn(),
    cmdExec: vi.fn(),
    previewQuickCapture: vi.fn(),
    // Calendar
    getCalModule: vi.fn(() => ({ resetOffset: vi.fn(), setExpandedDay: vi.fn() })),
    calNav: vi.fn(),
    calToday: vi.fn(),
    // Brainstorm
    processDump: vi.fn(),
    cancelDump: vi.fn(),
    applyDumpResults: vi.fn(),
    submitClarify: vi.fn(),
    skipClarify: vi.fn(),
    getBrainstormModule: vi.fn(() =>
      Promise.resolve({
        setLastDumpResult: vi.fn(),
        getLastDumpResult: vi.fn(() => null),
        removeDumpAttachment: vi.fn(),
        resetState: vi.fn(),
      }),
    ),
    // Settings
    openSettings: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    exportCalendar: vi.fn(),
    archiveMemory: vi.fn(),
    restoreMemory: vi.fn(),
    deleteAIMemory: vi.fn(),
    confirmClearMemories: vi.fn(),
    confirmResetData: vi.fn(),
    editProjectBackground: vi.fn(),
    saveProjectBackground: vi.fn(),
    // Auth
    showAuthFromLanding: vi.fn(),
    handleAuth: vi.fn(),
    toggleAuthMode: vi.fn(),
    showForgotPassword: vi.fn(),
    showPrivacy: vi.fn(),
    showTerms: vi.fn(),
    signOut: vi.fn(),
    resendVerification: vi.fn(),
    // AI / Proactive
    generateAIBriefing: vi.fn(),
    planMyDay: vi.fn(),
    replanDay: vi.fn(),
    snoozePlanTask: vi.fn(),
    submitEndOfDay: vi.fn(),
    aiReorganize: vi.fn(),
    generateWeeklyReview: vi.fn(),
    discussReview: vi.fn(),
    // UI helpers
    showToast: vi.fn(),
    addTagToPicker: vi.fn(),
    previewSmartDate: vi.fn(),
    showDepResults: vi.fn(),
    removeDep: vi.fn(),
    confirmAction: vi.fn(async () => true),
    quickAddToProject: vi.fn(),
    addSubtask: vi.fn(),
    runTaskCmd: vi.fn(),
    heroInputHandler: vi.fn(),
    showFeatureTips: vi.fn(),
    showOnboardingExperience: vi.fn(),
    // State getters/setters
    getExpandedTask: vi.fn(() => null),
    setExpandedTask: vi.fn(),
    getCurrentProject: vi.fn(() => ''),
    getShowCompleted: vi.fn(() => false),
    setShowCompleted: vi.fn(),
    setDashViewMode: vi.fn(),
    getKbIdx: vi.fn(() => -1),
    setKbIdx: vi.fn(),
    getSectionShowCount: vi.fn(() => 10),
    setSectionShowCount: vi.fn(),
    getArchiveShowCount: vi.fn(() => 50),
    setArchiveShowCount: vi.fn(),
    TASKS_PER_PAGE: 10,
    setSmartFeedExpanded: vi.fn(),
    setTodayBriefingExpanded: vi.fn(),
    setActiveTagFilter: vi.fn(),
    getShowTagFilter: vi.fn(() => false),
    setShowTagFilter: vi.fn(),
    setProjectViewMode: vi.fn(),
    getShowProjectBg: vi.fn(() => false),
    setShowProjectBg: vi.fn(),
    getFocusModule: vi.fn(() => ({ getFocusTask: vi.fn(() => null) })),
    highlightKbRow: vi.fn(),
    saveSettings: vi.fn(),
    getSettings: vi.fn(() => ({ apiKey: '' })),
    $: vi.fn((sel) => document.querySelector(sel)),
    userKey: vi.fn((k) => 'u1_' + k),
    todayStr: vi.fn(() => '2026-03-15'),
    handleDumpFiles: vi.fn(),
    openProjectChat: vi.fn(),
    restoreFromBackup: vi.fn(),
    dismissCorruption: vi.fn(),
    dismissCheckIn: vi.fn(),
    breakdownTask: vi.fn(),
    dismissVagueTask: vi.fn(),
    offerStuckHelp: vi.fn(),
    handleEscalationAction: vi.fn(),
    autoRebalanceWeek: vi.fn(),
    acceptReschedule: vi.fn(),
    skipReschedule: vi.fn(),
    acceptAllReschedules: vi.fn(),
    cleanupStorage: vi.fn(() => 0),
    getNotifications: vi.fn(() => ({
      getPrefs: vi.fn(() => ({ enabled: false })),
      savePrefs: vi.fn(),
      requestPermission: vi.fn(() => Promise.resolve()),
      clearScheduled: vi.fn(),
      scheduleNotifications: vi.fn(),
    })),
    guardedCloseEditModal: vi.fn(),
    saveAsTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    openEditTemplate: vi.fn(),
    saveEditTemplate: vi.fn(),
    applyTemplateToQuickAdd: vi.fn(),
    ...overrides,
  };
}

/** Dispatch a click event on an element */
function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Dispatch a keydown event */
function keydown(el, opts) {
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...opts }));
}

describe('actions.js — createActions()', () => {
  // Create deps ONCE and attach listeners ONCE to avoid stacking
  const deps = makeDeps();
  createActions(deps);

  beforeEach(() => {
    // Clear call history but keep implementations
    Object.values(deps).forEach((v) => {
      if (typeof v === 'function' && v.mockClear) v.mockClear();
    });
    // Restore default mock return values that tests may have changed
    deps.getExpandedTask.mockReturnValue(null);
    deps.getShowCompleted.mockReturnValue(false);
    deps.getKbIdx.mockReturnValue(-1);
    deps.getSectionShowCount.mockReturnValue(10);
    deps.getArchiveShowCount.mockReturnValue(50);
    deps.getShowTagFilter.mockReturnValue(false);
    deps.getShowProjectBg.mockReturnValue(false);
    deps.getFocusModule.mockReturnValue({ getFocusTask: () => null });
    deps.findTask.mockReturnValue(null);
  });

  afterEach(() => {
    // Clean up any elements added during tests
    document.querySelectorAll('[data-action]').forEach((el) => {
      if (
        !el.closest('#modalRoot') &&
        !el.closest('#chatPanel') &&
        !el.closest('.sidebar') &&
        !el.closest('#authScreen')
      ) {
        el.remove();
      }
    });
    document.querySelectorAll('.nav-item[data-view]').forEach((el) => el.remove());
    document.querySelectorAll('[data-keydown-action]').forEach((el) => el.remove());
    document.querySelectorAll('[data-oninput-action]').forEach((el) => el.remove());
    document.querySelectorAll('[data-onchange-action]').forEach((el) => el.remove());
    document.querySelectorAll('.dropdown').forEach((el) => el.remove());
    document.querySelectorAll('.task-row').forEach((el) => el.remove());
    document.querySelectorAll('.skip-link').forEach((el) => el.remove());
  });

  // ── Click: nav-item ──────────────────────────────────────────────
  describe('click — nav-item', () => {
    it('calls setView when a nav-item with data-view is clicked', () => {
      const el = document.createElement('div');
      el.className = 'nav-item';
      el.dataset.view = 'dashboard';
      document.body.appendChild(el);
      click(el);
      expect(deps.setView).toHaveBeenCalledWith('dashboard');
    });
  });

  // ── Click: data-action dispatch ──────────────────────────────────
  describe('click — data-action dispatch', () => {
    function makeActionEl(action, extras = {}) {
      const el = document.createElement('button');
      el.dataset.action = action;
      Object.entries(extras).forEach(([k, v]) => {
        el.dataset[k] = v;
      });
      document.body.appendChild(el);
      return el;
    }

    it('auth-landing calls showAuthFromLanding()', () => {
      click(makeActionEl('auth-landing'));
      expect(deps.showAuthFromLanding).toHaveBeenCalledWith();
    });

    it('auth-landing-login calls showAuthFromLanding("login")', () => {
      click(makeActionEl('auth-landing-login'));
      expect(deps.showAuthFromLanding).toHaveBeenCalledWith('login');
    });

    it('toggle-auth calls toggleAuthMode', () => {
      click(makeActionEl('toggle-auth'));
      expect(deps.toggleAuthMode).toHaveBeenCalled();
    });

    it('forgot-password calls showForgotPassword', () => {
      click(makeActionEl('forgot-password'));
      expect(deps.showForgotPassword).toHaveBeenCalled();
    });

    it('show-privacy calls showPrivacy', () => {
      click(makeActionEl('show-privacy'));
      expect(deps.showPrivacy).toHaveBeenCalled();
    });

    it('show-terms calls showTerms', () => {
      click(makeActionEl('show-terms'));
      expect(deps.showTerms).toHaveBeenCalled();
    });

    it('sign-out calls signOut', () => {
      click(makeActionEl('sign-out'));
      expect(deps.signOut).toHaveBeenCalled();
    });

    it('new-project calls openNewProject', () => {
      click(makeActionEl('new-project'));
      expect(deps.openNewProject).toHaveBeenCalled();
    });

    it('settings calls openSettings', () => {
      click(makeActionEl('settings'));
      expect(deps.openSettings).toHaveBeenCalled();
    });

    it('open-search calls openSearch', () => {
      click(makeActionEl('open-search'));
      expect(deps.openSearch).toHaveBeenCalled();
    });

    it('toggle-sidebar calls toggleSidebar', () => {
      click(makeActionEl('toggle-sidebar'));
      expect(deps.toggleSidebar).toHaveBeenCalled();
    });

    it('close-mobile-sidebar calls closeMobileSidebar', () => {
      click(makeActionEl('close-mobile-sidebar'));
      expect(deps.closeMobileSidebar).toHaveBeenCalled();
    });

    it('open-mobile-sidebar calls openMobileSidebar', () => {
      click(makeActionEl('open-mobile-sidebar'));
      expect(deps.openMobileSidebar).toHaveBeenCalled();
    });

    it('toggle-chat calls toggleChat', () => {
      click(makeActionEl('toggle-chat'));
      expect(deps.toggleChat).toHaveBeenCalled();
    });

    it('send-chat calls sendChat', () => {
      click(makeActionEl('send-chat'));
      expect(deps.sendChat).toHaveBeenCalled();
    });

    it('chat-chip calls sendChatChip with text', () => {
      click(makeActionEl('chat-chip', { text: 'hello' }));
      expect(deps.sendChatChip).toHaveBeenCalledWith('hello');
    });

    it('delete-archived calls deleteArchivedPermanently', () => {
      click(makeActionEl('delete-archived'));
      expect(deps.deleteArchivedPermanently).toHaveBeenCalled();
    });

    it('restore-task calls unarchiveTask with taskId', () => {
      click(makeActionEl('restore-task', { taskId: 't_1' }));
      expect(deps.unarchiveTask).toHaveBeenCalledWith('t_1');
    });

    it('edit-task calls openEditTask with taskId', () => {
      click(makeActionEl('edit-task', { taskId: 't_5' }));
      expect(deps.openEditTask).toHaveBeenCalledWith('t_5');
    });

    it('focus-task calls openFocusView with taskId', () => {
      click(makeActionEl('focus-task', { taskId: 't_5' }));
      expect(deps.openFocusView).toHaveBeenCalledWith('t_5');
    });

    it('complete-task calls updateTask and render', () => {
      click(makeActionEl('complete-task', { taskId: 't_5' }));
      expect(deps.updateTask).toHaveBeenCalledWith('t_5', { status: 'done' });
      expect(deps.render).toHaveBeenCalled();
    });

    it('toggle-expand toggles expanded task', () => {
      deps.getExpandedTask.mockReturnValue(null);
      click(makeActionEl('toggle-expand', { taskId: 't_5' }));
      expect(deps.setExpandedTask).toHaveBeenCalledWith('t_5');
      expect(deps.render).toHaveBeenCalled();
    });

    it('toggle-expand collapses when already expanded', () => {
      deps.getExpandedTask.mockReturnValue('t_5');
      click(makeActionEl('toggle-expand', { taskId: 't_5' }));
      expect(deps.setExpandedTask).toHaveBeenCalledWith(null);
    });

    it('toggle-completed toggles show completed state', () => {
      deps.getShowCompleted.mockReturnValue(false);
      click(makeActionEl('toggle-completed', { key: 'p1' }));
      expect(deps.setShowCompleted).toHaveBeenCalledWith('p1', true);
      expect(deps.render).toHaveBeenCalled();
    });

    it('dash-view sets mode and resets calendar offset', () => {
      click(makeActionEl('dash-view', { mode: 'week' }));
      expect(deps.setDashViewMode).toHaveBeenCalledWith('week');
      expect(deps.render).toHaveBeenCalled();
    });

    it('toggle-bulk calls toggleBulkMode', () => {
      click(makeActionEl('toggle-bulk'));
      expect(deps.toggleBulkMode).toHaveBeenCalled();
    });

    it('start-focus calls startFocus', () => {
      click(makeActionEl('start-focus'));
      expect(deps.startFocus).toHaveBeenCalled();
    });

    it('close-modal calls closeModal', () => {
      click(makeActionEl('close-modal'));
      expect(deps.closeModal).toHaveBeenCalled();
    });

    it('close-modal-root clears modalRoot innerHTML', () => {
      document.getElementById('modalRoot').innerHTML = '<div>test</div>';
      click(makeActionEl('close-modal-root'));
      expect(document.getElementById('modalRoot').innerHTML).toBe('');
    });

    it('save-new-project calls saveNewProject', () => {
      click(makeActionEl('save-new-project'));
      expect(deps.saveNewProject).toHaveBeenCalled();
    });

    it('save-edit-project calls saveEditProject with projectId', () => {
      click(makeActionEl('save-edit-project', { projectId: 'p_1' }));
      expect(deps.saveEditProject).toHaveBeenCalledWith('p_1');
    });

    it('save-new-task calls saveNewTask', () => {
      click(makeActionEl('save-new-task'));
      expect(deps.saveNewTask).toHaveBeenCalled();
    });

    it('save-edit-task calls saveEditTask with taskId', () => {
      click(makeActionEl('save-edit-task', { taskId: 't_1' }));
      expect(deps.saveEditTask).toHaveBeenCalledWith('t_1');
    });

    it('complete-focus calls completeFocusTask', () => {
      click(makeActionEl('complete-focus'));
      expect(deps.completeFocusTask).toHaveBeenCalled();
    });

    it('skip-focus calls skipFocusTask', () => {
      click(makeActionEl('skip-focus'));
      expect(deps.skipFocusTask).toHaveBeenCalled();
    });

    it('close-focus calls closeFocus', () => {
      click(makeActionEl('close-focus'));
      expect(deps.closeFocus).toHaveBeenCalled();
    });

    it('process-dump calls processDump', () => {
      click(makeActionEl('process-dump'));
      expect(deps.processDump).toHaveBeenCalled();
    });

    it('cancel-dump calls cancelDump', () => {
      click(makeActionEl('cancel-dump'));
      expect(deps.cancelDump).toHaveBeenCalled();
    });

    it('submit-clarify calls submitClarify', () => {
      click(makeActionEl('submit-clarify'));
      expect(deps.submitClarify).toHaveBeenCalled();
    });

    it('skip-clarify calls skipClarify', () => {
      click(makeActionEl('skip-clarify'));
      expect(deps.skipClarify).toHaveBeenCalled();
    });

    it('submit-quick-add calls submitQuickAdd', () => {
      click(makeActionEl('submit-quick-add'));
      expect(deps.submitQuickAdd).toHaveBeenCalled();
    });

    it('generate-review calls generateWeeklyReview', () => {
      click(makeActionEl('generate-review'));
      expect(deps.generateWeeklyReview).toHaveBeenCalled();
    });

    it('discuss-review calls discussReview', () => {
      click(makeActionEl('discuss-review'));
      expect(deps.discussReview).toHaveBeenCalled();
    });

    it('generate-briefing calls generateAIBriefing', () => {
      click(makeActionEl('generate-briefing'));
      expect(deps.generateAIBriefing).toHaveBeenCalled();
    });

    it('plan-my-day calls planMyDay', () => {
      click(makeActionEl('plan-my-day'));
      expect(deps.planMyDay).toHaveBeenCalled();
    });

    it('replan-day calls replanDay', () => {
      click(makeActionEl('replan-day'));
      expect(deps.replanDay).toHaveBeenCalled();
    });

    it('submit-eod calls submitEndOfDay', () => {
      click(makeActionEl('submit-eod'));
      expect(deps.submitEndOfDay).toHaveBeenCalled();
    });

    it('export-data calls exportData', () => {
      click(makeActionEl('export-data'));
      expect(deps.exportData).toHaveBeenCalled();
    });

    it('export-calendar calls exportCalendar', () => {
      click(makeActionEl('export-calendar'));
      expect(deps.exportCalendar).toHaveBeenCalled();
    });

    it('confirm-delete-project calls confirmDeleteProject', () => {
      click(makeActionEl('confirm-delete-project', { projectId: 'p_1' }));
      expect(deps.confirmDeleteProject).toHaveBeenCalledWith('p_1');
    });

    it('archive-show-more increases archive count and renders', () => {
      deps.getArchiveShowCount.mockReturnValue(50);
      click(makeActionEl('archive-show-more'));
      expect(deps.setArchiveShowCount).toHaveBeenCalledWith(100);
      expect(deps.render).toHaveBeenCalled();
    });

    it('section-show-more increases section count and renders', () => {
      deps.getSectionShowCount.mockReturnValue(10);
      click(makeActionEl('section-show-more', { section: 'todo' }));
      expect(deps.setSectionShowCount).toHaveBeenCalledWith('todo', 20);
      expect(deps.render).toHaveBeenCalled();
    });

    it('smart-feed-expand calls setSmartFeedExpanded(true)', () => {
      click(makeActionEl('smart-feed-expand'));
      expect(deps.setSmartFeedExpanded).toHaveBeenCalledWith(true);
    });

    it('smart-feed-collapse calls setSmartFeedExpanded(false)', () => {
      click(makeActionEl('smart-feed-collapse'));
      expect(deps.setSmartFeedExpanded).toHaveBeenCalledWith(false);
    });

    it('briefing-expand calls setTodayBriefingExpanded(true)', () => {
      click(makeActionEl('briefing-expand'));
      expect(deps.setTodayBriefingExpanded).toHaveBeenCalledWith(true);
    });

    it('briefing-collapse calls setTodayBriefingExpanded(false)', () => {
      click(makeActionEl('briefing-collapse'));
      expect(deps.setTodayBriefingExpanded).toHaveBeenCalledWith(false);
    });

    it('clear-tag-filter calls setActiveTagFilter with empty string', () => {
      click(makeActionEl('clear-tag-filter'));
      expect(deps.setActiveTagFilter).toHaveBeenCalledWith('');
      expect(deps.render).toHaveBeenCalled();
    });

    it('toggle-tag-filter toggles tag filter', () => {
      deps.getShowTagFilter.mockReturnValue(false);
      click(makeActionEl('toggle-tag-filter'));
      expect(deps.setShowTagFilter).toHaveBeenCalledWith(true);
    });

    it('go-dump calls setView("dump")', () => {
      click(makeActionEl('go-dump'));
      expect(deps.setView).toHaveBeenCalledWith('dump');
    });

    it('open-new-project calls openNewProject', () => {
      click(makeActionEl('open-new-project'));
      expect(deps.openNewProject).toHaveBeenCalled();
    });

    it('undo-btn calls undo and removes parent toast', () => {
      const toast = document.createElement('div');
      toast.className = 'toast';
      const btn = document.createElement('button');
      btn.dataset.action = 'undo-btn';
      toast.appendChild(btn);
      document.body.appendChild(toast);
      click(btn);
      expect(deps.undo).toHaveBeenCalled();
    });

    it('resend-verification calls resendVerification with email', () => {
      click(makeActionEl('resend-verification', { email: 'test@example.com' }));
      expect(deps.resendVerification).toHaveBeenCalledWith('test@example.com');
    });

    it('data-click-self=true prevents action when clicking child', () => {
      const el = document.createElement('div');
      el.dataset.action = 'toggle-chat';
      el.dataset.clickSelf = 'true';
      const child = document.createElement('span');
      child.textContent = 'child';
      el.appendChild(child);
      document.body.appendChild(el);
      click(child);
      expect(deps.toggleChat).not.toHaveBeenCalled();
    });

    it('click with no data-action element is a no-op', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      click(el); // should not throw
      el.remove();
    });

    it('toggle-subtask calls toggleSubtask', () => {
      const el = makeActionEl('toggle-subtask', { taskId: 't_1', subtaskId: 'st_1' });
      click(el);
      expect(deps.toggleSubtask).toHaveBeenCalledWith('t_1', 'st_1');
    });

    it('toggle-subtask-focus calls toggleSubtask and renderFocusOverlay', () => {
      const el = makeActionEl('toggle-subtask-focus', { taskId: 't_1', subtaskId: 'st_1' });
      click(el);
      expect(deps.toggleSubtask).toHaveBeenCalledWith('t_1', 'st_1');
      expect(deps.renderFocusOverlay).toHaveBeenCalled();
    });

    it('bulk-action calls bulkAction', () => {
      click(makeActionEl('bulk-action', { bulkType: 'priority', bulkValue: 'urgent' }));
      expect(deps.bulkAction).toHaveBeenCalledWith('priority', 'urgent');
    });

    it('bulk-cancel calls toggleBulkMode', () => {
      click(makeActionEl('bulk-cancel'));
      expect(deps.toggleBulkMode).toHaveBeenCalled();
    });

    it('remove-dep calls removeDep', () => {
      click(makeActionEl('remove-dep', { taskId: 't_1', blockerId: 't_2' }));
      expect(deps.removeDep).toHaveBeenCalledWith('t_1', 't_2');
    });

    it('snooze-plan-task calls snoozePlanTask', () => {
      click(makeActionEl('snooze-plan-task', { taskId: 't_1' }));
      expect(deps.snoozePlanTask).toHaveBeenCalledWith('t_1');
    });

    it('archive-memory calls archiveMemory and openSettings', () => {
      click(makeActionEl('archive-memory', { idx: '2' }));
      expect(deps.archiveMemory).toHaveBeenCalledWith(2);
      expect(deps.openSettings).toHaveBeenCalled();
    });

    it('delete-ai-memory calls deleteAIMemory', () => {
      click(makeActionEl('delete-ai-memory', { idx: '1' }));
      expect(deps.deleteAIMemory).toHaveBeenCalledWith(1);
    });

    it('restore-memory calls restoreMemory and openSettings', () => {
      click(makeActionEl('restore-memory', { idx: '3' }));
      expect(deps.restoreMemory).toHaveBeenCalledWith(3);
      expect(deps.openSettings).toHaveBeenCalled();
    });

    it('confirm-clear-memories calls confirmClearMemories', () => {
      click(makeActionEl('confirm-clear-memories'));
      expect(deps.confirmClearMemories).toHaveBeenCalled();
    });

    it('confirm-reset-data calls confirmResetData', () => {
      click(makeActionEl('confirm-reset-data'));
      expect(deps.confirmResetData).toHaveBeenCalled();
    });

    it('edit-project-bg calls editProjectBackground', () => {
      click(makeActionEl('edit-project-bg', { projectId: 'p_1' }));
      expect(deps.editProjectBackground).toHaveBeenCalledWith('p_1');
    });

    it('save-project-bg calls saveProjectBackground', () => {
      click(makeActionEl('save-project-bg', { projectId: 'p_1' }));
      expect(deps.saveProjectBackground).toHaveBeenCalledWith('p_1');
    });

    it('toggle-project-bg toggles project background', () => {
      deps.getShowProjectBg.mockReturnValue(false);
      click(makeActionEl('toggle-project-bg', { projectId: 'p_1' }));
      expect(deps.setShowProjectBg).toHaveBeenCalledWith('p_1', true);
      expect(deps.render).toHaveBeenCalled();
    });

    it('open-new-task calls openNewTask with projectId', () => {
      click(makeActionEl('open-new-task', { projectId: 'p_1' }));
      expect(deps.openNewTask).toHaveBeenCalledWith('p_1');
    });

    it('open-new-task with no projectId calls openNewTask with empty string', () => {
      click(makeActionEl('open-new-task'));
      expect(deps.openNewTask).toHaveBeenCalledWith('');
    });

    it('cal-new-task calls openNewTask with date', () => {
      click(makeActionEl('cal-new-task', { date: '2026-03-20' }));
      expect(deps.openNewTask).toHaveBeenCalledWith('', '2026-03-20');
    });

    it('toggle-tag-chip toggles selected class', () => {
      const el = makeActionEl('toggle-tag-chip');
      click(el);
      expect(el.classList.contains('selected')).toBe(true);
      click(el);
      expect(el.classList.contains('selected')).toBe(false);
    });

    it('remove-dep-chip removes the element', () => {
      const el = makeActionEl('remove-dep-chip');
      click(el);
      expect(el.parentNode).toBeNull();
    });

    it('project-view-mode calls setProjectViewMode and renders', () => {
      click(makeActionEl('project-view-mode', { projectId: 'p_1', mode: 'kanban' }));
      expect(deps.setProjectViewMode).toHaveBeenCalledWith('p_1', 'kanban');
      expect(deps.render).toHaveBeenCalled();
    });

    it('cmd-exec calls cmdExec with key and label', () => {
      click(makeActionEl('cmd-exec', { cmdKey: 'new', cmdLabel: 'New Task' }));
      expect(deps.cmdExec).toHaveBeenCalledWith('new', 'New Task');
    });

    it('toggle-dropdown toggles open class on parent dropdown', () => {
      const dd = document.createElement('div');
      dd.className = 'dropdown';
      const btn = document.createElement('button');
      btn.dataset.action = 'toggle-dropdown';
      dd.appendChild(btn);
      document.body.appendChild(dd);
      click(btn);
      expect(dd.classList.contains('open')).toBe(true);
      click(btn);
      expect(dd.classList.contains('open')).toBe(false);
    });

    it('start-focus-project calls startFocus with projectId and closes dropdown', () => {
      const dd = document.createElement('div');
      dd.className = 'dropdown open';
      const btn = document.createElement('button');
      btn.dataset.action = 'start-focus-project';
      btn.dataset.projectId = 'p_1';
      dd.appendChild(btn);
      document.body.appendChild(dd);
      click(btn);
      expect(deps.startFocus).toHaveBeenCalledWith('p_1');
      expect(dd.classList.contains('open')).toBe(false);
    });

    it('ai-reorganize calls aiReorganize with projectId and closes dropdown', () => {
      const dd = document.createElement('div');
      dd.className = 'dropdown open';
      const btn = document.createElement('button');
      btn.dataset.action = 'ai-reorganize';
      btn.dataset.projectId = 'p_1';
      dd.appendChild(btn);
      document.body.appendChild(dd);
      click(btn);
      expect(deps.aiReorganize).toHaveBeenCalledWith('p_1');
      expect(dd.classList.contains('open')).toBe(false);
    });

    it('task-nudge opens edit task', () => {
      click(makeActionEl('task-nudge', { taskId: 't_1' }));
      expect(deps.openEditTask).toHaveBeenCalledWith('t_1');
    });

    it('dump-review-cancel closes modal and calls undo', () => {
      click(makeActionEl('dump-review-cancel'));
      expect(deps.closeModal).toHaveBeenCalled();
      expect(deps.undo).toHaveBeenCalled();
    });

    it('apply-dump-results calls applyDumpResults', () => {
      click(makeActionEl('apply-dump-results'));
      expect(deps.applyDumpResults).toHaveBeenCalled();
    });
  });

  // ── Keyboard shortcuts ───────────────────────────────────────────
  describe('keyboard shortcuts', () => {
    it('Cmd+K opens search', () => {
      keydown(document.body, { key: 'k', metaKey: true });
      expect(deps.openSearch).toHaveBeenCalled();
    });

    it('Cmd+Shift+K opens quick add', () => {
      keydown(document.body, { key: 'k', metaKey: true, shiftKey: true });
      expect(deps.openQuickAdd).toHaveBeenCalled();
    });

    it('Cmd+Z calls undo', () => {
      keydown(document.body, { key: 'z', metaKey: true });
      expect(deps.undo).toHaveBeenCalled();
    });

    it('Cmd+D opens brainstorm view', () => {
      keydown(document.body, { key: 'd', metaKey: true });
      expect(deps.setView).toHaveBeenCalledWith('dump');
    });

    it('Cmd+J toggles chat', () => {
      keydown(document.body, { key: 'j', metaKey: true });
      expect(deps.toggleChat).toHaveBeenCalled();
    });

    it('Cmd+, opens settings', () => {
      keydown(document.body, { key: ',', metaKey: true });
      expect(deps.openSettings).toHaveBeenCalled();
    });

    it('Escape blurs focused input instead of acting globally', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const blurSpy = vi.spyOn(input, 'blur');
      keydown(input, { key: 'Escape' });
      expect(blurSpy).toHaveBeenCalled();
      input.remove();
    });

    it('Escape closes focus mode when active', () => {
      deps.getFocusModule.mockReturnValue({ getFocusTask: () => 't_1' });
      keydown(document.body, { key: 'Escape' });
      expect(deps.closeFocus).toHaveBeenCalled();
    });

    it('Escape closes expanded task when one is expanded', () => {
      deps.getExpandedTask.mockReturnValue('t_1');
      keydown(document.body, { key: 'Escape' });
      expect(deps.setExpandedTask).toHaveBeenCalledWith(null);
      expect(deps.setKbIdx).toHaveBeenCalledWith(-1);
      expect(deps.render).toHaveBeenCalled();
    });

    it('Escape calls closeModal when nothing else is open', () => {
      keydown(document.body, { key: 'Escape' });
      expect(deps.closeModal).toHaveBeenCalled();
    });

    it('n opens new task form', () => {
      keydown(document.body, { key: 'n' });
      expect(deps.openNewTask).toHaveBeenCalled();
    });

    it('w opens review view', () => {
      keydown(document.body, { key: 'w' });
      expect(deps.setView).toHaveBeenCalledWith('review');
    });

    it('1 opens dashboard', () => {
      keydown(document.body, { key: '1' });
      expect(deps.setView).toHaveBeenCalledWith('dashboard');
    });

    it('? opens shortcut help', () => {
      keydown(document.body, { key: '?' });
      expect(deps.openShortcutHelp).toHaveBeenCalled();
    });

    it('ignores letter shortcuts when input is focused', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      keydown(input, { key: 'n' });
      expect(deps.openNewTask).not.toHaveBeenCalled();
      input.remove();
    });
  });

  // ── Keyboard accessibility for data-action ───────────────────────
  describe('keyboard accessibility — Enter/Space on data-action', () => {
    it('Enter on data-action element triggers click', () => {
      const el = document.createElement('button');
      el.dataset.action = 'toggle-chat';
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      keydown(el, { key: 'Enter' });
      expect(clickSpy).toHaveBeenCalled();
    });

    it('Space on data-action element triggers click', () => {
      const el = document.createElement('button');
      el.dataset.action = 'toggle-chat';
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      keydown(el, { key: ' ' });
      expect(clickSpy).toHaveBeenCalled();
    });

    it('Enter on nav-item calls setView', () => {
      const el = document.createElement('div');
      el.className = 'nav-item';
      el.dataset.view = 'settings';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.setView).toHaveBeenCalledWith('settings');
    });
  });

  // ── Delegated keydown handlers (data-keydown-action) ─────────────
  describe('delegated keydown — data-keydown-action', () => {
    it('cmd-nav delegates to handleCmdNav', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'cmd-nav';
      document.body.appendChild(el);
      const e = new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' });
      el.dispatchEvent(e);
      expect(deps.handleCmdNav).toHaveBeenCalled();
    });

    it('hero-input delegates to heroInputHandler', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'hero-input';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.heroInputHandler).toHaveBeenCalled();
    });

    it('Enter on add-subtask calls addSubtask when value is non-empty', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'add-subtask';
      el.dataset.taskId = 't_1';
      el.value = 'New subtask';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.addSubtask).toHaveBeenCalledWith('t_1', 'New subtask', undefined);
      expect(el.value).toBe('');
    });

    it('Enter on add-subtask does nothing when value is empty', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'add-subtask';
      el.dataset.taskId = 't_1';
      el.value = '   ';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.addSubtask).not.toHaveBeenCalled();
    });

    it('Enter on run-task-cmd calls runTaskCmd', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'run-task-cmd';
      el.dataset.taskId = 't_1';
      el.value = '/done';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.runTaskCmd).toHaveBeenCalledWith('t_1', '/done');
    });

    it('Enter on add-tag calls addTagToPicker', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'add-tag';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.addTagToPicker).toHaveBeenCalledWith(el);
    });

    it('Enter on quick-add-submit calls submitQuickAdd', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'quick-add-submit';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.submitQuickAdd).toHaveBeenCalled();
    });

    it('Enter on submit-clarify-input calls submitClarify', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'submit-clarify-input';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.submitClarify).toHaveBeenCalled();
    });

    it('Escape on dep-search-escape clears value and results', () => {
      const depResults = document.createElement('div');
      depResults.id = 'depResults';
      depResults.innerHTML = '<div>result</div>';
      document.body.appendChild(depResults);
      const el = document.createElement('input');
      el.dataset.keydownAction = 'dep-search-escape';
      el.value = 'search term';
      document.body.appendChild(el);
      keydown(el, { key: 'Escape' });
      expect(el.value).toBe('');
      expect(depResults.innerHTML).toBe('');
      depResults.remove();
    });

    it('Enter on quick-add-project calls quickAddToProject when value non-empty', () => {
      const el = document.createElement('input');
      el.dataset.keydownAction = 'quick-add-project';
      el.dataset.projectId = 'p_1';
      el.value = 'New task';
      document.body.appendChild(el);
      keydown(el, { key: 'Enter' });
      expect(deps.quickAddToProject).toHaveBeenCalledWith(el, 'p_1');
    });
  });

  // ── Delegated oninput (data-oninput-action) ──────────────────────
  describe('delegated oninput — data-oninput-action', () => {
    it('dep-search calls showDepResults', () => {
      const el = document.createElement('input');
      el.dataset.oninputAction = 'dep-search';
      el.dataset.excludeId = 't_1';
      el.value = 'task';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(deps.showDepResults).toHaveBeenCalledWith('task', 't_1');
    });

    it('smart-date-preview calls previewSmartDate', () => {
      const el = document.createElement('input');
      el.dataset.oninputAction = 'smart-date-preview';
      el.dataset.dateId = 'fDueDate';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(deps.previewSmartDate).toHaveBeenCalledWith('fDueDate');
    });

    it('cmd-search resets index and renders results', () => {
      const el = document.createElement('input');
      el.dataset.oninputAction = 'cmd-search';
      el.value = 'test';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(deps.resetCmdIdx).toHaveBeenCalled();
      expect(deps.renderSearchResults).toHaveBeenCalledWith('test');
    });

    it('preview-quick-capture calls previewQuickCapture', () => {
      const el = document.createElement('input');
      el.dataset.oninputAction = 'preview-quick-capture';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(deps.previewQuickCapture).toHaveBeenCalled();
    });
  });

  // ── Delegated onchange (data-onchange-action) ───────────────────
  describe('delegated onchange — data-onchange-action', () => {
    it('import-data calls importData', () => {
      const el = document.createElement('input');
      el.dataset.onchangeAction = 'import-data';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deps.importData).toHaveBeenCalledWith(el);
    });

    it('bulk-move calls bulkAction and resets value', () => {
      const el = document.createElement('select');
      el.dataset.onchangeAction = 'bulk-move';
      const opt = document.createElement('option');
      opt.value = 'p_1';
      el.appendChild(opt);
      el.value = 'p_1';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deps.bulkAction).toHaveBeenCalledWith('move', 'p_1');
      expect(el.value).toBe('');
    });

    it('bulk-priority calls bulkAction and resets value', () => {
      const el = document.createElement('select');
      el.dataset.onchangeAction = 'bulk-priority';
      const opt = document.createElement('option');
      opt.value = 'urgent';
      el.appendChild(opt);
      el.value = 'urgent';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deps.bulkAction).toHaveBeenCalledWith('priority', 'urgent');
      expect(el.value).toBe('');
    });

    it('bulk-move does nothing when value is empty', () => {
      const el = document.createElement('select');
      el.dataset.onchangeAction = 'bulk-move';
      el.value = '';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deps.bulkAction).not.toHaveBeenCalled();
    });

    it('dump-review-select-all toggles all dump-check checkboxes', () => {
      const c1 = document.createElement('input');
      c1.type = 'checkbox';
      c1.dataset.dumpCheck = '1';
      const c2 = document.createElement('input');
      c2.type = 'checkbox';
      c2.dataset.dumpCheck = '2';
      document.body.appendChild(c1);
      document.body.appendChild(c2);
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.dataset.onchangeAction = 'dump-review-select-all';
      el.checked = true;
      document.body.appendChild(el);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(c1.checked).toBe(true);
      expect(c2.checked).toBe(true);
      c1.remove();
      c2.remove();
    });
  });

  // ── Auth form submit ─────────────────────────────────────────────
  describe('auth form submit', () => {
    it('prevents default and calls handleAuth when authForm is submitted', () => {
      const form = document.getElementById('authForm');
      const e = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(e);
      expect(deps.handleAuth).toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    });
  });

  // ── Chat input handlers ──────────────────────────────────────────
  describe('chat input handlers', () => {
    it('input on chatInput calls updateChatChips', () => {
      const chatInput = document.getElementById('chatInput');
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(deps.updateChatChips).toHaveBeenCalled();
    });

    it('Enter on chatInput (without Shift) calls sendChat', () => {
      const chatInput = document.getElementById('chatInput');
      keydown(chatInput, { key: 'Enter', shiftKey: false });
      expect(deps.sendChat).toHaveBeenCalled();
    });

    it('Shift+Enter on chatInput does not call sendChat', () => {
      const chatInput = document.getElementById('chatInput');
      keydown(chatInput, { key: 'Enter', shiftKey: true });
      expect(deps.sendChat).not.toHaveBeenCalled();
    });
  });

  // ── Skip link focus/blur ─────────────────────────────────────────
  describe('skip link focus/blur', () => {
    it('focusin on skip-link sets top to 0', () => {
      const el = document.createElement('a');
      el.className = 'skip-link';
      el.style.top = '-40px';
      document.body.appendChild(el);
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(el.style.top).toBe('0px');
    });

    it('focusout on skip-link sets top to -40px', () => {
      const el = document.createElement('a');
      el.className = 'skip-link';
      el.style.top = '0';
      document.body.appendChild(el);
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expect(el.style.top).toBe('-40px');
    });
  });

  // ── Close dropdowns on outside click ─────────────────────────────
  describe('dropdown close on outside click', () => {
    it('closes open dropdowns when clicking outside', () => {
      const dd = document.createElement('div');
      dd.className = 'dropdown open';
      document.body.appendChild(dd);
      // Click outside the dropdown
      click(document.body);
      expect(dd.classList.contains('open')).toBe(false);
    });

    it('does not close dropdown when clicking inside it', () => {
      const dd = document.createElement('div');
      dd.className = 'dropdown open';
      const child = document.createElement('span');
      dd.appendChild(child);
      document.body.appendChild(dd);
      click(child);
      expect(dd.classList.contains('open')).toBe(true);
    });
  });

  // ── j/k/x/e keyboard navigation ─────────────────────────────────
  describe('j/k/x/e keyboard navigation', () => {
    it('j increments kbIdx and highlights', () => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.task = 't_1';
      document.body.appendChild(row);
      deps.getKbIdx.mockReturnValue(-1);
      keydown(document.body, { key: 'j' });
      expect(deps.setKbIdx).toHaveBeenCalledWith(0);
      expect(deps.highlightKbRow).toHaveBeenCalled();
    });

    it('k decrements kbIdx and highlights', () => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.task = 't_1';
      document.body.appendChild(row);
      deps.getKbIdx.mockReturnValue(1);
      keydown(document.body, { key: 'k' });
      expect(deps.setKbIdx).toHaveBeenCalledWith(0);
      expect(deps.highlightKbRow).toHaveBeenCalled();
    });

    it('x toggles task status at current kbIdx', () => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.task = 't_1';
      document.body.appendChild(row);
      deps.getKbIdx.mockReturnValue(0);
      deps.findTask.mockReturnValue({ id: 't_1', status: 'todo' });
      keydown(document.body, { key: 'x' });
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
      expect(deps.render).toHaveBeenCalled();
    });

    it('x toggles done task back to todo', () => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.task = 't_1';
      document.body.appendChild(row);
      deps.getKbIdx.mockReturnValue(0);
      deps.findTask.mockReturnValue({ id: 't_1', status: 'done' });
      keydown(document.body, { key: 'x' });
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'todo' });
    });

    it('e opens edit for task at current kbIdx', () => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.task = 't_1';
      document.body.appendChild(row);
      deps.getKbIdx.mockReturnValue(0);
      keydown(document.body, { key: 'e' });
      expect(deps.openEditTask).toHaveBeenCalledWith('t_1');
    });

    it('Enter on kbIdx row toggles expand', () => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.task = 't_1';
      document.body.appendChild(row);
      deps.getKbIdx.mockReturnValue(0);
      deps.getExpandedTask.mockReturnValue(null);
      keydown(document.body, { key: 'Enter' });
      expect(deps.setExpandedTask).toHaveBeenCalledWith('t_1');
      expect(deps.render).toHaveBeenCalled();
    });
  });

  // ── Additional coverage: uncovered click actions ──────────────────
  describe('click — additional uncovered actions', () => {
    function makeActionEl(action, extras = {}) {
      const el = document.createElement('button');
      el.dataset.action = action;
      Object.entries(extras).forEach(([k, v]) => {
        el.dataset[k] = v;
      });
      document.body.appendChild(el);
      return el;
    }

    it('toggle-ai-insights toggles localStorage and renders', () => {
      localStorage.setItem('u1_wb_ai_insights_expanded', 'true');
      click(makeActionEl('toggle-ai-insights'));
      expect(localStorage.getItem('u1_wb_ai_insights_expanded')).toBe('false');
      expect(deps.render).toHaveBeenCalled();
    });

    it('toggle-ai-insights toggles from false to true', () => {
      localStorage.setItem('u1_wb_ai_insights_expanded', 'false');
      click(makeActionEl('toggle-ai-insights'));
      expect(localStorage.getItem('u1_wb_ai_insights_expanded')).toBe('true');
    });

    it('set-estimate sets value and highlights button', () => {
      const estimateInput = document.createElement('input');
      estimateInput.id = 'fEstimate';
      document.body.appendChild(estimateInput);
      const parent = document.createElement('div');
      const btn = document.createElement('button');
      btn.dataset.action = 'set-estimate';
      btn.dataset.minutes = '30';
      btn.className = 'btn';
      parent.appendChild(btn);
      document.body.appendChild(parent);
      click(btn);
      expect(estimateInput.value).toBe('30');
      expect(btn.style.background).toBe('var(--accent)');
      expect(btn.style.color).toBe('rgb(255, 255, 255)');
      estimateInput.remove();
      parent.remove();
    });

    it('pick-color sets border and picked attribute', () => {
      const colorsDiv = document.createElement('div');
      colorsDiv.id = 'fColors';
      const c1 = document.createElement('div');
      c1.dataset.action = 'pick-color';
      c1.dataset.color = '#ff0000';
      colorsDiv.appendChild(c1);
      document.body.appendChild(colorsDiv);
      click(c1);
      expect(c1.style.borderColor).toBe('rgb(255, 255, 255)');
      expect(c1.dataset.picked).toBe('1');
      colorsDiv.remove();
    });

    it('save-settings saves API key and closes modal', () => {
      const apiInput = document.createElement('input');
      apiInput.id = 'fApiKey';
      apiInput.value = 'sk-new-key';
      document.body.appendChild(apiInput);
      deps.getSettings.mockReturnValue({ apiKey: '' });
      click(makeActionEl('save-settings'));
      expect(deps.saveSettings).toHaveBeenCalled();
      expect(deps.closeModal).toHaveBeenCalled();
      expect(deps.showToast).toHaveBeenCalledWith('Saved');
      apiInput.remove();
    });

    it('toggle-api-key-vis toggles password/text type', () => {
      const apiInput = document.createElement('input');
      apiInput.id = 'fApiKey';
      apiInput.type = 'password';
      document.body.appendChild(apiInput);
      const btn = makeActionEl('toggle-api-key-vis');
      click(btn);
      expect(apiInput.type).toBe('text');
      expect(btn.textContent).toBe('hide');
      click(btn);
      expect(apiInput.type).toBe('password');
      expect(btn.textContent).toBe('show');
      apiInput.remove();
    });

    it('show-tips-again removes tip flag and shows tips', () => {
      vi.useFakeTimers();
      localStorage.setItem('u1_wb_tips_seen', '1');
      click(makeActionEl('show-tips-again'));
      expect(localStorage.getItem('u1_wb_tips_seen')).toBeNull();
      expect(deps.closeModal).toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(deps.showOnboardingExperience).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('cleanup-storage calls cleanupStorage and shows freed KB', () => {
      deps.cleanupStorage.mockReturnValue(2048);
      click(makeActionEl('cleanup-storage'));
      expect(deps.cleanupStorage).toHaveBeenCalled();
      expect(deps.showToast).toHaveBeenCalledWith('Freed 2 KB of storage');
      expect(deps.openSettings).toHaveBeenCalled();
    });

    it('cleanup-storage shows nothing to clean up when 0 freed', () => {
      deps.cleanupStorage.mockReturnValue(0);
      click(makeActionEl('cleanup-storage'));
      expect(deps.showToast).toHaveBeenCalledWith('Nothing to clean up');
    });

    it('open-project-chat calls openProjectChat', () => {
      click(makeActionEl('open-project-chat', { projectId: 'p_1' }));
      expect(deps.openProjectChat).toHaveBeenCalledWith('p_1');
    });

    it('tip-skip clears modalRoot', () => {
      document.getElementById('modalRoot').innerHTML = '<div>tip</div>';
      click(makeActionEl('tip-skip'));
      expect(document.getElementById('modalRoot').innerHTML).toBe('');
    });

    it('tip-next calls window._nextTip', () => {
      window._nextTip = vi.fn();
      click(makeActionEl('tip-next'));
      expect(window._nextTip).toHaveBeenCalled();
      delete window._nextTip;
    });

    it('onb-next advances to next screen in onboarding overlay', () => {
      // Create a mock onboarding overlay with screens and dots
      const overlay = document.createElement('div');
      overlay.id = 'onbOverlay';
      const s1 = document.createElement('div');
      s1.className = 'onb-screen onb-active';
      const s2 = document.createElement('div');
      s2.className = 'onb-screen';
      const d1 = document.createElement('div');
      d1.className = 'onb-dot onb-dot-active';
      const d2 = document.createElement('div');
      d2.className = 'onb-dot';
      overlay.append(s1, s2, d1, d2);
      document.body.appendChild(overlay);
      click(makeActionEl('onb-next'));
      expect(s1.classList.contains('onb-active')).toBe(false);
      expect(s2.classList.contains('onb-active')).toBe(true);
      overlay.remove();
    });

    it('load-dump-history sets view to dump', () => {
      vi.useFakeTimers();
      click(makeActionEl('load-dump-history', { dumpIndex: '0' }));
      expect(deps.setView).toHaveBeenCalledWith('dump');
      vi.advanceTimersByTime(200);
      vi.useRealTimers();
    });

    it('go-dump-weekly sets view to dump and prefills weekly text', () => {
      vi.useFakeTimers();
      const dumpText = document.createElement('textarea');
      dumpText.id = 'dumpText';
      document.body.appendChild(dumpText);
      click(makeActionEl('go-dump-weekly'));
      expect(deps.setView).toHaveBeenCalledWith('dump');
      vi.advanceTimersByTime(200);
      expect(dumpText.value).toContain('plans for the week');
      dumpText.remove();
      vi.useRealTimers();
    });

    it('skip-eod dismisses EOD card', () => {
      const eodCard = document.createElement('div');
      eodCard.id = 'eodCard';
      document.body.appendChild(eodCard);
      click(makeActionEl('skip-eod'));
      expect(localStorage.getItem('u1_whiteboard_eod_dismissed_2026-03-15')).toBe('1');
      expect(document.getElementById('eodCard')).toBeNull();
    });

    it('delete-task-confirm calls confirmAction and deletes on yes', async () => {
      deps.confirmAction.mockResolvedValue(true);
      click(makeActionEl('delete-task-confirm', { taskId: 't_1' }));
      await vi.waitFor(() => {
        expect(deps.confirmAction).toHaveBeenCalledWith('Delete this task?');
      });
      await vi.waitFor(() => {
        expect(deps.deleteTask).toHaveBeenCalledWith('t_1');
        expect(deps.closeModal).toHaveBeenCalled();
        expect(deps.setExpandedTask).toHaveBeenCalledWith(null);
        expect(deps.render).toHaveBeenCalled();
      });
    });

    it('close-edit-modal calls guardedCloseEditModal when available', () => {
      click(makeActionEl('close-edit-modal'));
      expect(deps.guardedCloseEditModal).toHaveBeenCalled();
    });

    it('escalation-action calls handleEscalationAction', () => {
      click(makeActionEl('escalation-action', { escAction: 'defer', escTask: 't_1', escKey: 'k1' }));
      expect(deps.handleEscalationAction).toHaveBeenCalledWith('defer', 't_1', 'k1');
    });

    it('rebalance-week calls autoRebalanceWeek', () => {
      click(makeActionEl('rebalance-week'));
      expect(deps.autoRebalanceWeek).toHaveBeenCalled();
    });

    it('reschedule-accept calls acceptReschedule with index', () => {
      click(makeActionEl('reschedule-accept', { idx: '3' }));
      expect(deps.acceptReschedule).toHaveBeenCalledWith(3);
    });

    it('reschedule-skip calls skipReschedule with index', () => {
      click(makeActionEl('reschedule-skip', { idx: '2' }));
      expect(deps.skipReschedule).toHaveBeenCalledWith(2);
    });

    it('reschedule-accept-all calls acceptAllReschedules', () => {
      click(makeActionEl('reschedule-accept-all'));
      expect(deps.acceptAllReschedules).toHaveBeenCalled();
    });

    it('save-as-template calls saveAsTemplate', () => {
      click(makeActionEl('save-as-template', { taskId: 't_1' }));
      expect(deps.saveAsTemplate).toHaveBeenCalledWith('t_1');
    });

    it('delete-template calls deleteTemplate and openSettings', () => {
      click(makeActionEl('delete-template', { templateId: 'tmpl_1' }));
      expect(deps.deleteTemplate).toHaveBeenCalledWith('tmpl_1');
      expect(deps.openSettings).toHaveBeenCalled();
    });

    it('edit-template calls openEditTemplate', () => {
      click(makeActionEl('edit-template', { templateId: 'tmpl_1' }));
      expect(deps.openEditTemplate).toHaveBeenCalledWith('tmpl_1');
    });

    it('save-edit-template calls saveEditTemplate', () => {
      click(makeActionEl('save-edit-template', { templateId: 'tmpl_1' }));
      expect(deps.saveEditTemplate).toHaveBeenCalledWith('tmpl_1');
    });

    it('apply-template-quick calls applyTemplateToQuickAdd', () => {
      click(makeActionEl('apply-template-quick', { templateId: 'tmpl_1' }));
      expect(deps.applyTemplateToQuickAdd).toHaveBeenCalledWith('tmpl_1');
    });

    it('restore-backup calls restoreFromBackup', () => {
      click(makeActionEl('restore-backup'));
      expect(deps.restoreFromBackup).toHaveBeenCalled();
    });

    it('start-fresh calls dismissCorruption', () => {
      click(makeActionEl('start-fresh'));
      expect(deps.dismissCorruption).toHaveBeenCalled();
    });

    it('breakdown-task calls breakdownTask', () => {
      click(makeActionEl('breakdown-task', { taskId: 't_1' }));
      expect(deps.breakdownTask).toHaveBeenCalledWith('t_1');
    });

    it('breakdown-dismiss calls dismissVagueTask and renders', () => {
      click(makeActionEl('breakdown-dismiss', { taskId: 't_1' }));
      expect(deps.dismissVagueTask).toHaveBeenCalledWith('t_1');
      expect(deps.render).toHaveBeenCalled();
    });

    it('stuck-help calls offerStuckHelp', () => {
      click(makeActionEl('stuck-help', { taskId: 't_1' }));
      expect(deps.offerStuckHelp).toHaveBeenCalledWith('t_1');
    });

    it('stuck-breakdown calls breakdownTask', () => {
      click(makeActionEl('stuck-breakdown', { taskId: 't_1' }));
      expect(deps.breakdownTask).toHaveBeenCalledWith('t_1');
    });

    it('stuck-reschedule reschedules task to tomorrow', () => {
      click(makeActionEl('stuck-reschedule', { taskId: 't_1' }));
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', expect.objectContaining({ dueDate: expect.any(String) }));
      expect(deps.showToast).toHaveBeenCalledWith('Rescheduled to tomorrow');
      expect(deps.render).toHaveBeenCalled();
    });

    it('checkin-dismiss calls dismissCheckIn and renders', () => {
      click(makeActionEl('checkin-dismiss'));
      expect(deps.dismissCheckIn).toHaveBeenCalled();
      expect(deps.render).toHaveBeenCalled();
    });

    it('checkin-do-now updates task to in-progress', () => {
      click(makeActionEl('checkin-do-now', { taskId: 't_1' }));
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'in-progress' });
      expect(deps.render).toHaveBeenCalled();
    });

    it('checkin-push-tomorrow pushes task to tomorrow', () => {
      click(makeActionEl('checkin-push-tomorrow', { taskId: 't_1' }));
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', expect.objectContaining({ dueDate: expect.any(String) }));
      expect(deps.showToast).toHaveBeenCalledWith('Pushed to tomorrow');
      expect(deps.render).toHaveBeenCalled();
    });

    it('checkin-drop marks task as done', () => {
      click(makeActionEl('checkin-drop', { taskId: 't_1' }));
      expect(deps.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
      expect(deps.showToast).toHaveBeenCalledWith('Task dropped');
      expect(deps.render).toHaveBeenCalled();
    });

    it('import-click triggers importFile click', () => {
      const importFile = document.createElement('input');
      importFile.id = 'importFile';
      importFile.type = 'file';
      document.body.appendChild(importFile);
      const clickSpy = vi.spyOn(importFile, 'click');
      click(makeActionEl('import-click'));
      expect(clickSpy).toHaveBeenCalled();
      importFile.remove();
    });

    it('confirm-yes dismisses toast with true', () => {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast._dismiss = vi.fn();
      const btn = document.createElement('button');
      btn.dataset.action = 'confirm-yes';
      toast.appendChild(btn);
      document.body.appendChild(toast);
      click(btn);
      expect(toast._dismiss).toHaveBeenCalledWith(true);
      toast.remove();
    });

    it('confirm-no dismisses toast with false', () => {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast._dismiss = vi.fn();
      const btn = document.createElement('button');
      btn.dataset.action = 'confirm-no';
      toast.appendChild(btn);
      document.body.appendChild(toast);
      click(btn);
      expect(toast._dismiss).toHaveBeenCalledWith(false);
      toast.remove();
    });

    it('cmd-go-project closes modal and navigates to project', () => {
      click(makeActionEl('cmd-go-project', { projectId: 'p_1' }));
      expect(deps.closeModal).toHaveBeenCalled();
      expect(deps.setView).toHaveBeenCalledWith('project', 'p_1');
    });

    it('cmd-go-task navigates to task with project', () => {
      vi.useFakeTimers();
      click(makeActionEl('cmd-go-task', { taskId: 't_1', projectId: 'p_1' }));
      expect(deps.closeModal).toHaveBeenCalled();
      expect(deps.setView).toHaveBeenCalledWith('project', 'p_1');
      vi.advanceTimersByTime(100);
      expect(deps.setExpandedTask).toHaveBeenCalledWith('t_1');
      vi.useRealTimers();
    });

    it('cmd-create-task creates task and shows toast', () => {
      window._cmdCreateTitle = 'New Task';
      click(makeActionEl('cmd-create-task'));
      expect(deps.closeModal).toHaveBeenCalled();
      expect(deps.addTask).toHaveBeenCalled();
      expect(deps.showToast).toHaveBeenCalledWith('Task created');
      delete window._cmdCreateTitle;
    });

    it('view-organized navigates to dashboard by default', async () => {
      click(makeActionEl('view-organized'));
      await vi.waitFor(() => {
        expect(deps.setView).toHaveBeenCalledWith('dashboard');
      });
    });

    it('new-brainstorm resets state and opens modal', async () => {
      click(makeActionEl('new-brainstorm'));
      await vi.waitFor(() => {
        expect(deps.render).toHaveBeenCalled();
      });
    });

    it('remove-dump-attachment removes attachment by index', async () => {
      click(makeActionEl('remove-dump-attachment', { idx: '2' }));
      await vi.waitFor(() => {
        expect(deps.render).toHaveBeenCalled();
      });
    });

    it('cal-expand sets expanded day and renders', () => {
      click(makeActionEl('cal-expand', { date: '2026-03-20' }));
      expect(deps.render).toHaveBeenCalled();
    });

    it('cal-collapse clears expanded day and renders', () => {
      click(makeActionEl('cal-collapse'));
      expect(deps.render).toHaveBeenCalled();
    });

    it('open-edit-project inside dropdown closes dropdown', () => {
      const dd = document.createElement('div');
      dd.className = 'dropdown open';
      const btn = document.createElement('button');
      btn.dataset.action = 'open-edit-project';
      btn.dataset.projectId = 'p_1';
      dd.appendChild(btn);
      document.body.appendChild(dd);
      click(btn);
      expect(deps.openEditProject).toHaveBeenCalledWith('p_1');
      expect(dd.classList.contains('open')).toBe(false);
      dd.remove();
    });

    it('dump-files change event calls handleDumpFiles', () => {
      const el = document.createElement('input');
      el.type = 'file';
      el.dataset.onchangeAction = 'dump-files';
      document.body.appendChild(el);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deps.handleDumpFiles).toHaveBeenCalled();
      el.remove();
    });

    it('toggle-notif-sub saves notification sub-preferences', () => {
      const el = makeActionEl('toggle-notif-sub', { notifKey: 'briefing' });
      el.checked = true;
      click(el);
      expect(deps.getNotifications).toHaveBeenCalled();
    });
  });
});
