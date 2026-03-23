// Schema versioning and data migration system
// Each migration transforms data from version N to N+1

export const CURRENT_SCHEMA_VERSION = 3;

const TASK_DEFAULTS = {
  title: '',
  notes: '',
  status: 'todo',
  priority: 'normal',
  horizon: 'short',
  project: '',
  dueDate: '',
  phase: '',
  recurrence: '',
  estimatedMinutes: 0,
  tags: [],
  priorityReason: '',
  blockedBy: [],
  subtasks: [],
  createdAt: null, // filled dynamically per-task during migration
  completedAt: null,
  updatedAt: null, // filled dynamically — tracks last modification for sync conflict resolution
  archived: false,
  updates: [],
};

// Migration from version 0 (unversioned) to version 1:
// - Ensure all tasks have all default fields
// - Remove any `goals` field from data
// - Ensure `updates` array exists on every task
function migrateToV1(data) {
  // Remove goals if present
  delete data.goals;

  if (Array.isArray(data.tasks)) {
    data.tasks = data.tasks.map((task) => {
      // Ensure all default fields exist
      for (const [key, defaultVal] of Object.entries(TASK_DEFAULTS)) {
        if (task[key] === undefined || task[key] === null) {
          if (key === 'createdAt') {
            task[key] = new Date().toISOString();
          } else if (Array.isArray(defaultVal)) {
            task[key] = [];
          } else {
            task[key] = defaultVal;
          }
        }
      }
      // Ensure updates is an array
      if (!Array.isArray(task.updates)) {
        task.updates = [];
      }
      return task;
    });
  }

  data._schemaVersion = 1;
  return data;
}

// Migration from version 1 to version 2:
// - Add `updatedAt` field to all tasks for sync conflict resolution
function migrateToV2(data) {
  if (Array.isArray(data.tasks)) {
    data.tasks = data.tasks.map((task) => {
      if (!task.updatedAt) {
        // Use createdAt as initial updatedAt, or now if missing
        task.updatedAt = task.createdAt || new Date().toISOString();
      }
      return task;
    });
  }
  data._schemaVersion = 2;
  return data;
}

// Migration from version 2 to version 3:
// - Add `priorityReason` field to all tasks for AI-generated priority explanations
function migrateToV3(data) {
  if (Array.isArray(data.tasks)) {
    data.tasks = data.tasks.map((task) => {
      if (task.priorityReason === undefined) {
        task.priorityReason = '';
      }
      return task;
    });
  }
  data._schemaVersion = 3;
  return data;
}

// Ordered list of migrations. Index 0 = migration from v0 to v1, etc.
const migrations = [migrateToV1, migrateToV2, migrateToV3];

/**
 * Check data._schemaVersion and run any needed migrations sequentially.
 * Mutates and returns the data object.
 */
export function migrateData(data) {
  if (!data || typeof data !== 'object') return data;

  let version = data._schemaVersion || 0;

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrationFn = migrations[version];
    if (!migrationFn) {
      console.warn(`[MIGRATE] No migration found for version ${version} -> ${version + 1}`);
      break;
    }
    console.debug(`[MIGRATE] Running migration v${version} -> v${version + 1}`);
    data = migrationFn(data);
    version = data._schemaVersion || version + 1;
  }

  return data;
}
