// ============================================================
// DASHBOARD MODULE
// ============================================================
// Extracted from app.js — handles dashboard rendering, sidebar,
// project view, archive, sorting, and dashboard-v2 features.

import {
  MS_PER_DAY,
  TRUNCATE_DESC,
  STALE_TASK_DAYS,
  MAX_KANBAN_DONE,
  DESC_TRUNCATE_SHORT,
  BRAINSTORM_WORD_THRESHOLD,
} from './constants.js';

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
    userKey,
    findTask,
    activeTasks,
    doneTasks,
    urgentTasks,
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
    renderPriorityTag,
    priorityColor,
    renderCalendar,
    getCurrentView,
    getCurrentProject,
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
    // Proactive module
    getAIStatusItems,
    getSmartFeedItems,
    getSmartNudges,
    getStuckTasks,
    detectVagueTasks,
    nudgeFilterOverdue,
    nudgeFilterStale,
    nudgeFilterUnassigned,
    startFocus,
    offerStuckHelp,
    generateAIBriefing,
    planMyDay,
    runProactiveWorker,
    // State flags
    getBriefingGenerating,
    setBriefingGenerating,
    getPlanGenerating,
    setPlanGenerating,
    getNudgeFilter,
    setNudgeFilter,
    getSmartFeedExpanded,
    getTodayBriefingExpanded,
    getShowTagFilter,
    getActiveTagFilter,
    getAllTags,
    getTagColor,
    // Chat
    toggleChat,
    sendChat,
    // Render helpers
    renderDump,
    initDumpDropZone,
    renderWeeklyReview,
    // Quick capture
    isComplexInput,
    parseQuickInput,
    handleSlashCommand,
    aiEnhanceTask,
    getEscalationBanner: _getEscalationBanner,
    getAIMemory,
    extractMemoryInsights,
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
      const sd = (a.status === 'in-progress' ? 0 : 1) - (b.status === 'in-progress' ? 0 : 1);
      if (sd) return sd;
      const pd = po[a.priority] - po[b.priority];
      if (pd) return pd;
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
    const _dv = sortTasksDeps.getDataVersion();
    const _bsMod = getBrainstormModule();
    const _dumpInProgress = _bsMod && typeof _bsMod.isDumpInProgress === 'function' && _bsMod.isDumpInProgress();
    const sidebarState = getCurrentView() + '|' + (getCurrentProject() || '') + '|' + _dv + '|' + _dumpInProgress;
    if (sidebarState === _lastSidebarState) return;
    _lastSidebarState = sidebarState;

    // Active states
    $$('.nav-item[data-view]').forEach((n) =>
      n.classList.toggle('active', n.dataset.view === getCurrentView() && !getCurrentProject()),
    );

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

    // Project list
    const pl = $('#projectList');
    pl.innerHTML = data.projects
      .map((p) => {
        const active = getCurrentView() === 'project' && getCurrentProject() === p.id;
        const count = activeTasks(p.id).length;
        const overdue = projectTasks(p.id).filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < todayStr());
        return `<div class="project-nav-item ${active ? 'active' : ''}" data-project="${p.id}">
        <div class="project-dot" style="background:${p.color}"></div>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
        ${count > 0 ? `<span class="project-nav-count">${count}</span>` : ''}
        ${overdue.length > 0 ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--red);flex-shrink:0" title="Has overdue tasks" aria-label="Has overdue tasks"></div>' : ''}
      </div>`;
      })
      .join('');
  }

  function _renderProjectHeader(p) {
    const bgOpen = getShowProjectBg(p.id) || false;
    const bg = p.background ? parseProjectBackground(p.background) : null;
    const tasks = projectTasks(p.id);
    const active = tasks.filter((t) => t.status !== 'done');
    const done = tasks.filter((t) => t.status === 'done');
    const urgent = active.filter((t) => t.priority === 'urgent' || (t.dueDate && t.dueDate <= todayStr()));

    let html = `<div class="project-info">
      <div class="project-info-header">
        <div class="project-info-dot" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
        <div style="flex:1">
          <h2 class="project-info-name">${esc(p.name)}</h2>
          ${p.description ? `<div class="project-info-desc">${esc(p.description.length > TRUNCATE_DESC ? p.description.slice(0, TRUNCATE_DESC) + '...' : p.description)}</div>` : `<div class="project-info-desc" style="color:var(--text3);font-style:italic">No description \u2014 <span style="cursor:pointer;color:var(--accent)" data-action="open-edit-project" data-project-id="${esc(p.id)}">add one</span></div>`}
          <div class="project-bg-toggle" data-action="toggle-project-bg" data-project-id="${esc(p.id)}">
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
      <div class="kanban-col" style="border-color:rgba(59,130,246,0.2)">
        <div class="kanban-col-header" style="color:var(--blue)">In Progress <span class="kanban-col-count">${wip.length}</span></div>
        ${wip
          .map(
            (
              t,
            ) => `<div class="kanban-card" data-task="${t.id}" data-action="toggle-expand" role="button" tabindex="0" aria-label="${esc(t.title)}"
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
        const s = ['todo', 'in-progress', 'done'][i];
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

  function _renderProjectRoadmap(tasks) {
    const phases = {};
    tasks.forEach((t) => {
      if (t.phase) {
        if (!phases[t.phase]) phases[t.phase] = [];
        phases[t.phase].push(t);
      }
    });
    const phaseNames = Object.keys(phases);
    if (phaseNames.length <= 1) return '';

    let html = `<div class="section"><div class="section-header"><h3 class="section-title">Roadmap</h3><div class="section-line"></div></div><div class="roadmap">`;
    phaseNames.forEach((phase) => {
      const pt = phases[phase];
      const ptDone = pt.filter((t) => t.status === 'done').length;
      const ptTotal = pt.length;
      const allDone = ptDone === ptTotal;
      const hasActive = pt.some((t) => t.status === 'in-progress');
      html += `<div class="roadmap-phase">
        <div class="roadmap-line"></div>
        <div class="roadmap-dot ${allDone ? 'done' : hasActive ? 'active' : ''}"></div>
        <div class="roadmap-content">
          <div class="roadmap-label">${esc(phase)}</div>
          <div class="roadmap-sub">${ptDone}/${ptTotal} complete</div>
        </div>
      </div>`;
    });
    html += `</div></div>`;
    return html;
  }

  function _renderProjectTaskSections(p, active, done, urgent, upcoming) {
    let html = '';

    // Urgent
    if (urgent.length > 0) {
      html += `<div class="section"><div class="section-header"><h3 class="section-title" style="color:var(--red)">Urgent</h3><div class="section-count">${urgent.length}</div><div class="section-line"></div></div>`;
      html += renderTaskSlice(sortTasks(urgent), 'urgent_' + p.id, (t) => renderTaskRow(t));
      html += `</div>`;
    }

    // In Progress
    const inProgress = active.filter((t) => t.status === 'in-progress');
    if (inProgress.length > 0) {
      html += `<div class="section"><div class="section-header"><h3 class="section-title" style="color:var(--blue)">In Progress</h3><div class="section-count">${inProgress.length}</div><div class="section-line"></div></div>`;
      html += renderTaskSlice(inProgress, 'wip_' + p.id, (t) => renderTaskRow(t));
      html += `</div>`;
    }

    // Upcoming (todo, non-urgent)
    const todoNonUrgent = upcoming.filter((t) => !urgent.includes(t));
    if (todoNonUrgent.length > 0) {
      html += `<div class="section"><div class="section-header"><h3 class="section-title">Upcoming</h3><div class="section-count">${todoNonUrgent.length}</div><div class="section-line"></div></div>`;
      html += renderTaskSlice(sortTasks(todoNonUrgent), 'upcoming_' + p.id, (t) => renderTaskRow(t));
      html += `</div>`;
    }

    if (active.length === 0 && done.length === 0) {
      html += `<div class="empty"><div class="empty-icon">\u2726</div><div class="empty-text">No tasks yet. Add one above, or start a Brainstorm to get everything out at once.</div><button class="btn btn-primary" data-action="open-new-task" data-project-id="${esc(p.id)}">+ Add Task</button></div>`;
    }

    // Completed
    if (done.length > 0) {
      const key = p.id;
      html += `<div class="section"><div class="completed-toggle" data-action="toggle-completed" data-key="${key}">
        ${getShowCompleted(key) ? '\u25be' : '\u25b8'} Completed <span class="section-count" style="margin-left:4px">${done.length}</span>
      </div>`;
      if (getShowCompleted(key)) {
        html += renderTaskSlice([...done].reverse(), 'done_' + p.id, (t) => renderTaskRow(t));
      }
      html += `</div>`;
    }
    return html;
  }

  function renderProject(p) {
    const tasks = projectTasks(p.id);
    const active = tasks.filter((t) => t.status !== 'done');
    const done = tasks.filter((t) => t.status === 'done');
    const urgent = active.filter((t) => t.priority === 'urgent' || (t.dueDate && t.dueDate <= todayStr()));
    const upcoming = active.filter((t) => t.status === 'todo');

    let html = _renderProjectHeader(p);

    // KANBAN VIEW
    const viewMode = getProjectViewMode(p.id) || 'list';
    if (viewMode === 'board') {
      html += _renderProjectKanban(p, active, done);
      return html;
    }

    // Phase Roadmap
    html += _renderProjectRoadmap(tasks);

    // Task sections
    html += _renderProjectTaskSections(p, active, done, urgent, upcoming);

    return html;
  }

  function _renderNowDashboardView(c, ha, data, bulkMode, dashViewMode) {
    const _estTotal = activeTasks().reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
    const _estStr = _estTotal > 0 ? ` \u00b7 ~${Math.round((_estTotal / 60) * 10) / 10}h estimated` : '';
    $('#viewSub').textContent = `${activeTasks().length} active tasks across ${data.projects.length} boards${_estStr}`;
    ha.innerHTML = `<div class="view-toggle"><button class="view-toggle-btn ${dashViewMode === 'list' ? 'active' : ''}" data-action="dash-view" data-mode="list">List</button><button class="view-toggle-btn ${dashViewMode === 'week' ? 'active' : ''}" data-action="dash-view" data-mode="week">Week</button><button class="view-toggle-btn ${dashViewMode === 'month' ? 'active' : ''}" data-action="dash-view" data-mode="month">Month</button></div><button class="btn btn-sm${bulkMode ? ' btn-active' : ''}" data-action="toggle-bulk" title="Select multiple tasks">\u2630 Bulk</button><button class="btn btn-sm" data-action="toggle-chat">\u2726 Ask AI</button><button class="btn btn-primary btn-sm" data-action="new-project">+ Board</button>`;
    c.innerHTML = dashViewMode === 'list' ? renderDashboard() : renderCalendar();
  }

  function _renderNowProjectView(c, ha, data, bulkMode) {
    const currentProject = getCurrentProject();
    const p = data.projects.find((x) => x.id === currentProject);
    if (!p) {
      setView('dashboard');
      return;
    }
    $('#viewTitle').textContent = p.name;
    $('#viewSub').textContent = '';
    const vm = getProjectViewMode(p.id) || 'list';
    ha.innerHTML = `<div class="view-toggle"><button class="view-toggle-btn ${vm === 'list' ? 'active' : ''}" data-action="project-view-mode" data-project-id="${esc(p.id)}" data-mode="list">List</button><button class="view-toggle-btn ${vm === 'board' ? 'active' : ''}" data-action="project-view-mode" data-project-id="${esc(p.id)}" data-mode="board">Board</button></div><button class="btn btn-sm${bulkMode ? ' btn-active' : ''}" data-action="toggle-bulk" title="Select multiple tasks">\u2630 Bulk</button><button class="btn btn-sm" data-action="open-project-chat" data-project-id="${esc(p.id)}">\u2726 AI</button><button class="btn btn-primary btn-sm" data-action="open-new-task" data-project-id="${esc(p.id)}">+ Task</button><div class="dropdown" style="position:relative"><button class="btn btn-sm" data-action="toggle-dropdown">\u00b7\u00b7\u00b7</button><div class="dropdown-menu"><button data-action="start-focus-project" data-project-id="${esc(p.id)}">\u25ce Focus Mode</button><button data-action="ai-reorganize" data-project-id="${esc(p.id)}">\u2726 Reorganize</button><button data-action="open-edit-project" data-project-id="${esc(p.id)}">Edit Board</button></div></div>`;
    c.innerHTML = renderProject(p);
  }

  function _triggerAutoAI(data, currentView, dashViewMode) {
    const _hasEverBriefed = localStorage.getItem(userKey('wb_has_ever_briefed'));
    const _activeCount = data.tasks.filter((t) => t.status !== 'done' && !t.archived).length;
    const _readyForBriefing = _hasEverBriefed || _activeCount >= 3;
    if (currentView === 'dashboard' && dashViewMode === 'list' && data.tasks.length > 0 && _readyForBriefing) {
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
      (getActiveTagFilter() || '') +
      '|' +
      (getNudgeFilter() || '') +
      '|' +
      getSmartFeedExpanded() +
      '|' +
      getTodayBriefingExpanded() +
      '|' +
      getShowTagFilter() +
      '|' +
      getSectionShowCount('dash') +
      '|' +
      getArchiveShowCount();
    if (contentState === _lastContentState) return;
    _lastContentState = contentState;

    try {
      renderSidebar();
      const c = $('#content');
      const ha = $('#headerActions');

      switch (currentView) {
        case 'dashboard':
          $('#viewTitle').textContent = 'Dashboard';
          _renderNowDashboardView(c, ha, data, bulkMode, dashViewMode);
          break;
        case 'project':
          _renderNowProjectView(c, ha, data, bulkMode);
          break;
        case 'dump':
          $('#viewTitle').textContent = 'Brainstorm';
          $('#viewSub').textContent = 'Write everything on your mind \u2014 AI will do the rest';
          ha.innerHTML = '';
          {
            const _dumpResult = renderDump();
            if (_dumpResult && typeof _dumpResult.then === 'function') {
              c.innerHTML = '';
              _dumpResult.then((html) => {
                c.innerHTML = html;
                initDumpDropZone();
              });
            } else {
              c.innerHTML = _dumpResult;
              initDumpDropZone();
            }
          }
          break;
        case 'review':
          $('#viewTitle').textContent = 'Weekly Review';
          $('#viewSub').textContent = 'Reflect, reset, plan ahead';
          ha.innerHTML = '';
          {
            const _reviewResult = renderWeeklyReview();
            if (_reviewResult && typeof _reviewResult.then === 'function') {
              c.innerHTML = '';
              _reviewResult.then((html) => {
                c.innerHTML = html;
              });
            } else {
              c.innerHTML = _reviewResult;
            }
          }
          break;
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
      _triggerAutoAI(data, currentView, dashViewMode);
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

    // Slash commands
    if (val.startsWith('/')) {
      const handled = handleSlashCommand(val);
      if (handled) {
        e.target.value = '';
        return;
      }
      showToast('Commands: /done, /urgent, /focus, /plan, /move ... to ...', true);
      return;
    }

    // Complex input → open chat panel with the message
    if (isComplexInput(val) && hasAI()) {
      e.target.value = '';
      const panel = document.getElementById('chatPanel');
      if (panel && !panel.classList.contains('open')) toggleChat();
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.value = val;
        sendChat();
      }
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

    // Normal task creation
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
    if (isComplexInput(val)) {
      aiEnhanceTask(newTask.id, val);
    }
  }
  // ===== Dashboard sub-functions =====

  function _renderDashboardHero(data, active, done, inProgress, urgent) {
    let html = '';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const dueToday = active.filter((t) => t.dueDate === todayStr());
    const overdue = active.filter((t) => t.dueDate && t.dueDate < todayStr());

    let subGreeting = '';
    if (overdue.length) subGreeting = `${overdue.length} overdue — let's tackle those first.`;
    else if (urgent.length) subGreeting = `${urgent.length} urgent task${urgent.length > 1 ? 's' : ''} waiting.`;
    else if (dueToday.length) subGreeting = `${dueToday.length} due today.`;
    else if (active.length) subGreeting = `${active.length} tasks across ${data.projects.length} boards.`;
    else subGreeting = 'Nothing pressing. A good day to plan ahead.';

    const statusItems = getAIStatusItems();

    html += `<div class="ai-hero-card">`;
    html += `<div class="ai-hero-greeting">${greeting}</div>`;
    html += `<div class="ai-hero-sub">${subGreeting}${!overdue.length ? ` <span style="color:var(--text3)">${active.length} active · ${inProgress.length} in progress · ${done.length} done</span>` : ''}</div>`;

    if (statusItems.length > 0) {
      html += `<div class="ai-hero-status">`;
      statusItems.forEach((item) => {
        html += `<div class="ai-hero-status-item ai-status-item"><span class="status-icon">${item.icon}</span>${esc(item.text)}</div>`;
      });
      html += `</div>`;
    }

    // Conversational input
    html += `<input class="conversational-input" id="quickCapture" placeholder="Add anything — tasks, notes, ideas..." aria-label="Quick capture input" data-keydown-action="hero-input" data-oninput-action="preview-quick-capture" autocomplete="off">`;
    html += `<div id="quickCapturePreview" class="smart-date-preview" style="padding-left:0"></div>`;
    html += `<div id="brainstormHint" style="display:none;font-size:11px;color:var(--accent);padding:6px 0 0;opacity:0.85;transition:opacity 0.2s"><kbd style="background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;font-family:inherit">Shift+Enter</kbd> &rarr; Organize with AI</div>`;
    const projOpts = data.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    html += `<select class="quick-capture-project" id="quickCaptureProject" style="display:none" aria-label="Select project for quick capture">${projOpts}</select>`;

    html += `</div>`; // end ai-hero-card

    // Brainstorm CTA card (getBrainstormModule is async — guard against unresolved Promise)
    const _brainstorm = getBrainstormModule();
    const _brainstormReady = _brainstorm && typeof _brainstorm.getDumpHistory === 'function';
    const _dumpHistory = _brainstormReady ? _brainstorm.getDumpHistory() : [];
    const _showDumpInvite = _brainstormReady ? _brainstorm.shouldShowDumpInvite() : true;
    let _brainstormStat = '';
    if (_dumpHistory.length > 0) {
      const last = _dumpHistory[0];
      const ago = Math.floor((Date.now() - new Date(last.date).getTime()) / 3600000);
      if (!isNaN(ago)) {
        const agoStr = ago < 1 ? 'just now' : ago < 24 ? ago + 'h ago' : Math.floor(ago / 24) + 'd ago';
        _brainstormStat = `Last: ${last.tasksCreated} task${last.tasksCreated !== 1 ? 's' : ''} from ${last.wordCount} words, ${agoStr}`;
      }
    }
    html += `<div data-action="go-dump" role="button" tabindex="0" class="brainstorm-cta-main" style="background:linear-gradient(135deg,rgba(129,140,248,.06),rgba(168,85,247,.03));border:1px solid ${_showDumpInvite ? 'var(--accent)' : 'rgba(129,140,248,0.2)'};border-radius:var(--radius);padding:20px 24px;cursor:pointer;transition:all 0.2s;margin-bottom:20px;display:flex;align-items:center;gap:16px;${_showDumpInvite ? 'box-shadow:0 0 0 1px rgba(129,140,248,0.1),0 4px 20px rgba(129,140,248,0.08)' : ''}">
      <div style="font-size:28px;flex-shrink:0">&#9671;</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:3px">Ready to brainstorm?</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.4">${_brainstormStat ? esc(_brainstormStat) : 'Write thoughts, paste notes, attach docs — AI extracts tasks, sets deadlines, and sorts by project.'}</div>
      </div>
      <div class="brainstorm-btn-hover" style="flex-shrink:0;font-size:13px;font-weight:600;color:#fff;white-space:nowrap;padding:8px 18px;background:var(--accent);border-radius:var(--radius-sm)">Brainstorm</div>
    </div>`;
    return html;
  }

  function _renderDashboardSmartFeed() {
    let html = '';
    const _nudgeFilter = getNudgeFilter();
    let feedItems = getSmartFeedItems();
    if (_nudgeFilter) {
      const today = todayStr();
      const data = getData();
      const allActive = data.tasks.filter((t) => t.status !== 'done' && !t.archived);
      let filtered = [];
      if (_nudgeFilter === 'overdue') filtered = allActive.filter((t) => t.dueDate && t.dueDate < today);
      else if (_nudgeFilter === 'stale')
        filtered = allActive.filter((t) => {
          const lt = t.updates?.length ? t.updates[t.updates.length - 1].date : t.createdAt;
          return lt && Date.now() - new Date(lt).getTime() > STALE_TASK_DAYS * MS_PER_DAY;
        });
      else if (_nudgeFilter === 'unassigned') filtered = allActive.filter((t) => !t.project);
      if (filtered.length) feedItems = filtered.map((t) => ({ task: t, source: _nudgeFilter }));
    }
    const _smartFeedExpanded = getSmartFeedExpanded();
    const feedLimit = _smartFeedExpanded ? feedItems.length : Math.min(10, feedItems.length);

    if (feedItems.length > 0) {
      html += `<div class="smart-feed">`;
      html += `<div class="smart-feed-header"><div class="smart-feed-title">Your Focus</div><div class="smart-feed-count">${feedItems.length}</div><div class="smart-feed-line"></div></div>`;

      feedItems.slice(0, feedLimit).forEach((item, _i) => {
        html += renderTaskRow(item.task, true);
        if (item.why)
          html += `<div style="margin-left:28px;font-size:11px;color:var(--text3);margin-bottom:4px;margin-top:-4px;font-style:italic">↳ ${esc(item.why)}</div>`;
      });

      if (feedItems.length > 10 && !_smartFeedExpanded) {
        html += `<button class="smart-feed-more" data-action="smart-feed-expand">Show ${feedItems.length - 10} more</button>`;
      } else if (_smartFeedExpanded && feedItems.length > 10) {
        html += `<button class="smart-feed-more" data-action="smart-feed-collapse">Show less</button>`;
      }
      html += `</div>`;
    }
    return html;
  }

  function _renderTodayBriefingAndPlan() {
    let html = '';
    const briefingKey = userKey('whiteboard_briefing_' + todayStr());
    const cachedBriefing = localStorage.getItem(briefingKey);
    const planKey = userKey('whiteboard_plan_' + todayStr());
    const cachedPlan = localStorage.getItem(planKey);
    const _briefingGenerating = getBriefingGenerating();
    const _planGenerating = getPlanGenerating();

    if (!hasAI() || (!cachedBriefing && !cachedPlan && !_briefingGenerating && !_planGenerating)) {
      if (hasAI()) {
        html += `<div class="today-card">
          <div class="today-card-header">
            <span style="font-size:14px">\u2726</span>
            <div class="today-card-title">Today</div>
            <div class="today-card-date">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="briefing-generate" data-action="generate-briefing" id="briefingBtn">\u2726 Generate Briefing</button>
            <button class="briefing-generate" data-action="plan-my-day" id="planBtn" style="color:var(--accent)">\u25ce Plan My Day</button>
          </div>
        </div>`;
      }
      return html;
    }

    html += `<div class="today-card">`;
    html += `<div class="today-card-header">
      <span style="font-size:14px">\u2726</span>
      <div class="today-card-title">Today</div>
      <div class="today-card-date">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
    </div>`;

    const _todayBriefingExpanded = getTodayBriefingExpanded();
    if (cachedBriefing) {
      if (_todayBriefingExpanded) {
        html += `<div class="today-briefing-body" id="briefingBody">${sanitizeAIHTML(cachedBriefing)}</div>`;
        html += `<button class="briefing-generate" data-action="briefing-collapse" style="font-size:11px;margin-top:6px;margin-bottom:8px">Show less</button>`;
      } else {
        html += `<div style="font-size:13px;color:var(--text2);line-height:1.7;max-height:2.8em;overflow:hidden;position:relative;cursor:pointer" data-action="briefing-expand" id="briefingBody">
          ${sanitizeAIHTML(cachedBriefing)}
          <div style="position:absolute;bottom:0;left:0;right:0;height:1.4em;background:linear-gradient(transparent,var(--bg));pointer-events:none"></div>
        </div>`;
        html += `<button class="briefing-generate" data-action="briefing-expand" style="font-size:11px;margin-top:4px;margin-bottom:8px">Read more</button>`;
      }
    } else if (_briefingGenerating) {
      html += `<div class="skeleton-pulse" style="padding:16px 20px;min-height:60px;display:flex;align-items:center;justify-content:center;margin-bottom:8px"><span style="font-size:12px;color:var(--text3)">Generating your briefing...</span></div>`;
    }

    if (cachedPlan) {
      html += _renderDayPlan(cachedPlan, planKey);
    } else if (_planGenerating) {
      html += `<div class="skeleton-pulse" style="padding:16px 20px;min-height:80px;display:flex;align-items:center;justify-content:center">
        <span style="font-size:12px;color:var(--text3)">Planning your day...</span>
      </div>`;
    }

    html += `<div style="display:flex;gap:8px;margin-top:12px">
      <button class="briefing-generate" data-action="generate-briefing" id="briefingBtn">${cachedBriefing ? '\u21bb Refresh' : _briefingGenerating ? '\u2726 Generating...' : '\u2726 Generate Briefing'}</button>
      <button class="briefing-generate" data-action="plan-my-day" id="planBtn" style="color:var(--accent)">\u25ce Plan My Day</button>
    </div>`;

    html += `</div>`;
    return html;
  }

  function _renderDayPlan(cachedPlan, planKey) {
    let html = '';
    try {
      const plan = JSON.parse(cachedPlan);
      const doneCount = plan.filter(
        (p) => p.completedInPlan || (findTask(p.id) && findTask(p.id).status === 'done'),
      ).length;
      const totalCount = plan.filter((p) => findTask(p.id)).length;
      const planMinutes = plan.reduce((sum, p) => {
        const t = findTask(p.id);
        return sum + (t && t.estimatedMinutes ? t.estimatedMinutes : 0);
      }, 0);
      const planTimeStr = planMinutes > 0 ? ` \u00b7 ~${Math.round((planMinutes / 60) * 10) / 10}h` : '';

      html += `<div style="border-top:1px solid rgba(129,140,248,0.1);padding-top:12px;margin-top:8px">`;
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent)">Day Plan</span>
        <span style="font-size:10px;color:${doneCount === totalCount && totalCount > 0 ? 'var(--green)' : 'var(--text3)'}">${doneCount}/${totalCount} done${planTimeStr}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text3);cursor:pointer" data-action="clear-plan" data-plan-key="${planKey}">clear</span>
      </div>`;

      plan.forEach((p, i) => {
        const t = findTask(p.id);
        if (!t) return;
        const isDone = p.completedInPlan || t.status === 'done';
        html += `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:2px;${isDone ? 'text-decoration:line-through;opacity:0.5' : ''}">
          <span style="font-size:11px;color:var(--text3);min-width:18px;padding-top:10px">${i + 1}.</span>
          <div style="flex:1">${renderTaskRow(t, true)}</div>
          ${!isDone ? `<button data-action="snooze-plan-task" data-task-id="${p.id}" class="snooze-btn-hover" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:8px 4px;white-space:nowrap;flex-shrink:0" title="Snooze to tomorrow">snooze</button>` : ''}
        </div>`;
        if (p.why)
          html += `<div style="margin-left:28px;font-size:11px;color:var(--text3);margin-bottom:8px;margin-top:-4px;font-style:italic">\u21b3 ${esc(p.why)}</div>`;
      });
      html += `<div style="margin-top:8px"><button data-action="replan-day" class="briefing-generate" style="color:var(--accent);font-size:11px">\u21bb Replan</button></div>`;
      html += `</div>`;
    } catch (e) {
      console.warn('Plan render failed:', e);
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

  function _renderDashboardToday(data) {
    let html = '';
    html += _renderTodayBriefingAndPlan();
    html += _renderEndOfDay(data);
    return html;
  }

  function _renderDashboardBoards(data) {
    let html = '';
    html += `<div class="section"><div class="section-header"><h3 class="section-title">Boards</h3><div class="section-count">${data.projects.length}</div><div class="section-line"></div></div>`;
    if (data.projects.length === 0) {
      html += `<div class="empty"><div class="empty-icon">◈</div><div class="empty-text">No boards yet. Create one to get started.</div><button class="btn btn-primary" data-action="open-new-project">+ New Board</button></div>`;
    } else {
      html += '<div class="project-grid">';
      data.projects.forEach((p) => {
        const pt = projectTasks(p.id);
        const ptActive = pt.filter((t) => t.status !== 'done');
        const urgentP = ptActive.filter((t) => t.priority === 'urgent');
        const topTasks = sortTasks(ptActive).slice(0, 3);

        html += `<div class="project-grid-card" data-project="${p.id}">
          <div class="project-grid-header">
            <div class="project-grid-dot" style="background:${p.color}"></div>
            <div class="project-grid-name">${esc(p.name)}</div>
          </div>
          <div class="project-grid-stats">
            <div class="project-grid-stat"><strong>${ptActive.length}</strong> active</div>
            ${urgentP.length ? `<div class="project-grid-stat" style="color:var(--red)"><strong>${urgentP.length}</strong> urgent</div>` : ''}
          </div>
          ${topTasks.length ? `<div class="project-grid-tasks">${topTasks.map((t) => `<div class="project-grid-task"><div class="mini-dot" style="background:${priorityColor(t.priority)}"></div>${esc(t.title)}</div>`).join('')}</div>` : ''}
          ${p.description ? `<div class="ai-summary">${esc(p.description).slice(0, DESC_TRUNCATE_SHORT)}${p.description.length > DESC_TRUNCATE_SHORT ? '...' : ''}</div>` : ''}
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
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

  // --- AI Insights: collapsible section consolidating all AI/proactive cards ---
  function _renderAIInsights(data) {
    // Collect all AI insight content
    const parts = [];

    // Stuck tasks
    const _stuckForCard = getStuckTasks();
    if (_stuckForCard.length > 0) {
      let sh = '<div class="stuck-card" style="margin-bottom:0">';
      sh +=
        '<div class="stuck-header"><span style="font-size:14px">&#9888;</span><span class="stuck-title">Stuck Tasks</span><span style="font-size:11px;color:var(--text3);margin-left:auto">' +
        _stuckForCard.length +
        ' task' +
        (_stuckForCard.length > 1 ? 's' : '') +
        '</span></div>';
      _stuckForCard.forEach(function (t) {
        const lastTouch = t.updates && t.updates.length ? t.updates[t.updates.length - 1].date : t.createdAt;
        const days = Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000);
        sh += '<div class="stuck-task-row">';
        sh +=
          '<div class="stuck-task-info"><span class="stuck-task-title">' +
          esc(t.title) +
          '</span><span class="stuck-task-days">' +
          days +
          'd in-progress</span></div>';
        sh += '<div class="stuck-task-actions">';
        sh +=
          '<button class="btn btn-sm" data-action="stuck-help" data-task-id="' +
          t.id +
          '" style="font-size:10px;padding:2px 8px">Get Help</button>';
        sh +=
          '<button class="btn btn-sm" data-action="stuck-breakdown" data-task-id="' +
          t.id +
          '" style="font-size:10px;padding:2px 8px">Break Down</button>';
        sh +=
          '<button class="btn btn-sm" data-action="stuck-reschedule" data-task-id="' +
          t.id +
          '" style="font-size:10px;padding:2px 8px">Reschedule</button>';
        sh += '</div></div>';
      });
      sh += '</div>';
      parts.push(sh);
    }

    // Vague task suggestion
    if (typeof detectVagueTasks === 'function') {
      const vagueTask = detectVagueTasks();
      if (vagueTask) {
        let vh =
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 20px;display:flex;align-items:center;gap:12px">';
        vh += '<span style="font-size:14px;flex-shrink:0">&#9986;</span>';
        vh +=
          '<span style="font-size:12px;color:var(--text2);flex:1">&ldquo;' +
          esc(vagueTask.title.slice(0, 50)) +
          (vagueTask.title.length > 50 ? '...' : '') +
          '&rdquo; seems vague. Break it down?</span>';
        vh +=
          '<button class="btn btn-sm" data-action="breakdown-task" data-task-id="' +
          vagueTask.id +
          '" style="font-size:11px;padding:3px 10px;flex-shrink:0">Break Down</button>';
        vh +=
          '<button class="btn btn-sm" data-action="breakdown-dismiss" data-task-id="' +
          vagueTask.id +
          '" style="font-size:11px;padding:3px 10px;flex-shrink:0;color:var(--text3)">Dismiss</button>';
        vh += '</div>';
        parts.push(vh);
      }
    }

    // Memory insights
    const mic = renderMemoryInsightsCard();
    if (mic) parts.push(mic);

    // Briefing, plan, EOD
    const todayHtml = _renderDashboardToday(data);
    if (todayHtml) parts.push(todayHtml);

    // Nudges (without tag filter — that stays outside)
    const nudgesHtml = _renderDashboardNudgesInner();
    if (nudgesHtml) parts.push(nudgesHtml);

    if (!parts.length) return '';

    // Build summary line for collapsed state
    const summaryItems = [];
    if (_stuckForCard.length > 0) summaryItems.push(_stuckForCard.length + ' stuck');
    const nudges = getSmartNudges();
    if (nudges.length > 0) summaryItems.push(nudges.length + ' nudge' + (nudges.length > 1 ? 's' : ''));
    const briefingKey = userKey('whiteboard_briefing_' + todayStr());
    if (localStorage.getItem(briefingKey)) summaryItems.push('briefing');
    const planKey = userKey('whiteboard_plan_' + todayStr());
    if (localStorage.getItem(planKey)) summaryItems.push('day plan');
    const summaryText = summaryItems.length ? summaryItems.join(', ') : 'AI coaching & insights';

    const expanded = localStorage.getItem(userKey('wb_ai_insights_expanded')) !== 'false';

    let html = '<div class="ai-insights-section" style="margin-bottom:20px">';
    html += `<div class="ai-insights-toggle" data-action="toggle-ai-insights" role="button" tabindex="0" aria-expanded="${expanded}" style="display:flex;align-items:center;gap:8px;padding:10px 0;cursor:pointer;user-select:none">
      <span style="font-size:14px;color:var(--accent)">\u2726</span>
      <span style="font-size:13px;font-weight:600;color:var(--text)">AI Insights</span>
      <span style="font-size:11px;color:var(--text3)">${esc(summaryText)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text3);transition:transform 0.2s${expanded ? ';transform:rotate(90deg)' : ''}">\u25b8</span>
    </div>`;

    if (expanded) {
      html += '<div class="ai-insights-body" style="display:flex;flex-direction:column;gap:12px">';
      html += parts.join('');
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // Inner nudges rendering (without tag/nudge filter UI — those stay at dashboard level)
  function _renderDashboardNudgesInner() {
    let html = '';
    const nudges = getSmartNudges();
    const stuckTasks = getStuckTasks();
    const colorMap = {
      urgent: 'var(--red)',
      warning: 'var(--orange)',
      action: 'var(--accent)',
      positive: 'var(--green)',
      stale: 'var(--text3)',
      habit: 'var(--purple)',
    };

    if (nudges.length > 0 || stuckTasks.length > 0) {
      html += `<div class="ai-hero-nudges">`;
      nudges.forEach((n) => {
        html += `<div class="ai-hero-nudge" style="border-left:3px solid ${colorMap[n.type] || 'var(--accent)'}">
          <span style="flex-shrink:0">${n.icon}</span>
          <span style="font-size:12px;color:var(--text2);line-height:1.4;flex:1">${n.text}</span>
          ${n.actionLabel ? `<button class="btn btn-sm" data-nudge-action="${esc(n.actionFn)}" style="flex-shrink:0;font-size:11px;padding:3px 10px;white-space:nowrap">${n.actionLabel}</button>` : ''}
        </div>`;
      });
      stuckTasks.slice(0, 2).forEach((t) => {
        const lastTouch = t.updates?.length ? t.updates[t.updates.length - 1].date : t.createdAt;
        const days = Math.floor((Date.now() - new Date(lastTouch).getTime()) / MS_PER_DAY);
        html += `<div class="ai-hero-nudge" style="border-left:3px solid var(--amber)">
          <span style="flex-shrink:0">◇</span>
          <span style="font-size:12px;color:var(--text2);line-height:1.4;flex:1">
            <strong>${esc(t.title)}</strong> has been in-progress for ${days} days.
            ${hasAI() ? `<span style="color:var(--accent);cursor:pointer" data-stuck-task-id="${esc(t.id)}">Think through it?</span>` : ''}
          </span>
        </div>`;
      });
      html += `</div>`;
    }
    return html;
  }

  function renderDashboard() {
    const data = getData();
    const urgent = urgentTasks();
    const active = activeTasks();
    const done = doneTasks();
    const inProgress = active.filter((t) => t.status === 'in-progress');

    // Fresh start welcome
    if (data.tasks.length === 0 && data.projects.length <= 1) {
      const _emptyPhrases = [
        'Plan my week...',
        'Meeting notes from today...',
        'Ideas for the project...',
        'Things I need to get done...',
        'Brainstorm everything...',
      ];
      return `<div style="max-width:540px;margin:48px auto;text-align:center">
        <div id="welcomeTyping" style="font-size:22px;font-weight:600;margin-bottom:6px;min-height:32px" data-phrases='${JSON.stringify(_emptyPhrases)}'></div>
        <p style="font-size:14px;color:var(--text3);line-height:1.6;margin-bottom:32px">Write freely &mdash; plans, ideas, meeting notes, anything. AI organizes everything into tasks and projects.</p>
        <div data-action="go-dump" role="button" tabindex="0" class="brainstorm-cta-hover" style="background:var(--surface);border:2px solid var(--accent);border-radius:var(--radius);padding:32px 28px;cursor:pointer;margin-bottom:20px;text-align:left;position:relative">
          <div style="font-size:28px;margin-bottom:12px">&#9671;</div>
          <div style="font-size:17px;font-weight:600;margin-bottom:6px;color:var(--text)">Start a brainstorm</div>
          <div style="font-size:13px;color:var(--text3);line-height:1.6;margin-bottom:16px">Write your thoughts, paste meeting notes, attach docs &mdash; all at once. AI reads everything and creates organized, prioritized tasks.</div>
          <button class="btn btn-primary brainstorm-hero-btn" data-action="go-dump">Open brainstorm &rarr;</button>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:20px">or add a task manually with the input above</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;text-align:left">
          <div data-action="go-dump-weekly" role="button" tabindex="0" class="dashboard-card-hover" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 16px;cursor:pointer">
            <div style="font-size:24px;margin-bottom:10px">&#9671;</div>
            <div style="font-size:13px;font-weight:600;margin-bottom:4px">Plan my week</div>
            <div style="font-size:12px;color:var(--text3);line-height:1.5">Drop your weekly goals and let AI organize them</div>
          </div>
          <div data-action="go-dump" role="button" tabindex="0" class="dashboard-card-hover" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 16px;cursor:pointer">
            <div style="font-size:24px;margin-bottom:10px">&#8623;</div>
            <div style="font-size:13px;font-weight:600;margin-bottom:4px">Import from notes</div>
            <div style="font-size:12px;color:var(--text3);line-height:1.5">Paste meeting notes, docs, or ideas &mdash; AI extracts tasks</div>
          </div>
        </div>
      </div>`;
    }

    let html = '';
    html += _renderDashboardHero(data, active, done, inProgress, urgent);

    // Consolidated AI Insights section (collapsible)
    html += _renderAIInsights(data);

    // Tag & nudge filters (stay at dashboard level, outside AI Insights)
    html += _renderDashboardFilters();

    // Primary content: task feed + boards
    html += _renderDashboardSmartFeed();
    html += _renderDashboardBoards(data);
    return html;
  }

  // Tag and nudge filter controls (extracted from _renderDashboardNudges)
  function _renderDashboardFilters() {
    let html = '';

    // Nudge filter indicator
    const _nudgeFilter = getNudgeFilter();
    if (_nudgeFilter) {
      const nfLabels = { overdue: 'Overdue tasks', stale: 'Stale tasks (10+ days)', unassigned: 'Unassigned tasks' };
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;margin-bottom:12px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-xs)">
        <span style="font-size:12px;color:var(--accent);font-weight:500">Filtering: ${nfLabels[_nudgeFilter] || _nudgeFilter}</span>
        <span style="font-size:11px;color:var(--accent);cursor:pointer;margin-left:auto" data-nudge-action="clearNudgeFilter()">Clear filter</span>
      </div>`;
    }

    // Tag filter
    const allTags = getAllTags();
    const activeTagFilter = getActiveTagFilter();
    if (allTags.length) {
      if (activeTagFilter) {
        html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
          <span style="font-size:10px;color:var(--text3);margin-right:4px">Tag:</span>
          <span class="tag-chip tag-filter-btn selected" style="background:${getTagColor(activeTagFilter).bg};color:${getTagColor(activeTagFilter).color};font-size:10px" data-tag="${esc(activeTagFilter)}">${esc(activeTagFilter)}</span>
          <span style="font-size:10px;color:var(--accent);cursor:pointer;margin-left:4px" data-action="clear-tag-filter">\u2715 clear</span>
        </div>`;
      } else {
        const _showTagFilterVal = getShowTagFilter();
        html += `<div style="margin-bottom:8px"><span data-action="toggle-tag-filter" style="font-size:10px;color:var(--text3);cursor:pointer;user-select:none">${_showTagFilterVal ? '\u25be' : '\u25b8'} Filter by tag</span></div>`;
        if (_showTagFilterVal) {
          html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
            ${allTags
              .map((tag) => {
                const c = getTagColor(tag);
                return `<span class="tag-chip tag-filter-btn" style="background:${c.bg};color:${c.color};font-size:10px" data-tag="${esc(tag)}">${esc(tag)}</span>`;
              })
              .join('')}
          </div>`;
        }
      }
    }
    return html;
  }

  // Expose setPlanIndexCache for proactive module
  function setPlanIndexCache(cache, date) {
    _planIndexCache = cache;
    _planIndexDate = date;
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
  };
}
