// ============================================================
// SYNC MODULE
// ============================================================
// Extracted from app.js — handles cloud sync, conflict detection, sync UI

/**
 * Factory function to create sync functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ loadFromCloud, scheduleSyncToCloud, syncToCloud, updateSyncDot, showConflictBanner, getSyncStatus, setSyncStatus, getSyncTimer, resetSyncState, setupSyncListeners, destroySyncListeners, getLastCloudUpdatedAt, setLastCloudUpdatedAt, getSyncQueue, resetSyncQueue }}
 */
export function createSync(deps) {
  const {
    sb,
    getCurrentUser,
    userKey,
    STORE_KEY,
    SETTINGS_KEY,
    getData,
    getSettings,
    saveData,
    showToast,
    render,
    migrateData,
    validateTaskFields,
    getAIMemory,
    getAIMemoryArchive,
    saveAIMemory,
    saveAIMemoryArchive,
    setSuppressCloudSync,
  } = deps;

  // Module-local state
  // eslint-disable-next-line no-undef
  const _channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('whiteboards_sync') : null;

  if (_channel) {
    _channel.onmessage = (e) => {
      if (e.data.type === 'data_updated') {
        // Another tab synced — reload from localStorage
        try {
          const freshData = JSON.parse(localStorage.getItem(userKey(STORE_KEY)) || '{}');
          if (freshData.tasks && freshData.projects) {
            const data = getData();
            data.tasks = freshData.tasks;
            data.projects = freshData.projects;
            try {
              setSuppressCloudSync(true);
              saveData(data);
            } finally {
              setSuppressCloudSync(false);
            }
            render();
          }
        } catch (_err) {
          console.warn('BroadcastChannel reload failed:', _err);
        }
      }
    };
  }

  let syncStatus = 'offline'; // 'synced' | 'syncing' | 'offline'
  let syncTimer = null;
  let _lastCloudUpdatedAt = null; // track cloud's updated_at for conflict detection
  let _syncQueue = Promise.resolve(); // Promise-based queue to prevent concurrent sync/load operations

  function withSyncLock(fn) {
    _syncQueue = _syncQueue.then(fn).catch((e) => {
      console.error('Sync error:', e);
      // Return resolved so subsequent queued operations can proceed
      return undefined;
    });
    return _syncQueue;
  }

  function loadFromCloud() {
    if (syncTimer) clearTimeout(syncTimer);
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    return withSyncLock(async () => {
      // Show loading indicator
      const mainEl = document.querySelector('.main .content');
      if (mainEl)
        mainEl.innerHTML =
          '<div style="padding:32px"><div style="display:flex;align-items:center;color:var(--text3);font-size:13px;margin-bottom:28px"><div class="spinner" style="margin-right:10px"></div>Loading your data...</div><div class="loading-skeleton"><div class="loading-skeleton-bar"></div><div class="loading-skeleton-bar"></div><div class="loading-skeleton-bar"></div></div></div>';
      try {
        const { data: row, error } = await sb.from('user_data').select('*').eq('user_id', currentUser.id).single();
        if (error && error.code !== 'PGRST116') {
          // PGRST116 = "no rows found" — normal for first-time users
          console.error('Cloud load error:', error);
          syncStatus = 'offline';
          updateSyncDot();
          showToast('Could not sync with cloud', true);
          return;
        }
        const data = getData();
        if (row) {
          // Store cloud's updated_at for conflict detection
          if (row.updated_at) _lastCloudUpdatedAt = row.updated_at;
          // Merge: cloud data wins if it exists and has content
          // Safety: if cloud is empty but local has data, keep local and push it up
          const cloudEmpty = (!row.tasks || row.tasks.length === 0) && (!row.projects || row.projects.length === 0);
          const localHasData = data.tasks.length > 0 || data.projects.length > 0;
          if (cloudEmpty && localHasData) {
            console.warn('[LOAD] Cloud is empty but local has data — keeping local and syncing up.');
            await _doSyncToCloud();
            syncStatus = 'synced';
            updateSyncDot();
            render();
            return;
          }
          const cloudHasTasks = row.tasks && row.tasks.length > 0;
          const cloudHasProjects = row.projects && row.projects.length > 0;
          if (cloudHasTasks || cloudHasProjects) {
            data.tasks = cloudHasTasks ? row.tasks : data.tasks;
            data.projects = cloudHasProjects ? row.projects : data.projects;
          }
          // Migrate cloud data to current schema
          const cloudData = migrateData({
            tasks: data.tasks,
            projects: data.projects,
            _schemaVersion: row._schemaVersion || 0,
          });
          data.tasks = cloudData.tasks;
          data.projects = cloudData.projects;
          // Filter out corrupt tasks
          data.tasks = data.tasks.filter((t) => t && t.id && t.title);
          data.tasks.forEach(validateTaskFields);
          if (row.ai_memory && row.ai_memory.length > 0) saveAIMemory(row.ai_memory);
          if (row.ai_memory_archive && row.ai_memory_archive.length > 0) saveAIMemoryArchive(row.ai_memory_archive);
          // Note: new syncs no longer include apiKey (stays in localStorage only), but load it from cloud for backwards compat
          if (row.settings) {
            const { apiKey: _apiKey, ...safeSettings } = row.settings;
            const settings = getSettings();
            Object.assign(settings, safeSettings);
            localStorage.setItem(userKey(SETTINGS_KEY), JSON.stringify(settings));
          }
          try {
            setSuppressCloudSync(true);
            saveData(data);
          } finally {
            setSuppressCloudSync(false);
          }
          syncStatus = 'synced';
        } else {
          // First login — push local data up
          await _doSyncToCloud();
        }
      } catch (e) {
        console.error('Cloud load failed:', e);
        syncStatus = 'offline';
        updateSyncDot();
        showToast('Could not load cloud data — using local copy', true);
      }
    });
  }

  function scheduleSyncToCloud() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    syncStatus = 'syncing';
    updateSyncDot();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncToCloud(), 2000);
  }

  // Inner sync logic — called within the sync lock (from withSyncLock or directly from loadFromCloud)
  async function _doSyncToCloud() {
    const currentUser = getCurrentUser();
    if (!currentUser || !sb) return;
    syncStatus = 'syncing';
    updateSyncDot();
    try {
      // Conflict detection: check if another tab/device wrote since we last loaded
      if (_lastCloudUpdatedAt) {
        const { data: checkRow, error: checkErr } = await sb
          .from('user_data')
          .select('updated_at')
          .eq('user_id', currentUser.id)
          .single();
        // Conflict check disabled for beta — false positives from rapid deploys
        void checkErr;
        void checkRow;
      }
      const data = JSON.parse(localStorage.getItem(userKey(STORE_KEY)) || '{"tasks":[],"projects":[]}');
      if (!Array.isArray(data.tasks)) data.tasks = [];
      if (!Array.isArray(data.projects)) data.projects = [];
      const settings = getSettings();
      // Safety: never overwrite cloud data with empty state if cloud previously had data
      if (data.tasks.length === 0 && data.projects.length === 0 && _lastCloudUpdatedAt) {
        console.warn('[SYNC] Refusing to sync empty data — cloud had data previously. Skipping.');
        syncStatus = 'synced'; // Keep previous status — data is safe in cloud
        updateSyncDot();
        showToast('Local data is empty — reload to restore from cloud, or use Settings to reset if intentional.', true);
        return;
      }
      const { data: upsertRow, error } = await sb
        .from('user_data')
        .upsert(
          {
            user_id: currentUser.id,
            tasks: data.tasks,
            projects: data.projects,
            ai_memory: getAIMemory(),
            ai_memory_archive: getAIMemoryArchive(),
            settings: { aiModel: settings.aiModel },
          },
          { onConflict: 'user_id' },
        )
        .select('updated_at')
        .single();
      if (error) throw error;
      // Update our tracked timestamp after successful write
      if (upsertRow && upsertRow.updated_at) _lastCloudUpdatedAt = upsertRow.updated_at;
      syncStatus = 'synced';
      if (_channel) _channel.postMessage({ type: 'data_updated', timestamp: Date.now() });
      clearSyncFailBanner();
    } catch (e) {
      console.error('Sync error:', e);
      syncStatus = 'offline';
      showSyncFailBanner();
    } finally {
      updateSyncDot();
    }
  }

  function syncToCloud() {
    const currentUser = getCurrentUser();
    if (!currentUser || !sb) return;
    return withSyncLock(() => _doSyncToCloud());
  }

  function showConflictBanner() {
    // Disabled for beta — was causing persistent false positive banners
  }

  function showSyncFailBanner() {
    let banner = document.getElementById('sync-fail-banner');
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'sync-fail-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:12px;';
    const msg = document.createElement('span');
    msg.textContent = 'Could not save to cloud — changes saved locally';
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.style.cssText =
      'background:#fff;color:#b45309;border:none;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;';
    retryBtn.onclick = () => {
      syncToCloud();
    };
    banner.appendChild(msg);
    banner.appendChild(retryBtn);
    document.body.appendChild(banner);
  }

  function clearSyncFailBanner() {
    const banner = document.getElementById('sync-fail-banner');
    if (banner) banner.remove();
  }

  function updateSyncDot() {
    const currentUser = getCurrentUser();
    const dot = document.getElementById('syncDot');
    const label = document.getElementById('syncLabel');
    const bar = document.getElementById('syncBar');
    if (bar) bar.style.display = currentUser ? 'flex' : 'none';
    if (dot) {
      dot.className = 'sync-dot ' + syncStatus;
      dot.title =
        syncStatus === 'synced'
          ? 'Synced to cloud'
          : syncStatus === 'syncing'
            ? 'Syncing...'
            : 'Offline — using local storage';
    }
    if (label)
      label.textContent = syncStatus === 'synced' ? 'Synced' : syncStatus === 'syncing' ? 'Syncing...' : 'Offline';
  }

  // Set up event listeners for sync reconnection
  let _syncListenersAC = null; // AbortController to allow cleanup of sync listeners
  function setupSyncListeners() {
    // Prevent duplicate registration — tear down previous listeners first
    if (_syncListenersAC) _syncListenersAC.abort();
    _syncListenersAC = new AbortController();
    const signal = _syncListenersAC.signal;

    window.addEventListener(
      'online',
      () => {
        const currentUser = getCurrentUser();
        if (currentUser && syncStatus === 'offline') scheduleSyncToCloud();
      },
      { signal },
    );

    window.addEventListener(
      'pagehide',
      () => {
        const currentUser = getCurrentUser();
        if (syncTimer && currentUser) {
          clearTimeout(syncTimer);
          const data = getData();
          const settings = getSettings();
          try {
            localStorage.setItem(userKey(STORE_KEY), JSON.stringify(data));
          } catch (e) {
            console.warn('pagehide: localStorage save failed:', e);
          }
          if (sb) {
            try {
              // Read access token synchronously from supabase's localStorage session
              let token = null;
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
                  try {
                    const sess = JSON.parse(localStorage.getItem(k));
                    if (sess && sess.access_token) {
                      token = sess.access_token;
                      break;
                    }
                  } catch (_e) {
                    /* ignore parse errors */
                  }
                }
              }
              if (!token) return;
              const payload = JSON.stringify({
                user_id: currentUser.id,
                tasks: data.tasks,
                projects: data.projects,
                ai_memory: getAIMemory(),
                ai_memory_archive: getAIMemoryArchive(),
                settings: { aiModel: settings.aiModel },
              });
              fetch(sb.supabaseUrl + '/rest/v1/user_data?on_conflict=user_id', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + token,
                  apikey: sb.supabaseKey,
                  Prefer: 'resolution=merge-duplicates',
                },
                body: payload,
                keepalive: true,
              });
            } catch (e) {
              console.warn('pagehide: fetch+keepalive failed:', e);
            }
          }
        }
      },
      { signal },
    );

    document.addEventListener(
      'visibilitychange',
      async () => {
        const currentUser = getCurrentUser();
        if (document.hidden || !currentUser || !sb) return;
        // If offline, try to reconnect
        if (syncStatus === 'offline') {
          scheduleSyncToCloud();
          return;
        }
        // Version check disabled for beta — was causing false positive conflict banners
        try {
          void 0;
        } catch (_e) {
          /* no-op */
        }
      },
      { signal },
    );
  }

  function destroySyncListeners() {
    if (_channel) _channel.close();
    if (_syncListenersAC) {
      _syncListenersAC.abort();
      _syncListenersAC = null;
    }
  }

  // State accessors
  function getSyncStatus() {
    return syncStatus;
  }
  function setSyncStatus(v) {
    syncStatus = v;
  }
  function getSyncTimer() {
    return syncTimer;
  }
  function getLastCloudUpdatedAt() {
    return _lastCloudUpdatedAt;
  }
  function setLastCloudUpdatedAt(v) {
    _lastCloudUpdatedAt = v;
  }

  // Reset state (used on sign-out)
  function resetSyncState() {
    if (_channel) _channel.close();
    _lastCloudUpdatedAt = null;
    syncStatus = 'offline';
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  function resetSyncQueue() {
    _syncQueue = Promise.resolve();
  }

  return {
    loadFromCloud,
    scheduleSyncToCloud,
    syncToCloud,
    updateSyncDot,
    showConflictBanner,
    showSyncFailBanner,
    clearSyncFailBanner,
    getSyncStatus,
    setSyncStatus,
    getSyncTimer,
    resetSyncState,
    setupSyncListeners,
    destroySyncListeners,
    getLastCloudUpdatedAt,
    setLastCloudUpdatedAt,
    resetSyncQueue,
  };
}
