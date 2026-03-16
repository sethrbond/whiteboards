// ============================================================
// QUICK ADD & AI ACTIONS MODULE
// ============================================================
// Extracted from app.js — handles quick capture, slash commands,
// AI task enhancement, AI reorganize, bulk actions, and calendar export.

import { isComplexInput, parseQuickInput as _parseQuickInput } from './parsers.js';
import { CONFIRMATION_TIMEOUT_MS } from './constants.js';

/**
 * Factory function to create quick-add and AI action functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ openQuickAdd, submitQuickAdd, previewQuickCapture, quickAddToProject, parseQuickInput, handleSlashCommand, aiEnhanceTask, aiReorganize, confirmAIAction, bulkAction, exportCalendar }}
 */
export function createQuickAdd(deps) {
  const {
    $,
    esc,
    fmtDate,
    todayStr,
    localISO,
    genId,
    getData,
    saveData,
    render,
    showToast,
    showUndoToast,
    closeModal,
    confirmAction,
    hasAI,
    callAI,
    findTask,
    findSimilarProject,
    updateTask,
    addTask,
    createTask,
    pushUndo,
    getLifeProjectId,
    matchTask,
    matchProject,
    buildAIContext,
    AI_PERSONA,
    startFocus,
    toggleChat,
    sendChat,
    setView,
    planMyDay,
    maybeProactiveEnhance,
    autoClassifyTask,
    getBulkSelected,
    setBatchMode,
    getSmartDefaults,
    getAllTemplates,
    applyTemplate,
  } = deps;

  function parseQuickInput(raw) {
    return _parseQuickInput(raw, { findSimilarProject });
  }

  // --- Slash command handler for quick capture ---
  function handleSlashCommand(raw) {
    const parts = raw.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = parts.slice(1).join(' ').trim();
    if (cmd === 'done' && arg) {
      const task = matchTask(arg);
      if (task) {
        updateTask(task.id, { status: 'done' });
        showToast(`Completed: ${task.title}`, false, true);
        render();
        return true;
      }
      showToast(`No task matching "${arg}"`, true);
      return true;
    }
    if (cmd === 'urgent' && arg) {
      const task = matchTask(arg);
      if (task) {
        updateTask(task.id, { priority: 'urgent' });
        showToast(`Set urgent: ${task.title}`, false, true);
        render();
        return true;
      }
      showToast(`No task matching "${arg}"`, true);
      return true;
    }
    if (cmd === 'focus') {
      startFocus();
      return true;
    }
    if (cmd === 'plan') {
      planMyDay();
      showToast('Generating day plan...', false, true);
      return true;
    }
    if (cmd === 'brainstorm' || cmd === 'dump') {
      setView('dump');
      if (arg) {
        setTimeout(() => {
          const t = document.getElementById('dumpText');
          if (t) {
            t.value = arg;
            t.focus();
            t.dispatchEvent(new Event('input'));
          }
        }, 100);
      }
      return true;
    }
    if (cmd === 'review') {
      setView('review');
      return true;
    }
    if (cmd === 'chat' && arg) {
      const panel = document.getElementById('chatPanel');
      if (panel && !panel.classList.contains('open')) toggleChat();
      const ci = document.getElementById('chatInput');
      if (ci) {
        ci.value = arg;
        sendChat();
      }
      return true;
    }
    if (cmd === 'move' && arg) {
      const toMatch = arg.match(/^(.+?)\s+to\s+(.+)$/i);
      if (toMatch) {
        const task = matchTask(toMatch[1]);
        const proj = matchProject(toMatch[2]);
        if (task && proj) {
          updateTask(task.id, { project: proj.id });
          showToast(`Moved "${task.title}" to ${proj.name}`, false, true);
          render();
          return true;
        }
        if (!task) {
          showToast(`No task matching "${toMatch[1]}"`, true);
          return true;
        }
        if (!proj) {
          showToast(`No board matching "${toMatch[2]}"`, true);
          return true;
        }
      }
      showToast('Usage: /move task name to Board Name', true);
      return true;
    }
    if (cmd === 'template' || cmd === 't') {
      // Show template picker or apply named template
      const templates = getAllTemplates ? getAllTemplates() : [];
      if (arg) {
        const match = templates.find((t) => t.name.toLowerCase().includes(arg.toLowerCase()));
        if (match && applyTemplate) {
          const fields = applyTemplate(match, genId);
          const newTask = createTask({ ...fields, project: fields.project || getLifeProjectId() });
          addTask(newTask);
          showToast('Created from template: ' + match.name, false, true);
          render();
          return true;
        }
        showToast('No template matching "' + arg + '"', true);
        return true;
      }
      // No arg — show template list in quick add preview
      return false;
    }
    return false;
  }

  // --- AI-enhance a task after creation (non-blocking) ---
  function aiEnhanceTask(taskId, originalInput) {
    if (!hasAI()) return;
    const task = findTask(taskId);
    if (!task) return;
    callAI(
      `The user typed this into a quick task capture: "${originalInput}"

This was turned into a task titled: "${task.title}"

If this seems like it needs more detail (e.g., the user asked to "email someone" or "draft something"), generate helpful notes to pre-fill. Return ONLY a JSON object:
{ "notes": "draft content or helpful context", "subtasks": ["step 1", "step 2"] }

If the task is simple and doesn't need enhancement, return: { "notes": "", "subtasks": [] }
Keep notes concise and actionable. Today is ${todayStr()}.`,
      { maxTokens: 512, temperature: 0.3 },
    )
      .then((reply) => {
        try {
          const enhanced = JSON.parse(
            reply
              .replace(/```(?:json)?\s*/g, '')
              .replace(/```/g, '')
              .trim(),
          );
          const t = findTask(taskId);
          if (!t) return;
          if (enhanced.notes && !t.notes) {
            t.notes = enhanced.notes;
          }
          if (enhanced.subtasks?.length && (!t.subtasks || !t.subtasks.length)) {
            t.subtasks = enhanced.subtasks.map((s) => ({ id: genId('st'), title: s, done: false }));
          }
          const data = getData();
          if (enhanced.notes || enhanced.subtasks?.length) {
            saveData(data);
            render();
            showToast('AI enhanced task with details', false, true);
          }
        } catch (e) {
          console.warn('AI enhancement failed:', e.message);
        }
      })
      .catch((e) => console.warn('AI call failed:', e.message));
  }

  function quickAddToProject(input, projectId) {
    const parsed = parseQuickInput(input.value.trim());
    addTask(
      createTask({
        title: parsed.title,
        priority: parsed.priority || 'normal',
        dueDate: parsed.dueDate || '',
        project: projectId,
      }),
    );
    input.value = '';
    showToast(`+ ${parsed.title}${parsed.dueDate ? ' (due ' + parsed.dueDate + ')' : ''}`, false, true);
    render();
  }

  function previewQuickCapture() {
    const input = document.getElementById('quickCapture');
    const prev = document.getElementById('quickCapturePreview');
    const aiInd = document.getElementById('qcAiIndicator');
    if (!input || !prev) return;
    const val = input.value.trim();
    if (!val) {
      prev.innerHTML = '';
      prev.style.display = 'none';
      if (aiInd) aiInd.classList.remove('active');
      return;
    }

    // Update AI indicator
    if (aiInd) {
      aiInd.classList.toggle('active', isComplexInput(val) && hasAI());
    }

    // Show slash command hints
    if (val.startsWith('/')) {
      const slashCmds = [
        { cmd: '/done', desc: 'mark a task complete', eg: '/done quarterly report' },
        { cmd: '/urgent', desc: 'set task to urgent', eg: '/urgent budget review' },
        { cmd: '/move', desc: 'move task to board', eg: '/move budget to Work' },
        { cmd: '/focus', desc: 'start focus mode', eg: '/focus' },
        { cmd: '/plan', desc: 'generate day plan', eg: '/plan' },
        { cmd: '/template', desc: 'apply a task template', eg: '/template Weekly Review' },
        { cmd: '/t', desc: 'template shortcut', eg: '/t Daily Standup' },
      ];
      const typed = val.toLowerCase();
      const matching = slashCmds.filter((c) => c.cmd.startsWith(typed) || typed.startsWith(c.cmd));
      if (matching.length) {
        prev.innerHTML = matching
          .map((c) => `<span class="qc-slash-hint"><kbd>${c.cmd}</kbd> ${c.desc}</span>`)
          .join(' &nbsp; ');
        prev.style.display = 'block';
      } else {
        prev.innerHTML =
          '<span class="qc-slash-hint">Unknown command. Try: /done, /urgent, /move, /focus, /plan, /template</span>';
        prev.style.display = 'block';
      }
      return;
    }

    const parsed = parseQuickInput(val);
    const parts = [];
    if (parsed.dueDate) {
      const d = new Date(parsed.dueDate + 'T12:00:00');
      parts.push(
        `<span style="color:var(--green)">📅 ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>`,
      );
    }
    if (parsed.priority && parsed.priority !== 'normal') {
      const colors = { urgent: 'var(--red)', important: 'var(--amber, var(--orange))' };
      parts.push(`<span style="color:${colors[parsed.priority] || 'var(--text3)'}">⚡ ${parsed.priority}</span>`);
    }
    if (parsed.quickProject) {
      parts.push(`<span style="color:var(--accent)">📁 ${esc(parsed.quickProject.name)}</span>`);
    }
    if (isComplexInput(val) && hasAI()) {
      parts.push(`<span style="color:var(--accent)">✦ AI will enhance</span>`);
    }
    if (typeof getSmartDefaults === 'function' && val.length >= 5) {
      const sd = getSmartDefaults(val);
      if (sd.suggestedPriority)
        parts.push(`<span style="color:var(--accent)">✦ ${esc(sd.suggestedPriority)} (AI suggested)</span>`);
      if (sd.suggestedProjectName)
        parts.push(`<span style="color:var(--accent)">✦ ${esc(sd.suggestedProjectName)} (AI suggested)</span>`);
    }
    if (parts.length) {
      prev.innerHTML = parts.join(' &nbsp; ');
      prev.style.display = 'block';
    } else {
      prev.innerHTML = '';
      prev.style.display = 'none';
    }
  }

  // ============================================================
  // GLOBAL QUICK ADD (Cmd+Shift+K)
  // ============================================================
  function openQuickAdd() {
    const data = getData();
    const projOpts = data.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" style="align-items:flex-start;padding-top:min(18vh,120px)" data-action="close-modal" data-click-self="true"><div class="cmd-palette" style="max-width:520px">
      <div class="cmd-input-row">
        <span class="cmd-icon" style="color:var(--accent)">+</span>
        <input class="cmd-input" id="quickAddInput" placeholder="Add task..." aria-label="Quick add task" autofocus data-keydown-action="quick-add-submit">
      </div>
      <div id="quickAddPreview" style="padding:8px 16px;font-size:12px;color:var(--text3);min-height:20px"></div>
      <div style="display:flex;gap:8px;padding:8px 16px 12px;align-items:center">
        <select class="form-select" id="quickAddProject" style="flex:1;font-size:12px;padding:6px 8px" aria-label="Project for new task">${projOpts}</select>
        <button class="btn btn-primary btn-sm" data-action="submit-quick-add">Add Task</button>
        <kbd style="font-size:10px;color:var(--text3);background:var(--surface);padding:2px 6px;border-radius:4px;border:1px solid var(--border)">↵</kbd>
      </div>
    </div></div>`;
    const inp = $('#quickAddInput');
    inp.focus();
    inp.addEventListener('input', () => {
      // Apply smart defaults when user types
      const val2 = inp.value.trim();
      if (val2.length >= 5 && typeof getSmartDefaults === 'function') {
        const defaults = getSmartDefaults(val2);
        const projSelect = $('#quickAddProject');
        if (defaults.suggestedProject && projSelect) {
          const opt = projSelect.querySelector('option[value="' + defaults.suggestedProject + '"]');
          if (opt && !projSelect._userChanged) {
            projSelect.value = defaults.suggestedProject;
          }
        }
        // Show AI suggestion hints in preview
        const prev = $('#quickAddPreview');
        if (prev) {
          const hints = [];
          if (defaults.suggestedPriority)
            hints.push(
              '<span style="color:var(--accent)">\u2726 AI: ' + esc(defaults.suggestedPriority) + ' priority</span>',
            );
          if (defaults.suggestedDueDate)
            hints.push(
              '<span style="color:var(--accent)">\u2726 AI: due in ~' +
                Math.round(defaults.suggestedDueDays) +
                'd</span>',
            );
          if (defaults.suggestedEstimate)
            hints.push(
              '<span style="color:var(--accent)">\u2726 AI: ~' + Math.round(defaults.suggestedEstimate) + 'min</span>',
            );
          if (hints.length) {
            prev.innerHTML = (prev.innerHTML ? prev.innerHTML + ' ' : '') + hints.join(' ');
            prev.style.display = 'block';
          }
        }
      }

      const val = inp.value.trim();
      if (!val) {
        $('#quickAddPreview').innerHTML = '';
        return;
      }
      const { title: _title, priority, dueDate } = parseQuickInput(val);
      const parts = [];
      if (dueDate) parts.push(`<span style="color:var(--accent)">📅 ${fmtDate(dueDate)}</span>`);
      if (priority !== 'normal')
        parts.push(
          `<span style="color:${priority === 'urgent' ? 'var(--red)' : 'var(--amber)'}">⚡ ${priority}</span>`,
        );
      $('#quickAddPreview').innerHTML = parts.length ? parts.join(' · ') : '';
    });
  }

  function submitQuickAdd() {
    const inp = $('#quickAddInput');
    if (!inp || !inp.value.trim()) return;
    const raw = inp.value.trim();
    if (raw.startsWith('/')) {
      closeModal();
      const handled = handleSlashCommand(raw);
      if (!handled) showToast('Commands: /done, /urgent, /focus, /plan, /move ... to ...', true);
      return;
    }
    const data = getData();
    const proj = $('#quickAddProject') ? $('#quickAddProject').value : getLifeProjectId();
    const { title, priority, dueDate } = parseQuickInput(raw);
    if (!title) return;

    // Apply smart defaults if user didn't override
    let finalPriority = priority;
    let finalDueDate = dueDate;
    let finalProject = proj;
    if (typeof getSmartDefaults === 'function') {
      const defaults = getSmartDefaults(title);
      if (priority === 'normal' && defaults.suggestedPriority) finalPriority = defaults.suggestedPriority;
      if (!dueDate && defaults.suggestedDueDate) finalDueDate = defaults.suggestedDueDate;
      if (proj === getLifeProjectId() && defaults.suggestedProject) finalProject = defaults.suggestedProject;
    }
    const newTask = createTask({ title, project: finalProject, priority: finalPriority, dueDate: finalDueDate });
    addTask(newTask);
    closeModal();
    render();
    if (isComplexInput(raw)) {
      aiEnhanceTask(newTask.id, raw);
    }
    maybeProactiveEnhance(newTask);
    // Auto-classify if using default project and default priority
    if (hasAI() && priority === 'normal' && proj === getLifeProjectId() && data.projects.length > 1) {
      autoClassifyTask(newTask);
    }
    const parts = [title];
    if (dueDate) parts.push(`due ${fmtDate(dueDate)}`);
    if (priority !== 'normal') parts.push(priority);
    showToast(`+ ${parts.join(' · ')}`, false, true);
  }

  // --- Confirmation for destructive AI actions ---
  function confirmAIAction(message) {
    return new Promise((resolve) => {
      let resolved = false;
      const dismiss = (val) => {
        if (resolved) return;
        resolved = true;
        resolve(val);
        if (toast.parentElement) toast.remove();
      };
      document.querySelectorAll('.toast.ai-confirm').forEach((t) => {
        t._dismiss(false);
      });
      const toast = document.createElement('div');
      toast.className = 'toast ai-confirm';
      toast.style.cssText = 'bottom:80px;display:flex;align-items:center;gap:12px;max-width:420px;';
      toast.innerHTML = `<span style="flex:1;line-height:1.4">${esc(message)}</span>
        <button class="btn btn-sm" style="background:var(--green);color:#fff;white-space:nowrap" data-action="confirm-yes">Yes</button>
        <button class="btn btn-sm" style="white-space:nowrap" data-action="confirm-no">No</button>`;
      toast._dismiss = dismiss;
      document.body.appendChild(toast);
      setTimeout(() => dismiss(false), CONFIRMATION_TIMEOUT_MS);
    });
  }

  // ============================================================
  // AI AUTO-REORGANIZE
  // ============================================================
  async function aiReorganize(scope = 'all') {
    if (!hasAI()) return;

    const data = getData();
    const scopeTasks =
      scope === 'all'
        ? data.tasks.filter((t) => t.status !== 'done')
        : data.tasks.filter((t) => t.status !== 'done' && t.project === scope);

    if (!scopeTasks.length) {
      showToast('No active tasks to reorganize');
      return;
    }

    pushUndo('AI Reorganize');
    showToast('✦ Reorganizing...');

    const taskData = scopeTasks.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes || '',
      priority: t.priority,
      project: (data.projects.find((p) => p.id === t.project) || {}).name || 'unassigned',
      dueDate: t.dueDate || '',
      phase: t.phase || '',
      subtasks: (t.subtasks || []).length,
    }));

    const ctx = buildAIContext(scope === 'all' ? 'all' : 'project', scope === 'all' ? null : scope);

    const prompt = `${AI_PERSONA}

You are reorganizing tasks. Review and suggest ONLY high-confidence improvements.

${ctx}

TASKS TO REORGANIZE:
${JSON.stringify(taskData, null, 1)}

Return ONLY a JSON array of changes:
{ "id": "task_id", "changes": { "priority": "urgent", "project": "Project Name", "notes": "appended context", "phase": "..." }, "reason": "brief why" }

Rules:
- Only include tasks that NEED changes. Most tasks are fine.
- Re-prioritize if a deadline is approaching or priority is clearly wrong
- Move tasks to the right project if misplaced
- Append context to notes (never replace)
- Assign unassigned tasks to the best project
- Consider the user's AI memory for preferences
- 3-10 changes max, only high-confidence ones`;

    try {
      const content = await callAI(prompt, { maxTokens: 2048, temperature: 0.3 });

      let changes;
      try {
        changes = JSON.parse(content);
      } catch {
        const m = content.match(/\[[\s\S]*\]/);
        if (m) changes = JSON.parse(m[0]);
      }
      if (!changes || !Array.isArray(changes)) {
        showToast('No reorganization needed');
        return;
      }

      let applied = 0;
      const changeLog = [];
      changes.forEach((c) => {
        if (!c.id || !c.changes) return;
        const t = findTask(c.id);
        if (!t) return;

        const updates = {};
        const desc = [];
        if (c.changes.priority && c.changes.priority !== t.priority) {
          updates.priority = c.changes.priority;
          desc.push(`priority → ${c.changes.priority}`);
        }
        if (c.changes.dueDate && c.changes.dueDate !== t.dueDate) {
          updates.dueDate = c.changes.dueDate;
          desc.push(`due → ${esc(c.changes.dueDate)}`);
        }
        if (c.changes.phase && c.changes.phase !== t.phase) {
          updates.phase = c.changes.phase;
          desc.push(`phase → ${esc(c.changes.phase)}`);
        }
        if (c.changes.notes && t.notes !== c.changes.notes) {
          updates.notes = t.notes ? t.notes + '\n' + c.changes.notes : c.changes.notes;
          desc.push('added notes');
        }

        if (c.changes.project) {
          const proj = matchProject(c.changes.project);
          if (proj && proj.id !== t.project) {
            updates.project = proj.id;
            desc.push(`moved → ${esc(proj.name)}`);
          }
        }

        if (Object.keys(updates).length) {
          updateTask(c.id, updates);
          changeLog.push(
            `<strong>${esc(t.title)}</strong>: ${desc.join(', ')}${c.reason ? ` <span style="color:var(--text3)">— ${esc(c.reason)}</span>` : ''}`,
          );
          applied++;
        }
      });

      if (applied) {
        showToast(`✦ Auto-organized ${applied} task${applied > 1 ? 's' : ''}`, false, true);
        // Show details in chat panel
        const messagesEl = document.getElementById('chatMessages');
        if (messagesEl) {
          messagesEl.innerHTML += `<div class="chat-msg ai"><strong>Auto-organized ${applied} task${applied > 1 ? 's' : ''}:</strong><br>${changeLog.join('<br>')}</div>`;
          document.getElementById('chatPanel').classList.add('open');
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        render();
      }
    } catch (err) {
      console.error('Reorganize error:', err);
      showToast('Reorganize failed. Please try again.', true);
    }
  }

  // ============================================================
  // BULK ACTIONS
  // ============================================================
  async function bulkAction(action, value) {
    const bulkSelected = getBulkSelected();
    const ids = [...bulkSelected];
    if (!ids.length) return;

    if (action === 'delete') {
      const ok = await confirmAction(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`);
      if (!ok) return;
    }
    pushUndo('Bulk ' + action);

    const data = getData();
    setBatchMode(true);
    if (action === 'delete') {
      const idSet = new Set(ids);
      data.tasks = data.tasks.filter((t) => !idSet.has(t.id));
      // Clean up orphaned blockedBy references
      data.tasks.forEach((t) => {
        if (t.blockedBy) t.blockedBy = t.blockedBy.filter((bid) => !idSet.has(bid));
      });
      setBatchMode(false);
      saveData(data);
      showUndoToast(`Deleted ${ids.length} tasks`);
    } else if (action === 'done' || action === 'todo') {
      ids.forEach((id) => updateTask(id, { status: action }));
      setBatchMode(false);
      saveData(data);
      showToast(`${ids.length} tasks → ${action}`);
    } else if (action === 'move') {
      ids.forEach((id) => updateTask(id, { project: value }));
      setBatchMode(false);
      saveData(data);
      const proj = data.projects.find((p) => p.id === value);
      showToast(`Moved ${ids.length} to ${proj ? proj.name : 'board'}`);
    } else if (action === 'priority') {
      ids.forEach((id) => updateTask(id, { priority: value }));
      setBatchMode(false);
      saveData(data);
      showToast(`${ids.length} tasks → ${value}`);
    } else {
      setBatchMode(false);
    }

    bulkSelected.clear();
    render();
  }

  // ============================================================
  // GOOGLE CALENDAR EXPORT
  // ============================================================
  function exportCalendar() {
    const data = getData();
    const tasks = data.tasks.filter((t) => t.dueDate && t.status !== 'done');
    if (!tasks.length) {
      showToast('No tasks with due dates to export', true);
      return;
    }

    let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Whiteboards//EN\nCALSCALE:GREGORIAN\n';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const escICS = (s) =>
      (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    tasks.forEach((t) => {
      const d = t.dueDate.replace(/-/g, '');
      const nextDay = new Date(t.dueDate + 'T00:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const dtEnd = localISO(nextDay).replace(/-/g, '');
      const proj = data.projects.find((p) => p.id === t.project);
      ics += `BEGIN:VEVENT\n`;
      ics += `DTSTAMP:${stamp}\n`;
      ics += `DTSTART;VALUE=DATE:${d}\n`;
      ics += `DTEND;VALUE=DATE:${dtEnd}\n`;
      ics += `SUMMARY:${escICS(t.title)}\n`;
      ics += `DESCRIPTION:${escICS((t.notes || '') + (proj ? '\nProject: ' + proj.name : ''))}\n`;
      ics += `STATUS:${t.status === 'in-progress' ? 'IN-PROCESS' : 'NEEDS-ACTION'}\n`;
      ics += `PRIORITY:${t.priority === 'urgent' ? 1 : t.priority === 'important' ? 5 : 9}\n`;
      ics += `UID:${t.id}@whiteboard\n`;
      ics += `END:VEVENT\n`;
    });
    ics += 'END:VCALENDAR';

    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.href = url;
    a.download = `whiteboards-${todayStr()}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${tasks.length} tasks to calendar`);
  }

  function _renderQuickAddTemplateChips() {
    const container = document.getElementById('quickAddTemplateChips');
    if (!container || !getAllTemplates) return;
    const templates = getAllTemplates();
    if (!templates.length) return;
    container.innerHTML = templates
      .slice(0, 8)
      .map(
        (t) =>
          '<button class="btn btn-sm" style="font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text2);cursor:pointer" data-action="apply-template-quick" data-template-id="' +
          t.id +
          '" title="' +
          (t.subtasks ? t.subtasks.length + ' subtasks' : '') +
          '">' +
          (t.name.length > 20 ? t.name.slice(0, 18) + '...' : t.name) +
          '</button>',
      )
      .join('');
  }

  function applyTemplateToQuickAdd(templateId) {
    if (!getAllTemplates || !applyTemplate) return;
    const templates = getAllTemplates();
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    const fields = applyTemplate(tmpl, genId);
    const proj = fields.project || ($('#quickAddProject') ? $('#quickAddProject').value : getLifeProjectId());
    const newTask = createTask({ ...fields, project: proj });
    addTask(newTask);
    closeModal();
    render();
    showToast('Created from template: ' + tmpl.name, false, true);
  }

  return {
    openQuickAdd,
    submitQuickAdd,
    previewQuickCapture,
    quickAddToProject,
    parseQuickInput,
    handleSlashCommand,
    aiEnhanceTask,
    aiReorganize,
    confirmAIAction,
    bulkAction,
    exportCalendar,
    applyTemplateToQuickAdd,
  };
}
