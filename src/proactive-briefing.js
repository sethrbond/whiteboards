// ============================================================
// PROACTIVE BRIEFING SUB-MODULE
// ============================================================
// Handles: daily briefing generation, end-of-day reflection,
// AI status items

import { TRUNCATE_DESC } from './constants.js';
import { AI_PERSONA, AI_PERSONA_SHORT } from './ai-context.js';

/**
 * Factory function for briefing-related proactive features.
 * @param {Object} deps - Dependencies
 * @returns {{ generateAIBriefing, submitEndOfDay, getAIStatusItems }}
 */
export function createProactiveBriefing(deps) {
  const {
    sanitizeAIHTML,
    todayStr,
    getData,
    userKey,
    hasAI,
    callAI,
    buildAIContext,
    addAIMemory,
    showToast,
    notifyOverdueTasks,
    extractMemoryInsights,
    _buildInsightsPromptSection,
  } = deps;

  async function generateAIBriefing() {
    if (!hasAI()) return;
    const btn = document.getElementById('briefingBtn');
    const body = document.getElementById('briefingBody');
    if (btn)
      btn.innerHTML =
        '<span class="spinner" style="width:14px;height:14px;margin-right:6px;vertical-align:middle"></span>Generating...';

    const ctx = buildAIContext('all');
    const briefingMemInsights =
      typeof deps.getAIMemory === 'function' ? extractMemoryInsights(deps.getAIMemory()) : extractMemoryInsights([]);
    const briefingInsightsSection = _buildInsightsPromptSection(briefingMemInsights);

    const prompt = `${AI_PERSONA}

You're not just summarizing — you're my partner. Think strategically about my day.
${briefingInsightsSection}
${ctx}

STRUCTURE (use all 4 sections, 1-2 bullets each):

**Right Now** — What needs immediate action? Be blunt about overdue and urgent items.

**Strategy** — Don't just list tasks. Tell me WHAT to do first and WHY. "Start with X because it unblocks Y" or "Batch these 3 quick ones to build momentum before tackling Z." Consider energy: hard tasks in the morning, quick wins in the afternoon.

**Flags** — Be my second brain. Call out: tasks that have been sitting too long, priorities that seem wrong, projects that are drifting, workload that's unsustainable, things I might be avoiding.

**Push** — One specific thing I should do today that I probably won't unless you tell me. Could be: break down a vague task, set a deadline on something that's been floating, reach out to someone, or just knock out that one annoying 5-minute task.

Be direct. Use task names. Under 200 words. No fluff. You're not a reporter — you're their assistant.`;

    try {
      let text = await callAI(prompt, { maxTokens: 1024, temperature: 0.3 });
      text = text.replace(/^[-•*]\s*/gm, '');
      const briefingKey = userKey('whiteboard_briefing_' + todayStr());
      localStorage.setItem(briefingKey, text);
      if (body) body.innerHTML = sanitizeAIHTML(text);
      if (btn) btn.textContent = 'Refresh with AI';
      notifyOverdueTasks();
    } catch (err) {
      if (btn) btn.textContent = 'Error — try again';
      showToast('Briefing failed — try again', true);
      console.error('Briefing error:', err);
    }
  }

  async function submitEndOfDay() {
    const input = document.getElementById('eodInput');
    const btn = document.getElementById('eodBtn');
    if (!input || !input.value.trim()) {
      showToast('Write a few words about your day first');
      return;
    }
    const userInput = input.value.trim();
    if (btn) btn.innerHTML = '<div class="spinner"></div> Reflecting...';
    const today = todayStr();
    const data = getData();
    const eodCompleted = data.tasks.filter(
      (t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === today,
    );
    const eodOpen = data.tasks.filter((t) => t.status !== 'done');
    const eodOverdue = eodOpen.filter((t) => t.dueDate && t.dueDate < today);
    const eodPrompt =
      AI_PERSONA_SHORT +
      '\n\nThe user is wrapping up their day. Here\'s what they said about today:\n"' +
      userInput +
      '"\n\nContext:\n- Completed today: ' +
      eodCompleted.map((t) => t.title).join(', ') +
      '\n- Still open: ' +
      eodOpen.length +
      ' tasks\n- Overdue: ' +
      eodOverdue.length +
      ' tasks\n\nRespond in 2-3 sentences. Acknowledge what was done. If they mentioned blockers or feelings, respond warmly. Suggest ONE thing for tomorrow morning. Be genuine, not performative.';
    try {
      const reply = await callAI(eodPrompt, { maxTokens: 512, temperature: 0.3 });
      localStorage.setItem(userKey('wb_eod_' + today), reply);
      addAIMemory(userInput + ' — AI: ' + reply.replace(/\n/g, ' ').slice(0, TRUNCATE_DESC), 'reflection');
      const card = document.getElementById('eodCard');
      if (card) {
        card.innerHTML =
          '<div class="eod-header"><span style="font-size:14px;color:var(--purple)">&#9790;</span><div class="eod-title">End of Day</div><span style="font-size:11px;color:var(--text3);margin-left:auto">Today</span></div><div class="eod-response">' +
          sanitizeAIHTML(reply) +
          '</div>';
      }
      // Auto-generate tomorrow's plan after EOD
      if (typeof deps.planMyDay === 'function') {
        setTimeout(() => {
          showToast('Planning tomorrow...', false, true);
          deps.planMyDay();
        }, 2000);
      }
    } catch (err) {
      console.error('EOD error:', err);
      if (btn) btn.textContent = 'Error — try again';
      showToast('End of day reflection failed — try again', true);
    }
  }

  function getAIStatusItems() {
    const items = [];
    const flagKey = userKey('whiteboard_proactive_' + todayStr());
    const _proactiveRan = localStorage.getItem(flagKey);

    // Check proactive log for today
    const logKey = userKey('wb_proactive_log_' + new Date().toISOString().slice(0, 10));
    let _todayLog = [];
    try {
      _todayLog = JSON.parse(localStorage.getItem(logKey) || '[]');
    } catch (_e) {
      console.warn('proactive log parse failed:', _e.message || _e);
    }

    // Check how many tasks were AI-drafted today
    const data = getData();
    const draftedTasks = data.tasks.filter(
      (t) => t.notes && t.notes.startsWith('**AI Draft:**') && t.createdAt && t.createdAt.slice(0, 10) === todayStr(),
    );
    if (draftedTasks.length > 0) {
      items.push({
        icon: '\u2726',
        text: `Prepared ${draftedTasks.length} task${draftedTasks.length > 1 ? 's' : ''} with drafts`,
      });
    }

    // Check completions since last visit (tasks done by others or by automation)
    const completedToday = data.tasks.filter(
      (t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === todayStr(),
    );
    if (completedToday.length > 0) {
      items.push({
        icon: '\u2713',
        text: `${completedToday.length} task${completedToday.length > 1 ? 's' : ''} completed today`,
      });
    }

    // Check if briefing was generated
    const briefingKey = userKey('whiteboard_briefing_' + todayStr());
    if (localStorage.getItem(briefingKey)) {
      items.push({ icon: '\u25CE', text: 'Daily briefing ready', action: 'briefing-expand' });
    }

    // Check if plan exists
    const planKey = userKey('whiteboard_plan_' + todayStr());
    if (localStorage.getItem(planKey)) {
      items.push({ icon: '\u25B6', text: 'Day plan prepared', action: 'scroll-to-plan' });
    }

    return items;
  }

  return {
    generateAIBriefing,
    submitEndOfDay,
    getAIStatusItems,
  };
}
