// ============================================================
// AUTH MODULE
// ============================================================
// Extracted from app.js — handles authentication, onboarding, and session management

/**
 * Factory function to create auth functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ showAuthFromLanding, initAuth, handleAuth, toggleAuthMode, showForgotPassword, showPrivacy, showTerms, resendVerification, signOut, showApp, showOnboarding, showFeatureTips, cleanupStaleLocalStorage }}
 */
export function createAuth(deps) {
  const {
    sb,
    esc,
    todayStr,
    userKey,
    DEFAULT_SETTINGS,
    render,
    showToast,
    loadData,
    loadSettings,
    loadFromCloud,
    ensureLifeProject,
    processRecurringTasks,
    cleanupArchive,
    requestNotificationPermission,
    hasAI: _hasAI,
    processDump: _processDump,
    processDumpManual: _processDumpManual,
    // Getters
    getData,
    getCurrentUser,
    // Setters
    setCurrentUser,
    setData,
    setSettings,
    setCurrentView,
    setCurrentProject,
    setExpandedTask,
    setProactiveLog,
    setSidebarCollapsed,
    setBulkMode,
    setBulkSelected,
    setNudgeFilter,
    setShowTagFilter,
    setBriefingGenerating,
    setPlanGenerating,
    setDataVersion,
    setRenderCache,
    setTaskMapState,
    clearUndoStack,
    // Sync module accessor
    getSyncModule,
    // Module accessors
    getChatModule,
    getFocusModule,
    // Notifications
    clearNotifications,
    scheduleNotifications,
  } = deps;

  // Module-local state
  let authMode = 'login'; // 'login' | 'signup' | 'forgot' | 'recovery'
  let authInitialized = false;
  const _splashShownAt = Date.now();

  function _dismissSplash() {
    const splash = document.getElementById('splashScreen');
    if (!splash || splash.classList.contains('fade-out')) return;
    const elapsed = Date.now() - _splashShownAt;
    const delay = Math.max(0, 500 - elapsed);
    setTimeout(function () {
      splash.classList.add('fade-out');
      setTimeout(function () {
        if (splash.parentNode) splash.remove();
      }, 400);
    }, delay);
  }

  function showAuthFromLanding(mode) {
    const landing = document.getElementById('landingPage');
    const authScreen = document.getElementById('authScreen');
    if (mode === 'login') {
      authMode = 'login';
      document.getElementById('authBtn').textContent = 'Sign In';
      document.getElementById('authSwitchText').textContent = "Don't have an account?";
      document.getElementById('authSwitchLink').textContent = 'Sign Up';
    } else {
      authMode = 'signup';
      document.getElementById('authBtn').textContent = 'Create Account';
      document.getElementById('authSwitchText').textContent = 'Already have an account?';
      document.getElementById('authSwitchLink').textContent = 'Sign In';
    }
    authScreen.style.display = 'flex';
    landing.classList.add('hidden');
    setTimeout(function () {
      landing.style.display = 'none';
    }, 500);
    document.getElementById('authEmail').focus();
  }

  async function initAuth() {
    _dismissSplash();
    if (!sb) {
      document.getElementById('authError').innerHTML =
        '<div class="auth-error">Failed to load — check your connection and reload.</div>';
      return;
    }
    // Show loading state during session check with countdown feedback
    const authBtn = document.getElementById('authBtn');
    const authForm = document.getElementById('authForm');
    if (authForm) authForm.style.opacity = '0.5';
    if (authBtn) {
      authBtn.disabled = true;
      authBtn.innerHTML =
        '<span class="spinner" style="width:12px;height:12px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:6px"></span>Connecting...';
    }
    let _authCountdown = 8;
    const _authCountdownTimer = setInterval(() => {
      _authCountdown--;
      if (_authCountdown <= 3 && _authCountdown > 0 && authBtn) {
        authBtn.innerHTML =
          '<span class="spinner" style="width:12px;height:12px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:6px"></span>Still connecting... ' +
          _authCountdown +
          's';
      }
    }, 1000);
    const authTimeout = setTimeout(() => {
      clearInterval(_authCountdownTimer);
      if (authForm) authForm.style.opacity = '1';
      if (authBtn) {
        authBtn.disabled = false;
        authBtn.textContent = 'Sign In';
      }
    }, 8000);
    try {
      const {
        data: { session },
      } = await sb.auth.getSession();
      clearTimeout(authTimeout);
      clearInterval(_authCountdownTimer);
      if (authForm) authForm.style.opacity = '1';
      if (authBtn) {
        authBtn.disabled = false;
        authBtn.textContent = 'Sign In';
      }
      if (session) {
        setCurrentUser(session.user);
        setData(loadData());
        setSettings(loadSettings());
        await loadFromCloud();
        showApp();
        authInitialized = true;
      }
    } catch (e) {
      clearTimeout(authTimeout);
      clearInterval(_authCountdownTimer);
      if (authForm) authForm.style.opacity = '1';
      if (authBtn) {
        authBtn.disabled = false;
        authBtn.textContent = 'Sign In';
      }
      console.warn('Auth init failed:', e);
      document.getElementById('authError').innerHTML =
        '<div class="auth-error">Could not connect — check your internet and try again.</div>';
    }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (authInitialized) return; // already loaded via getSession
        authInitialized = true;
        setCurrentUser(session.user);
        setData(loadData());
        setSettings(loadSettings());
        loadFromCloud()
          .then(() => showApp())
          .catch((e) => {
            console.error('Cloud load failed:', e);
            showToast('Could not load cloud data', true);
            showApp();
          });
      } else if (event === 'PASSWORD_RECOVERY') {
        // User clicked password reset link from email — show new password form
        const lp = document.getElementById('landingPage');
        if (lp) lp.style.display = 'none';
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('authError').innerHTML = '';
        document.getElementById('authMsg').innerHTML =
          '<div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--accent)">Set your new password below and click &ldquo;Update Password&rdquo;.</div>';
        document.getElementById('authBtn').textContent = 'Update Password';
        const fgEmail = document.getElementById('authEmail').closest('.form-group');
        if (fgEmail) fgEmail.style.display = 'none';
        else document.getElementById('authEmail').style.display = 'none';
        document.getElementById('authPassword').focus();
        authMode = 'recovery';
      } else if (event === 'SIGNED_OUT') {
        authInitialized = false;
        const currentUser = getCurrentUser();
        if (currentUser) {
          const _p = 'wb_' + currentUser.id + '_';
          const _r = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(_p)) _r.push(k);
          }
          _r.forEach((k) => localStorage.removeItem(k));
          if (getSyncModule().getSyncStatus() !== 'synced') {
            console.warn(
              '[SIGNOUT] localStorage purged despite sync not confirmed — data is in cloud from last successful sync',
            );
          }
        }
        setCurrentUser(null);
        setData({ tasks: [], projects: [] });
        getChatModule().resetChatState();
        setSettings({ ...DEFAULT_SETTINGS });
        setProactiveLog([]);
        clearUndoStack();
        setCurrentView('dump');
        setCurrentProject(null);
        setExpandedTask(null);
        if (window._focusInterval) {
          clearInterval(window._focusInterval);
          window._focusInterval = null;
        }
        // Reset sync state to prevent cross-user contamination
        getSyncModule().resetSyncState();
        setRenderCache({ version: -1 });
        setTaskMapState(-1, new Map());
        setDataVersion(0);
        // Reset UI state (focus state is inside focus module)
        const _focus = getFocusModule();
        if (_focus) _focus.resetFocusState();
        if (clearNotifications) clearNotifications();
        setBulkMode(false);
        setBulkSelected(new Set());
        setNudgeFilter('');
        setShowTagFilter(false);
        setBriefingGenerating(false);
        setPlanGenerating(false);
        if (window._welcomeTypingInterval) {
          clearInterval(window._welcomeTypingInterval);
          window._welcomeTypingInterval = null;
        }
        if (window._dumpTimer) {
          clearTimeout(window._dumpTimer);
          window._dumpTimer = null;
        }
        const lpEl = document.getElementById('landingPage');
        if (lpEl) {
          lpEl.style.display = '';
          lpEl.classList.remove('hidden');
        }
        document.getElementById('authScreen').style.display = 'none';
        document.querySelector('.sidebar').style.display = 'none';
        document.querySelector('.main').style.display = 'none';
        document.getElementById('chatPanel').classList.remove('open');
        document.getElementById('chatToggle').style.display = 'none';
      }
    });
  }

  function cleanupStaleLocalStorage() {
    const today = todayStr();
    const prefixes = [
      'whiteboard_briefing_',
      'whiteboard_plan_',
      'wb_eod_',
      'whiteboard_proactive_',
      'whiteboard_review_',
    ];
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      for (const prefix of prefixes) {
        if (key && key.includes(prefix) && !key.endsWith(today)) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  function showApp() {
    const sidebarCollapsed = localStorage.getItem(userKey('wb_sidebar_collapsed')) === 'true';
    setSidebarCollapsed(sidebarCollapsed);
    getChatModule().reloadChatHistory();
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = 'none';
    document.getElementById('authScreen').style.display = 'none';
    const sidebarEl = document.querySelector('.sidebar');
    sidebarEl.style.display = '';
    if (sidebarCollapsed) sidebarEl.classList.add('collapsed');
    document.querySelector('.main').style.display = '';
    document.getElementById('chatToggle').style.display = '';
    ensureLifeProject();
    const data = getData();
    try {
      setProactiveLog(
        JSON.parse(localStorage.getItem(userKey('wb_proactive_log_' + new Date().toISOString().slice(0, 10))) || '[]'),
      );
    } catch (_e) {
      setProactiveLog([]);
    }
    // Defer non-critical housekeeping to idle time so it doesn't block initial render
    const _idleCb = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 1);
    _idleCb(() => {
      processRecurringTasks();
    });
    _idleCb(() => {
      cleanupArchive();
    });
    cleanupStaleLocalStorage();
    // Defer notification permission — only ask after user has tasks (not on first visit)
    if (data.tasks.length >= 3)
      _idleCb(() => {
        requestNotificationPermission();
      });
    // Schedule OS notifications for due tasks
    if (scheduleNotifications)
      _idleCb(() => {
        scheduleNotifications();
      });
    // Default to brainstorm unless user already has a daily plan for today
    setCurrentView(localStorage.getItem(userKey('whiteboard_plan_' + todayStr())) ? 'dashboard' : 'dump');
    render();
    if (!localStorage.getItem(userKey('wb_onboarding_done')) && data.tasks.length === 0 && data.projects.length <= 1) {
      showOnboarding();
    }
  }

  function showOnboarding() {
    // Mark onboarding as started (but not done - done happens after first brainstorm)
    localStorage.setItem(userKey('wb_onboarding_started'), 'true');
    // Navigate to brainstorm view with hint banner
    setCurrentView('dump');
    localStorage.setItem(userKey('wb_onboarding_hint'), 'true');
    render();
  }

  function showFeatureTips() {
    if (localStorage.getItem(userKey('wb_tips_seen'))) return;
    localStorage.setItem(userKey('wb_tips_seen'), '1');
    const tips = [
      {
        icon: '&#x2726;',
        title: 'AI Chat Assistant',
        desc: 'Click the chat button (bottom-right) or press <kbd>Cmd+J</kbd> to talk to your AI assistant.',
      },
      {
        icon: '&#x2318;',
        title: 'Command Palette',
        desc: 'Press <kbd>Cmd+K</kbd> to search, switch views, and run commands instantly.',
      },
      {
        icon: '&#x25B6;',
        title: 'Focus Mode',
        desc: 'Type <kbd>/focus</kbd> in the command palette to get AI-picked deep work sessions.',
      },
      { icon: '?', title: 'Keyboard Shortcuts', desc: 'Press <kbd>?</kbd> anytime to see all available shortcuts.' },
    ];
    let idx = 0;
    function renderTip() {
      const t = tips[idx];
      const isLast = idx === tips.length - 1;
      document.getElementById('modalRoot').innerHTML =
        `<div class="modal-overlay" style="background:rgba(0,0,0,0.5)"><div class="modal" style="max-width:380px;text-align:center;padding:32px">
        <div style="font-size:32px;margin-bottom:12px;opacity:0.7">${t.icon}</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">${esc(t.title)}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:20px">${t.desc}</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn" data-action="tip-skip" style="font-size:12px">Skip</button>
          <button class="btn btn-primary" data-action="tip-next" style="font-size:12px">${isLast ? 'Got it!' : 'Next'} <span style="font-size:10px;opacity:0.6;margin-left:4px">${idx + 1}/${tips.length}</span></button>
        </div>
      </div></div>`;
    }
    window._nextTip = function () {
      idx++;
      if (idx >= tips.length) {
        document.getElementById('modalRoot').innerHTML = '';
        delete window._nextTip;
        return;
      }
      renderTip();
    };
    renderTip();
  }
  // skipAuth removed — was a security bypass callable from console

  async function handleAuth(e) {
    e.preventDefault();
    const btn = document.getElementById('authBtn');
    if (btn.disabled) return; // Prevent double-submit
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    const msgEl = document.getElementById('authMsg');
    errEl.innerHTML = '';
    msgEl.innerHTML = '';
    btn.disabled = true;
    btn.textContent = authMode === 'signup' ? 'Creating...' : authMode === 'recovery' ? 'Updating...' : 'Signing in...';

    try {
      if (!sb) {
        errEl.innerHTML = '<div class="auth-error">Cannot connect to server — check your connection and reload.</div>';
        btn.disabled = false;
        btn.textContent = authMode === 'signup' ? 'Sign Up' : 'Sign In';
        return;
      }
      if (authMode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        msgEl.innerHTML = '<div class="auth-msg">Check your email for a reset link.</div>';
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
        return;
      }
      if (authMode === 'recovery') {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        msgEl.innerHTML = '<div class="auth-msg">Password updated! Signing you in...</div>';
        const fgEmail2 = document.getElementById('authEmail').closest('.form-group');
        if (fgEmail2) fgEmail2.style.display = '';
        else document.getElementById('authEmail').style.display = '';
        authMode = 'login';
        return;
      }
      if (authMode === 'signup') {
        const { data: signUpData, error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // If email confirmation is off, session comes back immediately — onAuthStateChange handles it.
        // If email confirmation is on, show the message.
        if (!signUpData.session) {
          msgEl.innerHTML =
            '<div class="auth-msg">Check your email to confirm your account.<br><span style="font-size:11px;color:var(--text3)">Don\'t see it? Check your spam folder.</span><br><button class="auth-resend" data-action="resend-verification" data-email="' +
            esc(email) +
            '" style="margin-top:8px;background:none;border:1px solid var(--border);color:var(--text2);padding:6px 14px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit">Resend verification email</button></div>';
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      const msg = err.message || '';
      const isRateLimit = msg.includes('rate limit') || msg.includes('too many') || msg.includes('429');
      const friendly = msg.includes('Invalid login')
        ? 'Wrong email or password.'
        : msg.includes('already registered')
          ? 'That email is already registered — try signing in.'
          : msg.includes('Password should be')
            ? 'Password must be at least 6 characters.'
            : msg.includes('valid email')
              ? 'Please enter a valid email address.'
              : isRateLimit
                ? 'Please wait a few seconds before trying again.'
                : msg;
      errEl.innerHTML = `<div class="auth-error">${esc(friendly)}</div>`;
      if (isRateLimit) {
        // Keep button disabled during cooldown to prevent rapid retries
        const label = authMode === 'signup' ? 'Sign Up' : authMode === 'recovery' ? 'Update Password' : 'Sign In';
        let countdown = 5;
        btn.textContent = `Wait ${countdown}s...`;
        const timer = setInterval(() => {
          countdown--;
          if (countdown <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.textContent = label;
            errEl.innerHTML = '';
          } else {
            btn.textContent = `Wait ${countdown}s...`;
          }
        }, 1000);
        return;
      }
    }
    btn.disabled = false;
    btn.textContent = authMode === 'signup' ? 'Sign Up' : authMode === 'recovery' ? 'Update Password' : 'Sign In';
  }

  function toggleAuthMode() {
    const errEl = document.getElementById('authError');
    const msgEl = document.getElementById('authMsg');
    errEl.innerHTML = '';
    msgEl.innerHTML = '';
    if (authMode === 'login') {
      authMode = 'signup';
      document.getElementById('authBtn').textContent = 'Sign Up';
      document.getElementById('authSwitchText').textContent = 'Already have an account?';
      document.getElementById('authSwitchLink').textContent = 'Sign In';
      document.getElementById('authPassword').setAttribute('autocomplete', 'new-password');
    } else {
      authMode = 'login';
      document.getElementById('authBtn').textContent = 'Sign In';
      document.getElementById('authSwitchText').textContent = "Don't have an account?";
      document.getElementById('authSwitchLink').textContent = 'Sign Up';
      document.getElementById('authPassword').setAttribute('autocomplete', 'current-password');
    }
  }

  function showPrivacy() {
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" style="max-width:520px;max-height:80vh;overflow-y:auto" aria-labelledby="modal-title-privacy">
      <h2 class="modal-title" id="modal-title-privacy">Privacy Policy</h2>
      <div style="font-size:13px;color:var(--text2);line-height:1.8">
        <p><strong>What we collect:</strong> Your email address (for authentication) and the task data you create.</p>
        <p><strong>How we store it:</strong> All data is stored securely in Supabase (hosted on AWS). Each user's data is isolated — no one else can see your tasks, boards, or AI conversations.</p>
        <p><strong>AI processing:</strong> When you use AI features, your task data is sent to Anthropic's Claude API for processing. We do not store AI conversations server-side beyond your browser's local storage.</p>
        <p><strong>What we don't do:</strong> We don't sell your data, run analytics trackers, or share information with third parties. No cookies beyond authentication.</p>
        <p><strong>Data deletion:</strong> You can export and delete all your data from Settings at any time. Contact us to delete your account entirely.</p>
        <p style="color:var(--text3);font-size:11px;margin-top:16px">Last updated: March 2026</p>
      </div>
      <button class="btn" data-action="close-modal" style="margin-top:16px">Close</button>
    </div></div>`;
  }

  function showTerms() {
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-overlay" data-action="close-modal" data-click-self="true"><div class="modal" style="max-width:520px;max-height:80vh;overflow-y:auto" aria-labelledby="modal-title-terms">
      <h2 class="modal-title" id="modal-title-terms">Terms of Service</h2>
      <div style="font-size:13px;color:var(--text2);line-height:1.8">
        <p><strong>What this is:</strong> Whiteboards is a free AI-powered productivity tool. You can use it to manage tasks, brainstorm ideas, and plan your work.</p>
        <p><strong>Your data:</strong> You own everything you create. We provide the tool; you own the content.</p>
        <p><strong>AI features:</strong> AI responses are generated by Claude (Anthropic). They may not always be accurate. Use your judgment when acting on AI suggestions.</p>
        <p><strong>Availability:</strong> We aim to keep the service running but provide no uptime guarantees. Export your data regularly as a backup.</p>
        <p><strong>Acceptable use:</strong> Don't abuse the AI proxy, attempt to access other users' data, or use the service for anything illegal.</p>
        <p style="color:var(--text3);font-size:11px;margin-top:16px">Last updated: March 2026</p>
      </div>
      <button class="btn" data-action="close-modal" style="margin-top:16px">Close</button>
    </div></div>`;
  }

  async function resendVerification(email) {
    try {
      const { error } = await sb.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      showToast('Verification email sent!');
    } catch (err) {
      showToast(err.message || 'Could not resend email', true);
    }
  }

  function showForgotPassword() {
    authMode = 'forgot';
    document.getElementById('authBtn').textContent = 'Send Reset Link';
    document.getElementById('authPassword').style.display = 'none';
    document.getElementById('authPassword').removeAttribute('required');
    document.getElementById('authSwitchText').textContent = 'Remember your password?';
    document.getElementById('authSwitchLink').textContent = 'Sign In';
    document.getElementById('authSwitchLink').onclick = () => {
      authMode = 'login';
      document.getElementById('authPassword').style.display = 'block';
      document.getElementById('authPassword').setAttribute('required', '');
      document.getElementById('authBtn').textContent = 'Sign In';
      document.getElementById('authSwitchText').textContent = "Don't have an account?";
      document.getElementById('authSwitchLink').textContent = 'Sign Up';
      document.getElementById('authSwitchLink').onclick = toggleAuthMode;
      document.getElementById('authPassword').setAttribute('autocomplete', 'current-password');
      document.getElementById('authError').innerHTML = '';
      document.getElementById('authMsg').innerHTML = '';
    };
  }

  async function signOut() {
    try {
      getSyncModule().resetSyncState();
      getSyncModule().resetSyncQueue();
      await sb.auth.signOut();
      // SIGNED_OUT handler does the cleanup
    } catch (e) {
      console.error('Sign out error:', e);
      // Still clear local auth state so user isn't stuck
      getSyncModule().resetSyncQueue();
      setCurrentUser(null);
      document.getElementById('authScreen').style.display = '';
      showToast('Signed out locally', true);
    }
  }

  return {
    showAuthFromLanding,
    initAuth,
    handleAuth,
    toggleAuthMode,
    showForgotPassword,
    showPrivacy,
    showTerms,
    resendVerification,
    signOut,
    showApp,
    showOnboarding,
    showFeatureTips,
    cleanupStaleLocalStorage,
  };
}
