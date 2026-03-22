import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWeeklyReview } from '../weekly-review.js';

function makeDeps(overrides = {}) {
  const now = new Date();
  const todayISO =
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0');

  const store = {
    tasks: [
      {
        id: 't1',
        title: 'Done task',
        status: 'done',
        priority: 'normal',
        createdAt: now.toISOString(),
        completedAt: now.toISOString(),
        project: 'p1',
        tags: [],
      },
      {
        id: 't2',
        title: 'Active task',
        status: 'todo',
        priority: 'urgent',
        createdAt: now.toISOString(),
        completedAt: null,
        project: 'p1',
        dueDate: todayISO,
        tags: [],
      },
      {
        id: 't3',
        title: 'In progress',
        status: 'in-progress',
        priority: 'normal',
        createdAt: now.toISOString(),
        completedAt: null,
        project: 'p2',
        tags: [],
      },
    ],
    projects: [
      { id: 'p1', name: 'Work', color: '#818cf8' },
      { id: 'p2', name: 'Personal', color: '#f472b6' },
    ],
  };

  return {
    store,
    todayISO,
    deps: {
      data: store,
      userKey: (k) => 'test_' + k,
      activeTasks: vi.fn((pid) => {
        const tasks = pid ? store.tasks.filter((t) => t.project === pid) : store.tasks;
        return tasks.filter((t) => t.status !== 'done');
      }),
      projectTasks: vi.fn((pid) => store.tasks.filter((t) => t.project === pid)),
      hasAI: vi.fn(() => true),
      callAI: vi.fn().mockResolvedValue('AI review content here'),
      getAIMemory: vi.fn(() => []),
      esc: (s) =>
        String(s || '')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;'),
      sanitizeAIHTML: (s) => {
        if (s == null) return '';
        let out = String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*(.*?)\*/g, '<em>$1</em>');
        out = out.replace(/\n/g, '<br>');
        return out;
      },
      localISO: (d) =>
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
      todayStr: vi.fn(() => todayISO),
      showToast: vi.fn(),
      getChatHistory: vi.fn(() => []),
      saveChatHistory: vi.fn(),
      chatTimeStr: vi.fn(() => '10:00 AM'),
      getChatSessionStarted: vi.fn(() => false),
      setChatSessionStarted: vi.fn(),
      ...overrides,
    },
  };
}

describe('weekly-review.js', () => {
  let review;
  let store;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    const made = makeDeps();
    store = made.store;
    deps = made.deps;
    review = createWeeklyReview(deps);
  });

  it('returns all expected functions', () => {
    expect(typeof review.renderWeeklyReview).toBe('function');
    expect(typeof review.generateWeeklyReview).toBe('function');
    expect(typeof review.discussReview).toBe('function');
  });

  describe('renderWeeklyReview()', () => {
    it('returns HTML string', () => {
      const html = review.renderWeeklyReview();
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(100);
    });

    it('includes week date range', () => {
      const html = review.renderWeeklyReview();
      expect(html).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
    });

    it('shows completed task count', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('Completed');
    });

    it('shows in-progress task count', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('In Progress');
    });

    it('shows project stats', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('Work');
    });

    it('includes generate review button when AI available', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('generate-review');
    });

    it('shows cached review when available', () => {
      const now = new Date();
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      const weekStart =
        mon.getFullYear() +
        '-' +
        String(mon.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(mon.getDate()).padStart(2, '0');
      localStorage.setItem('test_whiteboard_review_' + weekStart, 'Great week! You completed 5 tasks.');

      const html = review.renderWeeklyReview();
      expect(html).toContain('Great week');
    });

    it('shows "Refresh" button when cached review exists', () => {
      const now = new Date();
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      const weekStart =
        mon.getFullYear() +
        '-' +
        String(mon.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(mon.getDate()).padStart(2, '0');
      localStorage.setItem('test_whiteboard_review_' + weekStart, 'Cached review text');

      const html = review.renderWeeklyReview();
      expect(html).toContain('Refresh');
    });

    it('shows "Generate" button when no cached review', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('Generate');
      expect(html).not.toContain('Refresh');
    });

    it('shows discuss button when cached review exists', () => {
      const now = new Date();
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      const weekStart =
        mon.getFullYear() +
        '-' +
        String(mon.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(mon.getDate()).padStart(2, '0');
      localStorage.setItem('test_whiteboard_review_' + weekStart, 'Cached');

      const html = review.renderWeeklyReview();
      expect(html).toContain('discuss-review');
      expect(html).toContain('Discuss this review');
    });

    it('does not show discuss button when no cached review', () => {
      const html = review.renderWeeklyReview();
      expect(html).not.toContain('discuss-review');
    });

    it('shows completed tasks list when tasks completed this week', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('Completed This Week');
      expect(html).toContain('Done task');
    });

    it('shows project name next to completed task', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('Work');
    });

    it('shows overdue section when there are overdue tasks', () => {
      // Make t2 overdue by setting dueDate to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yISO =
        yesterday.getFullYear() +
        '-' +
        String(yesterday.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(yesterday.getDate()).padStart(2, '0');
      store.tasks[1].dueDate = yISO;

      const html = review.renderWeeklyReview();
      expect(html).toContain('Overdue');
      expect(html).toContain('Active task');
      expect(html).toContain('overdue');
    });

    it('does not show overdue section when no overdue tasks', () => {
      // Set due date to far future
      store.tasks.forEach((t) => {
        t.dueDate = '2099-12-31';
      });
      const html = review.renderWeeklyReview();
      expect(html).not.toContain('⚠ Overdue');
    });

    it('shows project breakdown with progress bar', () => {
      const html = review.renderWeeklyReview();
      expect(html).toContain('Project Breakdown');
      expect(html).toContain('done');
      expect(html).toContain('remaining');
    });

    it('does not show project breakdown when no projects have activity', () => {
      store.tasks = [];
      const html = review.renderWeeklyReview();
      expect(html).not.toContain('Project Breakdown');
    });

    it('shows AI memory insights when 2+ relevant memories', () => {
      deps.getAIMemory.mockReturnValue([
        { type: 'pattern', text: 'Works best in mornings', strength: 3 },
        { type: 'rhythm', text: 'Energy dips after lunch', strength: 2 },
        { type: 'preference', text: 'Prefers short tasks', strength: 1 },
      ]);
      const html = review.renderWeeklyReview();
      expect(html).toContain("What I've learned about you");
      expect(html).toContain('Works best in mornings');
      expect(html).toContain('Energy dips after lunch');
    });

    it('does not show memory insights when fewer than 2 relevant memories', () => {
      deps.getAIMemory.mockReturnValue([{ type: 'pattern', text: 'Something', strength: 1 }]);
      const html = review.renderWeeklyReview();
      expect(html).not.toContain("What I've learned about you");
    });

    it('limits memory insights to top 5 by strength', () => {
      deps.getAIMemory.mockReturnValue([
        { type: 'pattern', text: 'Mem1', strength: 10 },
        { type: 'pattern', text: 'Mem2', strength: 9 },
        { type: 'pattern', text: 'Mem3', strength: 8 },
        { type: 'preference', text: 'Mem4', strength: 7 },
        { type: 'rhythm', text: 'Mem5', strength: 6 },
        { type: 'correction', text: 'Mem6', strength: 5 },
        { type: 'pattern', text: 'Mem7', strength: 4 },
      ]);
      const html = review.renderWeeklyReview();
      expect(html).toContain('Mem1');
      expect(html).toContain('Mem5');
      expect(html).not.toContain('Mem6');
      expect(html).not.toContain('Mem7');
    });

    it('shows strength for memories with strength > 1', () => {
      deps.getAIMemory.mockReturnValue([
        { type: 'pattern', text: 'Strong pattern', strength: 5 },
        { type: 'rhythm', text: 'Weak rhythm', strength: 1 },
      ]);
      const html = review.renderWeeklyReview();
      expect(html).toContain('strength 5');
      expect(html).not.toContain('strength 1');
    });

    it('filters out non-relevant memory types', () => {
      deps.getAIMemory.mockReturnValue([
        { type: 'pattern', text: 'Valid', strength: 1 },
        { type: 'rhythm', text: 'Also valid', strength: 1 },
        { type: 'note', text: 'Should not appear', strength: 10 },
        { type: 'other', text: 'Also excluded', strength: 10 },
      ]);
      const html = review.renderWeeklyReview();
      expect(html).toContain('Valid');
      expect(html).not.toContain('Should not appear');
      expect(html).not.toContain('Also excluded');
    });

    it('escapes HTML in task titles', () => {
      store.tasks[0].title = '<script>alert("xss")</script>';
      const html = review.renderWeeklyReview();
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('renderWeeklyReview() with no data', () => {
    it('handles empty tasks gracefully', () => {
      store.tasks = [];
      const html = review.renderWeeklyReview();
      expect(typeof html).toBe('string');
      expect(html).toContain('0');
    });

    it('handles empty projects gracefully', () => {
      store.projects = [];
      const html = review.renderWeeklyReview();
      expect(typeof html).toBe('string');
    });
  });

  // ── generateWeeklyReview ────────────────────────────────────────────
  describe('generateWeeklyReview()', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <button id="reviewBtn">Generate</button>
        <div id="reviewBody">Click Generate for an AI-powered reflection...</div>
      `;
    });

    it('returns early if hasAI returns false', async () => {
      deps.hasAI.mockReturnValue(false);
      review = createWeeklyReview(deps);
      await review.generateWeeklyReview();
      expect(deps.callAI).not.toHaveBeenCalled();
    });

    it('calls callAI with a prompt containing task data', async () => {
      await review.generateWeeklyReview();
      expect(deps.callAI).toHaveBeenCalledTimes(1);
      const prompt = deps.callAI.mock.calls[0][0];
      expect(prompt).toContain('COMPLETED');
      expect(prompt).toContain('STILL ACTIVE');
      expect(prompt).toContain('OVERDUE');
      expect(prompt).toContain('PROJECTS');
    });

    it('calls callAI with correct options', async () => {
      await review.generateWeeklyReview();
      const opts = deps.callAI.mock.calls[0][1];
      expect(opts.maxTokens).toBe(16384);
      expect(opts.temperature).toBe(0.3);
    });

    it('shows spinner in button while generating', async () => {
      // Use a deferred promise to control timing
      let resolveAI;
      deps.callAI.mockReturnValue(
        new Promise((r) => {
          resolveAI = r;
        }),
      );
      review = createWeeklyReview(deps);

      const promise = review.generateWeeklyReview();
      const btn = document.getElementById('reviewBtn');
      expect(btn.innerHTML).toContain('spinner');
      expect(btn.innerHTML).toContain('Thinking');

      resolveAI('Done!');
      await promise;
    });

    it('sets review body HTML with formatted AI response', async () => {
      // Note: the code strips leading bullet chars (-, *, •) then applies bold **...**
      // So use a format where bold markers aren't at line start after bullet stripping
      deps.callAI.mockResolvedValue('Great **Wins** this week!\n- Item 1\n- Item 2');
      review = createWeeklyReview(deps);

      await review.generateWeeklyReview();

      const body = document.getElementById('reviewBody');
      expect(body.innerHTML).toContain('<strong>Wins</strong>');
      expect(body.innerHTML).toContain('<br>');
      // Bullet chars are stripped
      expect(body.innerHTML).not.toMatch(/^- /m);
    });

    it('caches the review in localStorage', async () => {
      deps.callAI.mockResolvedValue('Review text here');
      review = createWeeklyReview(deps);

      await review.generateWeeklyReview();

      // Find the cached key
      let found = false;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('test_whiteboard_review_')) {
          found = true;
          expect(localStorage.getItem(key)).toContain('Review text here');
        }
      }
      expect(found).toBe(true);
    });

    it('changes button text to "Refresh" after success', async () => {
      await review.generateWeeklyReview();
      const btn = document.getElementById('reviewBtn');
      expect(btn.textContent).toBe('Refresh');
    });

    it('adds discuss button after generating review', async () => {
      // Wrap reviewBody in a parent div
      document.body.innerHTML = `
        <div>
          <button id="reviewBtn">Generate</button>
          <div id="reviewBody">Click Generate...</div>
        </div>
      `;
      await review.generateWeeklyReview();
      const discussBtn = document.querySelector('[data-action="discuss-review"]');
      expect(discussBtn).not.toBeNull();
      expect(discussBtn.textContent).toContain('Discuss this review');
    });

    it('does not add duplicate discuss button', async () => {
      document.body.innerHTML = `
        <div>
          <button id="reviewBtn">Generate</button>
          <div id="reviewBody">Click Generate...</div>
        </div>
      `;
      await review.generateWeeklyReview();
      await review.generateWeeklyReview();
      const discussBtns = document.querySelectorAll('[data-action="discuss-review"]');
      expect(discussBtns.length).toBe(1);
    });

    it('shows error state on AI failure', async () => {
      deps.callAI.mockRejectedValue(new Error('API error'));
      review = createWeeklyReview(deps);

      await review.generateWeeklyReview();

      const btn = document.getElementById('reviewBtn');
      expect(btn.textContent).toContain('Error');
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Weekly review failed'), true);
    });

    it('includes AI memory patterns in prompt when available', async () => {
      deps.getAIMemory.mockReturnValue([
        { type: 'pattern', text: 'Works best mornings' },
        { type: 'rhythm', text: 'Energy dips at 2pm' },
        { type: 'preference', text: 'Likes short tasks' },
        { type: 'note', text: 'Not included' },
      ]);
      review = createWeeklyReview(deps);

      await review.generateWeeklyReview();

      const prompt = deps.callAI.mock.calls[0][0];
      expect(prompt).toContain('AI MEMORY');
      expect(prompt).toContain('Works best mornings');
      expect(prompt).toContain('Energy dips at 2pm');
      expect(prompt).toContain('Likes short tasks');
      expect(prompt).not.toContain('Not included');
    });

    it('includes completed task titles with project names in prompt', async () => {
      await review.generateWeeklyReview();
      const prompt = deps.callAI.mock.calls[0][0];
      expect(prompt).toContain('Done task');
      expect(prompt).toContain('Work');
    });

    it('marks urgent tasks in the prompt', async () => {
      await review.generateWeeklyReview();
      const prompt = deps.callAI.mock.calls[0][0];
      expect(prompt).toContain('(URGENT)');
    });

    it('includes overdue task due dates in prompt', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yISO =
        yesterday.getFullYear() +
        '-' +
        String(yesterday.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(yesterday.getDate()).padStart(2, '0');
      store.tasks[1].dueDate = yISO;

      await review.generateWeeklyReview();
      const prompt = deps.callAI.mock.calls[0][0];
      expect(prompt).toContain('due ' + yISO);
    });
  });

  // ── discussReview ──────────────────────────────────────────────────
  describe('discussReview()', () => {
    it('shows toast if no review body text', () => {
      document.body.innerHTML = `<div id="reviewBody"></div>`;
      review.discussReview();
      expect(deps.showToast).toHaveBeenCalledWith('Generate a review first', true);
    });

    it('shows toast if review body starts with "Click Generate"', () => {
      document.body.innerHTML = `<div id="reviewBody">Click Generate for an AI-powered reflection</div>`;
      review.discussReview();
      expect(deps.showToast).toHaveBeenCalledWith('Generate a review first', true);
    });

    it('shows toast if reviewBody element does not exist', () => {
      document.body.innerHTML = '';
      review.discussReview();
      expect(deps.showToast).toHaveBeenCalledWith('Generate a review first', true);
    });

    it('pushes review text into chat history', () => {
      const chatHistory = [];
      deps.getChatHistory.mockReturnValue(chatHistory);
      document.body.innerHTML = `
        <div id="reviewBody">This was a great week with lots of progress.</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      expect(chatHistory.length).toBe(1);
      expect(chatHistory[0].role).toBe('user');
      expect(chatHistory[0].content).toContain('This was a great week');
      expect(chatHistory[0].content).toContain('weekly review');
      expect(chatHistory[0].ts).toBeDefined();
    });

    it('saves chat history and sets session started', () => {
      deps.getChatHistory.mockReturnValue([]);
      document.body.innerHTML = `
        <div id="reviewBody">Review content here.</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      expect(deps.saveChatHistory).toHaveBeenCalled();
      expect(deps.setChatSessionStarted).toHaveBeenCalledWith(true);
    });

    it('opens the chat panel', () => {
      deps.getChatHistory.mockReturnValue([]);
      document.body.innerHTML = `
        <div id="reviewBody">Review content here.</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      const panel = document.getElementById('chatPanel');
      expect(panel.classList.contains('open')).toBe(true);
    });

    it('renders chat messages in chat panel', () => {
      const chatHistory = [];
      deps.getChatHistory.mockReturnValue(chatHistory);
      document.body.innerHTML = `
        <div id="reviewBody">Review content here.</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      const messagesEl = document.getElementById('chatMessages');
      expect(messagesEl.innerHTML).toContain('chat-msg');
      expect(messagesEl.innerHTML).toContain('user');
    });

    it('sets chat title to "AI Assistant"', () => {
      deps.getChatHistory.mockReturnValue([]);
      document.body.innerHTML = `
        <div id="reviewBody">Review content here.</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      expect(document.getElementById('chatTitle').textContent).toBe('AI Assistant');
    });

    it('focuses the chat input', () => {
      deps.getChatHistory.mockReturnValue([]);
      document.body.innerHTML = `
        <div id="reviewBody">Review content here.</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      const focusSpy = vi.spyOn(document.getElementById('chatInput'), 'focus');
      review.discussReview();

      expect(focusSpy).toHaveBeenCalled();
    });

    it('truncates long messages in chat display', () => {
      const chatHistory = [];
      deps.getChatHistory.mockReturnValue(chatHistory);
      document.body.innerHTML = `
        <div id="reviewBody">${'A'.repeat(600)}</div>
        <div id="chatPanel"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      const messagesEl = document.getElementById('chatMessages');
      expect(messagesEl.innerHTML).toContain('...');
    });

    it('does not open panel again if already open', () => {
      deps.getChatHistory.mockReturnValue([]);
      document.body.innerHTML = `
        <div id="reviewBody">Review content here.</div>
        <div id="chatPanel" class="open"><div id="chatMessages"></div><div id="chatTitle"></div><input id="chatInput" /></div>
      `;
      review = createWeeklyReview(deps);

      review.discussReview();

      const panel = document.getElementById('chatPanel');
      // Should still have 'open' class (not duplicated)
      expect(panel.className).toBe('open');
    });
  });
});
