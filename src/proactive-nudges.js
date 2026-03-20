// ============================================================
// PROACTIVE NUDGES SUB-MODULE
// ============================================================
// Handles: smart nudges, nudge filters, stuck task detection,
// reflections, check-ins, vague task detection and breakdown

import { MS_PER_DAY, REFLECTION_TOAST_MS, STALE_TASK_DAYS, MAX_NUDGES } from './constants.js';
import { AI_PERSONA_SHORT } from './ai-context.js';
import { VAGUE_WORDS } from './proactive.js';

/**
 * Factory function for nudge-related proactive features.
 * @param {Object} deps - Dependencies
 * @returns {{ getSmartNudges, nudgeFilterOverdue, nudgeFilterStale, nudgeFilterUnassigned, getStuckTasks, trackNudgeInteraction, maybeReflect, showReflectionToast, maybeShowCheckIn, dismissCheckIn, detectVagueTasks, breakdownTask, dismissVagueTask }}
 */
export function createProactiveNudges(deps) {
  const {
    esc,
    todayStr,
    genId,
    getData,
    userKey,
    hasAI,
    callAI,
    buildAIContext,
    addAIMemory,
    findTask,
    updateTask,
    showToast,
    render,
    setView,
    setNudgeFilter,
  } = deps;

  // ── Nudge Interaction Tracking ──────────────────────────────────────
  function trackNudgeInteraction(nudgeType, acted) {
    const key = userKey('wb_nudge_interactions');
    let interactions = [];
    try {
      interactions = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_e) {
      /* ignore */
    }
    interactions.push({ type: nudgeType, acted: !!acted, ts: Date.now() });
    // Keep last 100 interactions
    if (interactions.length > 100) interactions = interactions.slice(-100);
    try {
      localStorage.setItem(key, JSON.stringify(interactions));
    } catch (_e) {
      /* ignore */
    }
    // Save insight to AI memory if we have enough data
    const typeInteractions = interactions.filter((i) => i.type === nudgeType);
    if (typeInteractions.length >= 5) {
      const actRate = typeInteractions.filter((i) => i.acted).length / typeInteractions.length;
      if (actRate > 0.7) {
        addAIMemory(
          'User consistently acts on "' + nudgeType + '" nudges (' + Math.round(actRate * 100) + '% action rate)',
          'pattern',
        );
      } else if (actRate < 0.2) {
        addAIMemory(
          'User mostly ignores "' + nudgeType + '" nudges (' + Math.round(actRate * 100) + '% action rate)',
          'pattern',
        );
      }
    }
  }

  function _getNudgeWeights() {
    const key = userKey('wb_nudge_interactions');
    let interactions = [];
    try {
      interactions = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_e) {
      /* ignore */
    }
    if (!interactions.length) return {};
    const weights = {};
    const types = [...new Set(interactions.map((i) => i.type))];
    for (const type of types) {
      const typeData = interactions.filter((i) => i.type === type);
      if (typeData.length < 3) continue;
      const actRate = typeData.filter((i) => i.acted).length / typeData.length;
      // Weight: 0.3 (ignored) to 1.5 (frequently acted on)
      weights[type] = 0.3 + actRate * 1.2;
    }
    return weights;
  }

  function getSmartNudges() {
    const today = todayStr();
    const nudges = [];
    const data = getData();
    const active = data.tasks.filter((t) => t.status !== 'done' && !t.archived);
    const done = data.tasks.filter((t) => t.status === 'done');
    const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
    const inProgress = active.filter((t) => t.status === 'in-progress');
    const stale = active.filter((t) => {
      const lastTouch = t.updates?.length ? t.updates[t.updates.length - 1].date : t.createdAt;
      return lastTouch && Date.now() - new Date(lastTouch).getTime() > STALE_TASK_DAYS * MS_PER_DAY;
    });

    // Overload detection
    if (active.length > 30)
      nudges.push({
        type: 'warning',
        icon: '\u26A1',
        text: `${active.length} active tasks. Consider archiving some to stay focused.`,
        actionLabel: 'Review & archive',
        actionFn: `setView('archive')`,
      });

    // Stale tasks
    if (stale.length >= 3)
      nudges.push({
        type: 'stale',
        icon: '\uD83D\uDD78',
        text: `${stale.length} tasks untouched for 10+ days: ${stale
          .slice(0, 3)
          .map((t) => esc(t.title))
          .join(', ')}${stale.length > 3 ? '...' : ''}. Still relevant?`,
        actionLabel: 'Review stale',
        actionFn: `nudgeFilterStale()`,
      });

    // No tasks in progress
    if (inProgress.length === 0 && active.length > 0)
      nudges.push({
        type: 'action',
        icon: '\u25B6',
        text: `Nothing in progress yet. Pick one to get started.`,
        actionLabel: 'Start one',
        actionFn: `startFocus()`,
      });

    // Too many in progress
    if (inProgress.length > 5)
      nudges.push({
        type: 'warning',
        icon: '\uD83C\uDFAA',
        text: `${inProgress.length} tasks in progress at once. Try finishing some before starting more.`,
        actionLabel: 'Focus on one',
        actionFn: `startFocus()`,
      });

    // Overdue pileup
    if (overdue.length >= 3)
      nudges.push({
        type: 'urgent',
        icon: '\uD83D\uDD25',
        text: `${overdue.length} overdue tasks. Worth rescheduling ones you won't get to.`,
        actionLabel: 'Review overdue',
        actionFn: `nudgeFilterOverdue()`,
      });

    // Weekly completion count (no comparison)
    const weekAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString().slice(0, 10);
    const doneThisWeek = done.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= weekAgo).length;
    if (doneThisWeek > 0)
      nudges.push({
        type: 'positive',
        icon: '\u2713',
        text: `${doneThisWeek} task${doneThisWeek === 1 ? '' : 's'} completed this week.`,
      });

    // Unassigned tasks
    const unassigned = active.filter((t) => !t.project);
    if (unassigned.length >= 3)
      nudges.push({
        type: 'action',
        icon: '\uD83D\uDCC2',
        text: `${unassigned.length} tasks without a project. Assigning them helps AI give better advice.`,
        actionLabel: 'Assign them',
        actionFn: `nudgeFilterUnassigned()`,
      });

    // Big tasks without subtasks
    const bigNoSubs = active.filter((t) => t.title.length > 40 && (!t.subtasks || t.subtasks.length === 0));
    if (bigNoSubs.length >= 2)
      nudges.push({
        type: 'action',
        icon: '\u2702',
        text: `"${esc(bigNoSubs[0].title.slice(0, 35))}..." looks complex. Break it into subtasks?`,
      });

    // Apply memory-based weighting to nudges
    const nudgeWeights = _getNudgeWeights();
    const weightedNudges = nudges.map((n) => {
      const weight = nudgeWeights[n.type] !== undefined ? nudgeWeights[n.type] : 1.0;
      return { ...n, _weight: weight };
    });
    weightedNudges.sort((a, b) => b._weight - a._weight);
    return weightedNudges.slice(0, MAX_NUDGES); // Max 4 nudges at a time
  }

  function nudgeFilterOverdue() {
    setNudgeFilter('overdue');
    setView('dashboard');
    render();
    showToast('Showing overdue tasks');
  }

  function nudgeFilterStale() {
    setNudgeFilter('stale');
    setView('dashboard');
    render();
    showToast('Showing stale tasks');
  }

  function nudgeFilterUnassigned() {
    setNudgeFilter('unassigned');
    setView('dashboard');
    render();
    showToast('Showing unassigned tasks');
  }

  function maybeReflect(t) {
    if (!hasAI()) return;
    // Significance-based: always reflect on important completions, rarely on trivial ones
    const daysSinceCreation = t.createdAt ? Math.floor((Date.now() - new Date(t.createdAt).getTime()) / MS_PER_DAY) : 0;
    const significance =
      (t.priority === 'urgent' ? 3 : t.priority === 'important' ? 2 : 0) +
      (t.subtasks && t.subtasks.length >= 3 ? 2 : 0) +
      (t.notes && t.notes.length > 50 ? 1 : 0) +
      (daysSinceCreation > 7 ? 2 : daysSinceCreation > 3 ? 1 : 0);
    const threshold = significance >= 4 ? 0 : significance >= 2 ? 0.5 : 0.85;
    if (Math.random() > 1 - threshold) return;

    const data = getData();
    const proj = data.projects.find((p) => p.id === t.project);
    const relatedActive = data.tasks.filter((x) => x.status !== 'done' && x.project === t.project && x.id !== t.id);

    const ctx = buildAIContext('all', null, 'minimal');
    const prompt = `${AI_PERSONA_SHORT}

${ctx}

The user just completed: "${t.title}"
${t.notes ? 'Notes: ' + t.notes : ''}
${proj ? 'Project: ' + proj.name : ''}
${
  relatedActive.length
    ? 'Still active in this project: ' +
      relatedActive
        .slice(0, 5)
        .map((x) => x.title)
        .join(', ')
    : 'No other active tasks in this project.'
}

Choose ONE of these responses (whichever fits best):
A) If this completion unlocks or enables something else → suggest what to do next. "Now that X is done, you could tackle Y."
B) If this was a big or long-running task → one sentence of genuine acknowledgment + what it means for the bigger picture.
C) If there's a pattern worth noticing → name it. "That's the third outreach task you've done this week — is networking becoming a focus?"
D) If the project is now nearly done → note it. "Only 2 tasks left in [project]. Finish line is close."
E) If nothing noteworthy → respond with just "✓" and nothing else.

ONE sentence max. Be genuine, not performative. No "Great job!" energy.`;

    callAI(prompt, { maxTokens: 100 })
      .then((reply) => {
        const clean = reply.replace(/\n/g, ' ').trim();
        if (clean && clean !== '\u2713' && clean.length > 2) {
          // Delay reflection to avoid stacking with undo toast (5s undo + 1s buffer)
          setTimeout(() => showToast(clean, false, true), 6000);
          if (clean.length > 20) {
            addAIMemory(clean, 'reflection');
          }
        }
      })
      .catch((e) => console.warn('AI call failed:', e.message));
  }

  function showReflectionToast(text) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:12px 20px;border-radius:var(--radius);font-size:13px;z-index:var(--z-toast);max-width:420px;text-align:center;box-shadow:var(--shadow);line-height:1.4;animation:toastIn 0.3s ease';
    el.innerHTML = `<span style="color:var(--accent);margin-right:6px">✦</span>${esc(text)}`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.5s';
      setTimeout(() => el.remove(), 500);
    }, REFLECTION_TOAST_MS);
  }

  function getStuckTasks() {
    const now = Date.now();
    const data = getData();
    return data.tasks.filter((t) => {
      if (t.status !== 'in-progress') return false;
      // In progress for 3+ days
      const lastTouch = t.updates?.length
        ? new Date(t.updates[t.updates.length - 1].date).getTime()
        : new Date(t.createdAt).getTime();
      const daysSince = (now - lastTouch) / MS_PER_DAY;
      if (daysSince < 3) return false;
      // Has subtasks but none completed recently
      if (t.subtasks?.length) {
        const doneCount = t.subtasks.filter((s) => s.done).length;
        if (doneCount === 0 || doneCount === t.subtasks.length) return false; // not started or all done
      }
      return true;
    });
  }

  // == Mid-Day Check-In ==================================================

  function maybeShowCheckIn() {
    const hour = new Date().getHours();
    if (hour < 14 || hour >= 16) return '';
    const today = todayStr();
    const checkinKey = userKey('wb_checkin_' + today);
    if (localStorage.getItem(checkinKey)) return '';
    const planKey = userKey('whiteboard_plan_' + today);
    const planRaw = localStorage.getItem(planKey);
    if (!planRaw) return '';
    let plan;
    try {
      plan = JSON.parse(planRaw);
    } catch (_e) {
      return '';
    }
    if (!Array.isArray(plan) || plan.length === 0) return '';

    const planTasks = plan.map((p) => findTask(p.id)).filter(Boolean);
    const completed = planTasks.filter((t) => t.status === 'done');
    const remaining = planTasks.filter((t) => t.status !== 'done');
    const total = planTasks.length;
    const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;

    let h = '<div class="checkin-card">';
    h +=
      '<div class="checkin-header"><span style="font-size:14px">&#9745;</span><span class="checkin-title">Mid-Day Check-In</span><button class="btn btn-sm" data-action="checkin-dismiss" style="margin-left:auto;font-size:11px;padding:3px 10px">Dismiss</button></div>';
    h +=
      '<div class="checkin-progress"><div class="checkin-progress-bar"><div class="checkin-progress-fill" style="width:' +
      pct +
      '%"></div></div><span class="checkin-progress-label">' +
      pct +
      '% &mdash; ' +
      completed.length +
      '/' +
      total +
      ' done</span></div>';
    if (remaining.length > 0) {
      h +=
        '<div class="checkin-remaining"><div style="font-size:12px;color:var(--text3);margin-bottom:8px">Remaining tasks:</div>';
      remaining.forEach((t) => {
        h += '<div class="checkin-task-row">';
        h += '<span class="checkin-task-title">' + esc(t.title) + '</span>';
        h += '<div class="checkin-task-actions">';
        h +=
          '<button class="btn btn-sm" data-action="checkin-do-now" data-task-id="' +
          t.id +
          '" style="font-size:10px;padding:2px 8px">Do Now</button>';
        h +=
          '<button class="btn btn-sm" data-action="checkin-push-tomorrow" data-task-id="' +
          t.id +
          '" style="font-size:10px;padding:2px 8px">Push</button>';
        h +=
          '<button class="btn btn-sm" data-action="checkin-drop" data-task-id="' +
          t.id +
          '" style="font-size:10px;padding:2px 8px">Drop</button>';
        h += '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function dismissCheckIn() {
    const today = todayStr();
    localStorage.setItem(userKey('wb_checkin_' + today), '1');
  }

  // == Auto Task Breakdown ===============================================

  function detectVagueTasks() {
    const data = getData();
    const now = Date.now();
    let dismissed = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(userKey('wb_vague_dismissed')) || '[]');
    } catch (_e) {
      /* ignore */
    }
    const dismissedSet = new Set(dismissed);

    return (
      data.tasks.find((t) => {
        if (t.status === 'done' || t.archived) return false;
        if (t.subtasks && t.subtasks.length > 0) return false;
        if (dismissedSet.has(t.id)) return false;
        const titleLower = (t.title || '').toLowerCase();
        const isVague = t.title.length > 40 || VAGUE_WORDS.some((w) => titleLower.includes(w));
        if (!isVague) return false;
        const lastTouch = t.updates?.length
          ? new Date(t.updates[t.updates.length - 1].date).getTime()
          : new Date(t.createdAt).getTime();
        const daysSince = (now - lastTouch) / MS_PER_DAY;
        return daysSince >= 2;
      }) || null
    );
  }

  async function breakdownTask(taskId) {
    if (!hasAI()) {
      showToast('AI not available');
      return;
    }
    const task = findTask(taskId);
    if (!task) return;
    try {
      const prompt =
        'Break down this task into 3-6 concrete subtasks:\n"' +
        task.title +
        '"' +
        (task.notes ? '\nNotes: ' + task.notes : '') +
        '\n\nReturn ONLY a JSON array of strings, no other text:\n["subtask 1", "subtask 2", ...]';
      const reply = await callAI(prompt, { maxTokens: 4096, temperature: 0.3 });
      const subtasks = JSON.parse(
        reply
          .replace(/```json?\s*/g, '')
          .replace(/```/g, '')
          .trim(),
      );
      if (Array.isArray(subtasks) && subtasks.length > 0) {
        const existing = task.subtasks || [];
        const newSubs = subtasks.slice(0, 6).map((s) => ({ id: genId('st'), title: String(s), done: false }));
        updateTask(taskId, { subtasks: [...existing, ...newSubs] });
        showToast('Added ' + newSubs.length + ' subtask' + (newSubs.length > 1 ? 's' : ''));
        render();
      }
    } catch (err) {
      console.error('Breakdown error:', err);
      showToast('Breakdown failed \u2014 try again', true);
    }
  }

  function dismissVagueTask(taskId) {
    let dismissed = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(userKey('wb_vague_dismissed')) || '[]');
    } catch (_e) {
      /* ignore */
    }
    dismissed.push(taskId);
    localStorage.setItem(userKey('wb_vague_dismissed'), JSON.stringify(dismissed));
  }

  return {
    getSmartNudges,
    nudgeFilterOverdue,
    nudgeFilterStale,
    nudgeFilterUnassigned,
    maybeReflect,
    showReflectionToast,
    getStuckTasks,
    trackNudgeInteraction,
    maybeShowCheckIn,
    dismissCheckIn,
    detectVagueTasks,
    breakdownTask,
    dismissVagueTask,
  };
}
