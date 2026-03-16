import { MODAL_ANIMATION_MS } from './constants.js';
// ============================================================
// EVENT HANDLER MODULE
// ============================================================
// Extracted from app.js — handles event delegation, keyboard shortcuts,
// modal management, mobile sidebar, and confirmation dialogs.

/**
 * Factory function to create event handler functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ ensureDelegatedListeners, attachListeners, highlightKbRow, trapFocus, pushModalState, closeModal, setModalLabel, openMobileSidebar, closeMobileSidebar, confirmAction, confirmDeleteProject, confirmClearMemories, confirmResetData, getTrapFocusCleanup, setTrapFocusCleanup, getModalTriggerEl, setModalTriggerEl }}
 */
export function createEvents(deps) {
  const {
    $,
    esc,
    findTask,
    updateTask,
    deleteProject,
    setView,
    render,
    showToast,
    filterByTag,
    attachInlineEdit,
    attachBulkListeners,
    saveAIMemory,
    saveAIMemoryArchive,
    syncToCloud,
    loadData,
    ensureLifeProject,
    saveData,
    openSettings,
    STORE_KEY,
    userKey,
  } = deps;

  // --- State ---
  let _delegatedListenersAttached = false;
  let _trapFocusCleanup = null;
  let _closeModalTimer = null;
  let _modalTriggerEl = null;

  // --- Focus trapping for modals ---
  function trapFocus(modalEl) {
    const focusable = modalEl.querySelectorAll(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"]), a[href]',
    );
    if (!focusable.length) return () => {};
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    modalEl.addEventListener('keydown', handler);
    const autoFocusEl = modalEl.querySelector('[autofocus]');
    if (autoFocusEl) {
      autoFocusEl.focus();
    } else {
      first.focus();
    }
    return () => modalEl.removeEventListener('keydown', handler);
  }

  // --- Modal state management ---
  function pushModalState(type) {
    history.pushState({ modal: type }, '');
  }

  function setModalLabel(label) {
    const mr = $('#modalRoot');
    if (!mr) return;
    mr.setAttribute('aria-label', label || 'Dialog');
    // After modal content is rendered, upgrade to aria-labelledby if title ID exists
    requestAnimationFrame(() => {
      const titleEl = mr.querySelector('[id^="modal-title-"]');
      if (titleEl) {
        mr.setAttribute('aria-labelledby', titleEl.id);
        mr.removeAttribute('aria-label');
      }
    });
  }

  function closeModal() {
    if (_trapFocusCleanup) {
      _trapFocusCleanup();
      _trapFocusCleanup = null;
    }
    if (_closeModalTimer) {
      clearTimeout(_closeModalTimer);
      _closeModalTimer = null;
    }
    const overlay = $('#modalRoot').querySelector('.modal-overlay');
    const restoreFocus = () => {
      if (_modalTriggerEl && _modalTriggerEl.isConnected) {
        _modalTriggerEl.focus();
      }
      _modalTriggerEl = null;
    };
    if (overlay) {
      overlay.style.opacity = '0';
      const cp = overlay.querySelector('.cmd-palette');
      if (cp) cp.classList.add('cmd-closing');
      const modal = overlay.querySelector('.modal');
      if (modal) {
        modal.style.transform = 'translateY(8px)';
        modal.style.opacity = '0';
      }
      _closeModalTimer = setTimeout(() => {
        _closeModalTimer = null;
        $('#modalRoot').innerHTML = '';
        restoreFocus();
      }, MODAL_ANIMATION_MS);
    } else {
      $('#modalRoot').innerHTML = '';
      restoreFocus();
    }
  }

  // --- Mobile sidebar ---
  function openMobileSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('mobileOverlay').style.display = 'block';
  }

  function closeMobileSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('mobileOverlay').style.display = 'none';
  }

  // --- Confirmation dialogs ---
  function confirmAction(message) {
    return new Promise((resolve) => {
      let resolved = false;
      const dismiss = (val) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', escHandler);
        if (_trapFocusCleanup) {
          _trapFocusCleanup();
          _trapFocusCleanup = null;
        }
        overlay.remove();
        resolve(val);
      };
      const escHandler = (e) => {
        if (e.key === 'Escape') dismiss(false);
      };
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;animation:fadeIn .15s ease';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:380px;width:90%;box-shadow:var(--shadow-lg)">
        <p style="margin-bottom:20px;line-height:1.5;color:var(--text)">${esc(message)}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-sm" id="_confirmCancel">Cancel</button>
          <button class="btn btn-sm" id="_confirmOk" style="background:var(--red);color:#fff">Confirm</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      document.addEventListener('keydown', escHandler);
      pushModalState('confirm');
      _trapFocusCleanup = trapFocus(overlay);
      overlay.querySelector('#_confirmCancel').onclick = () => dismiss(false);
      overlay.querySelector('#_confirmOk').onclick = () => dismiss(true);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dismiss(false);
      });
      overlay.querySelector('#_confirmCancel').focus();
    });
  }

  async function confirmDeleteProject(id) {
    const ok = await confirmAction('Delete this board and ALL its tasks?');
    if (!ok) return;
    deleteProject(id);
    closeModal();
    setView('dashboard');
  }

  async function confirmClearMemories() {
    const ok = await confirmAction('Clear all AI memories (active + archived)?');
    if (!ok) return;
    saveAIMemory([]);
    saveAIMemoryArchive([]);
    openSettings();
  }

  async function confirmResetData() {
    const ok = await confirmAction('Delete ALL data? This cannot be undone.');
    if (!ok) return;
    localStorage.removeItem(userKey(STORE_KEY));
    const newData = loadData();
    deps.setData(newData);
    ensureLifeProject();
    saveData(deps.getData());
    syncToCloud();
    setView('dashboard');
    closeModal();
    showToast('All data cleared');
  }

  // --- Keyboard navigation helper ---
  function highlightKbRow(rows) {
    const kbIdx = deps.getKbIdx();
    rows.forEach((r, i) => {
      r.style.outline = i === kbIdx ? '2px solid var(--accent)' : '';
      r.style.outlineOffset = i === kbIdx ? '-2px' : '';
    });
    if (rows[kbIdx]) rows[kbIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // --- Delegated event listeners ---
  function ensureDelegatedListeners() {
    if (_delegatedListenersAttached) return;
    _delegatedListenersAttached = true;

    // Single click listener on content area for task/project interactions
    document.addEventListener('click', (e) => {
      // Toggle task complete
      const toggleEl = e.target.closest('[data-toggle]');
      if (toggleEl) {
        e.stopPropagation();
        const id = toggleEl.dataset.toggle;
        const t = findTask(id);
        if (t) {
          const wasDone = t.status === 'done';
          updateTask(id, { status: wasDone ? 'todo' : 'done' });
          if (!wasDone) {
            deps.setExpandedTask(null);
            showToast(`\u2713 ${t.title}`, false, true);
          }
          render();
        }
        return;
      }

      // Project grid card click
      const projCard = e.target.closest('.project-grid-card[data-project]');
      if (projCard) {
        setView('project', projCard.dataset.project);
        return;
      }

      // Sidebar project nav click
      const projNav = e.target.closest('.project-nav-item[data-project]');
      if (projNav) {
        setView('project', projNav.dataset.project);
        return;
      }

      // Tag filter click
      const tagBtn = e.target.closest('.tag-filter-btn');
      if (tagBtn) {
        e.stopPropagation();
        const tag = tagBtn.dataset.tag;
        if (tag != null) filterByTag(tag);
        return;
      }

      // Task row click → expand (must be last — most general)
      const taskEl = e.target.closest('[data-task]');
      if (
        taskEl &&
        !e.target.closest('[data-toggle]') &&
        !e.target.closest('.task-cmd') &&
        !e.target.closest('.btn') &&
        !e.target.closest('[contenteditable]')
      ) {
        const id = taskEl.dataset.task;
        const expandedTask = deps.getExpandedTask();
        deps.setExpandedTask(expandedTask === id ? null : id);
        render();
        return;
      }
    });

    // Delegated keyboard handler for accessibility on data-toggle elements
    document.addEventListener('keydown', (e) => {
      const toggleEl = e.target.closest('[data-toggle]');
      if (toggleEl && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        toggleEl.click();
      }
    });

    // Delegated keyboard handler for role="button" elements
    document.addEventListener('keydown', (e) => {
      const roleBtn = e.target.closest('[role="button"]');
      if (roleBtn && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        roleBtn.click();
      }
    });

    // Delegated keyboard handler for subtask checkboxes (role="checkbox" with data-action)
    document.addEventListener('keydown', (e) => {
      const checkboxEl = e.target.closest('[role="checkbox"][data-action]');
      if (checkboxEl && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        checkboxEl.click();
      }
    });
  }

  function attachListeners() {
    // Delegated listeners are set up once (no re-attachment needed)
    ensureDelegatedListeners();
    // These still need per-render attachment (they modify contenteditable elements)
    attachInlineEdit();
    attachBulkListeners();
  }

  // --- Getters/setters for internal state ---
  function getTrapFocusCleanup() {
    return _trapFocusCleanup;
  }
  function setTrapFocusCleanup(fn) {
    _trapFocusCleanup = fn;
  }
  function getModalTriggerEl() {
    return _modalTriggerEl;
  }
  function setModalTriggerEl(el) {
    _modalTriggerEl = el;
  }

  return {
    ensureDelegatedListeners,
    attachListeners,
    highlightKbRow,
    trapFocus,
    pushModalState,
    closeModal,
    setModalLabel,
    openMobileSidebar,
    closeMobileSidebar,
    confirmAction,
    confirmDeleteProject,
    confirmClearMemories,
    confirmResetData,
    getTrapFocusCleanup,
    setTrapFocusCleanup,
    getModalTriggerEl,
    setModalTriggerEl,
  };
}
