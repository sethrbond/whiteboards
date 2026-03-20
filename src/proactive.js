// ============================================================
// PROACTIVE AI MODULE — Coordinator
// ============================================================
// Thin coordinator that delegates to focused sub-modules:
// - proactive-briefing.js: daily briefing, end-of-day, AI status
// - proactive-nudges.js: nudges, reflections, check-ins, vague tasks
// - proactive-planning.js: day planning, reschedule, workload analysis
//
// Keeps shared functions and functions used across sub-modules.

import { MS_PER_DAY, AI_DELAY_MS } from './constants.js';

import { AI_PERSONA_SHORT } from './ai-context.js';
import { createProactiveBriefing } from './proactive-briefing.js';
import { createProactiveNudges } from './proactive-nudges.js';
import { createProactivePlanning } from './proactive-planning.js';

export const VAGUE_WORDS = ['organize', 'figure out', 'look into', 'deal with', 'work on'];

const PROACTIVE_PATTERNS = [
  {
    regex: /\b(email|message|write to|reach out|contact|follow up with|reply to|send a message)\b/i,
    type: 'email',
    action: 'drafted email',
  },
  { regex: /\b(apply|application|submit|register|sign up|enroll)\b/i, type: 'application', action: 'pre-filled notes' },
  { regex: /\b(call|schedule|book|phone|arrange|meeting)\b/i, type: 'call', action: 'pre-filled notes' },
  {
    regex: /\b(research|look up|find|investigate|compare|evaluate|look into)\b/i,
    type: 'research',
    action: 'added research',
  },
  {
    regex: /\b(prepare|presentation|deck|outline|plan|organize|proposal)\b/i,
    type: 'prepare',
    action: 'broke down task',
  },
  { regex: /\b(draft|write|create doc|report)\b/i, type: 'document', action: 'drafted email' },
  { regex: /\b(review|check|audit|assess|inspect)\b/i, type: 'review', action: 'added research' },
];

/**
 * Factory function to create proactive AI functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ matchProactivePattern, saveProactiveLog, getAIPreparedTaskIds, filterAIPrepared, maybeProactiveEnhance, runProactiveWorker, planMyDay, snoozePlanTask, replanDay, generateAIBriefing, submitEndOfDay, getSmartNudges, nudgeFilterOverdue, nudgeFilterStale, nudgeFilterUnassigned, maybeReflect, showReflectionToast, getStuckTasks, processRecurringTasks, getAIStatusItems, getSmartFeedItems, extractMemoryInsights, trackNudgeInteraction, PROACTIVE_PATTERNS }}
 */
export function createProactive(deps) {
  const {
    $,
    esc,
    sanitizeAIHTML,
    todayStr,
    localISO,
    genId,
    getData,
    userKey,
    hasAI,
    callAI,
    buildAIContext,
    addAIMemory,
    findTask,
    updateTask,
    addTask,
    createTask,
    isBlocked,
    showToast,
    render,
    setView,
    notifyOverdueTasks,
    getProactiveLog,
    setProactiveLog,
    getProactiveRunning,
    setProactiveRunning,
    setBriefingGenerating,
    setPlanGenerating,
    setNudgeFilter,
    setProactiveResults,
    setPlanIndexCache,
  } = deps;

  // ── Shared helpers (used across sub-modules) ────────────────────────

  function matchProactivePattern(t) {
    return PROACTIVE_PATTERNS.find((p) => p.regex.test(t || ''));
  }

  function saveProactiveLog() {
    try {
      localStorage.setItem(userKey('wb_proactive_log_' + todayStr()), JSON.stringify(getProactiveLog()));
    } catch (_e) {
      console.warn('proactive log save failed:', _e.message || _e);
    }
  }

  // ── Memory Insights ─────────────────────────────────────────────────
  function extractMemoryInsights(memories) {
    const insights = {
      productive_time: null,
      avg_tasks_per_day: null,
      most_productive_day: null,
      task_order_preference: null,
      procrastination_types: [],
    };
    if (memories && memories.length) {
      for (const m of memories) {
        const txt = (m.text || '').toLowerCase();

        // productive_time
        if (!insights.productive_time) {
          if (
            txt.includes('morning') &&
            (txt.includes('most tasks') || txt.includes('productive') || txt.includes('completes'))
          )
            insights.productive_time = 'morning';
          else if (
            txt.includes('afternoon') &&
            (txt.includes('most tasks') || txt.includes('productive') || txt.includes('completes'))
          )
            insights.productive_time = 'afternoon';
          else if (
            txt.includes('evening') &&
            (txt.includes('most tasks') || txt.includes('productive') || txt.includes('completes'))
          )
            insights.productive_time = 'evening';
        }

        // avg_tasks_per_day
        if (insights.avg_tasks_per_day === null) {
          const avgMatch = txt.match(/(\d+(?:\.\d+)?)\s*tasks?\s*per\s*day/);
          if (avgMatch) insights.avg_tasks_per_day = parseFloat(avgMatch[1]);
        }

        // most_productive_day
        if (!insights.most_productive_day) {
          const dayMatch = txt.match(
            /most productive day.*?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i,
          );
          if (dayMatch)
            insights.most_productive_day = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1).toLowerCase();
        }

        // task_order_preference
        if (!insights.task_order_preference) {
          if (txt.includes('hard') && txt.includes('first')) insights.task_order_preference = 'hard-first';
          else if (txt.includes('easy') && txt.includes('first')) insights.task_order_preference = 'easy-first';
          else if (txt.includes('quick wins') && txt.includes('first')) insights.task_order_preference = 'easy-first';
        }

        // procrastination_types
        if (
          txt.includes('avoid') ||
          txt.includes('procrastinat') ||
          txt.includes('puts off') ||
          txt.includes('delays')
        ) {
          for (const pType of [
            'email',
            'call',
            'research',
            'writing',
            'planning',
            'review',
            'admin',
            'documentation',
          ]) {
            if (txt.includes(pType) && !insights.procrastination_types.includes(pType)) {
              insights.procrastination_types.push(pType);
            }
          }
        }
      }
    } // end if (memories && memories.length)

    // Derive avg_tasks_per_day from done tasks if not found in memories
    if (insights.avg_tasks_per_day === null) {
      try {
        const data = getData();
        const done = data.tasks.filter((t) => t.status === 'done' && t.completedAt);
        if (done.length >= 7) {
          const twoWeeksAgo = new Date(Date.now() - 14 * MS_PER_DAY).toISOString().slice(0, 10);
          const recentDone = done.filter((t) => t.completedAt.slice(0, 10) >= twoWeeksAgo);
          if (recentDone.length > 0) {
            insights.avg_tasks_per_day = Math.round((recentDone.length / 14) * 10) / 10;
          }
        }
      } catch (_e) {
        /* ignore data access errors */
      }
    }

    return insights;
  }

  function _buildInsightsPromptSection(insights) {
    const parts = [];
    if (insights.productive_time) parts.push('User is most productive in the ' + insights.productive_time + '.');
    if (insights.avg_tasks_per_day) parts.push('Averages ~' + insights.avg_tasks_per_day + ' tasks per day.');
    if (insights.most_productive_day) parts.push('Most productive on ' + insights.most_productive_day + 's.');
    if (insights.task_order_preference) parts.push('Prefers ' + insights.task_order_preference + ' approach.');
    if (insights.procrastination_types.length)
      parts.push('Tends to avoid: ' + insights.procrastination_types.join(', ') + ' tasks.');
    if (!parts.length) return '';
    return '\nUSER PATTERNS (from memory):\n' + parts.join('\n') + '\n';
  }

  // ── Instantiate sub-modules ─────────────────────────────────────────

  // planning is defined later — use lazy ref so briefing can trigger plan after EOD
  let _planningRef = null;
  const briefing = createProactiveBriefing({
    sanitizeAIHTML,
    todayStr,
    getData,
    userKey,
    hasAI,
    callAI,
    buildAIContext,
    addAIMemory,
    showToast,
    notifyOverdueTasks,
    extractMemoryInsights,
    _buildInsightsPromptSection,
    getAIMemory: deps.getAIMemory,
    planMyDay: () => _planningRef && _planningRef.planMyDay(),
  });

  const nudges = createProactiveNudges({
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
  });

  const planning = createProactivePlanning({
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
    getAIMemory: deps.getAIMemory,
    generateAIBriefing: () => briefing.generateAIBriefing(),
  });
  _planningRef = planning;

  // ── Functions that stay in the coordinator ───────────────────────────

  function getAIPreparedTaskIds() {
    return new Set(getProactiveLog().map((l) => l.taskId));
  }

  function filterAIPrepared() {
    const ids = getAIPreparedTaskIds();
    if (!ids.size) {
      showToast('No AI-prepared tasks today');
      return;
    }
    const data = getData();
    const tasks = data.tasks.filter(function (t) {
      return ids.has(t.id) && t.status !== 'done';
    });
    if (!tasks.length) {
      showToast('No active AI-prepared tasks');
      return;
    }
    let h =
      '<div style="padding:20px"><h3 style="margin-bottom:16px;color:var(--accent)">AI Prepared Tasks (' +
      tasks.length +
      ')</h3>';
    tasks.forEach(function (t) {
      h +=
        '<div class="task-row" data-task="' +
        t.id +
        '" style="cursor:pointer" data-action="cmd-go-task" data-task-id="' +
        t.id +
        '" data-project-id=""><div class="task-body"><div class="task-title">' +
        esc(t.title) +
        '</div></div></div>';
    });
    h += '</div>';
    $('#modalRoot').innerHTML =
      '<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" style="max-width:600px">' +
      h +
      '</div></div>';
  }

  function maybeProactiveEnhance(tk) {
    if (!hasAI() || !tk) return;
    const m = matchProactivePattern(tk.title);
    if (!m) return;
    setTimeout(async () => {
      try {
        const data = getData();
        const t = data.tasks.find((x) => x.id === tk.id);
        if (!t || t.status === 'done' || (t.notes && t.notes.length > 50)) return;
        const r = await callAI('Draft:' + t.title + ' Type:' + m.type, {
          maxTokens: 2048,
          system:
            AI_PERSONA_SHORT +
            '\n\nDraft a brief, actionable expansion of this task. 2-3 bullet points max. No preamble.',
        });
        if (!r) return;
        updateTask(tk.id, { notes: (t.notes || '') + '\n**AI Draft:**\n' + r.trim() });
        const log = getProactiveLog();
        log.push({ taskId: tk.id, taskTitle: t.title, action: m.action, timestamp: Date.now() });
        setProactiveLog(log);
        saveProactiveLog();
        render();
      } catch (_e) {
        console.warn('proactive AI enhance failed:', _e.message || _e);
      }
    }, AI_DELAY_MS);
  }

  async function runProactiveWorker() {
    if (!hasAI()) return;
    const flagKey = userKey('whiteboard_proactive_' + todayStr());
    if (localStorage.getItem(flagKey)) return; // already ran today
    if (getProactiveRunning()) return;
    setProactiveRunning(true);
    localStorage.setItem(flagKey, '1'); // set early to prevent re-entry

    try {
      const _patterns = [
        {
          regex: /\b(email|write to|reach out|message|send a message|draft)\b/i,
          type: 'email',
          instruction:
            'Draft the email/message for them. Include a subject line, greeting, body, and sign-off. Be professional but warm. Use placeholders like [Name] where needed.',
        },
        {
          regex: /\b(apply|application|sign up|register|enroll)\b/i,
          type: 'application',
          instruction:
            'Find the most likely URL where they would go to do this. Provide the direct link and a brief step-by-step of what they will need (documents, info, etc.).',
        },
        {
          regex: /\b(call|schedule|book|phone)\b/i,
          type: 'call',
          instruction:
            'Write a brief call script or meeting agenda. Include key talking points, questions to ask, and any prep needed beforehand.',
        },
        {
          regex: /\b(research|look into|find|investigate|compare)\b/i,
          type: 'research',
          instruction:
            'Provide initial research findings. List key facts, options, pros/cons, or recommendations. Be specific and cite what you know.',
        },
        {
          regex: /\b(prepare|presentation|deck|outline|plan|proposal)\b/i,
          type: 'prepare',
          instruction:
            'Create a structured outline with sections, key points for each, and suggested content. Make it immediately usable as a starting framework.',
        },
      ];

      const data = getData();
      const proactiveLog = getProactiveLog();
      const candidates = data.tasks
        .filter((t) => {
          if (t.status === 'done') return false;
          if (t.notes && t.notes.length > 50) return false; // don't overwrite substantial notes
          if (proactiveLog.some((l) => l.taskId === t.id)) return false; // already enhanced
          return matchProactivePattern(t.title);
        })
        .slice(0, 10); // max 10 tasks per daily run

      if (candidates.length === 0) {
        setProactiveRunning(false);
        return;
      }

      // Build a single batched prompt for all candidates
      const taskDescriptions = candidates
        .map((t, i) => {
          const matched = matchProactivePattern(t.title);
          const proj = data.projects.find((p) => p.id === t.project);
          return `TASK ${i + 1}:
ID: ${t.id}
Title: ${t.title}
Project: ${proj ? proj.name : 'none'}
Current notes: ${t.notes || '(empty)'}
Type: ${matched.type}
Instruction: ${matched.instruction}`;
        })
        .join('\n\n');

      const prompt = `You are the user's productivity partner who already started the work. For each task below, generate the most useful head start. Be specific and actionable — write as if you've already begun doing the task for them.

${taskDescriptions}

Return ONLY a JSON array with one object per task, no other text:
[
  { "id": "task_id", "notes": "the pre-work content you generated" },
  ...
]

RULES:
- Each notes field should be 100-400 words of genuinely useful content
- If it's an email, write the full draft
- If it's an application, include the URL and steps
- If it's research, provide real findings
- If it's a call, write a script/agenda
- If it's preparation, write the outline
- Use markdown formatting (headers, bullets, bold) for readability
- Do NOT wrap in code fences`;

      const reply = await callAI(prompt, { maxTokens: 4096, temperature: 0.3 });
      const json = JSON.parse(
        reply
          .replace(/```json?\s*/g, '')
          .replace(/```/g, '')
          .trim(),
      );

      if (Array.isArray(json) && json.length) {
        let filled = 0;
        const log = getProactiveLog();
        for (const item of json) {
          const task = findTask(item.id);
          if (task && item.notes && (!task.notes || task.notes.length <= 50)) {
            const prefix = task.notes ? task.notes + '\n\n---\n**AI Draft:**\n' : '**AI Draft:**\n';
            updateTask(item.id, { notes: prefix + item.notes });
            const matched = matchProactivePattern(task.title);
            log.push({
              taskId: item.id,
              taskTitle: task.title,
              action: matched ? matched.action : 'pre-filled notes',
              timestamp: Date.now(),
            });
            filled++;
          }
        }
        if (filled > 0) {
          setProactiveLog(log);
          saveProactiveLog();
          setProactiveResults({
            count: filled,
            taskIds: json.map(function (x) {
              return x.id;
            }),
            date: todayStr(),
          });
          showToast(
            '\u2726 AI prepared ' + filled + ' task' + (filled > 1 ? 's' : '') + ' with smart suggestions',
            false,
          );
          render();
        }
      }
    } catch (err) {
      console.error('Proactive worker error:', err);
      // Silent failure — don't bother user with background worker errors
    } finally {
      setProactiveRunning(false);
    }
  }

  function processRecurringTasks() {
    const today = todayStr();
    const data = getData();
    const recurring = data.tasks.filter((t) => t.recurrence && t.status === 'done' && t.completedAt);
    let created = 0;

    recurring.forEach((t) => {
      const completedDate = new Date(t.completedAt);
      const nextDate = new Date(completedDate);

      if (t.recurrence === 'daily') nextDate.setDate(nextDate.getDate() + 1);
      else if (t.recurrence === 'weekdays') {
        nextDate.setDate(nextDate.getDate() + 1);
        const dow = nextDate.getDay();
        if (dow === 6)
          nextDate.setDate(nextDate.getDate() + 2); // Saturday -> Monday
        else if (dow === 0) nextDate.setDate(nextDate.getDate() + 1); // Sunday -> Monday
      } else if (t.recurrence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
      else if (t.recurrence === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
      else return;

      const nextStr = localISO(nextDate);
      if (nextStr > today) return; // Not due yet

      // Check if we already created a new instance
      const exists = data.tasks.find(
        (x) => x.title === t.title && x.project === t.project && x.status !== 'done' && x.recurrence === t.recurrence,
      );
      if (exists) return;

      const newTask = createTask({
        title: t.title,
        notes: t.notes,
        priority: t.priority,
        project: t.project,
        phase: t.phase,
        recurrence: t.recurrence,
        dueDate: nextStr,
        subtasks: (t.subtasks || []).map((s) => ({ id: genId('st'), title: s.title, done: false })),
      });
      addTask(newTask);
      created++;
    });

    if (created) showToast(`${created} recurring task${created > 1 ? 's' : ''} created`);
  }

  // ============================================================
  // SMART DEFAULTS — AI-suggested fields on task creation
  // ============================================================
  function getSmartDefaults(title) {
    if (!title || !title.trim()) return {};
    const data = getData();
    const lower = title.toLowerCase();
    const result = {};
    const urgentKW = /\b(urgent|asap|deadline|emergency|critical|immediately|right now|time.?sensitive)\b/i;
    const importantKW = /\b(important|high.?priority|must|need to|essential|key|vital)\b/i;
    const lowKW = /\b(someday|maybe|eventually|low.?priority|nice to have|when I get around)\b/i;
    if (urgentKW.test(title)) {
      result.suggestedPriority = 'urgent';
    } else if (importantKW.test(title)) {
      result.suggestedPriority = 'important';
    } else if (lowKW.test(title)) {
      result.suggestedPriority = 'low';
    } else {
      const ct = data.tasks.filter((t) => t.status === 'done' && t.completedAt);
      const ws = lower.split(/\s+/).filter((w) => w.length > 3);
      if (ws.length > 0) {
        const pc = { urgent: 0, important: 0, normal: 0, low: 0 };
        let matched = 0;
        ct.forEach((t) => {
          const tl = t.title.toLowerCase();
          const ov = ws.filter((w) => tl.includes(w)).length;
          if (ov >= Math.max(1, ws.length * 0.4)) {
            pc[t.priority] = (pc[t.priority] || 0) + 1;
            matched++;
          }
        });
        if (matched >= 3) {
          const top = Object.entries(pc)
            .filter(([p]) => p !== 'normal')
            .sort((a, b) => b[1] - a[1])[0];
          if (top && top[1] >= matched * 0.5) result.suggestedPriority = top[0];
        }
      }
    }
    const doneT = data.tasks.filter((t) => t.status === 'done' && t.completedAt && t.createdAt);
    const words = lower.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0 && doneT.length >= 5) {
      const durations = [];
      doneT.forEach((t) => {
        const tl = t.title.toLowerCase();
        const ov = words.filter((w) => tl.includes(w)).length;
        if (ov >= Math.max(1, words.length * 0.4)) {
          const d = Math.round((new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / MS_PER_DAY);
          if (d >= 0 && d <= 90) durations.push(d);
        }
      });
      // Due date suggestions removed — never invent deadlines the user didn't set
    }
    if (data.projects.length > 0) {
      let bestProj = null,
        bestScore = 0;
      data.projects.forEach((p) => {
        const pw = p.name.toLowerCase().split(/\s+/);
        let sc = 0;
        pw.forEach((w) => {
          if (w.length >= 3 && lower.includes(w)) sc += 2;
        });
        data.tasks
          .filter((t) => t.project === p.id)
          .forEach((t) => {
            const tl = t.title.toLowerCase();
            const ov = words.filter((w) => tl.includes(w)).length;
            if (ov >= Math.max(1, words.length * 0.3)) sc += 1;
          });
        if (sc > bestScore) {
          bestScore = sc;
          bestProj = p;
        }
      });
      if (bestProj && bestScore >= 2) {
        result.suggestedProject = bestProj.id;
        result.suggestedProjectName = bestProj.name;
      }
    }
    if (doneT.length >= 3) {
      const ests = [];
      doneT.forEach((t) => {
        if (!t.estimatedMinutes || t.estimatedMinutes <= 0) return;
        const tl = t.title.toLowerCase();
        const ov = words.filter((w) => tl.includes(w)).length;
        if (ov >= Math.max(1, words.length * 0.4)) ests.push(t.estimatedMinutes);
      });
      if (ests.length >= 2) {
        ests.sort((a, b) => a - b);
        result.suggestedEstimate = ests[Math.floor(ests.length / 2)];
      }
    }
    // Recurrence inference
    const dailyKW = /\b(daily|every day|each day|morning|evening|nightly)\b/i;
    const weeklyKW = /\b(weekly|every week|each week)\b/i;
    const monthlyKW = /\b(monthly|every month|each month)\b/i;
    const weekdayKW = /\b(weekdays?|mon-fri|work days?)\b/i;

    if (dailyKW.test(title)) result.suggestedRecurrence = 'daily';
    else if (weekdayKW.test(title)) result.suggestedRecurrence = 'weekdays';
    else if (weeklyKW.test(title)) result.suggestedRecurrence = 'weekly';
    else if (monthlyKW.test(title)) result.suggestedRecurrence = 'monthly';

    if (typeof deps.getAIMemory === 'function') {
      const mem = deps.getAIMemory();
      mem
        .filter((m) => m.type === 'pattern' || m.type === 'preference')
        .forEach((m) => {
          const ml = (m.text || '').toLowerCase();
          if (!result.suggestedPriority && ml.includes('always urgent') && words.some((w) => ml.includes(w)))
            result.suggestedPriority = 'urgent';
          if (!result.suggestedPriority && ml.includes('always important') && words.some((w) => ml.includes(w)))
            result.suggestedPriority = 'important';
        });
    }
    return result;
  }

  // ============================================================
  // TASK COMPLETION PREDICTIONS
  // ============================================================
  function predictCompletion(taskId) {
    const data = getData();
    const t = findTask(taskId);
    if (!t || t.status === 'done') return null;
    const today = todayStr();
    const ct = data.tasks.filter((x) => x.status === 'done' && x.completedAt && x.createdAt);
    const thirtyAgo = new Date(Date.now() - 30 * MS_PER_DAY).toISOString().slice(0, 10);
    const recentDone = ct.filter((x) => x.completedAt.slice(0, 10) >= thirtyAgo);
    const avgPerDay = recentDone.length / 30;
    const activeList = data.tasks.filter((x) => x.status !== 'done' && !x.archived);
    const activeCount = activeList.length;
    const pw = t.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const simDur = [];
    ct.forEach((x) => {
      const xl = x.title.toLowerCase();
      const ov = pw.filter((w) => xl.includes(w)).length;
      if (ov >= Math.max(1, pw.length * 0.3)) {
        const d = Math.round((new Date(x.completedAt).getTime() - new Date(x.createdAt).getTime()) / MS_PER_DAY);
        if (d >= 0 && d <= 90) simDur.push(d);
      }
    });
    const pf = { urgent: 0.7, important: 0.85, normal: 1.0, low: 1.3 }[t.priority] || 1.0;
    let estDays;
    if (simDur.length >= 2) {
      simDur.sort((a, b) => a - b);
      estDays = simDur[Math.floor(simDur.length / 2)] * pf;
    } else if (t.estimatedMinutes && avgPerDay > 0) {
      estDays = Math.ceil((t.estimatedMinutes / 240) * pf);
    } else {
      estDays = avgPerDay > 0 ? Math.ceil((activeCount / avgPerDay) * 0.3 * pf) : 7;
    }
    estDays = Math.max(1, Math.min(Math.round(estDays), 60));
    const startD = t.createdAt && t.createdAt.slice(0, 10) > today ? t.createdAt.slice(0, 10) : today;
    const estDate = new Date(new Date(startD + 'T12:00:00').getTime() + estDays * MS_PER_DAY);
    const estimatedDate = localISO(estDate);
    const blockers = [];
    if (isBlocked(t)) blockers.push('Task is blocked by dependencies');
    if (t.dueDate && t.dueDate < today) blockers.push('Already overdue');
    if (activeCount > 30) blockers.push('Heavy workload (' + activeCount + ' active tasks)');
    if (t.createdAt) {
      const dsc = Math.round((Date.now() - new Date(t.createdAt).getTime()) / MS_PER_DAY);
      if (dsc > 14 && t.status === 'todo') blockers.push('Untouched for ' + dsc + ' days');
    }
    let likelihood;
    if (blockers.length >= 2 || isBlocked(t)) likelihood = 'low';
    else if (blockers.length === 1 || estDays > 14 || activeCount > 20) likelihood = 'medium';
    else likelihood = 'high';
    return { likelihood, estimatedDate, estimatedDays: estDays, blockers };
  }

  // ============================================================
  // FOLLOW-UP SUGGESTIONS — after completing a task
  // ============================================================
  function getFollowUpSuggestions(completedTask) {
    if (!completedTask) return [];
    const data = getData();
    const suggestions = [];
    // 1. Tasks unblocked by this completion
    data.tasks
      .filter((t) => {
        if (t.status === 'done' || t.archived) return false;
        if (!t.blockedBy || !t.blockedBy.includes(completedTask.id)) return false;
        return t.blockedBy
          .filter((bid) => bid !== completedTask.id)
          .every((bid) => {
            const b = findTask(bid);
            return !b || b.status === 'done';
          });
      })
      .forEach((t) => {
        suggestions.push({
          type: 'unblocked',
          taskId: t.id,
          text: ' + t.title +  is no longer blocked — ready to start?',
        });
      });
    // 2. Related tasks in same project
    if (completedTask.project) {
      const spTasks = data.tasks.filter(
        (t) => t.id !== completedTask.id && t.project === completedTask.project && t.status !== 'done' && !t.archived,
      );
      const fw = completedTask.title
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      if (fw.length > 0 && spTasks.length > 0) {
        const scored = spTasks
          .map((t) => ({ task: t, score: fw.filter((w) => t.title.toLowerCase().includes(w)).length }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score);
        if (scored.length > 0 && !suggestions.find((s) => s.taskId === scored[0].task.id)) {
          suggestions.push({
            type: 'related',
            taskId: scored[0].task.id,
            text:
              'Since you finished "' +
              completedTask.title +
              '", you might want to tackle "' +
              scored[0].task.title +
              '" next',
          });
        }
      }
      if (!suggestions.find((s) => s.type === 'related') && spTasks.length > 0) {
        const po = { urgent: 0, important: 1, normal: 2, low: 3 };
        const sorted = [...spTasks].sort((a, b) => (po[a.priority] || 2) - (po[b.priority] || 2));
        if (!suggestions.find((s) => s.taskId === sorted[0].id)) {
          suggestions.push({
            type: 'related',
            taskId: sorted[0].id,
            text: 'Next up in this project: "' + sorted[0].title + '"',
          });
        }
      }
    }
    // 3. Project nearly done
    if (completedTask.project) {
      const rem = data.tasks.filter((t) => t.project === completedTask.project && t.status !== 'done' && !t.archived);
      if (rem.length > 0 && rem.length <= 3) {
        const proj = data.projects.find((p) => p.id === completedTask.project);
        suggestions.push({
          type: 'almost-done',
          text:
            'Only ' +
            rem.length +
            ' task' +
            (rem.length === 1 ? '' : 's') +
            ' left in ' +
            (proj ? proj.name : 'this project') +
            ' — finish line is close!',
        });
      }
    }
    return suggestions.slice(0, 3);
  }

  function getSmartFeedItems() {
    const today = todayStr();
    const data = getData();
    const active = data.tasks.filter((t) => t.status !== 'done' && !t.archived);
    const weekFromNow = new Date(Date.now() + 7 * MS_PER_DAY).toISOString().slice(0, 10);

    // Check if there's a day plan — if so, exclude plan tasks from smart feed
    const planKey = userKey('whiteboard_plan_' + today);
    const cachedPlan = localStorage.getItem(planKey);
    let planTaskIds = new Set();
    if (cachedPlan) {
      try {
        const plan = JSON.parse(cachedPlan);
        planTaskIds = new Set(plan.map((p) => p.id));
      } catch (_e) {
        console.warn('proactive log parse failed:', _e.message || _e);
      }
    }

    // Build smart feed from task data (excluding plan tasks when a plan exists)
    const items = [];
    const seen = new Set();

    // 1. Overdue first
    const overdue = active.filter((t) => t.dueDate && t.dueDate < today && !planTaskIds.has(t.id));
    overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    overdue.forEach((t) => {
      if (!seen.has(t.id)) {
        items.push({ task: t, source: 'overdue' });
        seen.add(t.id);
      }
    });

    // 2. Urgent
    const urgent = active.filter((t) => t.priority === 'urgent' && !seen.has(t.id) && !planTaskIds.has(t.id));
    urgent.forEach((t) => {
      items.push({ task: t, source: 'urgent' });
      seen.add(t.id);
    });

    // 3. In progress
    const inProg = active.filter((t) => t.status === 'in-progress' && !seen.has(t.id) && !planTaskIds.has(t.id));
    inProg.forEach((t) => {
      items.push({ task: t, source: 'in-progress' });
      seen.add(t.id);
    });

    // 4. Due soon (this week)
    const dueSoon = active.filter(
      (t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekFromNow && !seen.has(t.id) && !planTaskIds.has(t.id),
    );
    dueSoon.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    dueSoon.forEach((t) => {
      items.push({ task: t, source: 'due-soon' });
      seen.add(t.id);
    });

    // 5. Due today
    const dueToday = active.filter((t) => t.dueDate === today && !seen.has(t.id) && !planTaskIds.has(t.id));
    dueToday.forEach((t) => {
      items.push({ task: t, source: 'due-today' });
      seen.add(t.id);
    });

    return items;
  }

  // ── Board narrative generation ──────────────────────────────────────
  async function generateBoardNarrative(projectId) {
    if (!hasAI()) return;
    const data = getData();
    const proj = data.projects.find((p) => p.id === projectId);
    if (!proj) return;
    const tasks = data.tasks.filter((t) => t.project === projectId && !t.archived);
    if (tasks.length < 2) return;

    const today = todayStr();
    const active = tasks.filter((t) => t.status !== 'done');
    const done = tasks.filter((t) => t.status === 'done');
    const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
    const dueThisWeek = active.filter((t) => {
      if (!t.dueDate) return false;
      const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      return t.dueDate >= today && t.dueDate <= weekEnd;
    });

    const taskSummary = active
      .slice(0, 20)
      .map((t) => {
        const due = t.dueDate ? `due ${t.dueDate}` : '';
        const est = t.estimatedMinutes ? `${t.estimatedMinutes}m` : '';
        return `- ${t.title} (${t.priority}) ${due} ${est}`.trim();
      })
      .join('\n');

    const prompt = `You are a calm, intelligent productivity partner. Write a 2-3 sentence narrative summary for this project board.

PROJECT: "${proj.name}"
${proj.description ? 'Description: ' + proj.description : ''}
Today: ${today}

${active.length} active tasks, ${done.length} completed, ${overdue.length} overdue, ${dueThisWeek.length} due this week.

Active tasks:
${taskSummary}

RULES:
- Lead with what matters most RIGHT NOW and why
- Mention timing: what's overdue, what's due soon, what can wait
- If most tasks have no deadlines, note that and suggest which to tackle first
- 2-3 sentences max. Warm, direct, second person ("Your...")
- Don't list tasks — explain the situation`;

    try {
      showToast('Generating board summary...');
      const reply = await callAI(prompt, { maxTokens: 300, temperature: 0.3 });
      const narrative = reply.trim();
      localStorage.setItem(userKey('whiteboard_board_narrative_' + projectId), narrative);
      render();
    } catch (err) {
      console.error('Board narrative error:', err);
    }
  }

  // ── Return the exact same public API ────────────────────────────────

  return {
    matchProactivePattern,
    saveProactiveLog,
    getAIPreparedTaskIds,
    filterAIPrepared,
    maybeProactiveEnhance,
    runProactiveWorker,
    planMyDay: planning.planMyDay,
    sendNarrativeReply: planning.sendNarrativeReply,
    snoozePlanTask: planning.snoozePlanTask,
    replanDay: planning.replanDay,
    generateAIBriefing: briefing.generateAIBriefing,
    submitEndOfDay: briefing.submitEndOfDay,
    getSmartNudges: nudges.getSmartNudges,
    nudgeFilterOverdue: nudges.nudgeFilterOverdue,
    nudgeFilterStale: nudges.nudgeFilterStale,
    nudgeFilterUnassigned: nudges.nudgeFilterUnassigned,
    maybeReflect: nudges.maybeReflect,
    showReflectionToast: nudges.showReflectionToast,
    getStuckTasks: nudges.getStuckTasks,
    processRecurringTasks,
    getAIStatusItems: briefing.getAIStatusItems,
    getSmartFeedItems,
    getSmartDefaults,
    predictCompletion,
    getFollowUpSuggestions,
    maybeShowCheckIn: nudges.maybeShowCheckIn,
    dismissCheckIn: nudges.dismissCheckIn,
    detectVagueTasks: nudges.detectVagueTasks,
    breakdownTask: nudges.breakdownTask,
    dismissVagueTask: nudges.dismissVagueTask,
    analyzeWorkload: planning.analyzeWorkload,
    suggestReschedule: planning.suggestReschedule,
    showRescheduleModal: planning.showRescheduleModal,
    acceptReschedule: planning.acceptReschedule,
    skipReschedule: planning.skipReschedule,
    acceptAllReschedules: planning.acceptAllReschedules,
    autoRebalanceWeek: planning.autoRebalanceWeek,
    isWeekOverloaded: planning.isWeekOverloaded,
    extractMemoryInsights,
    trackNudgeInteraction: nudges.trackNudgeInteraction,
    generateBoardNarrative,
    PROACTIVE_PATTERNS,
  };
}
