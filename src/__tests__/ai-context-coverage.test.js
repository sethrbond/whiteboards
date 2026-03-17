import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAIContext } from '../ai-context.js';

/**
 * Additional coverage tests for ai-context.js
 * Covers: invalid JSON, overflow, archive cap, dedup, pruneStaleMemories,
 * buildAIContext details, maybeLearnPattern, consolidateMemories, executeAIActions
 */

function makeDeps(store, overrides = {}) {
  return {
    userKey: (k) => 'test_' + k,
    scheduleSyncToCloud: vi.fn(),
    getData: () => store,
    getChatHistory: () => [],
    activeTasks: (pid) => store.tasks.filter((t) => t.status !== 'done' && (!pid || t.project === pid)),
    doneTasks: (pid) => store.tasks.filter((t) => t.status === 'done' && (!pid || t.project === pid)),
    projectTasks: (pid) => store.tasks.filter((t) => t.project === pid),
    findTask: (id) => store.tasks.find((t) => t.id === id),
    findSimilarTask: () => null,
    findSimilarProject: () => null,
    isBlocked: () => false,
    callAI: vi.fn().mockResolvedValue('AI response'),
    hasAI: () => true,
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTask: vi.fn(),
    createTask: (props) => ({ id: 'new_' + Math.random(), status: 'todo', priority: 'normal', ...props }),
    createProject: (props) => ({ id: 'np_' + Math.random(), color: '#818cf8', ...props }),
    addProject: vi.fn(),
    updateProject: vi.fn(),
    saveData: vi.fn(),
    pushUndo: vi.fn(),
    confirmAIAction: vi.fn().mockResolvedValue(true),
    enforceShortDesc: (d) => d.slice(0, 200),
    ...overrides,
  };
}

describe('ai-context.js — additional coverage', () => {
  let ctx;
  let store;

  beforeEach(() => {
    localStorage.clear();
    store = {
      tasks: [
        {
          id: 't1',
          title: 'Buy groceries',
          status: 'todo',
          priority: 'normal',
          createdAt: '2026-03-10T10:00:00Z',
          project: 'p1',
          tags: [],
        },
        {
          id: 't2',
          title: 'Fix bug',
          status: 'in-progress',
          priority: 'urgent',
          createdAt: '2026-03-12T10:00:00Z',
          dueDate: '2026-03-15',
          project: 'p2',
          tags: [],
        },
        {
          id: 't3',
          title: 'Write tests',
          status: 'done',
          priority: 'normal',
          createdAt: '2026-03-11T10:00:00Z',
          completedAt: '2026-03-14T15:00:00Z',
          project: 'p2',
          tags: [],
        },
      ],
      projects: [
        { id: 'p1', name: 'Life', color: '#818cf8', description: 'Personal tasks' },
        { id: 'p2', name: 'Work', color: '#f472b6', description: 'Work tasks' },
      ],
    };
    ctx = createAIContext(makeDeps(store));
  });

  // ── getAIMemory / getAIMemoryArchive with invalid JSON ──────────
  describe('getAIMemory / getAIMemoryArchive with invalid JSON', () => {
    it('getAIMemory returns [] when localStorage has invalid JSON', () => {
      localStorage.setItem('test_whiteboard_ai_memory', '{not valid json!!!}');
      expect(ctx.getAIMemory()).toEqual([]);
    });

    it('getAIMemoryArchive returns [] when localStorage has invalid JSON', () => {
      localStorage.setItem('test_whiteboard_ai_memory_archive', 'broken[json');
      expect(ctx.getAIMemoryArchive()).toEqual([]);
    });

    it('getAIMemory normalizes legacy string entries to objects', () => {
      localStorage.setItem('test_whiteboard_ai_memory', JSON.stringify(['old string memory']));
      const mem = ctx.getAIMemory();
      expect(mem).toHaveLength(1);
      expect(mem[0]).toEqual({ text: 'old string memory', type: 'context', date: '' });
    });

    it('getAIMemoryArchive normalizes legacy string entries to objects', () => {
      localStorage.setItem('test_whiteboard_ai_memory_archive', JSON.stringify(['archived string']));
      const arc = ctx.getAIMemoryArchive();
      expect(arc).toHaveLength(1);
      expect(arc[0]).toEqual({ text: 'archived string', type: 'context', date: '' });
    });
  });

  // ── saveAIMemory overflow (>30 moves to archive) ────────────────
  describe('saveAIMemory overflow', () => {
    it('moves overflow items to archive when saving more than 30', () => {
      const items = [];
      for (let i = 0; i < 35; i++) {
        items.push({ text: 'Memory item ' + i, type: 'note', date: '2026-03-15', strength: 1 });
      }
      ctx.saveAIMemory(items);
      const mem = ctx.getAIMemory();
      const archive = ctx.getAIMemoryArchive();
      expect(mem).toHaveLength(30);
      expect(archive).toHaveLength(5);
      expect(archive[0].text).toBe('Memory item 0');
      expect(archive[4].text).toBe('Memory item 4');
      expect(mem[0].text).toBe('Memory item 5');
    });
  });

  // ── saveAIMemoryArchive cap at 200 ──────────────────────────────
  describe('saveAIMemoryArchive cap at 200', () => {
    it('trims archive to last 200 entries when exceeding limit', () => {
      const archive = [];
      for (let i = 0; i < 210; i++) {
        archive.push({ text: 'Archive ' + i, type: 'note', date: '2026-01-01', strength: 1 });
      }
      ctx.saveAIMemoryArchive(archive);
      const stored = ctx.getAIMemoryArchive();
      expect(stored).toHaveLength(200);
      expect(stored[0].text).toBe('Archive 10');
    });
  });

  // ── addAIMemory dedup against archive ───────────────────────────
  describe('addAIMemory dedup against archive', () => {
    it('does not add memory if it is too similar to an archived memory', () => {
      ctx.addAIMemory('User prefers working in the morning time', 'rhythm');
      ctx.archiveMemory(0);
      expect(ctx.getAIMemory()).toHaveLength(0);
      expect(ctx.getAIMemoryArchive()).toHaveLength(1);
      ctx.addAIMemory('User prefers working in the morning time always', 'rhythm');
      expect(ctx.getAIMemory()).toHaveLength(0);
    });

    it('adds memory when it is sufficiently different from archived memories', () => {
      ctx.addAIMemory('User prefers dark mode for the editor', 'preference');
      ctx.archiveMemory(0);
      ctx.addAIMemory('Project deadline is next Friday for release', 'context');
      expect(ctx.getAIMemory()).toHaveLength(1);
    });
  });

  // ── pruneStaleMemories — additional cases ───────────────────────
  describe('pruneStaleMemories — additional cases', () => {
    it('keeps rhythm memories regardless of age', () => {
      const mem = ctx.getAIMemory();
      mem.push({ text: 'User is most productive on Mondays', type: 'rhythm', date: '2025-01-01', strength: 2 });
      ctx.saveAIMemory(mem);
      ctx.pruneStaleMemories();
      expect(ctx.getAIMemory().some((m) => m.text.includes('Mondays'))).toBe(true);
    });

    it('archives context memories older than 60 days', () => {
      const old60Days = new Date(Date.now() - 61 * 86400000).toISOString().slice(0, 10);
      const mem = ctx.getAIMemory();
      mem.push({ text: 'Old context about something', type: 'context', date: old60Days, strength: 1 });
      ctx.saveAIMemory(mem);
      ctx.pruneStaleMemories();
      expect(ctx.getAIMemory().some((m) => m.text === 'Old context about something')).toBe(false);
      expect(ctx.getAIMemoryArchive().some((m) => m.text === 'Old context about something')).toBe(true);
    });

    it('archives reflection memories older than 60 days', () => {
      const old61Days = new Date(Date.now() - 61 * 86400000).toISOString().slice(0, 10);
      const mem = ctx.getAIMemory();
      mem.push({ text: 'Old reflection about progress', type: 'reflection', date: old61Days, strength: 1 });
      ctx.saveAIMemory(mem);
      ctx.pruneStaleMemories();
      expect(ctx.getAIMemory().some((m) => m.text === 'Old reflection about progress')).toBe(false);
      expect(ctx.getAIMemoryArchive().some((m) => m.text === 'Old reflection about progress')).toBe(true);
    });

    it('archives memories referencing boards that no longer exist', () => {
      const mem = ctx.getAIMemory();
      mem.push({ text: 'Working on "Deleted Project" board tasks', type: 'note', date: '2026-03-10', strength: 1 });
      ctx.saveAIMemory(mem);
      ctx.pruneStaleMemories();
      expect(ctx.getAIMemory().some((m) => m.text.includes('Deleted Project'))).toBe(false);
      expect(ctx.getAIMemoryArchive().some((m) => m.text.includes('Deleted Project'))).toBe(true);
    });

    it('keeps memories referencing existing boards', () => {
      const mem = ctx.getAIMemory();
      mem.push({ text: 'Working on "Life" board tasks', type: 'note', date: '2026-03-10', strength: 1 });
      ctx.saveAIMemory(mem);
      ctx.pruneStaleMemories();
      expect(ctx.getAIMemory().some((m) => m.text.includes('Life'))).toBe(true);
    });

    it('does nothing when no memories are stale', () => {
      ctx.addAIMemory('Fresh preference', 'preference');
      const archiveBefore = ctx.getAIMemoryArchive().length;
      ctx.pruneStaleMemories();
      expect(ctx.getAIMemoryArchive().length).toBe(archiveBefore);
    });
  });

  // ── buildAIContext — stale, blocked, subtasks, memory ordering ──
  describe('buildAIContext — stale, blocked, subtasks, memory ordering', () => {
    it('shows stale tasks (untouched 14+ days)', () => {
      const old = new Date(Date.now() - 15 * 86400000).toISOString();
      store.tasks.push({
        id: 't_stale',
        title: 'Stale old task',
        status: 'todo',
        priority: 'normal',
        createdAt: old,
        project: 'p1',
        tags: [],
      });
      const result = ctx.buildAIContext('all');
      expect(result).toContain('STALE');
      expect(result).toContain('Stale old task');
    });

    it('shows blocked indicator for blocked tasks', () => {
      const ctxBlocked = createAIContext(makeDeps(store, { isBlocked: (t) => t.id === 't1' }));
      const result = ctxBlocked.buildAIContext('all');
      expect(result).toContain('BLOCKED');
    });

    it('shows subtask counts in task listing', () => {
      store.tasks.push({
        id: 't_sub',
        title: 'Task with subtasks',
        status: 'todo',
        priority: 'normal',
        createdAt: '2026-03-14T10:00:00Z',
        project: 'p1',
        tags: [],
        subtasks: [
          { id: 's1', title: 'Sub 1', done: true },
          { id: 's2', title: 'Sub 2', done: false },
          { id: 's3', title: 'Sub 3', done: false },
        ],
      });
      const result = ctx.buildAIContext('all');
      expect(result).toContain('1/3 sub');
    });

    it('orders memory by type: corrections first, then preferences, then patterns', () => {
      ctx.addAIMemory('A pattern observation', 'pattern');
      ctx.addAIMemory('A correction to always apply', 'correction');
      ctx.addAIMemory('A preference the user has', 'preference');
      const result = ctx.buildAIContext('all');
      const correctionIdx = result.indexOf('CORRECTION');
      const preferenceIdx = result.indexOf('PREFERENCE');
      const patternIdx = result.indexOf('PATTERN');
      expect(correctionIdx).toBeLessThan(preferenceIdx);
      expect(preferenceIdx).toBeLessThan(patternIdx);
    });

    it('shows subtask counts in project-scoped context', () => {
      store.tasks.push({
        id: 't_proj_sub',
        title: 'Project subtask task',
        status: 'in-progress',
        priority: 'normal',
        createdAt: '2026-03-14T10:00:00Z',
        project: 'p2',
        tags: [],
        subtasks: [
          { id: 's1', title: 'A', done: true },
          { id: 's2', title: 'B', done: true },
        ],
      });
      const result = ctx.buildAIContext('project', 'p2');
      expect(result).toContain('2/2 sub');
    });

    it('includes archived memory count in full detail mode', () => {
      ctx.addAIMemory('Something to archive', 'note');
      ctx.archiveMemory(0);
      const result = ctx.buildAIContext('all', null, 'full');
      expect(result).toContain('ARCHIVED MEMORIES');
      expect(result).toContain('1 in archive');
    });

    it('shows blockedBy task titles', () => {
      store.tasks.push({
        id: 't_blocked',
        title: 'Blocked task here',
        status: 'todo',
        priority: 'normal',
        createdAt: '2026-03-14T10:00:00Z',
        project: 'p1',
        tags: [],
        blockedBy: ['t1'],
      });
      const result = ctx.buildAIContext('all');
      expect(result).toContain('blocked by');
      expect(result).toContain('Buy groceries');
    });
  });

  // ── maybeLearnPattern — various patterns ──────────────────────────
  describe('maybeLearnPattern — additional patterns', () => {
    function addDoneTasks(count, hour) {
      for (let i = 0; i < count; i++) {
        const d = new Date('2026-03-10T' + (hour || '14') + ':00:00Z');
        d.setDate(d.getDate() + i);
        store.tasks.push({
          id: 'pt_' + i + '_' + Math.random(),
          title: 'Pattern task ' + i,
          status: 'done',
          priority: 'normal',
          createdAt: '2026-03-01',
          completedAt: d.toISOString(),
          project: 'p1',
          tags: [],
        });
      }
    }

    it('learns afternoon rhythm', () => {
      addDoneTasks(15, '14');
      ctx.maybeLearnPattern();
      expect(ctx.getAIMemory().some((m) => m.text.includes('afternoon'))).toBe(true);
    });

    it('learns evening rhythm', () => {
      addDoneTasks(15, '19');
      ctx.maybeLearnPattern();
      expect(ctx.getAIMemory().some((m) => m.text.includes('evening'))).toBe(true);
    });

    it('learns reprioritization pattern', () => {
      for (let i = 0; i < 15; i++) {
        store.tasks.push({
          id: 'reprio_' + i,
          title: 'Reprio task ' + i,
          status: 'done',
          priority: 'normal',
          createdAt: '2026-03-01',
          completedAt: new Date('2026-03-10T10:00:00Z').toISOString(),
          project: 'p2',
          tags: [],
          updates: i < 5 ? [{ field: 'priority', date: '2026-03-05' }] : [],
        });
      }
      ctx.maybeLearnPattern();
      expect(ctx.getAIMemory().some((m) => m.text.includes('reprioritized'))).toBe(true);
    });

    it('learns urgent same-day completion pattern', () => {
      for (let i = 0; i < 15; i++) {
        const day = '2026-03-' + String(10 + (i % 5)).padStart(2, '0');
        store.tasks.push({
          id: 'urg_' + i,
          title: 'Urgent task ' + i,
          status: 'done',
          priority: 'urgent',
          createdAt: day + 'T08:00:00Z',
          completedAt: day + 'T16:00:00Z',
          project: 'p1',
          tags: [],
        });
      }
      ctx.maybeLearnPattern();
      expect(ctx.getAIMemory().some((m) => m.text.includes('urgent') && m.text.includes('same day'))).toBe(true);
    });

    it('learns most productive day pattern', () => {
      for (let i = 0; i < 50; i++) {
        const d = new Date('2026-01-05T10:00:00Z');
        d.setDate(d.getDate() + 7 * (i % 7));
        store.tasks.push({
          id: 'day_' + i,
          title: 'Day task ' + i,
          status: 'done',
          priority: 'normal',
          createdAt: '2026-01-01',
          completedAt: d.toISOString(),
          project: 'p1',
          tags: [],
        });
      }
      ctx.maybeLearnPattern();
      expect(ctx.getAIMemory().some((m) => m.text.includes('productive day'))).toBe(true);
    });

    it('does not re-learn on same day', () => {
      addDoneTasks(15, '09');
      ctx.maybeLearnPattern();
      const count1 = ctx.getAIMemory().length;
      ctx.maybeLearnPattern();
      expect(ctx.getAIMemory().length).toBe(count1);
    });
  });

  // ── consolidateMemories — AI response handling ──────────────────
  describe('consolidateMemories — AI response handling', () => {
    it('consolidates when 20+ memories and AI returns valid JSON', async () => {
      const mem = [];
      for (let i = 0; i < 25; i++) {
        mem.push({
          text: 'Unique consolidation memory number ' + i + ' with content',
          type: 'note',
          date: '2026-03-10',
          strength: 1,
        });
      }
      localStorage.setItem('test_whiteboard_ai_memory', JSON.stringify(mem));

      const mockCallAI = vi.fn().mockResolvedValue(
        JSON.stringify([
          { text: 'Consolidated memory A', type: 'preference', strength: 2, archive: false },
          { text: 'Consolidated memory B', type: 'context', strength: 1, archive: true },
        ]),
      );

      const ctxC = createAIContext(makeDeps(store, { callAI: mockCallAI }));
      await ctxC.consolidateMemories();
      expect(mockCallAI).toHaveBeenCalled();
      expect(ctxC.getAIMemory().some((m) => m.text === 'Consolidated memory A')).toBe(true);
      expect(ctxC.getAIMemoryArchive().some((m) => m.text === 'Consolidated memory B')).toBe(true);
    });

    it('does nothing when AI returns non-JSON response', async () => {
      const mem = [];
      for (let i = 0; i < 25; i++) {
        mem.push({ text: 'Mem for bad AI response ' + i + ' unique', type: 'note', date: '2026-03-10', strength: 1 });
      }
      localStorage.setItem('test_whiteboard_ai_memory', JSON.stringify(mem));

      const mockCallAI = vi.fn().mockResolvedValue('Sorry, I cannot do that right now.');
      const ctxBad = createAIContext(makeDeps(store, { callAI: mockCallAI }));
      const memBefore = ctxBad.getAIMemory().length;
      await ctxBad.consolidateMemories();
      expect(ctxBad.getAIMemory().length).toBe(memBefore);
    });

    it('does nothing when hasAI returns false', async () => {
      const mem = [];
      for (let i = 0; i < 25; i++) {
        mem.push({ text: 'No AI mem ' + i + ' unique text here', type: 'note', date: '2026-03-10', strength: 1 });
      }
      localStorage.setItem('test_whiteboard_ai_memory', JSON.stringify(mem));

      const ctxNoAI = createAIContext(makeDeps(store, { hasAI: () => false }));
      const memBefore = ctxNoAI.getAIMemory().length;
      await ctxNoAI.consolidateMemories();
      expect(ctxNoAI.getAIMemory().length).toBe(memBefore);
    });

    it('skips consolidation if recently consolidated and under 40 memories', async () => {
      localStorage.setItem('test_whiteboard_mem_consolidated', new Date().toISOString());
      const mem = [];
      for (let i = 0; i < 25; i++) {
        mem.push({ text: 'Skip consolidate mem ' + i, type: 'note', date: '2026-03-10', strength: 1 });
      }
      localStorage.setItem('test_whiteboard_ai_memory', JSON.stringify(mem));

      const mockCallAI = vi.fn();
      const ctxSkip = createAIContext(makeDeps(store, { callAI: mockCallAI }));
      await ctxSkip.consolidateMemories();
      expect(mockCallAI).not.toHaveBeenCalled();
    });
  });

  // ── executeAIActions — comprehensive action coverage ──────────────
  describe('executeAIActions — comprehensive action coverage', () => {
    it('handles move_task action', async () => {
      const reply = '```actions\n[{"action":"move_task","taskTitle":"Buy groceries","toProject":"Work"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles add_subtasks action', async () => {
      const reply =
        '```actions\n[{"action":"add_subtasks","taskTitle":"Buy groceries","subtasks":["Get milk","Get bread"]}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles split_task action with confirmation', async () => {
      const reply =
        '```actions\n[{"action":"split_task","taskTitle":"Buy groceries","into":[{"title":"Buy produce","priority":"normal"},{"title":"Buy dairy","priority":"normal"}]}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles split_task action denied by user', async () => {
      const ctxDeny = createAIContext(makeDeps(store, { confirmAIAction: vi.fn().mockResolvedValue(false) }));
      const reply =
        '```actions\n[{"action":"split_task","taskTitle":"Buy groceries","into":[{"title":"A"},{"title":"B"}]}]\n```';
      const result = await ctxDeny.executeAIActions(reply);
      expect(result.applied).toBe(0);
    });

    it('handles update_project action', async () => {
      const reply =
        '```actions\n[{"action":"update_project","name":"Work","fields":{"description":"Updated work desc"}}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles update_background action', async () => {
      store.projects[1].background = '## Origin\nSome origin\n## Notes\nSome notes';
      const reply =
        '```actions\n[{"action":"update_background","project":"Work","section":"origin","content":"New origin text"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles batch_reschedule with daysToAdd', async () => {
      store.tasks.push({
        id: 't_resched',
        title: 'Reschedule me',
        status: 'todo',
        priority: 'low',
        dueDate: '2026-03-20',
        createdAt: '2026-03-10',
        project: 'p1',
        tags: [],
      });
      const reply = '```actions\n[{"action":"batch_reschedule","filter":{"priority":"low"},"daysToAdd":5}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles batch_reschedule with newDate', async () => {
      store.tasks.push({
        id: 't_resched2',
        title: 'Reschedule new date',
        status: 'todo',
        priority: 'normal',
        dueDate: '2026-03-18',
        createdAt: '2026-03-10',
        project: 'p2',
        tags: [],
      });
      const reply =
        '```actions\n[{"action":"batch_reschedule","filter":{"project":"Work"},"newDate":"2026-04-01"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('handles query action (no-op)', async () => {
      const reply = '```actions\n[{"action":"query","question":"how many tasks?"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(0);
    });

    it('handles delete_task denied by user', async () => {
      const ctxDeny = createAIContext(makeDeps(store, { confirmAIAction: vi.fn().mockResolvedValue(false) }));
      const reply = '```actions\n[{"action":"delete_task","taskTitle":"Buy groceries"}]\n```';
      const result = await ctxDeny.executeAIActions(reply);
      expect(result.applied).toBe(0);
    });

    it('handles update_task with project field resolution', async () => {
      const reply = '```actions\n[{"action":"update_task","taskTitle":"Fix bug","fields":{"project":"Life"}}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('skips create_task when duplicate found', async () => {
      const ctxDupe = createAIContext(
        makeDeps(store, { findSimilarTask: () => ({ id: 't1', title: 'Buy groceries' }) }),
      );
      const reply = '```actions\n[{"action":"create_task","title":"Buy groceries"}]\n```';
      const result = await ctxDupe.executeAIActions(reply);
      expect(result.applied).toBe(0);
    });

    it('skips create_project when project already exists', async () => {
      const reply = '```actions\n[{"action":"create_project","name":"Work","description":"Already exists"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(0);
    });

    it('handles batch_update with project filter', async () => {
      const reply =
        '```actions\n[{"action":"batch_update","filter":{"project":"Work"},"fields":{"priority":"low"}}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });

    it('skips batch_update when targets exceed 20', async () => {
      for (let i = 0; i < 25; i++) {
        store.tasks.push({
          id: 'bulkx_' + i,
          title: 'Bulk task ' + i,
          status: 'todo',
          priority: 'normal',
          project: 'p1',
          tags: [],
        });
      }
      const reply =
        '```actions\n[{"action":"batch_update","filter":{"status":"todo"},"fields":{"priority":"low"}}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(0);
    });

    it('handles search_archive with no results', async () => {
      const reply = '```actions\n[{"action":"search_archive","query":"something nonexistent xyz"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.insights).toHaveLength(1);
      expect(result.insights[0].text).toContain('No archived memories');
    });

    it('recognizes ```json``` fenced blocks as actions', async () => {
      const reply = '```json\n[{"action":"save_memory","text":"Test json fence","type":"note"}]\n```';
      const result = await ctx.executeAIActions(reply);
      expect(result.applied).toBe(1);
    });
  });
});
