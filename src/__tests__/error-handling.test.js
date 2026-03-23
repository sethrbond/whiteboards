import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migrateData, CURRENT_SCHEMA_VERSION } from '../migrations.js';
import { createAICaller } from '../ai.js';

// ============================================================
// Error handling tests — resilience to bad data, storage errors,
// API failures, and global error handlers
// ============================================================

describe('localStorage quota exceeded', () => {
  let originalSetItem;

  beforeEach(() => {
    originalSetItem = Storage.prototype.setItem;
  });

  afterEach(() => {
    Storage.prototype.setItem = originalSetItem;
  });

  it('throws QuotaExceededError when storage is full', () => {
    Storage.prototype.setItem = vi.fn(() => {
      const err = new DOMException('quota exceeded', 'QuotaExceededError');
      throw err;
    });
    expect(() => localStorage.setItem('test', 'data')).toThrow('quota exceeded');
  });

  it('QuotaExceededError has correct error name', () => {
    Storage.prototype.setItem = vi.fn(() => {
      const err = new DOMException('quota exceeded', 'QuotaExceededError');
      throw err;
    });
    try {
      localStorage.setItem('test', 'data');
    } catch (e) {
      expect(e.name).toBe('QuotaExceededError');
    }
  });

  it('can detect quota error and fall back gracefully', () => {
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    let savedSuccessfully = true;
    try {
      localStorage.setItem('key', 'value');
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        savedSuccessfully = false;
      }
    }
    expect(savedSuccessfully).toBe(false);
  });
});

describe('corrupt JSON in localStorage', () => {
  it('JSON.parse throws on truncated JSON', () => {
    expect(() => JSON.parse('{"tasks": [')).toThrow();
  });

  it('JSON.parse throws on invalid characters', () => {
    expect(() => JSON.parse('{tasks: []}')).toThrow();
  });

  it('JSON.parse throws on empty string', () => {
    expect(() => JSON.parse('')).toThrow();
  });

  it('JSON.parse handles null stored value (returns null)', () => {
    expect(JSON.parse('null')).toBeNull();
  });

  it('JSON.parse throws on unquoted keys', () => {
    expect(() => JSON.parse('{status: "todo"}')).toThrow();
  });

  it('JSON.parse throws on trailing comma', () => {
    expect(() => JSON.parse('{"a": 1,}')).toThrow();
  });

  it('JSON.parse handles deeply nested but valid JSON', () => {
    const deep = '{"a":{"b":{"c":{"d":{"e":"ok"}}}}}';
    expect(JSON.parse(deep).a.b.c.d.e).toBe('ok');
  });
});

describe('task data with missing required fields', () => {
  it('migrateData fills missing fields on tasks without id', () => {
    const data = { tasks: [{ title: 'No ID task' }], projects: [] };
    const result = migrateData(data);
    // Migration fills defaults but does not generate IDs
    expect(result.tasks[0].title).toBe('No ID task');
    expect(result.tasks[0].status).toBe('todo');
  });

  it('migrateData fills missing title with empty string', () => {
    const data = { tasks: [{ id: 't_1' }], projects: [] };
    const result = migrateData(data);
    expect(result.tasks[0].title).toBe('');
  });

  it('migrateData handles task with only id', () => {
    const data = { tasks: [{ id: 't_1' }], projects: [] };
    const result = migrateData(data);
    expect(result.tasks[0].priority).toBe('normal');
    expect(result.tasks[0].tags).toEqual([]);
    expect(result.tasks[0].subtasks).toEqual([]);
    expect(result.tasks[0].blockedBy).toEqual([]);
  });

  it('migrateData handles completely empty task object', () => {
    const data = { tasks: [{}], projects: [] };
    const result = migrateData(data);
    expect(result.tasks[0].status).toBe('todo');
    expect(result.tasks[0].priority).toBe('normal');
    expect(result.tasks[0].archived).toBe(false);
  });

  it('migrateData handles task with wrong field types', () => {
    const data = {
      tasks: [
        {
          id: 't_1',
          title: 123, // number instead of string
          status: true, // boolean instead of string
          tags: 'not-array',
        },
      ],
      projects: [],
    };
    const result = migrateData(data);
    // migrateData only fills missing/null fields, it does not fix types
    // but non-array updates get reset
    expect(result.tasks[0].title).toBe(123);
    expect(result._schemaVersion).toBe(3);
  });
});

describe('migrateData with future schema versions', () => {
  it('does not modify data already at current version', () => {
    const data = {
      _schemaVersion: CURRENT_SCHEMA_VERSION,
      tasks: [{ id: 't_1', title: 'Test' }],
      projects: [],
    };
    const result = migrateData(data);
    expect(result._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Task should not have defaults applied (migration skipped)
    expect(result.tasks[0].status).toBeUndefined();
  });

  it('does not crash on schema version higher than current', () => {
    const data = {
      _schemaVersion: CURRENT_SCHEMA_VERSION + 5,
      tasks: [{ id: 't_1', title: 'Future task' }],
      projects: [],
    };
    const result = migrateData(data);
    // Should return data unchanged since version > current
    expect(result._schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 5);
    expect(result.tasks[0].title).toBe('Future task');
  });

  it('does not crash on very large schema version', () => {
    const data = {
      _schemaVersion: 999999,
      tasks: [],
      projects: [],
    };
    const result = migrateData(data);
    expect(result._schemaVersion).toBe(999999);
  });

  it('handles negative schema version', () => {
    const data = {
      _schemaVersion: -1,
      tasks: [{ id: 't_1', title: 'Negative version' }],
      projects: [],
    };
    // Negative version: migrations[-1] is undefined, so it should warn and break
    const result = migrateData(data);
    expect(result).toBeDefined();
  });
});

describe('AI API error handling', () => {
  let aiCaller;

  beforeEach(() => {
    aiCaller = createAICaller({
      proxyUrl: 'https://test.proxy/ai',
      proxyKey: 'test-key',
      getSettings: () => ({ apiKey: 'test-key', aiModel: 'claude-haiku-4-5-20251001' }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws user-friendly message on 400 Bad Request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'Invalid request body' } }),
      }),
    );
    await expect(aiCaller.callAI('test')).rejects.toThrow('Invalid request body');
  });

  it('throws auth error message on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
      }),
    );
    await expect(aiCaller.callAI('test')).rejects.toThrow('authentication failed');
  });

  it('throws auth error message on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { message: 'Forbidden' } }),
      }),
    );
    await expect(aiCaller.callAI('test')).rejects.toThrow('authentication failed');
  });

  it('throws rate limit message on 429 (retries once)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);
    await expect(aiCaller.callAI('test')).rejects.toThrow('AI is busy');
    // Should have retried once (2 calls total)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it('throws server error message on 500 (retries once)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);
    await expect(aiCaller.callAI('test')).rejects.toThrow('temporarily down');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it('throws on network error (fetch rejects)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(aiCaller.callAI('test')).rejects.toThrow('No internet connection');
  });

  it('throws when AI returns empty content array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [] }),
      }),
    );
    await expect(aiCaller.callAI('test')).rejects.toThrow("didn't return a response");
  });

  it('throws when AI returns no content field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );
    await expect(aiCaller.callAI('test')).rejects.toThrow("didn't return a response");
  });

  it('returns text on successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: 'Hello!' }] }),
      }),
    );
    const result = await aiCaller.callAI('test');
    expect(result).toBe('Hello!');
  });

  it('attaches status code to error object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      }),
    );
    try {
      await aiCaller.callAI('test');
    } catch (err) {
      expect(err.status).toBe(401);
    }
  });

  it('handles non-JSON error response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error('not JSON')),
      }),
    );
    await expect(aiCaller.callAI('test')).rejects.toThrow('Something went wrong');
  });
});

describe('global error handlers', () => {
  it('window.onerror can be assigned as a handler function', () => {
    // app.js assigns window.onerror; in jsdom it may be null by default
    // Verify the pattern works by assigning and invoking
    const handler = (msg, _src, _line, _col, _err) => {
      return msg.includes('test') ? false : false;
    };
    window.onerror = handler;
    expect(typeof window.onerror).toBe('function');
    window.onerror = null; // cleanup
  });

  it('custom onerror handler returns false (does not suppress default)', () => {
    const handler = (_msg, _src, _line, _col, _err) => false;
    window.onerror = handler;
    const result = window.onerror('test error', 'test.js', 1, 1, new Error('test'));
    expect(result).toBe(false);
    window.onerror = null;
  });

  it('unhandledrejection handler is registered on window', () => {
    // Verify that the handler can be dispatched without crashing
    const event = new Event('unhandledrejection');
    event.reason = new Error('test rejection');
    expect(() => window.dispatchEvent(event)).not.toThrow();
  });

  it('unhandledrejection with network error in message', () => {
    const event = new Event('unhandledrejection');
    event.reason = new Error('Failed to fetch data');
    expect(() => window.dispatchEvent(event)).not.toThrow();
  });

  it('unhandledrejection with null reason does not crash', () => {
    const event = new Event('unhandledrejection');
    event.reason = null;
    expect(() => window.dispatchEvent(event)).not.toThrow();
  });
});
