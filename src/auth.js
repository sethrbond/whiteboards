// ============================================================
// AUTH MODULE
// ============================================================
// Extracted from app.js — handles authentication, onboarding, and session management

/**
 * Factory function to create auth functions.
 * @param {Object} deps - Dependencies from the main app
 * @returns {{ showAuthFromLanding, initAuth, handleAuth, toggleAuthMode, showForgotPassword, showPrivacy, showTerms, resendVerification, signOut, showApp, showOnboarding, showFeatureTips, showOnboardingExperience, cleanupStaleLocalStorage }}
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
    autoEscalatePriority,
    requestNotificationPermission,
    hasAI: _hasAI,
    processDump: _processDump,
    processDumpManual: _processDumpManual,
    getGuestMode,
    setGuestMode,
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
    // Briefing
    generateAIBriefing,
    setTodayBriefingExpanded,
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
        // Migrate guest data: if user was in guest mode, preserve their localStorage tasks
        const wasGuest = getGuestMode();
        const guestData = wasGuest ? getData() : null;
        setGuestMode(false);
        setCurrentUser(session.user);
        if (wasGuest && guestData && (guestData.tasks.length > 0 || guestData.projects.length > 1)) {
          // Re-save guest data under the new user key so it persists
          setData(guestData);
        } else {
          setData(loadData());
        }
        setSettings(loadSettings());
        loadFromCloud()
          .then(() => {
            // If migrating from guest, merge guest tasks into cloud data
            if (wasGuest && guestData && guestData.tasks.length > 0) {
              const currentData = getData();
              const existingIds = new Set(currentData.tasks.map(t => t.id));
              const newTasks = guestData.tasks.filter(t => !existingIds.has(t.id));
              if (newTasks.length > 0) {
                currentData.tasks.push(...newTasks);
                setData(currentData);
              }
            }
            showApp();
          })
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
    // Restore last view on login
    const savedView = localStorage.getItem(userKey('wb_current_view'));
    const savedProject = localStorage.getItem(userKey('wb_current_project'));
    if (savedView) {
      setCurrentView(savedView);
      if (savedProject) setCurrentProject(savedProject);
    }
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
      autoEscalatePriority();
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
    // Auto-generate daily briefing on first open of the day
    if (generateAIBriefing) {
      _idleCb(() => {
        const briefingKey = userKey('whiteboard_briefing_' + todayStr());
        if (!localStorage.getItem(briefingKey) && data.tasks.length > 0 && _hasAI()) {
          generateAIBriefing()
            .then(() => {
              if (setTodayBriefingExpanded) setTodayBriefingExpanded(true);
              render();
            })
            .catch((e) => console.warn('Auto-briefing failed:', e));
        }
      });
    }
    // Restore saved view, or default to brainstorm unless user has a daily plan
    if (!savedView) {
      setCurrentView(localStorage.getItem(userKey('whiteboard_plan_' + todayStr())) ? 'dashboard' : 'dump');
    }
    render();
    if (!localStorage.getItem(userKey('wb_onboarding_done')) && data.tasks.length === 0 && data.projects.length <= 1) {
      // Go straight to dashboard — the inline onboarding textarea handles first-time UX
      setCurrentView('dashboard');
      render();
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

  function showOnboardingExperience() {
    if (localStorage.getItem('wb_onboarding_complete')) return;
    const isMac = navigator.platform?.includes('Mac');
    const cmdKey = isMac ? '\u2318' : 'Ctrl';
    let currentScreen = 0;
    const totalScreens = 5;

    function dismiss() {
      localStorage.setItem('wb_onboarding_complete', '1');
      const overlay = document.getElementById('onbOverlay');
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay.parentNode) overlay.remove();
        }, 300);
      }
      // Clean up keyboard listener
      document.removeEventListener('keydown', onbKeyHandler);
    }

    function goToScreen(idx) {
      if (idx < 0 || idx >= totalScreens) return;
      currentScreen = idx;
      const screens = document.querySelectorAll('.onb-screen');
      screens.forEach((s, i) => {
        s.classList.toggle('onb-active', i === idx);
      });
      const dots = document.querySelectorAll('.onb-dot');
      dots.forEach((d, i) => {
        d.classList.toggle('onb-dot-active', i === idx);
      });
    }

    function nextScreen() {
      if (currentScreen < totalScreens - 1) {
        goToScreen(currentScreen + 1);
      }
    }

    function onbKeyHandler(e) {
      if (!document.getElementById('onbOverlay')) {
        document.removeEventListener('keydown', onbKeyHandler);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (currentScreen < totalScreens - 1) nextScreen();
        else dismiss();
      }
    }

    document.addEventListener('keydown', onbKeyHandler);

    const dotsHTML = Array.from(
      { length: totalScreens },
      (_, i) => '<div class="onb-dot' + (i === 0 ? ' onb-dot-active' : '') + '"></div>',
    ).join('');

    const overlay = document.createElement('div');
    overlay.id = 'onbOverlay';
    overlay.className = 'onb-overlay';
    overlay.style.transition = 'opacity 300ms';
    overlay.innerHTML =
      '<button class="onb-skip" data-action="onb-skip">Skip tour</button>' +
      // Screen 1: Welcome
      '<div class="onb-screen onb-active">' +
      '<div class="onb-logo">W</div>' +
      '<div class="onb-tagline">Your AI-powered second brain</div>' +
      '<button class="onb-btn-primary" data-action="onb-next">Let\u2019s go \u2192</button>' +
      '</div>' +
      // Screen 2: Brain dump
      '<div class="onb-screen">' +
      '<div class="onb-title">Brain dump anything</div>' +
      '<div class="onb-mock-textarea">' +
      '<span class="onb-typewriter">Meeting with Sarah tomorrow, finalize Q2 budget by Friday, follow up with design team...</span>' +
      '</div>' +
      '<div class="onb-task-cards">' +
      '<div class="onb-task-card">\u2713 Meeting with Sarah \u00b7 Tomorrow</div>' +
      '<div class="onb-task-card">\u25CB Finalize Q2 budget \u00b7 Friday</div>' +
      '<div class="onb-task-card">\u25CB Follow up with design team</div>' +
      '</div>' +
      '<div class="onb-caption">Paste chaos. AI extracts tasks instantly.</div>' +
      '<button class="onb-btn-primary" data-action="onb-next" style="margin-top:20px">Next \u2192</button>' +
      '</div>' +
      // Screen 3: AI chat
      '<div class="onb-screen">' +
      '<div class="onb-title">AI that works with you</div>' +
      '<div class="onb-chat-mock">' +
      '<div class="onb-chat-bubble onb-chat-user">Plan my week</div>' +
      '<div class="onb-chat-bubble onb-chat-ai">Here\u2019s your plan based on deadlines and priorities\u2026<br><br>\u2022 Monday: Finalize Q2 budget<br>\u2022 Tuesday: Design team follow-up<br>\u2022 Wednesday: Sarah meeting prep</div>' +
      '</div>' +
      '<div class="onb-caption">Chat naturally. Your assistant knows your context.</div>' +
      '<button class="onb-btn-primary" data-action="onb-next" style="margin-top:20px">Next \u2192</button>' +
      '</div>' +
      // Screen 4: Stay on track
      '<div class="onb-screen">' +
      '<div class="onb-title">Stay on track</div>' +
      '<div class="onb-briefing-mock">' +
      '<div class="onb-briefing-title">\u2600\uFE0F Good morning</div>' +
      '<div class="onb-briefing-item">\u2022 3 tasks due today</div>' +
      '<div class="onb-briefing-item">\u2022 Q2 budget is high priority</div>' +
      '<div class="onb-briefing-item">\u2022 You completed 5 tasks yesterday \u2014 nice!</div>' +
      '</div>' +
      '<div class="onb-notif-mock">\uD83D\uDD14 Reminder: Sarah meeting in 30 minutes</div>' +
      '<div class="onb-caption">Daily plans, smart nudges, and focus mode keep you moving.</div>' +
      '<button class="onb-btn-primary" data-action="onb-next" style="margin-top:20px">Next \u2192</button>' +
      '</div>' +
      // Screen 5: Ready
      '<div class="onb-screen">' +
      '<div class="onb-title">You\u2019re ready</div>' +
      '<div class="onb-subtitle">Choose how you\u2019d like to start</div>' +
      '<div class="onb-ready-btns">' +
      '<button class="onb-btn-primary" data-action="onb-brainstorm" style="opacity:1;animation:none">Start with a brain dump \u2192</button>' +
      '<button class="onb-btn-secondary" data-action="onb-explore">Explore on my own</button>' +
      '</div>' +
      '<div class="onb-tip">' +
      cmdKey +
      'K for commands, ' +
      cmdKey +
      'J for AI chat</div>' +
      '</div>' +
      '<div class="onb-dots">' +
      dotsHTML +
      '</div>';

    document.body.appendChild(overlay);
  }

  // Legacy alias — keeps old call sites working
  function showFeatureTips() {
    showOnboardingExperience();
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
      // Flush pending data to cloud BEFORE purging localStorage
      try { await getSyncModule().syncToCloud(); } catch (_) { /* best effort */ }
      getSyncModule().resetSyncState();
      getSyncModule().resetSyncQueue();
      await sb.auth.signOut();
      // SIGNED_OUT handler does the cleanup
    } catch (e) {
      console.error('Sign out error:', e);
      // Full cleanup so user isn't stuck — mirror SIGNED_OUT handler
      setCurrentUser(null);
      setData({ tasks: [], projects: [] });
      getChatModule().resetChatState();
      setSettings({ ...DEFAULT_SETTINGS });
      setCurrentView('dump');
      document.querySelector('.sidebar').style.display = 'none';
      document.querySelector('.main').style.display = 'none';
      document.getElementById('chatToggle').style.display = 'none';
      const lp = document.getElementById('landingPage');
      if (lp) lp.style.display = '';
      document.getElementById('authScreen').style.display = '';
      showToast('Signed out');
    }
  }

  /**
   * Enter guest mode — show the app without authentication.
   * Data is stored in localStorage only (no cloud sync).
   */
  function enterGuestMode() {
    _dismissSplash();
    setGuestMode(true);
    setCurrentUser(null);
    setData(loadData());
    setSettings(loadSettings());
    // Show the app UI
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = 'none';
    document.getElementById('authScreen').style.display = 'none';
    const sidebarEl = document.querySelector('.sidebar');
    sidebarEl.style.display = '';
    document.querySelector('.main').style.display = '';
    // Hide chat toggle in guest mode (no AI chat without auth)
    document.getElementById('chatToggle').style.display = 'none';
    ensureLifeProject();
    // Default to dashboard — the onboarding hero will show since there are no tasks
    setCurrentView('dashboard');
    render();
  }

  /**
   * Show a gentle sign-up nudge after brainstorm completes in guest mode.
   * Non-blocking — user can dismiss and keep using the app.
   */
  function showSignUpNudge() {
    if (!getGuestMode()) return;
    if (localStorage.getItem('wb_signup_nudge_dismissed')) return;
    const root = document.getElementById('modalRoot');
    if (!root) return;
    root.innerHTML = `<div class="modal-overlay" data-action="close-modal" data-click-self="true">
      <div class="modal" style="max-width:420px;text-align:center;padding:32px" aria-labelledby="modal-title-signup-nudge">
        <div style="font-size:32px;margin-bottom:12px" aria-hidden="true">&#x2728;</div>
        <h2 id="modal-title-signup-nudge" style="font-size:18px;font-weight:600;margin:0 0 8px">Your tasks are ready!</h2>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:24px">
          Sign up to sync across devices, get daily AI briefings, and never lose your work.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-primary" data-action="guest-signup" style="padding:12px 24px;font-size:14px">Create free account</button>
          <button class="btn" data-action="guest-signup-dismiss" style="font-size:13px;color:var(--text3)">Maybe later</button>
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:16px">Your tasks are saved locally and will be migrated to your account.</p>
      </div>
    </div>`;
  }

  return {
    showAuthFromLanding,
    enterGuestMode,
    showSignUpNudge,
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
    showOnboardingExperience,
    cleanupStaleLocalStorage,
  };
}
