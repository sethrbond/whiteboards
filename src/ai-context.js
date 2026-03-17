// ============================================================
// AI CONTEXT, MEMORY & ACTION SYSTEM
// Handles AI persona, context building, memory management,
// pattern learning, and action execution.
// ============================================================

import { MS_PER_DAY, MAX_AI_MEMORIES, AI_CONTEXT_MAX_LENGTH } from './constants.js';
import { todayStr, localISO } from './dates.js';
import { esc, genId } from './utils.js';

// --- Shared AI Persona ---
export const AI_PERSONA = `You are the user's productivity partner — a smart assistant embedded in their productivity system called Whiteboards. You have full read/write access to their tasks, boards (projects), and AI memory.

PERSONALITY:
- Direct and concise. Default to short responses. "Done." / "Got it." / "Moved to urgent."
- Only give longer responses when the user asks for analysis, planning, or has a complex question.
- You are opinionated — if you see something that should change, say so or just do it.
- You remember things between sessions via AI memory. Use it.
- You think about workload balance, not just individual tasks.
- You PUSH the user forward. Don't just organize — help them win.

INTELLIGENCE:
- When given a task, think about what ELSE needs to happen. "Book flights" → also needs hotel, rental car, PTO request?
- When updating a project, think about how it affects the project background and keep it current.
- Notice patterns: recurring tasks, approaching deadlines, stale work, priority mismatches.
- Consider time of day: morning = planning/priorities, afternoon = execution, evening = review/planning tomorrow.
- Think about dependencies: which tasks block others?
- Track velocity: is the user ahead or behind this week?
- Suggest next steps PROACTIVELY. Don't wait to be asked.

PROACTIVE BEHAVIOR:
- If you learn something about the user's preferences, work patterns, or project context → save it to AI memory.
- If a project background should be updated based on new info → do it without asking.
- If you spot a task that's clearly misplaced, misprioritized, or stale → fix it or flag it.
- When creating tasks, think about whether they need subtasks, deadlines, or project assignment.
- When a task is completed, suggest what to do NEXT. Keep momentum.
- When the user seems stuck, offer a concrete first step — not a lecture.
- When workload is unbalanced, say so. "You have 12 tasks in Life and 0 in [Board] — that board needs attention."`;

export const AI_PERSONA_SHORT =
  'You are a sharp, direct productivity partner. One sentence responses unless asked for more. No preamble.';

// --- Action Definitions (shared across all AI touchpoints) ---
export const AI_ACTIONS_SPEC = `
ACTIONS — include a JSON block in your response to take action:
\`\`\`actions
[
  { "action": "create_task", "title": "...", "project": "Board Name", "priority": "normal|urgent|important|low", "dueDate": "YYYY-MM-DD", "notes": "...", "subtasks": ["step 1", "step 2"], "recurrence": "daily|weekly|monthly|", "phase": "...", "tags": ["tag1", "tag2"] },
  { "action": "update_task", "taskTitle": "partial match", "fields": { "priority": "...", "status": "todo|in-progress|done", "dueDate": "...", "notes": "...", "project": "Board Name", "title": "...", "tags": ["tag1"] } },
  { "action": "delete_task", "taskTitle": "partial match" },
  { "action": "move_task", "taskTitle": "partial match", "toProject": "Board Name" },
  { "action": "add_subtasks", "taskTitle": "partial match", "subtasks": ["step 1", "step 2"] },
  { "action": "split_task", "taskTitle": "partial match", "into": [{ "title": "...", "priority": "normal", "notes": "..." }, ...] },
  { "action": "batch_update", "filter": { "project": "Board Name" | "priority": "low" | "status": "todo" }, "fields": { "priority": "normal" } },
  { "action": "batch_reschedule", "filter": { "project": "Board Name" | "priority": "low|normal|important" | "dueBefore": "YYYY-MM-DD" | "dueThisWeek": true }, "daysToAdd": 3, "newDate": "YYYY-MM-DD" },
  { "action": "query", "question": "what did I accomplish this week?" },
  { "action": "create_project", "name": "...", "description": "..." },
  { "action": "update_project", "name": "existing name", "fields": { "description": "..." } },
  { "action": "update_background", "project": "Board Name", "section": "origin|direction|roadblocks|nextSteps|notes", "content": "..." },
  { "action": "save_memory", "text": "observation or preference to remember", "type": "preference|pattern|context|correction|rhythm" },
  { "action": "suggest_insight", "text": "non-actionable observation for the user", "severity": "info|warning" },
  { "action": "search_archive", "query": "search terms for archived memories about past work or deleted projects" }
]
\`\`\`

BATCH_RESCHEDULE: Use this when the user wants to push back, postpone, or reschedule multiple tasks. "daysToAdd" shifts each task's due date forward by N days. "newDate" sets all to a specific date. Use filter to target specific tasks.
SEARCH_ARCHIVE: Use this when the user asks about past work, deleted boards, or historical context. Searches archived AI memories.
QUERY: Use this when the user asks a question about their task data (e.g., "what did I accomplish?", "how many tasks are overdue?", "what's my busiest board?"). Answer the question in your text response — the query action is just a signal that no mutations are needed.`;

// Memory types: preference, pattern, context, correction, rhythm, reflection, note
export const AI_MEMORY_TYPES = [
  'preference',
  'pattern',
  'context',
  'correction',
  'rhythm',
  'reflection',
  'note',
  'nudge_response',
];

/**
 * Create AI context/memory system with injected dependencies.
 * @param {Object} deps
 * @param {function} deps.userKey - Scoped localStorage key builder
 * @param {function} deps.scheduleSyncToCloud - Trigger cloud sync
 * @param {function} deps.getData - Returns { tasks, projects }
 * @param {function} deps.getSettings - Returns settings object
 * @param {function} deps.getChatHistory - Returns chat history array
 * @param {function} deps.activeTasks - Returns active tasks, optionally filtered by projectId
 * @param {function} deps.doneTasks - Returns done tasks, optionally filtered by projectId
 * @param {function} deps.projectTasks - Returns tasks for a project
 * @param {function} deps.findTask - Find task by ID
 * @param {function} deps.findSimilarTask - Fuzzy find task by title
 * @param {function} deps.findSimilarProject - Fuzzy find project by name
 * @param {function} deps.isBlocked - Check if task is blocked
 * @param {function} deps.callAI - AI API caller
 * @param {function} deps.hasAI - Check if AI is available
 * @param {function} deps.updateTask - Update a task
 * @param {function} deps.deleteTask - Delete a task
 * @param {function} deps.addTask - Add a task
 * @param {function} deps.createTask - Create task object
 * @param {function} deps.createProject - Create project object
 * @param {function} deps.addProject - Add a project
 * @param {function} deps.updateProject - Update a project
 * @param {function} deps.saveData - Save data to storage
 * @param {function} deps.pushUndo - Push undo snapshot
 * @param {function} deps.confirmAIAction - Show confirmation toast
 * @param {function} deps.enforceShortDesc - Truncate description
 * @returns {{ getAIMemory, getAIMemoryArchive, saveAIMemory, saveAIMemoryArchive, archiveMemory, restoreMemory, addAIMemory, pruneStaleMemories, searchMemoryArchive, getAIInteractionCount, incrementAIInteraction, consolidateMemories, maybeLearnPattern, buildAIContext, matchTask, matchProject, executeAIActions }}
 */
export function createAIContext(deps) {
  const {
    userKey,
    scheduleSyncToCloud,
    getData,
    getChatHistory,
    activeTasks,
    doneTasks,
    projectTasks,
    findTask,
    findSimilarTask,
    findSimilarProject,
    isBlocked,
    callAI,
    hasAI,
    updateTask,
    deleteTask,
    addTask,
    createTask,
    createProject,
    addProject,
    updateProject,
    saveData,
    pushUndo,
    confirmAIAction,
    enforceShortDesc,
  } = deps;

  // --- AI Memory ---
  function getAIMemory() {
    try {
      const raw = JSON.parse(localStorage.getItem(userKey('whiteboard_ai_memory')) || '[]');
      return raw.map((m) => (typeof m === 'string' ? { text: m, type: 'context', date: '' } : m));
    } catch {
      return [];
    }
  }

  function getAIMemoryArchive() {
    try {
      const raw = JSON.parse(localStorage.getItem(userKey('whiteboard_ai_memory_archive')) || '[]');
      return raw.map((m) => (typeof m === 'string' ? { text: m, type: 'context', date: '' } : m));
    } catch {
      return [];
    }
  }

  function saveAIMemory(memInput) {
    let mem = memInput;
    if (mem.length > MAX_AI_MEMORIES) {
      const overflow = mem.slice(0, mem.length - MAX_AI_MEMORIES);
      mem = mem.slice(-MAX_AI_MEMORIES);
      const archive = getAIMemoryArchive();
      archive.push(...overflow);
      saveAIMemoryArchive(archive);
    }
    try {
      localStorage.setItem(userKey('whiteboard_ai_memory'), JSON.stringify(mem));
    } catch (e) {
      console.error('Memory save error:', e);
    }
    scheduleSyncToCloud();
  }

  function saveAIMemoryArchive(archive) {
    if (archive.length > 200) archive = archive.slice(-200);
    try {
      localStorage.setItem(userKey('whiteboard_ai_memory_archive'), JSON.stringify(archive));
    } catch (e) {
      console.error('Archive save error:', e);
    }
  }

  function archiveMemory(index) {
    const mem = getAIMemory();
    if (index < 0 || index >= mem.length) return;
    const item = mem.splice(index, 1)[0];
    const archive = getAIMemoryArchive();
    archive.push(item);
    saveAIMemoryArchive(archive);
    saveAIMemory(mem);
  }

  function restoreMemory(index) {
    const archive = getAIMemoryArchive();
    if (index < 0 || index >= archive.length) return;
    const item = archive.splice(index, 1)[0];
    saveAIMemoryArchive(archive);
    const mem = getAIMemory();
    mem.push(item);
    saveAIMemory(mem);
  }

  function addAIMemory(text, type) {
    const mem = getAIMemory();
    const archive = getAIMemoryArchive();
    const validType = AI_MEMORY_TYPES.includes(type) ? type : 'note';
    const newWords = new Set(text.toLowerCase().split(/\s+/));
    const isDupe = [...mem, ...archive].some((m) => {
      const existingWords = new Set((m.text || '').toLowerCase().split(/\s+/));
      const overlap = [...newWords].filter((w) => existingWords.has(w)).length;
      const similarity = overlap / Math.max(newWords.size, existingWords.size);
      return similarity > 0.7;
    });
    if (isDupe) return;
    mem.push({ text, type: validType, date: todayStr(), strength: 1 });
    saveAIMemory(mem);
  }

  function pruneStaleMemories() {
    const m = getAIMemory(),
      a = getAIMemoryArchive();
    const bn = getData().projects.map((p) => p.name.toLowerCase());
    const now = Date.now(),
      k = [],
      ar = [];
    m.forEach((x) => {
      if (['preference', 'correction', 'rhythm'].includes(x.type)) {
        k.push(x);
        return;
      }
      if (
        (x.type === 'context' || x.type === 'reflection') &&
        x.date &&
        now - new Date(x.date).getTime() > 60 * MS_PER_DAY
      ) {
        ar.push(x);
        return;
      }
      const q = ((x.text || '').match(/"([^"]+)"/g) || [])
        .map((s) => s.replace(/"/g, '').trim().toLowerCase())
        .filter((s) => s.length >= 2);
      if (q.length && q.some((n) => !bn.some((b) => b === n || b.includes(n) || n.includes(b)))) {
        ar.push(x);
        return;
      }
      k.push(x);
    });
    if (ar.length) {
      a.push(...ar);
      saveAIMemoryArchive(a);
      try {
        localStorage.setItem(userKey('whiteboard_ai_memory'), JSON.stringify(k));
      } catch (_e) {
        console.warn('AI memory save failed:', _e.message || _e);
      }
      scheduleSyncToCloud();
    }
  }

  function searchMemoryArchive(query) {
    const a = getAIMemoryArchive();
    if (!a.length || !query) return [];
    const qw = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (!qw.length) return [];
    return a
      .map((m) => {
        const tw = (m.text || '').toLowerCase().split(/\s+/);
        const ov = qw.filter((w) => tw.indexOf(w) >= 0).length;
        return { memory: m, score: ov / qw.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.memory);
  }

  // --- AI Interaction Counter ---
  function getAIInteractionCount() {
    try {
      return parseInt(localStorage.getItem(userKey('whiteboard_ai_interactions')) || '0', 10);
    } catch {
      return 0;
    }
  }

  function incrementAIInteraction() {
    const count = getAIInteractionCount() + 1;
    try {
      localStorage.setItem(userKey('whiteboard_ai_interactions'), String(count));
    } catch (_e) {
      console.warn('AI interaction count save failed:', _e.message || _e);
    }
    return count;
  }

  // --- Memory Consolidation ---
  async function consolidateMemories() {
    const mem = getAIMemory();
    if (mem.length < 20) return;
    const lastConsolidate = localStorage.getItem(userKey('whiteboard_mem_consolidated'));
    if (lastConsolidate && Date.now() - new Date(lastConsolidate).getTime() < 6 * MS_PER_DAY && mem.length < 40) return;
    if (!hasAI()) return;
    try {
      const currentBoards = getData()
        .projects.map((p) => p.name)
        .join(', ');
      const memDump = mem
        .map((m, i) => '[' + i + '] (' + (m.type || 'note') + ', ' + (m.date || '?') + ') ' + m.text)
        .join('\n');
      const reply = await callAI(
        'You are an AI memory manager. Consolidate these memories about a user into a tighter, more useful set.\n\nCURRENT ACTIVE BOARDS: ' +
          currentBoards +
          '\n\nCURRENT MEMORIES:\n' +
          memDump +
          '\n\nRULES:\n1. Merge related memories into single, denser entries\n2. Remove truly outdated entries (old context that is clearly stale - but keep preferences and corrections forever)\n3. Elevate repeated observations into "pattern" or "rhythm" type\n4. Keep corrections and preferences as-is\n5. Cap the result at 25 memories max\n6. Valid types: preference, pattern, context, correction, rhythm, reflection, note\n7. If a memory references a board/project NOT in the current active boards, mark it "archive": true\n8. Preferences, corrections, rhythms are NEVER archived\n\nReturn ONLY a JSON array: [{ "text": "...", "type": "...", "strength": 1-3, "archive": false }]\nStrength: 1=single observation, 2=confirmed by multiple signals, 3=strong established pattern',
        { maxTokens: 2048, temperature: 0.3 },
      );
      const jsonMatch = reply.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;
      const consolidated = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(consolidated) || consolidated.length === 0) return;
      const toArchive = [];
      const active = [];
      consolidated
        .filter((m) => m && m.text)
        .forEach((m) => {
          const item = {
            text: m.text,
            type: AI_MEMORY_TYPES.includes(m.type) ? m.type : 'note',
            date: todayStr(),
            strength: Math.min(3, Math.max(1, m.strength || 1)),
          };
          if (m.archive) toArchive.push(item);
          else active.push(item);
        });
      saveAIMemory(active.slice(0, MAX_AI_MEMORIES));
      if (toArchive.length) {
        const arc = getAIMemoryArchive();
        arc.push(...toArchive);
        saveAIMemoryArchive(arc);
      }
      pruneStaleMemories();
      localStorage.setItem(userKey('whiteboard_mem_consolidated'), new Date().toISOString());
    } catch (e) {
      console.error('Memory consolidation error:', e);
    }
  }

  // --- Automatic Pattern Learning ---
  function maybeLearnPattern() {
    const data = getData();
    const done = data.tasks.filter((t) => t.status === 'done' && t.completedAt);
    if (done.length < 10) return;
    const today = todayStr();
    const lastLearn = localStorage.getItem(userKey('whiteboard_last_pattern_learn'));
    if (lastLearn === today) return;
    localStorage.setItem(userKey('whiteboard_last_pattern_learn'), today);

    const completionHours = done
      .slice(-30)
      .map((t) => new Date(t.completedAt).getHours())
      .filter((h) => !isNaN(h));
    if (completionHours.length >= 10) {
      const morning = completionHours.filter((h) => h >= 6 && h < 12).length;
      const afternoon = completionHours.filter((h) => h >= 12 && h < 17).length;
      const evening = completionHours.filter((h) => h >= 17 && h < 22).length;
      const total = completionHours.length;
      if (morning / total > 0.5) addAIMemory('User completes most tasks in the morning (6am-12pm)', 'rhythm');
      else if (afternoon / total > 0.5) addAIMemory('User completes most tasks in the afternoon (12-5pm)', 'rhythm');
      else if (evening / total > 0.5) addAIMemory('User completes most tasks in the evening (5-10pm)', 'rhythm');
    }

    const reprioritized = data.tasks.filter((t) => t.updates && t.updates.some((u) => u.field === 'priority'));
    if (reprioritized.length >= 5) {
      const projects = {};
      reprioritized.forEach((t) => {
        const p = data.projects.find((x) => x.id === t.project);
        if (p) projects[p.name] = (projects[p.name] || 0) + 1;
      });
      const topProject = Object.entries(projects).sort((a, b) => b[1] - a[1])[0];
      if (topProject && topProject[1] >= 3)
        addAIMemory(
          'Tasks in "' +
            topProject[0] +
            '" frequently reprioritized (' +
            topProject[1] +
            'x) - may indicate unclear scope',
          'pattern',
        );
    }

    const urgentDone = done.filter((t) => t.priority === 'urgent' && t.createdAt && t.completedAt);
    if (urgentDone.length >= 5) {
      const sameDayCount = urgentDone.filter((t) => t.createdAt.slice(0, 10) === t.completedAt.slice(0, 10)).length;
      if (sameDayCount / urgentDone.length > 0.6)
        addAIMemory('User usually completes urgent tasks the same day they are created', 'pattern');
    }

    const dayBuckets = [0, 0, 0, 0, 0, 0, 0];
    done.slice(-50).forEach((t) => {
      const day = new Date(t.completedAt).getDay();
      if (!isNaN(day)) dayBuckets[day]++;
    });
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const maxDay = dayBuckets.indexOf(Math.max.apply(null, dayBuckets));
    const maxCount = dayBuckets[maxDay];
    if (maxCount >= 8 && maxCount / done.slice(-50).length > 0.25)
      addAIMemory('Most productive day tends to be ' + dayNames[maxDay], 'rhythm');

    const mem = getAIMemory();
    if (mem.length >= 40) consolidateMemories();
  }

  // --- Context Builder ---
  function buildAIContext(scope = 'all', projectId = null, detail = 'standard') {
    const data = getData();
    const today = todayStr();
    const hour = new Date().getHours();

    if (detail === 'minimal') {
      const active = data.tasks.filter((t) => t.status !== 'done');
      const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
      const proj = projectId ? data.projects.find((p) => p.id === projectId) : null;
      return `Today: ${today} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })}), ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}. ${active.length} active tasks, ${overdue.length} overdue.${proj ? ' Project: ' + proj.name + '.' : ''}`;
    }

    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const allActive = activeTasks();
    const allDone = doneTasks();
    const overdue = allActive.filter((t) => t.dueDate && t.dueDate < today);
    const dueToday = allActive.filter((t) => t.dueDate === today);
    const dueThisWeek = allActive.filter(
      (t) =>
        t.dueDate && t.dueDate > today && t.dueDate <= new Date(Date.now() + 7 * MS_PER_DAY).toISOString().slice(0, 10),
    );
    const stale = allActive.filter((t) => {
      const lastTouch = t.updates?.length ? t.updates[t.updates.length - 1].date : t.createdAt;
      return lastTouch && Date.now() - new Date(lastTouch).getTime() > 14 * MS_PER_DAY;
    });

    const weekAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString().slice(0, 10);
    const twoWeeksAgo = new Date(Date.now() - 14 * MS_PER_DAY).toISOString().slice(0, 10);
    const doneThisWeek = allDone.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= weekAgo).length;
    const doneLastWeek = allDone.filter(
      (t) => t.completedAt && t.completedAt.slice(0, 10) >= twoWeeksAgo && t.completedAt.slice(0, 10) < weekAgo,
    ).length;

    let ctx = `TODAY: ${today} (${dayName}), ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}\n`;
    ctx += `VELOCITY: ${doneThisWeek} tasks done this week${doneLastWeek ? ` (${doneLastWeek} last week)` : ''}\n`;
    ctx += `OVERVIEW: ${allActive.length} active, ${overdue.length} overdue, ${dueToday.length} due today, ${dueThisWeek.length} due this week\n`;
    if (stale.length) ctx += `STALE (untouched 14+ days): ${stale.map((t) => t.title).join(', ')}\n`;

    const mem = getAIMemory();
    if (mem.length) {
      const byType = {};
      mem.forEach((m) => {
        const t = m.type || 'note';
        if (!byType[t]) byType[t] = [];
        byType[t].push(m);
      });
      Object.values(byType).forEach((arr) => arr.sort((a, b) => (b.strength || 1) - (a.strength || 1)));
      const typeOrder = ['correction', 'preference', 'pattern', 'rhythm', 'context', 'reflection', 'note'];
      ctx += '\nAI MEMORY (observations from past sessions):\n';
      typeOrder.forEach((type) => {
        if (!byType[type] || !byType[type].length) return;
        ctx += '  ' + type.toUpperCase() + ':\n';
        byType[type].forEach((m) => {
          const str = m.strength && m.strength > 1 ? ' (strength:' + m.strength + ')' : '';
          ctx += '  - ' + m.text + str + '\n';
        });
      });
    }

    const interactionCount = getAIInteractionCount();
    if (interactionCount >= 100) {
      ctx +=
        '\nUSER EXPERIENCE: 100+ interactions. Be extremely terse. One-word confirmations when possible. Skip all explanations.\n';
    } else if (interactionCount >= 50) {
      ctx +=
        '\nUSER EXPERIENCE: 50+ interactions. The user is experienced with this system. Skip explanations and just act.\n';
    }

    if (detail === 'full') {
      const _arcCount = getAIMemoryArchive().length;
      if (_arcCount > 0)
        ctx +=
          '\nARCHIVED MEMORIES: ' +
          _arcCount +
          ' in archive. If user asks about past work or deleted projects, use search_archive action.\n';
    }
    const chatHistory = getChatHistory();
    if (detail === 'full' && chatHistory.length) {
      const recent = chatHistory
        .slice(-6)
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n');
      ctx += `\nRECENT CONVERSATION:\n${recent}\n`;
    }

    if (scope === 'project' && projectId) {
      const p = data.projects.find((x) => x.id === projectId);
      if (p) {
        const tasks = projectTasks(p.id);
        const active = tasks.filter((t) => t.status !== 'done');
        const done = tasks.filter((t) => t.status === 'done');
        const inProg = active.filter((t) => t.status === 'in-progress');
        ctx += `\nFOCUSED PROJECT: ${p.name}\n`;
        ctx += `Description: ${p.description || 'None'}\n`;
        ctx += `Background: ${p.background || 'Not generated yet'}\n`;
        ctx += `Stats: ${active.length} active, ${inProg.length} in-progress, ${done.length} done\n`;
        ctx += `Active tasks:\n${active.map((t) => `  - [${t.priority}${t.status === 'in-progress' ? '/WIP' : ''}] ${t.title}${t.dueDate ? ' (due ' + t.dueDate + ')' : ''}${t.notes ? ' — ' + t.notes.slice(0, 120) : ''}${t.subtasks?.length ? ' [' + t.subtasks.filter((s) => s.done).length + '/' + t.subtasks.length + ' sub]' : ''}`).join('\n')}\n`;
        if (done.length)
          ctx += `Completed (${done.length}): ${done
            .slice(0, 10)
            .map((t) => t.title)
            .join(', ')}${done.length > 10 ? '...' : ''}\n`;
      }
    } else {
      ctx += `\nBOARDS:\n`;
      data.projects.forEach((p) => {
        const active = activeTasks(p.id);
        const done = doneTasks(p.id);
        const urg = active.filter((t) => t.priority === 'urgent' || (t.dueDate && t.dueDate <= today));
        ctx += `  ${p.name}: ${active.length} active${urg.length ? ', ' + urg.length + ' urgent' : ''}, ${done.length} done${p.description ? ' — ' + p.description.slice(0, 80) : ''}\n`;
      });
      ctx += `\nALL ACTIVE TASKS:\n`;
      const allActiveTasks = data.tasks
        .filter((t) => t.status !== 'done')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const cappedTasks = allActiveTasks.slice(0, 100);
      const notesCap = allActiveTasks.length > 30 ? 60 : allActiveTasks.length > 15 ? 120 : 300;
      if (allActiveTasks.length > 100)
        ctx += `  (showing 100 of ${allActiveTasks.length} — ${allActiveTasks.length - 100} older tasks omitted)\n`;
      cappedTasks.forEach((t) => {
        const proj = data.projects.find((p) => p.id === t.project);
        ctx += `  - [${t.priority}${t.status === 'in-progress' ? '/WIP' : ''}${isBlocked(t) ? '/BLOCKED' : ''}] ${t.title}${proj ? ' {' + proj.name + '}' : ''}${t.dueDate ? ' due:' + t.dueDate : ''}${t.notes ? ' — ' + t.notes.slice(0, notesCap) : ''}${t.subtasks?.length ? ' [' + t.subtasks.filter((s) => s.done).length + '/' + t.subtasks.length + ' sub]' : ''}${
          t.blockedBy?.length
            ? ' [blocked by: ' +
              t.blockedBy
                .map((id) => {
                  const b = findTask(id);
                  return b ? b.title.slice(0, 25) : '?';
                })
                .join(', ') +
              ']'
            : ''
        }\n`;
      });
      const allDoneTasks = data.tasks
        .filter((t) => t.status === 'done')
        .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
      if (allDoneTasks.length) {
        const cappedDone = allDoneTasks.slice(0, 50);
        ctx += `\nCOMPLETED TASKS (${allDoneTasks.length} total${allDoneTasks.length > 50 ? ', showing 50 most recent' : ''}):\n`;
        cappedDone.forEach((t) => {
          const proj = data.projects.find((p) => p.id === t.project);
          ctx += `  - ✓ ${t.title}${proj ? ' {' + proj.name + '}' : ''}${t.completedAt ? ' (done ' + t.completedAt.slice(0, 10) + ')' : ''}${t.notes ? ' — ' + t.notes.slice(0, 200) : ''}\n`;
        });
      }
    }
    if (ctx.length > AI_CONTEXT_MAX_LENGTH) ctx = ctx.slice(0, AI_CONTEXT_MAX_LENGTH);
    return ctx;
  }

  // --- Smart matching for AI actions ---
  function matchTask(query) {
    if (!query) return null;
    const q = query.toLowerCase();
    const data = getData();
    let m = data.tasks.find((t) => t.title.toLowerCase() === q);
    if (m) return m;
    m = data.tasks.find((t) => t.title.toLowerCase().startsWith(q) || q.startsWith(t.title.toLowerCase()));
    if (m) return m;
    return findSimilarTask(query, null);
  }

  function matchProject(query) {
    if (!query) return null;
    const q = query.toLowerCase();
    const data = getData();
    const m = data.projects.find((p) => p.name.toLowerCase() === q);
    if (m) return m;
    return findSimilarProject(query);
  }

  // --- Payload Validation ---
  function sanitizeActionPayload(a) {
    if (a.action === 'create_task' || a.action === 'update_task') {
      const fields = a.action === 'update_task' ? a.fields : a;
      if (fields) {
        if (typeof fields.title === 'string' && fields.title.length > 500) {
          fields.title = fields.title.slice(0, 500);
        }
        if (typeof fields.notes === 'string' && fields.notes.length > 5000) {
          fields.notes = fields.notes.slice(0, 5000);
        }
        if (Array.isArray(fields.subtasks) && fields.subtasks.length > 20) {
          fields.subtasks = fields.subtasks.slice(0, 20);
        }
        if (Array.isArray(fields.subtasks)) {
          fields.subtasks = fields.subtasks.map((s) => {
            if (typeof s === 'string' && s.length > 200) return s.slice(0, 200);
            if (s && typeof s.title === 'string' && s.title.length > 200) {
              s.title = s.title.slice(0, 200);
              return s;
            }
            return s;
          });
        }
      }
    }
    if (a.action === 'create_project' || a.action === 'update_project') {
      if (typeof a.name === 'string' && a.name.length > 200) {
        a.name = a.name.slice(0, 200);
      }
    }
    if (a.action === 'save_memory') {
      if (typeof a.text === 'string' && a.text.length > 2000) {
        a.text = a.text.slice(0, 2000);
      }
    }
    return a;
  }

  // --- Centralized Action Executor ---
  async function executeAIActions(reply) {
    const actionsMatch = reply.match(/```(?:actions|json)\s*([\s\S]*?)```/);
    if (!actionsMatch) return { applied: 0, insights: [] };
    pushUndo('AI actions');
    let applied = 0;
    const insights = [];
    try {
      const actions = JSON.parse(actionsMatch[1]);
      const data = getData();
      for (const a of actions) {
        sanitizeActionPayload(a);
        try {
          switch (a.action) {
            case 'create_task': {
              const dupe = findSimilarTask(a.title, null);
              if (dupe) break;
              const projId = a.project ? (matchProject(a.project) || {}).id || '' : '';
              const st = (a.subtasks || []).map((s) => ({ id: genId('st'), title: s, done: false }));
              addTask(
                createTask({
                  title: a.title,
                  project: projId,
                  priority: a.priority || 'normal',
                  dueDate: a.dueDate || '',
                  notes: a.notes || '',
                  subtasks: st,
                  recurrence: a.recurrence || '',
                  phase: a.phase || '',
                  tags: a.tags || [],
                }),
              );
              applied++;
              break;
            }
            case 'update_task': {
              if (!a.taskTitle) break;
              const match = matchTask(a.taskTitle);
              if (match && a.fields) {
                const allowed = [
                  'title',
                  'notes',
                  'priority',
                  'status',
                  'dueDate',
                  'project',
                  'phase',
                  'tags',
                  'recurrence',
                  'estimatedMinutes',
                  'subtasks',
                  'favorite',
                ];
                const safe = {};
                for (const k of allowed) {
                  if (k in a.fields) safe[k] = a.fields[k];
                }
                if (safe.project) {
                  const p = matchProject(safe.project);
                  if (p) safe.project = p.id;
                  else delete safe.project;
                }
                updateTask(match.id, safe);
                applied++;
              }
              break;
            }
            case 'delete_task': {
              if (!a.taskTitle) break;
              const match = matchTask(a.taskTitle);
              if (match) {
                const confirmed = await confirmAIAction(`AI wants to delete "${esc(match.title)}". Allow?`);
                if (confirmed) {
                  deleteTask(match.id, true);
                  applied++;
                }
              }
              break;
            }
            case 'move_task': {
              if (!a.taskTitle || !a.toProject) break;
              const match = matchTask(a.taskTitle);
              const proj = matchProject(a.toProject);
              if (match && proj) {
                updateTask(match.id, { project: proj.id });
                applied++;
              }
              break;
            }
            case 'add_subtasks': {
              if (!a.taskTitle || !a.subtasks) break;
              const match = matchTask(a.taskTitle);
              if (match) {
                if (!match.subtasks) match.subtasks = [];
                a.subtasks.forEach((s) => match.subtasks.push({ id: genId('st'), title: s, done: false }));
                saveData(data);
                applied++;
              }
              break;
            }
            case 'split_task': {
              if (!a.taskTitle || !a.into) break;
              const match = matchTask(a.taskTitle);
              if (match) {
                const confirmed = await confirmAIAction(
                  `AI wants to split "${esc(match.title)}" into ${a.into.length} tasks. Allow?`,
                );
                if (confirmed) {
                  a.into.forEach((item) => {
                    addTask(
                      createTask({
                        title: item.title,
                        project: match.project,
                        priority: item.priority || match.priority,
                        notes: item.notes || '',
                        dueDate: item.dueDate || '',
                      }),
                    );
                  });
                  data.tasks = data.tasks.filter((x) => x.id !== match.id);
                  saveData(data);
                  applied++;
                }
              }
              break;
            }
            case 'batch_update': {
              if (!a.filter || !a.fields) break;
              let targets = data.tasks.filter((t) => t.status !== 'done');
              if (a.filter.project) {
                const proj = matchProject(a.filter.project);
                if (proj) targets = targets.filter((t) => t.project === proj.id);
              }
              if (a.filter.priority) targets = targets.filter((t) => t.priority === a.filter.priority);
              if (a.filter.status) targets = targets.filter((t) => t.status === a.filter.status);
              if (targets.length > 20) break;
              if (targets.length > 5) {
                const confirmed = await confirmAIAction(`AI wants to update ${targets.length} tasks. Allow?`);
                if (!confirmed) break;
              }
              const batchAllowed = [
                'title',
                'notes',
                'priority',
                'status',
                'dueDate',
                'project',
                'phase',
                'tags',
                'recurrence',
                'estimatedMinutes',
                'subtasks',
                'favorite',
              ];
              const batchSafe = {};
              for (const k of batchAllowed) {
                if (a.fields && k in a.fields) batchSafe[k] = a.fields[k];
              }
              targets.forEach((t) => updateTask(t.id, batchSafe));
              if (targets.length) applied++;
              break;
            }
            case 'create_project': {
              const existingP = matchProject(a.name);
              if (existingP) break;
              addProject(createProject({ name: a.name, description: enforceShortDesc(a.description || '') }));
              applied++;
              break;
            }
            case 'update_project': {
              if (!a.name) break;
              const match = matchProject(a.name);
              if (match && a.fields) {
                const allowed = ['title', 'color', 'description'];
                const filtered = {};
                for (const k of allowed) {
                  if (k in a.fields) filtered[k] = a.fields[k];
                }
                if (Object.keys(filtered).length) {
                  updateProject(match.id, filtered);
                  applied++;
                }
              }
              break;
            }
            case 'update_background': {
              if (!a.project) break;
              const match = matchProject(a.project);
              if (match && a.section && a.content) {
                const sectionMap = {
                  origin: 'Origin',
                  direction: "Where It's Going",
                  roadblocks: 'Roadblocks',
                  nextSteps: 'Next Steps',
                  notes: 'Notes',
                };
                const header = sectionMap[a.section] || a.section;
                let bg =
                  match.background ||
                  "## Origin\n\n## Where It's Going\n\n## Roadblocks\n\n## Next Steps\n\n## Notes\n";
                const regex = new RegExp(
                  '(## ' + header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\n[\\s\\S]*?(?=\\n## |$)',
                );
                if (regex.test(bg)) bg = bg.replace(regex, '$1\n' + a.content);
                else bg += '\n## ' + header + '\n' + a.content;
                updateProject(match.id, { background: bg });
                applied++;
              }
              break;
            }
            case 'save_memory': {
              if (!a.text) break;
              addAIMemory(a.text, a.type || 'note');
              applied++;
              break;
            }
            case 'suggest_insight': {
              if (a.text) insights.push({ text: a.text, severity: a.severity || 'info' });
              break;
            }
            case 'batch_reschedule': {
              if (!a.filter) break;
              let targets = data.tasks.filter((t) => t.status !== 'done' && t.dueDate);
              if (a.filter.project) {
                const proj = matchProject(a.filter.project);
                if (proj) targets = targets.filter((t) => t.project === proj.id);
              }
              if (a.filter.priority) targets = targets.filter((t) => t.priority === a.filter.priority);
              if (a.filter.dueBefore) targets = targets.filter((t) => t.dueDate <= a.filter.dueBefore);
              if (a.filter.dueThisWeek) {
                const endOfWeek = new Date();
                endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
                const eow = localISO(endOfWeek);
                targets = targets.filter((t) => t.dueDate <= eow && t.dueDate >= todayStr());
              }
              if (targets.length > 30) break;
              if (targets.length > 3) {
                const confirmed = await confirmAIAction(`AI wants to reschedule ${targets.length} tasks. Allow?`);
                if (!confirmed) break;
              }
              targets.forEach((t) => {
                if (a.newDate) {
                  updateTask(t.id, { dueDate: a.newDate });
                } else if (a.daysToAdd) {
                  const d = new Date(t.dueDate + 'T12:00:00');
                  d.setDate(d.getDate() + a.daysToAdd);
                  updateTask(t.id, { dueDate: localISO(d) });
                }
              });
              if (targets.length) applied++;
              break;
            }
            case 'query':
              break;
            case 'search_archive': {
              if (a.query) {
                const _sr = searchMemoryArchive(a.query);
                insights.push({
                  text: _sr.length
                    ? 'Archived: ' + _sr.map((m) => '[' + m.type + '] ' + m.text).join('; ')
                    : 'No archived memories found',
                  severity: 'info',
                });
              }
              break;
            }
          }
        } catch (err) {
          console.error('Action exec error:', a.action, err);
        }
      }
    } catch (e) {
      console.error('Action parse error:', e);
    }
    return { applied, insights };
  }

  return {
    getAIMemory,
    getAIMemoryArchive,
    saveAIMemory,
    saveAIMemoryArchive,
    archiveMemory,
    restoreMemory,
    addAIMemory,
    pruneStaleMemories,
    searchMemoryArchive,
    getAIInteractionCount,
    incrementAIInteraction,
    consolidateMemories,
    maybeLearnPattern,
    buildAIContext,
    matchTask,
    matchProject,
    executeAIActions,
  };
}
