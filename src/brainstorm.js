// ============================================================
// BRAINSTORM MODULE — Conversational AI Brainstorm
// ============================================================
// Handles brainstorm/dump input, file attachments, and
// conversational theme-by-theme AI-powered task extraction.

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
 * @returns {{ renderDump, initDumpDropZone, processDump, processDumpManual, cancelDump, applyDumpResults, submitClarify, skipClarify, handleDumpFiles, saveDumpDraft, loadDumpDraft, clearDumpDraft, isDumpInProgress, getLastDumpResult, setLastDumpResult, removeDumpAttachment, shouldShowDumpInvite, getDumpHistory, resetState, approveTheme, skipTheme, submitThemeClarify, skipThemeClarify, startThemeClarify, getConvState }}
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

  // ── Conversational state ──────────────────────────────────────────────
  // States: IDLE | ANALYZING | THEME_REVIEW | CLARIFYING | APPLYING | COMPLETE
  let _convState = 'IDLE';
  let _convThemes = [];
  let _convCurrentTheme = 0;
  let _convMessages = [];
  let _convAppliedTasks = [];
  let _convOriginalInput = '';
  let _convParsedFull = null; // Full parsed response for fallback

  function _resetConvState() {
    _convState = 'IDLE';
    _convThemes = [];
    _convCurrentTheme = 0;
    _convMessages = [];
    _convAppliedTasks = [];
    _convOriginalInput = '';
    _convParsedFull = null;
  }

  function getConvState() {
    return _convState;
  }

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
          ${statusParts.length ? `<div style="font-size:12px;color:var(--text3);margin-bottom:12px">${statusParts.join(' \u00b7 ')}</div>` : ''}
          ${r.summary ? `<div style="font-size:13px;color:var(--text2);line-height:1.6;text-align:left;margin-bottom:16px;padding:12px 16px;background:var(--surface);border-radius:var(--radius-sm);border-left:2px solid var(--accent)">${esc(r.summary)}</div>` : ''}
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
            <button class="btn btn-primary" data-action="view-organized">View organized tasks \u2192</button>
            <button class="btn" data-action="new-brainstorm">New brainstorm</button>
          </div>
        </div>
      </div>`;
    }

    // Show conversation UI if brainstorm is in progress
    if (_convState !== 'IDLE') {
      return `<div class="dump-area">
        <div id="brainstormConversation" style="max-height:60vh;overflow-y:auto;padding:4px 0">
          ${_renderConversationHTML()}
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
          <div style="font-size:10px;color:var(--accent)">Processing\u2026</div>
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
          <div style="font-size:10px;color:var(--text3)">${a.size} \u00b7 ${a.pages ? a.pages + ' pages' : Math.round(a.textLength / 1000) + 'K chars'}</div>
        </div>
        <button data-action="remove-dump-attachment" data-idx="${i}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0 2px" title="Remove">\u00d7</button>
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

  function loadScript(url) {
    if (_libCache[url]) return _libCache[url];
    _libCache[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => {
        delete _libCache[url];
        reject(new Error('Failed to load ' + url.split('/').pop()));
      };
      document.head.appendChild(s);
    });
    return _libCache[url];
  }

  let _pdfjsLib = null;
  async function ensurePDFLib() {
    if (_pdfjsLib) return;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    const workerJs = await import('pdfjs-dist/legacy/build/pdf.worker.js?url');
    const resp = await fetch(workerJs.default);
    const text = await resp.text();
    const blob = new Blob([text], { type: 'application/javascript' });
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    _pdfjsLib = pdfjs;
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

    if (
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'heic'].includes(ext) ||
      file.type.startsWith('image/')
    ) {
      throw new Error('Images can\u2019t be processed for text. Try a PDF, Word doc, or text file instead.');
    }

    const buf = await readFileAsArrayBuffer(file);

    if (ext === 'pdf' || file.type === 'application/pdf') {
      await ensurePDFLib();
      const pdf = await _pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(' '));
      }
      return { text: pages.join('\n\n'), pages: pdf.numPages };
    }

    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
      throw new Error('Legacy .doc files are not supported. Please save as .docx and try again.');
    }

    if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      await ensureMammothLib();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      return { text: result.value };
    }

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
    const processingHtml = _processingFiles
      .map(
        (name) =>
          `<div class="dump-attach-chip skeleton-pulse" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--surface3);border:1px solid var(--border2);border-radius:8px;font-size:12px;max-width:260px;opacity:0.7">
        <span style="font-size:16px">${_fileIcon(name)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
          <div style="font-size:10px;color:var(--accent)">Processing\u2026</div>
        </div>
      </div>`,
      )
      .join('');
    if (list) {
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

  // ── Conversation UI rendering ─────────────────────────────────────────
  function _renderConversationHTML() {
    let html = '';

    // Render all messages
    _convMessages.forEach((msg) => {
      if (msg.role === 'ai') {
        html += `<div style="margin-bottom:16px">
          <div style="font-size:13px;color:var(--text);line-height:1.6;padding:14px 16px;background:var(--surface2);border-radius:var(--radius);border-left:2px solid var(--accent)">${msg.content}</div>
        </div>`;
      } else if (msg.role === 'user') {
        html += `<div style="margin-bottom:16px;text-align:right">
          <div style="display:inline-block;font-size:13px;color:var(--bg);line-height:1.5;padding:10px 14px;background:var(--accent);border-radius:var(--radius);max-width:80%;text-align:left">${esc(msg.content)}</div>
        </div>`;
      } else if (msg.role === 'status') {
        html += `<div style="margin-bottom:12px;text-align:center;font-size:12px;color:var(--green)">\u2713 ${msg.content}</div>`;
      }
    });

    // Current state UI
    if (_convState === 'ANALYZING') {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:16px 0">
        <div class="spinner"></div>
        <span style="font-size:13px;color:var(--text2)">Reading your input and identifying themes...</span>
        <button class="btn btn-sm" style="margin-left:auto;font-size:10px;color:var(--red);border-color:var(--red)" data-action="cancel-dump">Cancel</button>
      </div>`;
    } else if (_convState === 'THEME_REVIEW') {
      const theme = _convThemes[_convCurrentTheme];
      if (theme) html += _renderThemeCard(theme, _convCurrentTheme, _convThemes.length);
    } else if (_convState === 'CLARIFYING') {
      const theme = _convThemes[_convCurrentTheme];
      if (theme) html += _renderClarifyCard(theme);
    } else if (_convState === 'APPLYING') {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:16px 0">
        <div class="spinner"></div>
        <span style="font-size:13px;color:var(--text2)">Creating tasks...</span>
      </div>`;
    } else if (_convState === 'COMPLETE') {
      html += _renderCompleteSummary();
    }

    return html;
  }

  function _renderThemeCard(theme, idx, total) {
    const tasks = theme.tasks || [];
    const tasksPreview = tasks
      .slice(0, 6)
      .map((t) => {
        const prioBadge =
          t.priority === 'urgent'
            ? ' <span style="color:var(--red);font-size:10px;font-weight:600">Urgent</span>'
            : t.priority === 'important'
              ? ' <span style="color:var(--orange);font-size:10px;font-weight:600">Important</span>'
              : '';
        return `<div style="display:flex;gap:6px;align-items:start;padding:3px 0">
        <span style="color:var(--text3);flex-shrink:0;font-size:11px">\u2022</span>
        <span style="font-size:12px;color:var(--text2)">${esc(t.title)}${prioBadge}</span>
      </div>`;
      })
      .join('');
    const moreCount = tasks.length - 6;

    const hasQuestions = theme.questions && theme.questions.length > 0;

    return `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius);padding:20px;margin:12px 0;animation:fadeIn .3s ease">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Theme ${idx + 1} of ${total}</div>
        <div style="font-size:11px;color:var(--text3)">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</div>
      </div>
      <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px">${esc(theme.name)}</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:14px">${esc(theme.narrative)}</div>
      ${tasksPreview ? `<div style="margin-bottom:14px;padding:10px 12px;background:var(--surface3);border-radius:var(--radius-sm)">${tasksPreview}${moreCount > 0 ? `<div style="font-size:11px;color:var(--text3);padding:4px 0">+${moreCount} more</div>` : ''}</div>` : ''}
      ${hasQuestions ? `<div style="font-size:12px;color:var(--accent);margin-bottom:12px">\u2726 I have ${theme.questions.length} question${theme.questions.length > 1 ? 's' : ''} that would help me create better tasks for this.</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${hasQuestions ? `<button class="btn btn-primary btn-sm" data-action="brainstorm-clarify-theme" data-theme-idx="${idx}">Answer questions first</button>` : ''}
        <button class="btn ${!hasQuestions ? 'btn-primary' : ''} btn-sm" data-action="brainstorm-approve-theme" data-theme-idx="${idx}">\u2713 Create these tasks</button>
        <button class="btn btn-sm" data-action="brainstorm-skip-theme" data-theme-idx="${idx}" style="color:var(--text3)">Skip</button>
      </div>
    </div>`;
  }

  function _renderClarifyCard(theme) {
    const questions = theme.questions || [];
    let html = `<div style="background:var(--surface2);border:1px solid var(--accent);border-radius:var(--radius);padding:20px;margin:12px 0;animation:fadeIn .3s ease">
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:14px">Quick questions about "${esc(theme.name)}":</div>
      <div style="display:flex;flex-direction:column;gap:12px">`;
    questions.forEach((q, i) => {
      html += `<div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">${esc(q)}</div>
        <input type="text" class="conv-clarify-input" data-q-idx="${i}" placeholder="Your answer..." aria-label="${esc(q)}" style="width:100%;padding:8px 12px;background:var(--surface3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;outline:none;box-sizing:border-box" data-keydown-action="conv-clarify-enter">
      </div>`;
    });
    html += `</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-primary btn-sm" data-action="brainstorm-submit-clarify">\u2726 Continue with answers</button>
        <button class="btn btn-sm" data-action="brainstorm-skip-clarify" style="color:var(--text3)">Skip \u2014 create as-is</button>
      </div>
    </div>`;
    return html;
  }

  function _renderCompleteSummary() {
    const total = _convAppliedTasks.length;
    const boards = {};
    _convAppliedTasks.forEach((t) => {
      const b = t.suggestedProject || 'Unsorted';
      boards[b] = (boards[b] || 0) + 1;
    });
    const boardList = Object.entries(boards)
      .map(
        ([name, count]) =>
          `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0"><span style="color:var(--text2)">${esc(name)}</span><span style="color:var(--accent)">${count}</span></div>`,
      )
      .join('');

    return `<div style="background:linear-gradient(135deg,var(--surface2),var(--surface3));border:1px solid var(--border2);border-radius:var(--radius);padding:24px;margin:16px 0;text-align:center;animation:fadeIn .3s ease">
      <div style="font-size:32px;font-weight:700;color:var(--accent);margin-bottom:4px">${total}</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:16px">tasks processed across ${Object.keys(boards).length} board${Object.keys(boards).length !== 1 ? 's' : ''}</div>
      ${boardList ? `<div style="text-align:left;padding:12px;background:var(--surface);border-radius:var(--radius-sm);margin-bottom:16px">${boardList}</div>` : ''}
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn btn-primary" data-action="view-organized">View organized tasks \u2192</button>
        <button class="btn" data-action="new-brainstorm">New brainstorm</button>
      </div>
    </div>`;
  }

  function _refreshConversationUI() {
    const container = document.getElementById('brainstormConversation');
    if (container) {
      container.innerHTML = _renderConversationHTML();
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 50);
    } else {
      render();
    }
  }

  // ── AI prompts ────────────────────────────────────────────────────────
  function _buildThemeExtractionPrompt() {
    return `You are a sharp, direct productivity partner. You've been handed a brainstorm dump. Your job: identify the distinct THEMES in this input, then for each theme, extract the tasks.

## WHAT IS A THEME?
A theme is a distinct topic, project, or area of life. Examples:
- "Morocco trip planning" = one theme
- "Graduate school applications" = one theme
- "Random personal errands" = one theme
- "Work project: Justice Architecture" = one theme

If the entire input is about ONE topic, return exactly ONE theme. Do NOT split artificially.
For a multi-topic brain dump, typically 2-5 themes.

## FOR EACH THEME, PROVIDE:
1. A short name (2-5 words)
2. A narrative explanation (2-4 sentences) that tells the user what you found and why it matters. Write like a smart assistant explaining back what they dumped. Include timing context (how soon things are due, what's urgent).
3. 1-2 clarifying questions that would help create BETTER tasks (optional \u2014 only if the input is genuinely vague about important details). Skip questions if the input is already detailed enough.
4. The extracted tasks for this theme.

## TASK EXTRACTION RULES
${_getTaskExtractionRules()}

## OUTPUT FORMAT \u2014 Return ONLY this JSON:
{
  "opening": "1-2 sentence overview. Example: 'I see three threads here: your Morocco trip, grad school tracking, and some personal admin. Let me walk you through each.'",
  "themes": [
    {
      "name": "Theme Name",
      "narrative": "What you found and why it matters. Be specific about timing and urgency.",
      "questions": ["Optional clarifying question 1", "Optional question 2"],
      "suggestedBoard": "Board name for these tasks — ALWAYS provide this",
      "boardDescription": "One sentence subtitle, max 12 words — REQUIRED for new boards",
      "boardBackground": "## Origin\\nWhere this came from and why it matters\\n## Where It's Going\\nThe goal\\n## Key Details\\nImportant context, dates, constraints\\n## Next Steps\\nWhat needs to happen next — REQUIRED: put ALL detailed context here, not in task notes",
      "isNewBoard": true,
      "tasks": [
        {
          "action": "create",
          "title": "Clear task title",
          "notes": "Context. Max 20 words.",
          "status": "todo",
          "priority": "normal",
          "priorityReason": "Why this priority level, referencing dates or context",
          "dueDate": "",
          "phase": "",
          "subtasks": ["Step 1", "Step 2"],
          "recurrence": "",
          "estimatedMinutes": 30
        }
      ]
    }
  ],
  "closing": "Brief summary of total scope. Example: 'That's 28 items across 3 areas. The Airbnb booking is the most time-sensitive.'"
}`;
  }

  function _getTaskExtractionRules() {
    return `- Extract ALL discrete items: things to DO, things already DONE, things IN PROGRESS.
- COMPLETED WORK matters. Past tense = status "done". Checkmarks [x] = "done".
- Do NOT create tasks for background info. That goes in boardBackground.
- A 1-page dump = 3-10 tasks. A 10-page doc = 15-40 tasks.

STATUS DETECTION:
DONE: [x], "completed", "done", "finished", "submitted", "signed", past tense = DONE.
TODO: [ ], "pending", "needs to", "will", future tense = TODO.
IN-PROGRESS: "working on", "currently", "started" = IN-PROGRESS.

PRIORITY (correlate with time \u2014 today is ${new Date().toISOString().slice(0, 10)}):
- Due in 0-3 days \u2192 urgent
- Due in 4-14 days \u2192 important
- Due in 15+ days \u2192 normal
- Due in 60+ days \u2192 low

DEADLINES: Only set dueDate if the input mentions a SPECIFIC date. NEVER invent deadlines.

TIME ESTIMATES: ALWAYS estimate. Every task MUST have estimatedMinutes > 0.
- Quick tasks (email, call, form, lookup): 15 minutes
- Standard tasks (review, meeting prep, short writing): 30-60 minutes
- Deep work (coding, analysis, detailed writing, research): 90-180 minutes
- Large tasks (project planning, major deliverable): 240+ minutes
- NEVER leave estimatedMinutes as 0. Your best guess is better than nothing.

SUBTASKS: Multi-step processes = ONE task with subtasks, not many separate tasks.

DEDUPLICATION: Check existing tasks below. If similar exists, use "action": "update" with the existing ID.

PROJECT ASSIGNMENT:
- CRITICAL: If input is about ONE topic, ALL tasks go in ONE board.
- Random personal stuff goes in "${LIFE_PROJECT_NAME}".
- Match existing boards fuzzily. Only create new boards for substantial new workstreams.
- "description" = max 12 words subtitle. "background" = all detailed info.

For updates: { "action": "update", "id": "existing_task_id", "updateFields": { "status": "done" } }`;
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

  // ── Main processing (conversational) ──────────────────────────────────
  async function processDump(skipClarifyPass) {
    if (_dumpInProgress) {
      showToast('Brainstorm already in progress', false);
      return;
    }

    const text = _validateDumpInput();
    if (text === null) return;

    const settings = getSettings();

    if (!hasAI()) {
      showToast('Add a Claude API key in Settings for AI-powered brainstorm parsing', false);
      processDumpManual(text);
      return;
    }

    _dumpInProgress = true;
    _convOriginalInput = text;
    _convState = 'ANALYZING';
    _convMessages = [];
    _convAppliedTasks = [];
    _convCurrentTheme = 0;

    pushUndo('Brainstorm');
    dumpAbort = new AbortController();

    // Switch to conversation view
    render();

    try {
      const { existingCompact, taskNote, projectCompact } = _buildDumpContext();
      const systemPrompt = _buildThemeExtractionPrompt();
      const userPrompt = `EXISTING TASKS (id|title|status|notes_preview):
${existingCompact || '(none)'}${taskNote}

EXISTING PROJECTS (id|name):
${projectCompact || '(none)'}

TODAY: ${todayStr()}

Brainstorm input:
${text}${getDumpAttachmentText()}`;

      const _ep = getAIEndpoint();
      const resp = await fetch(_ep.url, {
        method: 'POST',
        signal: dumpAbort.signal,
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ..._ep.headers },
        body: JSON.stringify({
          model: settings.aiModel || 'claude-haiku-4-5-20251001',
          max_tokens: 16384,
          temperature: 0.3,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const errMsg = errBody?.error?.message || '';
        throw new Error(
          resp.status === 429
            ? 'AI is busy \u2014 try again in a moment'
            : resp.status === 500 || resp.status === 503
              ? 'AI service is temporarily down'
              : errMsg || 'Something went wrong \u2014 try again',
        );
      }

      const result = await resp.json();
      const rawText = result.content[0].text;

      // Try to parse as themed response
      const parsed = _parseThemeResponse(rawText);

      if (parsed && parsed.themes && parsed.themes.length > 0) {
        // Conversational flow
        _convThemes = parsed.themes;
        _convParsedFull = parsed;

        // Show opening narrative
        if (parsed.opening) {
          _convMessages.push({ role: 'ai', content: parsed.opening });
        }

        _convState = 'THEME_REVIEW';
        _convCurrentTheme = 0;
        _refreshConversationUI();
      } else {
        // Fallback to legacy batch flow
        const legacyParsed = parseDumpResponse(rawText);
        if (legacyParsed) {
          _convParsedFull = legacyParsed;
          // Convert to single theme
          _convThemes = [
            {
              name: 'Your brainstorm',
              narrative: legacyParsed.summary || "Here's what I found in your input.",
              tasks: legacyParsed.tasks || [],
              suggestedBoard: null,
              questions: [],
            },
          ];
          if (legacyParsed.summary) {
            _convMessages.push({ role: 'ai', content: legacyParsed.summary });
          }
          _convState = 'THEME_REVIEW';
          _convCurrentTheme = 0;
          _refreshConversationUI();
        } else {
          throw new Error('Could not parse AI response. Please try again.');
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        showToast('Cancelled. Your data was not changed.', false, false);
        undo();
        _resetConvState();
        _dumpInProgress = false;
        render();
        return;
      }
      console.error('AI error:', err);
      showToast('Error: ' + err.message, true);
      _resetConvState();
      _dumpInProgress = false;
      render();
    } finally {
      dumpAbort = null;
      // Safety net: ensure _dumpInProgress is never stuck true
      // (it's set false in catch blocks, but also here as final guarantee)
      if (_convState === 'IDLE') _dumpInProgress = false;
    }
  }

  function _parseThemeResponse(rawText) {
    try {
      // Strip markdown fences
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      // Try to extract JSON object
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.themes) return parsed;
        // If it has tasks but no themes, it's a legacy response
        if (parsed.tasks) return null;
      }
    } catch {
      // Try bracket-balancing repair
      try {
        let cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        const start = cleaned.indexOf('{');
        if (start === -1) return null;
        cleaned = cleaned.slice(start);
        // Simple depth-based extraction
        let depth = 0;
        let inStr = false;
        let escaped = false;
        let end = 0;
        for (let i = 0; i < cleaned.length; i++) {
          const c = cleaned[i];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (c === '\\') {
            escaped = true;
            continue;
          }
          if (c === '"') {
            inStr = !inStr;
            continue;
          }
          if (inStr) continue;
          if (c === '{') depth++;
          if (c === '}') {
            depth--;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        if (end > 0) {
          const parsed = JSON.parse(cleaned.slice(0, end));
          if (parsed.themes) return parsed;
        }
      } catch {
        // Give up
      }
    }
    return null;
  }

  // ── Theme actions (called from actions.js) ────────────────────────────
  function approveTheme(themeIdx) {
    const theme = _convThemes[themeIdx];
    if (!theme) return;

    _convState = 'APPLYING';
    _refreshConversationUI();

    // Apply this theme's tasks
    const tasks = theme.tasks || [];
    _applyThemeTasks(theme, tasks);

    // Add status message
    _convMessages.push({
      role: 'status',
      content: `Created ${tasks.length} task${tasks.length !== 1 ? 's' : ''} for "${theme.name}"`,
    });

    _advanceToNextThemeOrComplete();
  }

  function skipTheme(themeIdx) {
    _convMessages.push({
      role: 'status',
      content: `Skipped "${_convThemes[themeIdx]?.name || 'theme'}"`,
    });
    _advanceToNextThemeOrComplete();
  }

  function startThemeClarify(themeIdx) {
    _convState = 'CLARIFYING';
    _refreshConversationUI();
    // Focus first input after render
    setTimeout(() => {
      const first = document.querySelector('.conv-clarify-input');
      if (first) first.focus();
    }, 100);
  }

  function submitThemeClarify() {
    const inputs = document.querySelectorAll('.conv-clarify-input');
    const answers = [];
    inputs.forEach((inp) => {
      if (inp.value.trim()) answers.push(inp.value.trim());
    });

    if (answers.length > 0) {
      _convMessages.push({ role: 'user', content: answers.join(' \u2022 ') });
      // Enrich the current theme's task notes with the answers
      const theme = _convThemes[_convCurrentTheme];
      if (theme) {
        const answerText = answers.join('. ');
        (theme.tasks || []).forEach((t) => {
          t.notes = (t.notes || '') + (t.notes ? ' ' : '') + answerText;
        });
      }
    }

    // Now approve the theme with enriched tasks
    approveTheme(_convCurrentTheme);
  }

  function skipThemeClarify() {
    // Approve without answers
    approveTheme(_convCurrentTheme);
  }

  function _advanceToNextThemeOrComplete() {
    _convCurrentTheme++;
    if (_convCurrentTheme < _convThemes.length) {
      _convState = 'THEME_REVIEW';
      _refreshConversationUI();
    } else {
      _completeConversation();
    }
  }

  function _applyThemeTasks(theme, tasks) {
    if (!tasks.length) return;

    if (deps.setBatchMode) deps.setBatchMode(true);

    try {
      const projectMap = {};

      // Create/find the board for this theme
      if (theme.suggestedBoard) {
        const existing = findSimilarProject(theme.suggestedBoard);
        if (existing) {
          projectMap[theme.suggestedBoard] = existing.id;
          // Update background if provided
          if (theme.boardBackground) {
            updateProject(existing.id, { background: theme.boardBackground });
          }
        } else if (theme.isNewBoard !== false) {
          const desc = enforceShortDesc(theme.boardDescription || '');
          const p = createProject({
            name: theme.suggestedBoard,
            description: desc,
            background: theme.boardBackground || '',
          });
          addProject(p);
          projectMap[theme.suggestedBoard] = p.id;
        }
      }

      tasks.forEach((item) => {
        if (!item || (!item.title && !item.id)) return;

        // Set the project for this task
        item.suggestedProject = item.suggestedProject || theme.suggestedBoard;

        // Resolve project
        if (item.suggestedProject && !projectMap[item.suggestedProject]) {
          const existing = findSimilarProject(item.suggestedProject);
          if (existing) {
            projectMap[item.suggestedProject] = existing.id;
          } else {
            projectMap[item.suggestedProject] = getLifeProjectId();
          }
        }

        const projId = projectMap[item.suggestedProject] || getLifeProjectId();
        _applyTaskItem(item, projId);
        _convAppliedTasks.push(item);
      });
    } finally {
      if (deps.setBatchMode) deps.setBatchMode(false);
    }

    if (deps.saveData) deps.saveData(getData());
    render();
  }

  function _completeConversation() {
    _convState = 'COMPLETE';
    _dumpInProgress = false;

    // Add closing narrative
    const closing = _convParsedFull?.closing;
    if (closing) {
      _convMessages.push({ role: 'ai', content: closing });
    }

    // Build lastDumpResult for the results card
    const text = _convOriginalInput;
    const created = _convAppliedTasks.filter((t) => t.action !== 'update' && t.action !== 'complete').length;
    const boards = {};
    _convAppliedTasks.forEach((t) => {
      const b = t.suggestedProject || 'Unsorted';
      boards[b] = (boards[b] || 0) + 1;
    });

    lastDumpResult = {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      tasksCreated: created,
      tasksDone: _convAppliedTasks.filter((i) => i.status === 'done' || i.action === 'complete').length,
      tasksInProgress: _convAppliedTasks.filter((i) => i.status === 'in-progress').length,
      tasksTodo: _convAppliedTasks.filter((i) => !i.status || i.status === 'todo').length,
      boardsCreated: Object.keys(boards).length,
      boardsUpdated: 0,
      inputSnippet: text.slice(0, 200),
      summary: _convParsedFull?.opening || '',
      tasksByBoard: boards,
    };

    saveDumpHistory({
      date: new Date().toISOString(),
      wordCount: lastDumpResult.wordCount,
      tasksCreated: _convAppliedTasks.length,
      boardsCreated: lastDumpResult.boardsCreated,
      summary: lastDumpResult.summary,
      taskTitles: _convAppliedTasks.map((i) => i.title).slice(0, 20),
      boards: Object.keys(boards),
    });

    // Mark onboarding complete
    if (localStorage.getItem(userKey('wb_onboarding_hint')) === 'true') {
      localStorage.setItem(userKey('wb_onboarding_done'), 'true');
      localStorage.removeItem(userKey('wb_onboarding_hint'));
      localStorage.setItem(userKey('wb_show_tips_after_brainstorm'), '1');
    }

    if ($('#dumpText')) $('#dumpText').value = '';
    clearDumpDraft();
    _dumpAttachments = [];

    showToast(
      `\u2726 ${_convAppliedTasks.length} tasks organized across ${Object.keys(boards).length} board${Object.keys(boards).length !== 1 ? 's' : ''}`,
      false,
      true,
    );
    _refreshConversationUI();
  }

  // ── Input validation ──────────────────────────────────────────────────
  function _validateDumpInput() {
    const text =
      ($('#dumpText')?.value?.trim() || '') + (_dumpAttachments.length ? '\n' + getDumpAttachmentText() : '');
    if (!text.trim() && !_dumpAttachments.length) {
      showToast('Write something or attach a file first', true);
      return null;
    }
    const MAX_INPUT_CHARS = MAX_BRAINSTORM_INPUT_CHARS;
    if (text.length > MAX_INPUT_CHARS) {
      const overBy = text.length - MAX_INPUT_CHARS;
      showToast(
        `Input too long by ~${Math.ceil(overBy / 1000)}K characters. Try splitting into smaller brainstorms.`,
        true,
      );
      return null;
    }
    return text;
  }

  function cancelDump() {
    if (dumpAbort) dumpAbort.abort();
    _dumpInProgress = false;
    _resetConvState();
  }

  // ── Apply results helpers (shared with legacy flow) ───────────────────
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
        if (item.priorityReason) updates.priorityReason = item.priorityReason;
        if (Object.keys(updates).length) updateTask(dupe.id, updates);
        return 'updated';
      } else {
        const taskStatus = item.status || 'todo';
        const st = (item.subtasks || []).map((s) => ({ id: genId('st'), title: s, done: false }));
        const t = createTask({
          title: item.title,
          notes: item.notes || '',
          priority: item.priority || 'normal',
          priorityReason: item.priorityReason || '',
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

  // ── Legacy apply (for review modal compat if needed) ──────────────────
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

    pushUndo('Brainstorm: ' + items.length + ' tasks');
    if (deps.setBatchMode) deps.setBatchMode(true);

    let created = 0,
      updated = 0,
      completed = 0;
    let projectsUpdated = 0,
      boardsNewCount = 0;

    try {
      const projectUpdates = parsed.projectUpdates || [];
      const projectMap = {};
      ({ projectsUpdated, boardsNewCount } = _applyProjectUpdates(projectUpdates, projectMap));

      items.forEach((item) => {
        if (!item || (!item.title && !item.id)) return;
        _resolveItemProject(item, projectMap, parsed.projectUpdates);
        const projId = projectMap[item.suggestedProject] || '';
        const result = _applyTaskItem(item, projId);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else if (result === 'completed') completed++;
      });
    } finally {
      if (deps.setBatchMode) deps.setBatchMode(false);
    }

    if (deps.saveData) deps.saveData(getData());

    const parts = [];
    if (created) parts.push(`${created} tasks created`);
    if (updated) parts.push(`${updated} updated`);
    if (completed) parts.push(`${completed} completed`);
    if (projectsUpdated) parts.push(`${projectsUpdated} projects`);
    const patterns = parsed.patterns || [];
    if (patterns.length) parts.push(`${patterns.length} patterns found`);

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
      summary: parsed.summary || '',
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
      summary: lastDumpResult.summary || '',
      taskTitles: items.map((i) => i.title).slice(0, 20),
      boards: Object.keys(lastDumpResult.tasksByBoard),
    });
    showToast(parts.length ? `\u2726 ${parts.join(', ')}` : 'Organized', false, true);

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

  // ── Legacy compat wrappers ────────────────────────────────────────────
  function submitClarify() {
    submitThemeClarify();
  }
  function skipClarify() {
    skipThemeClarify();
  }

  // ── State accessors ───────────────────────────────────────────────────
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
    _resetConvState();
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
    approveTheme,
    skipTheme,
    submitThemeClarify,
    skipThemeClarify,
    startThemeClarify,
    getConvState,
  };
}
