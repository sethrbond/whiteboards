// ============================================================
// DATA LAYER MODULE
// ============================================================
// Extracted from app.js — handles data persistence, CRUD operations,
// undo system, task queries, render caching, and archive management.

import {
  STORE_KEY,
  SETTINGS_KEY,
  LIFE_PROJECT_NAME,
  PROJECT_COLORS,
  DEFAULT_SETTINGS,
  MS_PER_DAY,
  MAX_UNDO_STACK,
  ARCHIVE_CLEANUP_DAYS,
  STALE_TASK_DAYS,
  MAX_NOTES_LENGTH,
  SAVE_DEBOUNCE_MS,
} from './constants.js';
import { titleSimilarity, genId } from './utils.js';
import { todayStr } from './dates.js';
import { migrateData, CURRENT_SCHEMA_VERSION } from './migrations.js';

const VALID_STATUSES = ['todo', 'in-progress', 'done'];
const VALID_PRIORITIES = ['urgent', 'important', 'normal', 'low'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_HORIZONS = ['short', 'long', ''];
const VALID_RECURRENCES = ['daily', 'weekly', 'monthly', ''];

/**
 * Factory function to create the data layer.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ loadData, saveData, _flushSave, loadSettings, saveSettings, validateTaskFields, createTask, createProject, addTask, updateTask, deleteTask, addProject, updateProject, deleteProject, addSubtask, toggleSubtask, pushUndo, undo, showUndoToast, findSimilarTask, findSimilarProject, findTask, getTaskMap, ensureLifeProject, getLifeProjectId, activeTasks, doneTasks, urgentTasks, archivedTasks, projectTasks, applyTagFilter, cleanupArchive, unarchiveTask, deleteArchivedPermanently, _rc, getData, setData, getSettings, setSettings, getDataVersion, setDataVersion, getRenderCache, setRenderCache, getTaskMapState, setTaskMapState, getUndoStack, clearUndoStack, restoreFromBackup, dismissCorruption }}
 */
export function createDataLayer(deps) {
  const {
    userKey,
    getCurrentUser,
    getScheduleSyncToCloud,
    getShowToast,
    getRender,
    getMaybeReflect,
    getMaybeLearnPattern,
    getSuppressCloudSync,
    getBatchMode,
    getActiveTagFilter,
    getNudgeFilter,
    getPruneStaleMemories,
    getExpandedTask,
    setExpandedTask,
    getGetFollowUpSuggestions,
    getShowFollowUpToast,
  } = deps;

  // --- Module-local state ---
  let data = { tasks: [], projects: [] };
  let settings = { ...DEFAULT_SETTINGS };
  const undoStack = []; // [{ label, snapshot }] — max 20
  let _renderCache = { version: -1 };
  let _taskMap = new Map();
  let _taskMapVersion = -1;
  let _dataVersion = 0;
  let _saveDebounceTimer = null;
  let _saveDebounceData = null;

  // --- Corruption recovery state ---
  let _corruptionBannerShown = false;

  // --- Persistent undo helpers ---
  const PERSISTENT_UNDO_LIMIT = 3;

  function _undoStorageKey() {
    return 'wb_undo_' + userKey('undo');
  }

  function _persistUndoStack() {
    try {
      const toSave = undoStack.slice(-PERSISTENT_UNDO_LIMIT);
      localStorage.setItem(_undoStorageKey(), JSON.stringify(toSave));
    } catch (_e) {
      /* quota — silently skip */
    }
  }

  function _restoreUndoStack() {
    try {
      const raw = localStorage.getItem(_undoStorageKey());
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        // Only restore if stack is currently empty (initial load)
        if (undoStack.length === 0) {
          saved.forEach((entry) => {
            if (entry && entry.label && entry.snapshot) undoStack.push(entry);
          });
        }
      }
    } catch (_e) {
      /* corrupted undo storage — ignore */
    }
  }

  // --- Validation ---
  function validateTaskFields(t) {
    if (t.status !== undefined && !VALID_STATUSES.includes(t.status)) t.status = 'todo';
    if (t.priority !== undefined && !VALID_PRIORITIES.includes(t.priority)) t.priority = 'normal';
    if (t.dueDate !== undefined && t.dueDate !== '' && !DATE_RE.test(t.dueDate)) t.dueDate = '';
    if (
      t.estimatedMinutes !== undefined &&
      (typeof t.estimatedMinutes !== 'number' || t.estimatedMinutes < 0 || !isFinite(t.estimatedMinutes))
    )
      t.estimatedMinutes = 0;
    if (t.horizon !== undefined && !VALID_HORIZONS.includes(t.horizon)) t.horizon = 'short';
    if (t.recurrence !== undefined && !VALID_RECURRENCES.includes(t.recurrence)) t.recurrence = '';
    if (t.tags !== undefined && !Array.isArray(t.tags)) t.tags = [];
    if (t.subtasks !== undefined && !Array.isArray(t.subtasks)) t.subtasks = [];
    if (t.blockedBy !== undefined && !Array.isArray(t.blockedBy)) t.blockedBy = [];
    if (t.updates !== undefined && !Array.isArray(t.updates)) t.updates = [];
    if (t.archived !== undefined && typeof t.archived !== 'boolean') t.archived = false;
    if (t.title !== undefined && typeof t.title === 'string') t.title = t.title.slice(0, 500);
    if (t.notes !== undefined && typeof t.notes === 'string') t.notes = t.notes.slice(0, MAX_NOTES_LENGTH);
    return t;
  }

  // --- Load / Save ---
  function loadData() {
    try {
      const raw = localStorage.getItem(userKey(STORE_KEY));
      let d = JSON.parse(raw);
      if (d && Array.isArray(d.tasks)) {
        if (!d.projects) d.projects = [];
        // Pre-migration backup — preserve raw data in case migration corrupts
        if (d._schemaVersion !== CURRENT_SCHEMA_VERSION && raw) {
          try {
            localStorage.setItem(userKey(STORE_KEY) + '_backup', raw);
          } catch (_e) {
            /* quota */
          }
        }
        d = migrateData(d);
        // Filter out corrupt tasks (missing id or title)
        d.tasks = d.tasks.filter((t) => t && t.id && t.title);
        // Validate fields on each task
        d.tasks.forEach(validateTaskFields);
        // Restore persistent undo stack from localStorage
        _restoreUndoStack();
        return d;
      }
    } catch (e) {
      console.warn('loadData failed:', e);
      // JSON parse error — check for backup
      const backupKey = userKey(STORE_KEY) + '_backup';
      const backup = localStorage.getItem(backupKey);
      if (backup) {
        _showCorruptionBanner();
      }
    }
    return { tasks: [], projects: [] };
  }

  // --- Corruption recovery UI ---
  function _showCorruptionBanner() {
    if (_corruptionBannerShown) return;
    _corruptionBannerShown = true;
    // Defer to next tick so DOM is ready
    setTimeout(() => {
      const existing = document.getElementById('corruptionBanner');
      if (existing) existing.remove();
      const banner = document.createElement('div');
      banner.id = 'corruptionBanner';
      banner.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;background:#991b1b;color:#fff;padding:14px 20px;text-align:center;font-family:inherit;font-size:14px;';
      banner.innerHTML =
        'Data may be corrupted. Backup found. ' +
        '<button data-action="restore-backup" style="margin-left:8px;background:#fff;color:#991b1b;border:none;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Restore Backup</button> ' +
        '<button data-action="start-fresh" style="margin-left:8px;background:transparent;color:#fff;border:1px solid #fff;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Start Fresh</button>';
      document.body.appendChild(banner);
    }, 0);
  }

  function restoreFromBackup() {
    const backupKey = userKey(STORE_KEY) + '_backup';
    const raw = localStorage.getItem(backupKey);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.tasks)) {
        localStorage.setItem(userKey(STORE_KEY), raw);
        data = migrateData(d);
        data.tasks = data.tasks.filter((t) => t && t.id && t.title);
        data.tasks.forEach(validateTaskFields);
        saveData(data);
        _dismissCorruptionBanner();
        getShowToast()('Data restored from backup');
        getRender()();
      }
    } catch (e) {
      console.error('restoreFromBackup failed:', e);
      getShowToast()('Backup is also corrupted — starting fresh', true);
      dismissCorruption();
    }
  }

  function dismissCorruption() {
    localStorage.removeItem(userKey(STORE_KEY));
    localStorage.removeItem(userKey(STORE_KEY) + '_backup');
    data = { tasks: [], projects: [] };
    saveData(data);
    _dismissCorruptionBanner();
    getShowToast()('Starting fresh');
    getRender()();
  }

  function _dismissCorruptionBanner() {
    _corruptionBannerShown = false;
    const banner = document.getElementById('corruptionBanner');
    if (banner) banner.remove();
  }

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(userKey(SETTINGS_KEY)) || '{}') };
    } catch (e) {
      console.warn('loadSettings failed:', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(userKey(SETTINGS_KEY), JSON.stringify(s));
    } catch (e) {
      console.error('saveSettings: localStorage quota exceeded', e);
    }
    const scheduleSyncToCloud = getScheduleSyncToCloud();
    if (scheduleSyncToCloud) scheduleSyncToCloud();
  }

  function _flushSave() {
    if (_saveDebounceTimer) {
      clearTimeout(_saveDebounceTimer);
      _saveDebounceTimer = null;
    }
    if (_saveDebounceData) {
      const d = _saveDebounceData;
      _saveDebounceData = null;
      d._schemaVersion = CURRENT_SCHEMA_VERSION;
      try {
        localStorage.setItem(userKey(STORE_KEY), JSON.stringify(d));
      } catch (e) {
        const freed = cleanupStorage();
        if (freed > 0) {
          try {
            localStorage.setItem(userKey(STORE_KEY), JSON.stringify(d));
          } catch (_e2) {
            getShowToast()('Storage full — export your data from Settings', true);
            return false;
          }
        } else {
          getShowToast()('Storage full — export your data from Settings', true);
          console.error('Save failed:', e);
          return false;
        }
      }
      if (!getSuppressCloudSync() && !getBatchMode()) {
        const scheduleSyncToCloud = getScheduleSyncToCloud();
        if (scheduleSyncToCloud) scheduleSyncToCloud();
      }
    }
    return true;
  }

  function saveData(d) {
    _dataVersion++;
    d._schemaVersion = CURRENT_SCHEMA_VERSION;
    // Leading edge: write immediately if no pending debounce
    if (!_saveDebounceTimer) {
      try {
        localStorage.setItem(userKey(STORE_KEY), JSON.stringify(d));
      } catch (e) {
        const freed = cleanupStorage();
        if (freed > 0) {
          try {
            localStorage.setItem(userKey(STORE_KEY), JSON.stringify(d));
          } catch (_e2) {
            getShowToast()('Storage full — export your data from Settings', true);
            return false;
          }
        } else {
          getShowToast()('Storage full — export your data from Settings', true);
          console.error('Save failed:', e);
          return false;
        }
      }
      if (!getSuppressCloudSync() && !getBatchMode()) {
        const scheduleSyncToCloud = getScheduleSyncToCloud();
        if (scheduleSyncToCloud) scheduleSyncToCloud();
      }
      // Start debounce window — subsequent calls within 300ms are deferred
      _saveDebounceData = null;
      _saveDebounceTimer = setTimeout(() => {
        _saveDebounceTimer = null;
        _flushSave();
      }, SAVE_DEBOUNCE_MS);
      return true;
    }
    // Trailing edge: store latest data, will flush when timer fires
    _saveDebounceData = d;
    return true;
  }

  // --- CRUD ---
  function createTask(o = {}) {
    const t = {
      id: genId('t'),
      title: '',
      notes: '',
      status: 'todo',
      priority: 'normal',
      horizon: 'short',
      project: '',
      dueDate: '',
      phase: '',
      recurrence: '', // 'daily', 'weekly', 'monthly', or ''
      estimatedMinutes: 0,
      tags: [],
      blockedBy: [],
      subtasks: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
      archived: false,
      updates: [],
      ...o,
    };
    if (t.title && t.title.length > 500) t.title = t.title.slice(0, 500);
    if (t.notes && t.notes.length > MAX_NOTES_LENGTH) t.notes = t.notes.slice(0, MAX_NOTES_LENGTH);
    return t;
  }

  function createProject(o = {}) {
    return {
      id: genId('p'),
      name: '',
      description: '',
      background: '',
      color: PROJECT_COLORS[data.projects.length % PROJECT_COLORS.length],
      createdAt: new Date().toISOString(),
      ...o,
    };
  }

  function addTask(t) {
    if (!getCurrentUser()) return;
    validateTaskFields(t);
    data.tasks.push(t);
    saveData(data);
  }

  function updateTask(id, u) {
    const t = findTask(id);
    if (!t) return;
    validateTaskFields(u);
    const wasNotDone = t.status !== 'done';
    Object.assign(t, u);
    if (t.title && t.title.length > 500) t.title = t.title.slice(0, 500);
    if (t.notes && t.notes.length > MAX_NOTES_LENGTH) t.notes = t.notes.slice(0, MAX_NOTES_LENGTH);
    if (u.status === 'done' && !t.completedAt) t.completedAt = new Date().toISOString();
    if (u.status && u.status !== 'done') t.completedAt = null;
    if (!getBatchMode()) saveData(data);
    // Trigger reflection on meaningful completions (not every time)
    if (wasNotDone && u.status === 'done' && !getBatchMode()) {
      const maybeReflect = getMaybeReflect();
      const maybeLearnPattern = getMaybeLearnPattern();
      if (maybeReflect) maybeReflect(t);
      if (maybeLearnPattern) maybeLearnPattern();
      // Show follow-up suggestions after task completion
      const getFollowUp = getGetFollowUpSuggestions ? getGetFollowUpSuggestions() : null;
      const showFollowUp = getShowFollowUpToast ? getShowFollowUpToast() : null;
      if (getFollowUp && showFollowUp) {
        const suggestions = getFollowUp(t);
        if (suggestions.length > 0) {
          setTimeout(() => showFollowUp(suggestions), 1500);
        }
      }
    }
    // If completing a task that's in today's plan, refresh the plan
    if (u.status === 'done') {
      const planKey = userKey('whiteboard_plan_' + todayStr());
      const cachedPlan = localStorage.getItem(planKey);
      if (cachedPlan) {
        try {
          const plan = JSON.parse(cachedPlan);
          const entry = plan.find((p) => p.id === id);
          if (entry && !entry.completedInPlan) {
            entry.completedInPlan = true;
            if (!getBatchMode()) localStorage.setItem(planKey, JSON.stringify(plan));
          }
        } catch (e) {
          console.warn('Plan cache update failed:', e);
        }
      }
    }
  }

  function deleteTask(id, silent) {
    const t = findTask(id);
    pushUndo('Delete task' + (t ? ': ' + t.title : ''));
    if (getExpandedTask && getExpandedTask() === id && setExpandedTask) setExpandedTask(null);
    data.tasks = data.tasks.filter((x) => x.id !== id);
    // Clean up orphaned blockedBy references
    data.tasks.forEach((x) => {
      if (x.blockedBy) x.blockedBy = x.blockedBy.filter((bid) => bid !== id);
    });
    saveData(data);
    if (!silent) showUndoToast('Task deleted');
  }

  function addSubtask(taskId, title) {
    const t = findTask(taskId);
    if (!t) return;
    if (!t.subtasks) t.subtasks = [];
    t.subtasks.push({ id: genId('st'), title, done: false });
    saveData(data);
    getRender()();
  }

  function toggleSubtask(taskId, subtaskId) {
    const t = findTask(taskId);
    if (!t || !t.subtasks) return;
    const s = t.subtasks.find((x) => x.id === subtaskId);
    if (s) {
      s.done = !s.done;
      saveData(data);
      getRender()();
    }
  }

  function addProject(p) {
    if (!getCurrentUser()) return;
    data.projects.push(p);
    saveData(data);
  }

  function updateProject(id, u) {
    const p = data.projects.find((x) => x.id === id);
    if (p) {
      Object.assign(p, u);
      saveData(data);
    }
  }

  function deleteProject(id) {
    const p = data.projects.find((x) => x.id === id);
    pushUndo('Delete project' + (p ? ': ' + p.name : ''));
    data.tasks = data.tasks.filter((t) => t.project !== id);
    data.projects = data.projects.filter((x) => x.id !== id);
    saveData(data);
    const pruneStaleMemories = getPruneStaleMemories();
    if (pruneStaleMemories) pruneStaleMemories();
    showUndoToast('Board deleted (tasks included)');
  }

  // --- Undo system ---
  function pushUndo(label) {
    try {
      const snapshot = JSON.stringify(data);
      undoStack.push({ label, snapshot });
      if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
      _persistUndoStack();
    } catch (e) {
      console.warn('pushUndo: failed to serialize data, skipping snapshot:', e);
    }
  }

  function undo() {
    if (!undoStack.length) return;
    const entry = undoStack.pop();
    let parsed;
    try {
      parsed = JSON.parse(entry.snapshot);
    } catch (e) {
      console.error('Undo failed — snapshot corrupted:', e);
      getShowToast()('Undo failed — snapshot corrupted', true);
      _persistUndoStack();
      return;
    }
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (!Array.isArray(parsed.projects)) parsed.projects = [];
    parsed = migrateData(parsed);
    data = parsed;
    saveData(data);
    _persistUndoStack();
    getRender()();
    getShowToast()(`Undone: ${entry.label}`, false, true);
  }

  function showUndoToast(label) {
    const { esc } = deps;
    document.querySelectorAll('.toast-undo').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast toast-undo';
    el.innerHTML = `${esc(label)} <button data-action="undo-btn" style="margin-left:12px;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Undo</button>`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 300);
    }, 5000);
  }

  // --- Fuzzy matching for dedup ---
  function findSimilarTask(title, projectId) {
    let best = null,
      bestScore = 0;
    for (const t of data.tasks) {
      if (projectId && t.project !== projectId) continue;
      const score = titleSimilarity(title, t.title);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    // Also check across all projects if no project-scoped match
    if (bestScore < 0.9 && projectId) {
      for (const t of data.tasks) {
        const score = titleSimilarity(title, t.title);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    return bestScore >= 0.9 ? best : null;
  }

  function findSimilarProject(name) {
    let best = null,
      bestScore = 0;
    for (const p of data.projects) {
      const score = titleSimilarity(name, p.name);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  // --- Render-cycle cache ---
  function _rc(key, fn) {
    if (_renderCache.version !== _dataVersion) _renderCache = { version: _dataVersion };
    if (!(key in _renderCache)) _renderCache[key] = fn();
    return _renderCache[key];
  }

  // --- Task ID lookup Map ---
  function getTaskMap() {
    if (_taskMapVersion !== _dataVersion) {
      _taskMap = new Map(data.tasks.map((t) => [t.id, t]));
      _taskMapVersion = _dataVersion;
    }
    return _taskMap;
  }

  function findTask(id) {
    return getTaskMap().get(id);
  }

  // --- Life project ---
  function ensureLifeProject() {
    if (!data.projects.find((p) => p.name === LIFE_PROJECT_NAME)) {
      data.projects.unshift(
        createProject({
          name: LIFE_PROJECT_NAME,
          description: 'Everyday tasks, errands, personal stuff — anything not tied to a specific board.',
          color: '#4ade80',
        }),
      );
      saveData(data);
    }
  }

  function getLifeProjectId() {
    const life = data.projects.find((p) => p.name === LIFE_PROJECT_NAME);
    return life ? life.id : '';
  }

  // --- Query helpers ---
  function applyTagFilter(tasks) {
    const activeTagFilterVal = getActiveTagFilter();
    const nudgeFilterVal = getNudgeFilter();
    let filtered = activeTagFilterVal ? tasks.filter((t) => (t.tags || []).includes(activeTagFilterVal)) : tasks;
    if (nudgeFilterVal === 'overdue')
      filtered = filtered.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < todayStr());
    else if (nudgeFilterVal === 'stale')
      filtered = filtered.filter((t) => {
        if (t.status === 'done') return false;
        const lt = t.updates?.length ? t.updates[t.updates.length - 1].date : t.createdAt;
        return lt && Date.now() - new Date(lt).getTime() > STALE_TASK_DAYS * MS_PER_DAY;
      });
    else if (nudgeFilterVal === 'unassigned') filtered = filtered.filter((t) => !t.project && t.status !== 'done');
    return filtered;
  }

  function projectTasks(pid) {
    return applyTagFilter(data.tasks.filter((t) => t.project === pid && !t.archived));
  }
  function activeTasks(pid) {
    const key = 'active_' + (pid || '');
    return _rc(key, () =>
      applyTagFilter(
        (pid ? data.tasks.filter((t) => t.project === pid) : data.tasks).filter(
          (t) => t.status !== 'done' && !t.archived,
        ),
      ),
    );
  }
  function doneTasks(pid) {
    const key = 'done_' + (pid || '');
    return _rc(key, () =>
      applyTagFilter(
        (pid ? data.tasks.filter((t) => t.project === pid) : data.tasks).filter(
          (t) => t.status === 'done' && !t.archived,
        ),
      ),
    );
  }
  function urgentTasks() {
    return _rc('urgent', () =>
      data.tasks.filter(
        (t) =>
          t.status !== 'done' && !t.archived && (t.priority === 'urgent' || (t.dueDate && t.dueDate <= todayStr())),
      ),
    );
  }
  function archivedTasks() {
    return data.tasks.filter((t) => t.archived);
  }

  function autoEscalatePriority() {
    const tomorrow = new Date(Date.now() + 2 * MS_PER_DAY).toISOString().slice(0, 10);
    let changed = false;
    data.tasks.forEach((t) => {
      if (t.status !== 'done' && !t.archived && t.dueDate && t.dueDate <= tomorrow && t.priority !== 'urgent') {
        t.priority = 'urgent';
        changed = true;
      }
    });
    if (changed && !getBatchMode()) saveData(data);
  }

  function cleanupArchive() {
    const cutoff = Date.now() - ARCHIVE_CLEANUP_DAYS * MS_PER_DAY; // 30 days
    let count = 0;
    data.tasks.forEach(function (t) {
      if (t.status === 'done' && t.completedAt && !t.archived && new Date(t.completedAt).getTime() < cutoff) {
        t.archived = true;
        count++;
      }
    });
    if (count) {
      saveData(data);
      getShowToast()(count + ' old task' + (count > 1 ? 's' : '') + ' auto-archived');
    }
  }

  function unarchiveTask(id) {
    const t = findTask(id);
    if (t) {
      t.archived = false;
      saveData(data);
      getRender()();
      getShowToast()('Task restored');
    }
  }

  async function deleteArchivedPermanently() {
    const { confirmAction } = deps;
    const ok = await confirmAction('Permanently delete all archived tasks?');
    if (!ok) return;
    data.tasks = data.tasks.filter(function (t) {
      return !t.archived;
    });
    saveData(data);
    getRender()();
    getShowToast()('Archived tasks deleted');
  }

  // --- State accessors ---
  function getData() {
    return data;
  }
  function setData(d) {
    data = d;
    _dataVersion++; // Invalidate render memoization caches
  }
  function getSettings() {
    return settings;
  }
  function setSettings(s) {
    settings = s;
  }
  function getDataVersion() {
    return _dataVersion;
  }
  function setDataVersion(v) {
    _dataVersion = v;
  }
  function getRenderCache() {
    return _renderCache;
  }
  function setRenderCache(v) {
    _renderCache = v;
  }
  function getTaskMapState() {
    return { version: _taskMapVersion, map: _taskMap };
  }
  function setTaskMapState(ver, map) {
    _taskMapVersion = ver;
    _taskMap = map;
  }
  function getUndoStack() {
    return undoStack;
  }
  function clearUndoStack() {
    undoStack.length = 0;
    try {
      localStorage.removeItem(_undoStorageKey());
    } catch (_e) {
      /* ignore */
    }
  }

  // --- Storage monitoring & cleanup ---
  function getStorageUsage() {
    const prefix = userKey('');
    let totalBytes = 0;
    let totalKeys = 0;
    const breakdown = { data: 0, backup: 0, undo: 0, chat: 0, settings: 0, other: 0 };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const val = localStorage.getItem(key) || '';
      const bytes = (key.length + val.length) * 2;
      totalBytes += bytes;
      totalKeys++;
      if (key.includes('_undo')) breakdown.undo += bytes;
      else if (key.includes('_backup')) breakdown.backup += bytes;
      else if (key.includes('chat')) breakdown.chat += bytes;
      else if (key.includes('settings')) breakdown.settings += bytes;
      else if (key.includes(STORE_KEY) && !key.includes('_backup')) breakdown.data += bytes;
      else breakdown.other += bytes;
    }
    return { usedBytes: totalBytes, totalKeys, breakdown };
  }

  function cleanupStorage() {
    let freed = 0;
    const prefix = userKey('');
    // Remove backup older than 24h
    const backupKey = userKey(STORE_KEY) + '_backup';
    const backup = localStorage.getItem(backupKey);
    if (backup) {
      freed += (backupKey.length + backup.length) * 2;
      localStorage.removeItem(backupKey);
    }
    // Trim chat history to 50 messages
    const chatKey = userKey('wb_chat_history');
    const chatRaw = localStorage.getItem(chatKey);
    if (chatRaw) {
      try {
        const msgs = JSON.parse(chatRaw);
        if (Array.isArray(msgs) && msgs.length > 50) {
          const trimmed = msgs.slice(-50);
          const oldSize = chatRaw.length * 2;
          const newVal = JSON.stringify(trimmed);
          localStorage.setItem(chatKey, newVal);
          freed += oldSize - newVal.length * 2;
        }
      } catch (_e) {
        /* skip */
      }
    }
    // Remove stale proactive/dismissal keys older than 30 days
    const cutoff = Date.now() - 30 * MS_PER_DAY;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      if (key.includes('_dismissed_') || key.includes('_checkin_') || key.includes('_eod_dismissed_')) {
        // These keys contain date strings — try to parse
        const dateMatch = key.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          const keyDate = new Date(dateMatch[0]).getTime();
          if (!isNaN(keyDate) && keyDate < cutoff) {
            const val = localStorage.getItem(key) || '';
            freed += (key.length + val.length) * 2;
            localStorage.removeItem(key);
          }
        }
      }
    }
    return freed;
  }

  // Initialize
  data = loadData();
  settings = loadSettings();

  return {
    // Load/Save
    loadData,
    saveData,
    _flushSave,
    loadSettings,
    saveSettings,
    // Validation
    validateTaskFields,
    // CRUD
    createTask,
    createProject,
    addTask,
    updateTask,
    deleteTask,
    addProject,
    updateProject,
    deleteProject,
    addSubtask,
    toggleSubtask,
    // Undo
    pushUndo,
    undo,
    showUndoToast,
    // Fuzzy matching
    findSimilarTask,
    findSimilarProject,
    // Lookup
    findTask,
    getTaskMap,
    // Life project
    ensureLifeProject,
    getLifeProjectId,
    // Query helpers
    activeTasks,
    doneTasks,
    urgentTasks,
    archivedTasks,
    projectTasks,
    applyTagFilter,
    cleanupArchive,
    autoEscalatePriority,
    unarchiveTask,
    deleteArchivedPermanently,
    // Render cache
    _rc,
    // State accessors
    getData,
    setData,
    getSettings,
    setSettings,
    getDataVersion,
    setDataVersion,
    getRenderCache,
    setRenderCache,
    getTaskMapState,
    setTaskMapState,
    getUndoStack,
    clearUndoStack,
    // Corruption recovery
    restoreFromBackup,
    dismissCorruption,
    // Storage monitoring
    getStorageUsage,
    cleanupStorage,
  };
}
