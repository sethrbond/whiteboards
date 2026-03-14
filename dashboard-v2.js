// AI-first dashboard redesign — loaded via <script> tag
// Overrides renderDashboard() with the new AI-first layout

// State for smart feed and briefing expand/collapse
let _smartFeedExpanded = false;
let _todayBriefingExpanded = false;

// Animated typing effect for empty-state welcome
let _welcomeTypingInterval = null;
function startWelcomeTyping() {
  const el = document.getElementById('welcomeTyping');
  if (!el || _welcomeTypingInterval) return;
  let phrases;
  try { phrases = JSON.parse(el.dataset.phrases || '[]'); } catch(e) { return; }
  if (!phrases.length) return;
  let pi = 0, ci = 0, deleting = false;
  _welcomeTypingInterval = setInterval(() => {
    const target = document.getElementById('welcomeTyping');
    if (!target) { clearInterval(_welcomeTypingInterval); _welcomeTypingInterval = null; return; }
    const phrase = phrases[pi];
    if (!deleting) {
      ci++;
      target.textContent = phrase.slice(0, ci);
      if (ci >= phrase.length) { setTimeout(() => { deleting = true; }, 1200); return; }
    } else {
      ci--;
      target.textContent = phrase.slice(0, ci);
      if (ci <= 0) { deleting = false; pi = (pi + 1) % phrases.length; }
    }
  }, 65);
  // Use MutationObserver to detect when element is removed
  const obs = new MutationObserver(() => {
    if (!document.getElementById('welcomeTyping')) {
      clearInterval(_welcomeTypingInterval);
      _welcomeTypingInterval = null;
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// Quick brainstorm: track word count in hero input for brainstorm hint
function setupQuickBrainstorm() {
  const input = document.getElementById('quickCapture');
  const hintEl = document.getElementById('brainstormHint');
  if (!input || !hintEl) return;
  input.addEventListener('input', function() {
    const words = this.value.trim().split(/\s+/).filter(Boolean).length;
    if (words >= 30) {
      hintEl.style.display = 'block';
    } else {
      hintEl.style.display = 'none';
    }
  });
  input.addEventListener('keydown', function(e) {
    if (e.shiftKey && e.key === 'Enter') {
      const val = this.value.trim();
      const words = val.split(/\s+/).filter(Boolean).length;
      if (words >= 30) {
        e.preventDefault();
        this.value = '';
        const hintEl2 = document.getElementById('brainstormHint');
        if (hintEl2) hintEl2.style.display = 'none';
        setView('dump');
        setTimeout(() => {
          const t = document.getElementById('dumpText');
          if (t) { t.value = val; t.focus(); t.dispatchEvent(new Event('input')); }
        }, 100);
      }
    }
  });
}

// Hook into render cycle to start typing animation + brainstorm hint
(function hookDashboardPostRender() {
  const origRender = window.render;
  if (typeof origRender !== 'function') {
    // Retry — render may not be defined yet
    setTimeout(hookDashboardPostRender, 200);
    return;
  }
  window.render = function() {
    const result = origRender.apply(this, arguments);
    requestAnimationFrame(() => {
      startWelcomeTyping();
      setupQuickBrainstorm();
    });
    return result;
  };
})();

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

  // Fresh start welcome — magical empty state centered on brainstorm
  if (data.tasks.length === 0 && data.projects.length <= 1) {
    const _emptyPhrases = ['Plan my week...', 'Meeting notes from today...', 'Ideas for the project...', 'Things I need to get done...', 'Brainstorm everything...'];
    const _emptyPhrase = _emptyPhrases[Math.floor(Math.random() * _emptyPhrases.length)];
    return `<div style="max-width:540px;margin:48px auto;text-align:center">
      <div id="welcomeTyping" style="font-size:22px;font-weight:600;margin-bottom:6px;min-height:32px" data-phrases='${JSON.stringify(_emptyPhrases)}'></div>
      <p style="font-size:14px;color:var(--text3);line-height:1.6;margin-bottom:32px">Write freely &mdash; plans, ideas, meeting notes, anything. AI organizes everything into tasks and projects.</p>
      <div onclick="setView('dump')" class="brainstorm-cta-hover" style="background:var(--surface);border:2px solid var(--accent);border-radius:var(--radius);padding:32px 28px;cursor:pointer;margin-bottom:20px;text-align:left;position:relative">
        <div style="font-size:28px;margin-bottom:12px">&#9671;</div>
        <div style="font-size:17px;font-weight:600;margin-bottom:6px;color:var(--text)">Start a brainstorm</div>
        <div style="font-size:13px;color:var(--text3);line-height:1.6;margin-bottom:16px">Write your thoughts, paste meeting notes, attach docs &mdash; all at once. AI reads everything and creates organized, prioritized tasks.</div>
        <button class="btn btn-primary brainstorm-hero-btn" onclick="event.stopPropagation();setView('dump')">Open brainstorm &rarr;</button>
      </div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:20px">or add a task manually with the input above</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;text-align:left">
        <div onclick="setView('dump');setTimeout(()=>{const t=document.getElementById('dumpText');if(t){t.value='Here are my plans for the week:\\n- ';t.focus();t.setSelectionRange(t.value.length,t.value.length)}},100)" class="dashboard-card-hover" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 16px;cursor:pointer">
          <div style="font-size:24px;margin-bottom:10px">&#9671;</div>
          <div style="font-size:13px;font-weight:600;margin-bottom:4px">Plan my week</div>
          <div style="font-size:12px;color:var(--text3);line-height:1.5">Drop your weekly goals and let AI organize them</div>
        </div>
        <div onclick="setView('dump')" class="dashboard-card-hover" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 16px;cursor:pointer">
          <div style="font-size:24px;margin-bottom:10px">&#8623;</div>
          <div style="font-size:13px;font-weight:600;margin-bottom:4px">Import from notes</div>
          <div style="font-size:12px;color:var(--text3);line-height:1.5">Paste meeting notes, docs, or ideas &mdash; AI extracts tasks</div>
        </div>
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
      html += `<div class="ai-hero-status-item ai-status-item"><span class="status-icon">${item.icon}</span>${esc(item.text)}</div>`;
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
  html += `<input class="conversational-input" id="quickCapture" placeholder="Add anything — tasks, notes, ideas..." onkeydown="heroInputHandler(event)" oninput="previewQuickCapture()" autocomplete="off">`;
  html += `<div id="quickCapturePreview" class="smart-date-preview" style="padding-left:0"></div>`;
  // Quick brainstorm hint (appears when typing 30+ words)
  html += `<div id="brainstormHint" style="display:none;font-size:11px;color:var(--accent);padding:6px 0 0;opacity:0.85;transition:opacity 0.2s"><kbd style="background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;font-family:inherit">Shift+Enter</kbd> &rarr; Organize with AI</div>`;
  // Hidden project dropdown (used by #hashtag project assignment)
  const projOpts = data.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  html += `<select class="quick-capture-project" id="quickCaptureProject" style="display:none">${projOpts}</select>`;

  html += `</div>`; // end ai-hero-card

  // ===== BRAINSTORM CTA CARD =====
  const _dumpHistory = typeof getDumpHistory === 'function' ? getDumpHistory() : [];
  const _showDumpInvite = typeof shouldShowDumpInvite === 'function' ? shouldShowDumpInvite() : true;
  let _brainstormStat = '';
  if (_dumpHistory.length > 0) {
    const last = _dumpHistory[0];
    const ago = Math.floor((Date.now() - new Date(last.date).getTime()) / 3600000);
    if (!isNaN(ago)) {
      const agoStr = ago < 1 ? 'just now' : ago < 24 ? ago + 'h ago' : Math.floor(ago / 24) + 'd ago';
      _brainstormStat = `Last: ${last.tasksCreated} task${last.tasksCreated !== 1 ? 's' : ''} from ${last.wordCount} words, ${agoStr}`;
    }
  }
  html += `<div onclick="setView('dump')" class="brainstorm-cta-main" style="background:linear-gradient(135deg,rgba(129,140,248,.06),rgba(168,85,247,.03));border:1px solid ${_showDumpInvite ? 'var(--accent)' : 'rgba(129,140,248,0.2)'};border-radius:var(--radius);padding:20px 24px;cursor:pointer;transition:all 0.2s;margin-bottom:20px;display:flex;align-items:center;gap:16px;${_showDumpInvite ? 'box-shadow:0 0 0 1px rgba(129,140,248,0.1),0 4px 20px rgba(129,140,248,0.08)' : ''}">
    <div style="font-size:28px;flex-shrink:0">&#9671;</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:3px">Ready to brainstorm?</div>
      <div style="font-size:12px;color:var(--text3);line-height:1.4">${_brainstormStat ? esc(_brainstormStat) : 'Write thoughts, paste notes, attach docs — AI extracts tasks, sets deadlines, and sorts by project.'}</div>
    </div>
    <div class="brainstorm-btn-hover" style="flex-shrink:0;font-size:13px;font-weight:600;color:#fff;white-space:nowrap;padding:8px 18px;background:var(--accent);border-radius:var(--radius-sm)">Brainstorm</div>
  </div>`;

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
  let feedItems = getSmartFeedItems();
  // Apply nudge filter if active
  if (_nudgeFilter) {
    const today = todayStr();
    const allActive = data.tasks.filter(t => t.status !== 'done' && !t.archived);
    let filtered = [];
    if (_nudgeFilter === 'overdue') filtered = allActive.filter(t => t.dueDate && t.dueDate < today);
    else if (_nudgeFilter === 'stale') filtered = allActive.filter(t => { const lt = t.updates?.length ? t.updates[t.updates.length-1].date : t.createdAt; return lt && (Date.now() - new Date(lt).getTime()) > 10*86400000; });
    else if (_nudgeFilter === 'unassigned') filtered = allActive.filter(t => !t.project);
    if (filtered.length) feedItems = filtered.map(t => ({ task: t, source: _nudgeFilter }));
  }
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
          <div style="position:absolute;bottom:0;left:0;right:0;height:1.4em;background:linear-gradient(transparent,var(--bg));pointer-events:none"></div>
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
            ${!isDone ? `<button onclick="snoozePlanTask('${p.id}')" class="snooze-btn-hover" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:8px 4px;white-space:nowrap;flex-shrink:0" title="Snooze to tomorrow">snooze</button>` : ''}
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
  const eodDismissedKey = userKey('whiteboard_eod_dismissed_' + todayStr());
  if (new Date().getHours() >= 17 && hasAI() && completedToday.length >= 1 && !localStorage.getItem(eodDismissedKey)) {
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
          <button class="briefing-generate" onclick="localStorage.setItem(userKey('whiteboard_eod_dismissed_'+todayStr()),'1');document.getElementById('eodCard').remove()" style="color:var(--text3);border-color:var(--border)">Skip</button>
        </div>
      </div>`;
    }
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
