// ============================================================
// INITIALIZATION HELPERS — Tooltip setup, throttle wrappers,
// modal observer, popstate handler, offline banner.
// Extracted from app.js for modularity.
// ============================================================

/**
 * Sets up the tooltip hover behaviour on task rows.
 */
export function setupTooltips() {
  // Tooltips removed — notes are shown inline in task rows
}

/**
 * Wraps AI-heavy functions with rate limiting via throttleAI.
 */
export function wrapWithThrottle(origFns, throttleAI) {
  const {
    generateAIBriefing: a,
    planMyDay: b,
    submitEndOfDay: c,
    generateWeeklyReview: d,
    runProactiveWorker: e,
  } = origFns;
  return {
    generateAIBriefing: async function () {
      if (!throttleAI('b')) return;
      return a.apply(this, arguments);
    },
    planMyDay: async function () {
      if (!throttleAI('p')) return;
      return b.apply(this, arguments);
    },
    submitEndOfDay: async function () {
      if (!throttleAI('e')) return;
      return c.apply(this, arguments);
    },
    generateWeeklyReview: async function () {
      if (!throttleAI('r')) return;
      return d.apply(this, arguments);
    },
    runProactiveWorker: async function () {
      if (!throttleAI('w')) return;
      return e.apply(this, arguments);
    },
  };
}

/**
 * Sets up the modal focus-trap MutationObserver on #modalRoot.
 */
export function setupModalObserver(trapFocus) {
  let _modalTrapCleanup = null;
  const _modalObs = new MutationObserver(() => {
    const root = document.getElementById('modalRoot');
    if (_modalTrapCleanup) {
      _modalTrapCleanup();
      _modalTrapCleanup = null;
    }
    if (root && root.children.length) {
      _modalTrapCleanup = trapFocus(root);
      setTimeout(() => {
        const af = root.querySelector('[autofocus], input:not([type=hidden]), select, textarea');
        if (af) af.focus();
      }, 50);
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('modalRoot');
    if (root) _modalObs.observe(root, { childList: true });
  });
}

/**
 * Sets up popstate handler for Android back button / modal history.
 */
export function setupPopstateHandler({ closeModal, toggleChat, closeMobileSidebar }) {
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.modal) return;
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      closeModal();
      return;
    }
    const chat = document.querySelector('.chat-panel');
    if (chat && chat.classList.contains('open') && window.innerWidth <= 768) {
      toggleChat();
      return;
    }
    const sidebar = document.querySelector('.mobile-overlay');
    if (sidebar && sidebar.style.display !== 'none') {
      closeMobileSidebar();
      return;
    }
  });
}

/**
 * Sets up online/offline banner and sync-dot override.
 */
export function setupOfflineBanner({ syncModule, getUpdateSyncDot, setUpdateSyncDot }) {
  let _wasOnline = false;
  function _showOfflineBanner() {
    if (!document.getElementById('offBnr')) {
      const d = document.createElement('div');
      d.id = 'offBnr';
      d.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:var(--z-offline);padding:6px;text-align:center;font-size:12px;color:#f97316;background:rgba(249,115,22,0.1);border-bottom:1px solid #f97316';
      d.textContent = "You're offline — changes saved locally";
      document.body.prepend(d);
    }
  }
  function _hideOfflineBanner() {
    const e = document.getElementById('offBnr');
    if (e) e.remove();
  }
  window.addEventListener('offline', () => {
    if (_wasOnline) _showOfflineBanner();
  });
  window.addEventListener('online', _hideOfflineBanner);
  const _oSD = getUpdateSyncDot();
  setUpdateSyncDot(function () {
    _oSD.apply(this, arguments);
    const ss = syncModule.getSyncStatus();
    if (ss === 'synced') _wasOnline = true;
    if (ss === 'offline' && _wasOnline && !navigator.onLine) _showOfflineBanner();
    else _hideOfflineBanner();
  });
}

/**
 * Sets up pull-to-refresh on mobile.
 */
export function setupPullToRefresh(syncToCloud) {
  const indicator = document.getElementById('pullIndicator');
  if (!indicator || !('ontouchstart' in window)) return;

  let startY = 0;
  let pulling = false;
  const THRESHOLD = 80;
  const content = document.querySelector('.main');
  if (!content) return;

  content.addEventListener(
    'touchstart',
    (e) => {
      if (content.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    },
    { passive: true },
  );

  content.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && dy < 150) {
        indicator.style.opacity = Math.min(dy / THRESHOLD, 1);
        indicator.style.transform = `translateY(${Math.min(dy * 0.4, 40)}px)`;
      }
    },
    { passive: true },
  );

  content.addEventListener(
    'touchend',
    () => {
      if (!pulling) return;
      pulling = false;
      const opacity = parseFloat(indicator.style.opacity || '0');
      if (opacity >= 1 && syncToCloud) {
        indicator.style.opacity = '1';
        indicator.querySelector('.pull-spinner').style.animation = 'pullSpin 0.6s linear infinite';
        syncToCloud().finally(() => {
          indicator.style.opacity = '0';
          indicator.style.transform = '';
        });
      } else {
        indicator.style.opacity = '0';
        indicator.style.transform = '';
      }
    },
    { passive: true },
  );
}
