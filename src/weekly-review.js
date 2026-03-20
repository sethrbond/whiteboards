// ============================================================
// WEEKLY REVIEW
// Handles weekly review rendering, AI review generation,
// and review discussion.
// ============================================================

import { MS_PER_DAY } from './constants.js';

export function createWeeklyReview(deps) {
  const {
    data,
    userKey,
    activeTasks,
    projectTasks,
    hasAI,
    callAI,
    getAIMemory,
    sanitizeAIHTML,
    esc,
    localISO,
    todayStr,
    showToast,
    getChatHistory,
    saveChatHistory,
    chatTimeStr,
    setChatSessionStarted,
  } = deps;

  function renderWeeklyReview() {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const weekStart = localISO(mon);
    const weekEnd = localISO(sun);
    const weekLabel = `${mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    // This week's completed tasks
    const completed = data.tasks.filter(
      (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= weekEnd,
    );
    // Tasks created this week
    const created = data.tasks.filter(
      (t) => t.createdAt && t.createdAt.slice(0, 10) >= weekStart && t.createdAt.slice(0, 10) <= weekEnd,
    );
    // Overdue
    const overdue = data.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < todayStr());
    // In progress
    const inProg = data.tasks.filter((t) => t.status === 'in-progress');
    // Active
    const _active = activeTasks();
    // Per-project stats
    const projectStats = data.projects
      .map((p) => {
        const pTasks = projectTasks(p.id);
        const pDone = pTasks.filter(
          (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= weekEnd,
        ).length;
        const pActive = pTasks.filter((t) => t.status !== 'done').length;
        return { name: p.name, color: p.color, done: pDone, active: pActive };
      })
      .filter((p) => p.done > 0 || p.active > 0);

    // Cached AI review
    const reviewKey = userKey('whiteboard_review_' + weekStart);
    const cached = localStorage.getItem(reviewKey);

    let html = `<div style="max-width:720px">`;

    // Week header
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <span style="font-size:14px;font-weight:600;color:var(--text2)">${weekLabel}</span>
  </div>`;

    // Scorecard
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:28px">
    <div class="stat-card"><div class="stat-value" style="color:var(--green)">${completed.length}</div><div class="stat-label">Completed</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--accent)">${created.length}</div><div class="stat-label">Created</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--orange)">${inProg.length}</div><div class="stat-label">In Progress</div></div>
    <div class="stat-card"><div class="stat-value" style="color:${overdue.length ? 'var(--red)' : 'var(--text3)'}">${overdue.length}</div><div class="stat-label">Overdue</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--purple)">${(() => {
      const durations = completed
        .filter((t) => t.createdAt)
        .map((t) => Math.round((new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / MS_PER_DAY));
      if (durations.length >= 2) {
        durations.sort((a, b) => a - b);
        return durations[Math.floor(durations.length / 2)] + 'd';
      }
      return '—';
    })()}</div><div class="stat-label">Avg Turnaround</div></div>
  </div>`;

    // Completed tasks list
    if (completed.length) {
      html += `<div style="margin-bottom:28px"><div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:12px">Completed This Week</div>`;
      completed.forEach((t) => {
        const proj = data.projects.find((p) => p.id === t.project);
        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--green);font-size:14px">✓</span>
        <span style="font-size:13px;color:var(--text)">${esc(t.title)}</span>
        ${proj ? `<span style="font-size:11px;color:${proj.color};margin-left:auto">${esc(proj.name)}</span>` : ''}
      </div>`;
      });
      html += `</div>`;
    }

    // Project breakdown
    if (projectStats.length) {
      html += `<div style="margin-bottom:28px"><div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:12px">Project Breakdown</div>`;
      projectStats.forEach((p) => {
        const total = p.done + p.active;
        const pct = total > 0 ? Math.round((p.done / total) * 100) : 0;
        html += `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:12px;font-weight:500;color:var(--text)">${esc(p.name)}</span>
          <span style="font-size:11px;color:var(--text3)">${p.done} done · ${p.active} remaining</span>
        </div>
        <div style="height:4px;background:var(--surface3);border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${p.color};border-radius:2px;transition:width .3s"></div></div>
      </div>`;
      });
      html += `</div>`;
    }

    // Overdue
    if (overdue.length) {
      html += `<div style="margin-bottom:28px"><div style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:12px">⚠ Overdue (${overdue.length})</div>`;
      overdue.forEach((t) => {
        const _proj = data.projects.find((p) => p.id === t.project);
        const daysLate = Math.round((Date.now() - new Date(t.dueDate).getTime()) / MS_PER_DAY);
        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;color:var(--text)">${esc(t.title)}</span>
        <span style="font-size:11px;color:var(--red);margin-left:auto">${daysLate}d overdue</span>
      </div>`;
      });
      html += `</div>`;
    }

    // Slipped tasks (due this week but not done)
    const slipped = data.tasks.filter(
      (t) => t.status !== 'done' && t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd,
    );
    if (slipped.length) {
      html += `<div style="margin-bottom:28px"><div style="font-size:13px;font-weight:600;color:var(--orange);margin-bottom:12px">\u26A0 Slipped This Week (${slipped.length})</div>`;
      slipped.forEach((t) => {
        const _sproj = data.projects.find((p) => p.id === t.project);
        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;color:var(--text)">${esc(t.title)}</span>
        <span style="font-size:11px;color:var(--orange);margin-left:auto">due ${t.dueDate}</span>
      </div>`;
      });
      html += `</div>`;
    }

    // Memory Insights — "What I've learned about you"
    const memInsights = getAIMemory();
    const keyInsights = memInsights
      .filter((m) => ['pattern', 'rhythm', 'preference', 'correction'].includes(m.type))
      .sort((a, b) => (b.strength || 1) - (a.strength || 1))
      .slice(0, 5);
    if (keyInsights.length >= 2) {
      html += `<div style="background:var(--accent-dim);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:20px">
      <div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:12px">What I've learned about you</div>`;
      keyInsights.forEach((m) => {
        const typeIcon = { pattern: '🔄', rhythm: '⏱', preference: '★', correction: '✎' }[m.type] || '•';
        const typeLabel = (m.type || 'note').charAt(0).toUpperCase() + (m.type || 'note').slice(1);
        html += `<div style="display:flex;align-items:start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;flex-shrink:0">${typeIcon}</span>
        <div style="flex:1">
          <span style="font-size:12px;color:var(--text)">${esc(m.text)}</span>
          <span style="font-size:10px;color:var(--text3);margin-left:6px">${typeLabel}${m.strength > 1 ? ' · strength ' + m.strength : ''}</span>
        </div>
      </div>`;
      });
      html += `</div>`;
    }

    // AI Review
    html += `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:13px;font-weight:600;color:var(--text)">✦ AI Weekly Review</span>
      <button class="btn btn-sm" id="reviewBtn" data-action="generate-review">${cached ? 'Refresh' : 'Generate'}</button>
    </div>
    <div id="reviewBody" style="font-size:13px;color:var(--text2);line-height:1.6">${cached || 'Click Generate for an AI-powered reflection on your week — wins, patterns, and what to focus on next.'}</div>
    ${cached ? `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px"><button class="btn btn-sm" data-action="discuss-review" style="background:var(--accent);color:#fff">Discuss this review</button></div>` : ''}
  </div>`;

    html += `</div>`;
    return html;
  }

  function discussReview() {
    const body = document.getElementById('reviewBody');
    const reviewText = body ? body.textContent : '';
    if (!reviewText || reviewText.startsWith('Click Generate')) {
      showToast('Generate a review first', true);
      return;
    }
    const chatHistory = getChatHistory();
    chatHistory.push({
      role: 'user',
      content: "I just read my weekly review. Here's what it said:\n\n" + reviewText + '\n\nI want to discuss it.',
      ts: Date.now(),
    });
    saveChatHistory();
    setChatSessionStarted(false);
    const panel = document.getElementById('chatPanel');
    if (!panel.classList.contains('open')) panel.classList.add('open');
    setChatSessionStarted(true);
    const messagesEl = document.getElementById('chatMessages');
    if (messagesEl) {
      messagesEl.innerHTML = chatHistory
        .map(function (m) {
          return (
            '<div class="chat-msg ' +
            (m.role === 'user' ? 'user' : 'ai') +
            '">' +
            esc(m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content) +
            '<span class="chat-ts">' +
            chatTimeStr(m.ts ? new Date(m.ts) : undefined) +
            '</span></div>'
          );
        })
        .join('');
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    document.getElementById('chatTitle').textContent = 'AI Assistant';
    document.getElementById('chatInput').focus();
  }

  async function generateWeeklyReview() {
    if (!hasAI()) return;
    const btn = document.getElementById('reviewBtn');
    const body = document.getElementById('reviewBody');
    if (btn) btn.innerHTML = '<div class="spinner"></div> Thinking...';

    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const weekStart = localISO(mon);
    const weekEnd = localISO(new Date(mon.getTime() + 6 * MS_PER_DAY));

    const completed = data.tasks.filter(
      (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= weekEnd,
    );
    const created = data.tasks.filter(
      (t) => t.createdAt && t.createdAt.slice(0, 10) >= weekStart && t.createdAt.slice(0, 10) <= weekEnd,
    );
    const overdue = data.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < todayStr());
    const active = activeTasks();

    const prompt = `You are a thoughtful productivity partner writing a weekly review. Be warm, concise, and actionable. Use bullet points and short paragraphs.

WEEK: ${weekStart} to ${weekEnd}

COMPLETED (${completed.length}): ${completed
      .map((t) => {
        const p = data.projects.find((x) => x.id === t.project);
        return t.title + (p ? ' [' + p.name + ']' : '');
      })
      .join('; ')}

NEW TASKS CREATED (${created.length}): ${created.map((t) => t.title).join('; ')}

STILL ACTIVE (${active.length}): ${active
      .slice(0, 15)
      .map((t) => t.title + (t.priority === 'urgent' ? ' (URGENT)' : ''))
      .join('; ')}

OVERDUE (${overdue.length}): ${overdue.map((t) => t.title + ' (due ' + t.dueDate + ')').join('; ')}

PROJECTS: ${data.projects.map((p) => p.name + ': ' + activeTasks(p.id).length + ' active').join('; ')}

${(() => {
  const rm = getAIMemory().filter((m) => ['pattern', 'rhythm', 'preference'].includes(m.type));
  return rm.length
    ? 'AI MEMORY (known patterns about this user):\n' + rm.map((m) => '- [' + m.type + '] ' + m.text).join('\n')
    : '';
})()}

ANALYTICS:
${(() => {
  // Completed vs planned
  const planKeys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getTime() + i * MS_PER_DAY);
    const ds = localISO(d);
    const pk = userKey('whiteboard_plan_' + ds);
    const raw = localStorage.getItem(pk);
    if (raw) {
      try {
        planKeys.push(...JSON.parse(raw));
      } catch (_e) {
        /* skip */
      }
    }
  }
  const planned = planKeys.length;
  const planCompleted = planKeys.filter((p) => p.completedInPlan).length;
  return planned > 0
    ? 'Planned tasks: ' +
        planned +
        ', completed from plan: ' +
        planCompleted +
        ' (' +
        Math.round((planCompleted / planned) * 100) +
        '% plan adherence)'
    : 'No day plans used this week';
})()}
${(() => {
  // Most productive day
  const dayBuckets = [0, 0, 0, 0, 0, 0, 0];
  completed.forEach((t) => {
    const d = new Date(t.completedAt).getDay();
    if (!isNaN(d)) dayBuckets[d]++;
  });
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const maxIdx = dayBuckets.indexOf(Math.max(...dayBuckets));
  return dayBuckets[maxIdx] > 0
    ? 'Most productive day: ' + dayNames[maxIdx] + ' (' + dayBuckets[maxIdx] + ' tasks)'
    : '';
})()}
${(() => {
  // Tasks that slipped (due this week but not done)
  const slipped = data.tasks.filter(
    (t) => t.status !== 'done' && t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd,
  );
  return slipped.length > 0
    ? 'SLIPPED (due this week but not done): ' + slipped.map((t) => t.title + ' (due ' + t.dueDate + ')').join('; ')
    : 'No tasks slipped this week!';
})()}
${(() => {
  // Average task completion time
  const durations = completed
    .filter((t) => t.createdAt)
    .map((t) =>
      Math.round((new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    );
  if (durations.length >= 3) {
    durations.sort((a, b) => a - b);
    return 'Average task turnaround: ' + durations[Math.floor(durations.length / 2)] + ' days (median)';
  }
  return '';
})()}

Write a weekly review with these sections:
1. **Wins** — What was accomplished and why it matters
2. **Patterns** — Any themes you notice (busy week? lots of new work? overdue piling up? slipped tasks? reference known patterns from AI Memory if relevant)
3. **Analytics** — Comment on plan adherence, most productive day, and task turnaround time
4. **Next Week Focus** — Top 2-3 priorities based on what's active and overdue
5. **One Suggestion** — One specific, actionable improvement based on the week's patterns

Keep it under 250 words. Be direct and honest.`;

    try {
      let text = await callAI(prompt, { maxTokens: 4096, temperature: 0.3 });
      text = sanitizeAIHTML(text);
      const reviewKey = userKey('whiteboard_review_' + weekStart);
      localStorage.setItem(reviewKey, text);
      if (body) {
        body.innerHTML = text;
        // Add discuss button if not already present
        const wrapper = body.parentElement;
        if (wrapper && !wrapper.querySelector('.review-discuss-btn')) {
          const discussDiv = document.createElement('div');
          discussDiv.style.cssText = 'margin-top:14px;border-top:1px solid var(--border);padding-top:12px';
          discussDiv.innerHTML =
            '<button class="btn btn-sm review-discuss-btn" data-action="discuss-review" style="background:var(--accent);color:#fff">Discuss this review</button>';
          wrapper.appendChild(discussDiv);
        }
      }
      if (btn) btn.textContent = 'Refresh';
    } catch (err) {
      if (btn) btn.textContent = 'Error — try again';
      showToast('Weekly review failed — try again', true);
      console.error('Review error:', err);
    }
  }

  return { renderWeeklyReview, generateWeeklyReview, discussReview };
}
