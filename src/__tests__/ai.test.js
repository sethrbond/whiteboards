import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAICaller } from '../ai.js';

describe('ai.js — createAICaller()', () => {
  let ai;
  const mockSettings = { apiKey: '', aiModel: 'claude-haiku-4-5-20251001' };

  beforeEach(() => {
    ai = createAICaller({
      proxyUrl: 'https://example.com/ai-proxy',
      proxyKey: 'test-key',
      getSettings: () => mockSettings,
    });
  });

  it('returns callAI, getAIEndpoint, hasAI', () => {
    expect(typeof ai.callAI).toBe('function');
    expect(typeof ai.getAIEndpoint).toBe('function');
    expect(typeof ai.hasAI).toBe('function');
  });

  it('hasAI returns true', () => {
    expect(ai.hasAI()).toBe(true);
  });

  describe('getAIEndpoint()', () => {
    it('uses proxy when no apiKey', () => {
      mockSettings.apiKey = '';
      const ep = ai.getAIEndpoint();
      expect(ep.url).toBe('https://example.com/ai-proxy');
      expect(ep.headers.apikey).toBe('test-key');
    });

    it('routes through proxy with user API key when apiKey is set', () => {
      mockSettings.apiKey = 'sk-test-123';
      const ep = ai.getAIEndpoint();
      expect(ep.url).toBe('https://example.com/ai-proxy');
      expect(ep.headers['x-user-api-key']).toBe('sk-test-123');
      expect(ep.headers.apikey).toBe('test-key');
      mockSettings.apiKey = ''; // reset
    });
  });

  describe('callAI()', () => {
    it('throws on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await expect(ai.callAI('test')).rejects.toThrow('Network error');
    });

    it('throws user-friendly message on 429', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'rate limited' } }),
      });
      // callAI retries once on 429, so both calls return 429
      await expect(ai.callAI('test')).rejects.toThrow('AI is busy');
    });

    it('throws user-friendly message on 401', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'unauthorized' } }),
      });
      await expect(ai.callAI('test')).rejects.toThrow('authentication failed');
    });

    it('returns text content on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: 'Hello from AI' }] }),
      });
      const result = await ai.callAI('test');
      expect(result).toBe('Hello from AI');
    });

    it('sends correct request body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: 'ok' }] }),
      });
      await ai.callAI('test prompt', { system: 'You are helpful', maxTokens: 500 });
      const [_url, opts] = global.fetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.max_tokens).toBe(500);
      expect(body.system).toBe('You are helpful');
      expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
    });

    it('throws on empty AI response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [] }),
      });
      await expect(ai.callAI('test')).rejects.toThrow("didn't return a response");
    });

    it('retries on 500 then succeeds', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: [{ text: 'retry worked' }] }) });
      });
      const result = await ai.callAI('test');
      expect(result).toBe('retry worked');
      expect(callCount).toBe(2);
    });

    it('uses custom messages array when provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: 'ok' }] }),
      });
      await ai.callAI('ignored', {
        messages: [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'first reply' },
          { role: 'user', content: 'follow up' },
        ],
      });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.messages.length).toBe(3);
      expect(body.messages[0].content).toBe('first message');
    });

    it('uses custom model when settings specify one', async () => {
      mockSettings.aiModel = 'claude-sonnet-4-5-20250514';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: 'ok' }] }),
      });
      await ai.callAI('test');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4-5-20250514');
      mockSettings.aiModel = 'claude-haiku-4-5-20251001'; // reset
    });
  });

  describe('hasAI()', () => {
    it('always returns true', () => {
      expect(ai.hasAI()).toBe(true);
    });

    it('returns true regardless of config', () => {
      const minimalAi = createAICaller({
        proxyUrl: '',
        proxyKey: '',
        getSettings: () => ({ apiKey: '', aiModel: '' }),
      });
      expect(minimalAi.hasAI()).toBe(true);
    });
  });
});
