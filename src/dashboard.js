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
    // Proactive module
    getAIStatusItems: _getAIStatusItems,
    getSmartNudges,
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
    getTodayBriefingExpanded,
    getShowTagFilter,
    getActiveTagFilter,
    getAllTags,
    getTagColor,
    // Render helpers
    renderDump,
    initDumpDropZone,
    renderWeeklyReview,
    // Quick capture
    parseQuickInput,
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
        return `<div class="project-nav-item ${active ? 'active' : ''}" data-project="${p.id}">
        <div class="project-dot" style="background:${p.color}"></div>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
        ${count > 0 ? `<span class="project-nav-count">${count}</span>` : ''}
        ${hasOverdue ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--red);flex-shrink:0" title="Has overdue tasks" aria-label="Has overdue tasks"></div>' : ''}
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

  function _renderNowDashboardView(c, ha, data, _bulkMode, dashViewMode) {
    const _estTotal = activeTasks().reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
    const _estStr = _estTotal > 0 ? ` \u00b7 ~${Math.round((_estTotal / 60) * 10) / 10}h estimated` : '';
    $('#viewSub').textContent = `${activeTasks().length} active tasks across ${data.projects.length} boards${_estStr}`;
    ha.innerHTML = `<button class="btn btn-sm" data-action="toggle-chat"><span class="ai-badge" style="font-size:9px;width:20px;height:20px;display:inline-flex;vertical-align:middle;margin-right:4px">ai</span>Ask</button><button class="btn btn-primary btn-sm" data-action="new-project">+ Board</button>`;
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
      getTodayBriefingExpanded() +
      '|' +
      getShowTagFilter() +
      '|' +
      getSectionShowCount('dash') +
      '|' +
      getArchiveShowCount() +
      '|' +
      (getExpandedTask() || '');
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
          $('#viewTitle').textContent = 'Dashboard';
          _renderNowDashboardView(c, ha, data, bulkMode, dashViewMode);
          break;
        case 'project':
          _renderNowProjectView(c, ha, data, bulkMode);
          break;
        case 'dump':
          // Brainstorm opens as modal — redirect back to dashboard
          setView('dashboard');
          openBrainstormModal();
          return;
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

    // Shift+Enter → open brainstorm modal with the text
    if (e.shiftKey) {
      e.target.value = '';
      openBrainstormModal();
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

  function _renderDashboardHero(data, active, _done, _inProgress, _urgent) {
    let html = '';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const dueToday = active.filter((t) => t.dueDate === todayStr());
    const overdue = active.filter((t) => t.dueDate && t.dueDate < todayStr());

    // Brief status line
    const statusParts = [];
    if (overdue.length) statusParts.push(`${overdue.length} overdue`);
    if (dueToday.length) statusParts.push(`${dueToday.length} due today`);
    if (!overdue.length && !dueToday.length) {
      if (active.length) statusParts.push(`${active.length} active tasks`);
      else statusParts.push('No tasks yet');
    }
    // Next upcoming deadline
    const upcoming = active
      .filter((t) => t.dueDate && t.dueDate > todayStr())
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (upcoming.length && !overdue.length) {
      statusParts.push(
        `next: ${esc(upcoming[0].title.slice(0, 25))}${upcoming[0].title.length > 25 ? '...' : ''} ${fmtDate(upcoming[0].dueDate)}`,
      );
    }
    const briefStatus = statusParts.join(' \u00b7 ');

    html += `<div class="ai-hero-card">`;
    html += `<div class="ai-hero-greeting">${greeting}</div>`;
    html += `<div class="ai-hero-sub">${briefStatus}</div>`;

    // Simple task input
    html += `<input class="conversational-input" id="quickCapture" placeholder="Add a task..." aria-label="Add a task" data-keydown-action="hero-input" data-oninput-action="preview-quick-capture" autocomplete="off">`;
    html += `<div id="quickCapturePreview" class="smart-date-preview" style="padding-left:0"></div>`;
    html += `<div id="brainstormHint" style="display:none;font-size:11px;color:var(--accent);padding:6px 0 0;opacity:0.85;transition:opacity 0.2s"><kbd style="background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;font-family:inherit">Shift+Enter</kbd> &rarr; Organize with AI</div>`;
    const projOpts = data.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    html += `<select class="quick-capture-project" id="quickCaptureProject" style="display:none" aria-label="Select project for quick capture">${projOpts}</select>`;

    html += `</div>`; // end ai-hero-card
    return html;
  }

  // ===== Day Plan Centerpiece =====

  function _renderDayPlanCenterpiece() {
    let html = '';
    const planKey = userKey('whiteboard_plan_' + todayStr());
    const cachedPlan = localStorage.getItem(planKey);
    const _planGenerating = getPlanGenerating();
    const briefingKey = userKey('whiteboard_briefing_' + todayStr());
    const cachedBriefing = localStorage.getItem(briefingKey);
    const _briefingGenerating = getBriefingGenerating();

    if (cachedPlan) {
      html += _renderDayPlanActive(cachedPlan, planKey);
      html += _renderBriefingToggle(cachedBriefing, _briefingGenerating);
      return html;
    }

    if (_planGenerating) {
      html += `<div class="day-plan-centerpiece" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px">`;
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:16px;color:var(--accent)">\u25ce</span>
        <span style="font-size:15px;font-weight:600;color:var(--text)">Today's Plan</span>
        <span style="font-size:11px;color:var(--text3)">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>`;
      html += `<div class="skeleton-pulse" style="padding:20px;min-height:100px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm)">
        <span style="font-size:13px;color:var(--text3)">Planning your day...</span>
      </div></div>`;
      html += _renderBriefingToggle(cachedBriefing, _briefingGenerating);
      return html;
    }

    const dismissed = localStorage.getItem(userKey('whiteboard_plan_dismissed_' + todayStr()));
    if (!dismissed) {
      html += _renderNoPlanState();
    }
    html += _renderBriefingToggle(cachedBriefing, _briefingGenerating);
    return html;
  }

  function _renderDayPlanActive(cachedPlan, planKey) {
    let html = '';
    try {
      const plan = JSON.parse(cachedPlan);
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

      // Remaining time from incomplete tasks
      const remainingMinutes = activePlanItems.reduce((sum, p) => {
        return sum + (p._task.estimatedMinutes || 0);
      }, 0);
      const remainingStr =
        remainingMinutes > 0 ? ` \u00b7 ~${Math.round((remainingMinutes / 60) * 10) / 10}h remaining` : '';

      // Progress bar
      const allDone = doneCount === totalCount && totalCount > 0;
      const barFilled = totalCount > 0 ? Math.round((doneCount / totalCount) * 10) : 0;
      const barEmpty = 10 - barFilled;
      const barText = '\u2588'.repeat(barFilled) + '\u2591'.repeat(barEmpty);

      html += `<div class="day-plan-centerpiece" style="background:var(--surface);border:1px solid ${allDone ? 'var(--green)' : 'var(--accent)'};border-radius:var(--radius);padding:24px;margin-bottom:20px">`;

      // Header
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:16px;color:${allDone ? 'var(--green)' : 'var(--accent)'}">\u25ce</span>
        <span style="font-size:15px;font-weight:600;color:var(--text)">Today's Plan</span>
        <span style="font-size:11px;color:var(--text3)">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text3);cursor:pointer" data-action="clear-plan" data-plan-key="${planKey}" role="button" tabindex="0" aria-label="Clear plan">clear</span>
      </div>`;

      // Progress bar
      html += `<div style="margin-bottom:16px">
        <div style="font-family:monospace;font-size:13px;color:${allDone ? 'var(--green)' : 'var(--accent)'};letter-spacing:1px;margin-bottom:4px">${barText}</div>
        <div style="font-size:12px;color:${allDone ? 'var(--green)' : 'var(--text2)'}">${doneCount}/${totalCount} done${remainingStr}${allDone ? ' \u2014 great work!' : ''}</div>
      </div>`;

      // Active tasks in plan order
      const _expandedTask = getExpandedTask();
      activePlanItems.forEach((p) => {
        const t = p._task;
        const isExpanded = _expandedTask === t.id;

        if (isExpanded) {
          // Show full expanded view inline
          html += renderTaskExpanded(t, true);
        } else {
          const priorityBadge =
            t.priority === 'urgent' || t.priority === 'important' ? renderPriorityTag(t.priority) : '';
          const dueDateStr = t.dueDate
            ? ` <span class="tag tag-date" style="font-size:10px">${fmtDate(t.dueDate)}</span>`
            : '';
          const recurIcon = t.recurrence
            ? ' <span title="Recurring: ' +
              esc(t.recurrence) +
              '" style="font-size:11px;color:var(--text3)">\u21bb</span>'
            : '';
          const subtaskInfo =
            t.subtasks && t.subtasks.length
              ? ` <span style="font-size:10px;color:var(--text3)">(${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length})</span>`
              : '';

          html += `<div class="plan-task-row">
            <div class="task-check" data-action="complete-task" data-task-id="${t.id}" role="checkbox" aria-checked="false" tabindex="0" aria-label="Mark ${esc(t.title)} done" style="flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <span style="font-size:13px;color:var(--text);cursor:pointer" data-action="toggle-expand" data-task="${t.id}">${esc(t.title)}</span>
              ${priorityBadge}${dueDateStr}${recurIcon}${subtaskInfo}
            </div>
            <button data-action="snooze-plan-task" data-task-id="${p.id}" class="snooze-btn-hover" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:4px 8px;white-space:nowrap;flex-shrink:0;border-radius:var(--radius-xs);transition:all 0.15s" title="Snooze to tomorrow">\u2192 tomorrow</button>
          </div>`;
          if (p.why)
            html += `<div style="margin-left:34px;font-size:11px;color:var(--text3);margin-bottom:6px;margin-top:-2px;font-style:italic">\u21b3 ${esc(p.why)}</div>`;
        }
      });

      // Completed tasks (collapsed at bottom)
      if (completedPlanItems.length > 0) {
        html += `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:4px;cursor:pointer;user-select:none" data-action="toggle-completed" data-key="plan-done">${getShowCompleted('plan-done') ? '\u25be' : '\u25b8'} Completed (${completedPlanItems.length})</div>`;
        if (getShowCompleted('plan-done')) {
          completedPlanItems.forEach((p) => {
            const t = p._task;
            html += `<div style="display:flex;align-items:center;gap:10px;padding:4px;opacity:0.45">
              <div class="task-check done" style="flex-shrink:0"></div>
              <span style="font-size:12px;color:var(--text3);text-decoration:line-through;flex:1">${esc(t.title)}</span>
            </div>`;
          });
        }
        html += `</div>`;
      }

      // Footer actions
      html += `<div style="display:flex;gap:8px;margin-top:12px;align-items:center">
        <button data-action="replan-day" class="briefing-generate" style="color:var(--accent);font-size:11px">\u21bb Replan</button>
        <button data-action="add-to-plan" class="briefing-generate" style="font-size:11px">+ Add to plan</button>
      </div>`;

      html += `</div>`;
    } catch (e) {
      console.warn('Plan render failed:', e);
    }
    return html;
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
      html += `<div data-action="briefing-expand" role="button" tabindex="0" style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;padding:6px 0">
        <span style="font-size:12px;color:var(--text3);transition:transform 0.2s${_todayBriefingExpanded ? ';transform:rotate(90deg)' : ''}">\u25b8</span>
        <span style="font-size:12px;color:var(--text3)">\uD83D\uDCCB Show today's briefing</span>
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

  function renderDashboard() {
    const data = getData();
    const urgent = urgentTasks();
    const active = activeTasks();
    const done = doneTasks();
    const inProgress = active.filter((t) => t.status === 'in-progress');

    // Fresh start welcome — clean and simple
    if (data.tasks.length === 0 && data.projects.length <= 1) {
      return `<div style="max-width:480px;margin:60px auto;text-align:center">
        <div style="font-size:28px;margin-bottom:8px">\u25ce</div>
        <div style="font-size:20px;font-weight:600;margin-bottom:8px;color:var(--text)">What are you working on?</div>
        <p style="font-size:14px;color:var(--text3);line-height:1.6;margin-bottom:28px">Type a task above to get started, or dump everything on your mind at once.</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" data-action="go-dump" style="padding:10px 20px">Brain dump \u2192</button>
          <button class="btn" data-action="go-dump-weekly" style="padding:10px 20px">Plan my week</button>
        </div>
      </div>`;
    }

    let html = '';

    // Plan FIRST — the main thing you see when you open the app
    html += _renderDashboardPlanFirst(data);

    // Then the input + status
    html += _renderDashboardHero(data, active, done, inProgress, urgent);

    // Tag & nudge filters
    html += _renderDashboardFilters();

    // Nudges → toast only
    _showNudgeAsToast();

    return html;
  }

  // === Plan-first dashboard: day plan centerpiece is the main content ===
  function _renderDashboardPlanFirst(data) {
    let html = '';
    html += _renderDayPlanCenterpiece();
    html += _renderEndOfDay(data);
    return html;
  }

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
          <span style="font-size:10px;color:var(--accent);cursor:pointer;margin-left:4px" data-action="clear-tag-filter" role="button" tabindex="0" aria-label="Clear tag filter">\u2715 clear</span>
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
  };
}
