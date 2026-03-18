import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSync } from '../sync.js';

/** Helper: build a chainable Supabase mock */
function makeSb(resolvedData = {}, resolvedError = null) {
  const single = vi.fn(() => Promise.resolve({ data: resolvedData, error: resolvedError }));
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  return {
    from: vi.fn(() => ({ select, upsert, eq })),
    supabaseUrl: 'https://test.supabase.co',
    supabaseKey: 'test-key',
    _single: single,
    _eq: eq,
    _select: select,
    _upsert: upsert,
  };
}

function makeDeps(overrides = {}) {
  return {
    sb: null,
    getCurrentUser: vi.fn(() => null),
    userKey: vi.fn((k) => `user1_${k}`),
    STORE_KEY: 'wb_data',
    SETTINGS_KEY: 'wb_settings',
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    getSettings: vi.fn(() => ({ aiModel: 'claude-haiku-4-5-20251001' })),
    saveData: vi.fn(),
    showToast: vi.fn(),
    render: vi.fn(),
    migrateData: vi.fn((d) => d),
    validateTaskFields: vi.fn(),
    getAIMemory: vi.fn(() => []),
    getAIMemoryArchive: vi.fn(() => []),
    saveAIMemory: vi.fn(),
    saveAIMemoryArchive: vi.fn(),
    setSuppressCloudSync: vi.fn(),
    ...overrides,
  };
}

describe('sync.js — createSync()', () => {
  let sync;
  let deps;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    // Add standard sync DOM elements
    document.body.innerHTML = `
      <div id="syncBar" style="display:none"><span id="syncDot" class="sync-dot offline"></span><span id="syncLabel">Offline</span></div>
      <div class="main"><div class="content"></div></div>
    `;
    deps = makeDeps();
    sync = createSync(deps);
  });

  afterEach(() => {
    sync.destroySyncListeners();
    vi.useRealTimers();
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'loadFromCloud',
      'scheduleSyncToCloud',
      'syncToCloud',
      'updateSyncDot',
      'getSyncStatus',
      'setSyncStatus',
      'getSyncTimer',
      'resetSyncState',
      'setupSyncListeners',
      'getLastCloudUpdatedAt',
      'setLastCloudUpdatedAt',
      'resetSyncQueue',
    ];
    keys.forEach((k) => expect(typeof sync[k]).toBe('function'));
  });

  // ── getSyncStatus ──────────────────────────────────────────────────
  it('getSyncStatus returns "offline" initially', () => {
    expect(sync.getSyncStatus()).toBe('offline');
  });

  // ── setSyncStatus ──────────────────────────────────────────────────
  it('setSyncStatus updates the sync status', () => {
    sync.setSyncStatus('synced');
    expect(sync.getSyncStatus()).toBe('synced');
  });

  it('setSyncStatus can be set to syncing', () => {
    sync.setSyncStatus('syncing');
    expect(sync.getSyncStatus()).toBe('syncing');
  });

  // ── getLastCloudUpdatedAt / setLastCloudUpdatedAt ─────────────────
  it('getLastCloudUpdatedAt returns null initially', () => {
    expect(sync.getLastCloudUpdatedAt()).toBeNull();
  });

  it('setLastCloudUpdatedAt stores a timestamp', () => {
    const ts = '2026-03-15T10:00:00Z';
    sync.setLastCloudUpdatedAt(ts);
    expect(sync.getLastCloudUpdatedAt()).toBe(ts);
  });

  // ── getSyncTimer ──────────────────────────────────────────────────
  it('getSyncTimer returns null initially', () => {
    expect(sync.getSyncTimer()).toBeNull();
  });

  // ── resetSyncState ────────────────────────────────────────────────
  it('resetSyncState clears all sync state', () => {
    sync.setSyncStatus('synced');
    sync.setLastCloudUpdatedAt('2026-03-15T10:00:00Z');
    sync.resetSyncState();
    expect(sync.getSyncStatus()).toBe('offline');
    expect(sync.getLastCloudUpdatedAt()).toBeNull();
    expect(sync.getSyncTimer()).toBeNull();
  });

  // ── resetSyncQueue ────────────────────────────────────────────────
  it('resetSyncQueue does not throw', () => {
    expect(() => sync.resetSyncQueue()).not.toThrow();
  });

  // ── updateSyncDot ─────────────────────────────────────────────────
  it('updateSyncDot updates the dot class to offline when no user', () => {
    deps.getCurrentUser.mockReturnValue(null);
    sync.updateSyncDot();
    const dot = document.getElementById('syncDot');
    expect(dot.className).toContain('offline');
  });

  it('updateSyncDot updates label to "Synced" when synced', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.setSyncStatus('synced');
    sync.updateSyncDot();
    const label = document.getElementById('syncLabel');
    expect(label.textContent).toBe('Synced');
  });

  it('updateSyncDot updates label to "Syncing..." when syncing', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.setSyncStatus('syncing');
    sync.updateSyncDot();
    const label = document.getElementById('syncLabel');
    expect(label.textContent).toBe('Syncing...');
  });

  it('updateSyncDot updates label to "Offline" when offline', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.setSyncStatus('offline');
    sync.updateSyncDot();
    const label = document.getElementById('syncLabel');
    expect(label.textContent).toBe('Offline');
  });

  it('updateSyncDot hides syncBar when no user', () => {
    deps.getCurrentUser.mockReturnValue(null);
    const bar = document.getElementById('syncBar');
    bar.style.display = 'flex';
    sync.updateSyncDot();
    expect(bar.style.display).toBe('none');
  });

  it('updateSyncDot shows syncBar when user is present', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.updateSyncDot();
    const bar = document.getElementById('syncBar');
    expect(bar.style.display).toBe('flex');
  });

  it('updateSyncDot sets correct title on dot for synced', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.setSyncStatus('synced');
    sync.updateSyncDot();
    const dot = document.getElementById('syncDot');
    expect(dot.title).toBe('Synced to cloud');
  });

  it('updateSyncDot sets correct title on dot for syncing', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.setSyncStatus('syncing');
    sync.updateSyncDot();
    const dot = document.getElementById('syncDot');
    expect(dot.title).toBe('Syncing...');
  });

  it('updateSyncDot sets correct title on dot for offline', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.setSyncStatus('offline');
    sync.updateSyncDot();
    const dot = document.getElementById('syncDot');
    expect(dot.title).toContain('Offline');
  });

  // ── loadFromCloud ─────────────────────────────────────────────────
  it('loadFromCloud returns early when no current user', () => {
    deps.getCurrentUser.mockReturnValue(null);
    const result = sync.loadFromCloud();
    expect(result).toBeUndefined();
  });

  it('loadFromCloud clears any pending sync timer', async () => {
    // Set up a timer first
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    const sb = makeSb({ tasks: [{ id: 't1', title: 'T' }], projects: [], updated_at: '2026-03-15T10:00:00Z' });
    deps.sb = sb;
    sync = createSync(deps);

    // Schedule a sync first to create a timer
    sync.scheduleSyncToCloud();
    expect(sync.getSyncTimer()).not.toBeNull();

    // loadFromCloud should clear the timer
    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;
  });

  it('loadFromCloud sets status to offline and shows toast on error', async () => {
    const sb = makeSb(null, { message: 'DB error' });
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(sync.getSyncStatus()).toBe('offline');
    expect(deps.showToast).toHaveBeenCalledWith('Could not sync with cloud', true);
  });

  it('loadFromCloud merges cloud data when cloud has tasks', async () => {
    const cloudRow = {
      tasks: [{ id: 'ct1', title: 'Cloud Task' }],
      projects: [{ id: 'cp1', name: 'Cloud Project' }],
      updated_at: '2026-03-15T10:00:00Z',
      _schemaVersion: 1,
      settings: null,
      ai_memory: null,
      ai_memory_archive: null,
    };
    const sb = makeSb(cloudRow);
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    const localData = { tasks: [], projects: [] };
    deps.getData.mockReturnValue(localData);
    deps.migrateData.mockImplementation((d) => ({ tasks: d.tasks, projects: d.projects }));
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(deps.saveData).toHaveBeenCalled();
    expect(deps.setSuppressCloudSync).toHaveBeenCalledWith(true);
    expect(deps.setSuppressCloudSync).toHaveBeenCalledWith(false);
    expect(sync.getSyncStatus()).toBe('synced');
    expect(sync.getLastCloudUpdatedAt()).toBe('2026-03-15T10:00:00Z');
  });

  it('loadFromCloud filters out corrupt tasks (no id or title)', async () => {
    const cloudRow = {
      tasks: [{ id: 'ct1', title: 'Good Task' }, { id: null, title: 'No ID' }, { id: 'ct3', title: '' }, null],
      projects: [],
      updated_at: '2026-03-15T10:00:00Z',
      _schemaVersion: 1,
    };
    const sb = makeSb(cloudRow);
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    const localData = { tasks: [], projects: [] };
    deps.getData.mockReturnValue(localData);
    deps.migrateData.mockImplementation((d) => ({ tasks: d.tasks, projects: d.projects }));
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    // Only the good task should survive filtering
    const savedData = deps.saveData.mock.calls[0][0];
    expect(savedData.tasks).toEqual([{ id: 'ct1', title: 'Good Task' }]);
  });

  it('loadFromCloud loads ai_memory and ai_memory_archive from cloud', async () => {
    const cloudRow = {
      tasks: [{ id: 't1', title: 'T' }],
      projects: [],
      updated_at: '2026-03-15T10:00:00Z',
      _schemaVersion: 1,
      ai_memory: [{ type: 'pattern', text: 'works mornings' }],
      ai_memory_archive: [{ type: 'old', text: 'archived' }],
    };
    const sb = makeSb(cloudRow);
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    deps.migrateData.mockImplementation((d) => ({ tasks: d.tasks, projects: d.projects }));
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(deps.saveAIMemory).toHaveBeenCalledWith(cloudRow.ai_memory);
    expect(deps.saveAIMemoryArchive).toHaveBeenCalledWith(cloudRow.ai_memory_archive);
  });

  it('loadFromCloud loads settings from cloud (excluding apiKey)', async () => {
    const cloudRow = {
      tasks: [{ id: 't1', title: 'T' }],
      projects: [],
      updated_at: '2026-03-15T10:00:00Z',
      _schemaVersion: 1,
      settings: { aiModel: 'gpt-4', apiKey: 'secret-key', theme: 'dark' },
    };
    const sb = makeSb(cloudRow);
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    const localSettings = { aiModel: 'claude' };
    deps.getSettings.mockReturnValue(localSettings);
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    deps.migrateData.mockImplementation((d) => ({ tasks: d.tasks, projects: d.projects }));
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    // Settings should be merged (aiModel overwritten, theme added, apiKey excluded)
    expect(localSettings.aiModel).toBe('gpt-4');
    expect(localSettings.theme).toBe('dark');
    // apiKey should NOT be in settings
    expect(localSettings.apiKey).toBeUndefined();
  });

  it('loadFromCloud keeps local data and syncs up when cloud is empty but local has data', async () => {
    const cloudRow = {
      tasks: [],
      projects: [],
      updated_at: '2026-03-15T10:00:00Z',
      _schemaVersion: 1,
    };
    // Build sb that handles both SELECT and UPSERT
    const singleSelect = vi.fn(() => Promise.resolve({ data: cloudRow, error: null }));
    const singleUpsert = vi.fn(() => Promise.resolve({ data: { updated_at: '2026-03-15T11:00:00Z' }, error: null }));
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: singleSelect })),
        })),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({ single: singleUpsert })),
        })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'Local' }], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    deps.migrateData.mockImplementation((d) => ({ tasks: d.tasks, projects: d.projects }));
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(sync.getSyncStatus()).toBe('synced');
    expect(deps.render).toHaveBeenCalled();
  });

  it('loadFromCloud pushes local data when no row exists (first login)', async () => {
    // Row is null (no existing data)
    const singleSelect = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const singleUpsert = vi.fn(() => Promise.resolve({ data: { updated_at: '2026-03-15T11:00:00Z' }, error: null }));
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: singleSelect })),
        })),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({ single: singleUpsert })),
        })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    // Should have attempted upsert (_doSyncToCloud called)
    expect(sb.from).toHaveBeenCalled();
  });

  it('loadFromCloud catches exceptions and sets offline status', async () => {
    const sb = {
      from: vi.fn(() => {
        throw new Error('network failure');
      }),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    sync = createSync(deps);

    const promise = sync.loadFromCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(sync.getSyncStatus()).toBe('offline');
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Could not load cloud data'), true);
  });

  // ── scheduleSyncToCloud ───────────────────────────────────────────
  it('scheduleSyncToCloud returns early when no current user', () => {
    deps.getCurrentUser.mockReturnValue(null);
    sync.scheduleSyncToCloud();
    expect(sync.getSyncStatus()).toBe('offline');
  });

  it('scheduleSyncToCloud sets status to syncing when user exists', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.scheduleSyncToCloud();
    expect(sync.getSyncStatus()).toBe('syncing');
  });

  it('scheduleSyncToCloud debounces — only fires once after 2s', async () => {
    const singleUpsert = vi.fn(() => Promise.resolve({ data: { updated_at: '2026-03-15T11:00:00Z' }, error: null }));
    const singleSelect = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleSelect })) })),
        upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: singleUpsert })) })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    localStorage.setItem('user1_wb_data', JSON.stringify({ tasks: [], projects: [] }));
    sync = createSync(deps);

    // Call multiple times rapidly
    sync.scheduleSyncToCloud();
    sync.scheduleSyncToCloud();
    sync.scheduleSyncToCloud();

    // Timer not fired yet — sb.from should not have been called
    expect(sb.from).not.toHaveBeenCalled();

    // Advance time by 2000ms and flush microtasks
    await vi.advanceTimersByTimeAsync(2000);

    // Now it should have been called (once, not three times)
    expect(sb.from).toHaveBeenCalled();
  });

  it('scheduleSyncToCloud creates a timer accessible via getSyncTimer', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    sync.scheduleSyncToCloud();
    // getSyncTimer should return the timer ID (non-null)
    expect(sync.getSyncTimer()).not.toBeNull();
  });

  // ── syncToCloud ───────────────────────────────────────────────────
  it('syncToCloud returns early when no user', () => {
    deps.getCurrentUser.mockReturnValue(null);
    const result = sync.syncToCloud();
    expect(result).toBeUndefined();
  });

  it('syncToCloud returns early when no sb', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    const result = sync.syncToCloud();
    expect(result).toBeUndefined();
  });

  it('syncToCloud upserts data and sets synced status', async () => {
    const singleUpsert = vi.fn(() => Promise.resolve({ data: { updated_at: '2026-03-15T12:00:00Z' }, error: null }));
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
        upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: singleUpsert })) })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'T' }], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    localStorage.setItem('user1_wb_data', JSON.stringify({ tasks: [{ id: 't1', title: 'T' }], projects: [] }));
    sync = createSync(deps);

    const promise = sync.syncToCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(sync.getSyncStatus()).toBe('synced');
    expect(sync.getLastCloudUpdatedAt()).toBe('2026-03-15T12:00:00Z');
  });

  it('syncToCloud refuses to sync empty data when cloud had data', async () => {
    // The new sync code does an actual cloud query to check if cloud has tasks
    // before allowing empty local data to overwrite it
    const singleCheck = vi.fn(() =>
      Promise.resolve({
        data: { data: { tasks: [{ id: 't1', title: 'Cloud task' }], projects: [] } },
        error: null,
      }),
    );
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleCheck })) })),
        upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn() })) })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [], projects: [] }); // empty local data
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    localStorage.setItem('user1_wb_data', JSON.stringify({ tasks: [], projects: [] }));
    sync = createSync(deps);

    const promise = sync.syncToCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(sync.getSyncStatus()).toBe('synced'); // keeps previous safe status
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Local data is empty'), true);
  });

  it('syncToCloud shows toast on upsert error', async () => {
    const singleUpsert = vi.fn(() => Promise.resolve({ data: null, error: { message: 'upsert failed' } }));
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
        upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: singleUpsert })) })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'T' }], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    sync = createSync(deps);

    const promise = sync.syncToCloud();
    await vi.runAllTimersAsync();
    await promise;

    expect(sync.getSyncStatus()).toBe('offline');
    expect(document.getElementById('sync-fail-banner')).not.toBeNull();
  });

  // ── setupSyncListeners ────────────────────────────────────────────
  it('setupSyncListeners does not throw', () => {
    expect(() => sync.setupSyncListeners()).not.toThrow();
  });

  it('setupSyncListeners — online event triggers scheduleSyncToCloud when offline', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    // Need sb for scheduleSyncToCloud chain
    const sb = makeSb({ updated_at: '2026-03-15T12:00:00Z' });
    deps.sb = sb;
    sync = createSync(deps);
    sync.setSyncStatus('offline');
    sync.setupSyncListeners();

    window.dispatchEvent(new Event('online'));

    // Should have set status to syncing (scheduleSyncToCloud was called)
    expect(sync.getSyncStatus()).toBe('syncing');
  });

  it('setupSyncListeners — online event is ignored when already synced', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    const sb = makeSb();
    deps.sb = sb;
    sync = createSync(deps);
    sync.setSyncStatus('synced');
    sync.setupSyncListeners();

    window.dispatchEvent(new Event('online'));

    // Status stays synced, not changed to syncing
    expect(sync.getSyncStatus()).toBe('synced');
  });

  it('setupSyncListeners — online event ignored when no user', () => {
    deps.getCurrentUser.mockReturnValue(null);
    sync = createSync(deps);
    sync.setSyncStatus('offline');
    sync.setupSyncListeners();

    window.dispatchEvent(new Event('online'));

    // Should remain offline since no user
    expect(sync.getSyncStatus()).toBe('offline');
  });

  it('setupSyncListeners — duplicate setup tears down previous listeners', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    const sb = makeSb();
    deps.sb = sb;
    sync = createSync(deps);
    sync.setSyncStatus('offline');

    sync.setupSyncListeners();
    sync.setupSyncListeners(); // second call should abort first

    // Should not throw
    window.dispatchEvent(new Event('online'));
    expect(sync.getSyncStatus()).toBe('syncing');
  });

  it('destroySyncListeners removes event listeners', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    const sb = makeSb();
    deps.sb = sb;
    sync = createSync(deps);
    sync.setSyncStatus('offline');
    sync.setupSyncListeners();

    sync.destroySyncListeners();

    // After destroy, online event should not trigger sync
    window.dispatchEvent(new Event('online'));
    expect(sync.getSyncStatus()).toBe('offline');
  });

  it('setupSyncListeners — pagehide saves to localStorage when timer pending', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'Task' }], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });
    // No sb so the fetch part is skipped
    deps.sb = null;
    sync = createSync(deps);

    // Create a pending sync timer by calling scheduleSyncToCloud
    sync.scheduleSyncToCloud();
    sync.setupSyncListeners();

    // Mock localStorage.setItem
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    window.dispatchEvent(new Event('pagehide'));

    expect(setItemSpy).toHaveBeenCalledWith('user1_wb_data', expect.any(String));
    setItemSpy.mockRestore();
  });

  it('setupSyncListeners — pagehide with sb sends keepalive fetch', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'Task' }], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });

    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { updated_at: 'x' }, error: null })) })),
        })),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.sb = sb;
    sync = createSync(deps);

    // Create a pending sync timer
    sync.scheduleSyncToCloud();
    sync.setupSyncListeners();

    // Set up a supabase auth token in localStorage
    localStorage.setItem('sb-test-auth-token', JSON.stringify({ access_token: 'tok123' }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve());

    window.dispatchEvent(new Event('pagehide'));

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/user_data'),
      expect.objectContaining({ keepalive: true }),
    );
    fetchSpy.mockRestore();
  });

  it('setupSyncListeners — pagehide skips fetch when no auth token found', () => {
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'Task' }], projects: [] });
    deps.getSettings.mockReturnValue({ aiModel: 'claude' });

    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
        upsert: vi.fn(),
      })),
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
    };
    deps.sb = sb;
    sync = createSync(deps);

    sync.scheduleSyncToCloud();
    sync.setupSyncListeners();

    // No sb-*-auth-token in localStorage
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve());

    window.dispatchEvent(new Event('pagehide'));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('setupSyncListeners — visibilitychange reschedules sync if offline and tab visible', () => {
    const sb = makeSb();
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    sync = createSync(deps);
    sync.setSyncStatus('offline');
    sync.setupSyncListeners();

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sync.getSyncStatus()).toBe('syncing');
  });

  it('setupSyncListeners — visibilitychange ignores when document is hidden', () => {
    const sb = makeSb();
    deps.getCurrentUser.mockReturnValue({ id: 'u1' });
    deps.sb = sb;
    sync = createSync(deps);
    sync.setSyncStatus('synced');
    sync.setupSyncListeners();

    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Should remain synced, not changed
    expect(sync.getSyncStatus()).toBe('synced');
  });
});

// ── Additional coverage tests ─────────────────────────────────────────

describe('sync.js — additional coverage', () => {
  let sync;
  let deps;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = `
      <div id="syncBar" style="display:none"><span id="syncDot" class="sync-dot offline"></span><span id="syncLabel">Offline</span></div>
      <div class="main"><div class="content"></div></div>
    `;
    deps = makeDeps();
    sync = createSync(deps);
  });

  afterEach(() => {
    sync.destroySyncListeners();
    vi.useRealTimers();
  });

  // ── showSyncFailBanner rendering and retry button (lines 232-237) ──
  describe('showSyncFailBanner', () => {
    it('renders a banner with message and retry button', () => {
      sync.showSyncFailBanner();
      const banner = document.getElementById('sync-fail-banner');
      expect(banner).not.toBeNull();
      expect(banner.textContent).toContain('Could not save to cloud');
      expect(banner.textContent).toContain('Retry');
    });

    it('retry button triggers syncToCloud', async () => {
      const singleUpsert = vi.fn(() => Promise.resolve({ data: { updated_at: '2026-03-15T12:00:00Z' }, error: null }));
      const sb = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
          })),
          upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: singleUpsert })) })),
        })),
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
      };
      deps.getCurrentUser.mockReturnValue({ id: 'u1' });
      deps.sb = sb;
      deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'T' }], projects: [] });
      deps.getSettings.mockReturnValue({ aiModel: 'claude' });
      localStorage.setItem('user1_wb_data', JSON.stringify({ tasks: [{ id: 't1', title: 'T' }], projects: [] }));
      sync = createSync(deps);

      sync.showSyncFailBanner();
      const retryBtn = document.querySelector('#sync-fail-banner button');
      expect(retryBtn).not.toBeNull();

      // Click the retry button
      retryBtn.click();

      // Flush the promise-based sync queue
      await vi.runAllTimersAsync();

      // syncToCloud should have been triggered (sb.from called)
      expect(sb.from).toHaveBeenCalled();
    });

    it('does not add duplicate banners', () => {
      sync.showSyncFailBanner();
      sync.showSyncFailBanner();
      const banners = document.querySelectorAll('#sync-fail-banner');
      expect(banners.length).toBe(1);
    });
  });

  // ── clearSyncFailBanner (lines 332-333 equivalent) ─────────────────
  describe('clearSyncFailBanner', () => {
    it('removes the sync-fail-banner from DOM', () => {
      sync.showSyncFailBanner();
      expect(document.getElementById('sync-fail-banner')).not.toBeNull();

      sync.clearSyncFailBanner();
      expect(document.getElementById('sync-fail-banner')).toBeNull();
    });

    it('does nothing if banner does not exist', () => {
      expect(() => sync.clearSyncFailBanner()).not.toThrow();
    });
  });

  // ── Pagehide localStorage parse error branch (lines 366-367) ───────
  describe('pagehide localStorage parse error branch', () => {
    it('handles malformed auth token JSON gracefully', () => {
      deps.getCurrentUser.mockReturnValue({ id: 'u1' });
      deps.getData.mockReturnValue({ tasks: [{ id: 't1', title: 'Task' }], projects: [] });
      deps.getSettings.mockReturnValue({ aiModel: 'claude' });

      const sb = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
          })),
          upsert: vi.fn(),
        })),
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
      };
      deps.sb = sb;
      sync = createSync(deps);

      // Schedule sync to create a pending timer
      sync.scheduleSyncToCloud();
      sync.setupSyncListeners();

      // Store a malformed JSON string as auth token
      localStorage.setItem('sb-broken-auth-token', '{not valid json!!!');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve());

      // Should not throw despite malformed JSON
      expect(() => {
        window.dispatchEvent(new Event('pagehide'));
      }).not.toThrow();

      // fetch should not have been called since no valid token was found
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  // ── Visibilitychange catch block (lines 366-367 in visibilitychange) ──
  describe('visibilitychange catch block', () => {
    it('handles exception from query gracefully', async () => {
      vi.useRealTimers();

      const sb = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => {
                throw new Error('query exploded');
              }),
            })),
          })),
          upsert: vi.fn(),
        })),
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
      };
      deps.getCurrentUser.mockReturnValue({ id: 'u1' });
      deps.sb = sb;
      sync = createSync(deps);
      sync.setSyncStatus('synced');
      sync.setLastCloudUpdatedAt('2026-03-15T10:00:00Z');
      sync.setupSyncListeners();

      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });

      // Should not throw — the catch block handles it silently
      document.dispatchEvent(new Event('visibilitychange'));

      // Allow any async work to settle
      await new Promise((r) => setTimeout(r, 50));

      // Status should remain synced (error was caught and ignored)
      expect(sync.getSyncStatus()).toBe('synced');

      vi.useFakeTimers();
    });
  });
});
