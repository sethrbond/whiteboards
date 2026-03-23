// ============================================================
// DASHBOARD MODULE
// ============================================================
// Extracted from app.js — handles dashboard rendering, sidebar,
// project view, archive, sorting, and dashboard-v2 features.

import { MS_PER_DAY, TRUNCATE_DESC, MAX_KANBAN_DONE, BRAINSTORM_WORD_THRESHOLD } from './constants.js';

/**
 * Factory function to create dashboard functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ renderProject, renderDashboard, _renderNow, renderSidebar, renderArchive, sortTasks, renderTaskSlice, startWelcomeTyping, setupQuickBrainstorm, bindNudgeActions, hookDashboardPostRender, heroInputHandler, setPlanIndexCache, renderMemoryInsightsCard }}
 */
export function createDashboard(deps) {
  const {
    $,
    $$,
    esc,
    sanitizeAIHTML,
    fmtDate,
    todayStr,
    PRIORITY_ORDER,
    getData,
    saveData,
    userKey,
    findTask,
    activeTasks,
    projectTasks,
    archivedTasks,
    sortTasksDeps, // { PRIORITY_ORDER, todayStr, userKey, getDataVersion }
    hasAI,
    showToast,
    render,
    setView,
    updateTask,
    addTask,
    createTask,
    renderTaskRow,
    renderTaskExpanded,
    renderPriorityTag,
    renderCalendar,
    getCurrentView,
    getCurrentProject,
    getExpandedTask,
    getDashViewMode,
    getShowCompleted,
    getProjectViewMode,
    getShowProjectBg,
    parseProjectBackground,
    getBulkMode,
    getSectionShowCount,
    getArchiveShowCount,
    renderBulkBar,
    attachListeners,
    // Brainstorm module
    getBrainstormModule,
    // Guest mode
    isGuestMode,
    // Proactive module
    getAIStatusItems: _getAIStatusItems,
    getSmartNudges,
    nudgeFilterOverdue,
    nudgeFilterStale,
    nudgeFilterUnassigned,
    startFocus,
    offerStuckHelp,
    getNextRecommendation,
    getWeeklyLearnings,
    generateAIBriefing,
    planMyDay,
    runProactiveWorker,
    // State flags
    getBriefingGenerating,
    setBriefingGenerating,
    getPlanGenerating,
    setPlanGenerating,
    setNudgeFilter,
    getNudgeFilter,
    getActiveTagFilter,
    getTodayBriefingExpanded,
    // Render helpers
    renderDump,
    initDumpDropZone,
    renderWeeklyReview,
    // Quick capture
    parseQuickInput,
    getEscalationBanner: _getEscalationBanner,
    getAIMemory,
    extractMemoryInsights,
    // Saved views / filters
    applyFilters,
    addSavedView,
    deleteSavedView,
    getSavedViews,
    getActiveSavedViewId,
    setActiveSavedViewId,
    getQuickFilters,
    setQuickFilters,
    genId: _genId,
  } = deps;

  const TASKS_PER_PAGE = 50;

  // --- Render memoization ---
  // Skip redundant sidebar/content DOM rebuilds when nothing changed.
  let _lastSidebarState = null;
  let _lastContentState = null;

  // --- Plan index cache for sortTasks ---
  let _planIndexCache = null;
  let _planIndexDate = '';
  let _planIndexVersion = -1;

  function sortTasks(tasks) {
    const po = PRIORITY_ORDER;
    const _dataVersion = sortTasksDeps.getDataVersion();
    let planIndex = null;
    const today = todayStr();
    if (_planIndexDate === today && _planIndexVersion === _dataVersion && _planIndexCache !== undefined) {
      planIndex = _planIndexCache;
    } else {
      try {
        const planRaw = localStorage.getItem(userKey('whiteboard_plan_' + today));
        if (planRaw) {
          const plan = JSON.parse(planRaw);
          planIndex = {};
          plan.forEach((p, i) => {
            planIndex[p.id] = i;
          });
        }
        _planIndexCache = planIndex;
        _planIndexDate = today;
        _planIndexVersion = _dataVersion;
      } catch (_e) {
        _planIndexCache = null;
        _planIndexDate = today;
        _planIndexVersion = _dataVersion;
      }
    }
    return [...tasks].sort((a, b) => {
      if (planIndex) {
        const aIn = planIndex.hasOwnProperty(a.id);
        const bIn = planIndex.hasOwnProperty(b.id);
        if (aIn && !bIn) return -1;
        if (!aIn && bIn) return 1;
        if (aIn && bIn) return planIndex[a.id] - planIndex[b.id];
      }
      // Manual drag-reorder: respect sortOrder when both tasks have one
      const aHasSort = a.sortOrder != null;
      const bHasSort = b.sortOrder != null;
      if (aHasSort && bHasSort) return a.sortOrder - b.sortOrder;
      if (aHasSort && !bHasSort) return -1;
      if (!aHasSort && bHasSort) return 1;
      const sd = (a.status === 'in-progress' ? 0 : 1) - (b.status === 'in-progress' ? 0 : 1);
      if (sd) return sd;
      const pd = po[a.priority] - po[b.priority];
      if (pd) return pd;
      // Due date: tasks with dates first (chronological), no-date tasks last
      const aDate = a.dueDate || '';
      const bDate = b.dueDate || '';
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      return (b.interest || 3) - (a.interest || 3);
    });
  }

  // Paginated task rendering
  function renderTaskSlice(tasks, sectionKey, renderFn) {
    const limit = getSectionShowCount(sectionKey) || TASKS_PER_PAGE;
    const visible = tasks.slice(0, limit);
    if (!visible.length) return '';
    let html = '<ul role="list" class="task-list">' + visible.map(renderFn).join('') + '</ul>';
    if (tasks.length > limit) {
      const remaining = tasks.length - limit;
      html += `<button class="btn btn-sm" style="margin:8px auto;display:block;color:var(--text2)" data-action="section-show-more" data-section="${sectionKey}">Show more (${remaining} remaining)</button>`;
    }
    return html;
  }

  function renderArchive() {
    const ts = archivedTasks();
    let h = '';
    if (!ts.length) return '<div style="text-align:center;padding:60px;color:var(--text3)">No archived tasks</div>';
    h +=
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px"><button class="btn btn-sm btn-danger" data-action="delete-archived">Delete All</button><span style="font-size:12px;color:var(--text3)">' +
      ts.length +
      ' archived</span></div>';
    const archiveShowCount = getArchiveShowCount();
    const visible = ts.slice(0, archiveShowCount);
    visible.forEach(function (t) {
      h +=
        '<div style="display:flex;align-items:center;gap:12px;padding:10px;margin-bottom:4px;background:var(--surface);border-radius:8px"><span style="flex:1;font-size:13px;color:var(--text2);text-decoration:line-through">' +
        esc(t.title) +
        '</span><button class="btn btn-sm" data-action="restore-task" data-task-id="' +
        t.id +
        '">Restore</button></div>';
    });
    if (ts.length > archiveShowCount) {
      h +=
        '<button class="btn btn-sm" data-action="archive-show-more" style="width:100%;margin-top:8px;color:var(--text3)">Show more (' +
        (ts.length - archiveShowCount) +
        ' remaining)</button>';
    }
    return h;
  }

  function renderSidebar() {
    // --- Memoization: skip if nothing affecting the sidebar changed ---
    const _dv = sortTasksDeps && sortTasksDeps.getDataVersion ? sortTasksDeps.getDataVersion() : '';
    const _bsMod = getBrainstormModule();
    const _dumpInProgress = _bsMod && typeof _bsMod.isDumpInProgress === 'function' && _bsMod.isDumpInProgress();
    const sidebarState = getCurrentView() + '|' + (getCurrentProject() || '') + '|' + _dv + '|' + _dumpInProgress + '|' + (getActiveSavedViewId ? getActiveSavedViewId() || '' : '');
    if (sidebarState === _lastSidebarState) return;
    _lastSidebarState = sidebarState;

    // Active states — sidebar
    $$('.nav-item[data-view]').forEach((n) =>
      n.classList.toggle('active', n.dataset.view === getCurrentView() && !getCurrentProject()),
    );
    // Active states — bottom tabs
    const _cv = getCurrentView();
    const _cp = getCurrentProject();
    $$('.bottom-tab[data-view]').forEach((t) => {
      const tabView = t.dataset.view;
      const isActive =
        (tabView === 'dashboard' && _cv === 'dashboard' && !_cp) ||
        (tabView === 'boards' && (_cv === 'boards' || _cv === 'project' || _cp)) ||
        (tabView === 'dump' && _cv === 'dump');
      t.classList.toggle('active', isActive);
    });

    // Hide chat tab in guest mode
    const _chatTab = $('.bottom-tab[data-action="toggle-chat"]');
    if (_chatTab) {
      _chatTab.style.display = (typeof isGuestMode === 'function' && isGuestMode()) ? 'none' : '';
    }

    // Brainstorm processing indicator
    const dumpNav = $('.nav-item[data-view="dump"]');
    if (dumpNav) {
      let dumpSpinner = dumpNav.querySelector('.dump-spinner');
      if (_dumpInProgress) {
        if (!dumpSpinner) {
          dumpSpinner = document.createElement('span');
          dumpSpinner.className = 'dump-spinner';
          dumpSpinner.style.cssText = 'margin-left:auto;font-size:11px;animation:spin 1s linear infinite';
          dumpSpinner.textContent = '⟳';
          dumpNav.appendChild(dumpSpinner);
        }
      } else if (dumpSpinner) {
        dumpSpinner.remove();
      }
    }

    // Today badge on dashboard
    const data = getData();
    const todayCount = data.tasks.filter(
      (t) => t.status !== 'done' && !t.archived && t.dueDate && t.dueDate <= todayStr(),
    ).length;
    const dashNav = $('.nav-item[data-view="dashboard"]');
    if (!dashNav) return;
    let badge = dashNav.querySelector('.nav-badge');
    if (todayCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        dashNav.appendChild(badge);
      }
      badge.textContent = todayCount;
    } else if (badge) {
      badge.remove();
    }
    const ab = $('#archiveBadge');
    if (ab) {
      const ac = archivedTasks().length;
      if (ac > 0) {
        ab.textContent = ac;
        ab.style.display = '';
      } else ab.style.display = 'none';
    }

    // Project list (collapsible)
    const pl = $('#projectList');
    const boardsExpanded = localStorage.getItem('wb_boards_expanded') === '1' || getCurrentView() === 'project';
    pl.style.display = boardsExpanded ? '' : 'none';
    const chev = document.querySelector('.boards-chevron');
    if (chev) chev.style.transform = boardsExpanded ? 'rotate(90deg)' : '';
    const boardsToggle = $('[data-action="toggle-boards-list"]');
    if (boardsToggle) boardsToggle.setAttribute('aria-expanded', boardsExpanded ? 'true' : 'false');
    const boardsCount = $('#boardsCount');
    if (boardsCount) boardsCount.textContent = data.projects.length > 0 ? data.projects.length : '';

    // Build task counts in one pass (avoids N+1 queries per project)
    const _today = todayStr();
    const _activeCounts = {};
    const _overdueCounts = {};
    data.tasks.forEach((t) => {
      if (t.archived || t.status === 'done' || !t.project) return;
      _activeCounts[t.project] = (_activeCounts[t.project] || 0) + 1;
      if (t.dueDate && t.dueDate < _today) _overdueCounts[t.project] = (_overdueCounts[t.project] || 0) + 1;
    });

    pl.innerHTML = data.projects
      .map((p) => {
        const active = getCurrentView() === 'project' && getCurrentProject() === p.id;
        const count = _activeCounts[p.id] || 0;
        const hasOverdue = (_overdueCounts[p.id] || 0) > 0;
        return `<div class="project-nav-item ${active ? 'active' : ''}" data-project="${p.id}" draggable="true">
        <div class="project-dot" style="background:${p.color}"></div>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
        ${count > 0 ? `<span class="project-nav-count">${count}</span>` : ''}
        ${hasOverdue ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--red);flex-shrink:0" title="Has overdue tasks" aria-label="Has overdue tasks"></div>' : ''}
      </div>`;
      })
      .join('');

    // Drag-to-reorder boards
    pl.querySelectorAll('.project-nav-item').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', el.dataset.project);
        el.style.opacity = '0.4';
      });
      el.addEventListener('dragend', () => { el.style.opacity = ''; });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.style.borderTop = '2px solid var(--accent)';
      });
      el.addEventListener('dragleave', () => { el.style.borderTop = ''; });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.style.borderTop = '';
        const draggedId = e.dataTransfer.getData('text/plain');
        const targetId = el.dataset.project;
        if (draggedId === targetId) return;
        const fromIdx = data.projects.findIndex((p) => p.id === draggedId);
        const toIdx = data.projects.findIndex((p) => p.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = data.projects.splice(fromIdx, 1);
        data.projects.splice(toIdx, 0, moved);
        saveData(data);
        render();
      });
    });

    // Saved views in sidebar
    const svList = document.getElementById('savedViewsList');
    if (svList) {
      const views = getSavedViews();
      if (views.length > 0) {
        svList.style.display = '';
        const activeViewId = getActiveSavedViewId();
        svList.innerHTML = '<div class="nav-label" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);padding:0 16px;margin-bottom:4px">Saved Views</div>' +
          views.map((v) => {
            const isActive = currentView === 'saved-view' && activeViewId === v.id;
            const filterCount = Object.keys(v.filters || {}).filter((k) => {
              const val = v.filters[k];
              return val !== '' && val !== undefined && val !== null && !(Array.isArray(val) && val.length === 0);
            }).length;
            return `<div class="nav-item ${isActive ? 'active' : ''}" data-action="open-saved-view" data-view-id="${v.id}" role="button" tabindex="0" style="padding:6px 16px;font-size:12px">
              <span class="nav-icon" aria-hidden="true" style="font-size:10px">&#9683;</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.name)}</span>
              <span style="font-size:10px;color:var(--text3)">${filterCount}</span>
              <button class="btn btn-sm" data-action="delete-saved-view" data-view-id="${v.id}" style="padding:0 4px;font-size:10px;color:var(--text3);background:none;border:none;margin-left:4px;opacity:0.5" title="Delete view" aria-label="Delete saved view ${esc(v.name)}">&times;</button>
            </div>`;
          }).join('');
      } else {
        svList.style.display = 'none';
        svList.innerHTML = '';
      }
    }

    // Guest mode: show sign-up link at bottom of sidebar
    const _guestSignup = document.getElementById('guestSignupSidebar');
    if (typeof isGuestMode === 'function' && isGuestMode()) {
      if (!_guestSignup) {
        const _el = document.createElement('div');
        _el.id = 'guestSignupSidebar';
        _el.style.cssText = 'padding:12px 16px;margin-top:auto;border-top:1px solid var(--border);font-size:12px;color:var(--text3)';
        _el.innerHTML = '<div style="margin-bottom:6px;font-size:11px;color:var(--text3)">Guest mode</div><button class="btn btn-sm" data-action="guest-signup" style="width:100%;font-size:12px;padding:6px 12px">Sign up to save your work</button>';
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.appendChild(_el);
      }
    } else if (_guestSignup) {
      _guestSignup.remove();
    }
  }

  function _renderProjectHeader(p) {
    const bgOpen = getShowProjectBg(p.id) || false;
    const bg = p.background ? parseProjectBackground(p.background) : null;
    const tasks = projectTasks(p.id);
    const active = tasks.filter((t) => t.status !== 'done');
    const done = tasks.filter((t) => t.status === 'done');
    const soonStr = new Date(Date.now() + 3 * MS_PER_DAY).toISOString().slice(0, 10);
    const urgent = active.filter((t) => t.priority === 'urgent' || (t.dueDate && t.dueDate <= soonStr));

    let html = `<div class="project-info">
      <div class="project-info-header">
        <div class="project-info-dot" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
        <div style="flex:1">
          <h2 class="project-info-name">${esc(p.name)}</h2>
          ${p.description ? `<div class="project-info-desc">${esc(p.description.length > TRUNCATE_DESC ? p.description.slice(0, TRUNCATE_DESC) + '...' : p.description)}</div>` : `<div class="project-info-desc" style="color:var(--text3);font-style:italic">No description \u2014 <span style="cursor:pointer;color:var(--accent)" data-action="open-edit-project" data-project-id="${esc(p.id)}">add one</span></div>`}
          <div class="project-bg-toggle" data-action="toggle-project-bg" data-project-id="${esc(p.id)}" role="button" tabindex="0" aria-label="Toggle project background">
            <span class="chevron ${bgOpen ? 'open' : ''}">\u25b8</span> Board Background
          </div>
        </div>
      </div>
      <div class="project-bg-panel ${bgOpen ? 'open' : ''}">
        ${
          bg
            ? `<div class="project-bg-content">
          ${bg.origin ? `<div class="bg-section"><div class="bg-label">Origin</div><div class="bg-text">${esc(bg.origin)}</div></div>` : ''}
          ${bg.direction ? `<div class="bg-section"><div class="bg-label">Where It's Going</div><div class="bg-text">${esc(bg.direction)}</div></div>` : ''}
          ${bg.roadblocks ? `<div class="bg-section"><div class="bg-label">Roadblocks</div><div class="bg-text">${esc(bg.roadblocks)}</div></div>` : ''}
          ${bg.nextSteps ? `<div class="bg-section"><div class="bg-label">Next Steps</div><div class="bg-text">${esc(bg.nextSteps)}</div></div>` : ''}
          ${bg.notes ? `<div class="bg-section"><div class="bg-label">Notes</div><div class="bg-text">${esc(bg.notes)}</div></div>` : ''}
          <div class="project-bg-actions">
            <button class="btn btn-sm" data-action="edit-project-bg" data-project-id="${esc(p.id)}">Edit</button>
          </div>
        </div>`
            : `<div class="project-bg-content">
          <div style="text-align:center;padding:8px 0">
            <div style="color:var(--text3);font-size:12px;margin-bottom:10px">No background yet.</div>
            <div class="project-bg-actions" style="justify-content:center;border:none;padding:0;margin:0">
              <button class="btn btn-sm" data-action="edit-project-bg" data-project-id="${esc(p.id)}">Write background</button>
            </div>
          </div>
        </div>`
        }
      </div>
      <div class="project-info-stats">
        <div class="project-info-stat"><strong>${active.length}</strong> Active</div>
        <div class="project-info-stat"><strong>${done.length}</strong> Completed</div>
        ${urgent.length ? `<div class="project-info-stat" style="color:var(--red)"><strong>${urgent.length}</strong> Urgent</div>` : ''}
      </div>
    </div>`;

    html += `<div style="margin-bottom:20px;display:flex;gap:8px">
      <input class="form-input" id="quickAdd" placeholder="Quick add a task..." aria-label="Quick add a task" style="flex:1" data-keydown-action="quick-add-project" data-project-id="${p.id}">
    </div>`;
    return html;
  }

  function _renderProjectKanban(p, active, done) {
    const todo = sortTasks(active.filter((t) => t.status === 'todo'));
    const waiting = sortTasks(active.filter((t) => t.status === 'waiting'));
    const wip = sortTasks(active.filter((t) => t.status === 'in-progress'));
    const html = `<div class="kanban">
      <div class="kanban-col">
        <div class="kanban-col-header">To Do <span class="kanban-col-count">${todo.length}</span></div>
        ${todo
          .map(
            (
              t,
            ) => `<div class="kanban-card" data-task="${t.id}" data-action="toggle-expand" role="button" tabindex="0" aria-label="${esc(t.title)}">
          <div class="kanban-card-title">${esc(t.title)}</div>
          <div class="kanban-card-meta">${renderPriorityTag(t.priority)}${t.dueDate ? ` <span class="tag tag-date">${fmtDate(t.dueDate)}</span>` : ''}</div>
        </div>`,
          )
          .join('')}
      </div>
      <div class="kanban-col" style="border-color:rgba(168,162,158,0.2)">
        <div class="kanban-col-header" style="color:var(--text3)">Waiting <span class="kanban-col-count">${waiting.length}</span></div>
        ${waiting
          .map(
            (
              t,
            ) => `<div class="kanban-card" style="opacity:0.7" data-task="${t.id}" data-action="toggle-expand" role="button" tabindex="0" aria-label="${esc(t.title)}">
          <div class="kanban-card-title">${esc(t.title)}</div>
          <div class="kanban-card-meta">${renderPriorityTag(t.priority)}${t.dueDate ? ` <span class="tag tag-date">${fmtDate(t.dueDate)}</span>` : ''}</div>
        </div>`,
          )
          .join('')}
      </div>
      <div class="kanban-col" style="border-color:rgba(59,130,246,0.2)">
        <div class="kanban-col-header" style="color:var(--blue)">In Progress <span class="kanban-col-count">${wip.length}</span></div>
        ${wip
          .map(
            (
              t,
            ) => `<div class="kanban-card" data-task="${t.id}" data-action="toggle-expand" role="button" tabindex="0" aria-label="${esc(t.title)}">
          <div class="kanban-card-title">${esc(t.title)}</div>
          <div class="kanban-card-meta">${renderPriorityTag(t.priority)}${t.dueDate ? ` <span class="tag tag-date">${fmtDate(t.dueDate)}</span>` : ''}</div>
        </div>`,
          )
          .join('')}
      </div>
      <div class="kanban-col" style="border-color:rgba(34,197,94,0.2)">
        <div class="kanban-col-header" style="color:var(--green)">Done <span class="kanban-col-count">${done.length}</span></div>
        ${[...done]
          .reverse()
          .slice(0, MAX_KANBAN_DONE)
          .map(
            (t) => `<div class="kanban-card" style="opacity:0.6" data-task="${t.id}">
          <div class="kanban-card-title" style="text-decoration:line-through">${esc(t.title)}</div>
        </div>`,
          )
          .join('')}
        ${done.length > MAX_KANBAN_DONE ? `<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px">+${done.length - MAX_KANBAN_DONE} more</div>` : ''}
      </div>
    </div>`;
    // Attach drag-and-drop after render via setTimeout
    setTimeout(function () {
      document.querySelectorAll('.kanban-col').forEach(function (col, i) {
        const s = ['todo', 'waiting', 'in-progress', 'done'][i];
        col.ondragover = function (e) {
          e.preventDefault();
          col.classList.add('drag-over');
        };
        col.ondragleave = function () {
          col.classList.remove('drag-over');
        };
        col.ondrop = function (e) {
          e.preventDefault();
          col.classList.remove('drag-over');
          const tid = e.dataTransfer.getData('text/plain');
          if (tid && s) {
            updateTask(tid, { status: s });
            render();
          }
        };
      });
      document.querySelectorAll('.kanban-card[data-task]').forEach(function (c) {
        c.draggable = true;
        c.ondragstart = function (e) {
          e.dataTransfer.setData('text/plain', c.dataset.task);
          c.classList.add('dragging');
        };
        c.ondragend = function () {
          c.classList.remove('dragging');
        };
      });
    }, 0);
    return html;
  }

  function _renderProjectTaskSections(p, active, done, _urgent, _upcoming) {
    let html = '';
    const today = todayStr();
    const weekEnd = new Date(Date.now() + 7 * MS_PER_DAY).toISOString().slice(0, 10);

    // Group into: Do Now (overdue + due today + in-progress, max display), This Week, Later
    const doNow = active.filter(
      (t) => t.status === 'in-progress' || (t.dueDate && t.dueDate <= today) || t.priority === 'urgent',
    );
    const doNowIds = new Set(doNow.map((t) => t.id));
    const thisWeek = active.filter((t) => !doNowIds.has(t.id) && t.dueDate && t.dueDate > today && t.dueDate <= weekEnd);
    const thisWeekIds = new Set(thisWeek.map((t) => t.id));
    const later = active.filter((t) => !doNowIds.has(t.id) && !thisWeekIds.has(t.id));

    // Board narrative (cached) with inline reply
    const narrativeKey = userKey('whiteboard_board_narrative_' + p.id);
    const cachedNarrative = localStorage.getItem(narrativeKey);
    const lastBoardResponse = localStorage.getItem(userKey('whiteboard_board_reply_' + p.id));
    if (hasAI()) {
      html += `<div style="margin-bottom:20px;padding:14px 16px;background:var(--surface);border-radius:var(--radius);border-left:3px solid var(--accent)">`;
      if (cachedNarrative) {
        html += `<div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:12px">${esc(cachedNarrative)}</div>`;
      }
      if (lastBoardResponse) {
        html += `<div style="font-size:12px;color:var(--accent);line-height:1.5;margin-bottom:10px;padding:8px 10px;background:rgba(var(--accent-rgb,99,102,241),0.06);border-radius:6px">\u2726 ${esc(lastBoardResponse)}</div>`;
      }
      html += `<div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="boardReply" placeholder="${cachedNarrative ? "Reply... (e.g. 'defer the low priority stuff')" : 'Ask about this board or tell me what to change...'}" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text);background:var(--surface2);outline:none;font-family:inherit" data-keydown-action="board-reply" data-project-id="${esc(p.id)}">
            <button class="btn btn-sm" data-action="send-board-reply" data-project-id="${esc(p.id)}" style="flex-shrink:0;color:var(--accent)">${cachedNarrative ? 'Reply' : '\u2726 Ask'}</button>
          </div>`;
      html += `</div>`;
    }

    // Whiteboard card renderer
    function _wbCard(t) {
      const _exp = getExpandedTask();
      if (_exp === t.id) return renderTaskExpanded(t, true);
      const isDone = t.status === 'done';
      const borderColor =
        t.priority === 'urgent' ? 'var(--red)' : t.priority === 'important' ? 'var(--orange)' : 'var(--border2)';
      const dueDateStr = t.dueDate ? `<span class="wb-card-due${!isDone && t.dueDate < today ? ' overdue' : ''}">${fmtDate(t.dueDate)}</span>` : '';
      const estStr = t.estimatedMinutes ? `<span class="wb-card-est">~${t.estimatedMinutes}m</span>` : '';
      const subtaskStr = t.subtasks && t.subtasks.length
        ? `<span class="wb-card-est">${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}</span>`
        : '';
      return `<div class="wb-card${isDone ? ' done' : ''}" data-task="${t.id}" data-expandable="true" draggable="true" role="listitem" style="border-top:3px solid ${borderColor}">
        <div class="wb-card-actions">
          ${!isDone ? `<button class="task-action-btn" title="Defer" data-action="defer-task" data-task-id="${t.id}">\u21b7</button>` : ''}
          <button class="task-action-btn" title="Edit" data-action="edit-task" data-task-id="${t.id}">\u270e</button>
          ${!isDone ? `<button class="task-action-btn" title="Done" data-action="complete-task" data-task-id="${t.id}">\u2713</button>` : ''}
        </div>
        <div class="wb-card-title${isDone ? ' done-text' : ''}">${esc(t.title)}</div>
        ${t.notes ? `<div class="wb-card-notes">${esc(t.notes.slice(0, 80))}${t.notes.length > 80 ? '...' : ''}</div>` : ''}
        <div class="wb-card-meta">${dueDateStr}${estStr}${subtaskStr}${t.attachments && t.attachments.length > 0 ? `<span class="wb-card-est" title="${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}">📎${t.attachments.length}</span>` : ''}</div>
      </div>`;
    }

    // Do Now
    if (doNow.length > 0) {
      html += `<div class="wb-section"><div class="section-header"><h3 class="section-title">Do Now</h3><div class="section-count">${doNow.length}</div><div class="section-line"></div></div>`;
      html += `<div class="wb-grid" data-section="doNow" data-project="${p.id}">${sortTasks(doNow).map(_wbCard).join('')}</div></div>`;
    }

    // This Week
    if (thisWeek.length > 0) {
      html += `<div class="wb-section"><div class="section-header"><h3 class="section-title">This Week</h3><div class="section-count">${thisWeek.length}</div><div class="section-line"></div></div>`;
      html += `<div class="wb-grid" data-section="thisWeek" data-project="${p.id}">${sortTasks(thisWeek).map(_wbCard).join('')}</div></div>`;
    }

    // Later
    if (later.length > 0) {
      html += `<div class="wb-section"><div class="section-header"><h3 class="section-title" style="color:var(--text3)">Later</h3><div class="section-count">${later.length}</div><div class="section-line"></div></div>`;
      html += `<div class="wb-grid" data-section="later" data-project="${p.id}">${sortTasks(later).map(_wbCard).join('')}</div></div>`;
    }

    if (active.length === 0 && done.length === 0) {
      html += `<div class="empty"><div class="empty-icon">\u2726</div><div class="empty-text">No tasks yet. Add one above, or start a Brainstorm to get everything out at once.</div><button class="btn btn-primary" data-action="open-new-task" data-project-id="${esc(p.id)}">+ Add Task</button></div>`;
    }

    // Completed
    if (done.length > 0) {
      const key = p.id;
      html += `<div class="wb-section"><div class="completed-toggle" data-action="toggle-completed" data-key="${key}">
        ${getShowCompleted(key) ? '\u25be' : '\u25b8'} Done <span class="section-count" style="margin-left:4px">${done.length}</span>
      </div>`;
      if (getShowCompleted(key)) {
        html += `<div class="wb-grid">${[...done].reverse().map(_wbCard).join('')}</div>`;
      }
      html += `</div>`;
    }

    // Attach drag-and-drop reorder handlers after render
    setTimeout(function () {
      _attachListDragReorder(p.id);
    }, 0);

    return html;
  }

  /**
   * Attach drag-and-drop reorder handlers to wb-grid sections for a project.
   * Only allows reordering within the same section (same wb-grid container).
   */
  function _attachListDragReorder(projectId) {
    const grids = document.querySelectorAll(`.wb-grid[data-project="${projectId}"][data-section]`);
    grids.forEach(function (grid) {
      const cards = grid.querySelectorAll('.wb-card[data-task]');
      cards.forEach(function (card) {
        card.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/plain', card.dataset.task);
          e.dataTransfer.setData('application/x-wb-section', grid.dataset.section);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', function () {
          card.classList.remove('dragging');
          // Clean up all drop indicators
          grid.querySelectorAll('.wb-card').forEach(function (c) {
            c.classList.remove('drag-over-before', 'drag-over-after');
          });
        });
        card.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          // Only show indicator if dragging within the same section
          const sourceSection = e.dataTransfer.types.includes('application/x-wb-section');
          if (!sourceSection) return;
          // Determine if cursor is in top or bottom half
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          grid.querySelectorAll('.wb-card').forEach(function (c) {
            c.classList.remove('drag-over-before', 'drag-over-after');
          });
          if (e.clientY < midY) {
            card.classList.add('drag-over-before');
          } else {
            card.classList.add('drag-over-after');
          }
        });
        card.addEventListener('dragleave', function () {
          card.classList.remove('drag-over-before', 'drag-over-after');
        });
        card.addEventListener('drop', function (e) {
          e.preventDefault();
          card.classList.remove('drag-over-before', 'drag-over-after');
          const draggedId = e.dataTransfer.getData('text/plain');
          const sourceSection = e.dataTransfer.getData('application/x-wb-section');
          const targetId = card.dataset.task;

          // Only allow reorder within the same section
          if (!draggedId || draggedId === targetId || sourceSection !== grid.dataset.section) return;

          // Get ordered task IDs from the current DOM
          const orderedIds = Array.from(grid.querySelectorAll('.wb-card[data-task]')).map(function (c) {
            return c.dataset.task;
          });

          // Remove dragged from list
          const fromIdx = orderedIds.indexOf(draggedId);
          if (fromIdx < 0) return;
          orderedIds.splice(fromIdx, 1);

          // Insert at target position
          const toIdx = orderedIds.indexOf(targetId);
          if (toIdx < 0) return;
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const insertIdx = e.clientY < midY ? toIdx : toIdx + 1;
          orderedIds.splice(insertIdx, 0, draggedId);

          // Assign sortOrder values: use index * 1000 to leave room for future insertions
          orderedIds.forEach(function (id, i) {
            updateTask(id, { sortOrder: i * 1000 });
          });
          render();
        });
      });
    });
  }

  function renderProject(p) {
    const tasks = projectTasks(p.id);
    const active = tasks.filter((t) => t.status !== 'done');
    const done = tasks.filter((t) => t.status === 'done');
    const soonStr = new Date(Date.now() + 3 * MS_PER_DAY).toISOString().slice(0, 10);
    const urgent = active.filter((t) => t.priority === 'urgent' || (t.dueDate && t.dueDate <= soonStr));
    const upcoming = active.filter((t) => t.status === 'todo');

    let html = _renderProjectHeader(p);

    // KANBAN VIEW
    const viewMode = getProjectViewMode(p.id) || 'list';
    if (viewMode === 'board') {
      html += _renderProjectKanban(p, active, done);
      return html;
    }

    // Task sections
    html += _renderProjectTaskSections(p, active, done, urgent, upcoming);

    return html;
  }

  function _renderNowDashboardView(c, ha, _data, _bulkMode, _dashViewMode) {
    $('#viewSub').textContent = '';
    ha.innerHTML = '';
    c.innerHTML = renderDashboard();
  }

  function _renderNowBoardsView(c, ha, data) {
    $('#viewSub').textContent = `${data.projects.length} boards`;
    ha.innerHTML = `<button class="btn btn-sm" data-action="toggle-chat"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span>Ask</button><button class="btn btn-primary btn-sm" data-action="new-project">+ Board</button>`;
    c.innerHTML = renderBoardsGrid(data);
  }

  function renderBoardsGrid(data) {
    const projects = data.projects || [];
    if (projects.length === 0) {
      return `<div class="empty" style="padding:40px 0;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">&#9638;</div>
        <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px">No boards yet</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:20px">Start a brainstorm and AI will create boards for you, or add one manually.</div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn btn-primary" data-action="go-dump">Brainstorm</button>
          <button class="btn" data-action="new-project">+ New Board</button>
        </div>
      </div>`;
    }
    // Single-pass: build per-project active/done/overdue counts to avoid O(projects x tasks)
    const today = todayStr();
    const activeByProject = new Map();
    const overdueByProject = new Map();
    const doneByProject = new Map();
    for (const t of data.tasks) {
      if (!t.project || t.archived) continue;
      if (t.status === 'done') {
        doneByProject.set(t.project, (doneByProject.get(t.project) || 0) + 1);
      } else {
        activeByProject.set(t.project, (activeByProject.get(t.project) || 0) + 1);
        if (t.dueDate && t.dueDate < today) {
          overdueByProject.set(t.project, (overdueByProject.get(t.project) || 0) + 1);
        }
      }
    }

    let html = '<div class="project-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">';
    projects.forEach((p) => {
      const activeCount = activeByProject.get(p.id) || 0;
      const overdueCount = overdueByProject.get(p.id) || 0;
      const doneCount = doneByProject.get(p.id) || 0;
      html += `<div class="project-grid-card" data-project="${esc(p.id)}" style="padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:all 0.15s;border-left:3px solid ${p.color || 'var(--accent)'}">
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:4px">${esc(p.name)}</div>
        ${p.description ? `<div style="font-size:12px;color:var(--text3);margin-bottom:8px">${esc(p.description)}</div>` : ''}
        <div style="font-size:11px;color:var(--text3)">
          ${activeCount} active${doneCount ? ' \u00b7 ' + doneCount + ' done' : ''}${overdueCount ? ' \u00b7 <span style="color:var(--red)">' + overdueCount + ' overdue</span>' : ''}
        </div>
      </div>`;
    });
    html += '</div>';
    return html;
  }

  function _renderNowProjectView(c, ha, data) {
    const currentProject = getCurrentProject();
    const p = data.projects.find((x) => x.id === currentProject);
    if (!p) {
      setView('dashboard');
      return;
    }
    $('#viewTitle').textContent = p.name;
    $('#viewSub').textContent = '';
    const vm = getProjectViewMode(p.id) || 'list';
    ha.innerHTML = `<div class="view-toggle"><button class="view-toggle-btn ${vm === 'list' ? 'active' : ''}" data-action="project-view-mode" data-project-id="${esc(p.id)}" data-mode="list">List</button><button class="view-toggle-btn ${vm === 'board' ? 'active' : ''}" data-action="project-view-mode" data-project-id="${esc(p.id)}" data-mode="board">Board</button></div><button class="btn btn-sm" data-action="open-project-chat" data-project-id="${esc(p.id)}"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span>Ask</button><button class="btn btn-primary btn-sm" data-action="open-new-task" data-project-id="${esc(p.id)}">+ Task</button><div class="dropdown" style="position:relative"><button class="btn btn-sm" data-action="toggle-dropdown">\u00b7\u00b7\u00b7</button><div class="dropdown-menu"><button data-action="start-focus-project" data-project-id="${esc(p.id)}">\u25ce Focus Mode</button><button data-action="ai-reorganize" data-project-id="${esc(p.id)}"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span> Reorganize</button><button data-action="reanalyze-board" data-project-id="${esc(p.id)}"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span> Re-analyze</button><button data-action="open-edit-project" data-project-id="${esc(p.id)}">Edit Board</button></div></div>`;
    c.innerHTML = renderProject(p);
  }

  function _triggerAutoAI(data, currentView) {
    const _hasEverBriefed = localStorage.getItem(userKey('wb_has_ever_briefed'));
    const _activeCount = data.tasks.filter((t) => t.status !== 'done' && !t.archived).length;
    const _readyForBriefing = _hasEverBriefed || _activeCount >= 3;
    if (currentView === 'dashboard' && data.tasks.length > 0 && _readyForBriefing) {
      if (hasAI() && !localStorage.getItem(userKey('whiteboard_briefing_' + todayStr())) && !getBriefingGenerating()) {
        if (!_hasEverBriefed) localStorage.setItem(userKey('wb_has_ever_briefed'), '1');
        setBriefingGenerating(true);
        {
          const _bc = document.querySelector('.briefing-card');
          if (_bc && !document.getElementById('briefingBody')) {
            const _bh = _bc.querySelector('.briefing-header');
            if (_bh)
              _bh.insertAdjacentHTML(
                'afterend',
                '<div class="skeleton-pulse" style="padding:16px 20px;min-height:60px;display:flex;align-items:center;justify-content:center;margin-bottom:8px"><span style="font-size:12px;color:var(--text3)">Generating your briefing...</span></div>',
              );
          }
        }
        generateAIBriefing().finally(() => {
          setBriefingGenerating(false);
        });
      }
      if (hasAI() && !localStorage.getItem(userKey('whiteboard_plan_' + todayStr())) && !getPlanGenerating()) {
        setPlanGenerating(true);
        {
          const _pb = document.getElementById('planBtn');
          if (_pb) {
            const _pc = _pb.closest('.briefing-card');
            if (_pc)
              _pc.insertAdjacentHTML(
                'afterend',
                '<div class="section"><div class="section-header"><h2 class="section-title" style="color:var(--accent)">Today\'s Plan</h2><div class="section-line"></div></div><div class="skeleton-pulse" style="padding:16px 20px;min-height:80px;display:flex;align-items:center;justify-content:center"><span style="font-size:12px;color:var(--text3)">Planning your day...</span></div></div>',
              );
          }
        }
        planMyDay().finally(() => {
          setPlanGenerating(false);
          runProactiveWorker();
        });
      } else if (hasAI() && localStorage.getItem(userKey('whiteboard_plan_' + todayStr()))) {
        runProactiveWorker();
      }
    }
  }

  // --- Quick filters & filter bar helpers ---
  function _hasActiveFilters(filters) {
    if (!filters) return false;
    return Object.keys(filters).some((k) => {
      const v = filters[k];
      return v !== '' && v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0);
    });
  }

  function _renderQuickFilters(activeFilters) {
    const today = todayStr();
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const isUrgent = activeFilters.priority === 'urgent';
    const isDueWeek = activeFilters.dueBefore === weekEnd && !activeFilters.dueAfter;
    const isWaiting = activeFilters.status === 'waiting';
    const isNoDate = activeFilters.noDate === true;
    return `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap" class="quick-filters">
      <button class="btn btn-sm ${isUrgent ? 'btn-primary' : ''}" data-action="quick-filter" data-filter="urgent" style="font-size:11px;padding:4px 10px;border-radius:20px">Urgent</button>
      <button class="btn btn-sm ${isDueWeek ? 'btn-primary' : ''}" data-action="quick-filter" data-filter="due-week" style="font-size:11px;padding:4px 10px;border-radius:20px">Due this week</button>
      <button class="btn btn-sm ${isWaiting ? 'btn-primary' : ''}" data-action="quick-filter" data-filter="waiting" style="font-size:11px;padding:4px 10px;border-radius:20px">Waiting on</button>
      <button class="btn btn-sm ${isNoDate ? 'btn-primary' : ''}" data-action="quick-filter" data-filter="no-date" style="font-size:11px;padding:4px 10px;border-radius:20px">No date</button>
    </div>`;
  }

  function _renderFilterChips(filters) {
    if (!_hasActiveFilters(filters)) return '';
    const chips = [];
    if (filters.status) chips.push({ label: 'Status: ' + filters.status, key: 'status' });
    if (filters.priority) chips.push({ label: 'Priority: ' + filters.priority, key: 'priority' });
    if (filters.project) {
      const data = getData();
      const proj = (data.projects || []).find((p) => p.id === filters.project);
      chips.push({ label: 'Board: ' + (proj ? proj.name : filters.project), key: 'project' });
    }
    if (filters.tags && filters.tags.length) filters.tags.forEach((tag) => chips.push({ label: 'Tag: ' + tag, key: 'tag:' + tag }));
    if (filters.dueBefore) chips.push({ label: 'Due before: ' + filters.dueBefore, key: 'dueBefore' });
    if (filters.dueAfter) chips.push({ label: 'Due after: ' + filters.dueAfter, key: 'dueAfter' });
    if (filters.hasSubtasks === true) chips.push({ label: 'Has subtasks', key: 'hasSubtasks' });
    if (filters.hasSubtasks === false) chips.push({ label: 'No subtasks', key: 'hasSubtasks' });
    if (filters.noDate === true) chips.push({ label: 'No due date', key: 'noDate' });
    return `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center" class="filter-chips">
      ${chips.map((ch) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:var(--accent-dim);color:var(--accent);font-size:11px">
        ${esc(ch.label)}
        <button data-action="remove-filter-chip" data-chip-key="${esc(ch.key)}" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove filter" aria-label="Remove ${esc(ch.label)}">&times;</button>
      </span>`).join('')}
      <button data-action="clear-all-filters" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;padding:2px 6px">Clear all</button>
    </div>`;
  }

  function _renderNow() {
    const data = getData();
    const currentView = getCurrentView();
    const dashViewMode = getDashViewMode();
    const bulkMode = getBulkMode();

    // Skip render if user is mid-inline-edit to avoid destroying contenteditable
    if (document.querySelector('[contenteditable="true"].task-title-editable')) return;

    // --- Memoization: skip full content rebuild if nothing changed ---
    const _currentProject = getCurrentProject();
    const _dv = sortTasksDeps.getDataVersion();
    const contentState =
      currentView +
      '|' +
      (dashViewMode || '') +
      '|' +
      bulkMode +
      '|' +
      (_currentProject || '') +
      '|' +
      _dv +
      '|' +
      getShowCompleted(currentView === 'project' ? _currentProject : 'dash') +
      '|' +
      (getProjectViewMode(_currentProject || '') || '') +
      '|' +
      getTodayBriefingExpanded() +
      '|' +
      getSectionShowCount('dash') +
      '|' +
      (getSectionShowCount('all-tasks') || '') +
      '|' +
      (getSectionShowCount('completed') || '') +
      '|' +
      getArchiveShowCount() +
      '|' +
      (getExpandedTask() || '') +
      '|' +
      (localStorage.getItem(userKey('whiteboard_plan_' + todayStr())) || '').length +
      '|' +
      (localStorage.getItem(userKey('whiteboard_briefing_' + todayStr())) || '').length +
      '|' +
      (getActiveTagFilter ? getActiveTagFilter() : '') +
      '|' +
      (getNudgeFilter ? getNudgeFilter() : '') +
      '|' +
      (getActiveSavedViewId ? getActiveSavedViewId() || '' : '') +
      '|' +
      (getQuickFilters ? JSON.stringify(getQuickFilters()) : '') +
      '|' +
      (currentView === 'calendar' ? new Date().toISOString().slice(0, 10) : ''); // calendar re-renders once per day (not every tick)
    if (contentState === _lastContentState) {
      return;
    }
    _lastContentState = contentState;

    try {
      renderSidebar();
      const c = $('#content');
      const ha = $('#headerActions');

      switch (currentView) {
        case 'dashboard':
          $('#viewTitle').textContent = '';
          _renderNowDashboardView(c, ha, data, bulkMode, dashViewMode);
          break;
        case 'boards':
          $('#viewTitle').textContent = 'Boards';
          _renderNowBoardsView(c, ha, data);
          break;
        case 'project':
          _renderNowProjectView(c, ha, data);
          break;
        case 'dump':
          $('#viewTitle').textContent = 'Capture';
          $('#viewSub').textContent = 'Write everything on your mind — AI will do the rest';
          ha.innerHTML = '';
          {
            const dumpResult = renderDump();
            const renderInline = (dumpHtml) => {
              c.innerHTML = `<div style="max-width:640px;margin:0 auto;padding:8px 0">${dumpHtml}</div>`;
              initDumpDropZone();
            };
            if (dumpResult && typeof dumpResult.then === 'function') {
              c.innerHTML = '<div style="padding:24px;color:var(--text3)">Loading capture...</div>';
              dumpResult.then(renderInline);
            } else {
              renderInline(dumpResult);
            }
          }
          break;
        case 'calendar':
          $('#viewTitle').textContent = 'Calendar';
          $('#viewSub').textContent = '';
          ha.innerHTML = `<div class="view-toggle"><button class="view-toggle-btn ${dashViewMode === 'week' || dashViewMode === 'list' ? 'active' : ''}" data-action="dash-view" data-mode="week">Week</button><button class="view-toggle-btn ${dashViewMode === 'month' ? 'active' : ''}" data-action="dash-view" data-mode="month">Month</button></div>`;
          c.innerHTML = renderCalendar();
          break;
        case 'review':
          $('#viewTitle').textContent = 'Weekly Review';
          $('#viewSub').textContent = 'Reflect, reset, plan ahead';
          ha.innerHTML = '';
          {
            const _reviewResult = renderWeeklyReview();
            if (_reviewResult && typeof _reviewResult.then === 'function') {
              c.innerHTML = '<div style="padding:24px;color:var(--text3)">Loading review...</div>';
              _reviewResult.then((html) => {
                c.innerHTML = html;
              }).catch((err) => {
                console.error('Weekly review failed:', err);
                c.innerHTML = `<div style="padding:24px;color:var(--red)">Weekly review failed to load. Try refreshing the page.</div>`;
              });
            } else {
              c.innerHTML = _reviewResult;
            }
          }
          break;
        case 'all-tasks': {
          $('#viewTitle').textContent = 'All Tasks';
          const qf = getQuickFilters();
          const hasFilters = _hasActiveFilters(qf);
          let allBase = activeTasks();
          if (hasFilters) allBase = applyFilters(allBase, qf);
          $('#viewSub').textContent = `${allBase.length} active tasks`;
          ha.innerHTML = hasFilters
            ? '<button class="btn btn-sm" data-action="save-current-filter" style="font-size:11px;color:var(--accent)">Save view</button>'
            : '';
          let atHtml = _renderQuickFilters(qf);
          atHtml += _renderFilterChips(qf);
          const sorted = sortTasks(allBase);
          if (!sorted.length) {
            atHtml += '<div style="text-align:center;padding:40px;color:var(--text3)">No tasks match these filters</div>';
          } else {
            atHtml += renderTaskSlice(sorted, 'all-tasks', (t) => renderTaskRow(t, true));
          }
          c.innerHTML = atHtml;
          break;
        }
        case 'saved-view': {
          const svId = getActiveSavedViewId();
          const sv = (getSavedViews() || []).find((v) => v.id === svId);
          if (!sv) {
            setView('all-tasks');
            return;
          }
          $('#viewTitle').textContent = sv.name;
          let svBase = data.tasks.filter((t) => !t.archived);
          svBase = applyFilters(svBase, sv.filters);
          $('#viewSub').textContent = `${svBase.length} tasks`;
          ha.innerHTML = '<button class="btn btn-sm" data-action="delete-saved-view" data-view-id="' + svId + '" style="font-size:11px;color:var(--red)">Delete view</button>';
          let svHtml = _renderFilterChips(sv.filters);
          const svSorted = sortTasks(svBase);
          svSorted.forEach((t) => {
            svHtml += renderTaskRow(t, true);
          });
          if (!svSorted.length)
            svHtml += '<div style="text-align:center;padding:40px;color:var(--text3)">No tasks match this view</div>';
          c.innerHTML = svHtml;
          break;
        }
        case 'completed': {
          $('#viewTitle').textContent = 'Completed';
          const allDone = data.tasks.filter((t) => t.status === 'done' && !t.archived);
          $('#viewSub').textContent = `${allDone.length} completed tasks`;
          ha.innerHTML = '';
          const byDate = [...allDone].sort((a, b) => {
            const aD = a.completedAt || '0';
            const bD = b.completedAt || '0';
            return bD.localeCompare(aD); // newest first
          });
          if (!byDate.length) {
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">No completed tasks yet</div>';
          } else {
            c.innerHTML = renderTaskSlice(byDate, 'completed', (t) => renderTaskRow(t, true));
          }
          break;
        }
        case 'archive':
          $('#viewTitle').textContent = 'Archive';
          $('#viewSub').textContent = '';
          ha.innerHTML = '';
          c.innerHTML = renderArchive();
          break;
      }
      $('#headerActions').innerHTML =
        '<button class="btn btn-sm btn-ghost" data-action="open-search" style="color:var(--text3);font-size:11px">&#8984;K</button>' +
        $('#headerActions').innerHTML;
      attachListeners();
      renderBulkBar();

      // Auto-generate briefing and plan on first dashboard load of the day
      _triggerAutoAI(data, currentView);
    } catch (err) {
      console.error('Render error:', err);
      const c = $('#content');
      if (c)
        c.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px;padding:32px;text-align:center">
        <div style="font-size:32px;filter:grayscale(1)">&#9888;</div>
        <h2 style="color:var(--text);font-size:18px">Something went wrong</h2>
        <p style="color:var(--text3);font-size:13px;max-width:400px">Something unexpected happened. Your data is safe &mdash; try reloading.</p>
        <details style="margin-top:8px;font-size:11px;color:var(--text3);max-width:400px"><summary style="cursor:pointer">Technical details</summary><pre style="margin-top:4px;white-space:pre-wrap;word-break:break-all">${esc(err.message || String(err))}</pre></details>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" data-action="reload-page">Reload</button>
          <button class="btn btn-sm" data-action="export-data">Export Data</button>
        </div>
      </div>`;
    }
  }

  // ===== Dashboard V2 =====

  // Animated typing effect for empty-state welcome
  function startWelcomeTyping() {
    const el = document.getElementById('welcomeTyping');
    if (!el || window._welcomeTypingInterval) return;
    let phrases;
    try {
      phrases = JSON.parse(el.dataset.phrases || '[]');
    } catch (_e) {
      return;
    }
    if (!phrases.length) return;
    let pi = 0,
      ci = 0,
      deleting = false;
    window._welcomeTypingInterval = setInterval(() => {
      const target = document.getElementById('welcomeTyping');
      if (!target) {
        clearInterval(window._welcomeTypingInterval);
        window._welcomeTypingInterval = null;
        return;
      }
      const phrase = phrases[pi];
      if (!deleting) {
        ci++;
        target.textContent = phrase.slice(0, ci);
        if (ci >= phrase.length) {
          setTimeout(() => {
            deleting = true;
          }, 1200);
          return;
        }
      } else {
        ci--;
        target.textContent = phrase.slice(0, ci);
        if (ci <= 0) {
          deleting = false;
          pi = (pi + 1) % phrases.length;
        }
      }
    }, 65);
  }

  // Quick brainstorm: track word count in hero input for brainstorm hint
  let _brainstormAC = null; // AbortController for quick brainstorm listeners
  function setupQuickBrainstorm() {
    const input = document.getElementById('quickCapture');
    const hintEl = document.getElementById('brainstormHint');
    if (!input || !hintEl) return;
    // Abort previous listeners before binding new ones
    if (_brainstormAC) _brainstormAC.abort();
    _brainstormAC = new AbortController();
    const signal = _brainstormAC.signal;
    input.addEventListener(
      'input',
      function () {
        const words = this.value.trim().split(/\s+/).filter(Boolean).length;
        if (words >= BRAINSTORM_WORD_THRESHOLD) {
          hintEl.style.display = 'block';
        } else {
          hintEl.style.display = 'none';
        }
      },
      { signal },
    );
    input.addEventListener(
      'keydown',
      function (e) {
        if (e.shiftKey && e.key === 'Enter') {
          const val = this.value.trim();
          const words = val.split(/\s+/).filter(Boolean).length;
          if (words >= BRAINSTORM_WORD_THRESHOLD) {
            e.preventDefault();
            this.value = '';
            const hintEl2 = document.getElementById('brainstormHint');
            if (hintEl2) hintEl2.style.display = 'none';
            setView('dump');
            setTimeout(() => {
              const t = document.getElementById('dumpText');
              if (t) {
                t.value = val;
                t.focus();
                t.dispatchEvent(new Event('input'));
              }
            }, 100);
          }
        }
      },
      { signal },
    );
  }

  // Safe nudge action lookup
  const _nudgeActionMap = {
    'nudgeFilterOverdue()': () => nudgeFilterOverdue(),
    'nudgeFilterStale()': () => nudgeFilterStale(),
    'nudgeFilterUnassigned()': () => nudgeFilterUnassigned(),
    'startFocus()': () => startFocus(),
    'clearNudgeFilter()': () => {
      setNudgeFilter('');
      render();
    },
  };

  let _nudgeAC = null; // AbortController for nudge action listeners
  function bindNudgeActions() {
    // Abort previous nudge listeners before binding new ones
    if (_nudgeAC) _nudgeAC.abort();
    _nudgeAC = new AbortController();
    const signal = _nudgeAC.signal;
    document.querySelectorAll('[data-nudge-action]').forEach((el) => {
      el.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          const fn = e.currentTarget.dataset.nudgeAction;
          if (_nudgeActionMap[fn]) _nudgeActionMap[fn]();
        },
        { signal },
      );
    });
    document.querySelectorAll('[data-stuck-task-id]').forEach((el) => {
      el.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          const taskId = e.currentTarget.dataset.stuckTaskId;
          if (taskId && typeof offerStuckHelp === 'function') offerStuckHelp(taskId);
        },
        { signal },
      );
    });
  }

  // Hook into render cycle to start typing animation + brainstorm hint
  function hookDashboardPostRender() {
    if (window._dashV2Hooked) return;
    const origRender = window.render;
    if (typeof origRender !== 'function') {
      setTimeout(hookDashboardPostRender, 200);
      return;
    }
    window._dashV2Hooked = true;
    window.render = function () {
      const result = origRender.apply(this, arguments);
      requestAnimationFrame(() => {
        if (window._welcomeTypingInterval && !document.getElementById('welcomeTyping')) {
          clearInterval(window._welcomeTypingInterval);
          window._welcomeTypingInterval = null;
        }
        startWelcomeTyping();
        setupQuickBrainstorm();
        bindNudgeActions();
      });
      return result;
    };
  }

  function heroInputHandler(e) {
    if (e.key !== 'Enter') return;
    const data = getData();
    const val = e.target.value.trim();
    if (!val) return;

    // Shift+Enter → navigate to capture view with the text
    if (e.shiftKey) {
      e.target.value = '';
      setView('dump');
      setTimeout(() => {
        const dt = document.getElementById('dumpText');
        if (dt) {
          dt.value = val;
          dt.focus();
        }
      }, 100);
      return;
    }

    // #hashtag → assign to project
    let projectId = '';
    const hashMatch = val.match(/#(\S+)/);
    if (hashMatch) {
      const tag = hashMatch[1].toLowerCase();
      const proj = data.projects.find((p) => p.name.toLowerCase().includes(tag));
      if (proj) projectId = proj.id;
    }
    const cleanVal = val.replace(/#\S+/g, '').trim();

    // Create task — simple and direct
    const parsed = parseQuickInput(cleanVal);
    const newTask = createTask({
      title: parsed.title,
      priority: parsed.priority || 'normal',
      dueDate: parsed.dueDate || '',
      project: projectId || parsed.quickProject?.id || '',
    });
    addTask(newTask);
    e.target.value = '';
    showToast(`+ ${parsed.title}${parsed.dueDate ? ' (due ' + parsed.dueDate + ')' : ''}`, false, true);
    render();
  }
  // ===== Dashboard sub-functions =====

  // ===== Day Plan Centerpiece =====

  function _renderDayPlanCenterpiece() {
    let html = '';
    const planKey = userKey('whiteboard_plan_' + todayStr());
    const cachedPlan = localStorage.getItem(planKey);
    const _planGenerating = getPlanGenerating();
    const narrativeKey = userKey('whiteboard_narrative_' + todayStr());
    const cachedNarrative = localStorage.getItem(narrativeKey);

    if (cachedPlan) {
      // Narrative brief above the plan — with reply input for conversation
      if (cachedNarrative) {
        html += `<div style="margin-bottom:20px;padding:16px 20px;background:var(--surface);border-radius:var(--radius);border-left:3px solid var(--accent)">
          <div style="font-size:14px;color:var(--text);line-height:1.7;margin-bottom:12px">${esc(cachedNarrative)}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="narrativeReply" placeholder="Reply... (e.g. 'the tax return can wait, CPA is handling it')" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text);background:var(--surface2);outline:none;font-family:inherit" data-keydown-action="narrative-reply">
            <button class="btn btn-sm" data-action="send-narrative-reply" style="flex-shrink:0;color:var(--accent)">Reply</button>
          </div>
        </div>`;
      }
      html += _renderDayPlanActive(cachedPlan, planKey);
      return html;
    }

    if (_planGenerating) {
      html += `<div class="day-plan-centerpiece" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px">`;
      html += `<div class="skeleton-pulse" style="padding:20px;min-height:100px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm)">
        <span style="font-size:13px;color:var(--text3)">Planning your day...</span>
      </div></div>`;
      return html;
    }

    const dismissed = localStorage.getItem(userKey('whiteboard_plan_dismissed_' + todayStr()));
    if (!dismissed) {
      html += _renderNoPlanState();
    }
    return html;
  }

  function _renderPlanTaskRow(p, t, i, totalActive) {
    const _expandedTask = getExpandedTask();
    const isExpanded = _expandedTask === t.id;
    let html = '';

    if (isExpanded) {
      try {
        html += renderTaskExpanded(t, true);
      } catch (_expandErr) {
        console.warn('Task expand failed:', _expandErr);
        html += `<div style="padding:8px;color:var(--red);font-size:12px">Error rendering task details</div>`;
      }
    } else {
      const dueDateStr = t.dueDate
        ? ` <span style="font-size:10px;color:var(--text3)">${fmtDate(t.dueDate)}</span>`
        : '';
      const subtaskInfo =
        t.subtasks && t.subtasks.length
          ? ` <span style="font-size:10px;color:var(--text3)">(${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length})</span>`
          : '';
      const estStr = t.estimatedMinutes
        ? ` <span style="font-size:10px;color:var(--text3)">~${t.estimatedMinutes}m</span>`
        : '';
      const borderColor =
        t.priority === 'urgent' ? 'var(--red)' : t.priority === 'important' ? 'var(--orange)' : 'transparent';

      html += `<div class="plan-task-row" draggable="true" data-plan-drag="${p.id}" data-plan-index="${i}" role="listitem" style="border-left:3px solid ${borderColor}">
        <div class="task-check" data-action="complete-task" data-task-id="${t.id}" role="checkbox" aria-checked="false" tabindex="0" aria-label="Mark ${esc(t.title)} done" style="flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <span style="font-size:14px;color:var(--text);cursor:pointer" data-action="toggle-expand" data-task="${t.id}">${esc(t.title)}</span>
          ${dueDateStr}${subtaskInfo}${estStr}
        </div>
        <button data-action="snooze-plan-task" data-task-id="${p.id}" class="snooze-btn-hover" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:4px 8px;white-space:nowrap;flex-shrink:0;border-radius:var(--radius-xs);transition:all 0.15s;opacity:0" title="Move to tomorrow">\u2192</button>
      </div>`;
      if (p.why)
        html += `<div style="margin-left:26px;font-size:11px;color:var(--text3);margin-bottom:4px;margin-top:-4px;font-style:italic">${esc(p.why)}</div>`;
    }
    return html;
  }

  function _renderDayPlanActive(cachedPlan, _planKey) {
    let html = '';
    try {
      const raw = JSON.parse(cachedPlan);

      // Detect format: blocks vs flat
      if (raw && raw.blocks) {
        return _renderBlockedPlan(raw);
      }

      // Flat format (legacy + simple)
      const plan = Array.isArray(raw) ? raw : [];
      const validPlan = plan.filter((p) => findTask(p.id));
      const activePlanItems = [];
      const completedPlanItems = [];

      validPlan.forEach((p, i) => {
        const t = findTask(p.id);
        if (!t) return;
        const isDone = p.completedInPlan || t.status === 'done';
        if (isDone) {
          completedPlanItems.push({ ...p, _task: t, _index: i });
        } else {
          activePlanItems.push({ ...p, _task: t, _index: i });
        }
      });

      const doneCount = completedPlanItems.length;
      const totalCount = validPlan.length;
      const remainingMinutes = activePlanItems.reduce((sum, p) => sum + (p._task.estimatedMinutes || 0), 0);
      const remainingStr =
        remainingMinutes > 0 ? ` \u00b7 ~${Math.round((remainingMinutes / 60) * 10) / 10}h remaining` : '';
      const allDone = doneCount === totalCount && totalCount > 0;

      html += `<div class="day-plan-centerpiece" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px">`;
      html += `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:15px;font-weight:600;color:var(--text)">Today's Plan</span>
          <span style="font-size:11px;color:var(--text3)">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:${allDone ? 'var(--green)' : 'var(--text3)'}">${doneCount}/${totalCount}${remainingStr}</span>
          <button data-action="replan-day" style="font-size:11px;color:var(--accent);background:none;border:1px solid var(--border);border-radius:var(--radius-xs);padding:2px 8px;cursor:pointer" title="Reassess and update plan">↻ Refresh</button>
        </div>
      </div>`;

      html += `<div role="list" aria-label="Today's plan tasks">`;
      activePlanItems.forEach((p, i) => {
        html += _renderPlanTaskRow(p, p._task, i, activePlanItems.length);
      });
      html += `</div>`;

      if (completedPlanItems.length > 0) {
        html += _renderCompletedSection(completedPlanItems);
      }

      html += _renderPlanFooter();
      html += `</div>`;
    } catch (e) {
      console.warn('Plan render failed:', e);
    }
    return html;
  }

  function _renderBlockedPlan(plan) {
    let html = '';
    const blocks = plan.blocks || [];

    // Gather stats across all blocks
    let totalTasks = 0;
    let doneTasks = 0;
    let remainingMinutes = 0;
    const completedItems = [];

    blocks.forEach((block) => {
      if (block.isBreak) return;
      (block.tasks || []).forEach((p) => {
        const t = findTask(p.id);
        if (!t) return;
        totalTasks++;
        if (p.completedInPlan || t.status === 'done') {
          doneTasks++;
          completedItems.push({ ...p, _task: t });
        } else {
          remainingMinutes += t.estimatedMinutes || 0;
        }
      });
    });

    const remainingStr =
      remainingMinutes > 0 ? ` \u00b7 ~${Math.round((remainingMinutes / 60) * 10) / 10}h remaining` : '';
    const allDone = doneTasks === totalTasks && totalTasks > 0;

    html += `<div class="day-plan-centerpiece" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px">`;

    // Header
    html += `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:15px;font-weight:600;color:var(--text)">Today's Plan</span>
        <span style="font-size:11px;color:var(--text3)">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:${allDone ? 'var(--green)' : 'var(--text3)'}">${doneTasks}/${totalTasks}${remainingStr}</span>
        <button data-action="replan-day" style="font-size:11px;color:var(--accent);background:none;border:1px solid var(--border);border-radius:var(--radius-xs);padding:2px 8px;cursor:pointer" title="Reassess and update plan">↻ Refresh</button>
      </div>
    </div>`;

    // Render each time block
    let taskIdx = 0;
    blocks.forEach((block) => {
      if (block.isBreak) {
        html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;margin:4px 0">
          <span style="font-size:11px;color:var(--text3);font-weight:500">${esc(block.time || '')}</span>
          <span style="font-size:12px;color:var(--text3);font-style:italic">${esc(block.label || 'Break')}</span>
          <div style="flex:1;height:1px;background:var(--border)"></div>
        </div>`;
        return;
      }

      const blockTasks = (block.tasks || []).filter((p) => {
        const t = findTask(p.id);
        return t && t.status !== 'done' && !p.completedInPlan;
      });
      const blockMinutes = blockTasks.reduce((s, p) => {
        const t = findTask(p.id);
        return s + (t?.estimatedMinutes || 0);
      }, 0);

      // Block header
      html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;margin-top:8px">
        <span style="font-size:11px;color:var(--accent);font-weight:600;white-space:nowrap">${esc(block.time || '')}</span>
        <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(block.label || '')}</span>
        ${block.projectName ? `<span style="font-size:11px;color:var(--text3)">${esc(block.projectName)}</span>` : ''}
        <div style="flex:1;height:1px;background:var(--border)"></div>
        ${blockMinutes > 0 ? `<span style="font-size:10px;color:var(--text3)">~${Math.round(blockMinutes / 60 * 10) / 10}h</span>` : ''}
      </div>`;

      // Block tasks
      html += `<div role="list" style="margin-left:4px">`;
      blockTasks.forEach((p) => {
        const t = findTask(p.id);
        if (!t) return;
        html += _renderPlanTaskRow(p, t, taskIdx++, blockTasks.length);
      });
      if (blockTasks.length === 0) {
        html += `<div style="padding:6px 0 6px 26px;font-size:12px;color:var(--text3);font-style:italic">All done in this block \u2713</div>`;
      }
      html += `</div>`;
    });

    // Completed section
    if (completedItems.length > 0) {
      html += _renderCompletedSection(completedItems);
    }

    html += _renderPlanFooter();
    html += `</div>`;
    return html;
  }

  function _renderCompletedSection(completedItems) {
    let html = `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
      <div style="font-size:11px;color:var(--text3);margin-bottom:4px;cursor:pointer;user-select:none" data-action="toggle-completed" data-key="plan-done">${getShowCompleted('plan-done') ? '\u25be' : '\u25b8'} Completed (${completedItems.length})</div>`;
    if (getShowCompleted('plan-done')) {
      completedItems.forEach((p) => {
        const t = p._task;
        html += `<div style="display:flex;align-items:center;gap:10px;padding:4px;opacity:0.45">
          <div class="task-check done" style="flex-shrink:0"></div>
          <span style="font-size:12px;color:var(--text3);text-decoration:line-through;flex:1">${esc(t.title)}</span>
        </div>`;
      });
    }
    html += `</div>`;
    return html;
  }

  function _renderPlanFooter() {
    return `<div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      <button data-action="replan-day" class="briefing-generate" style="color:var(--accent);font-size:11px">\u21bb Replan</button>
      <button data-action="add-to-plan" class="briefing-generate" style="font-size:11px">+ Add to plan</button>
      <button data-action="share-plan" class="briefing-generate" style="font-size:11px">\u2197 Share</button>
    </div>`;
  }

  function _renderNoPlanState() {
    if (!hasAI()) return '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:12px 0;margin-bottom:8px">
      <button class="btn btn-sm" data-action="plan-my-day" id="planBtn" style="color:var(--accent);font-size:12px">\u25ce Plan my day</button>
      <span style="font-size:11px;color:var(--text3)">or just start adding tasks below</span>
    </div>`;
  }

  function _renderBriefingToggle(cachedBriefing, _briefingGenerating) {
    let html = '';
    const _todayBriefingExpanded = getTodayBriefingExpanded();
    if (cachedBriefing) {
      html += `<div style="margin-bottom:16px">`;
      html += `<div data-action="${_todayBriefingExpanded ? 'briefing-collapse' : 'briefing-expand'}" role="button" tabindex="0" style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;padding:6px 0">
        <span style="font-size:12px;color:var(--text3);transition:transform 0.2s${_todayBriefingExpanded ? ';transform:rotate(90deg)' : ''}">\u25b8</span>
        <span style="font-size:12px;color:var(--text3)">\uD83D\uDCCB ${_todayBriefingExpanded ? 'Hide' : 'Show'} today's briefing</span>
      </div>`;
      if (_todayBriefingExpanded) {
        html += `<div class="today-briefing-body" id="briefingBody" style="padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:4px">${sanitizeAIHTML(cachedBriefing)}</div>`;
        html += `<div style="display:flex;gap:8px;margin-top:6px">
          <button class="briefing-generate" data-action="briefing-collapse" style="font-size:11px">Hide briefing</button>
          <button class="briefing-generate" data-action="generate-briefing" id="briefingBtn" style="font-size:11px">\u21bb Refresh</button>
        </div>`;
      }
      html += `</div>`;
    } else if (_briefingGenerating) {
      html += `<div class="skeleton-pulse" style="padding:12px 16px;min-height:40px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;border-radius:var(--radius-sm)"><span style="font-size:11px;color:var(--text3)">Generating briefing...</span></div>`;
    } else if (hasAI()) {
      html += `<div style="margin-bottom:12px">
        <button class="briefing-generate" data-action="generate-briefing" id="briefingBtn" style="font-size:11px;color:var(--text3)">\u2726 Generate Briefing</button>
      </div>`;
    }
    return html;
  }

  function _renderEndOfDay(data) {
    let html = '';
    const eodKey = userKey('wb_eod_' + todayStr());
    const cachedEod = localStorage.getItem(eodKey);
    const completedToday = data.tasks.filter(
      (t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === todayStr(),
    );
    const eodDismissedKey = userKey('whiteboard_eod_dismissed_' + todayStr());
    if (
      new Date().getHours() >= 17 &&
      hasAI() &&
      completedToday.length >= 1 &&
      !localStorage.getItem(eodDismissedKey)
    ) {
      if (cachedEod) {
        html += `<div class="eod-card">
          <div class="eod-header">
            <span style="font-size:14px;color:var(--purple)">&#9790;</span>
            <div class="eod-title">End of Day</div>
            <span style="font-size:11px;color:var(--text3);margin-left:auto">Today</span>
          </div>
          <div class="eod-response">${sanitizeAIHTML(cachedEod)}</div>
        </div>`;
      } else {
        html += `<div class="eod-card" id="eodCard">
          <div class="eod-header">
            <span style="font-size:14px;color:var(--purple)">&#9790;</span>
            <div class="eod-title">How did today go?</div>
          </div>
          <textarea class="eod-textarea" id="eodInput" rows="3" placeholder="What went well? What was hard? Anything on your mind..." aria-label="End of day reflection"></textarea>
          <div style="display:flex;gap:8px">
            <button class="briefing-generate" data-action="submit-eod" id="eodBtn" style="color:var(--purple);border-color:rgba(168,85,247,0.2)">Wrap up</button>
            <button class="briefing-generate" data-action="skip-eod" style="color:var(--text3);border-color:var(--border)">Skip</button>
          </div>
        </div>`;
      }
    }
    return html;
  }

  // Override renderDashboard — dispatcher that calls sub-functions

  function renderMemoryInsightsCard() {
    if (typeof getAIMemory !== 'function' || typeof extractMemoryInsights !== 'function') return '';
    const memories = getAIMemory();
    if (memories.length < 5) return '';
    const insights = extractMemoryInsights(memories);

    const lines = [];
    if (insights.avg_tasks_per_day) lines.push('You complete ~' + insights.avg_tasks_per_day + ' tasks per day');
    if (insights.most_productive_day) lines.push('Most productive: ' + insights.most_productive_day + 's');
    if (insights.productive_time) lines.push('Peak time: ' + insights.productive_time);

    // Generate personalized tip
    let tip = '';
    if (insights.task_order_preference === 'hard-first') tip = 'Tip: You do best tackling hard tasks first.';
    else if (insights.task_order_preference === 'easy-first') tip = 'Tip: Quick wins first works well for you.';
    else if (insights.procrastination_types.length)
      tip = 'Tip: Schedule ' + insights.procrastination_types[0] + ' tasks when your energy is highest.';
    else if (insights.productive_time) tip = 'Tip: Protect your ' + insights.productive_time + ' for deep work.';

    if (!lines.length && !tip) return '';

    let html =
      '<div class="memory-insights-card" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 20px;margin-bottom:16px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
    html += '<span style="font-size:14px">&#9673;</span>';
    html += '<span style="font-size:13px;font-weight:600;color:var(--text)">Learned Patterns</span>';
    html += '<span style="font-size:10px;color:var(--text3);margin-left:auto">' + memories.length + ' memories</span>';
    html += '</div>';
    lines.forEach(function (line) {
      html += '<div style="font-size:12px;color:var(--text2);padding:2px 0;line-height:1.5">' + esc(line) + '</div>';
    });
    if (tip) {
      html +=
        '<div style="font-size:11px;color:var(--accent);margin-top:8px;padding-top:8px;border-top:1px solid var(--border);line-height:1.4">' +
        esc(tip) +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── Weekly Learnings Card ────────────────────────────────────────

  function _renderWeeklyLearnings() {
    if (typeof getWeeklyLearnings !== 'function') return '';
    const dismissed = sessionStorage.getItem('__tb_weekly_learnings_dismissed');
    if (dismissed) return '';

    const learn = getWeeklyLearnings();
    if (learn.tasksCompleted < 3) return ''; // Not enough data to be meaningful

    const lines = [];

    lines.push(`You completed <strong>${learn.tasksCompleted}</strong> tasks this week`);

    if (learn.peakTime && learn.peakTimeCount >= 2) {
      lines.push(`Most productive in the <strong>${learn.peakTime}</strong> (${learn.peakTimeCount} tasks)`);
    }

    if (learn.peakDay && learn.peakDayCount >= 2) {
      lines.push(`Best day: <strong>${learn.peakDay}</strong> (${learn.peakDayCount} tasks)`);
    }

    if (learn.avgCompletionDays !== null) {
      if (learn.avgCompletionDays <= 1) {
        lines.push('Average task turnaround: <strong>same day</strong>');
      } else {
        lines.push(`Average task turnaround: <strong>${learn.avgCompletionDays} days</strong>`);
      }
    }

    if (learn.mostSkipped.length > 0) {
      const skippedNames = learn.mostSkipped.map(([name, count]) => `${name} (${count}x)`).join(', ');
      lines.push(`Most skipped: ${skippedNames}`);
    }

    if (lines.length < 2) return ''; // Not interesting enough to show

    return `<div style="margin-top:20px;padding:16px 20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);border-left:3px solid var(--purple,#8b5cf6)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:13px;font-weight:600;color:var(--text)">\u2726 What I learned about you this week</span>
        <button class="btn btn-sm" data-action="dismiss-weekly-learnings" style="font-size:10px;color:var(--text3);padding:2px 6px">\u2715</button>
      </div>
      <div style="font-size:13px;color:var(--text2);line-height:1.8">${lines.map((l) => `<div>\u2022 ${l}</div>`).join('')}</div>
      ${learn.totalActive > 0 ? `<div style="margin-top:10px;font-size:11px;color:var(--text3)">${learn.totalActive} tasks still active across all boards</div>` : ''}
    </div>`;
  }

  // ── Share helpers ───────────────────────────────────────────────

  function _statusIcon(status) {
    if (status === 'done') return '\u2713';
    if (status === 'in-progress') return '\u25d0';
    if (status === 'waiting') return '\u23f8';
    return '\u25cb';
  }

  async function _shareText(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if (err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Plan copied to clipboard');
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Plan copied to clipboard');
    }
  }

  function shareTodaysPlan() {
    const today = todayStr();
    const planKey = userKey('whiteboard_plan_' + today);
    const narrativeKey = userKey('whiteboard_narrative_' + today);
    const cachedPlan = localStorage.getItem(planKey);
    const cachedNarrative = localStorage.getItem(narrativeKey);
    if (!cachedPlan) {
      showToast('No plan to share — plan your day first');
      return;
    }

    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    let lines = [`My plan for ${dateLabel}`, ''];

    if (cachedNarrative) {
      lines.push(cachedNarrative, '');
    }

    let totalRemaining = 0;

    try {
      const raw = JSON.parse(cachedPlan);
      if (raw && raw.blocks) {
        // Time-blocked format
        raw.blocks.forEach((block) => {
          if (block.isBreak) {
            lines.push(`${block.time || ''}  ${block.label || 'Break'}`);
            return;
          }
          const blockHeader = [block.time, block.label, block.projectName].filter(Boolean).join(' \u2014 ');
          lines.push(blockHeader);
          (block.tasks || []).forEach((p) => {
            const t = findTask(p.id);
            if (!t) return;
            const icon = _statusIcon(t.status);
            const est = t.estimatedMinutes ? ` (~${t.estimatedMinutes}m)` : '';
            lines.push(`  ${icon} ${t.title}${est}`);
            if (t.status !== 'done') totalRemaining += t.estimatedMinutes || 0;
          });
          lines.push('');
        });
      } else {
        // Flat format
        const plan = Array.isArray(raw) ? raw : [];
        plan.forEach((p) => {
          const t = findTask(p.id);
          if (!t) return;
          const icon = _statusIcon(t.status);
          const est = t.estimatedMinutes ? ` (~${t.estimatedMinutes}m)` : '';
          lines.push(`${icon} ${t.title}${est}`);
          if (t.status !== 'done') totalRemaining += t.estimatedMinutes || 0;
        });
        lines.push('');
      }
    } catch {
      showToast('Could not read plan data', true);
      return;
    }

    if (totalRemaining > 0) {
      const hours = Math.round((totalRemaining / 60) * 10) / 10;
      lines.push(`~${hours}h remaining`);
    }

    _shareText(lines.join('\n').trim());
  }

  function shareFocusRecommendation(taskId) {
    const t = findTask(taskId);
    if (!t) {
      showToast('Task not found');
      return;
    }
    const data = getData();
    const proj = data.projects.find((p) => p.id === t.project);
    const projName = proj ? proj.name : '';

    let lines = ['Currently working on:', ''];
    lines.push(t.title);
    if (projName) lines.push(`Board: ${projName}`);
    if (t.dueDate) {
      const d = new Date(t.dueDate + 'T12:00:00');
      lines.push(`Due: ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
    }
    if (t.estimatedMinutes) lines.push(`Estimate: ~${t.estimatedMinutes}m`);
    if (t.subtasks && t.subtasks.length) {
      const done = t.subtasks.filter((s) => s.done).length;
      lines.push(`Progress: ${done}/${t.subtasks.length} subtasks`);
    }

    _shareText(lines.join('\n').trim());
  }

  // ── Focus Card: "What should I do right now?" ────────────────────
  let _focusSkippedIds = [];

  function _renderFocusCard() {
    if (!hasAI()) return '';
    if (typeof getNextRecommendation !== 'function') return '';

    const rec = getNextRecommendation(_focusSkippedIds);
    if (!rec) {
      if (_focusSkippedIds.length > 0) {
        // User skipped everything — show reset
        return `<div style="text-align:center;padding:24px;margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">
          <div style="font-size:14px;color:var(--text2);margin-bottom:12px">You've skipped all recommendations for now.</div>
          <button class="btn btn-sm" data-action="reset-focus-skips" style="color:var(--accent)">Show recommendations again</button>
        </div>`;
      }
      return '';
    }

    const t = rec.task;
    const projName = rec.project ? rec.project.name : '';
    const borderColor =
      t.priority === 'urgent' ? 'var(--red)' : t.priority === 'important' ? 'var(--orange)' : 'var(--accent)';

    let html = '';

    // v7: Show AI follow-up alerts (generated overnight)
    try {
      const followUps = JSON.parse(localStorage.getItem(userKey('whiteboard_followups_' + todayStr())) || '[]');
      followUps.forEach((fu) => {
        html += `<div style="padding:12px 16px;margin-bottom:12px;background:rgba(var(--orange-rgb,245,158,11),0.06);border:1px solid rgba(var(--orange-rgb,245,158,11),0.15);border-radius:var(--radius);font-size:13px;color:var(--text2);display:flex;align-items:center;gap:10px">
          <span style="font-size:16px">\u26a0</span>
          <span style="flex:1">${esc(fu.message)}</span>
          ${fu.taskId ? `<button class="btn btn-sm" data-action="focus-talk" data-task-id="${fu.taskId}" style="flex-shrink:0;font-size:11px;color:var(--accent)">Talk about this</button>` : ''}
        </div>`;
      });
    } catch { /* */ }

    // First-time tooltip for the focus card
    const _focusTipKey = userKey('wb_focus_tip_seen');
    const _showFocusTip = !localStorage.getItem(_focusTipKey);

    html += `<div class="focus-card" style="position:relative;padding:28px 24px;margin-bottom:24px;background:var(--surface);border:1px solid var(--border);border-left:4px solid ${borderColor};border-radius:var(--radius);box-shadow:0 1px 3px rgba(0,0,0,0.04)">`;

    if (_showFocusTip) {
      html += `<div id="focusTip" style="position:absolute;top:-44px;left:16px;right:16px;background:var(--accent);color:#fff;font-size:12px;line-height:1.5;padding:8px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.12);z-index:10;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span>This is your AI recommendation — what to do next and why.</span>
        <span data-action="dismiss-focus-tip" style="cursor:pointer;opacity:0.8;flex-shrink:0;font-weight:600">&times;</span>
        <div style="position:absolute;bottom:-6px;left:24px;width:12px;height:12px;background:var(--accent);transform:rotate(45deg)"></div>
      </div>`;
    }

    // Top line — subtle context
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent)">Up next</span>
      ${projName ? `<span style="font-size:11px;color:var(--text3)">${esc(projName)}</span>` : ''}
    </div>`;

    // Task title — big, clear, decisive
    html += `<div style="font-size:18px;font-weight:600;color:var(--text);line-height:1.4;margin-bottom:8px">${esc(t.title)}</div>`;

    // Reason + estimate — the "why"
    const meta = [rec.reason, rec.estimate].filter(Boolean).join(' \u00b7 ');
    if (meta) {
      html += `<div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:16px">${esc(meta)}</div>`;
    }

    // Notes preview if task has notes
    if (t.notes) {
      html += `<div style="font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:16px;padding:8px 12px;background:var(--surface2);border-radius:6px">${esc(t.notes.slice(0, 120))}${t.notes.length > 120 ? '...' : ''}</div>`;
    }

    // Subtask progress if applicable
    if (t.subtasks && t.subtasks.length) {
      const done = t.subtasks.filter((s) => s.done).length;
      html += `<div style="font-size:11px;color:var(--text3);margin-bottom:16px">${done}/${t.subtasks.length} subtasks complete</div>`;
    }

    // Skip awareness — gentle nudge if this task has been repeatedly skipped
    if (rec.timesSkipped >= 3) {
      html += `<div style="font-size:12px;color:var(--orange);line-height:1.5;margin-bottom:14px;padding:8px 12px;background:rgba(var(--orange-rgb,245,158,11),0.06);border-radius:6px">You've skipped this ${rec.timesSkipped} times. Want to break it down, delegate it, or drop it?</div>`;
    }

    // Action buttons — decisive, clear
    html += `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" data-action="focus-start" data-task-id="${t.id}" style="padding:8px 20px;font-size:13px">Let's do it</button>
      <button class="btn btn-sm" data-action="focus-skip" data-task-id="${t.id}" style="color:var(--text3);font-size:13px">Not now</button>
      <button class="btn btn-sm" data-action="focus-talk" data-task-id="${t.id}" style="color:var(--accent);font-size:13px">\u2726 Talk to me about this</button>
      <button class="btn btn-sm" data-action="share-focus" data-task-id="${t.id}" style="color:var(--text3);font-size:13px">\u2197 Share</button>
    </div>`;

    // "After this" peek
    if (rec.nextUp) {
      html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:11px;color:var(--text3)">After this \u2192 ${esc(rec.nextUp)}</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderDashboard() {
    const data = getData();
    const active = activeTasks();

    // First-time onboarding — welcoming hero with brainstorm textarea front-and-center
    if (data.tasks.length === 0 && data.projects.length <= 1) {
      const _guest = typeof isGuestMode === 'function' && isGuestMode();
      const _guestBadge = _guest
        ? '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:var(--accent-dim);font-size:11px;color:var(--accent);margin-bottom:16px"><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block"></span>Guest mode — your data is saved locally</div>'
        : '';
      return `<div style="max-width:560px;margin:32px auto;text-align:center">
        ${_guestBadge}
        <h1 style="font-size:26px;font-weight:700;color:var(--text);margin:0 0 8px;line-height:1.3">Welcome! What's on your mind?</h1>
        <p style="font-size:14px;color:var(--text3);line-height:1.6;margin-bottom:24px;max-width:440px;margin-left:auto;margin-right:auto">Paste your to-do list, brain dump, or just type what you're working on. AI organizes it into tasks and tells you what to do first.</p>
        <div style="text-align:left">
          <textarea id="onboardDump" aria-label="Brain dump — paste notes, ideas, plans" style="width:100%;min-height:160px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;font-size:14px;color:var(--text);font-family:inherit;resize:vertical;outline:none;line-height:1.6;box-sizing:border-box" placeholder="Example: Finish the Q2 report by Friday, call dentist, pick up groceries, prep slides for Monday's meeting, reply to Sarah's email about the project timeline..."></textarea>
          <div style="display:flex;gap:12px;margin-top:14px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" data-action="onboard-process" style="padding:12px 24px;font-size:14px;font-weight:600">Organize this &rarr;</button>
            <span style="font-size:12px;color:var(--text3)">or <span style="color:var(--accent);cursor:pointer" data-action="go-dump">attach files</span></span>
            <span style="font-size:12px;color:var(--text3);margin-left:auto;cursor:pointer" data-action="onboard-skip">Skip for now</span>
          </div>
        </div>
      </div>`;
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const overdue = active.filter((t) => t.dueDate && t.dueDate < todayStr());
    const dueToday = active.filter((t) => t.dueDate === todayStr());

    let html = '';

    // FOCUS CARD — "What should I do right now?"
    html += _renderFocusCard();

    // Clean greeting — no badge noise
    html += `<div style="margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:600;color:var(--text);margin:0">${greeting}</h2>
    </div>`;

    // THE PLAN — this is the entire dashboard
    html += _renderDayPlanCenterpiece();

    // Compact input below plan
    html += `<div style="margin-top:16px">
      <input class="conversational-input" id="quickCapture" placeholder="Add a task..." aria-label="Add a task" data-keydown-action="hero-input" data-oninput-action="preview-quick-capture" autocomplete="off" style="font-size:13px">
      <div id="quickCapturePreview" class="smart-date-preview" style="padding-left:0"></div>
    </div>`;

    // EOD only — no briefing card, no filters, no tag UI
    html += _renderEndOfDay(data);

    // Weekly learnings — show on Fridays and weekends
    const _dayOfWeek = new Date().getDay();
    if (_dayOfWeek >= 5 || _dayOfWeek === 0) {
      html += _renderWeeklyLearnings();
    }

    // Nudges → toast only
    _showNudgeAsToast();

    return html;
  }

  // === Plan-first dashboard: day plan centerpiece is the main content ===
  // Nudges → toast only: show the top nudge as a toast notification, once per app open
  function _showNudgeAsToast() {
    const sessionFlag = '__tb_nudge_toast_shown';
    if (typeof window !== 'undefined' && window.sessionStorage && window.sessionStorage.getItem(sessionFlag)) return;
    const nudges = getSmartNudges();
    if (nudges.length > 0) {
      const top = nudges[0];
      showToast(top.text, false, true);
      if (typeof window !== 'undefined' && window.sessionStorage) window.sessionStorage.setItem(sessionFlag, '1');
    }
  }

  // Expose setPlanIndexCache for proactive module
  function setPlanIndexCache(cache, date) {
    _planIndexCache = cache;
    _planIndexDate = date;
  }

  // === Brainstorm Modal ===
  function openBrainstormModal() {
    const root = $('#modalRoot');
    if (!root) return;
    const dumpResult = renderDump();
    const renderModal = (dumpHtml) => {
      root.innerHTML = `<div class="modal-overlay" data-action="close-modal" data-click-self="true">
        <div class="modal" style="max-width:640px;width:100%;max-height:85vh;overflow-y:auto" aria-labelledby="modal-title-brainstorm">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <h2 id="modal-title-brainstorm" style="font-size:18px;font-weight:600;margin:0">Brainstorm</h2>
            <button class="btn btn-sm" data-action="close-modal" style="color:var(--text3);font-size:16px;padding:4px 8px" aria-label="Close">\u2715</button>
          </div>
          <div style="font-size:13px;color:var(--text3);margin-bottom:16px">Write everything on your mind \u2014 AI will do the rest</div>
          ${dumpHtml}
        </div>
      </div>`;
      initDumpDropZone();
    };
    if (dumpResult && typeof dumpResult.then === 'function') {
      root.innerHTML =
        '<div class="modal-overlay"><div class="modal" style="max-width:640px;width:100%;padding:40px;text-align:center"><span class="skeleton-pulse" style="display:inline-block;padding:12px 20px;font-size:13px;color:var(--text3)">Loading brainstorm...</span></div></div>';
      dumpResult.then(renderModal);
    } else {
      renderModal(dumpResult);
    }
  }

  /** Reset render memoization so the next _renderNow/renderSidebar always runs. */
  function invalidateRenderMemo() {
    _lastSidebarState = null;
    _lastContentState = null;
  }

  return {
    renderProject,
    renderDashboard,
    _renderNow,
    renderSidebar,
    renderArchive,
    sortTasks,
    renderTaskSlice,
    startWelcomeTyping,
    setupQuickBrainstorm,
    bindNudgeActions,
    hookDashboardPostRender,
    heroInputHandler,
    setPlanIndexCache,
    renderMemoryInsightsCard,
    invalidateRenderMemo,
    openBrainstormModal,
    shareTodaysPlan,
    shareFocusRecommendation,
    _addFocusSkip: (id) => { _focusSkippedIds.push(id); },
    _resetFocusSkips: () => { _focusSkippedIds = []; },
  };
}
