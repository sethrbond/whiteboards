// ============================================================
// CONSTANTS
// ============================================================

export const STORE_KEY = 'taskboard_data';
export const SETTINGS_KEY = 'taskboard_settings';
export const DUMP_DRAFT_KEY = 'taskboard_dump_draft';
export const CHAT_HISTORY_KEY = 'wb_chat_history';

export const PROJECT_COLORS = [
  '#818cf8',
  '#f472b6',
  '#fb923c',
  '#4ade80',
  '#60a5fa',
  '#a855f7',
  '#f87171',
  '#fbbf24',
  '#2dd4bf',
  '#e879f9',
];
export const LIFE_PROJECT_NAME = 'Life';

export const DEFAULT_SETTINGS = { apiKey: '', aiModel: 'claude-haiku-4-5-20251001' };

export const PRIORITY_ORDER = { urgent: 0, important: 1, normal: 2, low: 3 };

export const MS_PER_DAY = 86_400_000;

// --- Magic-number constants ---
export const TRUNCATE_TITLE = 30;
export const TRUNCATE_DESC = 150;
export const AI_DELAY_MS = 3000;
export const CONFIRMATION_TIMEOUT_MS = 10000;
export const REFLECTION_TOAST_MS = 6000;
export const STALE_TASK_DAYS = 10;
export const MAX_NUDGES = 4;
export const MAX_UNDO_STACK = 20;
export const ARCHIVE_CLEANUP_DAYS = 30;
export const MAX_KANBAN_DONE = 20;
export const BRAINSTORM_WORD_THRESHOLD = 30;
export const MAX_NOTES_LENGTH = 10000;
export const MAX_AI_MEMORIES = 30;
export const DESC_TRUNCATE_SHORT = 120;
export const MAX_DUMP_INPUT_CHARS = 100000;
export const MAX_BRAINSTORM_INPUT_CHARS = 200000;
export const AI_CONTEXT_MAX_LENGTH = 30000;
export const AI_REQUEST_TIMEOUT_MS = 90000;
export const SAVE_DEBOUNCE_MS = 300;
export const SIMILARITY_THRESHOLD = 0.3;
export const MAX_CHAT_HISTORY = 15;
export const MODAL_ANIMATION_MS = 150;

// --- Escalation engine constants ---
export const ESCALATION_INTERVAL_MS = 1_800_000; // 30 minutes
export const ESCALATION_COOLDOWN_MS = 14_400_000; // 4 hours
export const DEADLINE_IMMINENT_HOURS = 4;
export const OVERDUE_PILEUP_THRESHOLD = 3;
export const STUCK_THRESHOLD_HOURS = 48;
export const DAY_PLAN_BEHIND_THRESHOLD = 0.3;

export const TAG_COLORS = [
  { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' }, // red
  { bg: 'rgba(249,115,22,0.12)', color: '#f97316' }, // orange
  { bg: 'rgba(234,179,8,0.12)', color: '#ca8a04' }, // yellow
  { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' }, // green
  { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' }, // blue
  { bg: 'rgba(168,85,247,0.12)', color: '#a855f7' }, // purple
  { bg: 'rgba(236,72,153,0.12)', color: '#ec4899' }, // pink
  { bg: 'rgba(20,184,166,0.12)', color: '#14b8a6' }, // teal
];
