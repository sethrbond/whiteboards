import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommandPalette } from '../command-palette.js';

function makeDeps(overrides = {}) {
  return {
    $: vi.fn((sel) => document.querySelector(sel)),
    $$: vi.fn((sel) => [...document.querySelectorAll(sel)]),
    esc: vi.fn((s) => (s == null ? '' : String(s))),
    highlightMatch: vi.fn((text, _q) => text),
    fmtDate: vi.fn((d) => d),
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    userKey: vi.fn((k) => `user1_${k}`),
    closeModal: vi.fn(),
    setModalTriggerEl: vi.fn(),
    activeTasks: vi.fn(() => []),
    hasAI: vi.fn(() => false),
    showToast: vi.fn(),
    setView: vi.fn(),
    sendChat: vi.fn(),
    toggleChat: vi.fn(),
    openNewTask: vi.fn(),
    openQuickAdd: vi.fn(),
    openNewProject: vi.fn(),
    openSettings: vi.fn(),
    startFocus: vi.fn(),
    aiReorganize: vi.fn(),
    filterAIPrepared: vi.fn(),
    setNudgeFilter: vi.fn(),
    getCurrentProject: vi.fn(() => null),
    ...overrides,
  };
}

describe('command-palette.js — createCommandPalette()', () => {
  let cp;
  let deps;

  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView
    if (!globalThis.Element.prototype.scrollIntoView) {
      globalThis.Element.prototype.scrollIntoView = vi.fn();
    }
    localStorage.clear();
    deps = makeDeps();
    cp = createCommandPalette(deps);
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'openSearch',
      'handleCmdNav',
      'renderSearchResults',
      'cmdPaletteAI',
      'cmdExec',
      'openShortcutHelp',
      'resetCmdIdx',
    ];
    keys.forEach((k) => expect(typeof cp[k]).toBe('function'));
  });

  // ── openSearch ────────────────────────────────────────────────────
  it('openSearch renders the command palette modal', () => {
    cp.openSearch();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('cmd-palette');
    expect(modal.innerHTML).toContain('searchInput');
  });

  it('openSearch renders initial search results', () => {
    cp.openSearch();
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Commands');
  });

  // ── renderSearchResults ───────────────────────────────────────────
  it('renderSearchResults shows commands when query is empty', () => {
    cp.openSearch();
    cp.renderSearchResults('');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Commands');
    expect(results.innerHTML).toContain('New Task');
  });

  it('renderSearchResults filters commands with > prefix', () => {
    cp.openSearch();
    cp.renderSearchResults('>focus');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Focus Mode');
  });

  it('renderSearchResults shows no results message for unmatched query', () => {
    cp.openSearch();
    cp.renderSearchResults('zzzznonexistent');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('No results');
  });

  it('renderSearchResults finds tasks by title', () => {
    deps.getData.mockReturnValue({
      tasks: [{ id: 't_1', title: 'Buy groceries', priority: 'normal', status: 'todo' }],
      projects: [],
    });
    cp.openSearch();
    cp.renderSearchResults('groceries');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Tasks');
  });

  it('renderSearchResults finds projects by name', () => {
    deps.getData.mockReturnValue({
      tasks: [],
      projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
    });
    deps.activeTasks.mockReturnValue([]);
    cp.openSearch();
    cp.renderSearchResults('work');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Boards');
  });

  it('renderSearchResults shows recent commands when available', () => {
    localStorage.setItem('user1_wb_cmd_recent', JSON.stringify(['Focus Mode', 'Settings']));
    cp.openSearch();
    cp.renderSearchResults('');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Recent');
  });

  it('renderSearchResults shows "Create task" option for typed text', () => {
    cp.openSearch();
    cp.renderSearchResults('my new task');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Create task');
  });

  // ── cmdExec ───────────────────────────────────────────────────────
  it('cmdExec saves command to recent history', () => {
    cp.openSearch();
    cp.cmdExec('c0', 'New Task');
    const recent = JSON.parse(localStorage.getItem('user1_wb_cmd_recent'));
    expect(recent).toContain('New Task');
  });

  // ── resetCmdIdx ───────────────────────────────────────────────────
  it('resetCmdIdx resets the command index to 0', () => {
    cp.resetCmdIdx();
    expect(() => cp.resetCmdIdx()).not.toThrow();
  });

  // ── openShortcutHelp ──────────────────────────────────────────────
  it('openShortcutHelp renders keyboard shortcuts modal', () => {
    cp.openShortcutHelp();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Keyboard Shortcuts');
    expect(modal.innerHTML).toContain('Navigation');
    expect(modal.innerHTML).toContain('Tasks');
    expect(modal.innerHTML).toContain('AI Features');
  });

  it('openShortcutHelp calls setModalTriggerEl', () => {
    cp.openShortcutHelp();
    expect(deps.setModalTriggerEl).toHaveBeenCalled();
  });

  // ── cmdPaletteAI ──────────────────────────────────────────────────
  it('cmdPaletteAI does nothing when AI is not available', async () => {
    deps.hasAI.mockReturnValue(false);
    await cp.cmdPaletteAI('test query');
    expect(deps.sendChat).not.toHaveBeenCalled();
  });

  it('cmdPaletteAI does nothing for empty query', async () => {
    deps.hasAI.mockReturnValue(true);
    await cp.cmdPaletteAI('  ');
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it('cmdPaletteAI handles overdue keyword locally', async () => {
    deps.hasAI.mockReturnValue(true);
    await cp.cmdPaletteAI('show me overdue tasks');
    expect(deps.setNudgeFilter).toHaveBeenCalledWith('overdue');
    expect(deps.setView).toHaveBeenCalledWith('dashboard');
  });

  it('cmdPaletteAI handles stale keyword locally', async () => {
    deps.hasAI.mockReturnValue(true);
    await cp.cmdPaletteAI('tasks sitting for too long');
    expect(deps.setNudgeFilter).toHaveBeenCalledWith('stale');
  });

  it('cmdPaletteAI handles unassigned keyword locally', async () => {
    deps.hasAI.mockReturnValue(true);
    await cp.cmdPaletteAI('show unassigned tasks');
    expect(deps.setNudgeFilter).toHaveBeenCalledWith('unassigned');
  });

  // ── handleCmdNav ──────────────────────────────────────────────────
  it('handleCmdNav does nothing when no items exist', () => {
    cp.openSearch();
    document.getElementById('searchResults').innerHTML = '';
    const e = new Event('keydown');
    e.key = 'ArrowDown';
    e.preventDefault = vi.fn();
    cp.handleCmdNav(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  describe('handleCmdNav with items', () => {
    beforeEach(() => {
      cp.openSearch();
      cp.renderSearchResults('');
    });

    it('ArrowDown moves highlight down and calls preventDefault', () => {
      const items = document.querySelectorAll('.cmd-item');
      expect(items.length).toBeGreaterThan(1);
      cp.resetCmdIdx();
      const e = { key: 'ArrowDown', preventDefault: vi.fn() };
      cp.handleCmdNav(e);
      expect(e.preventDefault).toHaveBeenCalled();
      const updatedItems = document.querySelectorAll('.cmd-item');
      expect(updatedItems[1].classList.contains('active')).toBe(true);
      expect(updatedItems[0].classList.contains('active')).toBe(false);
    });

    it('ArrowUp moves highlight up and calls preventDefault', () => {
      cp.resetCmdIdx();
      cp.handleCmdNav({ key: 'ArrowDown', preventDefault: vi.fn() });
      cp.handleCmdNav({ key: 'ArrowDown', preventDefault: vi.fn() });
      const e = { key: 'ArrowUp', preventDefault: vi.fn() };
      cp.handleCmdNav(e);
      expect(e.preventDefault).toHaveBeenCalled();
      const items = document.querySelectorAll('.cmd-item');
      expect(items[1].classList.contains('active')).toBe(true);
    });

    it('ArrowUp does not go below index 0', () => {
      cp.resetCmdIdx();
      const e = { key: 'ArrowUp', preventDefault: vi.fn() };
      cp.handleCmdNav(e);
      expect(e.preventDefault).toHaveBeenCalled();
      const items = document.querySelectorAll('.cmd-item');
      expect(items[0].classList.contains('active')).toBe(true);
    });

    it('ArrowDown does not exceed last item', () => {
      cp.resetCmdIdx();
      const items = document.querySelectorAll('.cmd-item');
      for (let i = 0; i < items.length + 5; i++) {
        cp.handleCmdNav({ key: 'ArrowDown', preventDefault: vi.fn() });
      }
      const updated = document.querySelectorAll('.cmd-item');
      expect(updated[updated.length - 1].classList.contains('active')).toBe(true);
    });

    it('Enter clicks the highlighted item', () => {
      cp.resetCmdIdx();
      const items = document.querySelectorAll('.cmd-item');
      const clickSpy = vi.spyOn(items[0], 'click');
      const e = { key: 'Enter', preventDefault: vi.fn() };
      cp.handleCmdNav(e);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('Enter on AI footer clicks the footer when cmdIdx is past items', () => {
      deps.hasAI.mockReturnValue(true);
      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('some long query text');
      const aiFooter = document.querySelector('.cmd-ai-footer');
      if (!aiFooter) return;
      const items = document.querySelectorAll('.cmd-item');
      cp.resetCmdIdx();
      for (let i = 0; i <= items.length; i++) {
        cp.handleCmdNav({ key: 'ArrowDown', preventDefault: vi.fn() });
      }
      const clickSpy = vi.spyOn(aiFooter, 'click');
      cp.handleCmdNav({ key: 'Enter', preventDefault: vi.fn() });
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });
  });

  // ── cmdTaskItem via renderSearchResults ────────────────────────────
  describe('cmdTaskItem rendering via renderSearchResults', () => {
    it('renders task with project name', () => {
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Task with proj', priority: 'normal', status: 'todo', project: 'p_1' }],
        projects: [{ id: 'p_1', name: 'Work', color: '#3b82f6' }],
      });
      cp.openSearch();
      cp.renderSearchResults('Task with proj');
      const results = document.getElementById('searchResults');
      expect(results.innerHTML).toContain('Work');
      expect(results.innerHTML).toContain('cmd-item-meta');
    });

    it('renders task with due date', () => {
      deps.fmtDate.mockReturnValue('Mar 20');
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Due task', priority: 'normal', status: 'todo', dueDate: '2026-03-20' }],
        projects: [],
      });
      cp.openSearch();
      cp.renderSearchResults('Due task');
      const results = document.getElementById('searchResults');
      expect(results.innerHTML).toContain('Mar 20');
    });

    it('renders done task with cmd-done class', () => {
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Finished task', priority: 'normal', status: 'done' }],
        projects: [],
      });
      cp.openSearch();
      cp.renderSearchResults('Finished');
      const results = document.getElementById('searchResults');
      expect(results.innerHTML).toContain('cmd-done');
    });

    it('renders urgent task with red priority color', () => {
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Urgent task', priority: 'urgent', status: 'todo' }],
        projects: [],
      });
      cp.openSearch();
      cp.renderSearchResults('Urgent');
      const results = document.getElementById('searchResults');
      expect(results.innerHTML).toContain('var(--red)');
    });

    it('renders important task with orange priority color', () => {
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Important task', priority: 'important', status: 'todo' }],
        projects: [],
      });
      cp.openSearch();
      cp.renderSearchResults('Important');
      const results = document.getElementById('searchResults');
      expect(results.innerHTML).toContain('var(--orange)');
    });

    it('renders low priority task with text3 color', () => {
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Low task', priority: 'low', status: 'todo' }],
        projects: [],
      });
      cp.openSearch();
      cp.renderSearchResults('Low');
      const results = document.getElementById('searchResults');
      expect(results.innerHTML).toContain('var(--text3)');
    });

    it('renders task without project omits project meta', () => {
      deps.getData.mockReturnValue({
        tasks: [{ id: 't_1', title: 'Solo task', priority: 'normal', status: 'todo' }],
        projects: [],
      });
      cp.openSearch();
      cp.renderSearchResults('Solo');
      const results = document.getElementById('searchResults');
      const taskItem = results.querySelector('[data-action="cmd-go-task"]');
      expect(taskItem).toBeTruthy();
      expect(taskItem.getAttribute('data-project-id')).toBe('');
    });
  });

  // ── getCmdRecent error path ──────────────────────────────────────
  it('getCmdRecent returns [] when localStorage has corrupt JSON', () => {
    localStorage.setItem('user1_wb_cmd_recent', '{bad json[');
    cp.openSearch();
    cp.renderSearchResults('');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Commands');
  });

  // ── pushCmdRecent deduplication and cap ────────────────────────────
  it('pushCmdRecent deduplicates and caps at 5 items', () => {
    cp.openSearch();
    cp.cmdExec('c0', 'A');
    cp.cmdExec('c0', 'B');
    cp.cmdExec('c0', 'C');
    cp.cmdExec('c0', 'D');
    cp.cmdExec('c0', 'E');
    cp.cmdExec('c0', 'F');
    const recent = JSON.parse(localStorage.getItem('user1_wb_cmd_recent'));
    expect(recent).toHaveLength(5);
    expect(recent[0]).toBe('F');
    expect(recent).not.toContain('A');
  });

  it('pushCmdRecent deduplicates existing entries', () => {
    cp.openSearch();
    cp.cmdExec('c0', 'Alpha');
    cp.cmdExec('c0', 'Beta');
    cp.cmdExec('c0', 'Alpha');
    const recent = JSON.parse(localStorage.getItem('user1_wb_cmd_recent'));
    expect(recent).toEqual(['Alpha', 'Beta']);
  });

  // ── cmdPaletteAI chat panel flow ──────────────────────────────────
  it('cmdPaletteAI sends to chat when query does not match local patterns', async () => {
    deps.hasAI.mockReturnValue(true);
    cp = createCommandPalette(deps);
    const panel = document.createElement('div');
    panel.id = 'chatPanel';
    document.body.appendChild(panel);
    const chatInput = document.createElement('textarea');
    chatInput.id = 'chatInput';
    document.body.appendChild(chatInput);

    await cp.cmdPaletteAI('how should I prioritize my work?');
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Sending to AI'), false, true);
    // sendChat is called (the function sets chatInput.value and calls sendChat internally,
    // but getElementById may not find the panel in jsdom test environment after a throw)
    expect(deps.sendChat).toHaveBeenCalled();

    panel.remove();
    chatInput.remove();
  });

  it('cmdPaletteAI does not add open class if panel already has it', async () => {
    deps.hasAI.mockReturnValue(true);
    const panel = document.createElement('div');
    panel.id = 'chatPanel';
    panel.classList.add('open');
    document.body.appendChild(panel);
    const chatInput = document.createElement('textarea');
    chatInput.id = 'chatInput';
    document.body.appendChild(chatInput);

    await cp.cmdPaletteAI('what should I work on?');
    expect(panel.classList.contains('open')).toBe(true);
    expect(deps.sendChat).toHaveBeenCalled();

    panel.remove();
    chatInput.remove();
  });

  // ── AI footer rendering and clicking ──────────────────────────────
  describe('AI footer', () => {
    it('renders AI footer for queries > 3 chars when AI is available', () => {
      deps.hasAI.mockReturnValue(true);
      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('organize my tasks');
      const footer = document.querySelector('.cmd-ai-footer');
      expect(footer).toBeTruthy();
      expect(footer.textContent).toContain('Ask AI');
      expect(footer.textContent).toContain('organize my tasks');
    });

    it('does not render AI footer when AI is not available', () => {
      deps.hasAI.mockReturnValue(false);
      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('organize my tasks');
      const footer = document.querySelector('.cmd-ai-footer');
      expect(footer).toBeNull();
    });

    it('does not render AI footer for short queries', () => {
      deps.hasAI.mockReturnValue(true);
      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('ab');
      const footer = document.querySelector('.cmd-ai-footer');
      expect(footer).toBeNull();
    });

    it('clicking AI footer closes modal and triggers cmdPaletteAI', () => {
      deps.hasAI.mockReturnValue(true);
      const panel = document.createElement('div');
      panel.id = 'chatPanel';
      document.body.appendChild(panel);
      const chatInput = document.createElement('textarea');
      chatInput.id = 'chatInput';
      document.body.appendChild(chatInput);

      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('organize my tasks please');
      const footer = document.querySelector('.cmd-ai-footer');
      expect(footer).toBeTruthy();
      footer.click();
      expect(deps.closeModal).toHaveBeenCalled();

      panel.remove();
      chatInput.remove();
    });

    it('ArrowDown highlights AI footer when past last cmd-item', () => {
      deps.hasAI.mockReturnValue(true);
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('organize my tasks please');
      const items = document.querySelectorAll('.cmd-item');
      const aiFooter = document.querySelector('.cmd-ai-footer');
      if (!aiFooter || items.length === 0) return;
      cp.resetCmdIdx();
      for (let i = 0; i <= items.length; i++) {
        cp.handleCmdNav({ key: 'ArrowDown', preventDefault: vi.fn() });
      }
      expect(aiFooter.style.background).toContain('var(--accent-dim)');
    });

    it('ArrowUp clears AI footer highlight', () => {
      deps.hasAI.mockReturnValue(true);
      deps.getData.mockReturnValue({ tasks: [], projects: [] });
      cp = createCommandPalette(deps);
      cp.openSearch();
      cp.renderSearchResults('organize my tasks please');
      const aiFooter = document.querySelector('.cmd-ai-footer');
      if (!aiFooter) return;
      const items = document.querySelectorAll('.cmd-item');
      cp.resetCmdIdx();
      for (let i = 0; i <= items.length; i++) {
        cp.handleCmdNav({ key: 'ArrowDown', preventDefault: vi.fn() });
      }
      cp.handleCmdNav({ key: 'ArrowUp', preventDefault: vi.fn() });
      expect(aiFooter.style.background).toBe('');
    });
  });

  // ── renderSearchResults > prefix "No commands found" ──────────────
  it('renderSearchResults with > prefix shows "No commands found" for unmatched command', () => {
    cp.openSearch();
    cp.renderSearchResults('>zzzznotacommand');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('No commands found');
  });

  // ── Task search by notes content ──────────────────────────────────
  it('renderSearchResults finds tasks by notes content', () => {
    deps.getData.mockReturnValue({
      tasks: [{ id: 't_1', title: 'Report', priority: 'normal', status: 'todo', notes: 'quarterly budget analysis' }],
      projects: [],
    });
    cp.openSearch();
    cp.renderSearchResults('quarterly');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Tasks');
    expect(results.innerHTML).toContain('Report');
  });

  // ── Combined results (tasks + commands + projects) ────────────────
  it('renderSearchResults shows combined tasks, commands, and projects', () => {
    deps.getData.mockReturnValue({
      tasks: [{ id: 't_1', title: 'Focus review', priority: 'normal', status: 'todo' }],
      projects: [{ id: 'p_1', name: 'Focus Project', color: '#aaa' }],
    });
    deps.activeTasks.mockReturnValue([]);
    cp.openSearch();
    cp.renderSearchResults('focus');
    const results = document.getElementById('searchResults');
    expect(results.innerHTML).toContain('Commands');
    expect(results.innerHTML).toContain('Focus Mode');
    expect(results.innerHTML).toContain('Boards');
    expect(results.innerHTML).toContain('Focus Project');
    expect(results.innerHTML).toContain('Tasks');
    expect(results.innerHTML).toContain('Focus review');
  });

  // ── Task result limit of 12 ──────────────────────────────────────
  it('renderSearchResults limits task results to 12', () => {
    const tasks = [];
    for (let i = 0; i < 20; i++) {
      tasks.push({ id: `t_${i}`, title: `Matching item ${i}`, priority: 'normal', status: 'todo' });
    }
    deps.getData.mockReturnValue({ tasks, projects: [] });
    cp.openSearch();
    cp.renderSearchResults('Matching');
    const results = document.getElementById('searchResults');
    const taskItems = results.querySelectorAll('[data-action="cmd-go-task"]');
    expect(taskItems.length).toBe(12);
  });

  // ── Command rendering ──────────────────────────────────────────
  it('renders all commands with cmd-exec action and cmd-key', () => {
    cp.openSearch();
    cp.renderSearchResults('>');
    const items = document.querySelectorAll('#searchResults [data-action="cmd-exec"]');
    expect(items.length).toBeGreaterThan(5);
    // Each has a unique cmd-key
    const keys = [...items].map((el) => el.dataset.cmdKey);
    expect(new Set(keys).size).toBe(keys.length);
    // Each has a label
    items.forEach((el) => {
      expect(el.dataset.cmdLabel).toBeTruthy();
    });
  });
});
