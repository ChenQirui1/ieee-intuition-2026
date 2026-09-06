import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTextCompletion, simplifyPage, testConnection } from '../entrypoints/sidepanel/api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('backend requests', () => {
  it('checks health without sending a paid completion', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    expect(await testConnection()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8000/healthz');
    expect(fetch.mock.calls[0]?.[1].method).toBe('GET');
  });

  it('keeps the timeout active after response headers arrive', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => ({
      ok: true,
      text: () => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
      }),
    })));
    const result = sendTextCompletion('hello');
    const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
  });

  it('cancels a simplification when its page is abandoned', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
    })));
    const controller = new AbortController();
    const request = simplifyPage('https://example.com', 'all', 'en', undefined, false, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('surfaces server failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"Too many requests"}', { status: 429 })));
    await expect(sendTextCompletion('hello')).rejects.toThrow('429');
  });
});
