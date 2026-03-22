// ============================================================
// CALENDAR VIEW MODULE
// ============================================================
// Extracted from app.js — renders week/month calendar views

/**
 * Factory function to create calendar rendering functions.
 * @param {Object} deps - Dependencies from the main app
 * @param {Function} deps.localISO - Convert Date to ISO date string
 * @param {Function} deps.esc - HTML-escape a string
 * @param {Function} deps.sortTasks - Sort tasks array
 * @param {Object} deps.PRIORITY_ORDER - Priority ordering map
 * @param {Function} deps.render - Trigger a full re-render
 * @param {Function} deps.fmtDate - Format a date string
 * @param {Function} deps.findTask - Find a task by ID
 * @param {Function} deps.getData - Returns the current data object ({ tasks, projects })
 * @param {Function} deps.getDashViewMode - Returns current dashViewMode ('list'|'week'|'month')
 * @param {Function} deps.getExpandedTask - Returns currently expanded task ID or null
 * @param {Function} deps.renderTaskExpanded - Render expanded task detail HTML
 * @param {Function} deps.renderTaskRow - Render a task row HTML
 * @returns {{ renderCalendar: Function, calNav: Function, calToday: Function, getState: Function, setExpandedDay: Function, resetOffset: Function }}
 */
export function createCalendar(deps) {
  const {
    localISO,
    esc,
    sortTasks,
    PRIORITY_ORDER,
    render,
    findTask,
    getData,
    getDashViewMode,
    getExpandedTask,
    renderTaskExpanded,
    renderTaskRow,
  } = deps;

  // Module-local state
  let calendarOffset = 0;
  let calendarExpandedDay = null;

  function calNav(dir) {
    calendarOffset += dir;
    render();
  }

  function calToday() {
    calendarOffset = 0;
    render();
  }

  function setExpandedDay(date) {
    calendarExpandedDay = date;
  }

  function resetOffset() {
    calendarOffset = 0;
  }

  function renderCalendar() {
    const data = getData();
    const dashViewMode = getDashViewMode();
    const expandedTask = getExpandedTask();

    const isWeek = dashViewMode === 'week';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = localISO(today);

    // Compute the anchor date based on offset
    const anchor = new Date(today);
    if (isWeek) {
      anchor.setDate(anchor.getDate() + calendarOffset * 7);
    } else {
      anchor.setMonth(anchor.getMonth() + calendarOffset);
    }

    // Determine date range to display
    let startDate, endDate, periodLabel;
    if (isWeek) {
      // Start of week (Sunday)
      startDate = new Date(anchor);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      periodLabel = `${fmt(startDate)} — ${fmt(endDate)}, ${endDate.getFullYear()}`;
    } else {
      // Full month grid
      const year = anchor.getFullYear(),
        month = anchor.getMonth();
      const firstOfMonth = new Date(year, month, 1);
      const lastOfMonth = new Date(year, month + 1, 0);
      startDate = new Date(firstOfMonth);
      startDate.setDate(startDate.getDate() - startDate.getDay()); // back to Sunday
      endDate = new Date(lastOfMonth);
      endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // forward to Saturday
      periodLabel = anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    // Build date->tasks map
    const tasksByDate = {};
    data.tasks.forEach((t) => {
      if (!t.dueDate || t.archived) return;
      if (!tasksByDate[t.dueDate]) tasksByDate[t.dueDate] = [];
      tasksByDate[t.dueDate].push(t);
    });

    // Navigation header
    let html = `<div class="cal-header">
    <div class="cal-nav">
      <button class="cal-nav-btn" data-action="cal-nav" data-dir="-1">‹</button>
      <div class="cal-period">${periodLabel}</div>
      <button class="cal-nav-btn" data-action="cal-nav" data-dir="1">›</button>
    </div>
    ${calendarOffset !== 0 ? '<button class="cal-today-btn" data-action="cal-today">Today</button>' : ''}
  </div>`;

    // Day-of-week headers
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    html += `<div class="cal-grid${isWeek ? ' week-view' : ''}">`;
    dows.forEach((d) => {
      html += `<div class="cal-dow">${d}</div>`;
    });

    // Cells
    const cursor = new Date(startDate);
    const anchorMonth = isWeek ? -1 : anchor.getMonth();
    const MAX_VISIBLE = isWeek ? 10 : 3;

    while (cursor <= endDate) {
      const iso = localISO(cursor);
      const isToday = iso === todayISO;
      const isOutside = !isWeek && cursor.getMonth() !== anchorMonth;
      const tasks = tasksByDate[iso] || [];
      const sorted = tasks.sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        return (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
      });

      const isExpanded = calendarExpandedDay === iso;
      const visibleLimit = isExpanded ? sorted.length : MAX_VISIBLE;
      html += `<div class="cal-cell${isToday ? ' today' : ''}${isOutside ? ' outside' : ''}" data-action="cal-new-task" data-date="${iso}" role="button" tabindex="0" aria-label="${cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — click to add task" style="cursor:pointer">`;
      html += `<div class="cal-day-num">${cursor.getDate()}</div>`;

      sorted.slice(0, visibleLimit).forEach((t) => {
        const proj = data.projects.find((p) => p.id === t.project);
        const priClass =
          t.status !== 'done' && (t.priority === 'urgent' || t.priority === 'important') ? ` pri-${t.priority}` : '';
        const doneClass = t.status === 'done' ? ' done' : '';
        html += `<div class="cal-task${priClass}${doneClass}" data-action="toggle-expand" data-task-id="${t.id}" role="button" tabindex="0" title="${esc(t.title)}${proj ? ' — ' + esc(proj.name) : ''}">`;
        if (proj)
          html += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${proj.color};margin-right:3px;vertical-align:middle" title="${esc(proj.name)}" aria-hidden="true"></span>`;
        html += `${esc(t.title)}</div>`;
      });

      if (sorted.length > MAX_VISIBLE) {
        if (isExpanded) {
          html += `<div class="cal-task-more" data-action="cal-collapse" role="button" tabindex="0">Show less</div>`;
        } else {
          html += `<div class="cal-task-more" data-action="cal-expand" data-date="${iso}" role="button" tabindex="0">+${sorted.length - MAX_VISIBLE} more</div>`;
        }
      }

      html += `</div>`;
      cursor.setDate(cursor.getDate() + 1);
    }
    html += `</div>`;

    // Mobile agenda view for month (replaces grid on screens under 480px via CSS)
    if (!isWeek) {
      html += `<div class="cal-agenda-mobile">`;
      const mStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const mEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      const ac = new Date(mStart);
      let hasAnyTasks = false;
      while (ac <= mEnd) {
        const aiso = localISO(ac);
        const aTasks = tasksByDate[aiso] || [];
        if (aTasks.length > 0) {
          hasAnyTasks = true;
          const aIsToday = aiso === todayISO;
          const dayLabel = ac.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          html += `<div style="margin-top:12px">`;
          html += `<div style="font-size:12px;font-weight:600;color:${aIsToday ? 'var(--accent)' : 'var(--text2)'};margin-bottom:6px;padding:4px 0;border-bottom:1px solid var(--border)">${dayLabel}${aIsToday ? ' (Today)' : ''}</div>`;
          aTasks.sort((a, b) => {
            if (a.status === 'done' && b.status !== 'done') return 1;
            if (a.status !== 'done' && b.status === 'done') return -1;
            return (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
          });
          aTasks.forEach((t) => {
            const proj = data.projects.find((p) => p.id === t.project);
            const doneStyle = t.status === 'done' ? 'text-decoration:line-through;color:var(--text3)' : '';
            const priDot =
              t.priority === 'urgent'
                ? '<span style="color:var(--red);margin-right:4px" title="Urgent" aria-label="Urgent">&#9679;</span>'
                : t.priority === 'important'
                  ? '<span style="color:var(--orange);margin-right:4px" title="Important" aria-label="Important">&#9679;</span>'
                  : '';
            html += `<div style="padding:6px 8px;font-size:13px;cursor:pointer;border-radius:var(--radius-xs);${doneStyle}" data-action="toggle-expand" data-task-id="${t.id}" role="button" tabindex="0">`;
            html += priDot;
            if (proj)
              html += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${proj.color};margin-right:5px;vertical-align:middle" title="${esc(proj.name)}" aria-hidden="true"></span>`;
            html += `${esc(t.title)}</div>`;
          });
          html += `</div>`;
        }
        ac.setDate(ac.getDate() + 1);
      }
      if (!hasAnyTasks) {
        html += `<div style="text-align:center;padding:32px 0;color:var(--text3);font-size:13px">No tasks scheduled this month</div>`;
      }
      html += `</div>`;
    }

    // Expanded task detail below calendar
    if (expandedTask) {
      const et = findTask(expandedTask);
      if (et) {
        html += `<div style="margin-top:16px">${renderTaskExpanded(et, true)}</div>`;
      }
    }

    // Unscheduled tasks section
    const unscheduled = data.tasks.filter((t) => !t.dueDate && t.status !== 'done');
    if (unscheduled.length > 0) {
      html += `<div class="section" style="margin-top:24px"><div class="section-header"><h2 class="section-title">Unscheduled</h2><div class="section-count">${unscheduled.length}</div><div class="section-line"></div></div>`;
      html += `<div style="font-size:11px;color:var(--text3);margin-bottom:10px">Tasks without a due date</div>`;
      sortTasks(unscheduled)
        .slice(0, 10)
        .forEach((t) => {
          html += renderTaskRow(t, true);
        });
      if (unscheduled.length > 10)
        html += `<div style="font-size:11px;color:var(--text3);padding:8px 0">+${unscheduled.length - 10} more unscheduled tasks</div>`;
      html += `</div>`;
    }

    return html;
  }

  function getState() {
    return { calendarOffset, calendarExpandedDay };
  }

  return {
    renderCalendar,
    calNav,
    calToday,
    getState,
    setExpandedDay,
    resetOffset,
  };
}
