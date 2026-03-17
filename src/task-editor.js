// ============================================================
// TASK EDITOR MODULE
// ============================================================
// Extracted from app.js — handles task rendering, editing,
// inline commands, dependencies, and task CRUD modals.

import { TRUNCATE_TITLE } from './constants.js';
/**
 * Factory function to create task editor functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ openNewTask, saveNewTask, openEditTask, saveEditTask, autoClassifyTask, attachInlineEdit, renderTaskExpanded, renderTaskRow, renderPriorityTag, priorityColor, taskNudge, runTaskCmd, runTaskCmdAI, addDep, removeDep, showDepResults, selectDep, wouldCreateCircularDep, guardedCloseEditModal }}
 */
export function createTaskEditor(deps) {
  const {
    $,
    esc,
    todayStr,
    fmtDate,
    fmtEstimate,
    relativeTime,
    genId,
    getData,
    findTask,
    updateTask,
    deleteTask,
    addTask,
    createTask,
    saveData,
    render,
    showToast,
    setModalLabel,
    pushModalState,
    closeModal,
    trapFocus,
    getTrapFocusCleanup,
    setTrapFocusCleanup,
    setModalTriggerEl,
    getExpandedTask,
    setExpandedTask,
    getBulkMode,
    getBulkSelected,
    getProactiveLog,
    isBlocked,
    renderSubtaskProgress,
    renderBlockedBy,
    renderBlocking,
    renderTagChips,
    renderTagPicker,
    smartDateInput,
    resolveSmartDate,
    hasAI,
    callAI,
    AI_PERSONA_SHORT,
    matchTask,
    maybeProactiveEnhance,
    getSmartDefaults,
    predictCompletion,
    saveAsTemplate: _saveAsTemplate,
  } = deps;

  // Track original values when edit modal opens for unsaved-changes detection
  let _editSnapshot = null;

  function _hasUnsavedEdits() {
    if (!_editSnapshot) return false;
    const fields = ['fTitle', 'fNotes', 'fStatus', 'fPriority', 'fProject', 'fRecurrence', 'fPhase'];
    for (const id of fields) {
      const el = document.getElementById(id);
      if (el && (el.value || '') !== (_editSnapshot[id] || '')) return true;
    }
    return false;
  }

  function renderPriorityTag(p) {
    const labels = {
      urgent: 'Priority: Critical',
      important: 'Priority: High',
      normal: 'Priority: Normal',
      low: 'Priority: Low',
    };
    return `<span class="tag tag-${p}" aria-label="${labels[p] || 'Priority: ' + p}">${p.charAt(0).toUpperCase() + p.slice(1)}</span>`;
  }

  function priorityColor(p) {
    return (
      { urgent: 'var(--red)', important: 'var(--orange)', normal: 'var(--accent)', low: 'var(--text3)' }[p] ||
      'var(--text3)'
    );
  }

  function taskNudge(t) {
    if (t.status === 'done') return '';
    const missing = [];
    if (!t.dueDate && t.priority !== 'low') missing.push('deadline');
    if (!t.notes && t.title.length < TRUNCATE_TITLE) missing.push('details');
    if (!t.project) missing.push('project');
    if (!missing.length) return '';
    const hint =
      missing.length === 1
        ? `add a ${missing[0]}?`
        : `add ${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}?`;
    return `<div class="task-nudge" data-action="task-nudge" data-task-id="${t.id}">${hint}</div>`;
  }

  function renderTaskRow(t, showProject = false) {
    const isDone = t.status === 'done';
    const expandedTask = getExpandedTask();
    const isExpanded = expandedTask === t.id;

    if (isExpanded) return renderTaskExpanded(t, showProject);

    const data = getData();
    const proj = showProject && t.project ? data.projects.find((x) => x.id === t.project) : null;
    const bulkMode = getBulkMode();
    const bulkSelected = getBulkSelected();
    const proactiveLog = getProactiveLog();

    const priClass = !isDone && (t.priority === 'urgent' || t.priority === 'important') ? ` pri-${t.priority}` : '';
    const blocked = !isDone && isBlocked(t);
    return `<div class="task-row${priClass}" data-task="${t.id}" data-expandable="true" role="listitem" aria-expanded="false"${blocked ? ' style="opacity:0.55"' : ''}>
    ${bulkMode ? `<div class="bulk-check${bulkSelected.has(t.id) ? ' on' : ''}" data-bulk="${t.id}" role="checkbox" aria-checked="${bulkSelected.has(t.id)}" tabindex="0" aria-label="Select ${esc(t.title)}">${bulkSelected.has(t.id) ? '✓' : ''}</div>` : ''}
    <div class="task-expand-dot${isDone ? ' done' : ''}" data-expandable="true" role="button" tabindex="0" aria-label="Expand ${esc(t.title)}" title="Show details">▸</div>
    ${!isDone && (t.priority === 'urgent' || t.priority === 'important' || t.priority === 'normal') ? `<span style="font-size:9px;font-weight:600;color:${priorityColor(t.priority)};margin-right:4px;opacity:0.7;flex-shrink:0" aria-label="${t.priority === 'urgent' ? 'Priority: Critical' : t.priority === 'important' ? 'Priority: High' : 'Priority: Normal'}">${t.priority === 'urgent' ? 'P1' : t.priority === 'important' ? 'P2' : 'P3'}</span>` : ''}
    <div class="task-body" style="cursor:pointer">
      <div class="task-title ${isDone ? 'done-text' : ''}">${blocked ? '<span style="color:var(--red);font-size:10px;margin-right:4px" title="Blocked" aria-label="Blocked">◆</span>' : ''}${esc(t.title)}${proactiveLog.some((l) => l.taskId === t.id) ? ' <span style="font-size:10px;color:var(--accent);opacity:0.7;font-weight:500" title="AI pre-filled drafts for this task">✦ AI prepared</span>' : ''}</div>
      ${t.notes ? `<div class="task-note">${esc(t.notes)}</div>` : ''}
      ${t.subtasks && t.subtasks.length ? renderSubtaskProgress(t.subtasks) : ''}
      ${taskNudge(t)}
    </div>
    <div class="task-tags">
      ${proj ? `<span class="tag tag-project" style="border-left:2px solid ${proj.color};padding-left:6px">${esc(proj.name)}</span>` : ''}
      ${renderTagChips(t.tags)}
      ${t.phase ? `<span class="tag" style="background:rgba(168,85,247,0.08);color:var(--purple);font-size:9px">${esc(t.phase)}</span>` : ''}
      ${renderPriorityTag(t.priority)}
      ${t.recurrence ? `<span class="tag" style="background:rgba(168,85,247,0.08);color:var(--purple);font-size:9px">↻ ${t.recurrence}</span>` : ''}
      ${t.estimatedMinutes ? `<span class="tag" style="background:rgba(129,140,248,0.08);color:var(--text3);font-size:9px" title="Estimated time">${fmtEstimate(t.estimatedMinutes)}</span>` : ''}
      ${t.dueDate ? `<span class="tag tag-date${t.status !== 'done' && t.dueDate < todayStr() ? ' overdue' : ''}">${fmtDate(t.dueDate)}</span>` : ''}
    </div>
    <div class="task-actions">
      <button class="task-action-btn" title="Edit" aria-label="Edit task" data-action="edit-task" data-task-id="${t.id}">✎</button>
      <button class="task-action-btn" title="Focus" aria-label="Focus on task" data-action="focus-task" data-task-id="${t.id}">◎</button>
      ${!isDone ? `<button class="task-action-btn" title="Done" aria-label="Mark task done" data-action="complete-task" data-task-id="${t.id}">✓</button>` : ''}
    </div>
  </div>`;
  }

  function renderTaskExpanded(t, showProject = false) {
    const isDone = t.status === 'done';
    const data = getData();
    const proj = showProject && t.project ? data.projects.find((x) => x.id === t.project) : null;

    const html = `<div class="task-expanded" data-task="${t.id}" data-expandable="true" role="listitem" aria-expanded="true">
    <div class="task-top">
      <div class="task-expand-dot" data-expandable="true" data-task="${t.id}" role="button" tabindex="0" aria-label="Collapse ${esc(t.title)}" title="Hide details">▾</div>
      <div class="task-body">
        <div class="task-title ${isDone ? 'done-text' : ''}">${esc(t.title)}</div>
        ${t.notes ? `<div class="task-note" style="white-space:normal;margin-top:4px">${esc(t.notes)}</div>` : ''}
      </div>
      <div class="task-tags">
        ${proj ? `<span class="tag tag-project" style="border-left:2px solid ${proj.color};padding-left:6px">${esc(proj.name)}</span>` : ''}
        ${renderPriorityTag(t.priority)}
        ${t.status === 'in-progress' ? '<span class="tag" style="background:rgba(59,130,246,0.1);color:var(--blue)">In Progress</span>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <button class="btn btn-ghost btn-sm" data-action="edit-task" data-task-id="${t.id}">Edit</button>
        ${!isDone ? `<button class="task-action-btn" title="Done" aria-label="Mark task done" data-action="complete-task" data-task-id="${t.id}">✓</button>` : `<div class="task-check done" data-toggle="${t.id}" role="checkbox" aria-checked="true" aria-label="Mark ${esc(t.title)} incomplete" tabindex="0"></div>`}
      </div>
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div class="task-detail-row"><span class="task-detail-label">Priority</span>${t.priority}</div>
      <div class="task-detail-row"><span class="task-detail-label">Horizon</span>${t.horizon === 'short' ? 'Short-term' : 'Long-term'}</div>
      ${t.phase ? `<div class="task-detail-row"><span class="task-detail-label">Phase</span>${esc(t.phase)}</div>` : ''}
      ${t.dueDate ? `<div class="task-detail-row"><span class="task-detail-label">Due</span>${fmtDate(t.dueDate)}</div>` : ''}
      ${t.estimatedMinutes ? `<div class="task-detail-row"><span class="task-detail-label">Estimate</span>${fmtEstimate(t.estimatedMinutes)}</div>` : ''}
      <div class="task-detail-row"><span class="task-detail-label">Created</span>${relativeTime(t.createdAt)}</div>
      ${t.completedAt ? `<div class="task-detail-row"><span class="task-detail-label">Done</span>${relativeTime(t.completedAt)}</div>` : ''}
      ${renderBlockedBy(t)}
      ${renderBlocking(t)}
      ${t.subtasks && t.subtasks.length ? `<div style="margin-top:10px"><div style="font-size:11px;color:var(--text3);margin-bottom:6px;font-weight:600">SUBTASKS</div>${t.subtasks.map((s) => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer" role="checkbox" aria-checked="${s.done}" aria-label="Mark subtask: ${esc(s.title)} complete" tabindex="0" data-action="toggle-subtask" data-task-id="${t.id}" data-subtask-id="${s.id}"><div style="width:14px;height:14px;border-radius:3px;border:1.5px solid ${s.done ? 'var(--accent)' : 'var(--border2)'};background:${s.done ? 'var(--accent)' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;flex-shrink:0">${s.done ? '✓' : ''}</div><span style="font-size:12px;color:${s.done ? 'var(--text3)' : 'var(--text)'};${s.done ? 'text-decoration:line-through' : ''}">${esc(s.title)}</span></div>`).join('')}</div>` : ''}
      <div style="margin-top:6px"><input style="font-size:11px;padding:4px 8px;background:transparent;border:1px dashed var(--border);border-radius:4px;color:var(--text2);width:100%;outline:none;font-family:inherit" placeholder="+ add subtask" aria-label="Add subtask" data-keydown-action="add-subtask" data-task-id="${t.id}"></div>
      ${t.updates && t.updates.length > 0 ? `<div style="margin-top:8px"><div style="font-size:11px;color:var(--text3);margin-bottom:4px;font-weight:600">UPDATES</div>${t.updates.map((u) => `<div style="font-size:12px;color:var(--text2);padding:3px 0"><span style="color:var(--text3)">${u.date}</span> — ${esc(u.text)}</div>`).join('')}</div>` : ''}
    </div>
    <input class="task-cmd" data-cmd="${t.id}" placeholder="Type: complete, update, deadline friday, move to [board]..." aria-label="Task command input" data-keydown-action="run-task-cmd" data-task-id="${t.id}">
  </div>`;
    return html;
  }

  function attachInlineEdit() {
    document.querySelectorAll('[data-inline-edit]').forEach((el) => {
      if (el._inlineEditBound) return;
      el._inlineEditBound = true;
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const taskId = el.dataset.inlineEdit;
        const t = findTask(taskId);
        if (!t) return;
        el.contentEditable = 'true';
        el.setAttribute('role', 'textbox');
        el.setAttribute('aria-label', 'Edit task title');
        el.classList.add('task-title-editable');
        el.focus();
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const save = () => {
          el.contentEditable = 'false';
          el.removeAttribute('role');
          el.removeAttribute('aria-label');
          el.classList.remove('task-title-editable');
          const newTitle = el.textContent.trim();
          if (newTitle && newTitle !== t.title) {
            updateTask(taskId, { title: newTitle });
            showToast('Title updated', false, true);
          } else {
            el.textContent = t.title; // revert
          }
        };
        el.onblur = save;
        el.onkeydown = (ke) => {
          if (ke.key === 'Enter') {
            ke.preventDefault();
            el.blur();
          }
          if (ke.key === 'Escape') {
            el.textContent = t.title;
            el.blur();
          }
        };
      });
    });
  }

  // ============================================================
  // TASK DEPENDENCIES
  // ============================================================
  function addDep(taskId, blockerQuery) {
    const data = getData();
    const t = findTask(taskId);
    if (!t) return;
    const blocker = matchTask(blockerQuery);
    if (!blocker || blocker.id === taskId) {
      showToast('Task not found', true);
      return;
    }
    if (!t.blockedBy) t.blockedBy = [];
    if (t.blockedBy.includes(blocker.id)) return;
    t.blockedBy.push(blocker.id);
    saveData(data);
    render();
    showToast(`"${t.title}" now blocked by "${blocker.title}"`, false, true);
  }

  function removeDep(taskId, blockerId) {
    const data = getData();
    const t = findTask(taskId);
    if (!t || !t.blockedBy) return;
    t.blockedBy = t.blockedBy.filter((id) => id !== blockerId);
    saveData(data);
    render();
  }

  function showDepResults(query, excludeId) {
    const el = document.getElementById('depResults');
    if (!el) return;
    const q = query.toLowerCase().trim();
    if (!q) {
      el.innerHTML = '';
      return;
    }
    const data = getData();
    const existing = [...document.querySelectorAll('#fBlockedBy [data-dep]')].map((e) => e.dataset.dep);
    const matches = data.tasks
      .filter((t) => t.id !== excludeId && !existing.includes(t.id) && t.title.toLowerCase().includes(q))
      .slice(0, 5);
    el.innerHTML = matches
      .map(
        (t) =>
          `<div class="dep-result hover-surface3" data-dep-id="${t.id}" data-dep-title="${esc(t.title.slice(0, TRUNCATE_TITLE))}" style="padding:4px 8px;font-size:12px;cursor:pointer;border-radius:4px;color:var(--text2)">${esc(t.title)}${t.status === 'done' ? ' <span style="color:var(--green)">✓</span>' : ''}</div>`,
      )
      .join('');
    el.querySelectorAll('.dep-result').forEach(
      (d) => (d.onclick = () => selectDep(d.dataset.depId, d.dataset.depTitle)),
    );
  }

  function selectDep(id, title) {
    const container = document.getElementById('fBlockedBy');
    if (!container) return;
    if (container.querySelector(`[data-dep="${id}"]`)) return;
    // Check for circular dependency
    const editingTaskId = document
      .querySelector('#fDepSearch')
      ?.closest('.modal')
      ?.querySelector('[onclick*="saveEditTask"]')
      ?.getAttribute('onclick')
      ?.match(/'([^']+)'/)?.[1];
    if (editingTaskId && wouldCreateCircularDep(editingTaskId, id)) {
      showToast('Cannot add — would create circular dependency', true);
      return;
    }
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.style.cssText = 'background:var(--red-dim);color:var(--red);cursor:pointer';
    chip.dataset.dep = id;
    chip.textContent = title;
    chip.onclick = () => chip.remove();
    container.appendChild(chip);
    document.getElementById('fDepSearch').value = '';
    document.getElementById('depResults').innerHTML = '';
  }

  function wouldCreateCircularDep(taskId, newBlockerId) {
    const visited = new Set();
    const queue = [newBlockerId];
    while (queue.length) {
      const cid = queue.shift();
      if (cid === taskId) return true;
      if (visited.has(cid)) continue;
      visited.add(cid);
      const t = findTask(cid);
      if (t && t.blockedBy) queue.push(...t.blockedBy);
    }
    return false;
  }

  // ============================================================
  // TASK INLINE COMMANDS (AI-powered)
  // ============================================================
  async function runTaskCmd(taskId, input) {
    input = input.trim();
    if (!input) return;

    const t = findTask(taskId);
    if (!t) return;
    const data = getData();

    const lower = input.toLowerCase();

    // Quick local commands (no AI needed)
    if (['done', 'complete', 'completed', 'finish', 'finished'].includes(lower)) {
      updateTask(taskId, { status: 'done' });
      setExpandedTask(null);
      render();
      showToast('Task completed');
      return;
    }

    if (['start', 'begin', 'working', 'in progress', 'wip'].includes(lower)) {
      updateTask(taskId, { status: 'in-progress' });
      render();
      return;
    }

    if (lower === 'delete' || lower === 'remove') {
      deleteTask(taskId);
      setExpandedTask(null);
      render();
      showToast('Task deleted');
      return;
    }

    // For everything else, use AI if available
    if (hasAI()) {
      await runTaskCmdAI(taskId, input);
    } else {
      // Fallback: add as update note
      if (!t.updates) t.updates = [];
      t.updates.push({ date: todayStr(), text: input });
      saveData(data);
      render();
      showToast('Update logged');
    }
  }

  function _buildTaskCmdPrompt(t, input) {
    const data = getData();
    const projects = data.projects.map((p) => ({ id: p.id, name: p.name }));
    const proj = data.projects.find((p) => p.id === t.project);

    return `${AI_PERSONA_SHORT}\n\nYou are a task command interpreter. The user typed a natural language command about this task.

TASK: "${t.title}" (priority: ${t.priority}, status: ${t.status}, project: ${proj ? proj.name : 'none'}, due: ${t.dueDate || 'none'}, notes: ${(t.notes || '').slice(0, 200) || 'none'}, subtasks: ${t.subtasks?.length || 0})

COMMAND: "${input}"

AVAILABLE PROJECTS: ${JSON.stringify(projects)}

Interpret the command and return a JSON object:
- { "action": "update", "fields": { ...fields to update... } } — update task fields (status, priority, dueDate, notes, project, title)
- { "action": "log", "text": "..." } — add an update log entry
- { "action": "both", "fields": {...}, "text": "..." } — update fields AND log
- { "action": "subtasks", "add": ["step 1", "step 2"] } — add subtasks
- { "action": "break", "into": [{"title": "...", "priority": "normal"}, ...] } — break task into multiple tasks

For dates: today is ${todayStr()}. "Friday" = next upcoming Friday. Return dates as YYYY-MM-DD.
For "move to [board]": match to closest project name and set project field to that project's id.
Commands like "break this down" or "plan this out" → use "subtasks" action.

ONLY return JSON.`;
  }

  function _applyTaskCmd(cmd, taskId, t, input) {
    const data = getData();
    if (cmd.action === 'update' || cmd.action === 'both') {
      if (cmd.fields) {
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
          if (k in cmd.fields) safe[k] = cmd.fields[k];
        }
        updateTask(taskId, safe);
      }
    }
    if (cmd.action === 'log' || cmd.action === 'both') {
      if (!t.updates) t.updates = [];
      t.updates.push({ date: todayStr(), text: cmd.text || input });
      saveData(data);
    }
    if (cmd.action === 'subtasks' && cmd.add) {
      if (!t.subtasks) t.subtasks = [];
      cmd.add.forEach((s) => t.subtasks.push({ id: genId('st'), title: s, done: false }));
      saveData(data);
    }
    if (cmd.action === 'break' && cmd.into) {
      cmd.into.forEach((item) => {
        addTask(
          createTask({
            title: item.title,
            project: t.project,
            priority: item.priority || t.priority,
            notes: item.notes || '',
            dueDate: item.dueDate || '',
          }),
        );
      });
      deleteTask(taskId);
    }
  }

  async function runTaskCmdAI(taskId, input) {
    const t = findTask(taskId);
    if (!t) return;
    const data = getData();

    const cmdInput = document.querySelector(`[data-cmd="${taskId}"]`);
    if (cmdInput) {
      cmdInput.disabled = true;
      cmdInput.placeholder = 'AI processing...';
      cmdInput.value = '';
    }

    const prompt = _buildTaskCmdPrompt(t, input);

    try {
      const content = await callAI(prompt, { maxTokens: 1024, temperature: 0.3 });
      const cmd = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      _applyTaskCmd(cmd, taskId, t, input);
      render();
      showToast('Updated');
    } catch (_err) {
      // Fallback to logging
      if (!t.updates) t.updates = [];
      t.updates.push({ date: todayStr(), text: input });
      saveData(data);
      render();
      showToast('Logged (AI unavailable)');
    } finally {
      const ci = document.querySelector(`[data-cmd="${taskId}"]`);
      if (ci) {
        ci.disabled = false;
        ci.placeholder = 'Type: complete, update, deadline friday, move to [board]...';
      }
    }
  }

  // ============================================================
  // TASK MODALS (New / Edit)
  // ============================================================
  function openNewTask(projectId = '', prefillDate = '') {
    setModalLabel('New task');
    const data = getData();
    const projOpts = data.projects
      .map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    const dueDateValue = prefillDate || '';
    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" aria-labelledby="modal-title-new-task">
    <h2 class="modal-title" id="modal-title-new-task">New Task</h2>
    <div class="form-group"><label class="form-label" for="fTitle">Title</label><input class="form-input" id="fTitle" placeholder="What needs to be done?" autofocus required></div>
    <div class="form-group"><label class="form-label" for="fNotes">Notes</label><textarea class="form-textarea" id="fNotes" rows="3" placeholder="Details..."></textarea></div>
    <fieldset class="form-fieldset"><legend class="sr-only">Priority and Status</legend>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="fPriority">Priority</label><select class="form-select" id="fPriority"><option value="urgent">Urgent</option><option value="important">Important</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></div>
    </div>
    </fieldset>
    <fieldset class="form-fieldset"><legend class="sr-only">Dates and Scheduling</legend>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="fProject">Project</label><select class="form-select" id="fProject"><option value="">None</option>${projOpts}</select></div>
      <div class="form-group"><label class="form-label" for="fDue">Due Date</label>${smartDateInput('fDue', dueDateValue)}</div>
    </div>
    </fieldset>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-new-task">Add</button></div>
  </div></div>`;
    $('#fTitle').focus();
    $('#fTitle').onkeydown = (e) => {
      if (e.key === 'Enter') saveNewTask();
    };
    // Smart defaults: suggest fields as user types title
    $('#fTitle').addEventListener('input', () => {
      const val = $('#fTitle').value.trim();
      if (val.length < 5 || typeof getSmartDefaults !== 'function') return;
      const defaults = getSmartDefaults(val);
      const labels = document.querySelectorAll('.ai-suggestion-label');
      labels.forEach((l) => l.remove());
      if (defaults.suggestedPriority && $('#fPriority').value === 'normal') {
        $('#fPriority').value = defaults.suggestedPriority;
        const label = document.createElement('span');
        label.className = 'ai-suggestion-label';
        label.style.cssText = 'font-size:10px;color:var(--accent);margin-left:6px';
        label.textContent = '(AI suggested)';
        $('#fPriority').parentElement.querySelector('.form-label').appendChild(label);
      }
      if ((defaults.suggestedProject && $('#fProject').value === '') || $('#fProject').value === projectId) {
        $('#fProject').value = defaults.suggestedProject;
        const label = document.createElement('span');
        label.className = 'ai-suggestion-label';
        label.style.cssText = 'font-size:10px;color:var(--accent);margin-left:6px';
        label.textContent = '(AI suggested)';
        $('#fProject').parentElement.querySelector('.form-label').appendChild(label);
      }
    });
    if (dueDateValue) {
      const prev = document.getElementById('fDue_preview');
      if (prev) {
        const d = new Date(dueDateValue + 'T12:00:00');
        prev.innerHTML =
          '<span style="color:var(--green)">' +
          d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
          '</span>';
        prev.style.display = 'block';
      }
    }
    pushModalState('new-task');
    const _ntModal = $('#modalRoot').querySelector('.modal-overlay');
    if (_ntModal) {
      const cleanup = getTrapFocusCleanup();
      if (cleanup) {
        cleanup();
      }
      setTrapFocusCleanup(trapFocus(_ntModal));
    }
  }

  function saveNewTask() {
    const title = $('#fTitle').value.trim();
    if (!title) return;
    const priority = $('#fPriority').value;
    const project = $('#fProject').value;
    const newTask = createTask({
      title,
      notes: $('#fNotes').value.trim(),
      priority,
      project,
      dueDate: resolveSmartDate('fDue'),
    });
    addTask(newTask);
    closeModal();
    render();
    // AI auto-classify: if user left priority as normal and no project, ask AI to suggest
    if (hasAI() && priority === 'normal' && !project) {
      autoClassifyTask(newTask);
    }
    maybeProactiveEnhance(newTask);
  }

  async function autoClassifyTask(task) {
    try {
      const data = getData();
      const projects = data.projects.map((p) => p.name + ' (id:' + p.id + ')').join(', ');
      const resp = await callAI(
        'Classify this task. Title: "' +
          task.title +
          '"\nExisting projects: ' +
          projects +
          '\n\nReturn JSON only: {"project":"project_id or empty","priority":"urgent|important|normal|low","reason":"5 words max"}' +
          '\nRules: only use an existing project ID. Only set urgent/important if clearly warranted. If unsure, leave project empty and priority normal.',
        { maxTokens: 100, temperature: 0.3 },
      );
      if (!resp) return;
      const match = resp.match(/\{[\s\S]*\}/);
      if (!match) return;
      const cls = JSON.parse(match[0]);
      const updates = {};
      let changed = false;
      if (cls.project && data.projects.find((p) => p.id === cls.project)) {
        updates.project = cls.project;
        changed = true;
      }
      if (cls.priority && cls.priority !== 'normal' && ['urgent', 'important', 'low'].includes(cls.priority)) {
        updates.priority = cls.priority;
        changed = true;
      }
      if (changed) {
        updateTask(task.id, updates);
        const proj = updates.project ? data.projects.find((p) => p.id === updates.project) : null;
        const parts = [];
        if (proj) parts.push('→ ' + proj.name);
        if (updates.priority) parts.push(updates.priority);
        showToast('✦ Auto-classified: ' + parts.join(', '));
        render();
      }
    } catch (_e) {
      console.warn('auto-classification failed:', _e.message || _e);
    }
  }

  function openEditTask(id) {
    setModalTriggerEl(document.activeElement);
    setModalLabel('Edit task');
    const t = findTask(id);
    if (!t) return;
    const data = getData();
    const projOpts = data.projects
      .map((p) => `<option value="${p.id}" ${t.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-edit-modal" data-click-self="true"><div class="modal" aria-labelledby="modal-title-edit-task">
    <h2 class="modal-title" id="modal-title-edit-task">Edit Task</h2>
    <div class="form-group"><label class="form-label" for="fTitle">Title</label><input class="form-input" id="fTitle" value="${esc(t.title)}" required></div>
    <div class="form-group"><label class="form-label" for="fNotes">Notes</label><textarea class="form-textarea" id="fNotes" rows="3">${esc(t.notes)}</textarea></div>
    <fieldset class="form-fieldset"><legend class="sr-only">Priority and Status</legend>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="fStatus">Status</label><select class="form-select" id="fStatus"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option><option value="in-progress" ${t.status === 'in-progress' ? 'selected' : ''}>In Progress</option><option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option></select></div>
      <div class="form-group"><label class="form-label" for="fPriority">Priority</label><select class="form-select" id="fPriority"><option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgent</option><option value="important" ${t.priority === 'important' ? 'selected' : ''}>Important</option><option value="normal" ${t.priority === 'normal' ? 'selected' : ''}>Normal</option><option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option></select></div>
    </div>
    </fieldset>
    <fieldset class="form-fieldset"><legend class="sr-only">Dates and Scheduling</legend>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="fProject">Project</label><select class="form-select" id="fProject"><option value="">None</option>${projOpts}</select></div>
      <div class="form-group"><label class="form-label" for="fDue">Due Date</label>${smartDateInput('fDue', t.dueDate || '')}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="fRecurrence">Repeats</label><select class="form-select" id="fRecurrence"><option value="" ${!t.recurrence ? 'selected' : ''}>Never</option><option value="daily" ${t.recurrence === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${t.recurrence === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${t.recurrence === 'monthly' ? 'selected' : ''}>Monthly</option></select></div>
      <div class="form-group"><label class="form-label" for="fPhase">Phase</label><input class="form-input" id="fPhase" value="${esc(t.phase || '')}" placeholder="e.g. Phase 1"></div>
    </div>
    </fieldset>
    <div class="form-group"><label class="form-label" for="fEstimate">Time Estimate</label>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input class="form-input" id="fEstimate" type="number" min="0" value="${t.estimatedMinutes || 0}" placeholder="minutes" style="width:80px" aria-describedby="fEstimateHelp">
        <span id="fEstimateHelp" style="font-size:11px;color:var(--text3)">min</span>
        ${[15, 30, 60, 120, 240].map((m) => `<button type="button" class="btn btn-sm" style="padding:3px 8px;font-size:10px;${(t.estimatedMinutes || 0) === m ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}" data-action="set-estimate" data-minutes="${m}">${m < 60 ? m + 'm' : m / 60 + 'h'}</button>`).join('')}
      </div>
    </div>
    <div class="form-group"><label class="form-label" for="fTagPicker">Tags</label>
      <div class="tag-picker" id="fTagPicker">${renderTagPicker(t.tags || [])}</div>
    </div>
    <fieldset class="form-fieldset"><legend class="sr-only">Dependencies</legend>
    <div class="form-group"><label class="form-label" for="fDepSearch">Blocked By</label>
      <div id="fBlockedBy" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">${(t.blockedBy || [])
        .map((id) => {
          const b = findTask(id);
          return b
            ? `<span class="tag" style="background:var(--red-dim);color:var(--red);cursor:pointer" data-dep="${id}" data-action="remove-dep-chip">${esc(b.title.slice(0, TRUNCATE_TITLE))}</span>`
            : '';
        })
        .join('')}</div>
      <input class="form-input" id="fDepSearch" placeholder="Type task name to add dependency..." style="font-size:12px" data-oninput-action="dep-search" data-exclude-id="${t.id}" data-keydown-action="dep-search-escape">
      <div id="depResults" aria-live="polite" style="max-height:120px;overflow-y:auto"></div>
    </div>
    </fieldset>
    <div class="modal-actions">
      <button class="btn btn-sm" style="color:var(--accent)" data-action="save-as-template" data-task-id="${t.id}" title="Save current task as a reusable template">Save as Template</button>
      <button class="btn btn-danger btn-sm" data-action="delete-task-confirm" data-task-id="${t.id}">Delete</button>
      <div style="flex:1"></div>
      <button class="btn" data-action="close-edit-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-edit-task" data-task-id="${t.id}">Save</button>
    </div>
  </div></div>`;
    pushModalState('edit-task');
    // Capture snapshot of initial form state for unsaved-changes detection
    _editSnapshot = {};
    for (const id of ['fTitle', 'fNotes', 'fStatus', 'fPriority', 'fProject', 'fRecurrence', 'fPhase']) {
      const el = document.getElementById(id);
      _editSnapshot[id] = el ? el.value : '';
    }
    setTimeout(() => {
      const m = $('#modalRoot').querySelector('.modal-overlay');
      if (m) {
        const cleanup = getTrapFocusCleanup();
        if (cleanup) {
          cleanup();
        }
        setTrapFocusCleanup(trapFocus(m));
      }
    }, 0);
  }

  function guardedCloseEditModal() {
    if (_hasUnsavedEdits()) {
      if (!confirm('You have unsaved changes. Discard?')) return;
    }
    _editSnapshot = null;
    closeModal();
  }

  function saveEditTask(id) {
    _editSnapshot = null;
    const tags = [...document.querySelectorAll('#fTagPicker .tag-chip.selected')]
      .map((el) => el.dataset.tag)
      .filter(Boolean);
    const blockedBy = [...document.querySelectorAll('#fBlockedBy [data-dep]')]
      .map((el) => el.dataset.dep)
      .filter(Boolean);
    const estimatedMinutes = parseInt($('#fEstimate').value) || 0;
    updateTask(id, {
      title: $('#fTitle').value.trim(),
      notes: $('#fNotes').value.trim(),
      status: $('#fStatus').value,
      priority: $('#fPriority').value,
      project: $('#fProject').value,
      dueDate: resolveSmartDate('fDue'),
      recurrence: $('#fRecurrence').value,
      phase: $('#fPhase').value.trim(),
      tags,
      blockedBy,
      estimatedMinutes,
    });
    closeModal();
    render();
  }

  return {
    openNewTask,
    saveNewTask,
    openEditTask,
    saveEditTask,
    autoClassifyTask,
    attachInlineEdit,
    renderTaskExpanded,
    renderTaskRow,
    renderPriorityTag,
    priorityColor,
    taskNudge,
    runTaskCmd,
    runTaskCmdAI,
    addDep,
    removeDep,
    showDepResults,
    selectDep,
    wouldCreateCircularDep,
    guardedCloseEditModal,
  };
}
