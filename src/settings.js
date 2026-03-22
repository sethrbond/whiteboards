// ============================================================
// SETTINGS MODULE
// ============================================================
// Extracted from app.js — handles settings panel, project CRUD,
// data import/export, AI memory management, project background editing

import { MAX_AI_MEMORIES } from './constants.js';
import { MAX_TEMPLATES } from './templates.js';
/**
 * Factory function to create settings functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ openSettings, deleteAIMemory, exportData, importData, editProjectBackground, saveProjectBackground, openNewProject, saveNewProject, openEditProject, saveEditProject, openEditTemplate, saveEditTemplate, syncCalendar }}
 */
export function createSettings(deps) {
  const {
    $,
    esc,
    todayStr,
    getData,
    getSettings,
    setModalLabel,
    pushModalState,
    closeModal,
    trapFocus,
    getTrapFocusCleanup,
    setTrapFocusCleanup,
    _getModalTriggerEl,
    setModalTriggerEl,
    createProject,
    addProject,
    updateProject,
    setView,
    render,
    saveData,
    pushUndo,
    ensureLifeProject,
    showToast,
    getAIMemory,
    saveAIMemory,
    getAIMemoryArchive,
    PROJECT_COLORS,
    _getShowProjectBg,
    setShowProjectBg,
    renderNotificationSettings,
    getTemplates,
    deleteTemplate: _deleteTemplate,
    updateTemplate,
    getStorageUsage,
    cleanupStorage: _cleanupStorage,
    userKey,
  } = deps;

  function _getCalendarUrl() {
    try { return localStorage.getItem(userKey('calendar_ics_url')) || ''; } catch { return ''; }
  }

  function _parseICSEvents(icsText) {
    const today = todayStr();
    const todayNoDash = today.replace(/-/g, '');
    const events = [];
    const blocks = icsText.split('BEGIN:VEVENT');
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i].split('END:VEVENT')[0];
      // Extract DTSTART and DTEND (handle both date-time and date-only formats)
      const startMatch = block.match(/DTSTART[^:]*:(\d{8}T?\d{0,6})/);
      const endMatch = block.match(/DTEND[^:]*:(\d{8}T?\d{0,6})/);
      const summaryMatch = block.match(/SUMMARY[^:]*:(.*)/);
      if (!startMatch) continue;
      const startStr = startMatch[1];
      const startDate = startStr.slice(0, 8);
      // Only include today's events
      if (startDate !== todayNoDash) continue;
      // Parse times (if available)
      let startTime = '00:00';
      let endTime = '23:59';
      if (startStr.length >= 13) {
        startTime = startStr.slice(9, 11) + ':' + startStr.slice(11, 13);
      }
      if (endMatch && endMatch[1].length >= 13) {
        endTime = endMatch[1].slice(9, 11) + ':' + endMatch[1].slice(11, 13);
      }
      const title = summaryMatch ? summaryMatch[1].replace(/\\,/g, ',').replace(/\\n/g, ' ').trim() : 'Event';
      events.push({ start: startTime, end: endTime, title });
    }
    return events;
  }

  async function syncCalendar() {
    const urlInput = $('#fCalendarUrl');
    const statusEl = $('#calSyncStatus');
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
      if (statusEl) statusEl.textContent = 'Please enter a calendar URL';
      return { ok: false, error: 'No URL' };
    }
    // Save URL
    localStorage.setItem(userKey('calendar_ics_url'), url);
    if (statusEl) statusEl.textContent = 'Syncing...';
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      const events = _parseICSEvents(text);
      localStorage.setItem(userKey('calendar_events'), JSON.stringify(events));
      if (statusEl) statusEl.textContent = `Synced ${events.length} event${events.length !== 1 ? 's' : ''} for today`;
      showToast(`Calendar synced: ${events.length} event${events.length !== 1 ? 's' : ''} today`);
      return { ok: true, count: events.length };
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Sync failed: ' + (err.message || 'unknown error');
      showToast('Calendar sync failed', true);
      return { ok: false, error: err.message };
    }
  }

  function _buildStorageHTML() {
    if (typeof getStorageUsage !== 'function') return '';
    const usage = getStorageUsage();
    const usedMB = (usage.usedBytes / 1024 / 1024).toFixed(1);
    const maxMB = 5;
    const pct = Math.min(100, Math.round((usage.usedBytes / (maxMB * 1024 * 1024)) * 100));
    const barColor = pct > 80 ? 'var(--red)' : pct > 60 ? 'var(--orange)' : 'var(--accent)';
    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <label class="form-label" style="margin:0">Storage</label>
        <button class="btn btn-sm" data-action="cleanup-storage" style="font-size:10px">Clean up</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${usedMB} MB of ~${maxMB} MB (${usage.totalKeys} keys)</div>
      <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.3s"></div>
      </div>
      ${pct > 80 ? '<div style="font-size:10px;color:var(--red);margin-top:4px">Storage is getting full. Click "Clean up" to free space.</div>' : ''}
    </div>`;
  }

  function _buildArchiveHTML() {
    const a = getAIMemoryArchive();
    if (!a.length) return '';
    let h =
      '<div style="margin-bottom:16px"><div style="display:flex;align-items:center;margin-bottom:8px"><label class="form-label" style="margin:0">Archived <span style="color:var(--text3);font-weight:400">(' +
      a.length +
      ')</span></label></div><div style="max-height:150px;overflow-y:auto">';
    a.forEach(function (m, i) {
      h +=
        '<div style="display:flex;align-items:start;gap:8px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);margin-bottom:3px;opacity:0.7"><div style="flex:1;font-size:10px;color:var(--text3);line-height:1.3">' +
        esc(m.text || '') +
        ' <span style="opacity:0.5">[' +
        (m.type || 'note') +
        ']</span></div><button class="btn btn-sm" style="flex-shrink:0;font-size:9px;padding:2px 6px;color:var(--accent)" data-action="restore-memory" data-idx="' +
        i +
        '" title="Restore">&#x21A9;</button></div>';
    });
    return h + '</div></div>';
  }

  function _buildTemplatesHTML() {
    const templates = getTemplates ? getTemplates() : [];
    let h =
      '<div style="margin-bottom:16px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><label class="form-label" style="margin:0">Task Templates <span style="color:var(--text3);font-weight:400">(' +
      templates.length +
      '/' +
      MAX_TEMPLATES +
      ')</span></label></div>';
    h +=
      '<p style="font-size:11px;color:var(--text3);margin-bottom:8px">Save reusable task templates with subtasks, priority, and estimates. Use /template in quick add.</p>';
    if (templates.length) {
      h += '<div style="max-height:200px;overflow-y:auto">';
      templates.forEach(function (t) {
        const subtaskCount = t.subtasks ? t.subtasks.length : 0;
        h +=
          '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);margin-bottom:4px">';
        h +=
          '<div style="flex:1"><div style="font-size:12px;color:var(--text);font-weight:500">' + esc(t.name) + '</div>';
        h +=
          '<div style="font-size:10px;color:var(--text3)">' +
          esc(t.priority) +
          (subtaskCount ? ' \u00b7 ' + subtaskCount + ' subtask' + (subtaskCount > 1 ? 's' : '') : '') +
          (t.estimatedMinutes ? ' \u00b7 ' + t.estimatedMinutes + 'min' : '') +
          '</div></div>';
        h +=
          '<button class="btn btn-sm" style="flex-shrink:0;font-size:10px;padding:2px 6px;color:var(--accent)" data-action="edit-template" data-template-id="' +
          t.id +
          '" title="Edit">\u270E</button>';
        h +=
          '<button class="btn btn-sm" style="flex-shrink:0;font-size:10px;padding:2px 6px;color:var(--red)" data-action="delete-template" data-template-id="' +
          t.id +
          '" title="Delete">\u2715</button>';
        h += '</div>';
      });
      h += '</div>';
    } else {
      h +=
        '<div style="font-size:11px;color:var(--text3);padding:8px">No templates yet. Save one from the task editor or use /template in quick add for built-in workflows.</div>';
    }
    h += '</div>';
    return h;
  }

  function openSettings() {
    setModalLabel('Settings');
    const mem = getAIMemory();
    const settings = getSettings();
    const _typeLabels = {
      preference: 'Preferences',
      pattern: 'Patterns',
      context: 'Context',
      correction: 'Corrections',
      rhythm: 'Rhythms',
      reflection: 'Reflections',
      note: 'Notes',
    };
    const _typeOrder = ['correction', 'preference', 'pattern', 'rhythm', 'context', 'reflection', 'note'];
    let memHTML = '';
    if (mem.length) {
      const grouped = {};
      mem.forEach((m, i) => {
        const type = m.type && _typeLabels[m.type] ? m.type : 'note';
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push({ m, i });
      });
      _typeOrder.forEach((type) => {
        if (!grouped[type] || !grouped[type].length) return;
        memHTML += `<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);padding:6px 2px 4px;margin-top:4px">${_typeLabels[type]}</div>`;
        grouped[type].forEach(({ m, i }) => {
          memHTML += `<div style="display:flex;align-items:start;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);margin-bottom:4px">
    <div style="flex:1;font-size:11px;color:var(--text2);line-height:1.4">${esc(typeof m === 'string' ? m : m.text || JSON.stringify(m))}</div>
    <button class="btn btn-sm" style="flex-shrink:0;font-size:10px;padding:2px 6px;color:var(--text3)" data-action="archive-memory" data-idx="${i}" title="Archive">&#x1F4E6;</button>
    <button class="btn btn-sm" style="flex-shrink:0;font-size:10px;padding:2px 6px;color:var(--text3)" data-action="delete-ai-memory" data-idx="${i}" title="Remove">&#x2715;</button>
  </div>`;
        });
      });
    } else {
      memHTML =
        '<div style="font-size:11px;color:var(--text3);padding:8px">No memories yet. AI learns about you as you interact.</div>';
    }

    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" style="max-width:540px" aria-labelledby="modal-title-settings">
    <h2 class="modal-title" id="modal-title-settings">Settings</h2>
    <div class="form-group"><label class="form-label">Claude API Key <span style="color:var(--text3);font-weight:400">(optional)</span></label><div style="position:relative"><input class="form-input" id="fApiKey" type="password" value="${esc(settings.apiKey)}" placeholder="Leave blank to use shared AI" aria-label="Claude API Key" style="font-family:monospace;padding-right:40px"><button type="button" data-action="toggle-api-key-vis" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:4px">show</button></div></div>
    <p style="font-size:11px;color:var(--text3);margin-bottom:16px">Free AI included (shared quota). Add your own key from <a href="https://console.anthropic.com" target="_blank" rel="noopener" style="color:var(--accent)">console.anthropic.com</a> \u2192 API Keys \u2192 Create Key for unlimited personal use. Your key stays on your device and is sent securely through our proxy.</p>
    <div class="form-group"><label class="form-label">AI Model</label><select class="form-input" id="fAiModel" aria-label="AI Model">
      <option value="claude-haiku-4-5"${settings.aiModel === 'claude-haiku-4-5' || !settings.aiModel ? ' selected' : ''}>Haiku 4.5 \u2014 fast, good for daily tasks</option>
      <option value="claude-sonnet-4-6"${settings.aiModel === 'claude-sonnet-4-6' ? ' selected' : ''}>Sonnet 4.6 \u2014 best quality (requires API key)</option>
    </select><p style="font-size:10px;color:var(--text3);margin-top:4px">Haiku is the default for all users. Sonnet 4.6 requires your own API key in the field above.</p></div>

    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <label class="form-label" style="margin:0">Active Memories <span style="color:var(--text3);font-weight:400">(${mem.length}/${MAX_AI_MEMORIES})</span></label>
        ${mem.length ? `<button class="btn btn-sm" style="font-size:10px;color:var(--red)" data-action="confirm-clear-memories">Clear All</button>` : ''}
      </div>
      <p style="font-size:11px;color:var(--text3);margin-bottom:8px">What the AI has learned about you and your work patterns. Remove anything incorrect.</p>
      <div style="max-height:200px;overflow-y:auto">${memHTML}</div>
    </div>
    ${_buildArchiveHTML()}
    ${renderNotificationSettings ? renderNotificationSettings() : ''}
    ${_buildTemplatesHTML()}
    ${_buildStorageHTML()}
    <div style="margin-bottom:16px">
      <label class="form-label">Calendar Integration <span style="color:var(--text3);font-weight:400">(optional)</span></label>
      <p style="font-size:11px;color:var(--text3);margin-bottom:8px">Paste a public .ics calendar URL (Google Calendar: Settings &rarr; calendar &rarr; Public address in iCal format) to sync today's events. Helps the Focus Card suggest tasks that fit your schedule.</p>
      <input class="form-input" id="fCalendarUrl" type="url" value="${esc(_getCalendarUrl())}" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" style="font-size:12px;margin-bottom:8px">
      <button class="btn btn-sm" data-action="sync-calendar">Sync Calendar</button>
      <span id="calSyncStatus" style="font-size:11px;color:var(--text3);margin-left:8px"></span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-sm" data-action="export-data">Export JSON</button>
      <button class="btn btn-sm" data-action="export-calendar">Export to Calendar (.ics)</button>
      <button class="btn btn-sm" data-action="import-click">Import</button>
      <input type="file" id="importFile" accept=".json" style="display:none" data-onchange-action="import-data">
      <button class="btn btn-sm btn-danger" data-action="confirm-reset-data">Reset All Data</button>
      <button class="btn btn-sm btn-danger" data-action="delete-account" style="margin-left:4px">Delete Account</button>
    </div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-settings">Save</button></div>
    <div style="text-align:center;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="margin-bottom:8px"><button class="btn btn-sm" data-action="show-tips-again" style="font-size:10px;color:var(--text3)">Show feature tips again</button></div>
      <div style="font-size:10px;color:var(--text3)">Whiteboards v1.0 &middot; <a data-action="show-privacy" style="color:var(--text3);cursor:pointer;text-decoration:underline">Privacy</a> &middot; <a data-action="show-terms" style="color:var(--text3);cursor:pointer;text-decoration:underline">Terms</a></div>
    </div>
  </div></div>`;
    pushModalState('settings');
    setTimeout(() => {
      const m = $('#modalRoot').querySelector('.modal-overlay');
      if (m) {
        const cleanup = getTrapFocusCleanup();
        if (cleanup) cleanup();
        setTrapFocusCleanup(trapFocus(m));
      }
    }, 0);
  }

  function deleteAIMemory(index) {
    const mem = getAIMemory();
    mem.splice(index, 1);
    saveAIMemory(mem);
    openSettings(); // re-render
  }

  function exportData() {
    const data = getData();
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.href = url;
    a.download = `whiteboards-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData(input) {
    const file = input.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result);
        if (!d.tasks || !Array.isArray(d.tasks)) {
          showToast('Invalid file format', true);
          return;
        }
        if (d.tasks.length > 10000) {
          showToast('Import too large (max 10,000 tasks)', true);
          return;
        }
        if (d.projects && d.projects.length > 10000) {
          showToast('Import too large (max 10,000 boards)', true);
          return;
        }
        const validTasks = d.tasks.every((t) => t && typeof t.id === 'string' && typeof t.title === 'string');
        if (!validTasks) {
          showToast('Invalid task data: tasks must have id and title strings', true);
          return;
        }
        // Sanitize: strip any HTML tags from imported strings (data is escaped at render time)
        const stripTags = (v) => {
          if (typeof v === 'string') return v.replace(/<[^>]*>/g, '');
          if (Array.isArray(v)) return v.map(stripTags);
          if (v && typeof v === 'object') {
            const clean = {};
            for (const [key, val] of Object.entries(v)) {
              clean[key] = stripTags(val);
            }
            return clean;
          }
          return v;
        };
        d.tasks = d.tasks.map((t) => {
          const clean = {};
          for (const [k, v] of Object.entries(t)) {
            clean[k] = stripTags(v);
          }
          return clean;
        });
        if (d.projects && Array.isArray(d.projects)) {
          d.projects = d.projects.map((p) => {
            const clean = {};
            for (const [k, v] of Object.entries(p)) {
              clean[k] = stripTags(v);
            }
            return clean;
          });
        }
        pushUndo('Import data');
        saveData(d, true); // pass imported data and flag to replace
        ensureLifeProject();
        render();
        showToast('Imported');
      } catch {
        showToast('Invalid file', true);
      }
    };
    r.readAsText(file);
  }

  function editProjectBackground(projectId) {
    const data = getData();
    const p = data.projects.find((x) => x.id === projectId);
    if (!p) return;
    const existing = p.background || "## Origin\n\n## Where It's Going\n\n## Roadblocks\n\n## Next Steps\n\n## Notes\n";
    $('#modalRoot').innerHTML = `<div class="modal-overlay" data-action="close-modal-root" data-click-self="true">
    <div class="modal" style="max-width:560px" aria-labelledby="modal-title-edit-bg">
      <h2 class="modal-title" id="modal-title-edit-bg">Edit Board Background</h2>
      <div style="margin-bottom:8px;font-size:11px;color:var(--text3)">Use ## headers: Origin, Where It's Going, Roadblocks, Next Steps, Notes</div>
      <textarea id="bgEditor" class="form-input" style="height:280px;font-size:12px;line-height:1.6;font-family:inherit;resize:vertical" aria-label="Board background document">${esc(existing)}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn" data-action="close-modal-root">Cancel</button>
        <button class="btn btn-primary" data-action="save-project-bg" data-project-id="${esc(p.id)}">Save</button>
      </div>
    </div>
  </div>`;
  }

  function saveProjectBackground(projectId) {
    const val = document.getElementById('bgEditor').value;
    updateProject(projectId, { background: val });
    setShowProjectBg(projectId, true);
    $('#modalRoot').innerHTML = '';
    render();
    showToast('Background saved');
  }

  function openNewProject() {
    setModalTriggerEl(document.activeElement);
    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" aria-labelledby="modal-title-new-board">
    <h2 class="modal-title" id="modal-title-new-board">New Board</h2>
    <div class="form-group"><label class="form-label" for="fName">Name</label><input class="form-input" id="fName" placeholder="e.g. App Redesign, Health, Side Hustle" autofocus required></div>
    <div class="form-group"><label class="form-label" for="fDesc">Description</label><textarea class="form-textarea" id="fDesc" placeholder="What is this project about? Background, goals, context..."></textarea></div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-new-project">Create</button></div>
  </div></div>`;
    const _npModal = $('#modalRoot').querySelector('.modal-overlay');
    if (_npModal) {
      const cleanup = getTrapFocusCleanup();
      if (cleanup) cleanup();
      setTrapFocusCleanup(trapFocus(_npModal));
    }
    $('#fName').focus();
    $('#fName').onkeydown = (e) => {
      if (e.key === 'Enter') saveNewProject();
    };
  }

  function saveNewProject() {
    const name = $('#fName').value.trim();
    if (!name) return;
    const p = createProject({ name, description: $('#fDesc').value.trim() });
    addProject(p);
    closeModal();
    setView('project', p.id);
  }

  function openEditProject(id) {
    setModalLabel('Edit board');
    const data = getData();
    const p = data.projects.find((x) => x.id === id);
    if (!p) return;
    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" aria-labelledby="modal-title-edit-board">
    <h2 class="modal-title" id="modal-title-edit-board">Edit Board</h2>
    <div class="form-group"><label class="form-label" for="fName">Name</label><input class="form-input" id="fName" value="${esc(p.name)}"></div>
    <div class="form-group"><label class="form-label" for="fDesc">Description</label><textarea class="form-textarea" id="fDesc">${esc(p.description)}</textarea></div>
    <div class="form-group"><label class="form-label" for="fColors">Color</label><div style="display:flex;gap:6px" id="fColors">${PROJECT_COLORS.map((c) => `<div style="width:24px;height:24px;border-radius:6px;background:${c};cursor:pointer;border:2px solid ${c === p.color ? '#fff' : 'transparent'}" data-action="pick-color" data-color="${c}" ${c === p.color ? 'data-picked="1"' : ''} role="button" tabindex="0" aria-label="Select color ${c}"></div>`).join('')}</div></div>
    <div class="modal-actions">
      <button class="btn btn-danger btn-sm" data-action="confirm-delete-project" data-project-id="${esc(p.id)}">Delete Project</button>
      <div style="flex:1"></div>
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-edit-project" data-project-id="${esc(p.id)}">Save</button>
    </div>
  </div></div>`;
    setTimeout(() => {
      const m = $('#modalRoot').querySelector('.modal-overlay');
      if (m) {
        const cleanup = getTrapFocusCleanup();
        if (cleanup) cleanup();
        setTrapFocusCleanup(trapFocus(m));
      }
    }, 0);
  }

  function saveEditProject(id) {
    const data = getData();
    const p = data.projects.find((x) => x.id === id);
    const picked = document.querySelector('#fColors [data-picked="1"]');
    updateProject(id, {
      name: $('#fName').value.trim(),
      description: $('#fDesc').value.trim(),
      color: picked ? picked.dataset.color : p.color,
    });
    closeModal();
    render();
  }

  function openEditTemplate(templateId) {
    const templates = getTemplates ? getTemplates() : [];
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    const data = getData();
    const projOpts = data.projects
      .map(
        (p) =>
          '<option value="' + p.id + '"' + (tmpl.project === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>',
      )
      .join('');
    $('#modalRoot').innerHTML =
      '<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" style="max-width:480px" aria-labelledby="modal-title-edit-template">' +
      '<h2 class="modal-title" id="modal-title-edit-template">Edit Template</h2>' +
      '<div class="form-group"><label class="form-label" for="fTmplName">Name</label><input class="form-input" id="fTmplName" value="' +
      esc(tmpl.name) +
      '"></div>' +
      '<div class="form-group"><label class="form-label" for="fTmplPriority">Priority</label><select class="form-select" id="fTmplPriority"><option value="urgent"' +
      (tmpl.priority === 'urgent' ? ' selected' : '') +
      '>Urgent</option><option value="important"' +
      (tmpl.priority === 'important' ? ' selected' : '') +
      '>Important</option><option value="normal"' +
      (tmpl.priority === 'normal' ? ' selected' : '') +
      '>Normal</option><option value="low"' +
      (tmpl.priority === 'low' ? ' selected' : '') +
      '>Low</option></select></div>' +
      '<div class="form-group"><label class="form-label" for="fTmplProject">Default Project</label><select class="form-select" id="fTmplProject"><option value="">None</option>' +
      projOpts +
      '</select></div>' +
      '<div class="form-group"><label class="form-label" for="fTmplEstimate">Estimated Minutes</label><input class="form-input" id="fTmplEstimate" type="number" min="0" value="' +
      (tmpl.estimatedMinutes || 0) +
      '"></div>' +
      '<div class="form-group"><label class="form-label" for="fTmplSubtasks">Subtasks (one per line)</label><textarea class="form-textarea" id="fTmplSubtasks" rows="4">' +
      esc((tmpl.subtasks || []).join('\n')) +
      '</textarea></div>' +
      '<div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-edit-template" data-template-id="' +
      esc(tmpl.id) +
      '">Save</button></div>' +
      '</div></div>';
    pushModalState('edit-template');
    setTimeout(function () {
      const m = $('#modalRoot').querySelector('.modal-overlay');
      if (m) {
        const cleanup = getTrapFocusCleanup();
        if (cleanup) cleanup();
        setTrapFocusCleanup(trapFocus(m));
      }
    }, 0);
  }

  function saveEditTemplate(templateId) {
    const name = ($('#fTmplName') || {}).value;
    if (!name || !name.trim()) return;
    const subtasksRaw = ($('#fTmplSubtasks') || {}).value || '';
    const subtasks = subtasksRaw
      .split('\n')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    updateTemplate(templateId, {
      name: name.trim(),
      priority: ($('#fTmplPriority') || {}).value || 'normal',
      project: ($('#fTmplProject') || {}).value || '',
      estimatedMinutes: parseInt(($('#fTmplEstimate') || {}).value) || 0,
      subtasks: subtasks,
    });
    closeModal();
    showToast('Template updated', false, true);
    openSettings();
  }

  return {
    openSettings,
    deleteAIMemory,
    exportData,
    importData,
    editProjectBackground,
    saveProjectBackground,
    openNewProject,
    saveNewProject,
    openEditProject,
    saveEditProject,
    openEditTemplate,
    saveEditTemplate,
    syncCalendar,
  };
}
