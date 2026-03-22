// ============================================================
// DEADLINE ESCALATION ENGINE
// ============================================================
// Monitors tasks for approaching deadlines, overdue pileups,
// behind-pace day plans, and stuck tasks. Shows persistent
// escalation banners at the top of the dashboard.

import {
  MS_PER_DAY,
  ESCALATION_INTERVAL_MS,
  ESCALATION_COOLDOWN_MS,
  DEADLINE_IMMINENT_HOURS,
  OVERDUE_PILEUP_THRESHOLD,
  STUCK_THRESHOLD_HOURS,
  DAY_PLAN_BEHIND_THRESHOLD,
} from './constants.js';

const RENDER_DEBOUNCE_MS = 300_000; // 5 minutes

/**
 * Factory function to create escalation engine.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ startEscalationLoop, stopEscalationLoop, runEscalationCheck, maybeCheckOnRender, dismissEscalation, renderEscalationBanner, handleEscalationAction, getCurrentEscalation, getDismissedMap }}
 */
export function createEscalation(deps) {
  const { getData, findTask, updateTask, render, showToast, startFocus, todayStr, userKey } = deps;

  let _intervalId = null;
  /** @type {Map<string, number>} escalation key -> timestamp of dismissal */
  const _dismissed = new Map();
  /** @type {{ type: string, data: object } | null} */
  let _currentEscalation = null;
  let _lastRenderCheck = 0;

  // ── Loop control ────────────────────────────────────────────

  function startEscalationLoop() {
    if (_intervalId) return;
    // Run an initial check after a short delay so the app has time to load
    setTimeout(() => runEscalationCheck(), 2000);
    _intervalId = setInterval(() => runEscalationCheck(), ESCALATION_INTERVAL_MS);
  }

  function stopEscalationLoop() {
    if (_intervalId) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    _currentEscalation = null;
    _dismissed.clear();
  }

  // ── Debounced check for render() calls ──────────────────────

  function maybeCheckOnRender() {
    const now = Date.now();
    if (now - _lastRenderCheck < RENDER_DEBOUNCE_MS) return;
    _lastRenderCheck = now;
    runEscalationCheck();
  }

  // ── Core check logic ───────────────────────────────────────

  function runEscalationCheck() {
    _lastRenderCheck = Date.now();
    _purgeExpiredDismissals();

    // Priority order — pick the first match
    const escalation =
      _checkDeadlineImminent() || _checkOverduePileup() || _checkDayPlanBehind() || _checkStuckTooLong();

    _currentEscalation = escalation;
  }

  function _purgeExpiredDismissals() {
    const now = Date.now();
    for (const [key, ts] of _dismissed) {
      if (now - ts > ESCALATION_COOLDOWN_MS) _dismissed.delete(key);
    }
  }

  function _isDismissed(key) {
    return _dismissed.has(key);
  }

  // ── 1. Deadline Imminent ────────────────────────────────────

  function _checkDeadlineImminent() {
    const now = Date.now();
    const thresholdMs = DEADLINE_IMMINENT_HOURS * 3600_000;
    const data = getData();
    const tasks = data.tasks.filter((t) => {
      if (t.status === 'done' || t.archived) return false;
      if (!t.dueDate) return false;
      if (_isDismissed('imminent_' + t.id)) return false;
      // Parse due date as end-of-day local time
      const dueTs = new Date(t.dueDate + 'T23:59:59').getTime();
      const remaining = dueTs - now;
      return remaining > 0 && remaining <= thresholdMs;
    });

    if (!tasks.length) return null;

    // Pick the most urgent (soonest due)
    tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const task = tasks[0];
    const dueTs = new Date(task.dueDate + 'T23:59:59').getTime();
    const hoursLeft = Math.max(0, Math.round((dueTs - now) / 3600_000));

    return {
      type: 'deadline_imminent',
      data: { task, hoursLeft },
    };
  }

  // ── 2. Overdue Pileup ──────────────────────────────────────

  function _checkOverduePileup() {
    const today = todayStr();
    const data = getData();
    const overdue = data.tasks.filter((t) => t.status !== 'done' && !t.archived && t.dueDate && t.dueDate < today);

    if (overdue.length < OVERDUE_PILEUP_THRESHOLD) return null;
    if (_isDismissed('overdue_pileup')) return null;

    return {
      type: 'overdue_pileup',
      data: { tasks: overdue },
    };
  }

  // ── 3. Day Plan Behind Pace ────────────────────────────────

  function _checkDayPlanBehind() {
    const now = new Date();
    if (now.getHours() < 14) return null; // only after 2pm

    if (_isDismissed('behind_pace')) return null;

    const planKey = userKey('whiteboard_plan_' + todayStr());
    let plan;
    try {
      const raw = JSON.parse(localStorage.getItem(planKey) || '[]');
      plan = Array.isArray(raw) ? raw : (raw && raw.blocks ? raw.blocks.flatMap((b) => b.tasks || []) : []);
    } catch (_e) {
      return null;
    }
    if (!plan.length) return null;

    const totalPlanned = plan.length;
    const completedCount = plan.filter((p) => {
      const t = findTask(p.id);
      return t && t.status === 'done';
    }).length;

    const completionRate = completedCount / totalPlanned;
    if (completionRate >= DAY_PLAN_BEHIND_THRESHOLD) return null;

    return {
      type: 'behind_pace',
      data: { completed: completedCount, total: totalPlanned },
    };
  }

  // ── 4. Stuck Too Long ─────────────────────────────────────

  function _checkStuckTooLong() {
    const now = Date.now();
    const thresholdMs = STUCK_THRESHOLD_HOURS * 3600_000;
    const data = getData();

    const stuck = data.tasks.filter((t) => {
      if (t.status !== 'in-progress' || t.archived) return false;
      if (_isDismissed('stuck_' + t.id)) return false;

      const lastTouch = t.updates?.length
        ? new Date(t.updates[t.updates.length - 1].date).getTime()
        : t.createdAt
          ? new Date(t.createdAt).getTime()
          : now;
      const elapsed = now - lastTouch;
      if (elapsed < thresholdMs) return false;

      // Check subtask progress — if all done, not stuck
      if (t.subtasks?.length) {
        const doneCount = t.subtasks.filter((s) => s.done).length;
        if (doneCount === t.subtasks.length) return false;
      }

      return true;
    });

    if (!stuck.length) return null;

    // Pick the one stuck longest
    stuck.sort((a, b) => {
      const aTouch = a.updates?.length
        ? new Date(a.updates[a.updates.length - 1].date).getTime()
        : new Date(a.createdAt).getTime();
      const bTouch = b.updates?.length
        ? new Date(b.updates[b.updates.length - 1].date).getTime()
        : new Date(b.createdAt).getTime();
      return aTouch - bTouch;
    });

    const task = stuck[0];
    const lastTouch = task.updates?.length
      ? new Date(task.updates[task.updates.length - 1].date).getTime()
      : new Date(task.createdAt).getTime();
    const daysStuck = Math.floor((now - lastTouch) / MS_PER_DAY);

    return {
      type: 'stuck',
      data: { task, daysStuck },
    };
  }

  // ── Dismiss ────────────────────────────────────────────────

  function dismissEscalation(key) {
    if (!key && _currentEscalation) {
      key = _escalationKey(_currentEscalation);
    }
    if (key) _dismissed.set(key, Date.now());
    _currentEscalation = null;
  }

  function _escalationKey(esc) {
    switch (esc.type) {
      case 'deadline_imminent':
        return 'imminent_' + esc.data.task.id;
      case 'overdue_pileup':
        return 'overdue_pileup';
      case 'behind_pace':
        return 'behind_pace';
      case 'stuck':
        return 'stuck_' + esc.data.task.id;
      default:
        return 'unknown';
    }
  }

  // ── Render ─────────────────────────────────────────────────

  function renderEscalationBanner() {
    if (!_currentEscalation) return '';
    const esc = _currentEscalation;
    const key = _escalationKey(esc);

    switch (esc.type) {
      case 'deadline_imminent': {
        const { task, hoursLeft } = esc.data;
        const title = _esc(task.title);
        const timeStr = hoursLeft <= 1 ? 'less than an hour' : hoursLeft + ' hours';
        return (
          '<div class="escalation-banner" data-escalation-key="' +
          key +
          '">' +
          '<div class="escalation-icon">\u26A1</div>' +
          '<div class="escalation-content">' +
          '<div class="escalation-title">' +
          title +
          ' is due in ' +
          timeStr +
          '. Focus on it now?</div>' +
          '</div>' +
          '<div class="escalation-actions">' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="focus" data-esc-task="' +
          task.id +
          '" data-esc-key="' +
          key +
          '">Focus Now</button>' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="reschedule" data-esc-task="' +
          task.id +
          '" data-esc-key="' +
          key +
          '">Reschedule to Tomorrow</button>' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="done" data-esc-task="' +
          task.id +
          '" data-esc-key="' +
          key +
          '">Mark Done</button>' +
          '<button class="btn btn-sm escalation-btn-dismiss" data-action="escalation-action" data-esc-action="dismiss" data-esc-key="' +
          key +
          '">Dismiss</button>' +
          '</div></div>'
        );
      }

      case 'overdue_pileup': {
        const { tasks } = esc.data;
        const listHTML = tasks
          .map(
            (t) =>
              '<div class="escalation-triage-row">' +
              '<span class="escalation-triage-title">' +
              _esc(t.title) +
              '</span>' +
              '<div class="escalation-triage-actions">' +
              '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="do-today" data-esc-task="' +
              t.id +
              '" data-esc-key="' +
              key +
              '">Do Today</button>' +
              '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="reschedule" data-esc-task="' +
              t.id +
              '" data-esc-key="' +
              key +
              '">Reschedule</button>' +
              '<button class="btn btn-sm escalation-btn-dismiss" data-action="escalation-action" data-esc-action="drop" data-esc-task="' +
              t.id +
              '" data-esc-key="' +
              key +
              '">Drop</button>' +
              '</div></div>',
          )
          .join('');
        return (
          '<div class="escalation-banner" data-escalation-key="' +
          key +
          '">' +
          '<div class="escalation-icon">\uD83D\uDD25</div>' +
          '<div class="escalation-content">' +
          '<div class="escalation-title">You have ' +
          tasks.length +
          " overdue tasks. Let's decide what to do with each.</div>" +
          '<div class="escalation-triage-list">' +
          listHTML +
          '</div>' +
          '</div>' +
          '<div class="escalation-actions">' +
          '<button class="btn btn-sm escalation-btn-dismiss" data-action="escalation-action" data-esc-action="dismiss" data-esc-key="' +
          key +
          '">Dismiss</button>' +
          '</div></div>'
        );
      }

      case 'behind_pace': {
        const { completed, total } = esc.data;
        return (
          '<div class="escalation-banner" data-escalation-key="' +
          key +
          '">' +
          '<div class="escalation-icon">\uD83D\uDCC9</div>' +
          '<div class="escalation-content">' +
          '<div class="escalation-title">You\'re ' +
          completed +
          '/' +
          total +
          " on today's plan. Want to replan the rest of the day?</div>" +
          '</div>' +
          '<div class="escalation-actions">' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="replan" data-esc-key="' +
          key +
          '">Replan Day</button>' +
          '<button class="btn btn-sm escalation-btn-dismiss" data-action="escalation-action" data-esc-action="dismiss" data-esc-key="' +
          key +
          '">Dismiss</button>' +
          '</div></div>'
        );
      }

      case 'stuck': {
        const { task, daysStuck } = esc.data;
        const title = _esc(task.title);
        return (
          '<div class="escalation-banner" data-escalation-key="' +
          key +
          '">' +
          '<div class="escalation-icon">\u23F3</div>' +
          '<div class="escalation-content">' +
          '<div class="escalation-title">' +
          title +
          ' has been in progress for ' +
          daysStuck +
          ' days. Need help?</div>' +
          '</div>' +
          '<div class="escalation-actions">' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="break-down" data-esc-task="' +
          task.id +
          '" data-esc-key="' +
          key +
          '">Break it Down</button>' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="get-unstuck" data-esc-task="' +
          task.id +
          '" data-esc-key="' +
          key +
          '">Get Unstuck</button>' +
          '<button class="btn btn-sm escalation-btn" data-action="escalation-action" data-esc-action="reschedule" data-esc-task="' +
          task.id +
          '" data-esc-key="' +
          key +
          '">Reschedule</button>' +
          '<button class="btn btn-sm escalation-btn-dismiss" data-action="escalation-action" data-esc-action="dismiss" data-esc-key="' +
          key +
          '">Dismiss</button>' +
          '</div></div>'
        );
      }

      default:
        return '';
    }
  }

  // ── Action handler ─────────────────────────────────────────

  function handleEscalationAction(action, taskId, escalationKey) {
    switch (action) {
      case 'focus':
        if (taskId) startFocus(taskId);
        dismissEscalation(escalationKey);
        break;

      case 'reschedule': {
        if (taskId) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr =
            tomorrow.getFullYear() +
            '-' +
            String(tomorrow.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(tomorrow.getDate()).padStart(2, '0');
          updateTask(taskId, { dueDate: tomorrowStr });
          showToast('Rescheduled to tomorrow');
        }
        dismissEscalation(escalationKey);
        render();
        break;
      }

      case 'done':
        if (taskId) {
          updateTask(taskId, { status: 'done', completedAt: new Date().toISOString() });
          showToast('Marked done');
        }
        dismissEscalation(escalationKey);
        render();
        break;

      case 'do-today': {
        if (taskId) {
          updateTask(taskId, { dueDate: todayStr() });
          showToast('Set to today');
        }
        render();
        break;
      }

      case 'drop':
        if (taskId) {
          updateTask(taskId, { status: 'done', completedAt: new Date().toISOString(), archived: true });
          showToast('Task dropped');
        }
        render();
        break;

      case 'replan':
        dismissEscalation(escalationKey);
        if (deps.replanDay) deps.replanDay();
        break;

      case 'break-down':
      case 'get-unstuck':
        if (taskId && deps.offerStuckHelp) deps.offerStuckHelp(taskId);
        dismissEscalation(escalationKey);
        break;

      case 'dismiss':
        dismissEscalation(escalationKey);
        render();
        break;
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public getters for testing ─────────────────────────────

  function getCurrentEscalation() {
    return _currentEscalation;
  }

  function getDismissedMap() {
    return _dismissed;
  }

  return {
    startEscalationLoop,
    stopEscalationLoop,
    runEscalationCheck,
    maybeCheckOnRender,
    dismissEscalation,
    renderEscalationBanner,
    handleEscalationAction,
    getCurrentEscalation,
    getDismissedMap,
  };
}
