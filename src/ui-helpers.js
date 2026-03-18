// ============================================================
// UI HELPERS MODULE
// ============================================================
// Extracted from app.js — handles toasts, subtask progress, tags,
// bulk mode, smart date inputs, task dependencies rendering,
// project background parsing, notifications, sidebar, and AI throttling.

import { TAG_COLORS } from './constants.js';
import { todayStr, parseNaturalDate } from './dates.js';

/**
 * Factory function to create UI helper functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ showToast, renderSubtaskProgress, getTagColor, getAllTags, renderTagChips, filterByTag, renderTagPicker, addTagToPicker, toggleBulkMode, renderBulkBar, attachBulkListeners, smartDateInput, previewSmartDate, resolveSmartDate, isBlocked, renderBlockedBy, renderBlocking, parseProjectBackground, requestNotificationPermission, notifyOverdueTasks, _dismissProactiveBanner, getProactiveResults, setProactiveResults, toggleSidebar, throttleAI }}
 */
export function createUIHelpers(deps) {
  const { esc, userKey, findTask, getData, getRender } = deps;

  // --- State managed by this module ---
  let _proactiveResults = null;
  const _aiCallTimestamps = {};

  // ============================================================
  // TOAST
  // ============================================================
  function showToast(msg, isError = false, isSuccess = false) {
    document.querySelectorAll('.toast:not(.toast-undo)').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '') + (isSuccess ? ' success' : '');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    const live = document.getElementById('ariaLive');
    if (live) live.textContent = msg;
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 300);
    }, 2700);
  }

  // ============================================================
  // SUBTASK PROGRESS
  // ============================================================
  function _countSubtasksRecursive(subtasks) {
    let done = 0,
      total = 0;
    for (const s of subtasks) {
      total++;
      if (s.done) done++;
      if (s.subtasks && s.subtasks.length) {
        const child = _countSubtasksRecursive(s.subtasks);
        done += child.done;
        total += child.total;
      }
    }
    return { done, total };
  }

  function renderSubtaskProgress(subtasks) {
    const { done, total } = _countSubtasksRecursive(subtasks);
    const pct = Math.round((done / total) * 100);
    const cls = done === total ? ' complete' : '';
    return `<div class="subtask-progress"><div class="subtask-bar"><div class="subtask-bar-fill${cls}" style="width:${pct}%"></div></div><span>${done}/${total}</span></div>`;
  }

  // ============================================================
  // TAGS SYSTEM
  // ============================================================
  function getTagColor(tagName) {
    let hash = 0;
    for (let i = 0; i < tagName.length; i++) hash = (hash << 5) - hash + tagName.charCodeAt(i);
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  }

  function getAllTags() {
    const tags = new Set();
    getData().tasks.forEach((t) => (t.tags || []).forEach((tag) => tags.add(tag)));
    return [...tags].sort();
  }

  function renderTagChips(tags) {
    if (!tags || !tags.length) return '';
    return tags
      .map((tag) => {
        const c = getTagColor(tag);
        return `<span class="tag tag-label tag-filter-btn" role="button" tabindex="0" style="background:${c.bg};color:${c.color}" data-tag="${esc(tag)}">${esc(tag)}</span>`;
      })
      .join('');
  }

  function filterByTag(tag) {
    const setActiveTagFilter = deps.setActiveTagFilter;
    const getActiveTagFilter = deps.getActiveTagFilter;
    setActiveTagFilter(getActiveTagFilter() === tag ? '' : tag);
    getRender()();
  }

  function renderTagPicker(selectedTags) {
    const allTags = getAllTags();
    const selected = new Set(selectedTags);
    let html = allTags
      .map((tag) => {
        const c = getTagColor(tag);
        const sel = selected.has(tag) ? ' selected' : '';
        return `<span class="tag-chip${sel}" data-tag="${esc(tag)}" style="background:${c.bg};color:${c.color}" data-action="toggle-tag-chip" role="button" tabindex="0">${esc(tag)}</span>`;
      })
      .join('');
    html += `<input class="tag-add-input" placeholder="+ new tag" aria-label="Add tag" data-keydown-action="add-tag">`;
    return html;
  }

  function addTagToPicker(input) {
    const tag = input.value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .slice(0, 20);
    if (!tag) return;
    const picker = input.closest('.tag-picker');
    // Check if already exists
    if (picker.querySelector(`[data-tag="${tag}"]`)) {
      picker.querySelector(`[data-tag="${tag}"]`).classList.add('selected');
      input.value = '';
      return;
    }
    const c = getTagColor(tag);
    const chip = document.createElement('span');
    chip.className = 'tag-chip selected';
    chip.dataset.tag = tag;
    chip.style.background = c.bg;
    chip.style.color = c.color;
    chip.textContent = tag;
    chip.onclick = () => chip.classList.toggle('selected');
    picker.insertBefore(chip, input);
    input.value = '';
  }

  // ============================================================
  // BULK ACTIONS
  // ============================================================
  function toggleBulkMode() {
    const getBulkMode = deps.getBulkMode;
    const setBulkMode = deps.setBulkMode;
    const getBulkSelected = deps.getBulkSelected;
    setBulkMode(!getBulkMode());
    getBulkSelected().clear();
    getRender()();
  }

  function renderBulkBar() {
    const existing = document.getElementById('bulkBar');
    if (existing) existing.remove();
    const bulkMode = deps.getBulkMode();
    const bulkSelected = deps.getBulkSelected();
    if (!bulkMode || bulkSelected.size === 0) return;

    const bar = document.createElement('div');
    bar.id = 'bulkBar';
    bar.className = 'bulk-bar';
    const projOpts = getData()
      .projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join('');
    bar.innerHTML = `
    <div class="bulk-bar-count">${bulkSelected.size} selected</div>
    <button class="btn btn-sm" data-action="bulk-action" data-bulk-type="done">\u2713 Done</button>
    <button class="btn btn-sm" data-action="bulk-action" data-bulk-type="todo">\u25CB To Do</button>
    <select class="form-select" style="font-size:11px;padding:4px 8px;max-width:140px" aria-label="Move selected tasks to board" data-onchange-action="bulk-move">
      <option value="">Move to...</option>${projOpts}
    </select>
    <select class="form-select" style="font-size:11px;padding:4px 8px;max-width:110px" aria-label="Set priority for selected tasks" data-onchange-action="bulk-priority">
      <option value="">Priority...</option><option value="urgent">Urgent</option><option value="important">Important</option><option value="normal">Normal</option><option value="low">Low</option>
    </select>
    <button class="btn btn-sm" style="color:var(--red)" data-action="bulk-action" data-bulk-type="delete">Delete</button>
    <div style="flex:1"></div>
    <button class="btn btn-sm" data-action="bulk-cancel">Cancel</button>
  `;
    document.body.appendChild(bar);
  }

  function attachBulkListeners() {
    const bulkMode = deps.getBulkMode();
    const bulkSelected = deps.getBulkSelected();
    if (!bulkMode) return;
    document.querySelectorAll('[data-bulk]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.bulk;
        if (bulkSelected.has(id)) bulkSelected.delete(id);
        else bulkSelected.add(id);
        getRender()();
      };
    });
  }

  // ============================================================
  // SMART DATE INPUT
  // ============================================================
  const isMobileDevice = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  function smartDateInput(id, value) {
    if (isMobileDevice) return `<input class="form-input" id="${id}" type="date" value="${value || ''}">`;
    return `<div style="position:relative">
    <div style="display:flex;align-items:center;gap:0">
      <input class="form-input" id="${id}" type="text" value="${value || ''}" placeholder="tomorrow, next friday, mar 20..." autocomplete="off" data-oninput-action="smart-date-preview" data-date-id="${id}" style="flex:1;border-top-right-radius:0;border-bottom-right-radius:0">
      <input type="date" id="${id}_native" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none" data-onchange-action="native-date-pick" data-target="${id}">
      <button type="button" data-action="open-native-date-picker" data-target="${id}_native" style="height:38px;width:38px;border:1px solid var(--border2);border-left:none;border-radius:0 var(--radius-xs) var(--radius-xs) 0;background:var(--surface2);color:var(--text3);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center" title="Pick from calendar" aria-label="Open date picker">&#128197;</button>
    </div>
    <div id="${id}_preview" class="smart-date-preview" aria-live="polite"></div>
  </div>`;
  }

  function previewSmartDate(id) {
    const inp = document.getElementById(id);
    const prev = document.getElementById(id + '_preview');
    if (!inp || !prev) return;
    const val = inp.value.trim();
    if (!val) {
      prev.innerHTML = '';
      prev.style.display = 'none';
      return;
    }
    // Try ISO date first
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const d = new Date(val + 'T12:00:00');
      prev.innerHTML = `<span style="color:var(--green)">${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
      prev.style.display = 'block';
      return;
    }
    const result = parseNaturalDate(val);
    if (result.dueDate) {
      const d = new Date(result.dueDate + 'T12:00:00');
      prev.innerHTML = `<span style="color:var(--green)">${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
      prev.style.display = 'block';
    } else {
      prev.innerHTML = '';
      prev.style.display = 'none';
    }
  }

  function resolveSmartDate(id) {
    const inp = document.getElementById(id);
    if (!inp) return '';
    const val = inp.value.trim();
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const result = parseNaturalDate(val);
    return result.dueDate || '';
  }

  // ============================================================
  // TASK DEPENDENCIES
  // ============================================================
  function isBlocked(t) {
    if (!t.blockedBy || !t.blockedBy.length) return false;
    return t.blockedBy.some((id) => {
      const dep = findTask(id);
      return dep && dep.status !== 'done';
    });
  }

  function renderBlockedBy(t) {
    if (!t.blockedBy || !t.blockedBy.length) return '';
    const blockers = t.blockedBy.map((id) => findTask(id)).filter(Boolean);
    if (!blockers.length) return '';
    return `<div style="margin-top:6px"><div style="font-size:11px;color:var(--text3);margin-bottom:3px;font-weight:600">BLOCKED BY</div>${blockers
      .map(
        (b) =>
          `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px">
      <span style="color:${b.status === 'done' ? 'var(--green)' : 'var(--red)'}">${b.status === 'done' ? '\u2713' : '\u25CB'}</span>
      <span style="color:${b.status === 'done' ? 'var(--text3)' : 'var(--text)'};${b.status === 'done' ? 'text-decoration:line-through' : ''}">${esc(b.title)}</span>
      <span style="font-size:10px;color:var(--text3);cursor:pointer" data-action="remove-dep" data-task-id="${t.id}" data-blocker-id="${b.id}" role="button" tabindex="0" aria-label="Remove dependency">\u2715</span>
    </div>`,
      )
      .join('')}</div>`;
  }

  function renderBlocking(t) {
    const blocking = getData().tasks.filter((x) => x.blockedBy && x.blockedBy.includes(t.id) && x.status !== 'done');
    if (!blocking.length) return '';
    return `<div style="margin-top:4px;font-size:11px;color:var(--amber)">Blocking: ${blocking.map((b) => esc(b.title)).join(', ')}</div>`;
  }

  // ============================================================
  // PROJECT BACKGROUND
  // ============================================================
  function parseProjectBackground(bg) {
    if (!bg) return null;
    // Structured format: sections separated by ## headers
    const sections = { origin: '', direction: '', roadblocks: '', nextSteps: '', notes: '' };
    const map = {
      origin: 'origin',
      'where it started': 'origin',
      direction: 'direction',
      "where it's going": 'direction',
      roadblocks: 'roadblocks',
      blockers: 'roadblocks',
      'next steps': 'nextSteps',
      next: 'nextSteps',
      notes: 'notes',
      other: 'notes',
    };
    let current = 'notes';
    bg.split('\n').forEach((line) => {
      const header = line.match(/^##\s*(.+)/);
      if (header) {
        const key = header[1].trim().toLowerCase();
        current = map[key] || 'notes';
      } else {
        sections[current] += (sections[current] ? '\n' : '') + line;
      }
    });
    // Trim all
    Object.keys(sections).forEach((k) => {
      sections[k] = sections[k].trim();
    });
    // If nothing parsed into sections, put it all in notes
    if (!sections.origin && !sections.direction && !sections.roadblocks && !sections.nextSteps) {
      sections.notes = bg.trim();
    }
    return sections;
  }

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  function requestNotificationPermission() {
    if (!('Notification' in window) || localStorage.getItem(userKey('wb_notif_asked'))) return;
    localStorage.setItem(userKey('wb_notif_asked'), '1');
    Notification.requestPermission();
  }

  function notifyOverdueTasks() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const overdue = getData().tasks.filter(function (t) {
      return t.status !== 'done' && !t.archived && t.dueDate && t.dueDate < todayStr();
    });
    if (!overdue.length) return;
    const n = new Notification('You have ' + overdue.length + ' overdue task' + (overdue.length > 1 ? 's' : ''), {
      body:
        overdue
          .slice(0, 3)
          .map(function (t) {
            return t.title;
          })
          .join(', ') + (overdue.length > 3 ? '...' : ''),
    });
    n.onclick = function () {
      window.focus();
      n.close();
    };
  }

  // ============================================================
  // PROACTIVE BANNER
  // ============================================================
  function _dismissProactiveBanner() {
    _proactiveResults = null;
    getRender()();
  }

  function getProactiveResults() {
    return _proactiveResults;
  }
  function setProactiveResults(v) {
    _proactiveResults = v;
  }

  // ============================================================
  // SIDEBAR
  // ============================================================
  function toggleSidebar() {
    const getSidebarCollapsed = deps.getSidebarCollapsed;
    const setSidebarCollapsed = deps.setSidebarCollapsed;
    const $ = deps.$;
    setSidebarCollapsed(!getSidebarCollapsed());
    localStorage.setItem(userKey('wb_sidebar_collapsed'), getSidebarCollapsed());
    const sidebarEl = $('#sidebar');
    if (sidebarEl) sidebarEl.classList.toggle('collapsed', getSidebarCollapsed());
  }

  // ============================================================
  // AI THROTTLING
  // ============================================================
  function throttleAI(key, cooldownMs = 5000) {
    const now = Date.now();
    if (_aiCallTimestamps[key] && now - _aiCallTimestamps[key] < cooldownMs) return false;
    _aiCallTimestamps[key] = now;
    return true;
  }

  return {
    showToast,
    renderSubtaskProgress,
    getTagColor,
    getAllTags,
    renderTagChips,
    filterByTag,
    renderTagPicker,
    addTagToPicker,
    toggleBulkMode,
    renderBulkBar,
    attachBulkListeners,
    smartDateInput,
    previewSmartDate,
    resolveSmartDate,
    isBlocked,
    renderBlockedBy,
    renderBlocking,
    parseProjectBackground,
    requestNotificationPermission,
    notifyOverdueTasks,
    _dismissProactiveBanner,
    getProactiveResults,
    setProactiveResults,
    toggleSidebar,
    throttleAI,
  };
}
