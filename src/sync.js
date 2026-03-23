// ============================================================
// SYNC MODULE
// ============================================================
// Handles cloud sync, conflict detection, tombstone-aware merging,
// Supabase Realtime subscriptions, and sync status UI.

/**
 * Factory function to create sync functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ loadFromCloud, scheduleSyncToCloud, syncToCloud, updateSyncDot, getSyncStatus, setSyncStatus, getSyncTimer, resetSyncState, setupSyncListeners, destroySyncListeners, getLastCloudUpdatedAt, setLastCloudUpdatedAt, getSyncQueue, resetSyncQueue, showSyncFailBanner, clearSyncFailBanner, subscribeRealtime, unsubscribeRealtime, isSyncPending }}
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
    getTombstones,
    setTombstones,
  } = deps;

  // Module-local state
  // eslint-disable-next-line no-undef
  const _channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('whiteboards_sync') : null;

  // Unique tab ID to distinguish our own writes from other devices
  const _tabId = 'tab_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();

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
            if (Array.isArray(freshData._tombstones)) data._tombstones = freshData._tombstones;
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

  let syncStatus = 'offline'; // 'synced' | 'syncing' | 'pending' | 'offline'
  let syncTimer = null;
  let _lastCloudUpdatedAt = null; // track cloud's updated_at for conflict detection
  let _lastSyncedAt = null; // timestamp of last successful sync for UI display
  let _syncQueue = Promise.resolve(); // Promise-based queue to prevent concurrent sync/load operations
  let _syncPending = false; // true when local changes exist but haven't been confirmed in cloud
  let _realtimeSubscription = null; // Supabase Realtime channel

  function withSyncLock(fn) {
    _syncQueue = _syncQueue.then(fn).catch((e) => {
      console.error('Sync error:', e);
      // Return resolved so subsequent queued operations can proceed
      return undefined;
    });
    return _syncQueue;
  }

  // --- Tombstone helpers for merge ---
  function _mergeTombstones(localTombstones, cloudTombstones) {
    const map = new Map();
    const local = Array.isArray(localTombstones) ? localTombstones : [];
    const cloud = Array.isArray(cloudTombstones) ? cloudTombstones : [];
    for (const ts of local) {
      if (ts && ts.id) map.set(ts.id, ts);
    }
    for (const ts of cloud) {
      if (ts && ts.id && !map.has(ts.id)) map.set(ts.id, ts);
    }
    return Array.from(map.values());
  }

  function _applyTombstones(tasks, projects, tombstones) {
    if (!Array.isArray(tombstones) || tombstones.length === 0) return { tasks, projects };
    const tombstoneIds = new Set(tombstones.map((ts) => ts.id));
    return {
      tasks: tasks.filter((t) => !tombstoneIds.has(t.id)),
      projects: projects.filter((p) => !tombstoneIds.has(p.id)),
    };
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
            _syncPending = false;
            updateSyncDot();
            render();
            // Subscribe to realtime after successful load
            subscribeRealtime();
            return;
          }

          // --- Tombstone-aware merge ---
          const localTombstones = getTombstones ? getTombstones() : [];
          const cloudTombstones = Array.isArray(row._tombstones) ? row._tombstones : [];
          const mergedTombstones = _mergeTombstones(localTombstones, cloudTombstones);
          // MERGE by ID — compare updatedAt timestamps, keep the NEWER version
          const cloudTasks = (row.tasks || []).filter((t) => t && t.id);
          const cloudProjects = (row.projects || []).filter((p) => p && p.id);
          if (cloudTasks.length > 0 || data.tasks.length > 0) {
            const cloudTaskMap = new Map(cloudTasks.map((t) => [t.id, t]));
            const localTaskMap = new Map(data.tasks.filter((t) => t && t.id).map((t) => [t.id, t]));
            const mergedTasks = [];
            // All IDs from both sides
            const allTaskIds = new Set([...cloudTaskMap.keys(), ...localTaskMap.keys()]);
            for (const id of allTaskIds) {
              const cloud = cloudTaskMap.get(id);
              const local = localTaskMap.get(id);
              if (cloud && !local) {
                mergedTasks.push(cloud); // only in cloud
              } else if (local && !cloud) {
                mergedTasks.push(local); // only in local
              } else {
                // Both exist — compare updatedAt, keep newer
                const cloudTime = cloud.updatedAt ? new Date(cloud.updatedAt).getTime() : 0;
                const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
                mergedTasks.push(localTime >= cloudTime ? local : cloud);
              }
            }
            data.tasks = mergedTasks;
          }
          if (cloudProjects.length > 0 || data.projects.length > 0) {
            const cloudProjMap = new Map(cloudProjects.map((p) => [p.id, p]));
            const localProjMap = new Map(data.projects.filter((p) => p && p.id).map((p) => [p.id, p]));
            const mergedProjects = [];
            const allProjIds = new Set([...cloudProjMap.keys(), ...localProjMap.keys()]);
            for (const id of allProjIds) {
              const cloud = cloudProjMap.get(id);
              const local = localProjMap.get(id);
              if (cloud && !local) {
                mergedProjects.push(cloud);
              } else if (local && !cloud) {
                mergedProjects.push(local);
              } else {
                const cloudTime = cloud.updatedAt ? new Date(cloud.updatedAt).getTime() : 0;
                const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
                mergedProjects.push(localTime >= cloudTime ? local : cloud);
              }
            }
            data.projects = mergedProjects;
          }
          // Apply tombstones: deletion wins over resurrection
          const cleaned = _applyTombstones(data.tasks, data.projects, mergedTombstones);
          data.tasks = cleaned.tasks;
          data.projects = cleaned.projects;

          // Store merged tombstones
          if (setTombstones) setTombstones(mergedTombstones);
          data._tombstones = mergedTombstones;

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
          // Load pre-computed daily plan from cloud (v7: AI plans overnight)
          if (row.daily_plan && row.daily_plan.date) {
            const planDate = row.daily_plan.date;
            const today = new Date().toISOString().slice(0, 10);
            if (planDate === today) {
              const planKey = userKey('whiteboard_plan_' + today);
              const existingPlan = localStorage.getItem(planKey);
              // Only apply cloud plan if no local plan exists yet
              if (!existingPlan) {
                const planData = row.daily_plan.blocks
                  ? { blocks: row.daily_plan.blocks }
                  : row.daily_plan.tasks || [];
                localStorage.setItem(planKey, JSON.stringify(planData));
                if (row.daily_plan.narrative) {
                  localStorage.setItem(userKey('whiteboard_narrative_' + today), row.daily_plan.narrative);
                }
                // Store follow-ups for Focus Card
                if (row.daily_plan.followUps && row.daily_plan.followUps.length) {
                  localStorage.setItem(userKey('whiteboard_followups_' + today), JSON.stringify(row.daily_plan.followUps));
                }
              }
            }
          }
          try {
            setSuppressCloudSync(true);
            saveData(data);
          } finally {
            setSuppressCloudSync(false);
          }
          // Push merged result back to cloud so both sides converge
          await _doSyncToCloud();
          syncStatus = 'synced';
          _syncPending = false;
        } else {
          // First login — push local data up
          await _doSyncToCloud();
        }
        _lastSyncedAt = Date.now();
        // Subscribe to realtime after successful load
        subscribeRealtime();
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
    _syncPending = true;
    syncStatus = 'pending';
    updateSyncDot();
    clearTimeout(syncTimer);
    // Short debounce (500ms) to batch rapid edits, but short enough
    // that data reaches cloud before user can close the tab
    syncTimer = setTimeout(() => syncToCloud(), 500);
  }

  // Inner sync logic — called within the sync lock (from withSyncLock or directly from loadFromCloud)
  // Returns true on success, false on failure
  async function _doSyncToCloud() {
    const currentUser = getCurrentUser();
    if (!currentUser || !sb) return false;
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
        if (!checkErr && checkRow && checkRow.updated_at) {
          const cloudTime = new Date(checkRow.updated_at).getTime();
          const lastKnown = new Date(_lastCloudUpdatedAt).getTime();
          if (cloudTime - lastKnown > 60000) {
            showToast('Synced from another device');
            if (loadFromCloud) await loadFromCloud();
            syncStatus = 'synced';
            _syncPending = false;
            updateSyncDot();
            return true;
          }
        }
      }
      const data = JSON.parse(localStorage.getItem(userKey(STORE_KEY)) || '{"tasks":[],"projects":[],"_tombstones":[]}');
      if (!Array.isArray(data.tasks)) data.tasks = [];
      if (!Array.isArray(data.projects)) data.projects = [];
      if (!Array.isArray(data._tombstones)) data._tombstones = [];
      const tombstones = getTombstones ? getTombstones() : data._tombstones;
      const settings = getSettings();
      // Safety: NEVER overwrite cloud with empty data — check cloud first
      if (data.tasks.length === 0 && data.projects.length === 0) {
        // Double-check: does cloud actually have data?
        try {
          const { data: cloudCheck } = await sb.from('user_data').select('data').eq('user_id', currentUser.id).single();
          if (cloudCheck && cloudCheck.data) {
            const cloudData = typeof cloudCheck.data === 'string' ? JSON.parse(cloudCheck.data) : cloudCheck.data;
            if (cloudData.tasks && cloudData.tasks.length > 0) {
              console.warn(
                '[SYNC] Refusing to overwrite',
                cloudData.tasks.length,
                'cloud tasks with empty local data.',
              );
              syncStatus = 'synced';
              _syncPending = false;
              updateSyncDot();
              showToast('Local data is empty — reload to restore from cloud.', true);
              return false;
            }
          }
        } catch (_e) {
          // If cloud check fails, err on side of caution — don't sync empty
          console.warn('[SYNC] Cloud check failed, refusing to sync empty data.');
          syncStatus = 'synced';
          updateSyncDot();
          return false;
        }
      }
      const { data: upsertRow, error } = await sb
        .from('user_data')
        .upsert(
          {
            user_id: currentUser.id,
            tasks: data.tasks,
            projects: data.projects,
            _tombstones: Array.isArray(tombstones) ? tombstones : [],
            _tabId: _tabId,
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
      _syncPending = false;
      _lastSyncedAt = Date.now();
      if (_channel) _channel.postMessage({ type: 'data_updated', timestamp: Date.now() });
      clearSyncFailBanner();
      return true;
    } catch (e) {
      console.error('Sync error:', e);
      syncStatus = 'offline';
      _syncPending = true;
      showSyncFailBanner();
      return false;
    } finally {
      updateSyncDot();
    }
  }

  // Returns a Promise<boolean> — true on success, false on failure
  function syncToCloud() {
    const currentUser = getCurrentUser();
    if (!currentUser || !sb) return Promise.resolve(false);
    return withSyncLock(() => _doSyncToCloud());
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

  // --- Enhanced sync status indicator ---
  function updateSyncDot() {
    const currentUser = getCurrentUser();
    const dot = document.getElementById('syncDot');
    const label = document.getElementById('syncLabel');
    const bar = document.getElementById('syncBar');
    if (bar) bar.style.display = currentUser ? 'flex' : 'none';
    if (dot) {
      dot.className = 'sync-dot ' + syncStatus;
      const titles = {
        synced: 'Synced to cloud',
        syncing: 'Syncing...',
        pending: 'Changes pending sync',
        offline: 'Offline — using local storage',
      };
      let title = titles[syncStatus] || 'Offline — using local storage';
      // Append "Last synced: X ago" on hover
      if (_lastSyncedAt) {
        const agoMs = Date.now() - _lastSyncedAt;
        const agoSec = Math.floor(agoMs / 1000);
        let agoStr;
        if (agoSec < 60) agoStr = 'just now';
        else if (agoSec < 3600) agoStr = Math.floor(agoSec / 60) + 'm ago';
        else if (agoSec < 86400) agoStr = Math.floor(agoSec / 3600) + 'h ago';
        else agoStr = Math.floor(agoSec / 86400) + 'd ago';
        title += '\nLast synced: ' + agoStr;
      }
      dot.title = title;
    }
    if (label) {
      const labels = {
        synced: 'Synced',
        syncing: 'Syncing...',
        pending: 'Pending',
        offline: 'Offline',
      };
      label.textContent = labels[syncStatus] || 'Offline';
    }
  }

  // --- Supabase Realtime subscription ---
  function subscribeRealtime() {
    const currentUser = getCurrentUser();
    if (!currentUser || !sb || _realtimeSubscription) return;

    // Supabase Realtime: subscribe to changes on our user_data row
    try {
      const channelName = 'user_data_' + currentUser.id.slice(0, 8);
      _realtimeSubscription = sb
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'user_data',
            filter: 'user_id=eq.' + currentUser.id,
          },
          async (payload) => {
            try {
              const newRow = payload.new;
              if (!newRow) return;

              // Ignore our own writes
              if (newRow._tabId === _tabId) return;

              // Check if the update is newer than what we know
              if (newRow.updated_at && _lastCloudUpdatedAt) {
                const cloudTime = new Date(newRow.updated_at).getTime();
                const lastKnown = new Date(_lastCloudUpdatedAt).getTime();
                if (cloudTime <= lastKnown) return; // not newer
              }

              // Trigger background merge
              await _mergeFromRealtime(newRow);
            } catch (e) {
              console.warn('Realtime handler error:', e);
            }
          },
        )
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription failed:', e);
    }
  }

  async function _mergeFromRealtime(newRow) {
    // Load new cloud data and merge with local using same logic
    const data = getData();
    const cloudTasks = (newRow.tasks || []).filter((t) => t && t.id);
    const cloudProjects = (newRow.projects || []).filter((p) => p && p.id);
    const cloudTombstones = Array.isArray(newRow._tombstones) ? newRow._tombstones : [];
    const localTombstones = getTombstones ? getTombstones() : [];
    const mergedTombstones = _mergeTombstones(localTombstones, cloudTombstones);

    // Merge tasks by updatedAt
    if (cloudTasks.length > 0 || data.tasks.length > 0) {
      const cloudTaskMap = new Map(cloudTasks.map((t) => [t.id, t]));
      const localTaskMap = new Map(data.tasks.filter((t) => t && t.id).map((t) => [t.id, t]));
      const mergedTasks = [];
      const allTaskIds = new Set([...cloudTaskMap.keys(), ...localTaskMap.keys()]);
      for (const id of allTaskIds) {
        const cloud = cloudTaskMap.get(id);
        const local = localTaskMap.get(id);
        if (cloud && !local) {
          mergedTasks.push(cloud);
        } else if (local && !cloud) {
          mergedTasks.push(local);
        } else {
          const cloudTime = cloud.updatedAt ? new Date(cloud.updatedAt).getTime() : 0;
          const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
          mergedTasks.push(localTime >= cloudTime ? local : cloud);
        }
      }
      data.tasks = mergedTasks;
    }

    // Merge projects by updatedAt
    if (cloudProjects.length > 0 || data.projects.length > 0) {
      const cloudProjMap = new Map(cloudProjects.map((p) => [p.id, p]));
      const localProjMap = new Map(data.projects.filter((p) => p && p.id).map((p) => [p.id, p]));
      const mergedProjects = [];
      const allProjIds = new Set([...cloudProjMap.keys(), ...localProjMap.keys()]);
      for (const id of allProjIds) {
        const cloud = cloudProjMap.get(id);
        const local = localProjMap.get(id);
        if (cloud && !local) {
          mergedProjects.push(cloud);
        } else if (local && !cloud) {
          mergedProjects.push(local);
        } else {
          const cloudTime = cloud.updatedAt ? new Date(cloud.updatedAt).getTime() : 0;
          const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
          mergedProjects.push(localTime >= cloudTime ? local : cloud);
        }
      }
      data.projects = mergedProjects;
    }

    // Apply tombstones
    const cleaned = _applyTombstones(data.tasks, data.projects, mergedTombstones);
    data.tasks = cleaned.tasks;
    data.projects = cleaned.projects;
    data._tombstones = mergedTombstones;

    if (setTombstones) setTombstones(mergedTombstones);

    // Filter corrupt tasks
    data.tasks = data.tasks.filter((t) => t && t.id && t.title);
    data.tasks.forEach(validateTaskFields);

    // Update tracked timestamp
    if (newRow.updated_at) _lastCloudUpdatedAt = newRow.updated_at;
    _lastSyncedAt = Date.now();

    // Save and render
    try {
      setSuppressCloudSync(true);
      saveData(data);
    } finally {
      setSuppressCloudSync(false);
    }
    render();
    showToast('Synced from another device');
  }

  function unsubscribeRealtime() {
    if (_realtimeSubscription && sb) {
      try {
        sb.removeChannel(_realtimeSubscription);
      } catch (e) {
        console.warn('Realtime unsubscribe failed:', e);
      }
      _realtimeSubscription = null;
    }
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
        if (currentUser && (syncStatus === 'offline' || _syncPending)) scheduleSyncToCloud();
      },
      { signal },
    );

    window.addEventListener(
      'pagehide',
      () => {
        const currentUser = getCurrentUser();
        // Sync on pagehide if there's a pending timer OR _syncPending flag is set
        if ((syncTimer || _syncPending) && currentUser) {
          clearTimeout(syncTimer);
          const data = getData();
          const settings = getSettings();
          const tombstones = getTombstones ? getTombstones() : [];
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
                _tombstones: Array.isArray(tombstones) ? tombstones : [],
                _tabId: _tabId,
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
        // If offline or pending, try to reconnect
        if (syncStatus === 'offline' || _syncPending) {
          scheduleSyncToCloud();
          return;
        }
        // Check if cloud was updated by another session
        if (!navigator.onLine || !_lastCloudUpdatedAt) return;
        try {
          const { data: row } = await sb.from('user_data').select('updated_at').eq('user_id', currentUser.id).single();
          if (row && row.updated_at) {
            const diff = new Date(row.updated_at).getTime() - new Date(_lastCloudUpdatedAt).getTime();
            if (diff > 60000) {
              showToast('Synced from another device');
              if (loadFromCloud) await loadFromCloud();
            }
          }
        } catch (_e) {
          /* network error — ignore */
        }
      },
      { signal },
    );
  }

  function destroySyncListeners() {
    if (_channel) _channel.close();
    unsubscribeRealtime();
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

  function isSyncPending() {
    return _syncPending;
  }

  // Reset state (used on sign-out)
  function resetSyncState() {
    if (_channel) _channel.close();
    unsubscribeRealtime();
    _lastCloudUpdatedAt = null;
    _lastSyncedAt = null;
    _syncPending = false;
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
    subscribeRealtime,
    unsubscribeRealtime,
    isSyncPending,
  };
}
