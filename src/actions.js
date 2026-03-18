// ============================================================
// DATA-ACTION DELEGATION — Handles ALL static HTML interactions
// Extracted from app.js for modularity.
// ============================================================

/**
 * Factory: creates and attaches all delegated event listeners.
 * Call `createActions(deps)` once after all modules are wired.
 *
 * @param {object} deps — all functions / getters the handlers need
 */
export function createActions(deps) {
  const {
    // View / navigation
    setView,
    render,
    closeModal,
    closeMobileSidebar,
    openMobileSidebar,
    toggleSidebar,
    toggleChat,
    sendChat,
    sendChatChip,
    updateChatChips,
    // Task CRUD
    openEditTask,
    openNewTask,
    saveNewTask,
    saveEditTask,
    updateTask,
    deleteTask,
    addTask,
    createTask,
    toggleSubtask,
    undo,
    unarchiveTask,
    deleteArchivedPermanently,
    restoreFromBackup,
    dismissCorruption,
    findTask,
    // Projects
    openNewProject,
    saveNewProject,
    openEditProject,
    saveEditProject,
    confirmDeleteProject,
    // Bulk
    toggleBulkMode,
    bulkAction,
    // Focus
    startFocus,
    openFocusView,
    closeFocus,
    completeFocusTask,
    skipFocusTask,
    renderFocusOverlay,
    // Search / command palette
    openSearch,
    openQuickAdd,
    submitQuickAdd,
    openShortcutHelp,
    handleCmdNav,
    renderSearchResults,
    resetCmdIdx,
    cmdExec,
    previewQuickCapture,
    // Calendar
    getCalModule,
    // Brainstorm
    processDump,
    cancelDump,
    applyDumpResults,
    submitClarify,
    skipClarify,
    getBrainstormModule,
    // Settings
    openSettings,
    exportData,
    importData,
    exportCalendar,
    archiveMemory,
    restoreMemory,
    deleteAIMemory,
    confirmClearMemories,
    confirmResetData,
    editProjectBackground,
    saveProjectBackground,
    // Auth
    showAuthFromLanding,
    handleAuth,
    toggleAuthMode,
    showForgotPassword,
    showPrivacy,
    showTerms,
    signOut,
    resendVerification,
    // AI / Proactive
    generateAIBriefing,
    planMyDay,
    replanDay,
    snoozePlanTask,
    dismissCheckIn,
    breakdownTask,
    dismissVagueTask,
    offerStuckHelp,
    submitEndOfDay,
    aiReorganize,
    generateWeeklyReview,
    discussReview,
    // UI helpers
    showToast,
    addTagToPicker,
    previewSmartDate,
    showDepResults,
    removeDep,
    confirmAction,
    quickAddToProject,
    addSubtask,
    runTaskCmd,
    heroInputHandler,
    handleEscalationAction,
    autoRebalanceWeek,
    acceptReschedule,
    skipReschedule,
    acceptAllReschedules,
    showOnboardingExperience,
    // State getters/setters
    getExpandedTask,
    setExpandedTask,
    getCurrentProject,
    getShowCompleted,
    setShowCompleted,
    setDashViewMode,
    getKbIdx,
    setKbIdx,
    getSectionShowCount,
    setSectionShowCount,
    getArchiveShowCount,
    setArchiveShowCount,
    TASKS_PER_PAGE,
    setSmartFeedExpanded,
    setTodayBriefingExpanded,
    setActiveTagFilter,
    getShowTagFilter,
    setShowTagFilter,
    setProjectViewMode,
    getShowProjectBg,
    setShowProjectBg,
    getFocusModule,
    highlightKbRow,
    saveSettings,
    getSettings,
    $,
    userKey,
    todayStr,
    getNotifications,
    // Templates
    saveAsTemplate,
    deleteTemplate,
    openEditTemplate,
    saveEditTemplate,
    applyTemplateToQuickAdd,
  } = deps;

  // ---- click: nav items + data-action dispatch ----
  document.addEventListener('click', (e) => {
    const navView = e.target.closest('.nav-item[data-view]');
    if (navView) {
      if (navView.dataset.view === 'dump' && typeof deps.openBrainstormModal === 'function') {
        deps.openBrainstormModal();
      } else {
        setView(navView.dataset.view);
      }
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    if (actionEl.dataset.clickSelf === 'true' && e.target !== actionEl) return;
    const action = actionEl.dataset.action;

    switch (action) {
      // Landing page
      case 'auth-landing':
        showAuthFromLanding();
        break;
      case 'auth-landing-login':
        showAuthFromLanding('login');
        break;
      // Auth
      case 'toggle-auth':
        toggleAuthMode();
        break;
      case 'forgot-password':
        showForgotPassword();
        break;
      case 'show-privacy':
        showPrivacy();
        break;
      case 'show-terms':
        showTerms();
        break;
      case 'sign-out':
        signOut();
        break;
      // Sidebar
      case 'new-project':
        openNewProject();
        break;
      case 'settings':
        openSettings();
        break;
      case 'open-search':
        openSearch();
        break;
      case 'toggle-sidebar':
        toggleSidebar();
        break;
      case 'close-mobile-sidebar':
        closeMobileSidebar();
        break;
      case 'open-mobile-sidebar':
        openMobileSidebar();
        break;
      // Chat
      case 'toggle-chat':
        toggleChat();
        break;
      case 'toggle-ai-insights': {
        const cur = localStorage.getItem(userKey('wb_ai_insights_expanded'));
        localStorage.setItem(userKey('wb_ai_insights_expanded'), cur === 'false' ? 'true' : 'false');
        render();
        break;
      }
      case 'send-chat':
        sendChat();
        break;
      case 'chat-chip':
        sendChatChip(actionEl.dataset.text);
        break;
      // Archive
      case 'delete-archived':
        deleteArchivedPermanently();
        break;
      case 'restore-task':
        unarchiveTask(actionEl.dataset.taskId);
        break;
      case 'archive-show-more':
        setArchiveShowCount(getArchiveShowCount() + 50);
        render();
        break;
      case 'section-show-more': {
        const sk = actionEl.dataset.section;
        setSectionShowCount(sk, (getSectionShowCount(sk) || TASKS_PER_PAGE) + TASKS_PER_PAGE);
        render();
        break;
      }
      // Task actions
      case 'edit-task':
        openEditTask(actionEl.dataset.taskId);
        break;
      case 'focus-task':
        openFocusView(actionEl.dataset.taskId);
        break;
      case 'complete-task': {
        const _cTaskId = actionEl.dataset.taskId;
        const _cTask = findTask(_cTaskId);
        updateTask(_cTaskId, { status: 'done' });
        render();
        if (_cTask)
          showToast(
            `\u2713 ${_cTask.title.slice(0, 30)}${_cTask.title.length > 30 ? '...' : ''} done \u2014 <span style="color:var(--accent);cursor:pointer;text-decoration:underline" data-action="undo-btn">Undo</span>`,
            false,
            true,
          );
        break;
      }
      // Task expand/collapse
      case 'toggle-expand': {
        const tid = actionEl.dataset.task || actionEl.dataset.taskId;
        setExpandedTask(getExpandedTask() === tid ? null : tid);
        render();
        break;
      }
      case 'toggle-completed': {
        const k = actionEl.dataset.key;
        setShowCompleted(k, !getShowCompleted(k));
        render();
        break;
      }
      // Dashboard view mode
      case 'dash-view':
        setDashViewMode(actionEl.dataset.mode);
        getCalModule().resetOffset();
        render();
        break;
      case 'toggle-bulk':
        toggleBulkMode();
        break;
      case 'start-focus':
        startFocus();
        break;
      case 'escalation-action':
        handleEscalationAction(actionEl.dataset.escAction, actionEl.dataset.escTask, actionEl.dataset.escKey);
        break;
      case 'rebalance-week':
        autoRebalanceWeek();
        break;
      case 'reschedule-accept':
        acceptReschedule(parseInt(actionEl.dataset.idx));
        break;
      case 'reschedule-skip':
        skipReschedule(parseInt(actionEl.dataset.idx));
        break;
      case 'reschedule-accept-all':
        acceptAllReschedules();
        break;
      // Calendar
      case 'cal-new-task':
        openNewTask('', actionEl.dataset.date);
        break;
      case 'cal-expand':
        getCalModule().setExpandedDay(actionEl.dataset.date);
        render();
        break;
      case 'cal-collapse':
        getCalModule().setExpandedDay(null);
        render();
        break;
      case 'cal-nav':
        deps.calNav(parseInt(actionEl.dataset.dir));
        break;
      case 'cal-today':
        deps.calToday();
        break;
      // Onboarding experience
      case 'onb-next': {
        const overlay = document.getElementById('onbOverlay');
        if (overlay) {
          const screens = overlay.querySelectorAll('.onb-screen');
          const dots = overlay.querySelectorAll('.onb-dot');
          let cur = -1;
          screens.forEach((s, i) => {
            if (s.classList.contains('onb-active')) cur = i;
          });
          if (cur < screens.length - 1) {
            screens.forEach((s, i) => s.classList.toggle('onb-active', i === cur + 1));
            dots.forEach((d, i) => d.classList.toggle('onb-dot-active', i === cur + 1));
          }
        }
        break;
      }
      case 'onb-skip': {
        localStorage.setItem('wb_onboarding_complete', '1');
        const overlay = document.getElementById('onbOverlay');
        if (overlay) {
          overlay.style.opacity = '0';
          setTimeout(() => {
            if (overlay.parentNode) overlay.remove();
          }, 300);
        }
        break;
      }
      case 'onb-brainstorm': {
        localStorage.setItem('wb_onboarding_complete', '1');
        const overlay = document.getElementById('onbOverlay');
        if (overlay) {
          overlay.style.opacity = '0';
          setTimeout(() => {
            if (overlay.parentNode) overlay.remove();
          }, 300);
        }
        if (typeof deps.openBrainstormModal === 'function') deps.openBrainstormModal();
        else setView('dump');
        break;
      }
      case 'onb-explore': {
        localStorage.setItem('wb_onboarding_complete', '1');
        const overlay = document.getElementById('onbOverlay');
        if (overlay) {
          overlay.style.opacity = '0';
          setTimeout(() => {
            if (overlay.parentNode) overlay.remove();
          }, 300);
        }
        setView('dashboard');
        break;
      }
      // Legacy feature tips
      case 'tip-skip':
        document.getElementById('modalRoot').innerHTML = '';
        break;
      case 'tip-next':
        if (window._nextTip) window._nextTip();
        break;
      // Modal close (generic)
      case 'close-modal':
        cancelDump(); // abort brainstorm if running
        closeModal();
        break;
      case 'close-edit-modal':
        if (deps.guardedCloseEditModal) deps.guardedCloseEditModal();
        else closeModal();
        break;
      case 'close-modal-root':
        document.getElementById('modalRoot').innerHTML = '';
        break;
      // Error recovery
      case 'reload-page':
        location.reload();
        break;
      case 'restore-backup':
        restoreFromBackup();
        break;
      case 'start-fresh':
        dismissCorruption();
        break;
      case 'export-data':
        exportData();
        break;
      case 'cleanup-storage':
        if (typeof deps.cleanupStorage === 'function') {
          const freed = deps.cleanupStorage();
          const freedKB = Math.round(freed / 1024);
          showToast(freedKB > 0 ? `Freed ${freedKB} KB of storage` : 'Nothing to clean up');
          if (typeof deps.openSettings === 'function') deps.openSettings();
        }
        break;
      // Project view
      case 'project-view-mode':
        setProjectViewMode(actionEl.dataset.projectId, actionEl.dataset.mode);
        render();
        break;
      case 'open-project-chat':
        deps.openProjectChat(actionEl.dataset.projectId);
        break;
      case 'open-new-task':
        openNewTask(actionEl.dataset.projectId || '');
        break;
      case 'toggle-dropdown':
        actionEl.closest('.dropdown').classList.toggle('open');
        break;
      case 'start-focus-project':
        startFocus(actionEl.dataset.projectId);
        actionEl.closest('.dropdown').classList.remove('open');
        break;
      case 'ai-reorganize':
        aiReorganize(actionEl.dataset.projectId);
        actionEl.closest('.dropdown').classList.remove('open');
        break;
      case 'open-edit-project':
        openEditProject(actionEl.dataset.projectId);
        if (actionEl.closest('.dropdown')) actionEl.closest('.dropdown').classList.remove('open');
        break;
      case 'toggle-project-bg': {
        const pid = actionEl.dataset.projectId;
        setShowProjectBg(pid, !getShowProjectBg(pid));
        render();
        break;
      }
      case 'edit-project-bg':
        editProjectBackground(actionEl.dataset.projectId);
        break;
      // Subtask toggle
      case 'toggle-subtask':
        e.stopPropagation();
        toggleSubtask(actionEl.dataset.taskId, actionEl.dataset.subtaskId);
        break;
      case 'edit-subtask': {
        e.stopPropagation();
        const stId = actionEl.dataset.subtaskId;
        const stTaskId = actionEl.dataset.taskId;
        // Find the subtask title span in the same row
        const row = actionEl.closest('div');
        const titleSpan = row ? row.querySelector('.subtask-title') : null;
        if (titleSpan) {
          const oldTitle = titleSpan.textContent;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = oldTitle;
          input.style.cssText =
            'font-size:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--accent);border-radius:4px;padding:2px 6px;width:100%;outline:none;font-family:inherit';
          titleSpan.replaceWith(input);
          input.focus();
          input.select();
          let committed = false;
          const commit = () => {
            if (committed) return;
            committed = true;
            const newTitle = input.value.trim();
            if (newTitle && newTitle !== oldTitle && typeof deps.renameSubtask === 'function') {
              deps.renameSubtask(stTaskId, stId, newTitle);
            } else {
              render();
            }
          };
          input.addEventListener('keydown', (ke) => {
            ke.stopPropagation();
            if (ke.key === 'Enter') {
              ke.preventDefault();
              commit();
            }
            if (ke.key === 'Escape') {
              committed = true;
              render();
            }
          });
          input.addEventListener('blur', commit);
        }
        break;
      }
      case 'delete-subtask':
        e.stopPropagation();
        if (typeof deps.deleteSubtask === 'function') {
          deps.deleteSubtask(actionEl.dataset.taskId, actionEl.dataset.subtaskId);
        }
        break;
      case 'toggle-subtask-notes': {
        e.stopPropagation();
        const notesArea = document.querySelector(
          `.subtask-notes-area[data-subtask-notes="${actionEl.dataset.subtaskId}"]`,
        );
        if (notesArea) {
          const showing = notesArea.style.display !== 'none';
          notesArea.style.display = showing ? 'none' : '';
          if (!showing) {
            const ta = notesArea.querySelector('textarea');
            if (ta) ta.focus();
          }
        }
        break;
      }
      case 'toggle-subtask-focus':
        toggleSubtask(actionEl.dataset.taskId, actionEl.dataset.subtaskId);
        renderFocusOverlay();
        break;
      case 'toggle-add-child-subtask': {
        e.stopPropagation();
        const parentId = actionEl.dataset.subtaskId;
        const inputRow = document.querySelector(`.child-subtask-input[data-parent-subtask="${parentId}"]`);
        if (inputRow) {
          const isVisible = inputRow.style.display !== 'none';
          inputRow.style.display = isVisible ? 'none' : 'block';
          actionEl.setAttribute('aria-expanded', isVisible ? 'false' : 'true');
          if (!isVisible) {
            const inp = inputRow.querySelector('input');
            if (inp) inp.focus();
          }
        }
        break;
      }
      // Tag chip toggle (in tag picker)
      case 'toggle-tag-chip':
        actionEl.classList.toggle('selected');
        break;
      // Bulk actions
      case 'bulk-action':
        bulkAction(actionEl.dataset.bulkType, actionEl.dataset.bulkValue);
        break;
      case 'bulk-cancel':
        toggleBulkMode();
        break;
      // Remove dependency
      case 'remove-dep':
        e.stopPropagation();
        removeDep(actionEl.dataset.taskId, actionEl.dataset.blockerId);
        break;
      // Task nudge
      case 'task-nudge':
        e.stopPropagation();
        openEditTask(actionEl.dataset.taskId);
        break;
      // Undo toast
      case 'undo-btn':
        undo();
        actionEl.closest('.toast')?.remove();
        break;
      // Confirm action buttons
      case 'confirm-yes':
        actionEl.closest('.toast')?._dismiss(true);
        break;
      case 'confirm-no':
        actionEl.closest('.toast')?._dismiss(false);
        break;
      // New/Edit project modals
      case 'save-new-project':
        saveNewProject();
        break;
      case 'save-edit-project':
        saveEditProject(actionEl.dataset.projectId);
        break;
      case 'confirm-delete-project':
        confirmDeleteProject(actionEl.dataset.projectId);
        break;
      // New/Edit task modals
      case 'save-new-task':
        saveNewTask();
        break;
      case 'save-edit-task':
        saveEditTask(actionEl.dataset.taskId);
        break;
      case 'delete-task-confirm':
        confirmAction('Delete this task?').then((ok) => {
          if (ok) {
            deleteTask(actionEl.dataset.taskId);
            closeModal();
            setExpandedTask(null);
            render();
          }
        });
        break;
      case 'remove-dep-chip':
        actionEl.remove();
        break;
      // Estimate quick buttons
      case 'set-estimate': {
        const val = parseInt(actionEl.dataset.minutes);
        document.getElementById('fEstimate').value = val;
        actionEl.parentElement
          .querySelectorAll('.btn')
          .forEach((b) => (b.style.cssText = 'padding:3px 8px;font-size:10px'));
        actionEl.style.background = 'var(--accent)';
        actionEl.style.color = '#fff';
        actionEl.style.borderColor = 'var(--accent)';
        break;
      }
      // Color picker in edit project
      case 'pick-color': {
        document.querySelectorAll('#fColors div').forEach((d) => {
          d.style.borderColor = 'transparent';
          delete d.dataset.picked;
        });
        actionEl.style.borderColor = '#fff';
        actionEl.dataset.picked = '1';
        break;
      }
      // Brainstorm / Dump
      case 'process-dump':
        processDump();
        break;
      case 'cancel-dump':
        cancelDump();
        break;
      case 'view-organized': {
        const bm = getBrainstormModule();
        if (bm && bm.setLastDumpResult) bm.setLastDumpResult(null);
        closeModal();
        setView('dashboard');
        render();
        break;
      }
      case 'new-brainstorm': {
        const bm2 = getBrainstormModule();
        if (bm2 && bm2.setLastDumpResult) bm2.setLastDumpResult(null);
        if (typeof deps.openBrainstormModal === 'function') deps.openBrainstormModal();
        else render();
        break;
      }

      case 'remove-dump-attachment':
        getBrainstormModule().removeDumpAttachment(parseInt(actionEl.dataset.idx));
        render();
        break;
      case 'dismiss-onboarding-hint':
        localStorage.removeItem(userKey('wb_onboarding_hint'));
        render();
        break;
      case 'open-settings':
        openSettings();
        break;
      case 'open-native-date-picker': {
        const picker = document.getElementById(actionEl.dataset.target);
        if (picker && picker.showPicker) picker.showPicker();
        break;
      }
      case 'submit-clarify':
        submitClarify();
        break;
      case 'skip-clarify':
        skipClarify();
        break;
      case 'dump-review-cancel':
        closeModal();
        undo();
        break;
      case 'apply-dump-results':
        applyDumpResults();
        break;
      // Search / Command palette
      case 'cmd-exec':
        cmdExec(actionEl.dataset.cmdKey, actionEl.dataset.cmdLabel);
        break;
      case 'cmd-go-project':
        closeModal();
        setView('project', actionEl.dataset.projectId);
        break;
      case 'cmd-go-task': {
        closeModal();
        const pid2 = actionEl.dataset.projectId;
        if (pid2) setView('project', pid2);
        else setView('dashboard');
        const tid2 = actionEl.dataset.taskId;
        setTimeout(() => {
          setExpandedTask(tid2);
          render();
        }, 50);
        break;
      }
      case 'cmd-create-task':
        closeModal();
        addTask(createTask({ title: window._cmdCreateTitle, project: getCurrentProject() || '' }));
        showToast('Task created');
        render();
        break;
      // Quick add
      case 'submit-quick-add':
        submitQuickAdd();
        break;
      // Settings
      case 'archive-memory':
        archiveMemory(parseInt(actionEl.dataset.idx));
        openSettings();
        break;
      case 'delete-ai-memory':
        deleteAIMemory(parseInt(actionEl.dataset.idx));
        break;
      case 'restore-memory':
        restoreMemory(parseInt(actionEl.dataset.idx));
        openSettings();
        break;
      case 'confirm-clear-memories':
        confirmClearMemories();
        break;
      case 'confirm-reset-data':
        confirmResetData();
        break;
      case 'import-click':
        document.getElementById('importFile').click();
        break;
      case 'export-calendar':
        exportCalendar();
        break;
      case 'save-settings': {
        const s = getSettings();
        s.apiKey = $('#fApiKey').value.trim();
        saveSettings(s);
        closeModal();
        showToast('Saved');
        break;
      }
      case 'show-tips-again':
        localStorage.removeItem(userKey('wb_tips_seen'));
        closeModal();
        setTimeout(showOnboardingExperience, 300);
        break;
      // Templates
      case 'save-as-template':
        if (saveAsTemplate) saveAsTemplate(actionEl.dataset.taskId);
        break;
      case 'delete-template':
        if (deleteTemplate) {
          deleteTemplate(actionEl.dataset.templateId);
          openSettings();
        }
        break;
      case 'edit-template':
        if (openEditTemplate) openEditTemplate(actionEl.dataset.templateId);
        break;
      case 'save-edit-template':
        if (saveEditTemplate) saveEditTemplate(actionEl.dataset.templateId);
        break;
      case 'apply-template-quick':
        if (applyTemplateToQuickAdd) applyTemplateToQuickAdd(actionEl.dataset.templateId);
        break;
      case 'toggle-api-key-vis': {
        const f = document.getElementById('fApiKey');
        f.type = f.type === 'password' ? 'text' : 'password';
        actionEl.textContent = f.type === 'password' ? 'show' : 'hide';
        break;
      }
      // Notification toggles
      case 'toggle-notif-enabled': {
        if (getNotifications) {
          const nm = getNotifications();
          const p = nm.getPrefs();
          p.enabled = actionEl.checked;
          nm.savePrefs(p);
          if (p.enabled)
            nm.requestPermission().then(() => {
              openSettings();
            });
          else {
            nm.clearScheduled();
            openSettings();
          }
        }
        break;
      }
      case 'toggle-notif-sub': {
        if (getNotifications) {
          const nm = getNotifications();
          const p = nm.getPrefs();
          const key = actionEl.dataset.notifKey;
          if (key) {
            p[key] = actionEl.checked;
            nm.savePrefs(p);
            nm.scheduleNotifications();
          }
        }
        break;
      }
      // Weekly review
      case 'generate-review':
        generateWeeklyReview();
        break;
      case 'discuss-review':
        discussReview();
        break;
      // Focus mode
      case 'complete-focus':
        completeFocusTask();
        break;
      case 'skip-focus':
        skipFocusTask();
        break;
      case 'close-focus':
        closeFocus();
        break;
      case 'log-distraction': {
        const fm = getFocusModule();
        if (fm) fm.then((m) => m.logDistraction());
        break;
      }
      case 'start-break': {
        const fm = getFocusModule();
        if (fm) fm.then((m) => m.startBreakTimer());
        break;
      }
      case 'end-break': {
        const fm = getFocusModule();
        if (fm) fm.then((m) => m.endBreak());
        break;
      }
      case 'focus-goal-pick': {
        const fm = getFocusModule();
        if (fm) fm.then((m) => m.handleGoalPick(actionEl.dataset.goal));
        break;
      }
      case 'focus-goal-start': {
        const fm = getFocusModule();
        if (fm) fm.then((m) => m.handleGoalStart());
        break;
      }
      // Project background editor
      case 'save-project-bg':
        saveProjectBackground(actionEl.dataset.projectId);
        break;
      // Dashboard: smart feed, briefing, plan, EOD
      case 'smart-feed-expand':
        setSmartFeedExpanded(true);
        render();
        break;
      case 'smart-feed-collapse':
        setSmartFeedExpanded(false);
        render();
        break;
      case 'briefing-expand':
        setTodayBriefingExpanded(true);
        render();
        break;
      case 'briefing-collapse':
        setTodayBriefingExpanded(false);
        render();
        break;
      case 'scroll-to-plan': {
        const planEl = document.getElementById('dayPlanSection') || document.querySelector('.plan-section');
        if (planEl) planEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'generate-briefing':
        generateAIBriefing();
        break;
      case 'plan-my-day':
        planMyDay();
        break;
      case 'clear-plan':
        localStorage.removeItem(actionEl.dataset.planKey);
        render();
        break;
      case 'snooze-plan-task':
        snoozePlanTask(actionEl.dataset.taskId);
        break;
      case 'replan-day':
        replanDay();
        break;
      case 'dismiss-plan-prompt':
        localStorage.setItem(userKey('whiteboard_plan_dismissed_' + todayStr()), '1');
        render();
        break;
      case 'add-to-plan': {
        const planKey = userKey('whiteboard_plan_' + todayStr());
        const plan = JSON.parse(localStorage.getItem(planKey) || '[]');
        const planIds = new Set(plan.map((p) => p.id));
        const stored = JSON.parse(localStorage.getItem(userKey('wb_data')) || '{"tasks":[]}');
        const candidates = (stored.tasks || []).filter((t) => t.status !== 'done' && !t.archived && !planIds.has(t.id));
        if (!candidates.length) {
          showToast('No tasks available to add');
          break;
        }
        const opts = candidates
          .slice(0, 20)
          .map(
            (t) =>
              `<button class="btn btn-sm" style="text-align:left;display:block;width:100%;margin-bottom:4px" data-action="add-task-to-plan" data-task-id="${t.id}">${t.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</button>`,
          )
          .join('');
        const modalRoot = document.getElementById('modalRoot');
        if (modalRoot) {
          modalRoot.innerHTML = `<div class="modal-overlay" data-action="close-modal" data-click-self="true">
            <div class="modal" style="max-width:400px;padding:24px">
              <h3 style="margin-bottom:12px;font-size:15px">Add to today's plan</h3>
              <div style="max-height:300px;overflow-y:auto">${opts}</div>
              <button class="btn btn-sm" data-action="close-modal" style="margin-top:12px;color:var(--text3)">Cancel</button>
            </div>
          </div>`;
        }
        break;
      }
      case 'add-task-to-plan': {
        const taskId = actionEl.dataset.taskId;
        const pk = userKey('whiteboard_plan_' + todayStr());
        const currentPlan = JSON.parse(localStorage.getItem(pk) || '[]');
        if (!currentPlan.find((p) => p.id === taskId)) {
          currentPlan.push({ id: taskId, why: 'Manually added' });
          localStorage.setItem(pk, JSON.stringify(currentPlan));
        }
        const mr = document.getElementById('modalRoot');
        if (mr) mr.innerHTML = '';
        showToast('Added to plan');
        render();
        break;
      }
      // Check-in actions
      case 'checkin-dismiss':
        if (dismissCheckIn) dismissCheckIn();
        render();
        break;
      case 'checkin-do-now': {
        const cid = actionEl.dataset.taskId;
        if (cid) {
          updateTask(cid, { status: 'in-progress' });
        }
        render();
        break;
      }
      case 'checkin-push-tomorrow': {
        const cid2 = actionEl.dataset.taskId;
        if (cid2) {
          const tmrw = new Date();
          tmrw.setDate(tmrw.getDate() + 1);
          const ts =
            tmrw.getFullYear() +
            '-' +
            String(tmrw.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(tmrw.getDate()).padStart(2, '0');
          updateTask(cid2, { dueDate: ts });
          showToast('Pushed to tomorrow');
        }
        render();
        break;
      }
      case 'checkin-drop': {
        const cid3 = actionEl.dataset.taskId;
        if (cid3) {
          updateTask(cid3, { status: 'done' });
          showToast('Task dropped');
        }
        render();
        break;
      }
      // Breakdown actions
      case 'breakdown-task':
        if (breakdownTask) breakdownTask(actionEl.dataset.taskId);
        break;
      case 'breakdown-dismiss':
        if (dismissVagueTask) {
          dismissVagueTask(actionEl.dataset.taskId);
          render();
        }
        break;
      // Stuck task actions
      case 'stuck-help':
        if (offerStuckHelp) offerStuckHelp(actionEl.dataset.taskId);
        break;
      case 'stuck-breakdown':
        if (breakdownTask) breakdownTask(actionEl.dataset.taskId);
        break;
      case 'stuck-reschedule': {
        const sid = actionEl.dataset.taskId;
        if (sid) {
          const tmrw2 = new Date();
          tmrw2.setDate(tmrw2.getDate() + 1);
          const ts2 =
            tmrw2.getFullYear() +
            '-' +
            String(tmrw2.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(tmrw2.getDate()).padStart(2, '0');
          updateTask(sid, { dueDate: ts2 });
          showToast('Rescheduled to tomorrow');
          render();
        }
        break;
      }
      case 'submit-eod':
        submitEndOfDay();
        break;
      case 'skip-eod':
        localStorage.setItem(userKey('whiteboard_eod_dismissed_' + todayStr()), '1');
        document.getElementById('eodCard').remove();
        break;
      case 'focus-quick-capture': {
        const qc = document.getElementById('quickCapture');
        if (qc) {
          qc.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => qc.focus(), 300);
        }
        break;
      }
      case 'toggle-boards-list': {
        const pl = document.getElementById('projectList');
        const chev = document.querySelector('.boards-chevron');
        if (pl) {
          const showing = pl.style.display !== 'none';
          pl.style.display = showing ? 'none' : '';
          if (chev) chev.style.transform = showing ? '' : 'rotate(90deg)';
          actionEl.setAttribute('aria-expanded', showing ? 'false' : 'true');
          localStorage.setItem('wb_boards_expanded', showing ? '0' : '1');
        }
        break;
      }
      // Dashboard: open new project (empty state)
      case 'open-new-project':
        openNewProject();
        break;
      // Clear tag filter
      case 'clear-tag-filter':
        setActiveTagFilter('');
        render();
        break;
      case 'toggle-tag-filter':
        setShowTagFilter(!getShowTagFilter());
        render();
        break;
      // Dashboard cards (brainstorm links)
      case 'go-dump':
        if (typeof deps.openBrainstormModal === 'function') {
          deps.openBrainstormModal();
        } else {
          setView('dump');
        }
        break;
      case 'load-dump-history': {
        if (typeof deps.openBrainstormModal === 'function') deps.openBrainstormModal();
        else setView('dump');
        const idx = parseInt(actionEl.dataset.dumpIndex, 10);
        setTimeout(() => {
          const bsMod = typeof deps.getBrainstormModule === 'function' ? deps.getBrainstormModule() : null;
          if (bsMod && typeof bsMod.getDumpHistory === 'function') {
            const history = bsMod.getDumpHistory();
            const entry = history[idx];
            if (entry && entry.inputSnippet) {
              const t = document.getElementById('dumpText');
              if (t) {
                t.value = entry.inputSnippet;
                t.focus();
              }
            }
          }
        }, 100);
        break;
      }
      case 'go-dump-weekly': {
        if (typeof deps.openBrainstormModal === 'function') deps.openBrainstormModal();
        else setView('dump');
        setTimeout(() => {
          const t = document.getElementById('dumpText');
          if (t) {
            t.value = 'Here are my plans for the week:\n- ';
            t.focus();
            t.setSelectionRange(t.value.length, t.value.length);
          }
        }, 100);
        break;
      }
      // Dump what-changed toggle
      case 'toggle-what-changed': {
        const sibling = actionEl.nextElementSibling;
        sibling.classList.toggle('open');
        actionEl.textContent = sibling.classList.contains('open') ? 'Hide details' : 'What changed';
        break;
      }
      // resend verification
      case 'resend-verification':
        resendVerification(actionEl.dataset.email);
        break;
    }
  });

  // ---- Keyboard accessibility for data-action elements ----
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Never intercept keys when user is typing in form fields
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    const navView = e.target.closest('.nav-item[data-view]');
    if (navView) {
      e.preventDefault();
      if (navView.dataset.view === 'dump' && typeof deps.openBrainstormModal === 'function') {
        deps.openBrainstormModal();
      } else {
        setView(navView.dataset.view);
      }
      return;
    }
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      e.preventDefault();
      actionEl.click();
    }
  });

  // ---- Delegated keydown handlers for inputs with data-keydown-action ----
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest('[data-keydown-action]');
    if (!el) return;
    const action = el.dataset.keydownAction;
    if (action === 'cmd-nav') {
      handleCmdNav(e);
      return;
    }
    if (action === 'hero-input') {
      heroInputHandler(e);
      return;
    }
    if (e.key === 'Enter') {
      switch (action) {
        case 'quick-add-project':
          if (el.value.trim()) {
            quickAddToProject(el, el.dataset.projectId);
          }
          break;
        case 'add-subtask':
          if (el.value.trim()) {
            addSubtask(el.dataset.taskId, el.value.trim(), el.dataset.parentSubtaskId || undefined);
            el.value = '';
          }
          break;
        case 'run-task-cmd':
          runTaskCmd(el.dataset.taskId, el.value);
          break;
        case 'add-tag':
          e.preventDefault();
          addTagToPicker(el);
          break;
        case 'submit-clarify-input':
          e.preventDefault();
          submitClarify();
          break;
        case 'quick-add-submit':
          e.preventDefault();
          submitQuickAdd();
          break;
      }
    }
    if (e.key === 'Escape' && action === 'dep-search-escape') {
      el.value = '';
      document.getElementById('depResults').innerHTML = '';
    }
  });

  // ---- Delegated oninput for dep search and other inputs ----
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-oninput-action]');
    if (!el) return;
    const action = el.dataset.oninputAction;
    switch (action) {
      case 'dep-search':
        showDepResults(el.value, el.dataset.excludeId);
        break;
      case 'smart-date-preview':
        previewSmartDate(el.dataset.dateId);
        break;
      case 'cmd-search':
        resetCmdIdx();
        renderSearchResults(el.value);
        break;
      case 'preview-quick-capture':
        previewQuickCapture();
        break;
    }
  });

  // ---- Delegated onchange for file inputs and selects ----
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-onchange-action]');
    if (!el) return;
    const action = el.dataset.onchangeAction;
    switch (action) {
      case 'dump-files':
        deps.handleDumpFiles(el.files);
        break;
      case 'native-date-pick': {
        const target = document.getElementById(el.dataset.target);
        if (target && el.value) {
          target.value = el.value;
          previewSmartDate(el.dataset.target);
        }
        break;
      }
      case 'import-data':
        importData(el);
        break;
      case 'bulk-move':
        if (el.value) {
          bulkAction('move', el.value);
          el.value = '';
        }
        break;
      case 'bulk-priority':
        if (el.value) {
          bulkAction('priority', el.value);
          el.value = '';
        }
        break;
      case 'dump-review-select-all':
        document.querySelectorAll('[data-dump-check]').forEach((c) => {
          c.checked = el.checked;
        });
        break;
    }
  });

  // ---- Subtask notes auto-save on blur ----
  document.addEventListener('focusout', (e) => {
    if (e.target.dataset?.subtaskNotesInput) {
      const taskId = e.target.dataset.taskId;
      const subtaskId = e.target.dataset.subtaskId;
      if (taskId && subtaskId && typeof deps.updateSubtaskNotes === 'function') {
        deps.updateSubtaskNotes(taskId, subtaskId, e.target.value);
      }
    }
  });

  // ---- Auth form submit ----
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'authForm') {
      e.preventDefault();
      handleAuth(e);
    }
  });

  // ---- Chat input handlers (delegated) ----
  document.addEventListener('input', (e) => {
    if (e.target.id === 'chatInput') updateChatChips();
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'chatInput' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // ---- Skip link focus/blur ----
  document.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('skip-link')) e.target.style.top = '0';
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('skip-link')) e.target.style.top = '-40px';
  });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'k') {
      e.preventDefault();
      openQuickAdd();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    const _inFormField = e.target.matches('input, textarea, select, [contenteditable]') || e.target.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      if (_inFormField) return;
      e.preventDefault();
      undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      if (_inFormField) return;
      e.preventDefault();
      if (typeof deps.openBrainstormModal === 'function') deps.openBrainstormModal();
      else setView('dump');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
      if (_inFormField) return;
      e.preventDefault();
      toggleChat();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      if (_inFormField) return;
      e.preventDefault();
      openSettings();
      return;
    }
    if (_inFormField) {
      if (e.key === 'Escape') {
        e.target.blur();
        return;
      }
      return;
    }
    if (e.key === 'Escape') {
      if (getFocusModule().getFocusTask()) {
        closeFocus();
        return;
      }
      const chatPanel = document.getElementById('chatPanel');
      if (chatPanel && chatPanel.classList.contains('open')) {
        chatPanel.classList.remove('open');
        return;
      }
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        const overlay = document.getElementById('mobileOverlay');
        if (overlay) overlay.style.display = 'none';
        return;
      }
      if (getExpandedTask()) {
        setExpandedTask(null);
        setKbIdx(-1);
        render();
      } else closeModal();
      return;
    }
    // j/k/x/e keyboard navigation
    if ('jkxe'.includes(e.key)) {
      const rows = [...document.querySelectorAll('.task-row, .task-expanded')];
      if (!rows.length) {
        /* fall through */
      } else if (e.key === 'j') {
        e.preventDefault();
        setKbIdx(Math.min(getKbIdx() + 1, rows.length - 1));
        highlightKbRow(rows);
        return;
      } else if (e.key === 'k') {
        e.preventDefault();
        setKbIdx(Math.max(getKbIdx() - 1, 0));
        highlightKbRow(rows);
        return;
      } else if (e.key === 'x' && getKbIdx() >= 0 && getKbIdx() < rows.length) {
        e.preventDefault();
        const id = rows[getKbIdx()].dataset.task;
        if (id) {
          const t = findTask(id);
          if (t) {
            updateTask(id, { status: t.status === 'done' ? 'todo' : 'done' });
            render();
            const newRows = [...document.querySelectorAll('.task-row, .task-expanded')];
            setKbIdx(Math.min(getKbIdx(), newRows.length - 1));
            if (getKbIdx() < 0) setKbIdx(-1);
          }
        }
        return;
      } else if (e.key === 'e' && getKbIdx() >= 0 && getKbIdx() < rows.length) {
        e.preventDefault();
        const id = rows[getKbIdx()].dataset.task;
        if (id) openEditTask(id);
        return;
      }
    }
    if (e.key === 'Enter' && getKbIdx() >= 0) {
      const rows = [...document.querySelectorAll('.task-row, .task-expanded')];
      if (getKbIdx() < rows.length) {
        e.preventDefault();
        const id = rows[getKbIdx()].dataset.task;
        setExpandedTask(getExpandedTask() === id ? null : id);
        render();
        return;
      }
    }
    if (e.key === 'n') openNewTask(getCurrentProject() || '');
    if (e.key === 'w') setView('review');
    if (e.key === '1') setView('dashboard');
    if (e.key === '/') {
      e.preventDefault();
      const qc = document.getElementById('quickCapture');
      if (qc) qc.focus();
      else setView('dashboard');
    }
    if (e.key === '?') {
      e.preventDefault();
      openShortcutHelp();
    }
    // Arrow key navigation for kanban cards and task rows
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const kanbanCard = e.target.closest('.kanban-card');
      if (kanbanCard) {
        const column = kanbanCard.closest('.kanban-col');
        if (column) {
          const cards = [...column.querySelectorAll('.kanban-card[tabindex]')];
          const idx = cards.indexOf(kanbanCard);
          const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
          if (next >= 0 && next < cards.length) {
            e.preventDefault();
            cards[next].focus();
            cards[next].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
        return;
      }
      const rows = [...document.querySelectorAll('.task-row, .task-expanded')];
      if (rows.length) {
        e.preventDefault();
        if (e.key === 'ArrowDown') {
          setKbIdx(Math.min(getKbIdx() + 1, rows.length - 1));
        } else {
          setKbIdx(Math.max(getKbIdx() - 1, 0));
        }
        highlightKbRow(rows);
      }
    }
  });

  // ---- Close dropdowns on outside click ----
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open'));
    }
  });
}
