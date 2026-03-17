// ============================================================
// BRAINSTORM MODULE
// ============================================================
// Extracted from app.js — handles brainstorm/dump input, file attachments,
// AI-powered task extraction, review modal, and manual parsing.

import {
  DUMP_DRAFT_KEY,
  LIFE_PROJECT_NAME,
  MS_PER_DAY,
  MAX_DUMP_INPUT_CHARS,
  MAX_BRAINSTORM_INPUT_CHARS,
} from './constants.js';
import { esc } from './utils.js';
import { todayStr } from './dates.js';
import { parseDumpResponse, enforceShortDesc } from './parsers.js';
import { chunkText } from './utils.js';

/**
 * Factory function to create brainstorm functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ renderDump, initDumpDropZone, processDump, processDumpManual, cancelDump, applyDumpResults, submitClarify, skipClarify, handleDumpFiles, saveDumpDraft, loadDumpDraft, clearDumpDraft, isDumpInProgress, getLastDumpResult, setLastDumpResult, removeDumpAttachment, shouldShowDumpInvite, getDumpHistory, resetState }}
 */
export function createBrainstorm(deps) {
  const {
    userKey,
    render,
    showToast,
    hasAI,
    callAI,
    getAIEndpoint,
    getData,
    getSettings,
    findTask,
    findSimilarTask,
    findSimilarProject,
    createTask,
    addTask,
    updateTask,
    createProject,
    addProject,
    updateProject,
    getLifeProjectId,
    pushUndo,
    undo,
    closeModal,
    genId,
    normalizeTitle,
    $,
  } = deps;

  // ── Module-local state ──────────────────────────────────────────────────
  let _dumpAttachments = [];
  let _processingFiles = [];
  let dumpAbort = null;
  let _dumpInProgress = false;
  let lastDumpResult = null;

  const DUMP_HISTORY_KEY = 'wb_dump_history';
  const DUMP_LAST_TS_KEY = 'wb_last_dump';

  // ── Draft persistence ───────────────────────────────────────────────────
  function saveDumpDraft() {
    const ta = document.getElementById('dumpText');
    if (ta) {
      let val = ta.value;
      if (val.length > MAX_DUMP_INPUT_CHARS) {
        console.warn('Dump draft truncated from', val.length, 'to', MAX_DUMP_INPUT_CHARS, 'chars');
        val = val.slice(0, MAX_DUMP_INPUT_CHARS);
      }
      localStorage.setItem(userKey(DUMP_DRAFT_KEY), val);
    }
  }

  function loadDumpDraft() {
    return localStorage.getItem(userKey(DUMP_DRAFT_KEY)) || '';
  }

  function clearDumpDraft() {
    localStorage.removeItem(userKey(DUMP_DRAFT_KEY));
  }

  // ── Dump history ────────────────────────────────────────────────────────
  function getDumpHistory() {
    try {
      return JSON.parse(localStorage.getItem(userKey(DUMP_HISTORY_KEY)) || '[]');
    } catch {
      return [];
    }
  }

  function saveDumpHistory(e) {
    const h = getDumpHistory();
    h.unshift(e);
    if (h.length > 5) h.length = 5;
    localStorage.setItem(userKey(DUMP_HISTORY_KEY), JSON.stringify(h));
    localStorage.setItem(userKey(DUMP_LAST_TS_KEY), new Date().toISOString());
  }

  function shouldShowDumpInvite() {
    const l = localStorage.getItem(userKey(DUMP_LAST_TS_KEY));
    if (!l) return true;
    return Date.now() - new Date(l).getTime() > MS_PER_DAY;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function renderDump() {
    // Show results card if brainstorm just completed
    if (lastDumpResult) {
      const r = lastDumpResult;
      const statusParts = [];
      if (r.tasksTodo) statusParts.push(`${r.tasksTodo} to do`);
      if (r.tasksInProgress) statusParts.push(`${r.tasksInProgress} in progress`);
      if (r.tasksDone) statusParts.push(`${r.tasksDone} already done`);
      const boardText = [];
      if (r.boardsCreated) boardText.push(`${r.boardsCreated} new`);
      if (r.boardsUpdated) boardText.push(`${r.boardsUpdated} updated`);
      return `<div class="dump-area" style="animation:fadeIn .3s ease">
        <div style="background:linear-gradient(135deg,var(--surface2),var(--surface3));border:1px solid var(--border2);border-radius:var(--radius);padding:32px;text-align:center;margin-bottom:20px">
          <div style="font-size:14px;color:var(--text3);margin-bottom:20px">You wrote <strong style="color:var(--text)">${r.wordCount} words</strong></div>
          <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-bottom:24px">
            <div class="dump-result-stat"><div style="font-size:32px;font-weight:700;color:var(--accent)">${r.tasksCreated}</div><div style="font-size:12px;color:var(--text3)">tasks extracted</div></div>
            ${boardText.length ? `<div class="dump-result-stat"><div style="font-size:32px;font-weight:700;color:var(--purple)">${r.boardsCreated + r.boardsUpdated}</div><div style="font-size:12px;color:var(--text3)">boards (${boardText.join(', ')})</div></div>` : ''}
          </div>
          ${statusParts.length ? `<div style="font-size:12px;color:var(--text3);margin-bottom:20px">${statusParts.join(' \u00b7 ')}</div>` : ''}
          ${
            r.tasksByBoard && Object.keys(r.tasksByBoard).length
              ? `<div style="margin-bottom:16px"><button class="btn btn-sm" data-action="toggle-what-changed" style="font-size:11px;color:var(--text3)">Hide details</button><div class="dump-what-changed open"><div style="text-align:left;padding:12px 0;border-top:1px solid var(--border);margin-top:8px">${Object.entries(
                  r.tasksByBoard,
                )
                  .map(
                    ([b, c]) =>
                      '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span style="color:var(--text2)">' +
                      esc(b) +
                      '</span><span style="color:var(--accent)">' +
                      c +
                      '</span></div>',
                  )
                  .join('')}</div></div></div>`
              : ``
          }
          <div style="display:flex;gap:8px;justify-content:center">
            <button class="btn btn-primary" data-action="view-organized">View organized tasks →</button>
            <button class="btn" data-action="new-brainstorm">New brainstorm</button>
          </div>
        </div>
      </div>`;
    }

    const hasKey = hasAI();
    const draft = esc(loadDumpDraft());
    const placeholder = 'Meeting notes, ideas, docs, plans \u2014 throw it all in. AI organizes everything...';
    const attachCount = _dumpAttachments.length;
    const processingHtml = _processingFiles
      .map(
        (name) =>
          `<div class="dump-attach-chip skeleton-pulse" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--surface3);border:1px solid var(--border2);border-radius:8px;font-size:12px;max-width:260px;opacity:0.7">
        <span style="font-size:16px">${_fileIcon(name)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
          <div style="font-size:10px;color:var(--accent)">Processing…</div>
        </div>
      </div>`,
      )
      .join('');
    const attachHtml =
      attachCount || _processingFiles.length
        ? `<div id="dumpAttachList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${_dumpAttachments
            .map(
              (a, i) =>
                `<div class="dump-attach-chip" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--surface3);border:1px solid var(--border2);border-radius:8px;font-size:12px;max-width:260px">
        <span style="font-size:16px">${a.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
          <div style="font-size:10px;color:var(--text3)">${a.size} · ${a.pages ? a.pages + ' pages' : Math.round(a.textLength / 1000) + 'K chars'}</div>
        </div>
        <button data-action="remove-dump-attachment" data-idx="${i}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0 2px" title="Remove">×</button>
      </div>`,
            )
            .join('')}${processingHtml}</div>`
        : '';
    return `<div class="dump-area">
      ${!hasKey ? '<p style="font-size:13px;color:var(--orange);margin-bottom:12px">To unlock AI analysis, <a data-action="open-settings" style="color:var(--accent);cursor:pointer;text-decoration:underline">add your Claude API key in Settings</a> (30 seconds).</p>' : ''}
      ${attachHtml}
      <div style="position:relative">
        <textarea class="dump-textarea" id="dumpText" aria-label="Brainstorm input" placeholder="${placeholder}">${draft}</textarea>
        <div id="dumpDropOverlay" style="display:none;position:absolute;inset:0;background:rgba(var(--accent-rgb,99,102,241),.12);border:2px dashed var(--accent);border-radius:var(--radius);pointer-events:none;z-index:2;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--accent)">Drop file to attach</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <div style="font-size:11px;color:var(--text3);flex:1">${attachCount ? attachCount + ' file' + (attachCount > 1 ? 's' : '') + ' attached. Add notes above for context.' : 'Drop files here or attach below. Supports PDF, Word, Excel, text, and more.'}</div>
        <label style="cursor:pointer;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text3);padding:4px 8px;border:1px solid var(--border);border-radius:6px;white-space:nowrap" title="Attach a file">
          <span style="font-size:14px">\u{1F4CE}</span> Attach file
          <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.log,.xml,.html,.rtf,.pages,.numbers" multiple style="display:none" data-onchange-action="dump-files">
        </label>
      </div>
      <div class="dump-bar">
        <button class="btn btn-primary" data-action="process-dump">${hasKey ? '\u2726 Analyze & Organize' : '+ Add Tasks'}</button>
        <div id="dumpStatus" aria-live="polite"></div>
      </div>
    </div>`;
  }

  // ── Attachment system ───────────────────────────────────────────────────
  const _libCache = {};
  const _libSRI = {
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js':
      'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e',
    'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js':
      'sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js':
      'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
  };

  function loadScript(url) {
    if (_libCache[url]) return _libCache[url];
    _libCache[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      if (_libSRI[url]) {
        s.integrity = _libSRI[url];
        s.crossOrigin = 'anonymous';
      }
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + url.split('/').pop()));
      document.head.appendChild(s);
    });
    return _libCache[url];
  }

  async function ensurePDFLib() {
    if (typeof pdfjsLib !== 'undefined') return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  }

  async function ensureMammothLib() {
    if (typeof mammoth !== 'undefined') return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
  }

  async function ensureXLSXLib() {
    if (typeof XLSX !== 'undefined') return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }

  const _fileIcons = {
    pdf: '\u{1F4C4}',
    doc: '\u{1F4DD}',
    docx: '\u{1F4DD}',
    xls: '\u{1F4CA}',
    xlsx: '\u{1F4CA}',
    csv: '\u{1F4CA}',
    txt: '\u{1F4C3}',
    md: '\u{1F4C3}',
    json: '\u{1F4C3}',
    html: '\u{1F310}',
    xml: '\u{1F310}',
    rtf: '\u{1F4C3}',
    pages: '\u{1F4DD}',
    numbers: '\u{1F4CA}',
    log: '\u{1F4C3}',
  };
  function _fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    return _fileIcons[ext] || '\u{1F4CE}';
  }
  function _fileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function _readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function extractFileText(file) {
    const name = file.name.toLowerCase();
    const ext = name.split('.').pop();

    // Images — not supported for text extraction
    if (
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'heic'].includes(ext) ||
      file.type.startsWith('image/')
    ) {
      throw new Error('Images can\u2019t be processed for text. Try a PDF, Word doc, or text file instead.');
    }

    const buf = await readFileAsArrayBuffer(file);

    // PDF
    if (ext === 'pdf' || file.type === 'application/pdf') {
      await ensurePDFLib();
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(' '));
      }
      return { text: pages.join('\n\n'), pages: pdf.numPages };
    }

    // Legacy .doc (not .docx)
    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
      throw new Error('Legacy .doc files are not supported. Please save as .docx and try again.');
    }

    // Word (.docx)
    if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      await ensureMammothLib();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      return { text: result.value };
    }

    // Excel (.xlsx, .xls) and CSV
    if (['xlsx', 'xls', 'csv', 'numbers'].includes(ext) || file.type.includes('spreadsheet')) {
      await ensureXLSXLib();
      const workbook = XLSX.read(buf, { type: 'array' });
      const sheets = [];
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const text = XLSX.utils.sheet_to_csv(sheet);
        if (text.trim()) sheets.push('--- Sheet: ' + sheetName + ' ---\n' + text);
      });
      return { text: sheets.join('\n\n'), pages: workbook.SheetNames.length };
    }

    // Plain text fallback
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const binaryChars = (text.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
    if (binaryChars > text.length * 0.1)
      throw new Error('Binary file \u2014 cannot extract text. Try exporting as PDF first.');
    return { text };
  }

  async function handleDumpFiles(fileList) {
    if (!fileList || !fileList.length) return;
    for (const file of fileList) {
      if (file.size > 10 * 1024 * 1024) {
        showToast(file.name + ' is too large (max 10MB)', true);
        continue;
      }
      try {
        _processingFiles.push(file.name);
        _updateAttachListUI();
        showToast('Processing ' + file.name + '...');
        const result = await extractFileText(file);
        _processingFiles = _processingFiles.filter((n) => n !== file.name);
        if (!result.text.trim()) {
          _updateAttachListUI();
          showToast('No text found in ' + file.name + '. It may be image-based.', true);
          continue;
        }
        _dumpAttachments.push({
          name: file.name,
          icon: _fileIcon(file.name),
          size: _fileSize(file.size),
          textLength: result.text.length,
          pages: result.pages || null,
          extractedText: result.text,
        });
        showToast('Attached ' + file.name);
      } catch (e) {
        _processingFiles = _processingFiles.filter((n) => n !== file.name);
        console.error('File processing error:', e);
        showToast('Could not process ' + file.name + '. ' + (e.message || 'Try a different format.'), true);
      }
    }
    render();
  }

  function _updateAttachListUI() {
    const list = document.getElementById('dumpAttachList');
    const container = list ? list.parentElement : document.querySelector('.dump-area');
    if (!container) return;
    // Build processing chips HTML
    const processingHtml = _processingFiles
      .map(
        (name) =>
          `<div class="dump-attach-chip skeleton-pulse" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--surface3);border:1px solid var(--border2);border-radius:8px;font-size:12px;max-width:260px;opacity:0.7">
        <span style="font-size:16px">${_fileIcon(name)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
          <div style="font-size:10px;color:var(--accent)">Processing…</div>
        </div>
      </div>`,
      )
      .join('');
    if (list) {
      // Remove existing processing chips and append new ones
      list.querySelectorAll('.skeleton-pulse').forEach((el) => el.remove());
      if (processingHtml) list.insertAdjacentHTML('beforeend', processingHtml);
    } else if (processingHtml) {
      const textarea = container.querySelector('.dump-textarea');
      if (textarea) {
        const wrapper = document.createElement('div');
        wrapper.id = 'dumpAttachList';
        wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px';
        wrapper.innerHTML = processingHtml;
        textarea.parentElement.parentElement.insertBefore(wrapper, textarea.parentElement);
      }
    }
  }

  function getDumpAttachmentText() {
    if (!_dumpAttachments.length) return '';
    return _dumpAttachments.map((a) => `\n\n=== ATTACHED FILE: ${a.name} ===\n${a.extractedText}`).join('');
  }

  function initDumpDropZone() {
    const ta = document.getElementById('dumpText');
    if (!ta) return;
    ta.addEventListener('input', () => saveDumpDraft());

    const overlay = document.getElementById('dumpDropOverlay');
    const area = ta.closest('.dump-area') || ta;

    area.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (overlay) overlay.style.display = 'flex';
    });
    area.addEventListener('dragleave', (e) => {
      if (!area.contains(e.relatedTarget)) {
        if (overlay) overlay.style.display = 'none';
      }
    });
    area.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (overlay) overlay.style.display = 'none';
      const files = e.dataTransfer?.files;
      if (files && files.length) handleDumpFiles(files);
    });
  }

  // ── Clarify pass ────────────────────────────────────────────────────────
  async function maybeClarify(text) {
    if (_dumpAttachments.length) return null;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount > 80) return null;

    try {
      const reply = await callAI(
        `You are a sharp, direct productivity partner helping someone brainstorm. They just typed this into a quick capture box:

"${text}"

Is this clear enough to extract specific, actionable tasks? Or is it vague/missing key details?

Rules:
- If the input already contains specific tasks, deadlines, names, or enough detail to act on \u2192 respond with exactly: CLEAR
- If it's vague, short, or missing important context (what specifically? when? who? which?) \u2192 respond with 2-4 SHORT clarifying questions that would help you extract better tasks. Be conversational and curious, not interrogative. Questions should feel like a smart assistant genuinely trying to help, not a form to fill out.

Format if asking questions \u2014 respond ONLY with the questions, one per line, no numbering, no preamble. Keep each under 15 words.`,
        { maxTokens: 200 },
      );

      const trimmed = reply.trim();
      if (trimmed === 'CLEAR' || trimmed.startsWith('CLEAR')) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  function showClarifyUI(questions, _originalText) {
    const statusEl = $('#dumpStatus');
    const lines = questions.split('\n').filter((l) => l.trim());
    let html = `<div class="clarify-card" style="background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius);padding:20px;margin-top:12px;animation:fadeIn .3s ease">
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px">\u2726 A few quick questions to get you better results:</div>
      <div style="display:flex;flex-direction:column;gap:8px">`;
    lines.forEach((q, i) => {
      html += `<div style="display:flex;gap:8px;align-items:start">
        <span style="color:var(--accent);font-size:13px;flex-shrink:0;margin-top:6px">\u2192</span>
        <div style="flex:1">
          <div style="font-size:12px;color:var(--text2);margin-bottom:4px">${esc(q.replace(/^[-\u2022*]\s*/, ''))}</div>
          <input type="text" class="clarify-input" data-idx="${i}" placeholder="Type your answer..." aria-label="Answer to clarifying question" style="width:100%;padding:6px 10px;background:var(--surface3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;outline:none" data-keydown-action="submit-clarify-input">
        </div>
      </div>`;
    });
    html += `</div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm" data-action="submit-clarify">\u2726 Continue with answers</button>
        <button class="btn btn-sm" data-action="skip-clarify" style="color:var(--text3)">Skip \u2014 just extract what you can</button>
      </div>
    </div>`;
    if (statusEl) statusEl.innerHTML = html;
    setTimeout(() => {
      const first = document.querySelector('.clarify-input');
      if (first) first.focus();
    }, 100);
  }

  function submitClarify() {
    const inputs = document.querySelectorAll('.clarify-input');
    const answers = [];
    inputs.forEach((inp) => {
      if (inp.value.trim()) answers.push(inp.value.trim());
    });
    const ta = $('#dumpText');
    if (ta && answers.length) {
      ta.value = ta.value.trim() + '\n\n--- Additional details ---\n' + answers.join('\n');
      saveDumpDraft();
    }
    const statusEl = $('#dumpStatus');
    if (statusEl) statusEl.innerHTML = '';
    processDump(true);
  }

  function skipClarify() {
    const statusEl = $('#dumpStatus');
    if (statusEl) statusEl.innerHTML = '';
    processDump(true);
  }

  async function _fetchDumpSingleChunk(dumpSystemPrompt, dumpUserPrompt, settings) {
    const _ep = getAIEndpoint();
    const resp = await fetch(_ep.url, {
      method: 'POST',
      signal: dumpAbort.signal,
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ..._ep.headers },
      body: JSON.stringify({
        model: settings.aiModel || 'claude-haiku-4-5-20251001',
        max_tokens: 16384,
        temperature: 0.3,
        system: dumpSystemPrompt,
        messages: [{ role: 'user', content: dumpUserPrompt }],
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || '';
      console.error('Brainstorm API error:', resp.status, errMsg);
      throw new Error(
        resp.status === 429
          ? 'AI is busy — try again in a moment'
          : resp.status === 500 || resp.status === 503
            ? 'AI service is temporarily down'
            : errMsg || 'Something went wrong with AI — try again',
      );
    }
    const result = await resp.json();
    return parseDumpResponse(result.content[0].text);
  }

  async function _fetchDumpMultipleChunks(chunks, dumpSystemPrompt, cappedTasks, projectCompact, statusEl, settings) {
    const allTasks = [],
      allProjectUpdates = [],
      allPatterns = [];
    const _ep = getAIEndpoint();
    for (let i = 0; i < chunks.length; i++) {
      if (dumpAbort.signal.aborted) throw new Error('Cancelled');
      if (statusEl)
        statusEl.innerHTML = `<div class="ai-status"><div class="spinner"></div>Processing chunk ${i + 1} of ${chunks.length}...<button class="btn btn-sm" style="margin-left:12px;font-size:10px;color:var(--red);border-color:var(--red)" data-action="cancel-dump">Cancel</button></div>`;
      const leanTasks = cappedTasks
        .slice(0, 50)
        .map((t) => `${t.id}|${t.title}|${t.status}`)
        .join('\n');
      const chunkUserPrompt = `EXISTING TASKS (id|title|status):\n${leanTasks || '(none)'}\n\nEXISTING PROJECTS (id|name):\n${projectCompact || '(none)'}\n\nTODAY: ${todayStr()}\n\nBrainstorm input [Chunk ${i + 1} of ${chunks.length}]:\n${chunks[i]}`;
      const resp = await fetch(_ep.url, {
        method: 'POST',
        signal: dumpAbort.signal,
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ..._ep.headers },
        body: JSON.stringify({
          model: settings.aiModel || 'claude-haiku-4-5-20251001',
          max_tokens: 16384,
          temperature: 0.3,
          system: dumpSystemPrompt,
          messages: [{ role: 'user', content: chunkUserPrompt }],
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const errMsg = errBody?.error?.message || '';
        console.error('Brainstorm chunk API error:', resp.status, errMsg);
        throw new Error(
          resp.status === 429
            ? 'AI is busy — try again in a moment'
            : resp.status === 500 || resp.status === 503
              ? 'AI service is temporarily down'
              : errMsg || 'Something went wrong with AI — try again',
        );
      }
      const result = await resp.json();
      const chunkParsed = parseDumpResponse(result.content[0].text);
      if (chunkParsed) {
        allTasks.push(...(chunkParsed.tasks || []));
        allProjectUpdates.push(...(chunkParsed.projectUpdates || []));
        allPatterns.push(...(chunkParsed.patterns || []));
      }
    }
    const seen = new Set();
    const dedupedTasks = allTasks.filter((t) => {
      const key = (t.title || '').toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { tasks: dedupedTasks, projectUpdates: allProjectUpdates, patterns: allPatterns };
  }

  // ── Main processing helpers ─────────────────────────────────────────────

  function _validateDumpInput() {
    const text =
      ($('#dumpText')?.value?.trim() || '') + (_dumpAttachments.length ? '\n' + getDumpAttachmentText() : '');
    if (!text.trim() && !_dumpAttachments.length) {
      showToast('Write something or attach a file first', true);
      return null;
    }

    const totalInput = text + getDumpAttachmentText();
    const MAX_INPUT_CHARS = MAX_BRAINSTORM_INPUT_CHARS;
    if (totalInput.length > MAX_INPUT_CHARS) {
      const overBy = totalInput.length - MAX_INPUT_CHARS;
      showToast(
        `Input too long by ~${Math.ceil(overBy / 1000)}K characters. Try splitting into smaller brainstorms.`,
        true,
      );
      return null;
    }
    return text;
  }

  function _initDumpProgress(statusEl) {
    const _dumpStart = Date.now();
    const _dumpPhases = [
      'Reading your input...',
      'Extracting tasks and context...',
      'Organizing by project and priority...',
      'Detecting patterns and duplicates...',
    ];
    let _dumpPhase = 0;
    if (window._dumpTimer) clearInterval(window._dumpTimer);
    window._dumpTimer = setInterval(() => {
      if (!statusEl) return;
      const elapsed = Math.round((Date.now() - _dumpStart) / 1000);
      _dumpPhase = Math.min(_dumpPhase + 1, _dumpPhases.length - 1);
      statusEl.innerHTML = `<div class="ai-status"><div class="spinner"></div>${_dumpPhases[_dumpPhase]} <span style="color:var(--text3);font-size:11px">(${elapsed}s)</span><button class="btn btn-sm" style="margin-left:12px;font-size:10px;color:var(--red);border-color:var(--red)" data-action="cancel-dump">Cancel</button></div>`;
    }, 4000);
    if (statusEl)
      statusEl.innerHTML = `<div class="ai-status"><div class="spinner"></div>${_dumpPhases[0]} <button class="btn btn-sm" style="margin-left:12px;font-size:10px;color:var(--red);border-color:var(--red)" data-action="cancel-dump">Cancel</button></div>`;
  }

  function _buildDumpSystemPrompt() {
    return `You are a sharp, direct productivity partner. You have been handed a brainstorm \u2014 it could be a stream of consciousness, a formal project document, meeting notes, a status update, or anything in between. Your job: extract EVERYTHING useful and organize it perfectly.

## YOUR EXTRACTION PHILOSOPHY
- Extract ALL discrete items \u2014 things to DO, things already DONE, things IN PROGRESS.
- COMPLETED WORK IS JUST AS IMPORTANT AS PENDING WORK. If the document says something was finished, submitted, approved, or done \u2014 create it as a task with status "done". The user needs a complete picture of their project, not just what's left.
- Do NOT create tasks for background info, context, history, mission statements, or descriptive text. That goes in the project background.
- A 1-page dump should produce 3-10 tasks. A 10-page document should produce 15-40 tasks.
- If something is informational/context rather than actionable, put it in the board's background field, NOT as a task.
- Background info, mission statements, team rosters, key decisions, context = board description updates.
- You are CATALOGUING the full state of this work \u2014 done, in-progress, and todo.

## HOW TO DETECT STATUS \u2014 THIS IS CRITICAL, GET IT RIGHT
DONE/COMPLETED \u2014 AGGRESSIVELY detect completed work. Look for: [x], [X], checkmarks, "completed", "done", "finished", "locked", "filed", "approved", "executed", "received", "submitted", "signed", "selected", "confirmed", "secured", "decided", "chose", "set up", "created", "built", "wrote", "sent", "paid", past tense verbs describing accomplished work, items under headers like "COMPLETED" or "WHAT'S LOCKED IN" or "DONE" or "PROGRESS SO FAR". When in doubt between done and todo, look at the verb tense \u2014 past tense = DONE.
TODO/PENDING \u2014 look for: [ ], empty checkbox, "pending", "needs to", "must", "should", "will", "plan to", "to-do", "next step", future tense, items under headers like "NEXT STEPS" or "TO DO" or "ACTION ITEMS" or "UPCOMING".
IN-PROGRESS \u2014 look for: "working on", "currently", "in progress", "started", "underway", "building", present tense active work.

IMPORTANT: A project document typically has BOTH completed and pending items. If you extract 20 tasks and zero are "done", you are almost certainly misreading the document. Go back and re-check for past-tense accomplishments.

## HOW TO SET PRIORITY
URGENT \u2014 deadline within 3 days, blocks other work, user explicitly says "urgent"/"ASAP"/"immediately".
IMPORTANT \u2014 deadline within 2 weeks AND significant impact. NOT for tasks months out, even if they matter.
NORMAL \u2014 deadline more than 2 weeks out, or standard tasks without time pressure.
LOW \u2014 nice-to-have, future consideration, exploratory, deadlines 2+ months out.

CRITICAL RULE: Priority MUST correlate with time proximity. Today is ${new Date().toISOString().slice(0, 10)}. Calculate the days until deadline BEFORE assigning priority:
- Due in 0-3 days → urgent
- Due in 4-14 days → important
- Due in 15+ days → normal
- Due in 60+ days → low
A task due March 31 when today is March 17 = 14 days = IMPORTANT, not urgent. Do the math EVERY time.

## HOW TO SET DEADLINES
Only set a dueDate if the input contains a SPECIFIC date or clear deadline ("by Friday", "due March 25", "opens late April").
Do NOT invent deadlines. If there's no date mentioned, leave dueDate empty.
If the input says "~September" or "late April", use the LAST day of that period (April 30, September 30).
Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

## HOW TO ESTIMATE TIME
For every task, estimate how many minutes it will take. Use your best judgment:
- Quick tasks (email, call, form): 15 minutes
- Standard tasks (write document, review, meeting): 30-60 minutes
- Deep work (coding, analysis, writing): 120 minutes
- Large tasks (project planning, major deliverable): 240 minutes
- If truly unknown, use 0 (not estimated). But try to estimate \u2014 even rough is better than nothing.

## HOW TO HANDLE DIFFERENT INPUT TYPES
- **Project planning document**: This is a FULL PROJECT IMPORT. Extract everything \u2014 done items, pending items, phases, deadlines. Use phases liberally. A project doc with 30+ items is normal. Set status accurately: things already accomplished = "done", things planned = "todo".
- **Checklist document with phases**: Each checkbox = one task. Preserve the phase/section header. Items under "Phase 3" get phase="Phase 3: [phase name]".
- **Stream of consciousness**: Parse every distinct thought. "oh and the dentist moved to friday" = task: "Dentist appointment" with dueDate for Friday. "groceries: milk, eggs" = task: "Buy groceries" with notes "milk, eggs".
- **Status update**: Things described as done = done tasks. Things described as next = todo tasks. Context about the project = projectUpdates.
- **Meeting notes**: Action items = tasks. Decisions = project description updates. Assignments = task notes.
- **Lists of organizations/people**: If they need to be reviewed/contacted/vetted, each one = a separate task.

## TASKS vs SUBTASKS
- A TASK is a standalone deliverable: "Build landing page", "File taxes", "Plan team offsite"
- SUBTASKS are steps within a task: "Design header", "Write copy", "Get approval" are subtasks of "Build landing page"
- When the input describes a multi-step process, create ONE task with subtasks, not many separate tasks
- When items are independent and could be done in any order, they are separate tasks
- Use the "subtasks" field: an array of strings, e.g. ["Design header", "Write copy", "Deploy"]

## PATTERN DETECTION
- If a new task is similar to an existing task from a different date, it may be RECURRING \u2014 flag it in the task notes: "[Pattern: appears recurring \u2014 see similar task: existing_title]"
- If an existing task had notes/details last time but the new input mentions the same item with LESS info, flag it: "[Pattern: previous version had more detail \u2014 may need review]"
- If you see the same topic mentioned across multiple brainstorms (appearing in existing tasks AND new input), note the connection
- Look for tasks that logically depend on each other and note dependencies in the notes field

## DEDUPLICATION \u2014 THIS IS CRITICAL
- Before creating ANY task, check the existing tasks list below. If a task with a similar meaning already exists (even with different wording), use "action": "update" with the existing task's ID instead of creating a new one.
- "Schedule meeting with client about Q2 roadmap" and "Meeting with client re: Q2 roadmap planning" = SAME TASK. Update, don't create.
- Prefer updating existing tasks over creating new ones. When in doubt, UPDATE.
- Use exact IDs from the existing tasks list when updating.

## PROJECT ASSIGNMENT \u2014 BE CONSERVATIVE
- Only create a new project via projectUpdates if the input clearly describes a substantial new workstream with multiple tasks.
- A single phone call, meeting, or task about a company does NOT warrant its own project. Put it in "${LIFE_PROJECT_NAME}" or an existing project.
- If items are random personal stuff (gym, errands, appointments, calls), assign to "${LIFE_PROJECT_NAME}".
- Match existing project names FUZZILY \u2014 "Career Tracker" matches "Seth Bond Program Tracker & Career Vision".
- When assigning tasks to existing projects, match based on the TOPIC and CONTEXT of the task, not just keywords. A task about academic recommendations should go in an academic/career board, not a travel board \u2014 even if the person is mentioned in both contexts. When in doubt, create an 'Unsorted' assignment and let the user move it.
- CRITICAL \u2014 "description" vs "background":
  - "description" = a SUBTITLE for the project card. MAXIMUM 12 WORDS. Example: "Nonprofit advancing immigration justice through trust-based philanthropy." NEVER include team names, financials, phases, dates, status updates, or any detail. If your description is longer than 12 words, it is WRONG. Rewrite it shorter.
  - "background" = ALL detailed info using ## section headers (Origin, Where It's Going, Roadblocks, Next Steps, Notes). Mission, team roster, phase, decisions, context, financials, timelines, compliance \u2014 EVERYTHING detailed goes HERE. This is a collapsible dropdown, so be thorough.

## OUTPUT FORMAT \u2014 Return ONLY this JSON object, nothing else:
{
  "projectUpdates": [
    { "name": "Project Name", "description": "One sentence, max 15 words \u2014 a subtitle, NOT details.", "background": "## Origin\\nWhere it came from\\n## Where It's Going\\nThe goal\\n## Roadblocks\\nBlockers\\n## Next Steps\\nWhat's next\\n## Notes\\nOther context", "isNew": true }
  ],
  "tasks": [
    {
      "action": "create",
      "title": "Clear, specific task title",
      "notes": "One sentence of context. Max 20 words. No paragraphs.",
      "status": "done",
      "priority": "normal",
      "suggestedProject": "Project Name",
      "dueDate": "",
      "phase": "Phase 1: Foundation",
      "subtasks": ["Step 1", "Step 2"],
      "recurrence": "",
      "estimatedMinutes": 30
    }
  ],
  "patterns": [
    { "type": "recurring|dependency|gap", "message": "Brief description of the pattern detected" }
  ]
}

For updates to existing tasks, use: { "action": "update", "id": "existing_task_id", "updateFields": { "status": "done" } }`;
  }

  function _buildDumpContext() {
    const data = getData();
    const existingTasks = data.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      project: t.project,
      priority: t.priority,
      status: t.status,
      notes: t.notes,
      createdAt: t.createdAt,
    }));
    const existingProjects = data.projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: (p.description || '').slice(0, 200),
    }));
    const sortedTasks = existingTasks.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const cappedTasks = sortedTasks.slice(0, 100);
    const existingCompact = cappedTasks
      .map((t) => `${t.id}|${t.title}|${t.status}|${(t.notes || '').slice(0, 40)}`)
      .join('\n');
    const taskNote =
      existingTasks.length > 100 ? `\n(showing 100 most recent of ${existingTasks.length} total tasks)` : '';
    const projectCompact = existingProjects.map((p) => `${p.id}|${p.name}`).join('\n');
    return { cappedTasks, existingCompact, taskNote, projectCompact };
  }

  // ── Main processing ─────────────────────────────────────────────────────
  async function processDump(skipClarifyPass) {
    if (_dumpInProgress) return;

    const text = _validateDumpInput();
    if (text === null) return;

    const settings = getSettings();

    if (!hasAI()) {
      showToast('Add a Claude API key in Settings for AI-powered brainstorm parsing', false);
      processDumpManual(text);
      return;
    }

    // Curiosity pass
    if (!skipClarifyPass) {
      dumpAbort = new AbortController();
      const statusEl = $('#dumpStatus');
      if (statusEl)
        statusEl.innerHTML = `<div class="ai-status"><div class="spinner"></div>Thinking... <button class="btn btn-sm" style="margin-left:12px;font-size:10px;color:var(--red);border-color:var(--red)" data-action="cancel-dump">Cancel</button></div>`;
      const questions = await maybeClarify(text);
      if (questions) {
        showClarifyUI(questions, text);
        return;
      }
      if (statusEl) statusEl.innerHTML = '';
    }

    _dumpInProgress = true;

    pushUndo('Brainstorm');
    dumpAbort = new AbortController();
    const statusEl = $('#dumpStatus');
    _initDumpProgress(statusEl);

    const { cappedTasks, existingCompact, taskNote, projectCompact } = _buildDumpContext();

    const dumpSystemPrompt = _buildDumpSystemPrompt();

    const dumpUserPrompt = `EXISTING TASKS (id|title|status|notes_preview):
${existingCompact || '(none)'}${taskNote}

EXISTING PROJECTS (id|name):
${projectCompact || '(none)'}

TODAY: ${todayStr()}

Brainstorm input:
${text}${getDumpAttachmentText()}`;

    const fullInput = text + getDumpAttachmentText();

    try {
      let parsed;
      const chunkSize = settings.apiKey ? 50000 : 40000;
      const chunks = chunkText(fullInput, chunkSize);

      if (chunks.length <= 1) {
        parsed = await _fetchDumpSingleChunk(dumpSystemPrompt, dumpUserPrompt, settings);
      } else {
        parsed = await _fetchDumpMultipleChunks(
          chunks,
          dumpSystemPrompt,
          cappedTasks,
          projectCompact,
          statusEl,
          settings,
        );
      }

      if (!parsed) throw new Error('Could not parse AI response. Please try again.');

      _dumpInProgress = false;
      clearInterval(window._dumpTimer);
      if (statusEl) statusEl.innerHTML = '';
      showDumpReviewModal(parsed, text);
    } catch (err) {
      clearInterval(window._dumpTimer);
      if (err.name === 'AbortError') {
        if (statusEl)
          statusEl.innerHTML =
            '<div class="ai-status" style="color:var(--orange)">Cancelled. Your data was not changed.</div>';
        undo();
        return;
      }
      console.error('AI error:', err);
      if (statusEl)
        statusEl.innerHTML = `<div class="ai-status" style="color:var(--red)">Error: ${esc(err.message)}</div>`;
    } finally {
      dumpAbort = null;
      _dumpInProgress = false;
    }
  }

  function cancelDump() {
    if (dumpAbort) dumpAbort.abort();
  }

  // ── Review modal ────────────────────────────────────────────────────────
  function _renderReviewRow(item, i) {
    const prioColors = {
      urgent: 'var(--red)',
      important: 'var(--orange)',
      normal: 'var(--accent)',
      low: 'var(--text3)',
    };
    const statusLabels = { done: 'Done', 'in-progress': 'In Progress', todo: 'To Do' };
    const statusColors = { done: 'var(--green)', 'in-progress': 'var(--blue, var(--accent))', todo: 'var(--text3)' };

    const title = esc(item.title || `Update: ${item.id || '?'}`);
    const project = esc(item.suggestedProject || '');
    const priority = item.priority || 'normal';
    const status = item.status || (item.action === 'complete' ? 'done' : item.action === 'update' ? 'update' : 'todo');
    const action = item.action || 'create';
    const actionLabel = action === 'update' ? 'Update' : action === 'complete' ? 'Complete' : '';
    const prioColor = prioColors[priority] || 'var(--text3)';
    const statColor = statusColors[status] || 'var(--text3)';
    const statLabel = actionLabel || statusLabels[status] || status;

    return `<label class="dump-review-row" data-idx="${i}">
      <input type="checkbox" checked data-dump-check="${i}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0;cursor:pointer">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
          ${project ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--accent-dim);color:var(--accent)">${project}</span>` : ''}
          <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:color-mix(in srgb, ${prioColor} 12%, transparent);color:${prioColor}">${priority}</span>
          <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:color-mix(in srgb, ${statColor} 12%, transparent);color:${statColor}">${statLabel}</span>
        </div>
      </div>
    </label>`;
  }

  function showDumpReviewModal(parsed, inputText) {
    const items = parsed.tasks || parsed || [];
    const taskItems = (Array.isArray(items) ? items : []).filter((item) => item && (item.title || item.id));
    const totalCount = taskItems.length;

    const rows = taskItems.map((item, i) => _renderReviewRow(item, i)).join('');

    const updateCheckedCount = () => {
      const checks = document.querySelectorAll('[data-dump-check]');
      const checked = Array.from(checks).filter((c) => c.checked).length;
      const applyBtn = document.getElementById('dumpReviewApplyBtn');
      if (applyBtn) applyBtn.textContent = `Apply Selected (${checked})`;
    };

    $('#modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="dump-review-cancel" data-click-self="true" style="z-index:var(--z-modal)" role="dialog" aria-modal="true" aria-label="Review brainstorm tasks">
      <div class="modal" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;padding:0" aria-labelledby="modal-title-review-tasks">
        <div style="padding:20px 24px 0;flex-shrink:0">
          <h2 class="modal-title" id="modal-title-review-tasks" style="margin-bottom:4px">Review extracted tasks</h2>
          <div style="font-size:12px;color:var(--text3);margin-bottom:16px">${totalCount} task${totalCount !== 1 ? 's' : ''} found \u00b7 uncheck any you don't want</div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:0 24px;display:flex;flex-direction:column;gap:2px" id="dumpReviewList">
          ${rows || '<div style="color:var(--text3);padding:20px;text-align:center">No tasks extracted</div>'}
        </div>
        <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;align-items:center">
          <label style="font-size:11px;color:var(--text3);cursor:pointer;margin-right:auto;display:flex;align-items:center;gap:6px;user-select:none">
            <input type="checkbox" checked id="dumpReviewSelectAll" style="accent-color:var(--accent);cursor:pointer" data-onchange-action="dump-review-select-all">
            Select all
          </label>
          <button class="btn" data-action="dump-review-cancel" style="font-size:12px">Cancel</button>
          <button class="btn btn-primary" id="dumpReviewApplyBtn" style="font-size:12px" data-action="apply-dump-results">Apply Selected (${totalCount})</button>
        </div>
      </div>
    </div>`;

    document.querySelectorAll('[data-dump-check]').forEach((cb) => {
      cb.addEventListener('change', () => {
        updateCheckedCount();
        const all = document.getElementById('dumpReviewSelectAll');
        const checks = document.querySelectorAll('[data-dump-check]');
        const checkedCount = Array.from(checks).filter((c) => c.checked).length;
        if (all) all.checked = checkedCount === checks.length;
      });
    });

    window._dumpReviewData = { parsed, inputText };
  }

  // ── Apply results helpers ────────────────────────────────────────────────
  function _applyProjectUpdates(projectUpdates, projectMap) {
    let projectsUpdated = 0,
      boardsNewCount = 0;
    projectUpdates.forEach((pu) => {
      if (!pu.name) return;
      const existing = findSimilarProject(pu.name);
      if (existing) {
        const updates = {};
        if (pu.description) {
          const shortDesc = enforceShortDesc(pu.description);
          if (!existing.description || existing.description.length > 80) {
            updates.description = shortDesc;
          }
        }
        if (pu.background) {
          updates.background = pu.background;
        }
        if (pu.description && pu.description.length > 80 && !pu.background) {
          updates.description = enforceShortDesc(pu.description);
          updates.background = pu.description;
        }
        if (Object.keys(updates).length) updateProject(existing.id, updates);
        projectMap[pu.name] = existing.id;
        projectsUpdated++;
      } else if (pu.isNew !== false) {
        const desc = enforceShortDesc(pu.description || '');
        let bg = pu.background || '';
        if ((pu.description || '').length > 80 && !bg) {
          bg = pu.description;
        }
        const p = createProject({ name: pu.name, description: desc, background: bg });
        addProject(p);
        projectMap[pu.name] = p.id;
        projectsUpdated++;
        boardsNewCount++;
      }
    });
    return { projectsUpdated, boardsNewCount };
  }

  function _resolveItemProject(item, projectMap, parsedProjectUpdates) {
    if (!item.suggestedProject) return;
    if (projectMap[item.suggestedProject]) return;
    const existing = findSimilarProject(item.suggestedProject);
    if (existing) {
      projectMap[item.suggestedProject] = existing.id;
    } else {
      const wasExplicitlyCreated = (parsedProjectUpdates || []).some(
        (pu) => normalizeTitle(pu.name) === normalizeTitle(item.suggestedProject),
      );
      if (wasExplicitlyCreated) {
        const p = createProject({ name: item.suggestedProject });
        addProject(p);
        projectMap[item.suggestedProject] = p.id;
      } else {
        projectMap[item.suggestedProject] = getLifeProjectId();
      }
    }
  }

  function _applyTaskItem(item, projId) {
    if (item.action === 'complete' && item.id) {
      updateTask(item.id, { status: 'done' });
      return 'completed';
    } else if (item.action === 'update' && item.id) {
      const rawFields = item.updateFields || {};
      if (item.dueDate) rawFields.dueDate = item.dueDate;
      if (item.priority) rawFields.priority = item.priority;
      if (item.notes) {
        const t = findTask(item.id);
        if (t) {
          if (!t.updates) t.updates = [];
          t.updates.push({ date: todayStr(), text: item.notes });
        }
      }
      const allowed = [
        'title',
        'notes',
        'priority',
        'status',
        'dueDate',
        'project',
        'phase',
        'tags',
        'recurrence',
        'estimatedMinutes',
        'subtasks',
        'favorite',
      ];
      const fields = {};
      for (const k of allowed) {
        if (k in rawFields) fields[k] = rawFields[k];
      }
      updateTask(item.id, fields);
      return 'updated';
    } else if (item.title) {
      const dupe = findSimilarTask(item.title, projId);
      if (dupe) {
        const updates = {};
        if (item.status && item.status !== dupe.status) updates.status = item.status;
        if (item.notes && item.notes !== dupe.notes) updates.notes = (dupe.notes ? dupe.notes + '\n' : '') + item.notes;
        if (item.dueDate && !dupe.dueDate) updates.dueDate = item.dueDate;
        if (item.priority && item.priority !== dupe.priority && item.priority !== 'normal')
          updates.priority = item.priority;
        if (item.estimatedMinutes && !dupe.estimatedMinutes)
          updates.estimatedMinutes = parseInt(item.estimatedMinutes) || 0;
        if (Object.keys(updates).length) updateTask(dupe.id, updates);
        return 'updated';
      } else {
        const taskStatus = item.status || 'todo';
        const st = (item.subtasks || []).map((s) => ({ id: genId('st'), title: s, done: false }));
        const taskNotes = item.notes || '';
        const t = createTask({
          title: item.title,
          notes: taskNotes,
          priority: item.priority || 'normal',
          horizon: item.horizon || 'short',
          dueDate: item.dueDate || '',
          project: projId,
          phase: item.phase || '',
          status: taskStatus,
          subtasks: st,
          recurrence: item.recurrence || '',
          estimatedMinutes: parseInt(item.estimatedMinutes) || 0,
        });
        if (taskStatus === 'done') t.completedAt = new Date().toISOString();
        addTask(t);
        return 'created';
      }
    }
    return null;
  }

  // ── Apply results ───────────────────────────────────────────────────────
  function applyDumpResults() {
    const reviewData = window._dumpReviewData;
    if (!reviewData) return;
    const { parsed, inputText } = reviewData;
    window._dumpReviewData = null;

    const checks = document.querySelectorAll('[data-dump-check]');
    const selectedIndices = new Set();
    checks.forEach((cb) => {
      if (cb.checked) selectedIndices.add(parseInt(cb.dataset.dumpCheck));
    });

    closeModal();

    const allItems = parsed.tasks || parsed || [];
    const taskItems = (Array.isArray(allItems) ? allItems : []).filter((item) => item && (item.title || item.id));
    const items = taskItems.filter((_, i) => selectedIndices.has(i));

    if (items.length === 0) {
      showToast('No tasks selected', false, false);
      undo();
      return;
    }

    const projectUpdates = parsed.projectUpdates || [];
    const projectMap = {};
    const { projectsUpdated, boardsNewCount } = _applyProjectUpdates(projectUpdates, projectMap);
    let created = 0,
      updated = 0,
      completed = 0;

    // Process selected tasks
    items.forEach((item) => {
      if (!item || (!item.title && !item.id)) return;

      _resolveItemProject(item, projectMap, parsed.projectUpdates);
      const projId = projectMap[item.suggestedProject] || '';

      const result = _applyTaskItem(item, projId);
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else if (result === 'completed') completed++;
    });

    const patterns = parsed.patterns || [];

    const parts = [];
    if (created) parts.push(`${created} tasks created`);
    if (updated) parts.push(`${updated} updated`);
    if (completed) parts.push(`${completed} completed`);
    if (projectsUpdated) parts.push(`${projectsUpdated} projects`);
    if (patterns.length) parts.push(`${patterns.length} patterns found`);
    const doneCount = items.filter((i) => i.status === 'done' || i.action === 'complete').length;
    if (doneCount) parts.push(`${doneCount} logged as done`);

    const text = inputText;
    lastDumpResult = {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      tasksCreated: created,
      tasksDone: items.filter((i) => i.status === 'done' || i.action === 'complete').length,
      tasksInProgress: items.filter((i) => i.status === 'in-progress').length,
      tasksTodo: items.filter((i) => !i.status || i.status === 'todo').length,
      boardsCreated: boardsNewCount,
      boardsUpdated: projectsUpdated - boardsNewCount,
      inputSnippet: text.slice(0, 200),
      tasksByBoard: (() => {
        const m = {};
        items.forEach((i) => {
          const n = i.suggestedProject || 'Unsorted';
          m[n] = (m[n] || 0) + 1;
        });
        return m;
      })(),
    };

    saveDumpHistory({
      date: new Date().toISOString(),
      wordCount: lastDumpResult.wordCount,
      tasksCreated: lastDumpResult.tasksCreated,
      boardsCreated: lastDumpResult.boardsCreated || 0,
    });
    showToast(parts.length ? `\u2726 ${parts.join(', ')}` : 'Organized', false, true);

    // Mark onboarding complete after first successful brainstorm
    if (localStorage.getItem(userKey('wb_onboarding_hint')) === 'true') {
      localStorage.setItem(userKey('wb_onboarding_done'), 'true');
      localStorage.removeItem(userKey('wb_onboarding_hint'));
      localStorage.setItem(userKey('wb_show_tips_after_brainstorm'), '1');
    }

    if ($('#dumpText')) $('#dumpText').value = '';
    clearDumpDraft();
    _dumpAttachments = [];
    _dumpInProgress = false;
    render();
  }

  // ── Manual (no AI) parsing ──────────────────────────────────────────────
  function processDumpManual(text) {
    const lines = text
      .split(/[\n;]/)
      .map((l) => l.replace(/^[-\u2022*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 2);
    const lifeId = getLifeProjectId();
    lines.forEach((l) => addTask(createTask({ title: l.charAt(0).toUpperCase() + l.slice(1), project: lifeId })));
    lastDumpResult = {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      tasksCreated: lines.length,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTodo: lines.length,
      boardsCreated: 0,
      boardsUpdated: 0,
      inputSnippet: text.slice(0, 200),
    };
    // Mark onboarding complete after first successful brainstorm
    if (localStorage.getItem(userKey('wb_onboarding_hint')) === 'true') {
      localStorage.setItem(userKey('wb_onboarding_done'), 'true');
      localStorage.removeItem(userKey('wb_onboarding_hint'));
      localStorage.setItem(userKey('wb_show_tips_after_brainstorm'), '1');
    }
    saveDumpHistory({
      date: new Date().toISOString(),
      wordCount: lastDumpResult.wordCount,
      tasksCreated: lines.length,
      boardsCreated: 0,
    });
    showToast(`Added ${lines.length} tasks`);
    if ($('#dumpText')) $('#dumpText').value = '';
    clearDumpDraft();
    _dumpAttachments = [];
    render();
  }

  // ── State accessors (for app.js integration) ───────────────────────────
  function isDumpInProgress() {
    return _dumpInProgress;
  }
  function getLastDumpResult() {
    return lastDumpResult;
  }
  function setLastDumpResult(v) {
    lastDumpResult = v;
  }
  function removeDumpAttachment(idx) {
    _dumpAttachments.splice(idx, 1);
    render();
  }
  function resetState() {
    _dumpAttachments = [];
    _processingFiles = [];
    dumpAbort = null;
    _dumpInProgress = false;
    lastDumpResult = null;
  }

  return {
    renderDump,
    initDumpDropZone,
    processDump,
    processDumpManual,
    cancelDump,
    applyDumpResults,
    submitClarify,
    skipClarify,
    handleDumpFiles,
    saveDumpDraft,
    loadDumpDraft,
    clearDumpDraft,
    isDumpInProgress,
    getLastDumpResult,
    setLastDumpResult,
    removeDumpAttachment,
    shouldShowDumpInvite,
    getDumpHistory,
    resetState,
  };
}
