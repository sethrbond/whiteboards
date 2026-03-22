// ============================================================
// AI API LAYER — Handles all communication with Claude API
// ============================================================

import { AI_REQUEST_TIMEOUT_MS } from './constants.js';

/**
 * Create an AI caller configured with the given endpoint and model.
 * @param {Object} config
 * @param {string} config.proxyUrl - Supabase AI proxy URL
 * @param {string} config.proxyKey - Supabase anon key for proxy auth
 * @param {function} config.getSettings - Returns { apiKey, aiModel }
 * @returns {{ callAI, getAIEndpoint, hasAI }}
 */
export function createAICaller(config) {
  const { proxyUrl, proxyKey, getSettings } = config;

  function getAIEndpoint() {
    const s = getSettings();
    const headers = { apikey: proxyKey };
    if (s.apiKey) headers['x-user-api-key'] = s.apiKey;
    return { url: proxyUrl, headers };
  }

  function hasAI() {
    return true;
  }

  let _lastCallTime = 0;
  let _activeCalls = 0;

  async function callAI(prompt, opts = {}) {
    if (_activeCalls >= 3) {
      const err = new Error('AI is busy, please wait');
      err.status = 429;
      throw err;
    }

    const now = Date.now();
    const elapsed = now - _lastCallTime;
    if (_lastCallTime > 0 && elapsed < 500) {
      await new Promise((r) => setTimeout(r, 500 - elapsed));
    }

    _activeCalls++;
    _lastCallTime = Date.now();

    const { system, maxTokens = 16384, messages, temperature, signal: externalSignal } = opts;
    const s = getSettings();
    const ep = getAIEndpoint();

    const doCall = async (signal) => {
      const body = { model: s.aiModel || 'claude-haiku-4-5', max_tokens: maxTokens };
      if (temperature !== undefined) body.temperature = temperature;
      if (system) body.system = system;
      body.messages = messages || [{ role: 'user', content: prompt }];
      const resp = await fetch(ep.url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...ep.headers },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        let errMsg = 'Something went wrong with AI — try again';
        try {
          const errBody = await resp.json();
          if (errBody.error?.message) errMsg = errBody.error.message;
        } catch {
          /* ignore parse errors */
        }
        if (resp.status === 429) errMsg = 'AI is busy — try again in a moment';
        else if (resp.status === 503 || resp.status === 529) errMsg = 'AI service is temporarily down';
        else if (resp.status === 500) errMsg = 'AI service is temporarily down';
        else if (resp.status === 401 || resp.status === 403)
          errMsg = 'AI authentication failed. Check your API key in Settings.';
        const err = new Error(errMsg);
        err.status = resp.status;
        throw err;
      }
      const result = await resp.json();
      if (!result.content || !result.content.length)
        throw new Error("AI didn't return a response. Try again in a moment.");
      return result.content[0].text;
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    // If caller provides a signal, abort when either fires
    if (externalSignal) externalSignal.addEventListener('abort', () => controller.abort());
    try {
      return await doCall(controller.signal);
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('Request timed out — try a shorter input');
        e.status = 408;
        throw e;
      }
      if (err instanceof TypeError && !err.status) {
        const e = new Error('No internet connection — AI features unavailable');
        e.status = 0;
        throw e;
      }
      if (err.status === 429 || err.status === 500 || err.status === 503 || err.status === 529) {
        await new Promise((r) => setTimeout(r, err.status === 429 ? 2000 : 1000));
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), AI_REQUEST_TIMEOUT_MS);
        if (externalSignal) externalSignal.addEventListener('abort', () => controller2.abort());
        try {
          return await doCall(controller2.signal);
        } finally {
          clearTimeout(timeout2);
        }
      }
      throw err;
    } finally {
      _activeCalls--;
      clearTimeout(timeout);
    }
  }

  return { callAI, getAIEndpoint, hasAI };
}
