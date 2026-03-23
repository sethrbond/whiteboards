// ============================================================
// COMMAND PALETTE MODULE
// ============================================================
// Extracted from app.js — handles search/command palette, shortcut help,
// recent command tracking, and AI palette queries.

/**
 * Factory function to create command palette functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ openSearch, handleCmdNav, renderSearchResults, cmdPaletteAI, cmdExec, openShortcutHelp, resetCmdIdx }}
 */
export function createCommandPalette(deps) {
  const {
    $,
    $$,
    esc,
    highlightMatch,
    fmtDate,
    getData,
    userKey,
    closeModal,
    setModalTriggerEl,
    activeTasks,
    hasAI,
    showToast,
    setView,
    sendChat,
    toggleChat,
    openNewTask,
    openQuickAdd,
    openNewProject,
    openSettings,
    startFocus,
    aiReorganize,
    filterAIPrepared,
    setNudgeFilter,
  } = deps;

  let _cmdActions = {};
  let cmdIdx = 0;

  function openShortcutHelp() {
    setModalTriggerEl(document.activeElement);
    const isMac = navigator.platform.includes('Mac');
    const mod = isMac ? '\u2318' : 'Ctrl';
    const columns = [
      {
        title: 'Navigation',
        icon: '\u25C7',
        items: [
          [[mod, 'K'], 'Command palette'],
          [['/', ''], 'Focus quick capture'],
          [['j', ''], 'Move down'],
          [['k', ''], 'Move up'],
          [['Enter', ''], 'Expand task'],
          [['1', ''], 'Dashboard'],
          [['Esc', ''], 'Close anything'],
        ],
      },
      {
        title: 'Tasks',
        icon: '\u2726',
        items: [
          [['n', ''], 'New task'],
          [[mod, '\u21E7', 'K'], 'Quick add'],
          [['x', ''], 'Toggle done'],
          [['e', ''], 'Edit task'],
          [[mod, 'Z'], 'Undo'],
          [['w', ''], 'Weekly review'],
          [['?', ''], 'This help'],
        ],
      },
      {
        title: 'AI Features',
        icon: '\u26A1',
        items: [
          [[mod, '\u21E7', 'J'], 'AI Chat'],
          [[mod, '\u21E7', 'D'], 'Brainstorm'],
          [[mod, ','], 'Settings'],
        ],
      },
    ];
    const kbdStyle =
      "font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;background:var(--hover);border:1px solid var(--border);border-radius:5px;padding:2px 7px;color:var(--accent)";
    const sectionHtml = columns
      .map(
        (col) => `
      <div style="flex:1;min-width:160px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px">${col.icon} ${col.title}</div>
        ${col.items
          .map(
            ([keys, desc]) => `
          <div style="display:flex;align-items:center;gap:8px;padding:3px 0">
            <span style="display:inline-flex;gap:2px">${keys
              .filter(Boolean)
              .map((k) => '<kbd style="' + kbdStyle + '">' + k + '</kbd>')
              .join('')}</span>
            <span style="font-size:12px;color:var(--text2)">${desc}</span>
          </div>
        `,
          )
          .join('')}
      </div>
    `,
      )
      .join('');

    $('#modalRoot').innerHTML = `<div class="modal-overlay" data-action="close-modal" data-click-self="true">
      <div class="modal" style="max-width:640px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div class="modal-title" style="margin-bottom:0">Keyboard Shortcuts</div>
          <button class="btn" data-action="close-modal" style="padding:4px 10px;font-size:12px">Close</button>
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">${sectionHtml}</div>
      </div>
    </div>`;
  }

  // --- Recent command actions for command palette ---
  function getCmdRecent() {
    try {
      return JSON.parse(localStorage.getItem(userKey('wb_cmd_recent')) || '[]');
    } catch (_e) {
      return [];
    }
  }
  function pushCmdRecent(label) {
    let arr = getCmdRecent().filter((l) => l !== label);
    arr.unshift(label);
    if (arr.length > 5) arr = arr.slice(0, 5);
    localStorage.setItem(userKey('wb_cmd_recent'), JSON.stringify(arr));
  }

  function cmdExec(key, label) {
    pushCmdRecent(label);
    const fn = _cmdActions[key];
    if (fn) fn();
  }

  function openSearch() {
    cmdIdx = 0;
    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" style="align-items:flex-start;padding-top:min(20vh,140px)" data-action="close-modal" data-click-self="true" role="dialog" aria-modal="true" aria-label="Command palette"><div class="cmd-palette">
      <div class="cmd-input-row">
        <span class="cmd-icon">\u2318</span>
        <input class="cmd-input" id="searchInput" placeholder="Search tasks, projects, or type a command..." aria-label="Search tasks, projects, or commands" autofocus data-oninput-action="cmd-search" data-keydown-action="cmd-nav">
        <kbd class="cmd-hint">esc</kbd>
      </div>
      <div id="searchResults" class="cmd-results"></div>
    </div></div>`;
    $('#searchInput').focus();
    renderSearchResults('');
  }

  function handleCmdNav(e) {
    const items = $$('.cmd-item');
    const aiFooter = document.querySelector('.cmd-ai-footer');
    const allClickable = [...items, ...(aiFooter ? [aiFooter] : [])];
    if (!allClickable.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdIdx = Math.min(cmdIdx + 1, allClickable.length - 1);
      updateCmdHighlight(items);
      if (aiFooter) aiFooter.style.background = cmdIdx === allClickable.length - 1 ? 'var(--accent-dim)' : '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdIdx = Math.max(cmdIdx - 1, 0);
      updateCmdHighlight(items);
      if (aiFooter) aiFooter.style.background = '';
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // If AI footer is selected (last item and beyond cmd-items)
      if (aiFooter && cmdIdx >= items.length) {
        aiFooter.click();
        return;
      }
      if (items[cmdIdx]) items[cmdIdx].click();
      // If no results matched but AI is available, trigger AI
      else if (aiFooter && !items.length) {
        aiFooter.click();
      }
    }
  }

  function updateCmdHighlight(items) {
    items.forEach((el, i) => el.classList.toggle('active', i === cmdIdx));
    items[cmdIdx]?.scrollIntoView({ block: 'nearest' });
  }

  function renderSearchResults(query) {
    cmdIdx = 0;
    const el = $('#searchResults');
    const data = getData();
    const currentProject = deps.getCurrentProject();
    const q = (query || '').toLowerCase().trim();
    let html = '';

    // Commands (shown when empty or when query starts with >)
    const isCmd = q.startsWith('>');
    const cmdQ = isCmd ? q.slice(1).trim() : q;
    const commands = [
      {
        icon: '\u2726',
        label: 'New Task',
        hint: 'N',
        action: () => {
          closeModal();
          openNewTask(currentProject || '');
        },
      },
      {
        icon: '+',
        label: 'Quick Add',
        hint: '\u21E7\u2318K',
        action: () => {
          closeModal();
          openQuickAdd();
        },
      },
      {
        icon: '+',
        label: 'New Board',
        hint: '',
        action: () => {
          closeModal();
          openNewProject();
        },
      },
      {
        icon: '\u21AF',
        label: 'Brainstorm',
        hint: '\u2318D',
        action: () => {
          closeModal();
          setView('dump');
        },
      },
      {
        icon: '\u25CE',
        label: 'Focus Mode',
        hint: '/focus',
        action: () => {
          closeModal();
          startFocus();
        },
      },
      {
        icon: '\u2726',
        label: 'Ask AI',
        hint: '\u2318J',
        action: () => {
          closeModal();
          toggleChat();
        },
      },
      {
        icon: '\u2726',
        label: 'Reorganize All',
        hint: '',
        action: () => {
          closeModal();
          aiReorganize();
        },
      },
      {
        icon: '\u{1F4C5}',
        label: 'Calendar',
        hint: '',
        action: () => {
          closeModal();
          setView('calendar');
        },
      },
      {
        icon: '\u2630',
        label: 'All Tasks',
        hint: '',
        action: () => {
          closeModal();
          setView('all-tasks');
        },
      },
      {
        icon: '\u2605',
        label: 'Weekly Review',
        hint: 'W',
        action: () => {
          closeModal();
          setView('review');
        },
      },
      {
        icon: '\u2699',
        label: 'Settings',
        hint: '',
        action: () => {
          closeModal();
          openSettings();
        },
      },
      {
        icon: '\u2726',
        label: 'Show AI Prepared Tasks',
        hint: '',
        action: () => {
          closeModal();
          filterAIPrepared();
        },
      },
    ];

    // Register command actions by index and render item HTML
    _cmdActions = {};
    commands.forEach((c, i) => {
      _cmdActions['c' + i] = c.action;
    });
    const cmdItemHtml = (c, isActive, matchQ) => {
      const idx = commands.indexOf(c);
      const lt = matchQ ? highlightMatch(c.label, matchQ) : c.label;
      return `<div class="cmd-item ${isActive ? 'active' : ''}" data-action="cmd-exec" data-cmd-key="c${idx}" data-cmd-label="${c.label.replace(/"/g, '&quot;')}"><span class="cmd-item-icon">${c.icon}</span><span class="cmd-item-label">${lt}</span>${c.hint ? `<kbd class="cmd-item-hint">${c.hint}</kbd>` : ''}</div>`;
    };

    if (!q) {
      const recentLabels = getCmdRecent().slice(0, 3);
      const recentCmds = recentLabels.map((l) => commands.find((c) => c.label === l)).filter(Boolean);
      let globalIdx = 0;
      if (recentCmds.length) {
        html += '<div class="cmd-section-label">Recent</div>';
        recentCmds.forEach((c) => {
          html += cmdItemHtml(c, globalIdx === 0);
          globalIdx++;
        });
      }
      const recentSet = new Set(recentLabels);
      const remainingCmds = commands.filter((c) => !recentSet.has(c.label));
      html += '<div class="cmd-section-label">Commands</div>';
      remainingCmds.slice(0, 5).forEach((c) => {
        html += cmdItemHtml(c, globalIdx === 0);
        globalIdx++;
      });
      // "What can Whiteboards do?" discovery chip — always shown in empty palette
      const _helpKey = 'c_help';
      _cmdActions[_helpKey] = () => {
        closeModal();
        const _helpHtml =
          '<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" style="max-width:440px;padding:28px">' +
          '<div style="font-size:15px;font-weight:600;margin-bottom:14px">What can Whiteboards do?</div>' +
          '<ul style="font-size:13px;color:var(--text2);line-height:2;padding-left:18px;margin:0">' +
          '<li><strong>Brainstorm</strong> \u2014 Paste notes, meeting minutes, or ideas and AI extracts tasks</li>' +
          '<li><strong>AI Chat</strong> \u2014 Ask your assistant to plan, prioritize, or break down work</li>' +
          '<li><strong>Focus Mode</strong> \u2014 AI picks your next deep-work session with a timer</li>' +
          '<li><strong>Daily Briefing</strong> \u2014 Get a morning summary of what needs attention</li>' +
          '<li><strong>Weekly Review</strong> \u2014 AI-generated reflection on your productivity</li>' +
          '<li><strong>Smart Scheduling</strong> \u2014 Natural language dates, recurring tasks, dependencies</li>' +
          '<li><strong>Command Palette</strong> \u2014 Press <kbd style="font-size:11px;background:var(--hover);border:1px solid var(--border);border-radius:4px;padding:1px 5px">Cmd+K</kbd> to do anything fast</li>' +
          '</ul>' +
          '<div style="margin-top:16px;text-align:right"><button class="btn btn-primary" data-action="close-modal" style="font-size:12px">Got it</button></div>' +
          '</div></div>';
        const mr = document.getElementById('modalRoot');
        if (mr) mr.innerHTML = _helpHtml;
      };
      html +=
        '<div class="cmd-item" data-action="cmd-exec" data-cmd-key="' +
        _helpKey +
        '" data-cmd-label="What can Whiteboards do?"><span class="cmd-item-icon" style="color:var(--accent)">?</span><span class="cmd-item-label" style="color:var(--text2);font-style:italic">What can Whiteboards do?</span></div>';
      const recent = [...data.tasks]
        .filter((t) => t.status !== 'done')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 5);
      if (recent.length) {
        html += '<div class="cmd-section-label">Recent Tasks</div>';
        recent.forEach((t) => {
          const p = t.project ? data.projects.find((x) => x.id === t.project) : null;
          html += cmdTaskItem(t, p);
        });
      }
    } else if (isCmd) {
      // Filter commands
      const filtered = commands.filter((c) => c.label.toLowerCase().includes(cmdQ));
      if (filtered.length) {
        html += '<div class="cmd-section-label">Commands</div>';
        filtered.forEach((c, i) => {
          html += cmdItemHtml(c, i === 0, cmdQ);
        });
      } else {
        html = '<div class="cmd-empty">No commands found</div>';
      }
    } else {
      // Search tasks + projects + commands
      const projectResults = data.projects.filter((p) => p.name.toLowerCase().includes(q));
      const taskResults = data.tasks
        .filter((t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q))
        .slice(0, 12);
      const cmdResults = commands.filter((c) => c.label.toLowerCase().includes(q));
      let idx = 0;

      if (cmdResults.length) {
        html += '<div class="cmd-section-label">Commands</div>';
        cmdResults.forEach((c) => {
          html += cmdItemHtml(c, idx === 0, q);
          idx++;
        });
      }
      if (projectResults.length) {
        html += '<div class="cmd-section-label">Boards</div>';
        projectResults.forEach((p) => {
          html += `<div class="cmd-item ${idx === 0 ? 'active' : ''}" data-action="cmd-go-project" data-project-id="${esc(p.id)}">
            <div class="cmd-item-dot" style="background:${p.color}"></div>
            <span class="cmd-item-label">${highlightMatch(esc(p.name), q)}</span>
            <span class="cmd-item-meta">${activeTasks(p.id).length} tasks</span>
          </div>`;
          idx++;
        });
      }
      if (taskResults.length) {
        html += '<div class="cmd-section-label">Tasks</div>';
        taskResults.forEach((t) => {
          const p = t.project ? data.projects.find((x) => x.id === t.project) : null;
          html += cmdTaskItem(t, p, q, idx === 0);
          idx++;
        });
      }
      if (!html) html = '<div class="cmd-empty">No results for "' + esc(q) + '"</div>';
      // Natural language task creation — if typed text doesn't start with > or /
      if (q.length > 1 && !q.startsWith('/')) {
        window._cmdCreateTitle = query.trim();
        html += `<div class="cmd-item cmd-create-task" data-action="cmd-create-task"><span class="cmd-item-icon" style="color:var(--accent)">+</span><span class="cmd-item-label">Create task: <strong>${esc(query.trim())}</strong></span><kbd class="cmd-item-hint">&#9166;</kbd></div>`;
      }
      // Add "Ask AI" footer for natural language queries when results are sparse or empty
      if (hasAI() && q.length > 3 && !isCmd) {
        html += `<div class="cmd-ai-footer" data-query="${encodeURIComponent(q)}">
          <span class="qc-ai-dot"></span>
          <span>Ask AI: "${esc(q)}"</span>
          <span style="margin-left:auto;font-size:10px;opacity:0.6">Enter</span>
        </div>`;
      }
    }
    el.innerHTML = html;
    const _aiF = el.querySelector('.cmd-ai-footer[data-query]');
    if (_aiF) {
      _aiF.addEventListener('click', () => {
        const dq = decodeURIComponent(_aiF.getAttribute('data-query'));
        closeModal();
        cmdPaletteAI(dq);
      });
    }
  }

  // --- Command palette natural language AI handler ---
  async function cmdPaletteAI(query) {
    if (!hasAI()) return;
    const q = query.trim();
    if (!q) return;

    // Check for known natural language patterns we can handle locally first
    const overduePat = /\b(overdue|past\s*due|late|behind)\b/i;
    if (overduePat.test(q)) {
      setNudgeFilter('overdue');
      setView('dashboard');
      showToast('Showing overdue tasks');
      return;
    }
    if (/\bstale\b|sitting\s+for/i.test(q)) {
      setNudgeFilter('stale');
      setView('dashboard');
      showToast('Showing stale tasks');
      return;
    }
    if (/\bunassigned\b|no\s+board/i.test(q)) {
      setNudgeFilter('unassigned');
      setView('dashboard');
      showToast('Showing unassigned tasks');
      return;
    }

    // For everything else, send to chat AI
    showToast('Sending to AI...', false, true);
    const panel = document.getElementById('chatPanel');
    if (!panel.classList.contains('open')) panel.classList.add('open');
    const chatInput = document.getElementById('chatInput');
    chatInput.value = q;
    sendChat();
  }

  function cmdTaskItem(t, p, q, isFirst) {
    const priColors = {
      urgent: 'var(--red)',
      important: 'var(--orange)',
      normal: 'var(--accent)',
      low: 'var(--text3)',
    };
    return `<div class="cmd-item ${isFirst ? 'active' : ''}" data-action="cmd-go-task" data-task-id="${esc(t.id)}" data-project-id="${p ? esc(p.id) : ''}">
      <div class="cmd-item-pri" style="background:${priColors[t.priority] || 'var(--accent)'}"></div>
      <span class="cmd-item-label ${t.status === 'done' ? 'cmd-done' : ''}">${q ? highlightMatch(esc(t.title), q) : esc(t.title)}</span>
      ${p ? `<span class="cmd-item-meta">${esc(p.name)}</span>` : ''}
      ${t.dueDate ? `<span class="cmd-item-meta">${fmtDate(t.dueDate)}</span>` : ''}
    </div>`;
  }

  function resetCmdIdx() {
    cmdIdx = 0;
  }

  return {
    openSearch,
    handleCmdNav,
    renderSearchResults,
    cmdPaletteAI,
    cmdExec,
    openShortcutHelp,
    resetCmdIdx,
  };
}
