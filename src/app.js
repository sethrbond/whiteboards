// Suppress console noise in production
const _debug = location.hostname === 'localhost';
if (!_debug) {
  console.log = () => {};
}

// Global error handling — instantiated before all other modules
import { createErrorHandler } from './error-handler.js';
const _errorHandler = createErrorHandler({
  onError: (event) => {
    if (typeof showToast === 'function') {
      const reason = event.reason;
      const msg = reason?.message || event.message || '';
      const userMsg =
        msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')
          ? 'Network error — check your connection.'
          : 'An unexpected error occurred. Your data is safe.';
      showToast(userMsg, true);
    }
  },
});
_errorHandler.init();

// ============================================================
// IMPORTS
// ============================================================
import { createClient } from '@supabase/supabase-js';
import {
  STORE_KEY,
  SETTINGS_KEY,
  CHAT_HISTORY_KEY,
  PROJECT_COLORS,
  DEFAULT_SETTINGS,
  PRIORITY_ORDER,
  TAG_COLORS,
} from './constants.js';
import {
  esc,
  sanitizeAIHTML,
  normalizeTitle,
  titleSimilarity,
  highlightMatch,
  genId,
  chunkText,
  fmtEstimate,
} from './utils.js';
import { todayStr, localISO, fmtDate, relativeTime, parseNaturalDate } from './dates.js';
import { createAICaller } from './ai.js';
import { createAIContext, AI_PERSONA, AI_PERSONA_SHORT, AI_ACTIONS_SPEC } from './ai-context.js';
import { enforceShortDesc, isComplexInput, parseQuickInput as _parseQuickInput } from './parsers.js';
import { migrateData } from './migrations.js';
import { createCalendar } from './calendar.js';
import { createChat } from './chat.js';
import { createAuth } from './auth.js';
import { createSettings } from './settings.js';
import { createTemplates } from './templates.js';
import { createNotifications } from './notifications.js';
import { createSync } from './sync.js';
import { createProactive } from './proactive.js';
import { createEscalation } from './escalation.js';
import { createTaskEditor } from './task-editor.js';
import { createQuickAdd } from './quick-add.js';
import { createDashboard } from './dashboard.js';
import { createEvents } from './events.js';
import { createDataLayer } from './data.js';
import { createUIHelpers } from './ui-helpers.js';
import { createActions } from './actions.js';
import { exposeWindowAPI } from './window-api.js';
import {
  setupTooltips,
  wrapWithThrottle,
  setupModalObserver,
  setupPopstateHandler,
  setupOfflineBanner,
  setupPullToRefresh,
} from './init.js';

// ============================================================
// SUPABASE
// ============================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
let sb = null;
try {
  if (SUPABASE_URL && SUPABASE_ANON) sb = createClient(SUPABASE_URL, SUPABASE_ANON);
} catch (e) {
  console.error('Supabase init failed:', e);
}
let currentUser = null;
function userKey(key) {
  return currentUser ? 'wb_' + currentUser.id + '_' + key : key;
}

// ============================================================
// MUTABLE STATE
// ============================================================
let _suppressCloudSync = false;
let _batchMode = false;
let activeTagFilter = '';
let _nudgeFilter = '';
let expandedTask = null;
let currentView = 'dashboard';
let currentProject = null;
let _briefingGenerating = false;
let _planGenerating = false;
let _proactiveRunning = false;
let proactiveLog = [];
let _showTagFilter = false;
let sidebarCollapsed = localStorage.getItem(userKey('wb_sidebar_collapsed')) === 'true';
let guestMode = false;
let bulkMode = false;
let bulkSelected = new Set();
const showCompleted = {};
const projectViewMode = {};
const showProjectBg = {};
let dashViewMode = 'list';
const TASKS_PER_PAGE = 50;
const _sectionShowCount = {};
let _archiveShowCount = 50;
let _todayBriefingExpanded = false;
// eslint-disable-next-line prefer-const
let _renderNow;
let kbIdx = -1;
window._welcomeTypingInterval = null;

// Track mouse drag to distinguish clicks from text selection
let _mouseDidDrag = false;
document.addEventListener('mousedown', () => {
  _mouseDidDrag = false;
});
document.addEventListener('mousemove', () => {
  _mouseDidDrag = true;
});

// Task expand click handler — registered early, top-level, no delegation conflicts
document.addEventListener(
  'click',
  (e) => {
    // Skip if user is selecting text, clicking interactive elements, or inside inputs
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    if (_mouseDidDrag) return; // user was dragging/selecting, not clicking
    if (
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('textarea') ||
      e.target.closest('a') ||
      e.target.closest('[data-bulk]') ||
      e.target.closest('[data-toggle]') ||
      e.target.closest('[data-action]')
    )
      return;
    const row = e.target.closest('[data-expandable]');
    if (!row) return;
    const id = row.closest('[data-task]')?.dataset?.task || row.dataset?.task;
    if (!id) return;
    e.stopPropagation(); // prevent bubble-phase handlers from double-toggling
    expandedTask = expandedTask === id ? null : id;
    if (typeof _renderNow === 'function') _renderNow();
  },
  true,
); // capture phase — fires BEFORE other handlers

// ============================================================
// DATA LAYER
// ============================================================
const _dataLayer = createDataLayer({
  userKey,
  esc,
  getCurrentUser: () => currentUser,
  getScheduleSyncToCloud: () => scheduleSyncToCloud,
  getShowToast: () => showToast,
  getRender: () => render,
  getMaybeReflect: () => maybeReflect,
  getMaybeLearnPattern: () => maybeLearnPattern,
  getSuppressCloudSync: () => _suppressCloudSync,
  getBatchMode: () => _batchMode,
  getActiveTagFilter: () => activeTagFilter,
  getNudgeFilter: () => _nudgeFilter,
  getPruneStaleMemories: () => pruneStaleMemories,
  getExpandedTask: () => expandedTask,
  setExpandedTask: (v) => {
    expandedTask = v;
  },
  getGetFollowUpSuggestions: () => (typeof getFollowUpSuggestions === 'function' ? getFollowUpSuggestions : null),
  getShowFollowUpToast: () => showFollowUpToast,
  confirmAction: (...args) => confirmAction(...args),
});
const loadData = _dataLayer.loadData;
const saveData = (d) => {
  _dataLayer.saveData(d);
  if (typeof scheduleNotifications === 'function') scheduleNotifications();
};
const loadSettings = _dataLayer.loadSettings;
const saveSettings = (s) => _dataLayer.saveSettings(s);
const validateTaskFields = _dataLayer.validateTaskFields;
const createTask = (o) => _dataLayer.createTask(o);
const createProject = (o) => _dataLayer.createProject(o);
const addTask = (t) => {
  _dataLayer.addTask(t);
  // Show inline tip after first task creation (once ever)
  const _d = _dataLayer.getData ? _dataLayer.getData() : null;
  if (_d && _d.tasks.length === 1 && !localStorage.getItem(userKey('wb_first_task_tip_shown'))) {
    localStorage.setItem(userKey('wb_first_task_tip_shown'), '1');
    setTimeout(() => {
      if (typeof showToast === 'function') {
        const _isMac = typeof navigator !== 'undefined' && navigator.platform && navigator.platform.includes('Mac');
        const _mod = _isMac ? 'Cmd' : 'Ctrl';
        showToast('Nice! Press ' + _mod + '+J anytime to chat with your AI assistant');
      }
    }, 600);
  }
};
const updateTask = (id, u) => _dataLayer.updateTask(id, u);
const deleteTask = (id, silent) => _dataLayer.deleteTask(id, silent);
const addProject = (p) => _dataLayer.addProject(p);
const updateProject = (id, u) => _dataLayer.updateProject(id, u);
const deleteProject = (id) => _dataLayer.deleteProject(id);
const addSubtask = (taskId, title, parentId) => _dataLayer.addSubtask(taskId, title, parentId);
const deleteSubtask = (taskId, subtaskId) => _dataLayer.deleteSubtask(taskId, subtaskId);
const renameSubtask = (taskId, subtaskId, title) => _dataLayer.renameSubtask(taskId, subtaskId, title);
const updateSubtaskNotes = (taskId, subtaskId, notes) => _dataLayer.updateSubtaskNotes(taskId, subtaskId, notes);
const toggleSubtask = (taskId, subtaskId) => _dataLayer.toggleSubtask(taskId, subtaskId);
const pushUndo = (label) => _dataLayer.pushUndo(label);
const undo = () => _dataLayer.undo();
const redo = () => _dataLayer.redo();
const showUndoToast = (label) => _dataLayer.showUndoToast(label);
const findSimilarTask = (title, projectId) => _dataLayer.findSimilarTask(title, projectId);
const findSimilarProject = (name) => _dataLayer.findSimilarProject(name);
const findTask = (id) => _dataLayer.findTask(id);
const ensureLifeProject = () => _dataLayer.ensureLifeProject();
const getLifeProjectId = () => _dataLayer.getLifeProjectId();
const activeTasks = (pid) => _dataLayer.activeTasks(pid);
const doneTasks = (pid) => _dataLayer.doneTasks(pid);
const urgentTasks = () => _dataLayer.urgentTasks();
const archivedTasks = () => _dataLayer.archivedTasks();
const projectTasks = (pid) => _dataLayer.projectTasks(pid);
const cleanupArchive = () => _dataLayer.cleanupArchive();
const autoEscalatePriority = () => _dataLayer.autoEscalatePriority();
const unarchiveTask = (id) => _dataLayer.unarchiveTask(id);
const deleteArchivedPermanently = () => _dataLayer.deleteArchivedPermanently();
const restoreFromBackup = () => _dataLayer.restoreFromBackup();
const dismissCorruption = () => _dataLayer.dismissCorruption();
let data = _dataLayer.getData();
let settings = _dataLayer.getSettings();

// ============================================================
// SYNC
// ============================================================
const _sync = createSync({
  sb,
  getCurrentUser: () => currentUser,
  userKey,
  STORE_KEY,
  SETTINGS_KEY,
  getData: () => _dataLayer.getData(),
  getSettings: () => _dataLayer.getSettings(),
  saveData: (d) => saveData(d),
  showToast: (msg, isError) => showToast(msg, isError),
  render: () => render(),
  migrateData,
  validateTaskFields,
  getAIMemory: () => getAIMemory(),
  getAIMemoryArchive: () => getAIMemoryArchive(),
  saveAIMemory: (v) => saveAIMemory(v),
  saveAIMemoryArchive: (v) => saveAIMemoryArchive(v),
  setSuppressCloudSync: (v) => {
    _suppressCloudSync = v;
  },
});
const loadFromCloud = _sync.loadFromCloud;
const scheduleSyncToCloud = _sync.scheduleSyncToCloud;
const syncToCloud = _sync.syncToCloud;
let updateSyncDot = _sync.updateSyncDot;
_sync.setupSyncListeners();

// ============================================================
// UI HELPERS
// ============================================================
const _uiHelpers = createUIHelpers({
  $: (s) => document.querySelector(s),
  esc,
  userKey,
  findTask: (id) => findTask(id),
  getData: () => data,
  getRender: () => render,
  getActiveTagFilter: () => activeTagFilter,
  setActiveTagFilter: (v) => {
    activeTagFilter = v;
  },
  getBulkMode: () => bulkMode,
  setBulkMode: (v) => {
    bulkMode = v;
  },
  getBulkSelected: () => bulkSelected,
  getSidebarCollapsed: () => sidebarCollapsed,
  setSidebarCollapsed: (v) => {
    sidebarCollapsed = v;
  },
});
const showToast = _uiHelpers.showToast;
const renderSubtaskProgress = _uiHelpers.renderSubtaskProgress;
const getTagColor = _uiHelpers.getTagColor;
const getAllTags = _uiHelpers.getAllTags;
const renderTagChips = _uiHelpers.renderTagChips;
const filterByTag = _uiHelpers.filterByTag;
const renderTagPicker = _uiHelpers.renderTagPicker;
const addTagToPicker = _uiHelpers.addTagToPicker;
const toggleBulkMode = _uiHelpers.toggleBulkMode;
const renderBulkBar = _uiHelpers.renderBulkBar;
const attachBulkListeners = _uiHelpers.attachBulkListeners;
const smartDateInput = _uiHelpers.smartDateInput;
const previewSmartDate = _uiHelpers.previewSmartDate;
const resolveSmartDate = _uiHelpers.resolveSmartDate;
const isBlocked = _uiHelpers.isBlocked;
const renderBlockedBy = _uiHelpers.renderBlockedBy;
const renderBlocking = _uiHelpers.renderBlocking;
const parseProjectBackground = _uiHelpers.parseProjectBackground;
const requestNotificationPermission = _uiHelpers.requestNotificationPermission;
const notifyOverdueTasks = _uiHelpers.notifyOverdueTasks;
const toggleSidebar = _uiHelpers.toggleSidebar;
const throttleAI = _uiHelpers.throttleAI;

// ============================================================
// RENDER ENGINE
// ============================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function setView(view, projectId = null) {
  currentView = view;
  currentProject = projectId;
  try {
    localStorage.setItem(userKey('wb_current_view'), view);
    if (projectId) localStorage.setItem(userKey('wb_current_project'), projectId);
    else localStorage.removeItem(userKey('wb_current_project'));
  } catch (_) {}
  expandedTask = null;
  _chat.setChatContext(null);
  closeMobileSidebar();
  render();
  const viewNames = {
    dashboard: 'Dashboard',
    dump: 'Brainstorm',
    review: 'Weekly Review',
    project: 'Board',
    archive: 'Archive',
    focus: 'Focus Mode',
  };
  const ariaEl = document.getElementById('ariaLive');
  if (ariaEl) ariaEl.textContent = (viewNames[view] || view) + ' view';
}
let _renderRAF = null;
function render() {
  if (_renderRAF) return;
  _renderRAF = requestAnimationFrame(() => {
    _renderRAF = null;
    if (typeof _renderNow === 'function') _renderNow();
    if (typeof _maybeEscalationOnRender === 'function') _maybeEscalationOnRender();
    // Trigger feature tips after first brainstorm (deferred from onboarding)
    if (localStorage.getItem(userKey('wb_show_tips_after_brainstorm')) === '1') {
      localStorage.removeItem(userKey('wb_show_tips_after_brainstorm'));
      setTimeout(() => {
        if (_auth && _auth.showOnboardingExperience) _auth.showOnboardingExperience();
      }, 800);
    }
    // Also show feature tips on first dashboard view if user has tasks but hasn't seen tips
    if (currentView === 'dashboard' && data.tasks.length > 0 && !localStorage.getItem(userKey('wb_tips_seen'))) {
      setTimeout(() => {
        if (_auth && _auth.showOnboardingExperience) _auth.showOnboardingExperience();
      }, 1200);
    }
  });
}

// ============================================================
// EVENTS MODULE
// ============================================================
const _events = createEvents({
  $,
  esc,
  findTask,
  updateTask,
  deleteProject,
  setView,
  render,
  showToast: (...args) => showToast(...args),
  filterByTag,
  attachInlineEdit: () => attachInlineEdit(),
  attachBulkListeners,
  saveAIMemory: (v) => saveAIMemory(v),
  saveAIMemoryArchive: (v) => saveAIMemoryArchive(v),
  syncToCloud,
  loadData,
  ensureLifeProject,
  saveData: (d) => saveData(d),
  openSettings: () => openSettings(),
  STORE_KEY,
  userKey,
  getExpandedTask: () => expandedTask,
  setExpandedTask: (v) => {
    expandedTask = v;
  },
  getGetFollowUpSuggestions: () => (typeof getFollowUpSuggestions === 'function' ? getFollowUpSuggestions : null),
  getShowFollowUpToast: () => showFollowUpToast,
  getKbIdx: () => kbIdx,
  getData: () => data,
  setData: (d) => {
    data = d;
    _dataLayer.setData(d);
  },
});
const trapFocus = _events.trapFocus;
const pushModalState = _events.pushModalState;
const closeModal = _events.closeModal;
const setModalLabel = _events.setModalLabel;
const openMobileSidebar = _events.openMobileSidebar;
const closeMobileSidebar = _events.closeMobileSidebar;
const confirmAction = _events.confirmAction;
const confirmDeleteProject = _events.confirmDeleteProject;
const confirmClearMemories = _events.confirmClearMemories;
const confirmResetData = _events.confirmResetData;
const highlightKbRow = _events.highlightKbRow;
const attachListeners = _events.attachListeners;

// ============================================================
// TASK ATTACHMENTS
// ============================================================
async function uploadTaskAttachment(taskId, file) {
  if (!sb || !currentUser) {
    showToast('Sign in to attach files', true);
    return;
  }
  const t = findTask(taskId);
  if (!t) return;
  const path = `${currentUser.id}/${taskId}/${file.name}`;
  const { error } = await sb.storage.from('task-attachments').upload(path, file, { upsert: true });
  if (error) {
    showToast('Upload failed: ' + error.message, true);
    return;
  }
  const { data: urlData } = sb.storage.from('task-attachments').getPublicUrl(path);
  const attachments = [...(t.attachments || []), { name: file.name, url: urlData.publicUrl, size: file.size, type: file.type }];
  updateTask(taskId, { attachments });
  render();
  showToast('File attached', false, true);
}

async function removeTaskAttachment(taskId, idx) {
  if (!sb || !currentUser) return;
  const t = findTask(taskId);
  if (!t || !t.attachments || !t.attachments[idx]) return;
  const a = t.attachments[idx];
  const path = `${currentUser.id}/${taskId}/${a.name}`;
  await sb.storage.from('task-attachments').remove([path]);
  const attachments = t.attachments.filter((_, i) => i !== idx);
  updateTask(taskId, { attachments });
  render();
  showToast('Attachment removed', false, true);
}

// ============================================================
// TASK EDITOR
// ============================================================
const _taskEditor = createTaskEditor({
  $,
  esc,
  todayStr,
  fmtDate,
  fmtEstimate,
  relativeTime,
  genId,
  getData: () => data,
  findTask,
  updateTask,
  deleteTask,
  addTask,
  createTask,
  saveData: (d) => saveData(d),
  render: () => render(),
  showToast,
  setModalLabel,
  pushModalState,
  closeModal,
  trapFocus,
  getTrapFocusCleanup: () => _events.getTrapFocusCleanup(),
  setTrapFocusCleanup: (fn) => {
    _events.setTrapFocusCleanup(fn);
  },
  setModalTriggerEl: (el) => {
    _events.setModalTriggerEl(el);
  },
  getExpandedTask: () => expandedTask,
  setExpandedTask: (v) => {
    expandedTask = v;
  },
  getGetFollowUpSuggestions: () => (typeof getFollowUpSuggestions === 'function' ? getFollowUpSuggestions : null),
  getShowFollowUpToast: () => showFollowUpToast,
  getBulkMode: () => bulkMode,
  getBulkSelected: () => bulkSelected,
  getProactiveLog: () => proactiveLog,
  isBlocked,
  renderSubtaskProgress,
  renderBlockedBy,
  renderBlocking,
  renderTagChips,
  renderTagPicker,
  smartDateInput,
  resolveSmartDate,
  hasAI: () => hasAI(),
  callAI: (...args) => callAI(...args),
  AI_PERSONA_SHORT,
  matchTask: (...args) => matchTask(...args),
  maybeProactiveEnhance: (...args) => maybeProactiveEnhance(...args),
  getSmartDefaults: (...args) => getSmartDefaults(...args),
  predictCompletion: (...args) => predictCompletion(...args),
  saveAsTemplate,
  uploadTaskAttachment: (...args) => uploadTaskAttachment(...args),
  removeTaskAttachment: (...args) => removeTaskAttachment(...args),
});
const renderTaskRow = _taskEditor.renderTaskRow;
const renderTaskExpanded = _taskEditor.renderTaskExpanded;
const renderPriorityTag = _taskEditor.renderPriorityTag;
const attachInlineEdit = _taskEditor.attachInlineEdit;
const openNewTask = _taskEditor.openNewTask;
const saveNewTask = _taskEditor.saveNewTask;
const openEditTask = _taskEditor.openEditTask;
const saveEditTask = _taskEditor.saveEditTask;
const autoClassifyTask = _taskEditor.autoClassifyTask;
const runTaskCmd = _taskEditor.runTaskCmd;
const removeDep = _taskEditor.removeDep;
const showDepResults = _taskEditor.showDepResults;
const guardedCloseEditModal = _taskEditor.guardedCloseEditModal;

// ============================================================
// CALENDAR VIEW
// ============================================================
const _cal = createCalendar({
  localISO,
  esc,
  sortTasks: (...args) => sortTasks(...args),
  PRIORITY_ORDER,
  render: () => render(),
  fmtDate,
  findTask,
  getData: () => data,
  getDashViewMode: () => dashViewMode,
  getExpandedTask: () => expandedTask,
  renderTaskExpanded: (t, sp) => renderTaskExpanded(t, sp),
  renderTaskRow: (t, sp) => renderTaskRow(t, sp),
});
const { renderCalendar, calNav, calToday } = _cal;

// ============================================================
// AI
// ============================================================
const _ai = createAICaller({
  proxyUrl: SUPABASE_URL + '/functions/v1/ai-proxy',
  proxyKey: SUPABASE_ANON,
  getSettings: () => settings,
});
const callAI = _ai.callAI;
const getAIEndpoint = _ai.getAIEndpoint;
const hasAI = _ai.hasAI;

const _aiCtx = createAIContext({
  userKey,
  scheduleSyncToCloud,
  getData: () => data,
  getChatHistory: () => _chat.getChatHistory(),
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
  saveData: (d) => saveData(d),
  pushUndo,
  confirmAIAction: (...args) => confirmAIAction(...args),
  enforceShortDesc,
});
const getAIMemory = _aiCtx.getAIMemory;
const getAIMemoryArchive = _aiCtx.getAIMemoryArchive;
const saveAIMemory = _aiCtx.saveAIMemory;
const saveAIMemoryArchive = _aiCtx.saveAIMemoryArchive;
const archiveMemory = _aiCtx.archiveMemory;
const restoreMemory = _aiCtx.restoreMemory;
const addAIMemory = _aiCtx.addAIMemory;
const pruneStaleMemories = _aiCtx.pruneStaleMemories;
const incrementAIInteraction = _aiCtx.incrementAIInteraction;
const maybeLearnPattern = _aiCtx.maybeLearnPattern;
const buildAIContext = _aiCtx.buildAIContext;
const matchTask = _aiCtx.matchTask;
const matchProject = _aiCtx.matchProject;
const executeAIActions = _aiCtx.executeAIActions;

// ============================================================
// CHAT
// ============================================================
const _chat = createChat({
  esc,
  todayStr,
  getData: () => data,
  hasAI,
  getAIEndpoint,
  buildAIContext,
  AI_PERSONA,
  AI_ACTIONS_SPEC,
  executeAIActions,
  incrementAIInteraction,
  render,
  callAI,
  findTask,
  userKey,
  CHAT_HISTORY_KEY,
  getSettings: () => settings,
  getStuckTasks: () => (typeof getStuckTasks === 'function' ? getStuckTasks() : []),
});
const toggleChat = _chat.toggleChat;
const sendChat = _chat.sendChat;
const sendChatChip = _chat.sendChatChip;
const updateChatChips = _chat.updateChatChips;
const openProjectChat = _chat.openProjectChat;
const chatTimeStr = _chat.chatTimeStr;
const saveChatHistory = _chat.saveChatHistory;
const offerStuckHelp = _chat.offerStuckHelp;
const openTaskWork = _chat.openTaskWork;
const maybeProactiveChat = _chat.maybeProactiveChat;

// ============================================================
// BRAINSTORM (lazy-loaded)
// ============================================================
let _brainstormMod = null;
async function _loadBrainstorm() {
  try {
    if (!_brainstormMod) {
      const { createBrainstorm } = await import('./brainstorm.js');
      _brainstormMod = createBrainstorm({
        userKey,
        render,
        showToast,
        hasAI,
        callAI,
        getAIEndpoint,
        getData: () => data,
        getSettings: () => settings,
        findTask,
        findSimilarTask,
        findSimilarProject,
        createTask,
        addTask,
        updateTask,
        createProject,
        addProject,
        updateProject,
        getLifeProjectId,
        pushUndo,
        undo,
        closeModal,
        genId,
        normalizeTitle,
        $,
        setBatchMode: (v) => {
          _batchMode = v;
        },
        saveData: (d) => _dataLayer.saveData(d),
        syncToCloud,
        openChatWithBrainstormContext: _chat.openChatWithBrainstormContext,
      });
    }
    return _brainstormMod;
  } catch (err) {
    console.error('Failed to load Brainstorm module:', err);
    showToast('Failed to load Brainstorm. Please reload the page.', 'error');
    throw err;
  }
}
async function renderDump() {
  return (await _loadBrainstorm()).renderDump();
}
async function initDumpDropZone() {
  return (await _loadBrainstorm()).initDumpDropZone();
}
async function processDump(...args) {
  return (await _loadBrainstorm()).processDump(...args);
}
async function processDumpManual(...args) {
  return (await _loadBrainstorm()).processDumpManual(...args);
}
function isDumpInProgress() {
  return _brainstormMod ? _brainstormMod.isDumpInProgress() : false;
}
async function cancelDump() {
  return (await _loadBrainstorm()).cancelDump();
}
async function applyDumpResults() {
  return (await _loadBrainstorm()).applyDumpResults();
}
async function submitClarify() {
  return (await _loadBrainstorm()).submitClarify();
}
async function skipClarify() {
  return (await _loadBrainstorm()).skipClarify();
}
async function handleDumpFiles(...args) {
  return (await _loadBrainstorm()).handleDumpFiles(...args);
}

// ============================================================
// TEMPLATES
// ============================================================
const _templates = createTemplates({
  userKey,
  genId,
  showToast: (...args) => showToast(...args),
});
const getTemplates = _templates.getTemplates;
const addTemplate = _templates.addTemplate;
const deleteTemplate = _templates.deleteTemplate;
const updateTemplate = _templates.updateTemplate;
const getAllTemplates = _templates.getAllTemplates;
const applyTemplate = _templates.applyTemplate;

function saveAsTemplate(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  const tmpl = {
    name: t.title,
    priority: t.priority || 'normal',
    project: t.project || '',
    subtasks: (t.subtasks || []).map((s) => (typeof s === 'string' ? s : s.title || '')),
    estimatedMinutes: t.estimatedMinutes || 0,
    tags: t.tags || [],
  };
  addTemplate(tmpl);
}

// ============================================================
// SETTINGS
// ============================================================
const _settingsMod = createSettings({
  $,
  esc,
  todayStr,
  getData: () => data,
  getSettings: () => settings,
  setModalLabel,
  pushModalState,
  closeModal,
  trapFocus,
  getTrapFocusCleanup: () => _events.getTrapFocusCleanup(),
  setTrapFocusCleanup: (v) => {
    _events.setTrapFocusCleanup(v);
  },
  _getModalTriggerEl: () => _events.getModalTriggerEl(),
  setModalTriggerEl: (el) => {
    _events.setModalTriggerEl(el);
  },
  createProject,
  addProject,
  updateProject,
  setView,
  render,
  saveData: (d, replace) => {
    if (replace) {
      data = d;
      if (!data.projects) data.projects = [];
      _dataLayer.setData(data);
    }
    saveData(data);
  },
  pushUndo,
  ensureLifeProject,
  showToast: (...args) => showToast(...args),
  getAIMemory,
  saveAIMemory,
  getAIMemoryArchive,
  PROJECT_COLORS,
  _getShowProjectBg: (id) => showProjectBg[id],
  setShowProjectBg: (id, v) => {
    showProjectBg[id] = v;
  },
  renderNotificationSettings: () => _notifications.renderNotificationSettings(),
  getTemplates,
  deleteTemplate,
  updateTemplate,
  getStorageUsage: () => _dataLayer.getStorageUsage(),
  cleanupStorage: () => _dataLayer.cleanupStorage(),
  userKey,
});
const openSettings = _settingsMod.openSettings;
const syncCalendar = _settingsMod.syncCalendar;
const deleteAIMemory = _settingsMod.deleteAIMemory;
const exportData = _settingsMod.exportData;
const importData = _settingsMod.importData;
const editProjectBackground = _settingsMod.editProjectBackground;
const saveProjectBackground = _settingsMod.saveProjectBackground;
const openNewProject = _settingsMod.openNewProject;
const saveNewProject = _settingsMod.saveNewProject;
const openEditProject = _settingsMod.openEditProject;
const saveEditProject = _settingsMod.saveEditProject;
const openEditTemplate = _settingsMod.openEditTemplate;
const saveEditTemplate = _settingsMod.saveEditTemplate;

// ============================================================
// NOTIFICATIONS
// ============================================================
const _notifications = createNotifications({
  getData: () => data,
  userKey,
  showToast: (...args) => showToast(...args),
  findTask,
});
_notifications.init();
const scheduleNotifications = () => _notifications.scheduleNotifications();
const clearNotifications = () => _notifications.clearScheduled();

// ============================================================
// WEEKLY REVIEW (lazy-loaded)
// ============================================================
let _weeklyReviewMod = null;
async function _loadWeeklyReview() {
  try {
    if (!_weeklyReviewMod) {
      const { createWeeklyReview } = await import('./weekly-review.js');
      _weeklyReviewMod = createWeeklyReview({
        getData: () => data,
        userKey,
        activeTasks,
        projectTasks,
        hasAI,
        callAI,
        getAIMemory,
        sanitizeAIHTML,
        esc,
        localISO,
        todayStr,
        showToast,
        getChatHistory: () => _chat.getChatHistory(),
        saveChatHistory,
        chatTimeStr,
        getChatSessionStarted: () => _chat.getChatSessionStarted(),
        setChatSessionStarted: (v) => {
          _chat.setChatSessionStarted(v);
        },
      });
    }
    return _weeklyReviewMod;
  } catch (err) {
    console.error('Failed to load Weekly Review module:', err);
    showToast('Failed to load Weekly Review. Please reload the page.', 'error');
    throw err;
  }
}
async function renderWeeklyReview() {
  return (await _loadWeeklyReview()).renderWeeklyReview();
}
async function discussReview(...args) {
  return (await _loadWeeklyReview()).discussReview(...args);
}
let generateWeeklyReview = async (...args) => (await _loadWeeklyReview()).generateWeeklyReview(...args);

// ============================================================
// FOCUS MODE (lazy-loaded)
// ============================================================
let _focusMod = null;
async function _loadFocus() {
  try {
    if (!_focusMod) {
      const { createFocusMode } = await import('./focus.js');
      _focusMod = createFocusMode({
        $,
        esc,
        findTask,
        updateTask,
        activeTasks,
        matchTask,
        showToast: (...args) => showToast(...args),
        render: () => render(),
        hasAI,
        callAI,
        buildAIContext,
        getAIMemory,
        sanitizeAIHTML,
        PRIORITY_ORDER,
        AI_PERSONA_SHORT,
        getData: () => data,
        setModalTriggerEl: (el) => {
          _events.setModalTriggerEl(el);
        },
        userKey,
        todayStr,
      });
    }
    return _focusMod;
  } catch (err) {
    console.error('Failed to load Focus Mode module:', err);
    showToast('Failed to load Focus Mode. Please reload the page.', 'error');
    throw err;
  }
}
async function startFocus(...args) {
  return (await _loadFocus()).startFocus(...args);
}
async function openFocusView() {
  return (await _loadFocus()).openFocusView();
}
async function renderFocusOverlay() {
  return (await _loadFocus()).renderFocusOverlay();
}
async function completeFocusTask() {
  return (await _loadFocus()).completeFocusTask();
}
async function skipFocusTask() {
  return (await _loadFocus()).skipFocusTask();
}
async function closeFocus() {
  return (await _loadFocus()).closeFocus();
}
async function _logDistraction() {
  return (await _loadFocus()).logDistraction();
}
async function _startBreakTimer() {
  return (await _loadFocus()).startBreakTimer();
}
async function _endBreak() {
  return (await _loadFocus()).endBreak();
}
async function _handleGoalPick(...args) {
  return (await _loadFocus()).handleGoalPick(...args);
}
async function _handleGoalStart() {
  return (await _loadFocus()).handleGoalStart();
}

// ============================================================
// QUICK ADD
// ============================================================
const _quickAdd = createQuickAdd({
  $,
  esc,
  fmtDate,
  todayStr,
  localISO,
  genId,
  getData: () => data,
  saveData: (d) => saveData(d),
  render,
  showToast: (...args) => showToast(...args),
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
  startFocus: (...args) => startFocus(...args),
  toggleChat,
  sendChat,
  setView,
  planMyDay: (...args) => planMyDay(...args),
  maybeProactiveEnhance: (...args) => maybeProactiveEnhance(...args),
  getSmartDefaults: (...args) => getSmartDefaults(...args),
  predictCompletion: (...args) => predictCompletion(...args),
  autoClassifyTask,
  getBulkSelected: () => bulkSelected,
  getBatchMode: () => _batchMode,
  setBatchMode: (v) => {
    _batchMode = v;
  },
  getAllTemplates,
  applyTemplate,
});
const openQuickAdd = _quickAdd.openQuickAdd;
const submitQuickAdd = _quickAdd.submitQuickAdd;
const previewQuickCapture = _quickAdd.previewQuickCapture;
const quickAddToProject = _quickAdd.quickAddToProject;
const parseQuickInput = _quickAdd.parseQuickInput;
const handleSlashCommand = _quickAdd.handleSlashCommand;
const aiEnhanceTask = _quickAdd.aiEnhanceTask;
const aiReorganize = _quickAdd.aiReorganize;
const confirmAIAction = _quickAdd.confirmAIAction;
const bulkAction = _quickAdd.bulkAction;
const exportCalendar = _quickAdd.exportCalendar;
const applyTemplateToQuickAdd = _quickAdd.applyTemplateToQuickAdd;

// ============================================================
// COMMAND PALETTE (lazy-loaded)
// ============================================================
let _cmdPaletteMod = null;
async function _loadCommandPalette() {
  try {
    if (!_cmdPaletteMod) {
      const { createCommandPalette } = await import('./command-palette.js');
      _cmdPaletteMod = createCommandPalette({
        $,
        $$,
        esc,
        highlightMatch,
        fmtDate,
        getData: () => data,
        userKey,
        closeModal,
        setModalTriggerEl: (el) => {
          _events.setModalTriggerEl(el);
        },
        activeTasks,
        hasAI,
        showToast: (...args) => showToast(...args),
        setView,
        sendChat,
        toggleChat,
        openNewTask,
        openQuickAdd,
        openNewProject: () => openNewProject(),
        openSettings: () => openSettings(),
        startFocus: (...args) => startFocus(...args),
        aiReorganize,
        filterAIPrepared: (...args) => filterAIPrepared(...args),
        setNudgeFilter: (v) => {
          _nudgeFilter = v;
        },
        getCurrentProject: () => currentProject,
      });
    }
    return _cmdPaletteMod;
  } catch (err) {
    console.error('Failed to load Command Palette module:', err);
    showToast('Failed to load Command Palette. Please reload the page.', 'error');
    throw err;
  }
}
async function openSearch() {
  return (await _loadCommandPalette()).openSearch();
}
async function handleCmdNav(...args) {
  return (await _loadCommandPalette()).handleCmdNav(...args);
}
async function renderSearchResults(...args) {
  return (await _loadCommandPalette()).renderSearchResults(...args);
}
async function cmdExec(...args) {
  return (await _loadCommandPalette()).cmdExec(...args);
}
async function openShortcutHelp() {
  return (await _loadCommandPalette()).openShortcutHelp();
}
async function resetCmdIdx() {
  return (await _loadCommandPalette()).resetCmdIdx();
}

// ============================================================
// AUTH
// ============================================================
const _auth = createAuth({
  sb,
  esc,
  todayStr,
  userKey,
  DEFAULT_SETTINGS,
  render: () => render(),
  showToast: (...args) => showToast(...args),
  loadData,
  loadSettings,
  loadFromCloud,
  ensureLifeProject,
  processRecurringTasks: () => processRecurringTasks(),
  cleanupArchive,
  autoEscalatePriority,
  requestNotificationPermission,
  hasAI,
  processDump: (...args) => processDump(...args),
  processDumpManual: (...args) => processDumpManual(...args),
  getGuestMode: () => guestMode,
  setGuestMode: (v) => { guestMode = v; },
  getData: () => data,
  getCurrentUser: () => currentUser,
  setCurrentUser: (u) => {
    currentUser = u;
  },
  setData: (d) => {
    data = d;
    _dataLayer.setData(d);
  },
  setSettings: (s) => {
    settings = s;
    _dataLayer.setSettings(s);
  },
  setCurrentView: (v) => {
    currentView = v;
  },
  setCurrentProject: (v) => {
    currentProject = v;
  },
  setExpandedTask: (v) => {
    expandedTask = v;
  },
  setProactiveLog: (v) => {
    proactiveLog = v;
  },
  setSidebarCollapsed: (v) => {
    sidebarCollapsed = v;
  },
  setBulkMode: (v) => {
    bulkMode = v;
  },
  setBulkSelected: (v) => {
    bulkSelected = v;
  },
  setNudgeFilter: (v) => {
    _nudgeFilter = v;
  },
  setShowTagFilter: (v) => {
    _showTagFilter = v;
  },
  setBriefingGenerating: (v) => {
    _briefingGenerating = v;
  },
  setPlanGenerating: (v) => {
    _planGenerating = v;
  },
  setDataVersion: (v) => {
    _dataLayer.setDataVersion(v);
  },
  setRenderCache: (v) => {
    _dataLayer.setRenderCache(v);
  },
  setTaskMapState: (ver, map) => {
    _dataLayer.setTaskMapState(ver, map);
  },
  clearUndoStack: () => {
    _dataLayer.clearUndoStack();
  },
  getSyncModule: () => _sync,
  getChatModule: () => _chat,
  getFocusModule: () => _focusMod,
  generateAIBriefing: () => generateAIBriefing(),
  setTodayBriefingExpanded: (v) => {
    _todayBriefingExpanded = v;
  },
  clearNotifications: () => clearNotifications(),
  scheduleNotifications: () => scheduleNotifications(),
});
const showAuthFromLanding = _auth.showAuthFromLanding;
const initAuth = _auth.initAuth;
const handleAuth = _auth.handleAuth;
const toggleAuthMode = _auth.toggleAuthMode;
const showForgotPassword = _auth.showForgotPassword;
const showPrivacy = _auth.showPrivacy;
const showTerms = _auth.showTerms;
const resendVerification = _auth.resendVerification;
const _origSignOut = _auth.signOut;
const signOut = async () => {
  stopEscalationLoop();
  if (_proactiveChatTimer) { clearTimeout(_proactiveChatTimer); _proactiveChatTimer = null; }
  return _origSignOut();
};
const showFeatureTips = _auth.showFeatureTips;
const showOnboardingExperience = _auth.showOnboardingExperience;
const enterGuestMode = _auth.enterGuestMode;
const showSignUpNudge = _auth.showSignUpNudge;

// ============================================================
// PROACTIVE AI
// ============================================================
const _proactive = createProactive({
  $,
  esc,
  sanitizeAIHTML,
  todayStr,
  localISO,
  genId,
  getData: () => data,
  userKey,
  hasAI,
  callAI,
  buildAIContext,
  addAIMemory,
  getAIMemory,
  findTask,
  updateTask,
  addTask,
  createTask,
  isBlocked,
  showToast: (...args) => showToast(...args),
  render: () => render(),
  setView: (v, p) => setView(v, p),
  notifyOverdueTasks,
  getProactiveLog: () => proactiveLog,
  setProactiveLog: (v) => {
    proactiveLog = v;
  },
  getProactiveRunning: () => _proactiveRunning,
  setProactiveRunning: (v) => {
    _proactiveRunning = v;
  },
  setBriefingGenerating: (v) => {
    _briefingGenerating = v;
  },
  setPlanGenerating: (v) => {
    _planGenerating = v;
  },
  setNudgeFilter: (v) => {
    _nudgeFilter = v;
  },
  setProactiveResults: (v) => {
    _uiHelpers.setProactiveResults(v);
  },
  setPlanIndexCache: (cache, date) => {
    if (_dashboard) _dashboard.setPlanIndexCache(cache, date);
  },
});
const filterAIPrepared = _proactive.filterAIPrepared;
const maybeProactiveEnhance = _proactive.maybeProactiveEnhance;
let runProactiveWorker = _proactive.runProactiveWorker;
let planMyDay = _proactive.planMyDay;
const sendNarrativeReply = _proactive.sendNarrativeReply;
const snoozePlanTask = _proactive.snoozePlanTask;
const replanDay = _proactive.replanDay;
let generateAIBriefing = _proactive.generateAIBriefing;
const generateBoardNarrative = _proactive.generateBoardNarrative;
const sendBoardReply = _proactive.sendBoardReply;
const getNextRecommendation = _proactive.getNextRecommendation;
const trackFocusSkip = _proactive.trackFocusSkip;
const getWeeklyLearnings = _proactive.getWeeklyLearnings;
let submitEndOfDay = _proactive.submitEndOfDay;
const getSmartNudges = _proactive.getSmartNudges;
const nudgeFilterOverdue = _proactive.nudgeFilterOverdue;
const nudgeFilterStale = _proactive.nudgeFilterStale;
const nudgeFilterUnassigned = _proactive.nudgeFilterUnassigned;
const maybeReflect = _proactive.maybeReflect;
const getStuckTasks = _proactive.getStuckTasks;
const processRecurringTasks = _proactive.processRecurringTasks;
const getAIStatusItems = _proactive.getAIStatusItems;
const getSmartFeedItems = _proactive.getSmartFeedItems;
const getSmartDefaults = _proactive.getSmartDefaults;
const extractMemoryInsights = _proactive.extractMemoryInsights;
const trackNudgeInteraction = _proactive.trackNudgeInteraction;
const predictCompletion = _proactive.predictCompletion;
const getFollowUpSuggestions = _proactive.getFollowUpSuggestions;

function showFollowUpToast(suggestions) {
  if (!suggestions || !suggestions.length) return;
  const s = suggestions[0];
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--surface2);border:1px solid var(--border2);color:var(--text2);padding:14px 20px;border-radius:var(--radius);font-size:13px;z-index:9999;max-width:480px;text-align:center;box-shadow:var(--shadow-lg);line-height:1.5;animation:toastIn 0.3s ease;backdrop-filter:blur(8px)';
  let html = '<span style="color:var(--accent);margin-right:6px">\u2726</span>';
  html += esc(s.text);
  if (suggestions.length > 1)
    html += ' <span style="color:var(--text3);font-size:11px">(+' + (suggestions.length - 1) + ' more)</span>';
  el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.5s';
    setTimeout(() => el.remove(), 500);
  }, 6000);
}
const dismissCheckIn = _proactive.dismissCheckIn;
const detectVagueTasks = _proactive.detectVagueTasks;
const breakdownTask = _proactive.breakdownTask;
const dismissVagueTask = _proactive.dismissVagueTask;
const acceptReschedule = _proactive.acceptReschedule;
const skipReschedule = _proactive.skipReschedule;
const acceptAllReschedules = _proactive.acceptAllReschedules;
const autoRebalanceWeek = _proactive.autoRebalanceWeek;
const isWeekOverloaded = _proactive.isWeekOverloaded;

// ============================================================
// ESCALATION ENGINE
// ============================================================
const _escalation = createEscalation({
  getData: () => data,
  activeTasks,
  findTask,
  updateTask,
  render: () => render(),
  showToast: (...args) => showToast(...args),
  startFocus: (...args) => startFocus(...args),
  todayStr,
  userKey,
  replanDay: () => replanDay(),
});
const startEscalationLoop = _escalation.startEscalationLoop;
const stopEscalationLoop = _escalation.stopEscalationLoop;
const _maybeEscalationOnRender = _escalation.maybeCheckOnRender;
const renderEscalationBanner = _escalation.renderEscalationBanner;
const handleEscalationAction = _escalation.handleEscalationAction;

// ============================================================
// DASHBOARD
// ============================================================
const _dashboard = createDashboard({
  $,
  $$,
  esc,
  sanitizeAIHTML,
  fmtDate,
  todayStr,
  PRIORITY_ORDER,
  getData: () => data,
  userKey,
  findTask,
  activeTasks,
  projectTasks,
  archivedTasks,
  sortTasksDeps: { getDataVersion: () => _dataLayer.getDataVersion() },
  hasAI,
  showToast: (...args) => showToast(...args),
  render: () => render(),
  setView,
  updateTask,
  addTask,
  createTask,
  renderTaskRow,
  renderTaskExpanded,
  renderPriorityTag,
  renderCalendar,
  getCurrentView: () => currentView,
  getCurrentProject: () => currentProject,
  getExpandedTask: () => expandedTask,
  getDashViewMode: () => dashViewMode,
  getShowCompleted: (key) => showCompleted[key],
  getProjectViewMode: (pid) => projectViewMode[pid],
  getShowProjectBg: (pid) => showProjectBg[pid],
  parseProjectBackground,
  getBulkMode: () => bulkMode,
  getSectionShowCount: (key) => _sectionShowCount[key],
  getArchiveShowCount: () => _archiveShowCount,
  renderBulkBar,
  attachListeners,
  getBrainstormModule: () => _loadBrainstorm(),
  isGuestMode: () => guestMode,
  getAIStatusItems,
  getSmartFeedItems,
  getSmartNudges,
  getStuckTasks,
  isWeekOverloaded,
  detectVagueTasks,
  nudgeFilterOverdue,
  nudgeFilterStale,
  nudgeFilterUnassigned,
  startFocus: (...args) => startFocus(...args),
  offerStuckHelp,
  getNextRecommendation,
  getWeeklyLearnings,
  generateAIBriefing: (...args) => generateAIBriefing(...args),
  planMyDay: (...args) => planMyDay(...args),
  runProactiveWorker: (...args) => runProactiveWorker(...args),
  getBriefingGenerating: () => _briefingGenerating,
  setBriefingGenerating: (v) => {
    _briefingGenerating = v;
  },
  getPlanGenerating: () => _planGenerating,
  setPlanGenerating: (v) => {
    _planGenerating = v;
  },
  getNudgeFilter: () => _nudgeFilter,
  setNudgeFilter: (v) => {
    _nudgeFilter = v;
  },
  getTodayBriefingExpanded: () => _todayBriefingExpanded,
  getShowTagFilter: () => _showTagFilter,
  getActiveTagFilter: () => activeTagFilter,
  getAllTags,
  getTagColor,
  toggleChat,
  sendChat,
  renderDump: (...args) => renderDump(...args),
  initDumpDropZone: (...args) => initDumpDropZone(...args),
  renderWeeklyReview: (...args) => renderWeeklyReview(...args),
  isComplexInput,
  parseQuickInput,
  handleSlashCommand,
  aiEnhanceTask,
  getEscalationBanner: () => (typeof renderEscalationBanner === 'function' ? renderEscalationBanner() : ''),
  getAIMemory: () => (typeof getAIMemory === 'function' ? getAIMemory() : []),
  extractMemoryInsights: (...args) =>
    typeof extractMemoryInsights === 'function'
      ? extractMemoryInsights(...args)
      : {
          productive_time: null,
          avg_tasks_per_day: null,
          most_productive_day: null,
          task_order_preference: null,
          procrastination_types: [],
        },
});
const sortTasks = _dashboard.sortTasks;
_renderNow = _dashboard._renderNow;
const heroInputHandler = _dashboard.heroInputHandler;
_dashboard.hookDashboardPostRender();

// ============================================================
// INIT (extracted to ./init.js)
// ============================================================
setupTooltips({ getData: () => data });

const _throttled = wrapWithThrottle(
  {
    generateAIBriefing,
    planMyDay,
    submitEndOfDay,
    generateWeeklyReview: (...args) => generateWeeklyReview(...args),
    runProactiveWorker,
  },
  throttleAI,
);
generateAIBriefing = _throttled.generateAIBriefing;
planMyDay = _throttled.planMyDay;
submitEndOfDay = _throttled.submitEndOfDay;
generateWeeklyReview = _throttled.generateWeeklyReview;
runProactiveWorker = _throttled.runProactiveWorker;

setupModalObserver(trapFocus);
setupPopstateHandler({ closeModal, toggleChat, closeMobileSidebar });
setupOfflineBanner({
  syncModule: _sync,
  getUpdateSyncDot: () => updateSyncDot,
  setUpdateSyncDot: (fn) => {
    updateSyncDot = fn;
  },
});
setupPullToRefresh(() => _sync.syncToCloud());

// ============================================================
// EVENT DELEGATION (extracted to ./actions.js)
// ============================================================
createActions({
  setView,
  render,
  closeModal,
  closeMobileSidebar,
  openMobileSidebar,
  toggleSidebar,
  toggleChat,
  sendChat,
  sendChatChip,
  updateChatChips,
  openEditTask,
  openNewTask,
  saveNewTask,
  saveEditTask,
  updateTask,
  deleteTask,
  addTask,
  createTask,
  toggleSubtask,
  undo,
  redo,
  unarchiveTask,
  deleteArchivedPermanently,
  findTask,
  getData: () => data,
  restoreFromBackup,
  dismissCorruption,
  openNewProject,
  saveNewProject,
  openEditProject,
  saveEditProject,
  confirmDeleteProject,
  toggleBulkMode,
  bulkAction,
  startFocus: (...args) => startFocus(...args),
  openFocusView: (...args) => openFocusView(...args),
  closeFocus: (...args) => closeFocus(...args),
  completeFocusTask: (...args) => completeFocusTask(...args),
  skipFocusTask: (...args) => skipFocusTask(...args),
  renderFocusOverlay: (...args) => renderFocusOverlay(...args),
  openSearch: (...args) => openSearch(...args),
  openQuickAdd,
  submitQuickAdd,
  openShortcutHelp: (...args) => openShortcutHelp(...args),
  handleCmdNav: (...args) => handleCmdNav(...args),
  renderSearchResults: (...args) => renderSearchResults(...args),
  resetCmdIdx: (...args) => resetCmdIdx(...args),
  cmdExec: (...args) => cmdExec(...args),
  previewQuickCapture,
  getCalModule: () => _cal,
  calNav,
  calToday,
  processDump: (...args) => processDump(...args),
  cancelDump: (...args) => cancelDump(...args),
  isDumpInProgress,
  applyDumpResults: (...args) => applyDumpResults(...args),
  submitClarify: (...args) => submitClarify(...args),
  skipClarify: (...args) => skipClarify(...args),
  getBrainstormModule: () => _loadBrainstorm(),
  openSettings,
  syncCalendar,
  exportData,
  importData,
  exportCalendar,
  archiveMemory,
  restoreMemory,
  deleteAIMemory,
  confirmClearMemories,
  confirmResetData,
  editProjectBackground,
  saveProjectBackground,
  saveAsTemplate,
  deleteTemplate,
  openEditTemplate,
  saveEditTemplate,
  applyTemplateToQuickAdd,
  showAuthFromLanding,
  enterGuestMode,
  showSignUpNudge,
  handleAuth,
  toggleAuthMode,
  showForgotPassword,
  showPrivacy,
  showTerms,
  signOut,
  resendVerification,
  generateAIBriefing: (...args) => generateAIBriefing(...args),
  planMyDay: (...args) => planMyDay(...args),
  replanDay,
  snoozePlanTask,
  dismissCheckIn,
  breakdownTask: (...args) => breakdownTask(...args),
  dismissVagueTask,
  offerStuckHelp: (...args) => offerStuckHelp(...args),
  submitEndOfDay: (...args) => submitEndOfDay(...args),
  aiReorganize,
  generateWeeklyReview: (...args) => generateWeeklyReview(...args),
  discussReview: (...args) => discussReview(...args),
  showToast,
  getSupabase: () => sb,
  filterByTag,
  addTagToPicker,
  previewSmartDate,
  showDepResults,
  removeDep,
  confirmAction,
  quickAddToProject,
  addSubtask,
  deleteSubtask,
  renameSubtask,
  updateSubtaskNotes,
  runTaskCmd,
  guardedCloseEditModal,
  heroInputHandler,
  openBrainstormModal: () => _dashboard.openBrainstormModal(),
  _addFocusSkip: (id) => _dashboard._addFocusSkip(id),
  _resetFocusSkips: () => _dashboard._resetFocusSkips(),
  showFeatureTips,
  showOnboardingExperience,
  openProjectChat,
  openTaskWork,
  sendNarrativeReply,
  generateBoardNarrative,
  sendBoardReply,
  getNextRecommendation,
  trackFocusSkip,
  getWeeklyLearnings,
  handleDumpFiles: (...args) => handleDumpFiles(...args),
  uploadTaskAttachment: (...args) => uploadTaskAttachment(...args),
  removeTaskAttachment: (...args) => removeTaskAttachment(...args),
  handleEscalationAction,
  trackNudgeInteraction,
  autoRebalanceWeek: (...args) => autoRebalanceWeek(...args),
  acceptReschedule,
  skipReschedule,
  acceptAllReschedules,
  getExpandedTask: () => expandedTask,
  setExpandedTask: (v) => {
    expandedTask = v;
  },
  getGetFollowUpSuggestions: () => (typeof getFollowUpSuggestions === 'function' ? getFollowUpSuggestions : null),
  getShowFollowUpToast: () => showFollowUpToast,
  getCurrentProject: () => currentProject,
  getShowCompleted: (k) => showCompleted[k],
  setShowCompleted: (k, v) => {
    showCompleted[k] = v;
  },
  setDashViewMode: (m) => {
    dashViewMode = m;
  },
  getKbIdx: () => kbIdx,
  setKbIdx: (v) => {
    kbIdx = v;
  },
  getSectionShowCount: (k) => _sectionShowCount[k],
  setSectionShowCount: (k, v) => {
    _sectionShowCount[k] = v;
  },
  getArchiveShowCount: () => _archiveShowCount,
  setArchiveShowCount: (v) => {
    _archiveShowCount = v;
  },
  TASKS_PER_PAGE,
  setTodayBriefingExpanded: (v) => {
    _todayBriefingExpanded = v;
  },
  getShowTagFilter: () => _showTagFilter,
  setShowTagFilter: (v) => {
    _showTagFilter = v;
  },
  setActiveTagFilter: (v) => {
    activeTagFilter = v;
  },
  setProjectViewMode: (pid, mode) => {
    projectViewMode[pid] = mode;
  },
  getShowProjectBg: (pid) => showProjectBg[pid],
  setShowProjectBg: (pid, v) => {
    showProjectBg[pid] = v;
  },
  getFocusModule: () => _focusMod,
  highlightKbRow,
  saveSettings,
  getSettings: () => settings,
  $,
  userKey,
  todayStr: () => todayStr(),
  getNotifications: () => _notifications,
});

// ============================================================
// WINDOW EXPOSURE (extracted to ./window-api.js)
// ============================================================
exposeWindowAPI(
  {
    showAuthFromLanding,
    enterGuestMode,
    showSignUpNudge,
    handleAuth,
    toggleAuthMode,
    signOut,
    showForgotPassword,
    showPrivacy,
    showTerms,
    resendVerification,
    setView,
    render,
    toggleExpandTask: (id) => {
      expandedTask = expandedTask === id ? null : id;
      render();
    },
    showToast,
    closeModal,
    openSearch: (...args) => openSearch(...args),
    openSettings,
    openNewProject,
    openNewTask,
    openEditTask,
    openEditProject,
    openProjectChat,
    openTaskWork,
    openQuickAdd,
    toggleChat,
    toggleSidebar,
    openMobileSidebar,
    closeMobileSidebar,
    toggleBulkMode,
    addTask,
    createTask,
    updateTask,
    deleteTask,
    toggleSubtask,
    undo,
    unarchiveTask,
    deleteArchivedPermanently,
    saveNewProject,
    saveNewTask,
    saveEditProject,
    saveEditTask,
    exportData,
    cleanupStorage: () => _dataLayer.cleanupStorage(),
    confirmAction,
    confirmDeleteProject,
    confirmClearMemories,
    confirmResetData,
    saveSettings,
    submitQuickAdd,
    processDump: (...args) => processDump(...args),
    cancelDump: (...args) => cancelDump(...args),
    applyDumpResults: (...args) => applyDumpResults(...args),
    generateAIBriefing,
    planMyDay,
    replanDay,
    generateWeeklyReview: (...args) => generateWeeklyReview(...args),
    discussReview: (...args) => discussReview(...args),
    submitEndOfDay,
    sendChat,
    sendChatChip,
    updateChatChips,
    aiReorganize,
    generateBoardNarrative,
    sendNarrativeReply,
    sendBoardReply,
    getNextRecommendation,
    trackFocusSkip,
    getWeeklyLearnings,
    startFocus: (...args) => startFocus(...args),
    closeFocus: (...args) => closeFocus(...args),
    openFocusView: (...args) => openFocusView(...args),
    completeFocusTask: (...args) => completeFocusTask(...args),
    skipFocusTask: (...args) => skipFocusTask(...args),
    renderFocusOverlay: (...args) => renderFocusOverlay(...args),
    runTaskCmd,
    snoozePlanTask,
    archiveMemory,
    restoreMemory,
    calNav,
    calToday,
    exportCalendar,
    sortTasks,
    bulkAction,
    cmdExec: (...args) => cmdExec(...args),
    filterByTag,
    esc,
    todayStr,
    userKey,
    fmtDate,
    sanitizeAIHTML,
    highlightMatch,
    editProjectBackground,
    saveProjectBackground,
    parseProjectBackground,
    findTask,
    activeTasks,
    doneTasks,
    urgentTasks,
    projectTasks,
    showUndoToast,
    pushUndo,
  },
  {
    expandedTask: {
      get: () => expandedTask,
      set: (v) => {
        expandedTask = v;
      },
    },
    currentProject: {
      get: () => currentProject,
      set: (v) => {
        currentProject = v;
      },
    },
    data: { get: () => data },
    settings: {
      get: () => settings,
      set: (v) => {
        settings = v;
      },
    },
    _todayBriefingExpanded: {
      get: () => _todayBriefingExpanded,
      set: (v) => {
        _todayBriefingExpanded = v;
      },
    },
  },
);

// ============================================================
// SERVICE WORKER & BOOT
// Service Worker — offline support + PWA install
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((_e) => {
    console.warn('service worker registration failed:', _e.message || _e);
  });
}
// Chat input auto-expand handled by inline oninput in index.html

initAuth();

// Start escalation engine after auth — if user is already authenticated,
// the escalation loop begins; the check on every render call acts as backup
startEscalationLoop();

// ── Share Target & Shortcut handler ─────────────────────────────────────
// When the PWA receives shared content (via Web Share Target API) or is
// launched from a shortcut, the manifest routes to / with URL params.
// We detect those params here and route to the appropriate feature.
(function _handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const sharedTitle = params.get('shared_title') || '';
  const sharedText = params.get('shared_text') || '';
  const sharedUrl = params.get('shared_url') || '';
  const action = params.get('action') || '';

  // Clean URL params so they don't persist on refresh
  if (sharedTitle || sharedText || sharedUrl || action) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  if (sharedTitle || sharedText || sharedUrl) {
    // Build combined text from shared content
    const parts = [sharedTitle, sharedText, sharedUrl].filter(Boolean);
    const combined = parts.join('\n');
    // Wait for DOM to be ready, then open brainstorm with pre-filled text
    setTimeout(() => {
      _dashboard.openBrainstormModal();
      // Give modal time to render, then fill textarea
      setTimeout(() => {
        const textarea = document.getElementById('dumpText');
        if (textarea) {
          textarea.value = (textarea.value ? textarea.value + '\n' : '') + combined;
          textarea.focus();
        }
      }, 200);
    }, 300);
  } else if (action === 'brainstorm') {
    setTimeout(() => {
      _dashboard.openBrainstormModal();
    }, 300);
  } else if (action === 'quick-capture') {
    setTimeout(() => {
      if (typeof openQuickAdd === 'function') openQuickAdd();
    }, 300);
  }
})();

// Proactive chat — triggers after 10 minutes of inactivity with stuck tasks
let _proactiveChatTimer = null;
function _scheduleProactiveChat() {
  if (_proactiveChatTimer) clearTimeout(_proactiveChatTimer);
  _proactiveChatTimer = setTimeout(
    () => {
      if (typeof maybeProactiveChat === 'function') maybeProactiveChat();
    },
    10 * 60 * 1000,
  ); // 10 minutes
}
_scheduleProactiveChat();

// Idle nudge for first-time users — after 60s of inactivity, suggest brainstorm
(function _initIdleNudge() {
  if (localStorage.getItem('wb_idle_nudge_shown')) return;
  const _idleNudgeTimer = setTimeout(() => {
    // Only fire if still no tasks and nudge not yet shown
    if (localStorage.getItem('wb_idle_nudge_shown')) return;
    try {
      const _d = _dataLayer.getData ? _dataLayer.getData() : null;
      if (_d && _d.tasks.length === 0) {
        localStorage.setItem('wb_idle_nudge_shown', '1');
        if (typeof showToast === 'function') {
          showToast('Try pasting meeting notes or a to-do list above \u2014 AI will organize everything for you');
        }
      }
    } catch (_e) {
      /* ignore */
    }
  }, 60000);
  // Cancel if user interacts (creates a task, etc.)
  const _cancelIdleNudge = () => {
    clearTimeout(_idleNudgeTimer);
    document.removeEventListener('click', _cancelIdleNudge);
    document.removeEventListener('keydown', _cancelIdleNudge);
  };
  document.addEventListener('click', _cancelIdleNudge);
  document.addEventListener('keydown', _cancelIdleNudge);
})();

// ============================================================
// EXPORTS — For testing
// ============================================================
export {
  esc,
  sanitizeAIHTML,
  normalizeTitle,
  titleSimilarity,
  highlightMatch,
  genId,
  todayStr,
  localISO,
  fmtDate,
  relativeTime,
  parseNaturalDate,
  chunkText,
  createTask,
  createProject,
  findTask,
  findSimilarTask,
  findSimilarProject,
  sortTasks,
  validateTaskFields,
  PRIORITY_ORDER,
  PROJECT_COLORS,
  TAG_COLORS,
};
