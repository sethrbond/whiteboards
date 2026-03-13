// AI-first dashboard redesign — loaded via <script> tag
// Overrides renderDashboard() with the new AI-first layout

// Keyboard shortcut: Cmd+J / Ctrl+J to toggle chat panel
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
    e.preventDefault();
    if (typeof toggleChat === 'function') toggleChat();
  }
});

// State for smart feed and briefing expand/collapse
let _smartFeedExpanded = false;
let _todayBriefingExpanded = false;

// Store original renderDashboard for fallback
const _origRenderDashboard = typeof renderDashboard === 'function' ? renderDashboard : null;

// Helper: build AI status items from proactive worker results
function getAIStatusItems() {
  const items = [];
  const flagKey = userKey('whiteboard_proactive_' + todayStr());
  const proactiveRan = localStorage.getItem(flagKey);

  // Check proactive log for today
  const logKey = userKey('wb_proactive_log_' + new Date().toISOString().slice(0, 10));
  let todayLog = [];
  try { todayLog = JSON.parse(localStorage.getItem(logKey) || '[]'); } catch(e) {}

  // Check how many tasks were AI-drafted today
  const draftedTasks = data.tasks.filter(t => t.notes && t.notes.startsWith('**AI Draft:**') && t.createdAt && t.createdAt.slice(0,10) === todayStr());
  if (draftedTasks.length > 0) {
    items.push({ icon: '✦', text: `Prepared ${draftedTasks.length} task${draftedTasks.length > 1 ? 's' : ''} with drafts` });
  }

  // Check completions since last visit (tasks done by others or by automation)
  const completedToday = data.tasks.filter(t => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === todayStr());
  if (completedToday.length > 0) {
    items.push({ icon: '✓', text: `${completedToday.length} task${completedToday.length > 1 ? 's' : ''} completed today` });
  }

  // Check if briefing was generated
  const briefingKey = userKey('whiteboard_briefing_' + todayStr());
  if (localStorage.getItem(briefingKey)) {
    items.push({ icon: '◎', text: 'Daily briefing ready' });
  }

  // Check if plan exists
  const planKey = userKey('whiteboard_plan_' + todayStr());
  if (localStorage.getItem(planKey)) {
    items.push({ icon: '▶', text: 'Day plan prepared' });
  }

  return items;
}

// Helper: build the unified smart feed
function getSmartFeedItems() {
  const today = todayStr();
  const active = data.tasks.filter(t => t.status !== 'done' && !t.archived);
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  // Check if there's a day plan — if so, use it as the primary source
  const planKey = userKey('whiteboard_plan_' + today);
  const cachedPlan = localStorage.getItem(planKey);
  if (cachedPlan) {
    try {
      const plan = JSON.parse(cachedPlan);
      const planTasks = plan.map(p => {
        const t = data.tasks.find(x => x.id === p.id);
        if (!t) return null;
        return { task: t, why: p.why, source: 'plan', order: plan.indexOf(p) };
      }).filter(Boolean);
      // Add any overdue tasks not in the plan
      const planIds = new Set(plan.map(p => p.id));
      const overdue = active.filter(t => t.dueDate && t.dueDate < today && !planIds.has(t.id));
      overdue.forEach(t => planTasks.unshift({ task: t, source: 'overdue', order: -1 }));
      return planTasks;
    } catch(e) {}
  }

  // No plan — build smart feed from task data
  const items = [];
  const seen = new Set();

  // 1. Overdue first
  const overdue = active.filter(t => t.dueDate && t.dueDate < today);
  overdue.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  overdue.forEach(t => { if (!seen.has(t.id)) { items.push({ task: t, source: 'overdue' }); seen.add(t.id); } });

  // 2. Urgent
  const urgent = active.filter(t => t.priority === 'urgent' && !seen.has(t.id));
  urgent.forEach(t => { items.push({ task: t, source: 'urgent' }); seen.add(t.id); });

  // 3. In progress
  const inProg = active.filter(t => t.status === 'in-progress' && !seen.has(t.id));
  inProg.forEach(t => { items.push({ task: t, source: 'in-progress' }); seen.add(t.id); });

  // 4. Due soon (this week)
  const dueSoon = active.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= weekFromNow && !seen.has(t.id));
  dueSoon.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  dueSoon.forEach(t => { items.push({ task: t, source: 'due-soon' }); seen.add(t.id); });

  // 5. Due today
  const dueToday = active.filter(t => t.dueDate === today && !seen.has(t.id));
  dueToday.forEach(t => { items.push({ task: t, source: 'due-today' }); seen.add(t.id); });

  return items;
}

function heroInputHandler(e) {
  if (e.key !== 'Enter') return;
  const val = e.target.value.trim();
  if (!val) return;

  // Slash commands
  if (val.startsWith('/')) {
    const handled = handleSlashCommand(val);
    if (handled) { e.target.value = ''; return; }
    showToast('Commands: /done, /urgent, /focus, /plan, /move ... to ...', true);
    return;
  }

  // Complex input → open chat panel with the message
  if (isComplexInput(val) && hasAI()) {
    e.target.value = '';
    // Open chat panel and inject message
    const panel = document.getElementById('chatPanel');
    if (panel && !panel.classList.contains('open')) toggleChat();
    const chatInput = document.getElementById('chatInput');
    if (chatInput) { chatInput.value = val; sendChat(); }
    return;
  }

  // #hashtag → assign to project
  let projectId = '';
  const hashMatch = val.match(/#(\S+)/);
  if (hashMatch) {
    const tag = hashMatch[1].toLowerCase();
    const proj = data.projects.find(p => p.name.toLowerCase().includes(tag));
    if (proj) projectId = proj.id;
  }
  const cleanVal = val.replace(/#\S+/g, '').trim();

  // Normal task creation
  const parsed = parseQuickInput(cleanVal);
  const newTask = createTask({
    title: parsed.title,
    priority: parsed.priority || 'normal',
    dueDate: parsed.dueDate || '',
    project: projectId || parsed.quickProject?.id || ''
  });
  addTask(newTask);
  e.target.value = '';
  showToast(`+ ${parsed.title}${parsed.dueDate ? ' (due ' + parsed.dueDate + ')' : ''}`, false, true);
  render();
  if (isComplexInput(val)) { aiEnhanceTask(newTask.id, val); }
}

// Override renderDashboard
renderDashboard = function() {
  const urgent = urgentTasks();
  const active = activeTasks();
  const done = doneTasks();
  const inProgress = active.filter(t => t.status === 'in-progress');

  // Fresh start welcome (keep original)
  if (data.tasks.length === 0 && data.projects.length <= 1) {
    return `<div style="max-width:480px;margin:60px auto;text-align:center">
      <div style="font-size:48px;margin-bottom:16px;opacity:0.3">✦</div>
      <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">A clean slate.</h2>
      <p style="font-size:14px;color:var(--text3);line-height:1.6;margin-bottom:28px">Paste anything into Brainstorm and your AI co-pilot will organize it &mdash; meeting notes, project plans, brain dumps, anything.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="openNewProject()">+ New Board</button>
        <button class="btn" onclick="setView('dump')">↯ Brainstorm</button>
      </div>
    </div>`;
  }

  let html = '';

  // ===== 1. AI HERO CARD =====
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dueToday = active.filter(t => t.dueDate === todayStr());
  const overdue = active.filter(t => t.dueDate && t.dueDate < todayStr());

  // Sub-greeting: contextual awareness
  let subGreeting = '';
  if (overdue.length) subGreeting = `${overdue.length} overdue — let's tackle those first.`;
  else if (urgent.length) subGreeting = `${urgent.length} urgent task${urgent.length > 1 ? 's' : ''} waiting.`;
  else if (dueToday.length) subGreeting = `${dueToday.length} due today.`;
  else if (active.length) subGreeting = `${active.length} tasks across ${data.projects.length} boards.`;
  else subGreeting = 'Nothing pressing. A good day to plan ahead.';

  // AI status items
  const statusItems = getAIStatusItems();

  // Nudges
  const nudges = getSmartNudges();
  const stuckTasks = getStuckTasks();
  const colorMap = { urgent: 'var(--red)', warning: 'var(--orange)', action: 'var(--accent)', positive: 'var(--green)', stale: 'var(--text3)', habit: 'var(--purple)' };

  html += `<div class="ai-hero-card">`;
  html += `<div class="ai-hero-greeting">${greeting}</div>`;
  html += `<div class="ai-hero-sub">${subGreeting}${!overdue.length ? ` <span style="color:var(--text3)">${active.length} active · ${inProgress.length} in progress · ${done.length} done</span>` : ''}</div>`;

  // Status items from proactive worker
  if (statusItems.length > 0) {
    html += `<div class="ai-hero-status">`;
    statusItems.forEach(item => {
      html += `<div class="ai-hero-status-item"><div class="status-dot"></div>${esc(item.text)}</div>`;
    });
    html += `</div>`;
  }

  // Nudges inside the hero card
  if (nudges.length > 0 || stuckTasks.length > 0) {
    html += `<div class="ai-hero-nudges">`;
    nudges.forEach(n => {
      html += `<div class="ai-hero-nudge" style="border-left:3px solid ${colorMap[n.type] || 'var(--accent)'}">
        <span style="flex-shrink:0">${n.icon}</span>
        <span style="font-size:12px;color:var(--text2);line-height:1.4;flex:1">${n.text}</span>
        ${n.actionLabel ? `<button class="btn btn-sm" onclick="${n.actionFn}" style="flex-shrink:0;font-size:11px;padding:3px 10px;white-space:nowrap">${n.actionLabel}</button>` : ''}
      </div>`;
    });
    stuckTasks.slice(0, 2).forEach(t => {
      const lastTouch = t.updates?.length ? t.updates[t.updates.length - 1].date : t.createdAt;
      const days = Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000);
      html += `<div class="ai-hero-nudge" style="border-left:3px solid var(--amber)">
        <span style="flex-shrink:0">◇</span>
        <span style="font-size:12px;color:var(--text2);line-height:1.4;flex:1">
          <strong>${esc(t.title)}</strong> has been in-progress for ${days} days.
          ${hasAI() ? `<span style="color:var(--accent);cursor:pointer" onclick="event.stopPropagation();offerStuckHelp('${t.id}')">Think through it?</span>` : ''}
        </span>
      </div>`;
    });
    html += `</div>`;
  }

  // Conversational input (replaces quick capture)
  html += `<input class="conversational-input" id="quickCapture" placeholder="What's on your mind?" onkeydown="heroInputHandler(event)" oninput="previewQuickCapture()" autocomplete="off">`;
  html += `<div id="quickCapturePreview" class="smart-date-preview" style="padding-left:0"></div>`;
  // Hidden project dropdown (still accessible, used by quickAddFromCapture fallback and #hashtag)
  const projOpts = data.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  html += `<select class="quick-capture-project" id="quickCaptureProject" style="display:none">${projOpts}</select>`;

  html += `</div>`; // end ai-hero-card

  // ===== Nudge filter indicator =====
  if (_nudgeFilter) {
    const nfLabels = { overdue: 'Overdue tasks', stale: 'Stale tasks (10+ days)', unassigned: 'Unassigned tasks' };
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;margin-bottom:12px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-xs)">
      <span style="font-size:12px;color:var(--accent);font-weight:500">Filtering: ${nfLabels[_nudgeFilter] || _nudgeFilter}</span>
      <span style="font-size:11px;color:var(--accent);cursor:pointer;margin-left:auto" onclick="_nudgeFilter='';render()">Clear filter</span>
    </div>`;
  }

  // Tag filter
  const allTags = getAllTags();
  if (allTags.length) {
    if (activeTagFilter) {
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
        <span style="font-size:10px;color:var(--text3);margin-right:4px">Tag:</span>
        <span class="tag-chip tag-filter-btn selected" style="background:${getTagColor(activeTagFilter).bg};color:${getTagColor(activeTagFilter).color};font-size:10px" data-tag="${esc(activeTagFilter)}">${esc(activeTagFilter)}</span>
        <span style="font-size:10px;color:var(--accent);cursor:pointer;margin-left:4px" onclick="activeTagFilter='';render()">✕ clear</span>
      </div>`;
    } else {
      html += `<div style="margin-bottom:8px"><span onclick="_showTagFilter=!_showTagFilter;render()" style="font-size:10px;color:var(--text3);cursor:pointer;user-select:none">${_showTagFilter ? '▾' : '▸'} Filter by tag</span></div>`;
      if (_showTagFilter) {
        html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
          ${allTags.map(tag => {
            const c = getTagColor(tag);
            return `<span class="tag-chip tag-filter-btn" style="background:${c.bg};color:${c.color};font-size:10px" data-tag="${esc(tag)}">${esc(tag)}</span>`;
          }).join('')}
        </div>`;
      }
    }
  }

  // ===== 2. SMART FEED =====
  const feedItems = getSmartFeedItems();
  const feedLimit = _smartFeedExpanded ? feedItems.length : Math.min(10, feedItems.length);

  if (feedItems.length > 0) {
    html += `<div class="smart-feed">`;
    html += `<div class="smart-feed-header"><div class="smart-feed-title">Your Focus</div><div class="smart-feed-count">${feedItems.length}</div><div class="smart-feed-line"></div></div>`;

    feedItems.slice(0, feedLimit).forEach((item, i) => {
      html += renderTaskRow(item.task, true);
      if (item.why) html += `<div style="margin-left:28px;font-size:11px;color:var(--text3);margin-bottom:4px;margin-top:-4px;font-style:italic">↳ ${esc(item.why)}</div>`;
    });

    if (feedItems.length > 10 && !_smartFeedExpanded) {
      html += `<button class="smart-feed-more" onclick="_smartFeedExpanded=true;render()">Show ${feedItems.length - 10} more</button>`;
    } else if (_smartFeedExpanded && feedItems.length > 10) {
      html += `<button class="smart-feed-more" onclick="_smartFeedExpanded=false;render()">Show less</button>`;
    }
    html += `</div>`;
  }

  // ===== 3. TODAY CARD (merged briefing + plan) =====
  const briefingKey = userKey('whiteboard_briefing_' + todayStr());
  const cachedBriefing = localStorage.getItem(briefingKey);
  const planKey = userKey('whiteboard_plan_' + todayStr());
  const cachedPlan = localStorage.getItem(planKey);

  if (hasAI() && (cachedBriefing || cachedPlan || _briefingGenerating || _planGenerating)) {
    html += `<div class="today-card">`;
    html += `<div class="today-card-header">
      <span style="font-size:14px">✦</span>
      <div class="today-card-title">Today</div>
      <div class="today-card-date">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
    </div>`;

    // Briefing (collapsed by default, click to expand)
    if (cachedBriefing) {
      if (_todayBriefingExpanded) {
        html += `<div class="today-briefing-body" id="briefingBody">${sanitizeAIHTML(cachedBriefing)}</div>`;
        html += `<button class="briefing-generate" onclick="_todayBriefingExpanded=false;render()" style="font-size:11px;margin-top:6px;margin-bottom:8px">Show less</button>`;
      } else {
        html += `<div style="font-size:13px;color:var(--text2);line-height:1.7;max-height:2.8em;overflow:hidden;position:relative;cursor:pointer" onclick="_todayBriefingExpanded=true;render()" id="briefingBody">
          ${sanitizeAIHTML(cachedBriefing)}
          <div style="position:absolute;bottom:0;left:0;right:0;height:1.4em;background:linear-gradient(transparent,rgba(19,19,22,.9));pointer-events:none"></div>
        </div>`;
        html += `<button class="briefing-generate" onclick="_todayBriefingExpanded=true;render()" style="font-size:11px;margin-top:4px;margin-bottom:8px">Read more</button>`;
      }
    } else if (_briefingGenerating) {
      html += `<div class="skeleton-pulse" style="padding:16px 20px;min-height:60px;display:flex;align-items:center;justify-content:center;margin-bottom:8px"><span style="font-size:12px;color:var(--text3)">Generating your briefing...</span></div>`;
    }

    // Plan tasks inline
    if (cachedPlan) {
      try {
        const plan = JSON.parse(cachedPlan);
        const doneCount = plan.filter(p => p.completedInPlan || (data.tasks.find(x => x.id === p.id) && data.tasks.find(x => x.id === p.id).status === 'done')).length;
        const totalCount = plan.filter(p => data.tasks.find(x => x.id === p.id)).length;
        const planMinutes = plan.reduce((sum, p) => { const t = data.tasks.find(x => x.id === p.id); return sum + (t && t.estimatedMinutes ? t.estimatedMinutes : 0); }, 0);
        const planTimeStr = planMinutes > 0 ? ` · ~${Math.round(planMinutes / 60 * 10) / 10}h` : '';

        html += `<div style="border-top:1px solid rgba(129,140,248,0.1);padding-top:12px;margin-top:8px">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent)">Day Plan</span>
          <span style="font-size:10px;color:${doneCount === totalCount && totalCount > 0 ? 'var(--green)' : 'var(--text3)'}">${doneCount}/${totalCount} done${planTimeStr}</span>
          <span style="margin-left:auto;font-size:10px;color:var(--text3);cursor:pointer" onclick="localStorage.removeItem('${planKey}');render()">clear</span>
        </div>`;

        plan.forEach((p, i) => {
          const t = data.tasks.find(x => x.id === p.id);
          if (!t) return;
          const isDone = p.completedInPlan || t.status === 'done';
          html += `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:2px;${isDone ? 'text-decoration:line-through;opacity:0.5' : ''}">
            <span style="font-size:11px;color:var(--text3);min-width:18px;padding-top:10px">${i + 1}.</span>
            <div style="flex:1">${renderTaskRow(t, true)}</div>
            ${!isDone ? `<button onclick="snoozePlanTask('${p.id}')" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:8px 4px;white-space:nowrap;flex-shrink:0" title="Snooze to tomorrow" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text3)'">snooze</button>` : ''}
          </div>`;
          if (p.why) html += `<div style="margin-left:28px;font-size:11px;color:var(--text3);margin-bottom:8px;margin-top:-4px;font-style:italic">↳ ${esc(p.why)}</div>`;
        });
        html += `<div style="margin-top:8px"><button onclick="replanDay()" class="briefing-generate" style="color:var(--accent);font-size:11px">↻ Replan</button></div>`;
        html += `</div>`;
      } catch (e) { console.warn('Plan render failed:', e); }
    } else if (_planGenerating) {
      html += `<div class="skeleton-pulse" style="padding:16px 20px;min-height:80px;display:flex;align-items:center;justify-content:center">
        <span style="font-size:12px;color:var(--text3)">Planning your day...</span>
      </div>`;
    }

    // Action buttons
    html += `<div style="display:flex;gap:8px;margin-top:12px">
      <button class="briefing-generate" onclick="generateAIBriefing()" id="briefingBtn">${cachedBriefing ? '↻ Refresh' : (_briefingGenerating ? '✦ Generating...' : '✦ Generate Briefing')}</button>
      <button class="briefing-generate" onclick="planMyDay()" id="planBtn" style="color:var(--accent)">◎ Plan My Day</button>
    </div>`;

    html += `</div>`; // end today-card
  } else if (hasAI()) {
    // No briefing or plan yet — show minimal today card with generate buttons
    html += `<div class="today-card">
      <div class="today-card-header">
        <span style="font-size:14px">✦</span>
        <div class="today-card-title">Today</div>
        <div class="today-card-date">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="briefing-generate" onclick="generateAIBriefing()" id="briefingBtn">✦ Generate Briefing</button>
        <button class="briefing-generate" onclick="planMyDay()" id="planBtn" style="color:var(--accent)">◎ Plan My Day</button>
      </div>
    </div>`;
  }

  // ===== End of Day (keep original) =====
  const eodKey = userKey('wb_eod_' + todayStr());
  const cachedEod = localStorage.getItem(eodKey);
  const completedToday = data.tasks.filter(t => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === todayStr());
  if (new Date().getHours() >= 17 && hasAI() && completedToday.length >= 1) {
    if (cachedEod) {
      html += `<div class="eod-card">
        <div class="eod-header">
          <span style="font-size:14px;color:var(--purple)">&#9790;</span>
          <div class="eod-title">End of Day</div>
          <span style="font-size:11px;color:var(--text3);margin-left:auto">Today</span>
        </div>
        <div class="eod-response">${sanitizeAIHTML(cachedEod)}</div>
      </div>`;
    } else {
      html += `<div class="eod-card" id="eodCard">
        <div class="eod-header">
          <span style="font-size:14px;color:var(--purple)">&#9790;</span>
          <div class="eod-title">How did today go?</div>
        </div>
        <textarea class="eod-textarea" id="eodInput" rows="3" placeholder="What went well? What was hard? Anything on your mind..."></textarea>
        <div style="display:flex;gap:8px">
          <button class="briefing-generate" onclick="submitEndOfDay()" id="eodBtn" style="color:var(--purple);border-color:rgba(168,85,247,0.2)">Wrap up</button>
          <button class="briefing-generate" onclick="document.getElementById('eodCard').remove()" style="color:var(--text3);border-color:var(--border)">Skip</button>
        </div>
      </div>`;
    }
  }

  // ===== Today's Habits (keep original) =====
  if (data.habits.length > 0) {
    const todayD = ds(new Date());
    html += `<div class="section"><div class="section-header"><div class="section-title">Today's Habits</div><div class="section-line"></div></div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">`;
    data.habits.forEach(h => {
      const checked = !!h.completions[todayD];
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--surface);border:1px solid ${checked?'var(--accent)':'var(--border)'};border-radius:var(--radius-sm);cursor:pointer;transition:all 0.15s" onclick="toggleHabitDay('${h.id}','${todayD}');render()">
        <div class="habit-day ${checked?'checked':''}" style="width:20px;height:20px;font-size:9px;pointer-events:none">${checked?'&#10003;':''}</div>
        <span style="font-size:12px;font-weight:500;color:${checked?'var(--accent)':'var(--text2)'}">${esc(h.name)}</span>
      </div>`;
    });
    html += `</div></div>`;
  }

  // ===== 4. BOARD GRID (pushed lower) =====
  html += `<div class="section"><div class="section-header"><div class="section-title">Boards</div><div class="section-count">${data.projects.length}</div><div class="section-line"></div></div>`;
  if (data.projects.length === 0) {
    html += `<div class="empty"><div class="empty-icon">◈</div><div class="empty-text">No boards yet. Create one to get started.</div><button class="btn btn-primary" onclick="openNewProject()">+ New Board</button></div>`;
  } else {
    html += '<div class="project-grid">';
    data.projects.forEach(p => {
      const pt = projectTasks(p.id);
      const ptActive = pt.filter(t => t.status !== 'done');
      const urgentP = ptActive.filter(t => t.priority === 'urgent');
      const topTasks = sortTasks(ptActive).slice(0, 3);

      html += `<div class="project-grid-card" data-project="${p.id}">
        <div class="project-grid-header">
          <div class="project-grid-dot" style="background:${p.color}"></div>
          <div class="project-grid-name">${esc(p.name)}</div>
        </div>
        <div class="project-grid-stats">
          <div class="project-grid-stat"><strong>${ptActive.length}</strong> active</div>
          ${urgentP.length ? `<div class="project-grid-stat" style="color:var(--red)"><strong>${urgentP.length}</strong> urgent</div>` : ''}
        </div>
        ${topTasks.length ? `<div class="project-grid-tasks">${topTasks.map(t => `<div class="project-grid-task"><div class="mini-dot" style="background:${priorityColor(t.priority)}"></div>${esc(t.title)}</div>`).join('')}</div>` : ''}
        ${p.description ? `<div class="ai-summary">${esc(p.description).slice(0, 120)}${p.description.length > 120 ? '...' : ''}</div>` : ''}
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  return html;
};
