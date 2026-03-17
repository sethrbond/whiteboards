// ============================================================
// AI CHAT MODULE
// ============================================================
// Extracted from app.js — handles AI chat panel, messaging, history

import { MS_PER_DAY, STALE_TASK_DAYS, MAX_CHAT_HISTORY } from './constants.js';

/**
 * Factory function to create chat functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ toggleChat, sendChat, sendChatChip, updateChatChips, openProjectChat, chatTimeStr, saveChatHistory, getChatHistory, getChatSessionStarted, setChatSessionStarted, getChatContext, setChatContext, setChatHistory, offerStuckHelp, resetChatState, reloadChatHistory, maybeProactiveChat }}
 */
export function createChat(deps) {
  const {
    esc,
    todayStr,
    getData,
    hasAI,
    getAIEndpoint,
    buildAIContext,
    AI_PERSONA,
    AI_ACTIONS_SPEC,
    executeAIActions,
    incrementAIInteraction,
    render,
    callAI,
    findTask,
    userKey,
    CHAT_HISTORY_KEY,
    getSettings,
    getStuckTasks,
  } = deps;

  // Module-local state
  let chatHistory;
  try {
    chatHistory = JSON.parse(localStorage.getItem(userKey(CHAT_HISTORY_KEY)) || '[]');
  } catch {
    chatHistory = [];
  } // { role: 'user'|'assistant', content: string }
  let chatContext = null;
  let _chatSessionStarted = false;
  let _chatSending = false;
  let _proactiveChatTriggered = false;

  function saveChatHistory() {
    try {
      chatHistory = chatHistory.slice(-100);
      localStorage.setItem(userKey(CHAT_HISTORY_KEY), JSON.stringify(chatHistory.slice(-MAX_CHAT_HISTORY)));
    } catch (e) {
      console.warn('saveChatHistory failed:', e);
    }
  }

  function chatTimeStr(date) {
    if (!date) date = new Date();
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function sendChatChip(text) {
    const input = document.getElementById('chatInput');
    if (input) {
      input.value = text;
    }
    sendChat();
  }
  function updateChatChips() {
    const chips = document.getElementById('chatChips');
    const input = document.getElementById('chatInput');
    if (chips && input) {
      chips.style.display = input.value.trim() ? 'none' : 'flex';
    }
  }
  function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const isOpening = !panel.classList.contains('open');
    if (isOpening) {
      panel.classList.remove('open');
      void panel.offsetWidth;
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
    }
    // Mobile FAB visibility: hide when chat is open, show when closed
    const fab = document.getElementById('mobileChatFab');
    if (fab) {
      if (isOpening) {
        fab.classList.add('hidden');
        fab.classList.remove('unread');
      } else {
        fab.classList.remove('hidden');
      }
    }
    if (isOpening && !_chatSessionStarted) {
      _chatSessionStarted = true;
      const messagesEl = document.getElementById('chatMessages');
      if (chatHistory.length > 0 && messagesEl) {
        messagesEl.innerHTML = chatHistory
          .map((m, i) => {
            const formatted = esc(m.content.replace(/```(?:actions|json)[\s\S]*?```/g, '').trim())
              .replace(/\n/g, '<br>')
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            const timeStr = m.ts ? chatTimeStr(new Date(m.ts)) : '';
            return `<div class="chat-msg ${m.role === 'user' ? 'user' : 'ai'} stagger" style="animation-delay:${i * 50}ms">${formatted}${timeStr ? '<span class="chat-ts">' + timeStr + '</span>' : ''}</div>`;
          })
          .join('');
        messagesEl.scrollTop = messagesEl.scrollHeight;
        updateChatChips();
      } else if (messagesEl && messagesEl.children.length === 0) {
        const greeting = getChatGreeting();
        const firstTime = _isFirstTimeUser();
        const hint = firstTime
          ? '&quot;I have a bunch of stuff to organize&quot;, &quot;Plan my day&quot;, &quot;What can you do?&quot;'
          : "&quot;Plan my day&quot;, &quot;What's overdue?&quot;, &quot;Help me with [task]&quot;";
        messagesEl.innerHTML =
          '<div class="chat-msg ai stagger chat-welcome-msg">' +
          esc(greeting) +
          '<div class="chat-welcome-hint">' +
          hint +
          '</div><span class="chat-ts">' +
          chatTimeStr() +
          '</span></div>';
      }
    }
  }

  function _isFirstTimeUser() {
    return getData().tasks.length === 0 && chatHistory.length === 0;
  }

  function getChatGreeting() {
    if (_isFirstTimeUser()) {
      return 'Hey! I\u2019m your AI assistant. Paste meeting notes, brain dumps, or rough ideas in the box above and I\u2019ll extract tasks and organize everything. Or just tell me what\u2019s on your mind \u2014 I\u2019m here to think with you, not just take orders.';
    }
    const data = getData();
    const today = todayStr();
    const active = data.tasks.filter((t) => t.status !== 'done');
    const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
    const done = data.tasks.filter((t) => t.status === 'done');
    const weekAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString().slice(0, 10);
    const doneThisWeek = done.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= weekAgo).length;
    const stale = active.filter((t) => {
      const lt = t.updates && t.updates.length ? t.updates[t.updates.length - 1].date : t.createdAt;
      return lt && Date.now() - new Date(lt).getTime() > STALE_TASK_DAYS * MS_PER_DAY;
    });
    const now = new Date();
    const isMonday = now.getDay() === 1;
    const isMorning = now.getHours() < 12;
    const unassigned = active.filter((t) => !t.project);
    if (isMonday && isMorning)
      return (
        'Fresh week! You have ' +
        active.length +
        ' active task' +
        (active.length !== 1 ? 's' : '') +
        (overdue.length > 0 ? ' (' + overdue.length + ' overdue)' : '') +
        ". Want me to plan it based on what's overdue?"
      );
    if (overdue.length > 0)
      return (
        'You have ' + overdue.length + ' overdue task' + (overdue.length > 1 ? 's' : '') + '. Want to triage them?'
      );
    if (doneThisWeek >= 5) return "You've been productive — " + doneThisWeek + " tasks done this week. What's next?";
    if (unassigned.length >= 3)
      return (
        'You have ' +
        unassigned.length +
        ' unassigned task' +
        (unassigned.length > 1 ? 's' : '') +
        ' with no board. Want to sort them into projects?'
      );
    if (stale.length > 0) {
      const s = stale[0];
      const lt = s.updates && s.updates.length ? s.updates[s.updates.length - 1].date : s.createdAt;
      const days = Math.floor((Date.now() - new Date(lt).getTime()) / MS_PER_DAY);
      const title = s.title.length > 40 ? s.title.slice(0, 37) + '...' : s.title;
      return '"' + title + '" has been sitting for ' + days + " days. Want to think through what's blocking it?";
    }
    return "What's on your mind?";
  }

  function openProjectChat(projectId) {
    chatContext = projectId;
    const data = getData();
    const p = data.projects.find((x) => x.id === projectId);
    document.getElementById('chatTitle').textContent = p ? `Chat: ${p.name}` : 'AI Assistant';
    const panel = document.getElementById('chatPanel');
    if (!panel.classList.contains('open')) panel.classList.add('open');
    document.getElementById('chatInput').focus();
  }

  async function _sseFallback(r, te, cm, ct2) {
    const c = r.headers.get('content-type') || '';
    if (c.includes('text/event-stream')) return false;
    const j = await r.json();
    const f = j.content && j.content[0] ? j.content[0].text : j.completion || JSON.stringify(j);
    chatHistory.push({ role: 'assistant', content: f, ts: Date.now() });
    saveChatHistory();
    incrementAIInteraction();
    const a = await executeAIActions(f);
    if (a.applied) render();
    const clean = f.replace(/```(?:actions|json)[\s\S]*?```/g, '').trim();
    te.innerHTML =
      '<div class="chat-bubble ai">' +
      esc(clean)
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') +
      '<span class="chat-ts">' +
      chatTimeStr() +
      '</span></div>';
    cm.scrollTop = cm.scrollHeight;
    clearTimeout(ct2);
    _chatSending = false;
    const _sendBtn = document.querySelector('.chat-send');
    if (_sendBtn) _sendBtn.disabled = false;
    return true;
  }

  async function sendChat() {
    if (_chatSending) return;
    _chatSending = true;
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) {
      _chatSending = false;
      return;
    }
    if (!hasAI()) {
      const chatMsgs = document.getElementById('chatMessages');
      chatMsgs.innerHTML += `<div class="chat-msg user">${esc(msg)}<span class="chat-ts">${chatTimeStr()}</span></div>`;
      input.value = '';
      chatMsgs.innerHTML += `<div class="chat-msg ai">I need a Claude API key to chat. Set one up in <strong>Settings</strong> (30 seconds) and I'll be ready to help.<span class="chat-ts">${chatTimeStr()}</span></div>`;
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
      _chatSending = false;
      return;
    }
    const sendBtn = document.querySelector('.chat-send');
    if (sendBtn) sendBtn.disabled = true;

    const chatMsgs = document.getElementById('chatMessages');
    chatMsgs.innerHTML += `<div class="chat-msg user">${esc(msg)}<span class="chat-ts">${chatTimeStr()}</span></div>`;
    input.value = '';
    updateChatChips();

    const context = chatContext
      ? buildAIContext('project', chatContext, 'standard')
      : buildAIContext('all', null, 'standard');

    const settings = getSettings();
    const systemPrompt = `${AI_PERSONA}

${AI_ACTIONS_SPEC}

MODES — read the user's intent and respond in the right mode:

1. EXECUTION MODE: When they clearly want something done ("create a task", "move X to urgent", "delete Y")
   → DO IT with an actions block + brief confirmation. No extra commentary.
   Example: "add a task to call the dentist" → create the task immediately

2. THINKING MODE: When they're working through something ("I need to figure out...", "I'm not sure about...", "what should I do about...")
   → Think WITH them. Ask clarifying questions. Explore options. Don't jump to creating tasks yet.
   → Help them get clear on what they actually want before organizing it.
   → "What does 'done' look like for this?" / "Is this urgent or just on your mind?"
   Example: "I'm not sure how to prioritize this week" → help them reason through it

3. REFLECTION MODE: When they share how something went or seem to be processing ("that meeting was rough", "finally finished X")
   → Acknowledge genuinely. Ask what they learned or what's next. No toxic positivity.
   → Connect it to the bigger picture if relevant.
   Example: "finally finished the redesign" → reflect on what it took, what it unlocks

4. BATCH MODE: When they want to operate on multiple tasks ("push back everything", "reschedule all low-priority", "move everything in X to Y", "clear my afternoon")
   → Use batch_update, batch_reschedule, or multiple move_task/update_task actions. Confirm scope first if ambiguous.
   Examples:
   - "push back everything due this week by 3 days" → batch_reschedule with dueThisWeek filter, daysToAdd: 3
   - "move everything in Life to Work" → batch_update with project filter, fields: { project: "Work" }
   - "clear my afternoon — reschedule low-priority tasks to next week" → batch_reschedule with priority: "low", daysToAdd: 7

5. QUERY MODE: When they ask about their data ("what did I accomplish?", "what's overdue?", "how am I doing?")
   → Analyze their task data and give a clear, data-driven answer. Use "query" action as signal. Include counts, names, dates.
   Examples:
   - "what did I accomplish this week?" → list completed tasks from this week with count
   - "what's my busiest board?" → compare active task counts across boards

Default to THINKING MODE when the intent is ambiguous. It's better to help someone clarify than to create the wrong tasks.

RULES:
- TODAY IS ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${todayStr()}). Use this for ALL date calculations.
- Match tasks by partial title — "dentist" matches "Dentist appointment Friday".
- You have the FULL conversation history — don't repeat what the user already knows.
- When you learn something worth remembering (user preference, work pattern, project context), use save_memory.
- When the user shares project info (roadblocks, direction, context), update the project background proactively.
- When creating tasks, think about what else might be needed. "Book flights" → maybe also needs hotel, car, PTO?
- If a task sounds complex, break it into subtasks automatically.
- If you notice related existing tasks, mention them.
- When the user completes something meaningful, think about what it unlocks — what should they do next?
- If someone seems overwhelmed, don't add more. Help them triage what they already have.

PROACTIVE INSIGHTS — weave these naturally into your responses when relevant:
- If a task has been in-progress for 5+ days, mention it: "By the way, [task] has been sitting for X days — want to break it down or punt it?"
- If the user completes something, check what it unblocks: "Nice — that unblocks [dependent task]. Want to start on it?"
- If you notice 3+ tasks in the same project are overdue, flag it: "Heads up: [project] has X overdue tasks. Worth triaging?"
- If the user seems to be adding many tasks without completing any, gently note: "You've added X new tasks today but none completed. Want to focus on clearing a few first?"
- If you detect a pattern (user always works on certain projects on certain days), mention it naturally.
- When asked about task status, always include time context: "3 tasks due today, 5 this week, 2 overdue from last week"
- If a task title suggests urgency (legal, deadline, client, launch) but priority is "normal", suggest upgrading it.

These should feel like a smart coworker noticing things — not a nagging bot. Only surface 1-2 insights per response, max.

${context}`;

    chatHistory.push({ role: 'user', content: msg, ts: Date.now() });
    saveChatHistory();

    // Show typing indicator
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-msg ai';
    typingEl.innerHTML =
      '<div class="chat-bubble ai"><span class="chat-typing"><div class="chat-typing-dots"><span></span><span></span><span></span></div></span></div>';
    chatMsgs.appendChild(typingEl);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;

    const chatAbort = new AbortController();
    const chatTimeout = setTimeout(() => chatAbort.abort(), 60000);
    try {
      const _chatEp = getAIEndpoint();
      const resp = await fetch(_chatEp.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ..._chatEp.headers,
        },
        body: JSON.stringify({
          model: settings.aiModel || 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: systemPrompt,
          messages: chatHistory.slice(-MAX_CHAT_HISTORY).map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: chatAbort.signal,
      });

      if (!resp.ok) {
        let errMsg =
          resp.status === 429
            ? 'AI is busy — try again in a moment'
            : resp.status === 500 || resp.status === 503
              ? 'AI service is temporarily down'
              : 'Something went wrong with AI — try again';
        try {
          const e = await resp.json();
          if (e?.error?.message) errMsg = e.error.message;
        } catch (_e) {
          console.warn('chat error response parse failed:', _e.message || _e);
        }
        throw new Error(errMsg);
      }

      if (await _sseFallback(resp, typingEl, chatMsgs, chatTimeout)) return;
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      // Replace typing indicator with streaming bubble
      typingEl.innerHTML = '<div class="chat-bubble ai"></div>';
      const bubble = typingEl.querySelector('.chat-bubble');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === 'content_block_delta' && event.delta?.text) {
                fullText += event.delta.text;
                // Strip action blocks from display
                const display = fullText.replace(/```(?:actions|json)[\s\S]*?```/g, '').trim();
                bubble.innerHTML = esc(display).replace(/\n/g, '<br>');
                chatMsgs.scrollTop = chatMsgs.scrollHeight;
              }
            } catch (_parseErr) {
              /* SSE parse error — non-fatal, skip chunk */
            }
          }
        }
      }

      // Process complete response
      const reply = fullText;
      chatHistory.push({ role: 'assistant', content: reply, ts: Date.now() });
      saveChatHistory();
      incrementAIInteraction();

      const { applied, insights } = await executeAIActions(reply);
      if (applied) render();

      const cleanReply = reply.replace(/```(?:actions|json)[\s\S]*?```/g, '').trim();
      const insightHtml = insights
        .map(
          (i) =>
            `<div style="font-size:11px;color:${i.severity === 'warning' ? 'var(--orange)' : 'var(--accent)'};margin-top:6px;padding:6px 8px;background:var(--surface2);border-radius:var(--radius-xs)">\u{1F4A1} ${esc(i.text)}</div>`,
        )
        .join('');

      // Update the streaming bubble with final formatted content
      if (cleanReply) {
        const formatted = esc(cleanReply)
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        typingEl.innerHTML = `${formatted}${applied ? `<div style="font-size:10px;color:var(--text3);margin-top:4px">\u2726 ${applied} action${applied > 1 ? 's' : ''} applied</div>` : ''}${insightHtml}<span class="chat-ts">${chatTimeStr()}</span>`;
      } else if (applied) {
        typingEl.innerHTML = `Done. <span style="font-size:10px;color:var(--text3)">\u2726 ${applied} action${applied > 1 ? 's' : ''} applied</span>${insightHtml}<span class="chat-ts">${chatTimeStr()}</span>`;
      }
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
    } catch (err) {
      const errMsg =
        err.name === 'AbortError'
          ? 'Request timed out — try a shorter input'
          : err instanceof TypeError && !err.status
            ? 'No internet connection — AI features unavailable'
            : err.message;
      typingEl.innerHTML = `<span style="color:var(--red)">Error: ${esc(errMsg)}</span>`;
    } finally {
      clearTimeout(chatTimeout);
      _chatSending = false;
      const _sendBtn = document.querySelector('.chat-send');
      if (_sendBtn) _sendBtn.disabled = false;
      const _chatInp = document.getElementById('chatInput');
      if (_chatInp) _chatInp.focus();
    }
  }

  async function offerStuckHelp(taskId) {
    const t = findTask(taskId);
    if (!t || !hasAI()) return;
    const data = getData();
    const proj = data.projects.find((p) => p.id === t.project);

    // Open chat with this context (append rather than replace history)
    chatContext = t.project || null;
    chatHistory.push({ role: 'user', content: `I'm stuck on "${t.title}". Help me think through it.`, ts: Date.now() });
    saveChatHistory();

    const prompt = `${AI_PERSONA}

The user has a task that's been in-progress but hasn't moved: "${t.title}"
${t.notes ? 'Notes: ' + t.notes : ''}
${t.subtasks?.length ? 'Subtasks: ' + t.subtasks.map((s) => (s.done ? '\u2713' : '\u25CB') + ' ' + s.title).join(', ') : ''}
${proj ? 'Project: ' + proj.name : ''}

Don't jump to solutions. Help them THINK through it:
1. Ask what specifically is blocking progress — is it unclear, overwhelming, waiting on something, or just not a real priority?
2. If it seems too big, offer to break it down together.
3. If it might not matter anymore, give them permission to drop it.

Be curious, not prescriptive. 2-3 sentences. Ask a real question.`;

    try {
      const reply = await callAI(prompt, { maxTokens: 200 });
      chatHistory.push({ role: 'assistant', content: reply, ts: Date.now() });
      saveChatHistory();
      const formatted = esc(reply)
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      document.getElementById('chatTitle').textContent = proj ? `Chat: ${proj.name}` : 'AI Assistant';
      document.getElementById('chatMessages').innerHTML =
        `<div class="chat-msg ai">${formatted}<span class="chat-ts">${chatTimeStr()}</span></div>`;
      document.getElementById('chatPanel').classList.add('open');
    } catch (err) {
      console.error('Stuck help error:', err);
    }
  }

  // State accessors for external code
  function getChatHistory() {
    return chatHistory;
  }
  function getChatContext() {
    return chatContext;
  }
  function setChatContext(v) {
    chatContext = v;
  }
  function getChatSessionStarted() {
    return _chatSessionStarted;
  }
  function setChatSessionStarted(v) {
    _chatSessionStarted = v;
  }
  function setChatHistory(v) {
    chatHistory = v;
  }

  function maybeProactiveChat() {
    if (_proactiveChatTriggered) return;
    if (!hasAI()) return;
    const stuckTasks = typeof getStuckTasks === 'function' ? getStuckTasks() : [];
    if (!stuckTasks.length) return;

    const panel = document.getElementById('chatPanel');
    if (panel && panel.classList.contains('open')) return; // already open

    _proactiveChatTriggered = true;

    const stuckTask = stuckTasks[0];
    const msg = `I noticed "${stuckTask.title}" has been in-progress for a while. Need help thinking through it? I can break it down, suggest next steps, or help you decide if it still matters.`;

    // Auto-open chat with contextual message
    chatContext = stuckTask.project || null;
    const messagesEl = document.getElementById('chatMessages');
    if (messagesEl) {
      const greeting =
        '<div class="chat-msg ai stagger chat-welcome-msg">' +
        esc(msg) +
        '<span class="chat-ts">' +
        chatTimeStr() +
        '</span></div>';
      messagesEl.innerHTML = greeting;
    }
    if (panel) {
      panel.classList.add('open');
    }
    _chatSessionStarted = true;
    chatHistory.push({ role: 'assistant', content: msg, ts: Date.now() });
    saveChatHistory();
  }

  // Reset state (used on sign-out)
  function resetChatState() {
    // Back up current chat history before clearing so it can be restored
    if (chatHistory.length > 0) {
      try {
        localStorage.setItem(
          userKey(CHAT_HISTORY_KEY) + '_backup',
          JSON.stringify(chatHistory.slice(-MAX_CHAT_HISTORY)),
        );
      } catch (e) {
        console.warn('chat backup failed:', e);
      }
    }
    chatHistory = [];
    _chatSessionStarted = false;
    _proactiveChatTriggered = false;
    chatContext = null;
  }

  // Reload chat history from localStorage (used on sign-in / showApp)
  function reloadChatHistory() {
    try {
      chatHistory = JSON.parse(localStorage.getItem(userKey(CHAT_HISTORY_KEY)) || '[]');
      // If main history is empty, try restoring from backup
      if (chatHistory.length === 0) {
        const backupKey = userKey(CHAT_HISTORY_KEY) + '_backup';
        const backup = localStorage.getItem(backupKey);
        if (backup) {
          chatHistory = JSON.parse(backup);
          saveChatHistory(); // persist restored history to main key
          localStorage.removeItem(backupKey); // clean up backup
        }
      }
    } catch {
      chatHistory = [];
    }
  }

  return {
    toggleChat,
    sendChat,
    sendChatChip,
    updateChatChips,
    openProjectChat,
    chatTimeStr,
    saveChatHistory,
    getChatHistory,
    getChatContext,
    setChatContext,
    getChatSessionStarted,
    setChatSessionStarted,
    setChatHistory,
    offerStuckHelp,
    resetChatState,
    reloadChatHistory,
    maybeProactiveChat,
  };
}
