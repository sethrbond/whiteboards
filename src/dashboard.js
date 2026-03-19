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
    setNudgeFilter,
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
      // Due date: no-date first (needs attention), then chronological
      const aDate = a.dueDate || '';
      const bDate = b.dueDate || '';
      if (aDate && !bDate) return 1;
      if (!aDate && bDate) return -1;
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

  function _renderNowDashboardView(c, ha, _data, _bulkMode, dashViewMode) {
    $('#viewSub').textContent = '';
    ha.innerHTML = `<button class="btn btn-sm" data-action="toggle-chat"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span>Ask</button><button class="btn btn-primary btn-sm" data-action="new-project">+ Board</button>`;
    c.innerHTML = renderDashboard();
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
    ha.innerHTML = `<div class="view-toggle"><button class="view-toggle-btn ${vm === 'list' ? 'active' : ''}" data-action="project-view-mode" data-project-id="${esc(p.id)}" data-mode="list">List</button><button class="view-toggle-btn ${vm === 'board' ? 'active' : ''}" data-action="project-view-mode" data-project-id="${esc(p.id)}" data-mode="board">Board</button></div><button class="btn btn-sm" data-action="open-project-chat" data-project-id="${esc(p.id)}"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span>Ask</button><button class="btn btn-primary btn-sm" data-action="open-new-task" data-project-id="${esc(p.id)}">+ Task</button><div class="dropdown" style="position:relative"><button class="btn btn-sm" data-action="toggle-dropdown">\u00b7\u00b7\u00b7</button><div class="dropdown-menu"><button data-action="start-focus-project" data-project-id="${esc(p.id)}">\u25ce Focus Mode</button><button data-action="ai-reorganize" data-project-id="${esc(p.id)}"><span class="ai-badge" style="margin-right:4px" aria-hidden="true">ai</span> Reorganize</button><button data-action="open-edit-project" data-project-id="${esc(p.id)}">Edit Board</button></div></div>`;
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
      getTodayBriefingExpanded() +
      '|' +
      getSectionShowCount('dash') +
      '|' +
      getArchiveShowCount() +
      '|' +
      (getExpandedTask() || '') +
      '|' +
      (localStorage.getItem(userKey('whiteboard_plan_' + todayStr())) || '').length +
      '|' +
      (localStorage.getItem(userKey('whiteboard_briefing_' + todayStr())) || '').length +
      '|' +
      (currentView === 'calendar' ? Date.now() : ''); // calendar always re-renders (offset changes)
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
          _renderNowProjectView(c, ha, data);
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
      </div>`;

      // Progress bar
      html += `<div style="margin-bottom:16px">
        <div style="font-family:monospace;font-size:13px;color:${allDone ? 'var(--green)' : 'var(--accent)'};letter-spacing:1px;margin-bottom:4px">${barText}</div>
        <div style="font-size:12px;color:${allDone ? 'var(--green)' : 'var(--text2)'}">${doneCount}/${totalCount} done${remainingStr}${allDone ? ' \u2014 great work!' : ''}</div>
      </div>`;

      // Adaptive status — changes throughout the day
      const _hour = new Date().getHours();
      const _pct = totalCount > 0 ? doneCount / totalCount : 0;
      let _adaptiveMsg = '';
      if (allDone) {
        _adaptiveMsg = 'Plan complete. Add more or enjoy your day.';
      } else if (_hour >= 15 && _pct < 0.3) {
        _adaptiveMsg = `Behind schedule \u2014 consider moving ${activePlanItems.length > 2 ? 'some tasks' : 'a task'} to tomorrow.`;
      } else if (_hour >= 12 && _pct >= 0.6) {
        _adaptiveMsg = 'Ahead of pace \u2014 great momentum.';
      } else if (_hour < 12 && _pct >= 0.5) {
        _adaptiveMsg = 'Strong morning \u2014 keep it going.';
      } else if (_hour >= 17 && _pct < 0.5) {
        _adaptiveMsg = 'End of day \u2014 move unfinished items to tomorrow?';
      }
      if (_adaptiveMsg) {
        html += `<div style="font-size:11px;color:var(--text3);margin-bottom:12px;font-style:italic">${_adaptiveMsg}</div>`;
      }

      // Active tasks in plan order
      html += `<div role="list" aria-label="Today's plan tasks">`;
      const _expandedTask = getExpandedTask();
      activePlanItems.forEach((p, i) => {
        const t = p._task;
        const isExpanded = _expandedTask === t.id;

        if (isExpanded) {
          // Show full expanded view inline
          try {
            html += renderTaskExpanded(t, true);
          } catch (_expandErr) {
            console.warn('Task expand failed:', _expandErr);
            html += `<div style="padding:8px;color:var(--red);font-size:12px">Error rendering task details</div>`;
          }
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

          html += `<div class="plan-task-row" draggable="true" data-plan-drag="${p.id}" data-plan-index="${i}" role="listitem">
            <div class="plan-reorder-btns" style="display:flex;flex-direction:column;gap:0;flex-shrink:0;opacity:0.3;transition:opacity 0.15s">
              ${i > 0 ? `<button class="subtask-action" data-action="plan-move-up" data-plan-index="${i}" aria-label="Move up" style="font-size:8px;padding:0 3px;line-height:1">\u25b2</button>` : '<div style="width:16px;height:10px"></div>'}
              ${i < activePlanItems.length - 1 ? `<button class="subtask-action" data-action="plan-move-down" data-plan-index="${i}" aria-label="Move down" style="font-size:8px;padding:0 3px;line-height:1">\u25bc</button>` : '<div style="width:16px;height:10px"></div>'}
            </div>
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
      html += `</div>`; // close role="list"

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

  function renderDashboard() {
    const data = getData();
    const active = activeTasks();

    // First-time onboarding — teach by doing
    if (data.tasks.length === 0 && data.projects.length <= 1) {
      return `<div style="max-width:520px;margin:40px auto">
        <div style="font-size:20px;font-weight:600;margin-bottom:6px;color:var(--text)">Drop everything here.</div>
        <p style="font-size:14px;color:var(--text3);line-height:1.6;margin-bottom:20px">Meeting notes, plans, ideas, to-do lists, a PDF \u2014 paste it all in. AI reads it and creates organized tasks and boards for you.</p>
        <textarea id="onboardDump" aria-label="Brain dump — paste notes, ideas, plans" style="width:100%;min-height:140px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;font-size:14px;color:var(--text);font-family:inherit;resize:vertical;outline:none;line-height:1.6;box-sizing:border-box" placeholder="Paste meeting notes, write your thoughts, list everything on your mind..."></textarea>
        <div style="display:flex;gap:12px;margin-top:12px;align-items:center">
          <button class="btn btn-primary" data-action="onboard-process" style="padding:10px 20px">Organize this \u2192</button>
          <span style="font-size:12px;color:var(--text3)">or <span style="color:var(--accent);cursor:pointer" data-action="go-dump">attach files</span> \u00b7 <span style="color:var(--accent);cursor:pointer" data-action="onboard-skip">skip, I'll add tasks manually</span></span>
        </div>
      </div>`;
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const overdue = active.filter((t) => t.dueDate && t.dueDate < todayStr());
    const dueToday = active.filter((t) => t.dueDate === todayStr());

    let html = '';

    // Minimal header: greeting + status in one line
    const statusBits = [];
    if (overdue.length) statusBits.push(`${overdue.length} overdue`);
    if (dueToday.length) statusBits.push(`${dueToday.length} due today`);
    if (!statusBits.length && active.length) statusBits.push(`${active.length} active`);
    html += `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px">
      <h2 style="font-size:16px;font-weight:600;color:var(--text);margin:0">${greeting}</h2>
      <span style="font-size:12px;color:var(--text3)">${statusBits.join(' \u00b7 ')}</span>
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
  };
}
