import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEvents } from '../events.js';

function makeDeps(overrides = {}) {
  return {
    $: vi.fn((sel) => document.querySelector(sel)),
    $$: vi.fn((sel) => document.querySelectorAll(sel)),
    esc: vi.fn((s) => String(s ?? '')),
    findTask: vi.fn(() => null),
    updateTask: vi.fn(),
    deleteProject: vi.fn(),
    setView: vi.fn(),
    render: vi.fn(),
    showToast: vi.fn(),
    filterByTag: vi.fn(),
    attachInlineEdit: vi.fn(),
    attachBulkListeners: vi.fn(),
    saveAIMemory: vi.fn(),
    saveAIMemoryArchive: vi.fn(),
    syncToCloud: vi.fn(),
    loadData: vi.fn(() => ({ tasks: [], projects: [] })),
    ensureLifeProject: vi.fn(),
    saveData: vi.fn(),
    openSettings: vi.fn(),
    STORE_KEY: 'taskboard_data',
    userKey: vi.fn((k) => `user1_${k}`),
    getKbIdx: vi.fn(() => 0),
    getExpandedTask: vi.fn(() => null),
    setExpandedTask: vi.fn(),
    setData: vi.fn(),
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    ...overrides,
  };
}

describe('events.js — createEvents()', () => {
  let events;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    // Restore minimal DOM for modal tests
    document.getElementById('modalRoot').innerHTML = '';
    deps = makeDeps();
    events = createEvents(deps);
  });

  afterEach(() => {
    // Clean up any overlays left by confirmAction
    document.querySelectorAll('[role="alertdialog"]').forEach((el) => el.remove());
  });

  // ── Factory returns ───────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'ensureDelegatedListeners',
      'attachListeners',
      'highlightKbRow',
      'trapFocus',
      'pushModalState',
      'closeModal',
      'setModalLabel',
      'openMobileSidebar',
      'closeMobileSidebar',
      'confirmAction',
      'confirmDeleteProject',
      'confirmClearMemories',
      'confirmResetData',
      'getTrapFocusCleanup',
      'setTrapFocusCleanup',
      'getModalTriggerEl',
      'setModalTriggerEl',
    ];
    keys.forEach((k) => expect(typeof events[k]).toBe('function'));
  });

  // ── closeModal ────────────────────────────────────────────────────
  describe('closeModal', () => {
    it('clears modalRoot innerHTML when no overlay exists', () => {
      document.getElementById('modalRoot').innerHTML = '<div class="some-content">Hello</div>';
      events.closeModal();
      expect(document.getElementById('modalRoot').innerHTML).toBe('');
    });

    it('runs trap focus cleanup when set', () => {
      const cleanup = vi.fn();
      events.setTrapFocusCleanup(cleanup);
      events.closeModal();
      expect(cleanup).toHaveBeenCalled();
      expect(events.getTrapFocusCleanup()).toBeNull();
    });

    it('starts fade-out animation when overlay exists', () => {
      vi.useFakeTimers();
      const modalRoot = document.getElementById('modalRoot');
      modalRoot.innerHTML = '<div class="modal-overlay"><div class="modal"></div></div>';
      events.closeModal();
      const overlay = modalRoot.querySelector('.modal-overlay');
      expect(overlay.style.opacity).toBe('0');
      vi.advanceTimersByTime(200);
      expect(modalRoot.innerHTML).toBe('');
      vi.useRealTimers();
    });

    it('restores focus to trigger element after close', () => {
      const btn = document.createElement('button');
      btn.textContent = 'Trigger';
      document.body.appendChild(btn);
      events.setModalTriggerEl(btn);
      events.closeModal();
      // After close, _modalTriggerEl is set to null
      expect(events.getModalTriggerEl()).toBeNull();
      btn.remove();
    });
  });

  // ── confirmAction ─────────────────────────────────────────────────
  describe('confirmAction', () => {
    it('creates an overlay with confirm and cancel buttons', async () => {
      const promise = events.confirmAction('Delete everything?');
      const overlay = document.querySelector('[role="alertdialog"]');
      expect(overlay).toBeTruthy();
      expect(overlay.textContent).toContain('Delete everything?');
      // Click confirm
      overlay.querySelector('#_confirmOk').click();
      const result = await promise;
      expect(result).toBe(true);
    });

    it('resolves false when cancel is clicked', async () => {
      const promise = events.confirmAction('Are you sure?');
      const overlay = document.querySelector('[role="alertdialog"]');
      overlay.querySelector('#_confirmCancel').click();
      const result = await promise;
      expect(result).toBe(false);
    });

    it('resolves false when Escape key is pressed', async () => {
      const promise = events.confirmAction('Proceed?');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const result = await promise;
      expect(result).toBe(false);
    });

    it('resolves false when clicking the backdrop overlay', async () => {
      const promise = events.confirmAction('Backdrop test?');
      const overlay = document.querySelector('[role="alertdialog"]');
      // Simulate clicking the overlay itself (not a child)
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const result = await promise;
      expect(result).toBe(false);
    });

    it('sets aria-modal attribute', () => {
      events.confirmAction('Accessible?');
      const overlay = document.querySelector('[role="alertdialog"]');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
    });
  });

  // ── trapFocus ─────────────────────────────────────────────────────
  describe('trapFocus', () => {
    it('returns a cleanup function', () => {
      const container = document.createElement('div');
      container.innerHTML = '<button>A</button><button>B</button>';
      document.body.appendChild(container);
      const cleanup = events.trapFocus(container);
      expect(typeof cleanup).toBe('function');
      cleanup();
      container.remove();
    });

    it('returns noop when no focusable elements exist', () => {
      const container = document.createElement('div');
      container.innerHTML = '<span>No focusable elements</span>';
      const cleanup = events.trapFocus(container);
      expect(typeof cleanup).toBe('function');
      cleanup(); // should not throw
    });

    it('traps Tab focus from last to first element', () => {
      const container = document.createElement('div');
      container.innerHTML = '<button id="first">A</button><button id="last">B</button>';
      document.body.appendChild(container);
      const cleanup = events.trapFocus(container);
      const last = container.querySelector('#last');
      const _first = container.querySelector('#first');
      last.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      container.dispatchEvent(event);
      expect(preventSpy).toHaveBeenCalled();
      cleanup();
      container.remove();
    });

    it('traps Shift+Tab focus from first to last element', () => {
      const container = document.createElement('div');
      container.innerHTML = '<button id="first">A</button><button id="last">B</button>';
      document.body.appendChild(container);
      const cleanup = events.trapFocus(container);
      const first = container.querySelector('#first');
      first.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      container.dispatchEvent(event);
      expect(preventSpy).toHaveBeenCalled();
      cleanup();
      container.remove();
    });
  });

  // ── pushModalState ────────────────────────────────────────────────
  describe('pushModalState', () => {
    it('pushes history state with modal type', () => {
      const pushSpy = vi.spyOn(history, 'pushState');
      events.pushModalState('confirm');
      expect(pushSpy).toHaveBeenCalledWith({ modal: 'confirm' }, '');
      pushSpy.mockRestore();
    });
  });

  // ── setModalLabel ─────────────────────────────────────────────────
  describe('setModalLabel', () => {
    it('sets aria-label on modalRoot', () => {
      events.setModalLabel('Edit Task');
      expect(document.getElementById('modalRoot').getAttribute('aria-label')).toBe('Edit Task');
    });

    it('defaults to Dialog when label is empty', () => {
      events.setModalLabel('');
      expect(document.getElementById('modalRoot').getAttribute('aria-label')).toBe('Dialog');
    });

    it('defaults to Dialog when label is null', () => {
      events.setModalLabel(null);
      expect(document.getElementById('modalRoot').getAttribute('aria-label')).toBe('Dialog');
    });
  });

  // ── Mobile sidebar ────────────────────────────────────────────────
  describe('openMobileSidebar / closeMobileSidebar', () => {
    let sidebar;
    let overlay;

    beforeEach(() => {
      sidebar = document.createElement('div');
      sidebar.id = 'sidebar';
      document.body.appendChild(sidebar);
      overlay = document.createElement('div');
      overlay.id = 'mobileOverlay';
      overlay.style.display = 'none';
      document.body.appendChild(overlay);
    });

    afterEach(() => {
      sidebar.remove();
      overlay.remove();
    });

    it('opens mobile sidebar by adding open class', () => {
      events.openMobileSidebar();
      expect(sidebar.classList.contains('open')).toBe(true);
      expect(overlay.style.display).toBe('block');
    });

    it('closes mobile sidebar by removing open class', () => {
      events.openMobileSidebar();
      events.closeMobileSidebar();
      expect(sidebar.classList.contains('open')).toBe(false);
      expect(overlay.style.display).toBe('none');
    });
  });

  // ── highlightKbRow ────────────────────────────────────────────────
  describe('highlightKbRow', () => {
    it('highlights the row at kbIdx', () => {
      deps.getKbIdx.mockReturnValue(1);
      events = createEvents(deps);
      const rows = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
      rows.forEach((r) => document.body.appendChild(r));
      rows[1].scrollIntoView = vi.fn();
      events.highlightKbRow(rows);
      expect(rows[0].style.outline).toBe('');
      expect(rows[1].style.outline).toContain('2px solid');
      expect(rows[1].scrollIntoView).toHaveBeenCalled();
      rows.forEach((r) => r.remove());
    });

    it('handles empty rows array', () => {
      events.highlightKbRow([]);
      // Should not throw
    });
  });

  // ── attachListeners ───────────────────────────────────────────────
  describe('attachListeners', () => {
    it('calls attachInlineEdit and attachBulkListeners', () => {
      events.attachListeners();
      expect(deps.attachInlineEdit).toHaveBeenCalled();
      expect(deps.attachBulkListeners).toHaveBeenCalled();
    });
  });

  // ── confirmDeleteProject ──────────────────────────────────────────
  describe('confirmDeleteProject', () => {
    it('deletes project and switches to dashboard on confirm', async () => {
      const promise = events.confirmDeleteProject('p1');
      // Find and click confirm
      const overlay = document.querySelector('[role="alertdialog"]');
      overlay.querySelector('#_confirmOk').click();
      await promise;
      expect(deps.deleteProject).toHaveBeenCalledWith('p1');
      expect(deps.setView).toHaveBeenCalledWith('dashboard');
    });

    it('does nothing on cancel', async () => {
      const promise = events.confirmDeleteProject('p1');
      const overlay = document.querySelector('[role="alertdialog"]');
      overlay.querySelector('#_confirmCancel').click();
      await promise;
      expect(deps.deleteProject).not.toHaveBeenCalled();
    });
  });

  // ── confirmClearMemories ──────────────────────────────────────────
  describe('confirmClearMemories', () => {
    it('clears memories and opens settings on confirm', async () => {
      const promise = events.confirmClearMemories();
      const overlay = document.querySelector('[role="alertdialog"]');
      overlay.querySelector('#_confirmOk').click();
      await promise;
      expect(deps.saveAIMemory).toHaveBeenCalledWith([]);
      expect(deps.saveAIMemoryArchive).toHaveBeenCalledWith([]);
      expect(deps.openSettings).toHaveBeenCalled();
    });
  });

  // ── confirmResetData ──────────────────────────────────────────────
  describe('confirmResetData', () => {
    it('resets data and syncs on confirm', async () => {
      const promise = events.confirmResetData();
      const overlay = document.querySelector('[role="alertdialog"]');
      overlay.querySelector('#_confirmOk').click();
      await promise;
      expect(deps.loadData).toHaveBeenCalled();
      expect(deps.ensureLifeProject).toHaveBeenCalled();
      expect(deps.syncToCloud).toHaveBeenCalled();
      expect(deps.showToast).toHaveBeenCalledWith('All data cleared');
    });
  });
});

// ── Additional coverage: delegated click and keyboard handlers ──────
describe('events.js — delegated listeners coverage', () => {
  let events2;
  let deps2;

  function makeDeps2(overrides = {}) {
    return {
      $: vi.fn((sel) => document.querySelector(sel)),
      $$: vi.fn((sel) => document.querySelectorAll(sel)),
      esc: vi.fn((s) => String(s ?? '')),
      findTask: vi.fn(() => null),
      updateTask: vi.fn(),
      deleteProject: vi.fn(),
      setView: vi.fn(),
      render: vi.fn(),
      showToast: vi.fn(),
      filterByTag: vi.fn(),
      attachInlineEdit: vi.fn(),
      attachBulkListeners: vi.fn(),
      saveAIMemory: vi.fn(),
      saveAIMemoryArchive: vi.fn(),
      syncToCloud: vi.fn(),
      loadData: vi.fn(() => ({ tasks: [], projects: [] })),
      ensureLifeProject: vi.fn(),
      saveData: vi.fn(),
      openSettings: vi.fn(),
      STORE_KEY: 'taskboard_data',
      userKey: vi.fn((k) => `user2_${k}`),
      getKbIdx: vi.fn(() => 0),
      getExpandedTask: vi.fn(() => null),
      setExpandedTask: vi.fn(),
      setData: vi.fn(),
      getData: vi.fn(() => ({ tasks: [], projects: [] })),
      ...overrides,
    };
  }

  beforeEach(() => {
    localStorage.clear();
    document.getElementById('modalRoot').innerHTML = '';
    deps2 = makeDeps2();
    events2 = createEvents(deps2);
    events2.ensureDelegatedListeners();
  });

  afterEach(() => {
    document.querySelectorAll('[role="alertdialog"]').forEach((el) => el.remove());
  });

  // ── data-toggle task completion ───────────────────────────────────
  describe('data-toggle task completion', () => {
    it('toggles task from todo to done', () => {
      deps2.findTask.mockReturnValue({ id: 't_1', title: 'Test', status: 'todo' });
      const el = document.createElement('div');
      el.dataset.toggle = 't_1';
      document.body.appendChild(el);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.updateTask).toHaveBeenCalledWith('t_1', { status: 'done' });
      expect(deps2.render).toHaveBeenCalled();
      expect(deps2.showToast).toHaveBeenCalled();
      el.remove();
    });

    it('toggles task from done back to todo', () => {
      deps2.findTask.mockReturnValue({ id: 't_1', title: 'Test', status: 'done' });
      const el = document.createElement('div');
      el.dataset.toggle = 't_1';
      document.body.appendChild(el);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.updateTask).toHaveBeenCalledWith('t_1', { status: 'todo' });
      expect(deps2.render).toHaveBeenCalled();
      el.remove();
    });

    it('does nothing when task is not found', () => {
      deps2.findTask.mockReturnValue(null);
      const el = document.createElement('div');
      el.dataset.toggle = 't_nonexistent';
      document.body.appendChild(el);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.updateTask).not.toHaveBeenCalled();
      el.remove();
    });

    it('collapses expanded task when marking as done', () => {
      deps2.findTask.mockReturnValue({ id: 't_1', title: 'Test', status: 'todo' });
      const el = document.createElement('div');
      el.dataset.toggle = 't_1';
      document.body.appendChild(el);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setExpandedTask).toHaveBeenCalledWith(null);
      el.remove();
    });
  });

  // ── project grid card click ───────────────────────────────────────
  describe('project grid card click', () => {
    it('navigates to project view on card click', () => {
      const card = document.createElement('div');
      card.className = 'project-grid-card';
      card.dataset.project = 'p_42';
      document.body.appendChild(card);
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setView).toHaveBeenCalledWith('project', 'p_42');
      card.remove();
    });

    it('navigates when clicking child of project grid card', () => {
      const card = document.createElement('div');
      card.className = 'project-grid-card';
      card.dataset.project = 'p_42';
      const child = document.createElement('span');
      child.textContent = 'Card Title';
      card.appendChild(child);
      document.body.appendChild(card);
      child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setView).toHaveBeenCalledWith('project', 'p_42');
      card.remove();
    });
  });

  // ── sidebar project nav click ────────────────────────────────────
  describe('sidebar project nav click', () => {
    it('navigates to project view on nav item click', () => {
      const nav = document.createElement('div');
      nav.className = 'project-nav-item';
      nav.dataset.project = 'p_99';
      document.body.appendChild(nav);
      nav.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setView).toHaveBeenCalledWith('project', 'p_99');
      nav.remove();
    });
  });

  // ── tag filter click ─────────────────────────────────────────────
  describe('tag filter click', () => {
    it('calls filterByTag when tag filter button is clicked', () => {
      const btn = document.createElement('button');
      btn.className = 'tag-filter-btn';
      btn.dataset.tag = 'bug';
      document.body.appendChild(btn);
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.filterByTag).toHaveBeenCalledWith('bug');
      btn.remove();
    });

    it('does not call filterByTag when tag is null', () => {
      const btn = document.createElement('button');
      btn.className = 'tag-filter-btn';
      // no data-tag set
      document.body.appendChild(btn);
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.filterByTag).not.toHaveBeenCalled();
      btn.remove();
    });
  });

  // ── task row expand/collapse ──────────────────────────────────────
  describe('task row expand/collapse', () => {
    it.skip('expands a task when clicking on task row (moved to capture handler in app.js)', () => {
      deps2.getExpandedTask.mockReturnValue(null);
      const row = document.createElement('div');
      row.dataset.task = 't_5';
      document.body.appendChild(row);
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setExpandedTask).toHaveBeenCalledWith('t_5');
      expect(deps2.render).toHaveBeenCalled();
      row.remove();
    });

    it.skip('collapses a task when clicking on already-expanded task row (moved to capture handler in app.js)', () => {
      deps2.getExpandedTask.mockReturnValue('t_5');
      const row = document.createElement('div');
      row.dataset.task = 't_5';
      document.body.appendChild(row);
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setExpandedTask).toHaveBeenCalledWith(null);
      expect(deps2.render).toHaveBeenCalled();
      row.remove();
    });

    it('does not expand when clicking on a btn inside task row', () => {
      const row = document.createElement('div');
      row.dataset.task = 't_5';
      const btn = document.createElement('button');
      btn.className = 'btn';
      row.appendChild(btn);
      document.body.appendChild(row);
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(deps2.setExpandedTask).not.toHaveBeenCalled();
      row.remove();
    });

    it('does not expand when clicking on data-toggle inside task row', () => {
      deps2.findTask.mockReturnValue({ id: 't_5', title: 'T', status: 'todo' });
      const row = document.createElement('div');
      row.dataset.task = 't_5';
      const toggle = document.createElement('div');
      toggle.dataset.toggle = 't_5';
      row.appendChild(toggle);
      document.body.appendChild(row);
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // toggle should be handled by toggle handler, not expand
      expect(deps2.updateTask).toHaveBeenCalled();
      row.remove();
    });
  });

  // ── Keyboard: data-toggle Enter/Space ─────────────────────────────
  describe('keyboard: data-toggle Enter/Space', () => {
    it('Enter on data-toggle triggers click', () => {
      const el = document.createElement('div');
      el.dataset.toggle = 't_1';
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
      el.remove();
    });

    it('Space on data-toggle triggers click', () => {
      const el = document.createElement('div');
      el.dataset.toggle = 't_1';
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
      el.remove();
    });

    it('other keys on data-toggle do not trigger click', () => {
      const el = document.createElement('div');
      el.dataset.toggle = 't_1';
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(clickSpy).not.toHaveBeenCalled();
      el.remove();
    });
  });

  // ── Keyboard: role="button" Enter/Space ───────────────────────────
  describe('keyboard: role="button" Enter/Space', () => {
    it('Enter on role="button" triggers click', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
      el.remove();
    });

    it('Space on role="button" triggers click', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
      el.remove();
    });
  });

  // ── Keyboard: role="checkbox" with data-action Enter/Space ────────
  describe('keyboard: role="checkbox" with data-action Enter/Space', () => {
    it('Enter on role="checkbox" with data-action triggers click', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'checkbox');
      el.dataset.action = 'toggle-subtask';
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
      el.remove();
    });

    it('Space on role="checkbox" with data-action triggers click', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'checkbox');
      el.dataset.action = 'toggle-subtask';
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
      el.remove();
    });

    it('does not trigger click for checkbox without data-action', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'checkbox');
      // no data-action
      el.tabIndex = 0;
      document.body.appendChild(el);
      const clickSpy = vi.spyOn(el, 'click');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(clickSpy).not.toHaveBeenCalled();
      el.remove();
    });
  });

  // ── ensureDelegatedListeners idempotency ──────────────────────────
  describe('ensureDelegatedListeners', () => {
    it('only attaches listeners once', () => {
      // Call multiple times - should not throw or double-attach
      events2.ensureDelegatedListeners();
      events2.ensureDelegatedListeners();
      // Verify basic functionality still works
      const card = document.createElement('div');
      card.className = 'project-grid-card';
      card.dataset.project = 'p_1';
      document.body.appendChild(card);
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Should only be called once, not multiple times
      expect(deps2.setView).toHaveBeenCalledTimes(1);
      card.remove();
    });
  });
});
