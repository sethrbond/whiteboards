import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuth } from '../auth.js';

function makeDeps(overrides = {}) {
  return {
    sb: null,
    esc: vi.fn((s) => (s == null ? '' : String(s))),
    todayStr: vi.fn(() => '2026-03-15'),
    userKey: vi.fn((k) => `user1_${k}`),
    DEFAULT_SETTINGS: { aiModel: 'claude-haiku-4-5-20251001', apiKey: '' },
    render: vi.fn(),
    showToast: vi.fn(),
    loadData: vi.fn(() => ({ tasks: [], projects: [] })),
    loadSettings: vi.fn(() => ({ aiModel: 'claude-haiku-4-5-20251001', apiKey: '' })),
    loadFromCloud: vi.fn(async () => {}),
    ensureLifeProject: vi.fn(),
    processRecurringTasks: vi.fn(),
    cleanupArchive: vi.fn(),
    autoEscalatePriority: vi.fn(),
    requestNotificationPermission: vi.fn(),
    hasAI: vi.fn(() => false),
    processDump: vi.fn(async () => {}),
    processDumpManual: vi.fn(),
    getData: vi.fn(() => ({ tasks: [], projects: [] })),
    getCurrentUser: vi.fn(() => null),
    setCurrentUser: vi.fn(),
    setData: vi.fn(),
    setSettings: vi.fn(),
    setCurrentView: vi.fn(),
    setCurrentProject: vi.fn(),
    setExpandedTask: vi.fn(),
    setProactiveLog: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    setBulkMode: vi.fn(),
    setBulkSelected: vi.fn(),
    setNudgeFilter: vi.fn(),
    setShowTagFilter: vi.fn(),
    setBriefingGenerating: vi.fn(),
    setPlanGenerating: vi.fn(),
    setDataVersion: vi.fn(),
    setRenderCache: vi.fn(),
    setTaskMapState: vi.fn(),
    clearUndoStack: vi.fn(),
    getSyncModule: vi.fn(() => ({
      getSyncStatus: vi.fn(() => 'synced'),
      resetSyncState: vi.fn(),
      resetSyncQueue: vi.fn(),
    })),
    getChatModule: vi.fn(() => ({
      resetChatState: vi.fn(),
      reloadChatHistory: vi.fn(),
    })),
    getFocusModule: vi.fn(() => ({
      resetFocusState: vi.fn(),
    })),
    ...overrides,
  };
}

function makeSbMock(overrides = {}) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(),
      signUp: vi.fn(async () => ({ data: {}, error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({})),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      resend: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  };
}

describe('auth.js — createAuth()', () => {
  let auth;
  let deps;

  beforeEach(() => {
    localStorage.clear();
    // Reset the DOM to minimal state from setup.js
    document.getElementById('modalRoot').innerHTML = '';
    document.getElementById('authError').innerHTML = '';
    document.getElementById('authMsg').innerHTML = '';
    document.getElementById('authBtn').textContent = 'Sign In';
    document.getElementById('authBtn').disabled = false;
    document.getElementById('authPassword').style.display = '';
    document.getElementById('authPassword').setAttribute('required', '');
    deps = makeDeps();
    auth = createAuth(deps);
  });

  afterEach(() => {
    // Clean up any globals set by feature tips
    delete window._nextTip;
  });

  // ── Factory returns ─────────────────────────────────────────────────
  it('returns all expected functions', () => {
    const keys = [
      'showAuthFromLanding',
      'initAuth',
      'handleAuth',
      'toggleAuthMode',
      'showForgotPassword',
      'showPrivacy',
      'showTerms',
      'resendVerification',
      'signOut',
      'showApp',
      'showOnboarding',
      'showFeatureTips',
      'cleanupStaleLocalStorage',
    ];
    keys.forEach((k) => expect(typeof auth[k]).toBe('function'));
  });

  // ── toggleAuthMode ────────────────────────────────────────────────
  it('toggleAuthMode switches from login to signup', () => {
    auth.toggleAuthMode();
    const btn = document.getElementById('authBtn');
    expect(btn.textContent).toBe('Sign Up');
    const switchText = document.getElementById('authSwitchText');
    expect(switchText.textContent).toBe('Already have an account?');
  });

  it('toggleAuthMode switches from signup back to login', () => {
    auth.toggleAuthMode(); // -> signup
    auth.toggleAuthMode(); // -> login
    const btn = document.getElementById('authBtn');
    expect(btn.textContent).toBe('Sign In');
    const switchText = document.getElementById('authSwitchText');
    expect(switchText.textContent).toBe("Don't have an account?");
  });

  it('toggleAuthMode clears error and message elements', () => {
    document.getElementById('authError').innerHTML = '<div>Error</div>';
    document.getElementById('authMsg').innerHTML = '<div>Message</div>';
    auth.toggleAuthMode();
    expect(document.getElementById('authError').innerHTML).toBe('');
    expect(document.getElementById('authMsg').innerHTML).toBe('');
  });

  it('toggleAuthMode sets autocomplete to new-password for signup', () => {
    auth.toggleAuthMode(); // -> signup
    expect(document.getElementById('authPassword').getAttribute('autocomplete')).toBe('new-password');
  });

  it('toggleAuthMode sets autocomplete to current-password for login', () => {
    auth.toggleAuthMode(); // -> signup
    auth.toggleAuthMode(); // -> login
    expect(document.getElementById('authPassword').getAttribute('autocomplete')).toBe('current-password');
  });

  it('toggleAuthMode sets switch link text to Sign In for signup mode', () => {
    auth.toggleAuthMode(); // -> signup
    expect(document.getElementById('authSwitchLink').textContent).toBe('Sign In');
  });

  it('toggleAuthMode sets switch link text to Sign Up for login mode', () => {
    auth.toggleAuthMode(); // -> signup
    auth.toggleAuthMode(); // -> login
    expect(document.getElementById('authSwitchLink').textContent).toBe('Sign Up');
  });

  // ── showAuthFromLanding ───────────────────────────────────────────
  it('showAuthFromLanding in login mode sets Sign In button text', () => {
    auth.showAuthFromLanding('login');
    expect(document.getElementById('authBtn').textContent).toBe('Sign In');
    expect(document.getElementById('authScreen').style.display).toBe('flex');
  });

  it('showAuthFromLanding in signup mode sets Create Account button text', () => {
    auth.showAuthFromLanding('signup');
    expect(document.getElementById('authBtn').textContent).toBe('Create Account');
  });

  it('showAuthFromLanding hides the landing page', () => {
    auth.showAuthFromLanding('login');
    const landing = document.getElementById('landingPage');
    expect(landing.classList.contains('hidden')).toBe(true);
  });

  it('showAuthFromLanding sets switch text for login mode', () => {
    auth.showAuthFromLanding('login');
    expect(document.getElementById('authSwitchText').textContent).toBe("Don't have an account?");
    expect(document.getElementById('authSwitchLink').textContent).toBe('Sign Up');
  });

  it('showAuthFromLanding sets switch text for signup mode', () => {
    auth.showAuthFromLanding('signup');
    expect(document.getElementById('authSwitchText').textContent).toBe('Already have an account?');
    expect(document.getElementById('authSwitchLink').textContent).toBe('Sign In');
  });

  // ── showPrivacy ───────────────────────────────────────────────────
  it('showPrivacy renders privacy policy in modal', () => {
    auth.showPrivacy();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Privacy Policy');
    expect(modal.innerHTML).toContain('What we collect');
  });

  it('showPrivacy includes AI processing section', () => {
    auth.showPrivacy();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('AI processing');
  });

  it('showPrivacy includes data deletion info', () => {
    auth.showPrivacy();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Data deletion');
  });

  it('showPrivacy includes close button', () => {
    auth.showPrivacy();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('close-modal');
  });

  // ── showTerms ─────────────────────────────────────────────────────
  it('showTerms renders terms of service in modal', () => {
    auth.showTerms();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Terms of Service');
    expect(modal.innerHTML).toContain('Your data');
  });

  it('showTerms includes acceptable use section', () => {
    auth.showTerms();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Acceptable use');
  });

  it('showTerms includes AI features section', () => {
    auth.showTerms();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('AI features');
  });

  // ── showForgotPassword ────────────────────────────────────────────
  it('showForgotPassword changes button to Send Reset Link', () => {
    auth.showForgotPassword();
    expect(document.getElementById('authBtn').textContent).toBe('Send Reset Link');
  });

  it('showForgotPassword hides the password field', () => {
    auth.showForgotPassword();
    expect(document.getElementById('authPassword').style.display).toBe('none');
  });

  it('showForgotPassword removes required from password', () => {
    auth.showForgotPassword();
    expect(document.getElementById('authPassword').hasAttribute('required')).toBe(false);
  });

  it('showForgotPassword sets switch text to remember password', () => {
    auth.showForgotPassword();
    expect(document.getElementById('authSwitchText').textContent).toBe('Remember your password?');
    expect(document.getElementById('authSwitchLink').textContent).toBe('Sign In');
  });

  it('showForgotPassword back-to-sign-in link restores login mode', () => {
    auth.showForgotPassword();
    // Click the sign-in link to go back
    document.getElementById('authSwitchLink').onclick();
    expect(document.getElementById('authBtn').textContent).toBe('Sign In');
    expect(document.getElementById('authPassword').style.display).toBe('block');
    expect(document.getElementById('authPassword').hasAttribute('required')).toBe(true);
    expect(document.getElementById('authSwitchText').textContent).toBe("Don't have an account?");
    expect(document.getElementById('authSwitchLink').textContent).toBe('Sign Up');
  });

  it('showForgotPassword back-to-sign-in clears error/msg', () => {
    auth.showForgotPassword();
    document.getElementById('authError').innerHTML = '<div>Error</div>';
    document.getElementById('authMsg').innerHTML = '<div>Msg</div>';
    document.getElementById('authSwitchLink').onclick();
    expect(document.getElementById('authError').innerHTML).toBe('');
    expect(document.getElementById('authMsg').innerHTML).toBe('');
  });

  // ── cleanupStaleLocalStorage ──────────────────────────────────────
  it('cleanupStaleLocalStorage removes stale briefing keys', () => {
    localStorage.setItem('whiteboard_briefing_2026-03-14', 'old');
    localStorage.setItem('whiteboard_briefing_2026-03-15', 'today');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('whiteboard_briefing_2026-03-14')).toBeNull();
    expect(localStorage.getItem('whiteboard_briefing_2026-03-15')).toBe('today');
  });

  it('cleanupStaleLocalStorage removes stale plan keys', () => {
    localStorage.setItem('whiteboard_plan_2026-03-10', 'old plan');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('whiteboard_plan_2026-03-10')).toBeNull();
  });

  it('cleanupStaleLocalStorage keeps non-prefixed keys', () => {
    localStorage.setItem('some_other_key', 'keep me');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('some_other_key')).toBe('keep me');
  });

  it('cleanupStaleLocalStorage removes stale eod keys', () => {
    localStorage.setItem('wb_eod_2026-03-13', 'old eod');
    localStorage.setItem('wb_eod_2026-03-15', 'today eod');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('wb_eod_2026-03-13')).toBeNull();
    expect(localStorage.getItem('wb_eod_2026-03-15')).toBe('today eod');
  });

  it('cleanupStaleLocalStorage removes stale proactive keys', () => {
    localStorage.setItem('whiteboard_proactive_2026-03-12', 'old proactive');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('whiteboard_proactive_2026-03-12')).toBeNull();
  });

  it('cleanupStaleLocalStorage removes stale review keys', () => {
    localStorage.setItem('whiteboard_review_2026-03-11', 'old review');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('whiteboard_review_2026-03-11')).toBeNull();
  });

  it('cleanupStaleLocalStorage does not remove keys with today date across all prefixes', () => {
    localStorage.setItem('whiteboard_briefing_2026-03-15', 'today briefing');
    localStorage.setItem('whiteboard_plan_2026-03-15', 'today plan');
    localStorage.setItem('wb_eod_2026-03-15', 'today eod');
    localStorage.setItem('whiteboard_proactive_2026-03-15', 'today proactive');
    localStorage.setItem('whiteboard_review_2026-03-15', 'today review');
    auth.cleanupStaleLocalStorage();
    expect(localStorage.getItem('whiteboard_briefing_2026-03-15')).toBe('today briefing');
    expect(localStorage.getItem('whiteboard_plan_2026-03-15')).toBe('today plan');
    expect(localStorage.getItem('wb_eod_2026-03-15')).toBe('today eod');
    expect(localStorage.getItem('whiteboard_proactive_2026-03-15')).toBe('today proactive');
    expect(localStorage.getItem('whiteboard_review_2026-03-15')).toBe('today review');
  });

  // ── initAuth ──────────────────────────────────────────────────────
  it('initAuth shows error when sb is null', async () => {
    await auth.initAuth();
    const errEl = document.getElementById('authError');
    expect(errEl.innerHTML).toContain('Failed to load');
  });

  it('initAuth with session calls showApp flow', async () => {
    const sb = makeSbMock({
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'a@b.com' } } } })),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    expect(deps.setCurrentUser).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.com' });
    expect(deps.setData).toHaveBeenCalled();
    expect(deps.setSettings).toHaveBeenCalled();
    expect(deps.loadFromCloud).toHaveBeenCalled();
  });

  it('initAuth with no session does not call showApp', async () => {
    const sb = makeSbMock();
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    expect(deps.setCurrentUser).not.toHaveBeenCalled();
    expect(deps.ensureLifeProject).not.toHaveBeenCalled();
  });

  it('initAuth shows error when getSession throws', async () => {
    const sb = makeSbMock({
      getSession: vi.fn(async () => {
        throw new Error('Network fail');
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    expect(document.getElementById('authError').innerHTML).toContain('Could not connect');
  });

  it('initAuth registers onAuthStateChange callback', async () => {
    const sb = makeSbMock();
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    expect(sb.auth.onAuthStateChange).toHaveBeenCalled();
  });

  it('initAuth onAuthStateChange SIGNED_IN loads data when not yet initialized', async () => {
    const sb = makeSbMock();
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    // Trigger SIGNED_IN
    await authCallback('SIGNED_IN', { user: { id: 'u2', email: 'b@c.com' } });
    expect(deps.setCurrentUser).toHaveBeenCalledWith({ id: 'u2', email: 'b@c.com' });
    expect(deps.loadData).toHaveBeenCalled();
  });

  it('initAuth onAuthStateChange SIGNED_IN skips if already initialized via getSession', async () => {
    const sb = makeSbMock({
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
    });
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    // setCurrentUser was called once during getSession flow
    const callCount = deps.setCurrentUser.mock.calls.length;
    authCallback('SIGNED_IN', { user: { id: 'u1' } });
    // Should not have been called again
    expect(deps.setCurrentUser.mock.calls.length).toBe(callCount);
  });

  it('initAuth onAuthStateChange PASSWORD_RECOVERY shows recovery form', async () => {
    const sb = makeSbMock();
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    authCallback('PASSWORD_RECOVERY', null);
    expect(document.getElementById('authBtn').textContent).toBe('Update Password');
    expect(document.getElementById('authMsg').innerHTML).toContain('Set your new password');
  });

  it('initAuth onAuthStateChange SIGNED_OUT clears state', async () => {
    const sb = makeSbMock();
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    const chatModule = { resetChatState: vi.fn(), reloadChatHistory: vi.fn() };
    const syncModule = { getSyncStatus: vi.fn(() => 'synced'), resetSyncState: vi.fn(), resetSyncQueue: vi.fn() };
    const focusModule = { resetFocusState: vi.fn() };
    deps = makeDeps({
      sb,
      getChatModule: vi.fn(() => chatModule),
      getSyncModule: vi.fn(() => syncModule),
      getFocusModule: vi.fn(() => focusModule),
    });
    auth = createAuth(deps);
    await auth.initAuth();
    authCallback('SIGNED_OUT', null);
    expect(deps.setCurrentUser).toHaveBeenCalledWith(null);
    expect(deps.setData).toHaveBeenCalledWith({ tasks: [], projects: [] });
    expect(chatModule.resetChatState).toHaveBeenCalled();
    expect(deps.clearUndoStack).toHaveBeenCalled();
    expect(deps.setCurrentView).toHaveBeenCalledWith('dump');
    expect(deps.setBulkMode).toHaveBeenCalledWith(false);
    expect(syncModule.resetSyncState).toHaveBeenCalled();
  });

  it('initAuth onAuthStateChange SIGNED_OUT purges user localStorage keys', async () => {
    const sb = makeSbMock();
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    const syncModule = { getSyncStatus: vi.fn(() => 'synced'), resetSyncState: vi.fn(), resetSyncQueue: vi.fn() };
    deps = makeDeps({
      sb,
      getCurrentUser: vi.fn(() => ({ id: 'user123' })),
      getSyncModule: vi.fn(() => syncModule),
    });
    auth = createAuth(deps);
    await auth.initAuth();
    localStorage.setItem('wb_user123_data', 'some data');
    localStorage.setItem('wb_user123_settings', 'some settings');
    localStorage.setItem('unrelated_key', 'keep');
    authCallback('SIGNED_OUT', null);
    expect(localStorage.getItem('wb_user123_data')).toBeNull();
    expect(localStorage.getItem('wb_user123_settings')).toBeNull();
    expect(localStorage.getItem('unrelated_key')).toBe('keep');
  });

  it('initAuth onAuthStateChange SIGNED_OUT warns if sync not confirmed', async () => {
    const sb = makeSbMock();
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    const syncModule = { getSyncStatus: vi.fn(() => 'pending'), resetSyncState: vi.fn(), resetSyncQueue: vi.fn() };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps = makeDeps({
      sb,
      getCurrentUser: vi.fn(() => ({ id: 'u1' })),
      getSyncModule: vi.fn(() => syncModule),
    });
    auth = createAuth(deps);
    await auth.initAuth();
    authCallback('SIGNED_OUT', null);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('localStorage purged'));
    warnSpy.mockRestore();
  });

  // ── handleAuth ────────────────────────────────────────────────────
  it('handleAuth in forgot mode sends reset email', async () => {
    const sb = makeSbMock();
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.showForgotPassword();
    document.getElementById('authEmail').value = 'test@example.com';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.com', expect.any(Object));
    expect(document.getElementById('authMsg').innerHTML).toContain('Check your email');
  });

  it('handleAuth in forgot mode shows error on failure', async () => {
    const sb = makeSbMock({
      resetPasswordForEmail: vi.fn(async () => ({ error: { message: 'rate limit exceeded' } })),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.showForgotPassword();
    document.getElementById('authEmail').value = 'test@example.com';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authError').innerHTML).toContain('Please wait a few seconds');
  });

  it('handleAuth in recovery mode updates password', async () => {
    const sb = makeSbMock();
    let authCallback;
    sb.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb;
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.initAuth();
    // Trigger recovery mode via auth state change
    authCallback('PASSWORD_RECOVERY', null);
    document.getElementById('authPassword').value = 'newpass123';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
    expect(document.getElementById('authMsg').innerHTML).toContain('Password updated');
  });

  it('handleAuth in signup mode calls signUp', async () => {
    const sb = makeSbMock({
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.toggleAuthMode(); // switch to signup
    document.getElementById('authEmail').value = 'new@user.com';
    document.getElementById('authPassword').value = 'pass123';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(sb.auth.signUp).toHaveBeenCalled();
    expect(document.getElementById('authMsg').innerHTML).toContain('Check your email to confirm');
  });

  it('handleAuth in signup mode shows resend button when no session returned', async () => {
    const sb = makeSbMock({
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.toggleAuthMode(); // signup
    document.getElementById('authEmail').value = 'new@user.com';
    document.getElementById('authPassword').value = 'pass123';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authMsg').innerHTML).toContain('resend-verification');
  });

  it('handleAuth in login mode calls signInWithPassword', async () => {
    const sb = makeSbMock();
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    document.getElementById('authEmail').value = 'user@test.com';
    document.getElementById('authPassword').value = 'password';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@test.com', password: 'password' });
  });

  it('handleAuth shows friendly error for Invalid login', async () => {
    const sb = makeSbMock({
      signInWithPassword: vi.fn(async () => {
        throw { message: 'Invalid login credentials' };
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    document.getElementById('authEmail').value = 'user@test.com';
    document.getElementById('authPassword').value = 'wrong';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authError').innerHTML).toContain('Wrong email or password');
  });

  it('handleAuth shows friendly error for already registered', async () => {
    const sb = makeSbMock({
      signUp: vi.fn(async () => {
        throw { message: 'User already registered' };
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.toggleAuthMode(); // signup
    document.getElementById('authEmail').value = 'existing@user.com';
    document.getElementById('authPassword').value = 'pass123';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authError').innerHTML).toContain('already registered');
  });

  it('handleAuth shows friendly error for short password', async () => {
    const sb = makeSbMock({
      signUp: vi.fn(async () => {
        throw { message: 'Password should be at least 6 characters' };
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.toggleAuthMode();
    document.getElementById('authEmail').value = 'a@b.com';
    document.getElementById('authPassword').value = 'ab';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authError').innerHTML).toContain('at least 6 characters');
  });

  it('handleAuth shows friendly error for invalid email', async () => {
    const sb = makeSbMock({
      signInWithPassword: vi.fn(async () => {
        throw { message: 'Please provide a valid email' };
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    document.getElementById('authEmail').value = 'notanemail';
    document.getElementById('authPassword').value = 'pass';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authError').innerHTML).toContain('valid email');
  });

  it('handleAuth re-enables button after completion', async () => {
    const sb = makeSbMock();
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    document.getElementById('authEmail').value = 'user@test.com';
    document.getElementById('authPassword').value = 'pass';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authBtn').disabled).toBe(false);
    expect(document.getElementById('authBtn').textContent).toBe('Sign In');
  });

  it('handleAuth sets button text based on current mode after error', async () => {
    const sb = makeSbMock({
      signUp: vi.fn(async () => {
        throw { message: 'some error' };
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.toggleAuthMode(); // signup
    document.getElementById('authEmail').value = 'a@b.com';
    document.getElementById('authPassword').value = 'pass';
    await auth.handleAuth({ preventDefault: vi.fn() });
    expect(document.getElementById('authBtn').textContent).toBe('Sign Up');
  });

  // ── resendVerification ─────────────────────────────────────────────
  it('resendVerification sends email and shows toast', async () => {
    const sb = makeSbMock();
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.resendVerification('test@example.com');
    expect(sb.auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'test@example.com',
      options: expect.objectContaining({ emailRedirectTo: expect.any(String) }),
    });
    expect(deps.showToast).toHaveBeenCalledWith('Verification email sent!');
  });

  it('resendVerification shows error toast on failure', async () => {
    const sb = makeSbMock({
      resend: vi.fn(async () => ({ error: { message: 'Rate limited' } })),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.resendVerification('test@example.com');
    expect(deps.showToast).toHaveBeenCalledWith('Rate limited', true);
  });

  it('resendVerification handles error without message', async () => {
    const sb = makeSbMock({
      resend: vi.fn(async () => {
        throw {};
      }),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    await auth.resendVerification('test@example.com');
    expect(deps.showToast).toHaveBeenCalledWith('Could not resend email', true);
  });

  // ── showFeatureTips ───────────────────────────────────────────────
  it('showFeatureTips does nothing if tips were already seen', () => {
    localStorage.setItem('user1_wb_tips_seen', '1');
    document.getElementById('modalRoot').innerHTML = '';
    auth.showFeatureTips();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toBe('');
  });

  it('showFeatureTips renders tip modal when tips not seen', () => {
    auth.showFeatureTips();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toContain('Dump your chaos');
  });

  it('showFeatureTips marks tips as seen in localStorage', () => {
    auth.showFeatureTips();
    expect(localStorage.getItem('user1_wb_tips_seen')).toBe('1');
  });

  it('showFeatureTips _nextTip advances through tips', () => {
    auth.showFeatureTips();
    expect(document.getElementById('modalRoot').innerHTML).toContain('Dump your chaos');
    window._nextTip();
    expect(document.getElementById('modalRoot').innerHTML).toContain('AI Chat Assistant');
    window._nextTip();
    expect(document.getElementById('modalRoot').innerHTML).toContain('Command Palette');
    window._nextTip();
    expect(document.getElementById('modalRoot').innerHTML).toContain('Focus Mode');
    window._nextTip();
    expect(document.getElementById('modalRoot').innerHTML).toContain('Keyboard Shortcuts');
  });

  it('showFeatureTips _nextTip clears modal after last tip', () => {
    auth.showFeatureTips();
    window._nextTip(); // -> AI Chat
    window._nextTip(); // -> Command Palette
    window._nextTip(); // -> Focus Mode
    window._nextTip(); // -> Keyboard Shortcuts
    window._nextTip(); // -> past end
    expect(document.getElementById('modalRoot').innerHTML).toBe('');
    expect(window._nextTip).toBeUndefined();
  });

  it('showFeatureTips shows tip counter in button', () => {
    auth.showFeatureTips();
    expect(document.getElementById('modalRoot').innerHTML).toContain('1/5');
  });

  it('showFeatureTips last tip shows Got it! instead of Next', () => {
    auth.showFeatureTips();
    window._nextTip();
    window._nextTip();
    window._nextTip();
    window._nextTip(); // on last tip
    expect(document.getElementById('modalRoot').innerHTML).toContain('Got it!');
  });

  // ── showOnboarding ────────────────────────────────────────────────
  it('showOnboarding sets onboarding started flag', () => {
    auth.showOnboarding();
    expect(localStorage.getItem('user1_wb_onboarding_started')).toBe('true');
  });

  it('showOnboarding navigates to brainstorm (dump) view', () => {
    auth.showOnboarding();
    expect(deps.setCurrentView).toHaveBeenCalledWith('dump');
  });

  it('showOnboarding sets onboarding hint flag', () => {
    auth.showOnboarding();
    expect(localStorage.getItem('user1_wb_onboarding_hint')).toBe('true');
  });

  it('showOnboarding calls render', () => {
    auth.showOnboarding();
    expect(deps.render).toHaveBeenCalled();
  });

  it('showOnboarding does not render a modal', () => {
    auth.showOnboarding();
    const modal = document.getElementById('modalRoot');
    expect(modal.innerHTML).toBe('');
  });

  // ── signOut ───────────────────────────────────────────────────────
  it('signOut resets sync state even when sb is null', async () => {
    const syncModule = { resetSyncState: vi.fn(), resetSyncQueue: vi.fn() };
    deps.getSyncModule.mockReturnValue(syncModule);
    deps.setCurrentUser = vi.fn();
    auth = createAuth(deps);
    await auth.signOut();
    expect(syncModule.resetSyncState).toHaveBeenCalled();
    expect(syncModule.resetSyncQueue).toHaveBeenCalled();
  });

  it('signOut calls sb.auth.signOut when available', async () => {
    const sb = makeSbMock();
    const syncModule = { resetSyncState: vi.fn(), resetSyncQueue: vi.fn() };
    deps = makeDeps({ sb, getSyncModule: vi.fn(() => syncModule) });
    auth = createAuth(deps);
    await auth.signOut();
    expect(sb.auth.signOut).toHaveBeenCalled();
    expect(syncModule.resetSyncState).toHaveBeenCalled();
    expect(syncModule.resetSyncQueue).toHaveBeenCalled();
  });

  it('signOut handles error from sb.auth.signOut gracefully', async () => {
    const sb = makeSbMock({
      signOut: vi.fn(async () => {
        throw new Error('signout error');
      }),
    });
    const syncModule = { resetSyncState: vi.fn(), resetSyncQueue: vi.fn() };
    deps = makeDeps({ sb, getSyncModule: vi.fn(() => syncModule) });
    auth = createAuth(deps);
    await auth.signOut();
    // Should still clear user and show toast
    expect(deps.setCurrentUser).toHaveBeenCalledWith(null);
    expect(deps.showToast).toHaveBeenCalledWith('Signed out');
  });

  // ── showApp ──────────────────────────────────────────────────────
  it('showApp hides auth screen and shows sidebar/main', () => {
    const sb = makeSbMock({
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
    });
    deps = makeDeps({ sb });
    auth = createAuth(deps);
    auth.showApp();
    expect(document.getElementById('authScreen').style.display).toBe('none');
    expect(document.querySelector('.sidebar').style.display).toBe('');
    expect(document.querySelector('.main').style.display).toBe('');
  });

  it('showApp sets sidebar collapsed state from localStorage', () => {
    localStorage.setItem('user1_wb_sidebar_collapsed', 'true');
    auth.showApp();
    expect(deps.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it('showApp sets sidebar collapsed to false when not set', () => {
    auth.showApp();
    expect(deps.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it('showApp calls ensureLifeProject', () => {
    auth.showApp();
    expect(deps.ensureLifeProject).toHaveBeenCalled();
  });

  it('showApp calls render', () => {
    auth.showApp();
    expect(deps.render).toHaveBeenCalled();
  });

  it('showApp defaults to dump view when no plan exists', () => {
    auth.showApp();
    expect(deps.setCurrentView).toHaveBeenCalledWith('dump');
  });

  it('showApp defaults to dashboard view when plan exists for today', () => {
    localStorage.setItem('user1_whiteboard_plan_2026-03-15', 'plan data');
    auth.showApp();
    expect(deps.setCurrentView).toHaveBeenCalledWith('dashboard');
  });

  it('showApp triggers onboarding for new users with no tasks', () => {
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    auth = createAuth(deps);
    auth.showApp();
    // Onboarding now redirects to brainstorm with hint instead of modal
    expect(localStorage.getItem('user1_wb_onboarding_hint')).toBe('true');
    expect(deps.setCurrentView).toHaveBeenCalledWith('dump');
  });

  it('showApp does not show onboarding if already done', () => {
    localStorage.setItem('user1_wb_onboarding_done', 'true');
    deps.getData.mockReturnValue({ tasks: [], projects: [] });
    auth = createAuth(deps);
    auth.showApp();
    expect(localStorage.getItem('user1_wb_onboarding_hint')).toBeNull();
  });

  it('showApp does not show onboarding if user has tasks', () => {
    deps.getData.mockReturnValue({ tasks: [{ id: 't1' }], projects: [] });
    auth = createAuth(deps);
    auth.showApp();
    expect(localStorage.getItem('user1_wb_onboarding_hint')).toBeNull();
  });

  it('showApp reloads chat history', () => {
    const chatModule = { resetChatState: vi.fn(), reloadChatHistory: vi.fn() };
    deps.getChatModule.mockReturnValue(chatModule);
    auth = createAuth(deps);
    auth.showApp();
    expect(chatModule.reloadChatHistory).toHaveBeenCalled();
  });
});
