// ============================================================
// PROACTIVE PLANNING SUB-MODULE
// ============================================================
// Handles: day planning, snoozing, replanning, workload analysis,
// reschedule suggestions, auto-rebalancing

import { MS_PER_DAY } from './constants.js';
import { AI_PERSONA } from './ai-context.js';

/**
 * Factory function for planning-related proactive features.
 * @param {Object} deps - Dependencies
 * @returns {{ planMyDay, snoozePlanTask, replanDay, analyzeWorkload, suggestReschedule, showRescheduleModal, acceptReschedule, skipReschedule, acceptAllReschedules, autoRebalanceWeek, isWeekOverloaded }}
 */
export function createProactivePlanning(deps) {
  const {
    $,
    esc,
    todayStr,
    getData,
    userKey,
    hasAI,
    callAI,
    buildAIContext,
    findTask,
    updateTask,
    isBlocked,
    showToast,
    render,
    notifyOverdueTasks,
    setBriefingGenerating,
    setPlanGenerating,
    setPlanIndexCache,
    extractMemoryInsights,
    _buildInsightsPromptSection,
  } = deps;

  async function planMyDay() {
    if (!hasAI()) return;
    const data = getData();
    const active = data.tasks.filter((t) => t.status !== 'done' && !t.archived);
    if (active.length === 0) {
      showToast('No active tasks to plan — add some tasks first');
      return;
    }
    const btn = document.getElementById('planBtn');
    if (btn)
      btn.innerHTML =
        '<span class="spinner" style="width:14px;height:14px;margin-right:6px;vertical-align:middle"></span>Planning...';

    const ctx = buildAIContext('all');
    const taskList = active
      .map((t) => {
        const proj = data.projects.find((p) => p.id === t.project);
        const est = t.estimatedMinutes ? `${t.estimatedMinutes}m` : 'no estimate';
        const subProg = t.subtasks?.length
          ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} subtasks`
          : '';
        const age = t.createdAt ? Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000) + 'd old' : '';
        return `${t.id}|${t.title}|${t.priority}|${t.status}|${t.dueDate || 'no date'}|${proj ? proj.name : 'unassigned'}|${isBlocked(t) ? 'BLOCKED' : 'ready'}|${est}|${subProg}|${age}`;
      })
      .join('\n');

    const totalEstimated = active.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
    const estNote =
      totalEstimated > 0
        ? `\nTIME ESTIMATES: ${Math.round((totalEstimated / 60) * 10) / 10} hours of estimated work across all active tasks. Assume 6-8 productive hours available today — don't overload the plan.`
        : '';

    const memInsights =
      typeof deps.getAIMemory === 'function' ? extractMemoryInsights(deps.getAIMemory()) : extractMemoryInsights([]);
    const insightsSection = _buildInsightsPromptSection(memInsights);
    const orderHint =
      memInsights.task_order_preference === 'easy-first'
        ? '\n- User prefers easy/quick wins first to build momentum, then harder tasks.'
        : memInsights.task_order_preference === 'hard-first'
          ? '\n- User prefers tackling hard tasks first while energy is high.'
          : '';

    const prompt = `${AI_PERSONA}

Plan the user's day and write a narrative brief explaining what matters and why.
${insightsSection}
${ctx}
${estNote}

ALL ACTIVE TASKS (id|title|priority|status|due|project|blocked|estimate|subtask_progress|age):
${taskList}

RULES FOR TASK SELECTION:
- Pick 3-6 tasks. This is what you can REALISTICALLY do today, not a wish list.
- ALWAYS include overdue tasks and tasks due today — non-negotiable
- Then add 1-3 high-impact items that genuinely fit in a day
- Consider energy: harder tasks earlier, lighter tasks later${orderHint}
- Include in-progress tasks (momentum matters)
- Skip BLOCKED tasks only
- TRIAGE RULE: If more than 3 tasks are marked "urgent", you MUST triage. Only 1-3 things can truly be urgent. The rest get downgraded to "important" with an explanation in the why field.
- REALITY CHECK: If total estimated time for selected tasks exceeds 6 hours, cut tasks. If estimates are mostly 0 or missing, note this in the narrative and suggest rough estimates.
- Use the task IDs EXACTLY as provided — copy them character for character

RULES FOR NARRATIVE:
- Write 2-4 sentences telling the user what matters TODAY and why
- Lead with the ONE thing that matters most and explain why (deadline, blocking other work, etc.)
- Be honest about capacity: "You have 6 tasks but realistically 4 fit today"
- If many tasks lack time estimates, say so: "Most tasks have no estimate — I've picked what feels like a full day"
- Mention what can wait and why — give permission to defer
- Be specific: reference dates, deadlines, dependencies
- Don't list tasks — explain the situation. The task list is below.
- Write in second person ("You have...", "Your...") — calm, warm, direct

TIME BLOCKS:
- Group the selected tasks into 2-4 time blocks based on their project/board
- Each block represents a focused work session on one project
- Assign realistic time ranges (e.g. "9am – 12pm")
- You can include break blocks (lunch, rest)
- Order blocks by energy: harder/urgent projects earlier, lighter ones later
- Each block's duration should roughly match the total estimated minutes of its tasks

Return ONLY this JSON object, no other text:
{
  "narrative": "2-4 sentence brief about what matters today and why",
  "blocks": [
    {
      "label": "Morning Focus",
      "time": "9am – 12pm",
      "projectName": "Board name these tasks belong to",
      "isBreak": false,
      "tasks": [
        { "id": "task_id", "why": "brief reason — 8 words max" }
      ]
    },
    {
      "label": "Lunch",
      "time": "12pm – 1pm",
      "isBreak": true,
      "tasks": []
    }
  ]
}`;

    try {
      const reply = await callAI(prompt, { maxTokens: 16384, temperature: 0.3 });
      const cleaned = reply
        .replace(/```json?\s*/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      // Support three formats: blocks {narrative, blocks}, flat {narrative, tasks}, legacy [tasks]
      let narrative = '';
      let planData;

      if (Array.isArray(parsed)) {
        // Legacy: bare array of tasks
        planData = parsed.filter((p) => findTask(p.id)).slice(0, 8);
      } else if (parsed && parsed.blocks && parsed.blocks.length) {
        // New: time-blocked format
        narrative = parsed.narrative || '';
        const blocks = parsed.blocks.map((b) => ({
          label: b.label || '',
          time: b.time || '',
          projectName: b.projectName || '',
          isBreak: !!b.isBreak,
          tasks: b.isBreak ? [] : (b.tasks || []).filter((p) => findTask(p.id)),
        }));
        planData = { blocks };
      } else if (parsed && parsed.tasks) {
        // Flat: {narrative, tasks}
        narrative = parsed.narrative || '';
        planData = parsed.tasks.filter((p) => findTask(p.id)).slice(0, 8);
      } else {
        planData = [];
      }

      // Validate: ensure we have enough tasks
      const allTasks = Array.isArray(planData)
        ? planData
        : planData.blocks
          ? planData.blocks.flatMap((b) => b.tasks || [])
          : [];

      if (allTasks.length) {
        // If too few tasks, backfill with urgent/overdue
        if (allTasks.length < 3) {
          const today = todayStr();
          const validIds = new Set(allTasks.map((p) => p.id));
          const urgent = active.filter(
            (t) => !validIds.has(t.id) && ((t.dueDate && t.dueDate <= today) || t.priority === 'urgent'),
          );
          const backfill = [];
          urgent.forEach((t) => {
            if (allTasks.length + backfill.length < 8) {
              backfill.push({ id: t.id, why: t.dueDate && t.dueDate < today ? 'Overdue' : 'Due today' });
            }
          });
          if (backfill.length) {
            if (Array.isArray(planData)) {
              planData.push(...backfill);
            } else if (planData.blocks && planData.blocks.length) {
              // Add backfill to first non-break block
              const firstBlock = planData.blocks.find((b) => !b.isBreak);
              if (firstBlock) firstBlock.tasks.push(...backfill);
            }
          }
        }

        localStorage.setItem(userKey('whiteboard_plan_' + todayStr()), JSON.stringify(planData));
        if (narrative) {
          localStorage.setItem(userKey('whiteboard_narrative_' + todayStr()), narrative);
        }
        setPlanIndexCache(null, ''); // invalidate sort cache
        render();
        const taskCount = Array.isArray(planData)
          ? planData.length
          : planData.blocks
            ? planData.blocks.reduce((s, b) => s + (b.tasks?.length || 0), 0)
            : 0;
        showToast(`Day planned: ${taskCount} tasks`);
        notifyOverdueTasks();
      }
    } catch (err) {
      console.error('Plan error:', err);
      // Only show error toast if user manually triggered (button exists and says "Planning...")
      if (btn && btn.innerHTML.includes('Planning')) showToast('Planning failed — try again', true);
    }
    if (btn) btn.textContent = '◎ Plan My Day';
  }

  async function sendNarrativeReply(userMsg) {
    if (!hasAI()) return;
    const narrativeKey = userKey('whiteboard_narrative_' + todayStr());
    const currentNarrative = localStorage.getItem(narrativeKey) || '';
    const planKey = userKey('whiteboard_plan_' + todayStr());
    const currentPlan = localStorage.getItem(planKey);

    let planContext = '';
    let hasBlocks = false;
    if (currentPlan) {
      try {
        const plan = JSON.parse(currentPlan);
        if (plan && plan.blocks) {
          hasBlocks = true;
          planContext = plan.blocks
            .map((b) => {
              if (b.isBreak) return `[${b.time}] ${b.label} (break)`;
              const tasks = (b.tasks || [])
                .map((p) => {
                  const t = findTask(p.id);
                  return t ? `  - ${t.title} (${t.priority}${t.dueDate ? ', due ' + t.dueDate : ''})` : '';
                })
                .filter(Boolean)
                .join('\n');
              return `[${b.time}] ${b.label}${b.projectName ? ' — ' + b.projectName : ''}\n${tasks}`;
            })
            .join('\n');
        } else {
          const items = Array.isArray(plan) ? plan : [];
          planContext = items
            .map((p) => {
              const t = findTask(p.id);
              return t ? `- ${t.title} (${t.priority}, ${t.status}${t.dueDate ? ', due ' + t.dueDate : ''})` : '';
            })
            .filter(Boolean)
            .join('\n');
        }
      } catch {
        /* */
      }
    }

    const prompt = `${AI_PERSONA}

The user is responding to their morning briefing. Update the narrative based on their feedback.

CURRENT NARRATIVE:
${currentNarrative}

CURRENT PLAN:
${planContext}

USER SAYS: "${userMsg}"

RULES:
- Acknowledge what they said and adjust the narrative accordingly
- If they say something can wait or is handled, remove it from focus and mention what moves up
- If they add context (e.g. "CPA is handling the tax return"), incorporate it
- Keep the same warm, direct tone
- 2-4 sentences
- If the plan should change (tasks removed/reordered), include planChanges
- If they want to restructure time blocks (e.g. "spend morning on X", "swap afternoon blocks"), return a full new blocks array in restructuredBlocks

Return ONLY a JSON object:
{
  "narrative": "Updated 2-4 sentence narrative reflecting their feedback",
  "planChanges": [],
  "restructuredBlocks": null
}

planChanges: If tasks should be removed: [{ "action": "remove", "id": "task_id" }]. Added: [{ "action": "add", "id": "task_id", "why": "reason" }]. Empty if no changes.

restructuredBlocks: ONLY if user requests time restructuring. Return the FULL blocks array:
[{ "label": "Morning", "time": "9am – 12pm", "projectName": "Board", "isBreak": false, "tasks": [{"id": "...", "why": "..."}] }]
Leave null if no block restructuring needed.`;

    try {
      showToast('Updating...');
      const reply = await callAI(prompt, { maxTokens: 16384, temperature: 0.3 });
      const cleaned = reply
        .replace(/```json?\s*/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.narrative) {
        localStorage.setItem(narrativeKey, parsed.narrative);
      }

      // Apply restructured blocks if AI returned them
      if (parsed.restructuredBlocks && parsed.restructuredBlocks.length) {
        const blocks = parsed.restructuredBlocks.map((b) => ({
          label: b.label || '',
          time: b.time || '',
          projectName: b.projectName || '',
          isBreak: !!b.isBreak,
          tasks: b.isBreak ? [] : (b.tasks || []).filter((p) => findTask(p.id)),
        }));
        localStorage.setItem(planKey, JSON.stringify({ blocks }));
        setPlanIndexCache(null, '');
      } else if (parsed.planChanges && parsed.planChanges.length && currentPlan) {
        // Apply incremental plan changes
        try {
          let plan = JSON.parse(currentPlan);
          if (plan && plan.blocks) {
            // Apply changes to blocks format
            parsed.planChanges.forEach((change) => {
              if (change.action === 'remove') {
                plan.blocks.forEach((b) => {
                  if (b.tasks) b.tasks = b.tasks.filter((p) => p.id !== change.id);
                });
              } else if (change.action === 'add' && findTask(change.id)) {
                const firstBlock = plan.blocks.find((b) => !b.isBreak);
                if (firstBlock) {
                  if (!firstBlock.tasks) firstBlock.tasks = [];
                  firstBlock.tasks.push({ id: change.id, why: change.why || '' });
                }
              }
            });
            localStorage.setItem(planKey, JSON.stringify(plan));
          } else {
            // Apply changes to flat format
            let items = Array.isArray(plan) ? plan : [];
            parsed.planChanges.forEach((change) => {
              if (change.action === 'remove') {
                items = items.filter((p) => p.id !== change.id);
              } else if (change.action === 'add' && findTask(change.id)) {
                items.push({ id: change.id, why: change.why || '' });
              }
            });
            localStorage.setItem(planKey, JSON.stringify(items));
          }
          setPlanIndexCache(null, '');
        } catch {
          /* */
        }
      }

      render();
      // Re-enable the input
      const inp = document.getElementById('narrativeReply');
      if (inp) inp.disabled = false;
    } catch (err) {
      console.error('Narrative reply error:', err);
      showToast('Could not update \u2014 try again', true);
      const inp = document.getElementById('narrativeReply');
      if (inp) inp.disabled = false;
    }
  }

  function snoozePlanTask(taskId) {
    const planKey = userKey('whiteboard_plan_' + todayStr());
    try {
      const raw = JSON.parse(localStorage.getItem(planKey) || '[]');
      if (raw && raw.blocks) {
        // Remove from blocks format
        raw.blocks.forEach((b) => {
          if (b.tasks) b.tasks = b.tasks.filter((p) => p.id !== taskId);
        });
        localStorage.setItem(planKey, JSON.stringify(raw));
      } else {
        const updated = (Array.isArray(raw) ? raw : []).filter((p) => p.id !== taskId);
        localStorage.setItem(planKey, JSON.stringify(updated));
      }
      setPlanIndexCache(null, '');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr =
        tomorrow.getFullYear() +
        '-' +
        String(tomorrow.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(tomorrow.getDate()).padStart(2, '0');
      updateTask(taskId, { dueDate: tomorrowStr });
      showToast('Snoozed to tomorrow');
      render();
    } catch (e) {
      console.warn('Snooze failed:', e);
    }
  }

  function replanDay() {
    localStorage.removeItem(userKey('whiteboard_plan_' + todayStr()));
    setPlanIndexCache(null, '');
    setBriefingGenerating(false); // not needed but safe
    setPlanGenerating(true);
    render();
    planMyDay().finally(() => {
      setPlanGenerating(false);
    });
  }

  // ── Smart Auto-Reschedule ─────────────────────────────────────────

  function analyzeWorkload() {
    const data = getData();
    const active = data.tasks.filter(function (t) {
      return t.status !== 'done' && !t.archived;
    });
    const dailyTasks = {};
    const overloadedDays = [];
    const emptyDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const ds =
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const dayTasks = active.filter(function (t) {
        return t.dueDate === ds;
      });
      dailyTasks[ds] = dayTasks;
      if (dayTasks.length > 5) overloadedDays.push(ds);
      if (dayTasks.length === 0) emptyDays.push(ds);
    }
    const done = data.tasks.filter(function (t) {
      return t.status === 'done' && t.completedAt;
    });
    const twoWeeksAgo = new Date(Date.now() - 14 * MS_PER_DAY).toISOString().slice(0, 10);
    const recentDone = done.filter(function (t) {
      return t.completedAt.slice(0, 10) >= twoWeeksAgo;
    });
    const daysWithCompletions = {};
    recentDone.forEach(function (t) {
      const ds2 = t.completedAt.slice(0, 10);
      daysWithCompletions[ds2] = (daysWithCompletions[ds2] || 0) + 1;
    });
    const completionDays = Object.keys(daysWithCompletions).length;
    const avgCapacity = completionDays > 0 ? Math.round((recentDone.length / completionDays) * 10) / 10 : 5;
    return { dailyTasks: dailyTasks, overloadedDays: overloadedDays, emptyDays: emptyDays, avgCapacity: avgCapacity };
  }

  async function suggestReschedule() {
    const data = getData();
    const today = todayStr();
    const workload = analyzeWorkload();
    const candidates = data.tasks.filter(function (t) {
      return t.status !== 'done' && !t.archived && t.dueDate && t.dueDate <= today;
    });
    if (candidates.length === 0) return [];
    if (hasAI()) {
      const ctx = buildAIContext('all', null, 'minimal');
      const taskList = candidates
        .map(function (t) {
          const proj = data.projects.find(function (p) {
            return p.id === t.project;
          });
          return (
            t.id +
            '|' +
            t.title +
            '|' +
            t.priority +
            '|' +
            t.dueDate +
            '|' +
            (proj ? proj.name : 'none') +
            '|' +
            (t.estimatedMinutes || 0) +
            'm'
          );
        })
        .join('\n');
      const weekDays = Object.entries(workload.dailyTasks)
        .map(function (entry) {
          return entry[0] + ': ' + entry[1].length + ' tasks';
        })
        .join(', ');
      const prompt =
        ctx +
        "\n\nYou need to reschedule overdue/today tasks to balance the user's week.\n\nOVERDUE/TODAY TASKS (id|title|priority|dueDate|project|estimate):\n" +
        taskList +
        '\n\nCURRENT WEEK LOAD: ' +
        weekDays +
        '\nAverage daily capacity: ' +
        workload.avgCapacity +
        ' tasks/day\n\nRULES:\n- Spread tasks across the next 7 days, avoiding overload (max ' +
        Math.ceil(workload.avgCapacity) +
        ' tasks per day)\n- Urgent tasks should be moved to sooner days (tomorrow or day after)\n- Important tasks within 3 days, normal/low tasks can go further out\n- Keep estimated time per day reasonable\n- Give a brief reason for each suggestion (8 words max)\n\nReturn ONLY a JSON array:\n[{ "id": "task_id", "suggestedDate": "YYYY-MM-DD", "reason": "brief reason" }]';
      try {
        const reply = await callAI(prompt, { maxTokens: 16384, temperature: 0.3 });
        const json = JSON.parse(
          reply
            .replace(/```json?\s*/g, '')
            .replace(/```/g, '')
            .trim(),
        );
        if (Array.isArray(json)) {
          return json
            .map(function (item) {
              const task = findTask(item.id);
              if (!task) return null;
              return {
                taskId: item.id,
                taskTitle: task.title,
                currentDueDate: task.dueDate,
                suggestedDueDate: item.suggestedDate,
                reason: item.reason || 'AI-suggested rebalance',
              };
            })
            .filter(Boolean);
        }
      } catch (err) {
        console.error('AI reschedule failed, falling back to simple algorithm:', err);
      }
    }
    const priorityOrder = { urgent: 0, important: 1, normal: 2, low: 3 };
    const sorted = [...candidates].sort(function (a, b) {
      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    });
    const suggestions = [];
    sorted.forEach(function (t, i) {
      const dayOffset = Math.floor(i / Math.max(Math.ceil(sorted.length / 3), 1)) + 1;
      const dd = new Date();
      dd.setDate(dd.getDate() + dayOffset);
      const suggestedDate =
        dd.getFullYear() +
        '-' +
        String(dd.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(dd.getDate()).padStart(2, '0');
      const reasons = {
        urgent: 'High priority \u2014 scheduled soon',
        important: 'Important \u2014 near-term slot',
        normal: 'Spread to balance load',
        low: 'Low priority \u2014 later slot',
      };
      suggestions.push({
        taskId: t.id,
        taskTitle: t.title,
        currentDueDate: t.dueDate,
        suggestedDueDate: suggestedDate,
        reason: reasons[t.priority] || 'Rebalanced across week',
      });
    });
    return suggestions;
  }

  function showRescheduleModal(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      showToast('No tasks to reschedule');
      return;
    }
    let rows = '';
    suggestions.forEach(function (s, i) {
      rows +=
        '<tr class="reschedule-row" data-idx="' +
        i +
        '">' +
        '<td class="reschedule-cell reschedule-title">' +
        esc(s.taskTitle) +
        '</td>' +
        '<td class="reschedule-cell reschedule-date">' +
        s.currentDueDate +
        '</td>' +
        '<td class="reschedule-cell reschedule-date reschedule-suggested">' +
        s.suggestedDueDate +
        '</td>' +
        '<td class="reschedule-cell reschedule-reason">' +
        esc(s.reason) +
        '</td>' +
        '<td class="reschedule-cell reschedule-actions">' +
        '<button class="btn btn-sm reschedule-accept-btn" data-action="reschedule-accept" data-idx="' +
        i +
        '">Accept</button>' +
        '<button class="btn btn-sm reschedule-skip-btn" data-action="reschedule-skip" data-idx="' +
        i +
        '">Skip</button>' +
        '</td></tr>';
    });
    const html =
      '<div class="modal-overlay" data-action="close-modal" data-click-self="true">' +
      '<div class="modal reschedule-modal">' +
      '<div class="reschedule-header">' +
      '<span class="reschedule-icon">\uD83D\uDD04</span>' +
      '<div><h3 class="reschedule-heading">Rebalance Your Week</h3>' +
      '<p class="reschedule-subtext">AI suggests rescheduling ' +
      suggestions.length +
      ' task' +
      (suggestions.length > 1 ? 's' : '') +
      ' to balance your week</p></div>' +
      '</div>' +
      '<div class="reschedule-table-wrap"><table class="reschedule-table">' +
      '<thead><tr><th>Task</th><th>Current Due</th><th>Suggested Due</th><th>Reason</th><th></th></tr></thead>' +
      '<tbody id="rescheduleBody">' +
      rows +
      '</tbody>' +
      '</table></div>' +
      '<div class="reschedule-footer">' +
      '<button class="btn reschedule-accept-all-btn" data-action="reschedule-accept-all">Accept All</button>' +
      '<button class="btn reschedule-cancel-btn" data-action="close-modal">Cancel</button>' +
      '</div>' +
      '</div></div>';
    $('#modalRoot').innerHTML = html;
    const modal = document.querySelector('.reschedule-modal');
    if (modal) modal._suggestions = suggestions;
  }

  function acceptReschedule(idx) {
    const modal = document.querySelector('.reschedule-modal');
    if (!modal || !modal._suggestions) return;
    const s = modal._suggestions[idx];
    if (!s) return;
    updateTask(s.taskId, { dueDate: s.suggestedDueDate });
    const row = document.querySelector('.reschedule-row[data-idx="' + idx + '"]');
    if (row) {
      row.style.opacity = '0.4';
      row.style.textDecoration = 'line-through';
      row.querySelectorAll('button').forEach(function (b) {
        b.disabled = true;
      });
    }
    s._accepted = true;
  }

  function skipReschedule(idx) {
    const row = document.querySelector('.reschedule-row[data-idx="' + idx + '"]');
    if (row) row.remove();
    const modal = document.querySelector('.reschedule-modal');
    if (modal && modal._suggestions) modal._suggestions[idx] = null;
  }

  function acceptAllReschedules() {
    const modal = document.querySelector('.reschedule-modal');
    if (!modal || !modal._suggestions) return;
    let count = 0;
    modal._suggestions.forEach(function (s) {
      if (s && !s._accepted) {
        updateTask(s.taskId, { dueDate: s.suggestedDueDate });
        count++;
      }
    });
    $('#modalRoot').innerHTML = '';
    if (count > 0) {
      showToast('Rescheduled ' + count + ' task' + (count > 1 ? 's' : ''));
      render();
    }
  }

  async function autoRebalanceWeek() {
    const workload = analyzeWorkload();
    const today = todayStr();
    const data = getData();
    const overdueCount = data.tasks.filter(function (t) {
      return t.status !== 'done' && !t.archived && t.dueDate && t.dueDate < today;
    }).length;
    if (workload.overloadedDays.length === 0 && overdueCount === 0) {
      showToast('Your week looks balanced \u2014 no rebalancing needed');
      return;
    }
    showToast('Analyzing workload...', false);
    try {
      const suggestions = await suggestReschedule();
      if (suggestions.length === 0) {
        showToast('No tasks to reschedule');
        return;
      }
      showRescheduleModal(suggestions);
    } catch (err) {
      console.error('Rebalance error:', err);
      showToast('Rebalancing failed \u2014 try again', true);
    }
  }

  function isWeekOverloaded() {
    const data = getData();
    const today = todayStr();
    const overdueCount = data.tasks.filter(function (t) {
      return t.status !== 'done' && !t.archived && t.dueDate && t.dueDate < today;
    }).length;
    if (overdueCount >= 3) return true;
    const workload = analyzeWorkload();
    return workload.overloadedDays.length > 0;
  }

  return {
    planMyDay,
    sendNarrativeReply,
    snoozePlanTask,
    replanDay,
    analyzeWorkload,
    suggestReschedule,
    showRescheduleModal,
    acceptReschedule,
    skipReschedule,
    acceptAllReschedules,
    autoRebalanceWeek,
    isWeekOverloaded,
  };
}
