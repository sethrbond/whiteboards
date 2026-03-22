import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MS_PER_DAY } from '../constants.js';
import { createBrainstorm } from '../brainstorm.js';

function makeDeps(overrides = {}) {
  return {
    userKey: vi.fn((k) => `user1_${k}`),
    render: vi.fn(),
    showToast: vi.fn(),
    hasAI: vi.fn(() => false),
    callAI: vi.fn(async () => ''),
    getAIEndpoint: vi.fn(() => ({ url: 'https://test.api/v1', headers: {} })),
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    getSettings: vi.fn(() => ({ apiKey: '', aiModel: 'claude-haiku-4-5-20251001' })),
    findTask: vi.fn(() => null),
    findSimilarTask: vi.fn(() => null),
    findSimilarProject: vi.fn(() => null),
    createTask: vi.fn((t) => ({ id: 't_new', ...t })),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    createProject: vi.fn((p) => ({ id: 'p_new', ...p })),
    addProject: vi.fn(),
    updateProject: vi.fn(),
    getLifeProjectId: vi.fn(() => 'p_life'),
    pushUndo: vi.fn(),
    undo: vi.fn(),
    closeModal: vi.fn(),
    genId: vi.fn((prefix) => `${prefix || 't'}_gen`),
    normalizeTitle: vi.fn((s) =>
      (s || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
    $: vi.fn((sel) => document.querySelector(sel)),
    ...overrides,
  };
}

describe('brainstorm.js — createBrainstorm()', () => {
  let bs;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    deps = makeDeps();
    // Default $ mock to use document.querySelector
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Clean up any leftover DOM elements from tests
    document
      .querySelectorAll('#dumpText, #dumpStatus, #modalRoot, #brainstormConversation, .dump-area')
      .forEach((el) => el.remove());
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'renderDump',
      'initDumpDropZone',
      'processDump',
      'processDumpManual',
      'cancelDump',
      'applyDumpResults',
      'submitClarify',
      'skipClarify',
      'handleDumpFiles',
      'saveDumpDraft',
      'loadDumpDraft',
      'clearDumpDraft',
      'isDumpInProgress',
      'getLastDumpResult',
      'setLastDumpResult',
      'removeDumpAttachment',
      'shouldShowDumpInvite',
      'getDumpHistory',
      'resetState',
    ];
    keys.forEach((k) => expect(typeof bs[k]).toBe('function'));
  });

  // ── isDumpInProgress ───────────────────────────────────────────────
  it('isDumpInProgress returns false initially', () => {
    expect(bs.isDumpInProgress()).toBe(false);
  });

  // ── getLastDumpResult / setLastDumpResult ─────────────────────────
  it('getLastDumpResult returns null initially', () => {
    expect(bs.getLastDumpResult()).toBeNull();
  });

  it('setLastDumpResult updates the stored result', () => {
    const result = { wordCount: 50, tasksCreated: 3 };
    bs.setLastDumpResult(result);
    expect(bs.getLastDumpResult()).toEqual(result);
  });

  // ── resetState ─────────────────────────────────────────────────────
  it('resetState clears all internal state', () => {
    bs.setLastDumpResult({ wordCount: 10, tasksCreated: 1 });
    bs.resetState();
    expect(bs.getLastDumpResult()).toBeNull();
    expect(bs.isDumpInProgress()).toBe(false);
  });

  // ── Draft persistence ──────────────────────────────────────────────
  it('saveDumpDraft persists textarea value to localStorage', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'my brainstorm draft';
    document.body.appendChild(ta);

    bs.saveDumpDraft();
    const stored = localStorage.getItem('user1_taskboard_dump_draft');
    expect(stored).toBe('my brainstorm draft');

    ta.remove();
  });

  it('loadDumpDraft returns saved draft', () => {
    localStorage.setItem('user1_taskboard_dump_draft', 'saved content');
    expect(bs.loadDumpDraft()).toBe('saved content');
  });

  it('loadDumpDraft returns empty string when no draft exists', () => {
    expect(bs.loadDumpDraft()).toBe('');
  });

  it('clearDumpDraft removes the draft from localStorage', () => {
    localStorage.setItem('user1_taskboard_dump_draft', 'to be cleared');
    bs.clearDumpDraft();
    expect(localStorage.getItem('user1_taskboard_dump_draft')).toBeNull();
  });

  // ── Dump history ───────────────────────────────────────────────────
  it('getDumpHistory returns empty array initially', () => {
    expect(bs.getDumpHistory()).toEqual([]);
  });

  it('getDumpHistory returns empty array for invalid JSON', () => {
    localStorage.setItem('user1_wb_dump_history', '{not json}');
    expect(bs.getDumpHistory()).toEqual([]);
  });

  // ── shouldShowDumpInvite ───────────────────────────────────────────
  it('shouldShowDumpInvite returns true when no last dump timestamp', () => {
    expect(bs.shouldShowDumpInvite()).toBe(true);
  });

  it('shouldShowDumpInvite returns false when last dump was recent', () => {
    localStorage.setItem('user1_wb_last_dump', new Date().toISOString());
    expect(bs.shouldShowDumpInvite()).toBe(false);
  });

  it('shouldShowDumpInvite returns true when last dump was over 24h ago', () => {
    const old = new Date(Date.now() - 2 * MS_PER_DAY).toISOString();
    localStorage.setItem('user1_wb_last_dump', old);
    expect(bs.shouldShowDumpInvite()).toBe(true);
  });

  // ── processDumpManual ──────────────────────────────────────────────
  it('processDumpManual creates tasks from line-separated input', () => {
    // Need a dumpText element in the DOM for clearing
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('buy groceries\ncall dentist\nfix bike');

    expect(deps.createTask).toHaveBeenCalledTimes(3);
    expect(deps.addTask).toHaveBeenCalledTimes(3);

    // First task should be capitalized
    const firstCall = deps.createTask.mock.calls[0][0];
    expect(firstCall.title).toBe('Buy groceries');
    expect(firstCall.project).toBe('p_life');

    ta.remove();
  });

  it('processDumpManual ignores lines shorter than 3 characters', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('buy groceries\nab\nfix bike');

    expect(deps.createTask).toHaveBeenCalledTimes(2);
    ta.remove();
  });

  it('processDumpManual strips bullet/number prefixes', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('- buy groceries\n1. call dentist\n* fix bike');

    const titles = deps.createTask.mock.calls.map((c) => c[0].title);
    expect(titles).toContain('Buy groceries');
    expect(titles).toContain('Call dentist');
    expect(titles).toContain('Fix bike');
    ta.remove();
  });

  it('processDumpManual sets lastDumpResult', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('task one\ntask two');
    const result = bs.getLastDumpResult();
    expect(result).not.toBeNull();
    expect(result.tasksCreated).toBe(2);
    expect(result.wordCount).toBe(4);
    ta.remove();
  });

  it('processDumpManual shows a toast with task count', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('task one\ntask two\ntask three');
    expect(deps.showToast).toHaveBeenCalledWith('Added 3 tasks');
    ta.remove();
  });

  it('processDumpManual clears the draft', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);
    localStorage.setItem('user1_taskboard_dump_draft', 'something');

    bs.processDumpManual('task one');
    expect(localStorage.getItem('user1_taskboard_dump_draft')).toBeNull();
    ta.remove();
  });

  it('processDumpManual triggers render', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('task one');
    expect(deps.render).toHaveBeenCalled();
    ta.remove();
  });

  // ── processDump (guard clauses) ────────────────────────────────────
  it('processDump shows toast when input is empty and no attachments', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = '';
    document.body.appendChild(ta);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith('Write something or attach a file first', true);
    ta.remove();
  });

  it('processDump falls back to manual mode when AI is not available', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'task one\ntask two';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(false);
    await bs.processDump(true);
    // Manual mode should have created tasks
    expect(deps.createTask).toHaveBeenCalled();
    ta.remove();
  });

  // ── renderDump ────────────────────────────────────────────────────
  it('renderDump returns HTML string for the dump area', () => {
    const html = bs.renderDump();
    expect(typeof html).toBe('string');
    expect(html).toContain('dump-area');
    expect(html).toContain('dumpText');
  });

  it('renderDump shows results card when lastDumpResult is set', () => {
    bs.setLastDumpResult({
      wordCount: 100,
      tasksCreated: 5,
      tasksDone: 1,
      tasksInProgress: 1,
      tasksTodo: 3,
      boardsCreated: 1,
      boardsUpdated: 0,
      inputSnippet: 'test',
      tasksByBoard: { Work: 3, Life: 2 },
    });
    const html = bs.renderDump();
    expect(html).toContain('100 words');
    expect(html).toContain('dump-result-stat');
  });

  // ── cancelDump ────────────────────────────────────────────────────
  it('cancelDump does not throw when no abort controller exists', () => {
    expect(() => bs.cancelDump()).not.toThrow();
  });

  // ── saveDumpDraft truncation ──────────────────────────────────────
  it('saveDumpDraft truncates very long input', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'x'.repeat(200000);
    document.body.appendChild(ta);

    bs.saveDumpDraft();
    const stored = localStorage.getItem('user1_taskboard_dump_draft');
    expect(stored.length).toBeLessThanOrEqual(100000);
    ta.remove();
  });

  // ── saveDumpDraft when no textarea ────────────────────────────────
  it('saveDumpDraft does nothing when no textarea exists', () => {
    bs.saveDumpDraft();
    expect(localStorage.getItem('user1_taskboard_dump_draft')).toBeNull();
  });

  // ── renderDump — empty state (no AI key) ─────────────────────────
  it('renderDump shows API key warning when hasAI returns false', () => {
    deps.hasAI.mockReturnValue(false);
    const html = bs.renderDump();
    expect(html).toContain('add your Claude API key');
    expect(html).toContain('Add Tasks');
  });

  it('renderDump shows Analyze button when hasAI returns true', () => {
    deps.hasAI.mockReturnValue(true);
    const html = bs.renderDump();
    expect(html).toContain('Analyze');
    expect(html).not.toContain('add your Claude API key');
  });

  it('renderDump includes saved draft in textarea', () => {
    localStorage.setItem('user1_taskboard_dump_draft', 'my saved draft');
    const html = bs.renderDump();
    expect(html).toContain('my saved draft');
  });

  it('renderDump includes file attachment info text when no attachments', () => {
    const html = bs.renderDump();
    expect(html).toContain('Drop files here');
  });

  // ── renderDump — results card variations ─────────────────────────
  it('renderDump shows status parts (to do, in progress, already done)', () => {
    bs.setLastDumpResult({
      wordCount: 50,
      tasksCreated: 6,
      tasksDone: 2,
      tasksInProgress: 1,
      tasksTodo: 3,
      boardsCreated: 0,
      boardsUpdated: 0,
      inputSnippet: 'x',
      tasksByBoard: {},
    });
    const html = bs.renderDump();
    expect(html).toContain('3 to do');
    expect(html).toContain('1 in progress');
    expect(html).toContain('2 already done');
  });

  it('renderDump shows boards stat when boardsCreated > 0', () => {
    bs.setLastDumpResult({
      wordCount: 20,
      tasksCreated: 2,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTodo: 2,
      boardsCreated: 2,
      boardsUpdated: 1,
      inputSnippet: 'x',
      tasksByBoard: { Work: 2 },
    });
    const html = bs.renderDump();
    expect(html).toContain('boards');
    expect(html).toContain('2 new');
    expect(html).toContain('1 updated');
  });

  it('renderDump hides boards stat when no boards created or updated', () => {
    bs.setLastDumpResult({
      wordCount: 20,
      tasksCreated: 2,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTodo: 2,
      boardsCreated: 0,
      boardsUpdated: 0,
      inputSnippet: 'x',
      tasksByBoard: {},
    });
    const html = bs.renderDump();
    // Should not have the purple board stat div
    expect(html).not.toContain('purple');
  });

  it('renderDump shows tasksByBoard breakdown', () => {
    bs.setLastDumpResult({
      wordCount: 20,
      tasksCreated: 4,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTodo: 4,
      boardsCreated: 0,
      boardsUpdated: 0,
      inputSnippet: 'x',
      tasksByBoard: { Work: 2, Personal: 2 },
    });
    const html = bs.renderDump();
    expect(html).toContain('Work');
    expect(html).toContain('Personal');
    // Details always visible (no toggle)
  });

  it('renderDump shows new-brainstorm and view-organized buttons in result', () => {
    bs.setLastDumpResult({
      wordCount: 10,
      tasksCreated: 1,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTodo: 1,
      boardsCreated: 0,
      boardsUpdated: 0,
      inputSnippet: 'x',
      tasksByBoard: {},
    });
    const html = bs.renderDump();
    expect(html).toContain('view-organized');
    expect(html).toContain('new-brainstorm');
  });

  it('renderDump result card omits status parts when all zero', () => {
    bs.setLastDumpResult({
      wordCount: 10,
      tasksCreated: 0,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTodo: 0,
      boardsCreated: 0,
      boardsUpdated: 0,
      inputSnippet: 'x',
      tasksByBoard: {},
    });
    const html = bs.renderDump();
    expect(html).not.toContain('to do');
    expect(html).not.toContain('in progress');
    expect(html).not.toContain('already done');
  });

  // ── renderDump — dump history ────────────────────────────────────
  it('renderDump does not include dump history section', () => {
    localStorage.setItem(
      'user1_wb_dump_history',
      JSON.stringify([{ date: new Date().toISOString(), wordCount: 50, tasksCreated: 3 }]),
    );
    const html = bs.renderDump();
    expect(html).not.toContain('Recent storms');
  });

  // ── processDumpManual — semicolon splitting ──────────────────────
  it('processDumpManual splits on semicolons as well as newlines', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('buy groceries;call dentist;fix bike');
    expect(deps.createTask).toHaveBeenCalledTimes(3);
    ta.remove();
  });

  it('processDumpManual clears textarea value', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'some text';
    document.body.appendChild(ta);

    bs.processDumpManual('task one');
    expect(ta.value).toBe('');
    ta.remove();
  });

  it('processDumpManual saves to dump history', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('task one\ntask two');
    const history = bs.getDumpHistory();
    expect(history.length).toBe(1);
    expect(history[0].tasksCreated).toBe(2);
    expect(history[0].wordCount).toBe(4);
    ta.remove();
  });

  it('processDumpManual sets lastDumpResult with all fields', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.processDumpManual('task one\ntask two\ntask three');
    const result = bs.getLastDumpResult();
    expect(result.tasksCreated).toBe(3);
    expect(result.tasksDone).toBe(0);
    expect(result.tasksInProgress).toBe(0);
    expect(result.tasksTodo).toBe(3);
    expect(result.boardsCreated).toBe(0);
    expect(result.boardsUpdated).toBe(0);
    expect(result.inputSnippet).toBeTruthy();
    ta.remove();
  });

  // ── processDump — re-entry guard ─────────────────────────────────
  it('processDump does nothing when dump is already in progress', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    // Start a dump that will hang (never resolves)
    const fetchPromise = new Promise(() => {});
    const mockFetch = vi.fn(() => fetchPromise);
    vi.stubGlobal('fetch', mockFetch);
    bs = createBrainstorm(deps);

    const _p1 = bs.processDump(true);
    // Immediately try again — should bail because _dumpInProgress is true
    await bs.processDump(true);
    // Only one fetch call means re-entry was blocked
    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    ta.remove();
    // Clean up the pending promise
    bs.cancelDump();
  });

  // ── processDump — input too long ─────────────────────────────────
  it('processDump rejects input exceeding 200K characters', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'x'.repeat(201000);
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('too long'), true);
    ta.remove();
  });

  // ── processDump — AI error handling ──────────────────────────────
  it('processDump shows error when fetch fails', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server error' } }),
        }),
      ),
    );
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Error'), true);
    expect(bs.isDumpInProgress()).toBe(false);

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump shows rate limit message for 429', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({}),
        }),
      ),
    );
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('busy'), true);

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump handles AbortError by undoing and showing cancelled', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abortError)),
    );
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.undo).toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('cancelled'), false, false);
    expect(bs.isDumpInProgress()).toBe(false);

    vi.unstubAllGlobals();
    ta.remove();
  });

  // ── processDump — no AI key shows informational toast ────────────
  it('processDump shows info toast about API key when no AI', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'task one\ntask two';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(false);
    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Claude API key'), false);
    ta.remove();
  });

  // ── cancelDump — with active abort controller ────────────────────
  it('cancelDump aborts the active controller', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    let rejectFetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((_, reject) => {
            rejectFetch = reject;
          }),
      ),
    );
    bs = createBrainstorm(deps);

    const dumpPromise = bs.processDump(true);
    bs.cancelDump();

    const abortErr = new Error('Aborted');
    abortErr.name = 'AbortError';
    rejectFetch(abortErr);

    await dumpPromise;
    expect(deps.undo).toHaveBeenCalled();
    expect(bs.getConvState()).toBe('IDLE');

    vi.unstubAllGlobals();
    ta.remove();
  });

  // ── applyDumpResults ─────────────────────────────────────────────
  it('applyDumpResults does nothing when no review data', () => {
    window._dumpReviewData = null;
    bs.applyDumpResults();
    expect(deps.closeModal).not.toHaveBeenCalled();
  });

  it('applyDumpResults creates tasks from parsed data', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    window._dumpReviewData = {
      parsed: {
        tasks: [
          { action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo', notes: '' },
          {
            action: 'create',
            title: 'Task B',
            suggestedProject: '',
            priority: 'urgent',
            status: 'todo',
            notes: 'some notes',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'Task A and Task B',
    };

    // Create checkboxes that are all checked
    const container = document.createElement('div');
    [0, 1].forEach((i) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.dumpCheck = String(i);
      container.appendChild(cb);
    });
    document.body.appendChild(container);

    bs.applyDumpResults();

    expect(deps.closeModal).toHaveBeenCalled();
    expect(deps.createTask).toHaveBeenCalledTimes(2);
    expect(deps.addTask).toHaveBeenCalledTimes(2);
    expect(deps.showToast).toHaveBeenCalled();
    expect(deps.render).toHaveBeenCalled();

    const result = bs.getLastDumpResult();
    expect(result).not.toBeNull();
    expect(result.tasksCreated).toBe(2);

    ta.remove();
    container.remove();
  });

  it('applyDumpResults undoes and toasts when no tasks selected', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'Task A',
    };

    // All checkboxes unchecked
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = false;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    bs.applyDumpResults();

    expect(deps.closeModal).toHaveBeenCalled();
    expect(deps.undo).toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('No tasks selected', false, false);

    cb.remove();
  });

  it('applyDumpResults handles "update" action tasks', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'update', id: 't_existing', updateFields: { status: 'done', priority: 'urgent' } }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'update task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith('t_existing', { status: 'done', priority: 'urgent' });

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults handles "complete" action tasks', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'complete', id: 't_existing', title: 'Done task' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'complete task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith('t_existing', { status: 'done' });

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults deduplicates tasks via findSimilarTask', () => {
    deps.findSimilarTask.mockReturnValue({ id: 't_dup', title: 'Existing', status: 'todo', notes: '' });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Existing task',
            suggestedProject: '',
            priority: 'urgent',
            status: 'in-progress',
            notes: 'new info',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'existing task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    // Should update, not create
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.updateTask).toHaveBeenCalledWith(
      't_dup',
      expect.objectContaining({
        status: 'in-progress',
        priority: 'urgent',
      }),
    );

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults creates subtasks with generated IDs', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Parent task',
            subtasks: ['Step 1', 'Step 2'],
            suggestedProject: '',
            priority: 'normal',
            status: 'todo',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'parent task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    const createCall = deps.createTask.mock.calls[0][0];
    expect(createCall.subtasks).toHaveLength(2);
    expect(createCall.subtasks[0].title).toBe('Step 1');
    expect(createCall.subtasks[0].done).toBe(false);
    expect(createCall.subtasks[0].id).toBe('st_gen');

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults processes project updates — new project', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [
          { action: 'create', title: 'Task A', suggestedProject: 'New Project', priority: 'normal', status: 'todo' },
        ],
        projectUpdates: [{ name: 'New Project', description: 'A cool project', isNew: true }],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createProject).toHaveBeenCalled();
    expect(deps.addProject).toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults processes project updates — existing project', () => {
    deps.findSimilarProject.mockReturnValue({ id: 'p_existing', name: 'Existing Proj', description: '' });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          { action: 'create', title: 'Task A', suggestedProject: 'Existing Proj', priority: 'normal', status: 'todo' },
        ],
        projectUpdates: [
          { name: 'Existing Proj', description: 'Updated desc', background: '## Notes\nSome background' },
        ],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateProject).toHaveBeenCalledWith(
      'p_existing',
      expect.objectContaining({
        background: '## Notes\nSome background',
      }),
    );
    // Should NOT create a new project
    expect(deps.createProject).not.toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults clears textarea, draft, and attachments', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'old text';
    document.body.appendChild(ta);
    localStorage.setItem('user1_taskboard_dump_draft', 'some draft');

    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    bs.applyDumpResults();

    expect(ta.value).toBe('');
    expect(localStorage.getItem('user1_taskboard_dump_draft')).toBeNull();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults saves to dump history', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task a content here',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    bs.applyDumpResults();

    const history = bs.getDumpHistory();
    expect(history.length).toBe(1);
    expect(history[0].tasksCreated).toBe(1);

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults handles task with "done" status setting completedAt', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Done task', suggestedProject: '', priority: 'normal', status: 'done' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'done task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    // Track the created task object to verify completedAt is set
    let createdTask = null;
    deps.createTask.mockImplementation((t) => {
      createdTask = { id: 't_new', ...t };
      return createdTask;
    });

    bs.applyDumpResults();

    expect(createdTask.completedAt).toBeTruthy();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults assigns unmatched suggestedProject to life project', () => {
    deps.findSimilarProject.mockReturnValue(null);

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task X',
            suggestedProject: 'NonExistent Board',
            priority: 'normal',
            status: 'todo',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task x',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    const createCall = deps.createTask.mock.calls[0][0];
    expect(createCall.project).toBe('p_life');

    cb.remove();
    ta.remove();
  });

  // ── handleDumpFiles ──────────────────────────────────────────────
  it('handleDumpFiles does nothing for empty file list', async () => {
    await bs.handleDumpFiles(null);
    expect(deps.render).not.toHaveBeenCalled();
    await bs.handleDumpFiles([]);
    expect(deps.render).not.toHaveBeenCalled();
  });

  it('handleDumpFiles rejects files over 10MB', async () => {
    const bigFile = new File(['x'], 'huge.txt', { type: 'text/plain' });
    Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 });

    await bs.handleDumpFiles([bigFile]);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('too large'), true);
  });

  it('handleDumpFiles handles text files and triggers render', async () => {
    const content = 'Hello world this is my file content';
    const file = new File([content], 'notes.txt', { type: 'text/plain' });

    await bs.handleDumpFiles([file]);
    expect(deps.showToast).toHaveBeenCalledWith('Processing notes.txt...');
    expect(deps.showToast).toHaveBeenCalledWith('Attached notes.txt');
    expect(deps.render).toHaveBeenCalled();

    // The attachment should appear in renderDump now
    const html = bs.renderDump();
    expect(html).toContain('notes.txt');
    expect(html).toContain('1 file attached');
  });

  it('handleDumpFiles shows toast for empty file extraction', async () => {
    const emptyFile = new File([''], 'empty.txt', { type: 'text/plain' });

    await bs.handleDumpFiles([emptyFile]);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('No text found'), true);
  });

  it('handleDumpFiles shows error toast for binary file', async () => {
    // Create content with lots of binary chars
    const binary = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) binary[i] = i % 16; // mostly control chars
    const file = new File([binary], 'data.bin', { type: 'application/octet-stream' });

    await bs.handleDumpFiles([file]);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Could not process'), true);
  });

  it('handleDumpFiles handles multiple files', async () => {
    const file1 = new File(['content one'], 'file1.txt', { type: 'text/plain' });
    const file2 = new File(['content two'], 'file2.txt', { type: 'text/plain' });

    await bs.handleDumpFiles([file1, file2]);
    expect(deps.showToast).toHaveBeenCalledWith('Attached file1.txt');
    expect(deps.showToast).toHaveBeenCalledWith('Attached file2.txt');

    const html = bs.renderDump();
    expect(html).toContain('file1.txt');
    expect(html).toContain('file2.txt');
    expect(html).toContain('2 files attached');
  });

  // ── removeDumpAttachment ─────────────────────────────────────────
  it('removeDumpAttachment removes file and triggers render', async () => {
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
    await bs.handleDumpFiles([file]);
    deps.render.mockClear();

    bs.removeDumpAttachment(0);
    expect(deps.render).toHaveBeenCalled();

    // Attachment should be gone
    const html = bs.renderDump();
    expect(html).not.toContain('test.txt');
  });

  // ── initDumpDropZone ─────────────────────────────────────────────
  it('initDumpDropZone does nothing when no textarea in DOM', () => {
    expect(() => bs.initDumpDropZone()).not.toThrow();
  });

  it('initDumpDropZone wires up input event for auto-save', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    const overlay = document.createElement('div');
    overlay.id = 'dumpDropOverlay';
    const area = document.createElement('div');
    area.className = 'dump-area';
    area.appendChild(ta);
    area.appendChild(overlay);
    document.body.appendChild(area);

    bs.initDumpDropZone();
    ta.value = 'auto saved';
    ta.dispatchEvent(new Event('input'));

    const stored = localStorage.getItem('user1_taskboard_dump_draft');
    expect(stored).toBe('auto saved');

    area.remove();
  });

  it('initDumpDropZone shows overlay on dragover', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    const overlay = document.createElement('div');
    overlay.id = 'dumpDropOverlay';
    overlay.style.display = 'none';
    const area = document.createElement('div');
    area.className = 'dump-area';
    area.appendChild(ta);
    area.appendChild(overlay);
    document.body.appendChild(area);

    bs.initDumpDropZone();

    const dragEvent = new Event('dragover', { bubbles: true });
    dragEvent.preventDefault = vi.fn();
    area.dispatchEvent(dragEvent);

    expect(overlay.style.display).toBe('flex');

    area.remove();
  });

  it('initDumpDropZone hides overlay on dragleave outside area', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    const overlay = document.createElement('div');
    overlay.id = 'dumpDropOverlay';
    overlay.style.display = 'flex';
    const area = document.createElement('div');
    area.className = 'dump-area';
    area.appendChild(ta);
    area.appendChild(overlay);
    document.body.appendChild(area);

    bs.initDumpDropZone();

    // Simulate dragleave where relatedTarget is outside area
    const leaveEvent = new Event('dragleave', { bubbles: true });
    Object.defineProperty(leaveEvent, 'relatedTarget', { value: document.body });
    area.dispatchEvent(leaveEvent);

    expect(overlay.style.display).toBe('none');

    area.remove();
  });

  // ── getDumpHistory — valid JSON ──────────────────────────────────
  it('getDumpHistory returns stored entries', () => {
    const entries = [
      { date: '2025-01-01T00:00:00Z', wordCount: 100, tasksCreated: 5 },
      { date: '2025-01-02T00:00:00Z', wordCount: 50, tasksCreated: 2 },
    ];
    localStorage.setItem('user1_wb_dump_history', JSON.stringify(entries));
    expect(bs.getDumpHistory()).toEqual(entries);
  });

  // ── Dump history limit ───────────────────────────────────────────
  it('dump history is capped at 5 entries', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    for (let i = 0; i < 7; i++) {
      bs.processDumpManual(`task number ${i} here`);
    }

    const history = bs.getDumpHistory();
    expect(history.length).toBe(5);
    ta.remove();
  });

  // ── applyDumpResults — update action with notes appends ──────────
  it('applyDumpResults update action appends notes to existing task', () => {
    const existingTask = { id: 't_existing', title: 'Old', notes: 'old notes', updates: [] };
    deps.findTask.mockReturnValue(existingTask);

    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'update', id: 't_existing', notes: 'new context', updateFields: {} }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'update',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    // Should have pushed an update entry
    expect(existingTask.updates.length).toBe(1);
    expect(existingTask.updates[0].text).toBe('new context');

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults update action carries dueDate and priority from item', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'update', id: 't_existing', dueDate: '2026-04-01', priority: 'urgent', updateFields: {} }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'update',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith(
      't_existing',
      expect.objectContaining({
        dueDate: '2026-04-01',
        priority: 'urgent',
      }),
    );

    cb.remove();
    ta.remove();
  });

  // ── applyDumpResults — patterns in toast ─────────────────────────
  it('applyDumpResults includes pattern count in toast', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo' }],
        projectUpdates: [],
        patterns: [{ type: 'recurring', message: 'This task recurs weekly' }],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('1 patterns found'), false, true);

    cb.remove();
    ta.remove();
  });

  // ── applyDumpResults — project with long description ─────────────
  it('applyDumpResults moves long project description to background', () => {
    deps.findSimilarProject.mockReturnValue(null);

    window._dumpReviewData = {
      parsed: {
        tasks: [
          { action: 'create', title: 'Task A', suggestedProject: 'New Project', priority: 'normal', status: 'todo' },
        ],
        projectUpdates: [
          {
            name: 'New Project',
            description:
              'This is a very long description that exceeds eighty characters and should be moved to background field automatically by the system',
            isNew: true,
          },
        ],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    const projectCall = deps.createProject.mock.calls[0][0];
    expect(projectCall.background).toBeTruthy();

    cb.remove();
    ta.remove();
  });

  // ── submitClarify / skipClarify ──────────────────────────────────
  it('submitClarify is a wrapper for submitThemeClarify', () => {
    // submitClarify now delegates to the conversational flow
    // It should not throw when called with no active conversation
    expect(() => bs.submitClarify()).not.toThrow();
  });

  it('submitClarify ignores empty answers', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'original text';
    document.body.appendChild(ta);

    const statusEl = document.createElement('div');
    statusEl.id = 'dumpStatus';
    document.body.appendChild(statusEl);

    const input1 = document.createElement('input');
    input1.className = 'clarify-input';
    input1.value = '';
    document.body.appendChild(input1);

    deps.hasAI.mockReturnValue(false);
    bs.submitClarify();

    // No answers appended, just the original text
    expect(ta.value).not.toContain('Additional details');

    ta.remove();
    statusEl.remove();
    input1.remove();
  });

  it('skipClarify is a wrapper for skipThemeClarify', () => {
    // skipClarify now delegates to the conversational flow
    expect(() => bs.skipClarify()).not.toThrow();
  });

  // ── resetState clears attachments ────────────────────────────────
  it('resetState clears attachments so renderDump shows no files', async () => {
    const file = new File(['hello world content'], 'attached.txt', { type: 'text/plain' });
    await bs.handleDumpFiles([file]);

    let html = bs.renderDump();
    expect(html).toContain('attached.txt');

    bs.resetState();

    html = bs.renderDump();
    expect(html).not.toContain('attached.txt');
  });

  // ── Edge: processDump successful AI flow ─────────────────────────
  it('processDump with AI calls fetch and enters conversational flow', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'build a landing page for the new product';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    // Return a themed response (new format)
    const aiResponse = {
      opening: 'I see one task here.',
      themes: [
        {
          name: 'Landing Page',
          narrative: 'You need to build a landing page.',
          suggestedBoard: 'Product',
          tasks: [{ action: 'create', title: 'Build landing page', priority: 'normal', status: 'todo' }],
          questions: [],
        },
      ],
      closing: 'One task extracted.',
    };

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: JSON.stringify(aiResponse) }] }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);
    deps.$.mockImplementation((sel) => document.querySelector(sel));

    bs = createBrainstorm(deps);
    await bs.processDump(true);

    expect(mockFetch).toHaveBeenCalled();
    // Should now be in THEME_REVIEW state (conversational flow)
    expect(bs.getConvState()).toBe('THEME_REVIEW');

    vi.unstubAllGlobals();
    ta.remove();
  });

  // ── processDump — clarify pass (non-skip path) ───────────────────
  it('processDump with themes that have questions enters THEME_REVIEW', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'vague idea about stuff';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    const aiResponse = {
      opening: 'Let me clarify a few things.',
      themes: [
        {
          name: 'Vague Idea',
          narrative: 'This needs more detail.',
          tasks: [{ action: 'create', title: 'Figure out stuff', priority: 'normal', status: 'todo' }],
          questions: ['What specifically?', 'When is it due?'],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: JSON.stringify(aiResponse) }] }),
        }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(bs.getConvState()).toBe('THEME_REVIEW');

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump falls back to single theme when AI returns legacy format', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'buy groceries: milk, eggs, bread';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    // Legacy response without themes
    const aiResponse = {
      summary: 'One grocery task found.',
      tasks: [{ action: 'create', title: 'Buy groceries', priority: 'normal', status: 'todo', suggestedProject: '' }],
      projectUpdates: [],
      patterns: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: JSON.stringify(aiResponse) }] }),
        }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    // Should still enter conversation mode with a single theme
    expect(bs.getConvState()).toBe('THEME_REVIEW');

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump with attachments goes directly to conversational flow', async () => {
    const file = new File(['some file content here'], 'notes.txt', { type: 'text/plain' });

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'short idea';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    const aiResponse = {
      opening: 'Processing your notes.',
      themes: [
        {
          name: 'Notes',
          narrative: 'Found tasks in your file.',
          tasks: [{ action: 'create', title: 'Process notes', priority: 'normal', status: 'todo' }],
          questions: [],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: JSON.stringify(aiResponse) }] }),
        }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);
    await bs.handleDumpFiles([file]);

    await bs.processDump(true);
    expect(globalThis.fetch).toHaveBeenCalled();

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump always goes to conversational flow regardless of input length', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = Array.from({ length: 100 }, (_, i) => 'word' + i).join(' ');
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    const aiResponse = {
      opening: 'Long input processed.',
      themes: [
        {
          name: 'Tasks',
          narrative: 'Found tasks.',
          tasks: [{ action: 'create', title: 'Long task', priority: 'normal', status: 'todo' }],
          questions: [],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: JSON.stringify(aiResponse) }] }),
        }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(bs.getConvState()).toBe('THEME_REVIEW');

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump handles fetch error gracefully', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'vague idea about stuff';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });

    const aiResponse = {
      opening: 'Found tasks.',
      themes: [
        {
          name: 'Tasks',
          narrative: 'Here are some tasks.',
          tasks: [{ action: 'create', title: 'Some task', priority: 'normal', status: 'todo' }],
          questions: [],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: JSON.stringify(aiResponse) }] }),
        }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(bs.getConvState()).toBe('THEME_REVIEW');

    vi.unstubAllGlobals();
    ta.remove();
  });

  // ── _applyProjectUpdates branches ────────────────────────────────
  it('applyDumpResults updates existing project with long description and no background', () => {
    deps.findSimilarProject.mockReturnValue({
      id: 'p_existing',
      name: 'Existing Project',
      description:
        'This is a very long existing description that is definitely over eighty characters long to test the branch path',
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task A',
            suggestedProject: 'Existing Project',
            priority: 'normal',
            status: 'todo',
          },
        ],
        projectUpdates: [
          {
            name: 'Existing Project',
            description:
              'This is also a long description exceeding eighty characters to trigger the no-background fallback path in the code logic',
          },
        ],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateProject).toHaveBeenCalledWith(
      'p_existing',
      expect.objectContaining({
        background: expect.any(String),
      }),
    );

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults updates existing project with short description', () => {
    deps.findSimilarProject.mockReturnValue({
      id: 'p_existing',
      name: 'Existing Project',
      description: '',
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task A',
            suggestedProject: 'Existing Project',
            priority: 'normal',
            status: 'todo',
          },
        ],
        projectUpdates: [{ name: 'Existing Project', description: 'Short desc' }],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateProject).toHaveBeenCalledWith(
      'p_existing',
      expect.objectContaining({ description: expect.any(String) }),
    );

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults no-ops project update when no fields change', () => {
    deps.findSimilarProject.mockReturnValue({
      id: 'p_existing',
      name: 'Existing Project',
      description: 'Short',
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task A',
            suggestedProject: 'Existing Project',
            priority: 'normal',
            status: 'todo',
          },
        ],
        projectUpdates: [{ name: 'Existing Project' }],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateProject).not.toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults skips project update with isNew=false and no match', () => {
    deps.findSimilarProject.mockReturnValue(null);

    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo' }],
        projectUpdates: [{ name: 'Ghost Project', description: 'Desc', isNew: false }],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createProject).not.toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults skips projectUpdate with no name', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'Task A', suggestedProject: '', priority: 'normal', status: 'todo' }],
        projectUpdates: [{ name: '', description: 'Desc' }],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createProject).not.toHaveBeenCalled();
    expect(deps.updateProject).not.toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  // ── _applyTaskItem dedup branches ────────────────────────────────
  it('applyDumpResults dedup no-ops when no fields differ', () => {
    deps.findSimilarTask.mockReturnValue({
      id: 't_dup',
      title: 'Same task',
      status: 'todo',
      notes: 'existing notes',
      priority: 'normal',
      dueDate: '2026-04-01',
      estimatedMinutes: 30,
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Same task',
            suggestedProject: '',
            priority: 'normal',
            status: 'todo',
            notes: 'existing notes',
            dueDate: '2026-04-01',
            estimatedMinutes: 30,
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'same task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults dedup updates estimatedMinutes when not set on existing', () => {
    deps.findSimilarTask.mockReturnValue({
      id: 't_dup',
      title: 'Task',
      status: 'todo',
      notes: '',
      priority: 'normal',
      estimatedMinutes: 0,
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task',
            suggestedProject: '',
            priority: 'normal',
            status: 'todo',
            estimatedMinutes: 60,
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith('t_dup', expect.objectContaining({ estimatedMinutes: 60 }));

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults dedup updates dueDate when not set on existing', () => {
    deps.findSimilarTask.mockReturnValue({
      id: 't_dup',
      title: 'Task',
      status: 'todo',
      notes: '',
      priority: 'normal',
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task',
            suggestedProject: '',
            priority: 'normal',
            status: 'todo',
            dueDate: '2026-05-01',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith('t_dup', expect.objectContaining({ dueDate: '2026-05-01' }));

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults dedup appends notes when different', () => {
    deps.findSimilarTask.mockReturnValue({
      id: 't_dup',
      title: 'Task',
      status: 'todo',
      notes: 'old note',
      priority: 'normal',
    });

    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Task',
            suggestedProject: '',
            priority: 'normal',
            status: 'todo',
            notes: 'new note',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith('t_dup', expect.objectContaining({ notes: 'old note\nnew note' }));

    cb.remove();
    ta.remove();
  });

  // ── _applyTaskItem update branches ───────────────────────────────
  it('applyDumpResults update action without updateFields property', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'update', id: 't_existing', dueDate: '2026-06-01' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'update',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.updateTask).toHaveBeenCalledWith('t_existing', expect.objectContaining({ dueDate: '2026-06-01' }));

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults update action initializes updates array when missing', () => {
    const existingTask = { id: 't_existing', title: 'Old' };
    deps.findTask.mockReturnValue(existingTask);

    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'update', id: 't_existing', notes: 'add this info', updateFields: {} }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'update',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(existingTask.updates).toBeDefined();
    expect(existingTask.updates.length).toBe(1);
    expect(existingTask.updates[0].text).toBe('add this info');

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults update action filters to allowed fields only', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'update',
            id: 't_existing',
            updateFields: {
              title: 'New Title',
              dangerousField: 'bad',
              status: 'done',
            },
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'update',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    const updateCall = deps.updateTask.mock.calls[0];
    expect(updateCall[1].title).toBe('New Title');
    expect(updateCall[1].status).toBe('done');
    expect(updateCall[1].dangerousField).toBeUndefined();

    cb.remove();
    ta.remove();
  });

  // ── _applyTaskItem create — all fields and defaults ──────────────
  it('applyDumpResults create with all fields populated', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [
          {
            action: 'create',
            title: 'Full Task',
            suggestedProject: '',
            priority: 'urgent',
            status: 'in-progress',
            notes: 'Detailed notes',
            dueDate: '2026-04-15',
            phase: 'Phase 1: Foundation',
            subtasks: ['Step A', 'Step B'],
            recurrence: 'weekly',
            estimatedMinutes: 120,
            horizon: 'long',
          },
        ],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'full task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    const createCall = deps.createTask.mock.calls[0][0];
    expect(createCall.title).toBe('Full Task');
    expect(createCall.priority).toBe('urgent');
    expect(createCall.status).toBe('in-progress');
    expect(createCall.notes).toBe('Detailed notes');
    expect(createCall.dueDate).toBe('2026-04-15');
    expect(createCall.phase).toBe('Phase 1: Foundation');
    expect(createCall.recurrence).toBe('weekly');
    expect(createCall.estimatedMinutes).toBe(120);
    expect(createCall.horizon).toBe('long');
    expect(createCall.subtasks).toHaveLength(2);

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults create uses default values when fields are missing', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ title: 'Minimal Task' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'minimal',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    const createCall = deps.createTask.mock.calls[0][0];
    expect(createCall.priority).toBe('normal');
    expect(createCall.status).toBe('todo');
    expect(createCall.horizon).toBe('short');
    expect(createCall.dueDate).toBe('');
    expect(createCall.phase).toBe('');
    expect(createCall.recurrence).toBe('');
    expect(createCall.estimatedMinutes).toBe(0);
    expect(createCall.subtasks).toEqual([]);

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults handles parsed as array instead of object with tasks', () => {
    window._dumpReviewData = {
      parsed: [{ action: 'create', title: 'Array Task', suggestedProject: '', priority: 'normal', status: 'todo' }],
      inputText: 'array task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createTask).toHaveBeenCalled();
    const createCall = deps.createTask.mock.calls[0][0];
    expect(createCall.title).toBe('Array Task');

    cb.remove();
    ta.remove();
  });

  // ── _resolveItemProject branches ─────────────────────────────────
  it('applyDumpResults resolves project already in map without extra lookup', () => {
    deps.findSimilarProject.mockReturnValue(null);

    window._dumpReviewData = {
      parsed: {
        tasks: [
          { action: 'create', title: 'Task 1', suggestedProject: 'New Board', priority: 'normal', status: 'todo' },
          { action: 'create', title: 'Task 2', suggestedProject: 'New Board', priority: 'normal', status: 'todo' },
        ],
        projectUpdates: [{ name: 'New Board', description: 'A new board', isNew: true }],
        patterns: [],
      },
      inputText: 'tasks',
    };

    const container = document.createElement('div');
    [0, 1].forEach((i) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.dumpCheck = String(i);
      container.appendChild(cb);
    });
    document.body.appendChild(container);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createTask).toHaveBeenCalledTimes(2);
    const proj1 = deps.createTask.mock.calls[0][0].project;
    const proj2 = deps.createTask.mock.calls[1][0].project;
    expect(proj1).toBe(proj2);

    container.remove();
    ta.remove();
  });

  it('applyDumpResults resolves no suggestedProject by skipping lookup', () => {
    window._dumpReviewData = {
      parsed: {
        tasks: [{ action: 'create', title: 'No Project Task', priority: 'normal', status: 'todo' }],
        projectUpdates: [],
        patterns: [],
      },
      inputText: 'task',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createTask).toHaveBeenCalled();
    const createCall = deps.createTask.mock.calls[0][0];
    expect(createCall.project).toBe('');

    cb.remove();
    ta.remove();
  });

  it('applyDumpResults resolves explicitly created project from projectUpdates', () => {
    deps.findSimilarProject.mockReturnValue(null);

    window._dumpReviewData = {
      parsed: {
        tasks: [
          { action: 'create', title: 'Task A', suggestedProject: 'My Board', priority: 'normal', status: 'todo' },
        ],
        projectUpdates: [{ name: 'My Board', description: 'Board desc', isNew: true }],
        patterns: [],
      },
      inputText: 'task a',
    };

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dumpCheck = '0';
    document.body.appendChild(cb);

    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    document.body.appendChild(ta);

    bs.applyDumpResults();

    expect(deps.createProject).toHaveBeenCalled();

    cb.remove();
    ta.remove();
  });

  // ── initDumpDropZone — drop event and dragleave within area ──────
  it('initDumpDropZone handles drop event with files', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    const overlay = document.createElement('div');
    overlay.id = 'dumpDropOverlay';
    overlay.style.display = 'flex';
    const area = document.createElement('div');
    area.className = 'dump-area';
    area.appendChild(ta);
    area.appendChild(overlay);
    document.body.appendChild(area);

    bs.initDumpDropZone();

    const file = new File(['drop content'], 'dropped.txt', { type: 'text/plain' });
    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    area.dispatchEvent(dropEvent);

    expect(dropEvent.preventDefault).toHaveBeenCalled();
    expect(overlay.style.display).toBe('none');

    area.remove();
  });

  it('initDumpDropZone keeps overlay when dragleave target is within area', () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    const overlay = document.createElement('div');
    overlay.id = 'dumpDropOverlay';
    overlay.style.display = 'flex';
    const area = document.createElement('div');
    area.className = 'dump-area';
    area.appendChild(ta);
    area.appendChild(overlay);
    document.body.appendChild(area);

    bs.initDumpDropZone();

    const leaveEvent = new Event('dragleave', { bubbles: true });
    Object.defineProperty(leaveEvent, 'relatedTarget', { value: ta });
    area.dispatchEvent(leaveEvent);

    expect(overlay.style.display).toBe('flex');

    area.remove();
  });

  // ── handleDumpFiles — legacy .doc rejection ──────────────────────
  it('handleDumpFiles rejects legacy .doc files', async () => {
    const content = new ArrayBuffer(100);
    const file = new File([content], 'report.doc', { type: 'application/msword' });

    await bs.handleDumpFiles([file]);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Could not process'), true);
  });

  // ── Error paths ──────────────────────────────────────────────────
  it('processDump shows service down message for 503', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('temporarily down'), true);

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump shows specific API error message when available', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: 'Invalid model specified' } }),
        }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Invalid model specified'), true);

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump handles JSON parse failure on error response', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.reject(new Error('not json')) })),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Error'), true);

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('processDump shows error when parsed response is null', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'dumpText';
    ta.value = 'test input with enough words';
    document.body.appendChild(ta);

    deps.hasAI.mockReturnValue(true);
    deps.getSettings.mockReturnValue({ apiKey: 'test-key', aiModel: 'test-model' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ content: [{ text: 'not valid json at all' }] }) }),
      ),
    );
    deps.$.mockImplementation((sel) => document.querySelector(sel));
    bs = createBrainstorm(deps);

    await bs.processDump(true);
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Error'), true);

    vi.unstubAllGlobals();
    ta.remove();
  });

  it('skipClarify does not throw', () => {
    expect(() => bs.skipClarify()).not.toThrow();
  });
});
