import { describe, it, expect } from 'vitest';
import { migrateData, CURRENT_SCHEMA_VERSION } from '../migrations.js';

describe('migrations.js', () => {
  it('CURRENT_SCHEMA_VERSION is 3', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });

  it('returns falsy input unchanged', () => {
    expect(migrateData(null)).toBe(null);
    expect(migrateData(undefined)).toBe(undefined);
  });

  it('migrates unversioned data through all versions', () => {
    const data = {
      tasks: [{ id: 't1', title: 'Test' }],
      projects: [],
      goals: ['old goal'],
    };
    const result = migrateData(data);
    expect(result._schemaVersion).toBe(3);
    expect(result.goals).toBeUndefined();
    // v2 migration should add updatedAt
    expect(result.tasks[0].updatedAt).toBeTruthy();
  });

  it('fills missing task fields with defaults', () => {
    const data = {
      tasks: [{ id: 't1', title: 'Bare task' }],
      projects: [],
    };
    const result = migrateData(data);
    const t = result.tasks[0];
    expect(t.status).toBe('todo');
    expect(t.priority).toBe('normal');
    expect(t.tags).toEqual([]);
    expect(t.blockedBy).toEqual([]);
    expect(t.subtasks).toEqual([]);
    expect(t.updates).toEqual([]);
    expect(t.archived).toBe(false);
    expect(t.estimatedMinutes).toBe(0);
    expect(t.dueDate).toBe('');
    expect(t.recurrence).toBe('');
  });

  it('does not overwrite existing task fields', () => {
    const data = {
      tasks: [{ id: 't1', title: 'Task', status: 'done', priority: 'urgent', tags: ['work'] }],
      projects: [],
    };
    const result = migrateData(data);
    const t = result.tasks[0];
    expect(t.status).toBe('done');
    expect(t.priority).toBe('urgent');
    expect(t.tags).toEqual(['work']);
  });

  it('skips migration if already at current version', () => {
    const data = {
      _schemaVersion: 3,
      tasks: [{ id: 't1', title: 'Already migrated' }],
      projects: [],
    };
    const result = migrateData(data);
    expect(result._schemaVersion).toBe(3);
    // Task should NOT get defaults filled since migration didn't run
    expect(result.tasks[0].status).toBeUndefined();
  });

  it('handles empty tasks array', () => {
    const data = { tasks: [], projects: [] };
    const result = migrateData(data);
    expect(result._schemaVersion).toBe(3);
    expect(result.tasks).toEqual([]);
  });

  it('converts null updates to empty array', () => {
    const data = {
      tasks: [{ id: 't1', title: 'Task', updates: 'not-an-array' }],
      projects: [],
    };
    const result = migrateData(data);
    expect(result.tasks[0].updates).toEqual([]);
  });

  it('handles data with no tasks array', () => {
    const data = { projects: [] };
    const result = migrateData(data);
    expect(result._schemaVersion).toBe(3);
  });

  it('fills arrays with fresh empty arrays (no shared refs)', () => {
    const data = {
      tasks: [
        { id: 't1', title: 'A' },
        { id: 't2', title: 'B' },
      ],
      projects: [],
    };
    const result = migrateData(data);
    result.tasks[0].tags.push('test');
    expect(result.tasks[1].tags).toEqual([]);
  });

  it('preserves extra fields on tasks', () => {
    const data = {
      tasks: [{ id: 't1', title: 'Task', customField: 'keep me' }],
      projects: [],
    };
    const result = migrateData(data);
    expect(result.tasks[0].customField).toBe('keep me');
  });

  it('handles tasks with null fields', () => {
    const data = {
      tasks: [{ id: 't1', title: 'Task', tags: null, blockedBy: null, subtasks: null }],
      projects: [],
    };
    const result = migrateData(data);
    expect(result.tasks[0].tags).toEqual([]);
    expect(result.tasks[0].blockedBy).toEqual([]);
    expect(result.tasks[0].subtasks).toEqual([]);
  });

  it('returns non-object input unchanged', () => {
    expect(migrateData('string')).toBe('string');
    expect(migrateData(42)).toBe(42);
  });

  it('fills createdAt with a fresh ISO timestamp per task', () => {
    const data = {
      tasks: [
        { id: 't1', title: 'A' },
        { id: 't2', title: 'B' },
      ],
      projects: [],
    };
    const result = migrateData(data);
    // Both tasks should get createdAt filled
    expect(result.tasks[0].createdAt).toBeTruthy();
    expect(result.tasks[1].createdAt).toBeTruthy();
    // Should be valid ISO date strings
    expect(new Date(result.tasks[0].createdAt).toISOString()).toBe(result.tasks[0].createdAt);
  });

  it('does not overwrite existing createdAt', () => {
    const ts = '2025-01-15T10:00:00.000Z';
    const data = {
      tasks: [{ id: 't1', title: 'A', createdAt: ts }],
      projects: [],
    };
    const result = migrateData(data);
    expect(result.tasks[0].createdAt).toBe(ts);
  });
});
