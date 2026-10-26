import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { net, protocol } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerApplicationProtocol } from './applicationProtocol.js';

vi.mock('electron', () => ({ net: { fetch: vi.fn() }, protocol: { handle: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

const webRoot = resolve('synthetic-web');
const dispatch = (method: string, path: string) => {
  const handle = vi.mocked(protocol.handle).mock.calls.at(-1)?.[1];
  if (handle === undefined) throw new Error('TEST_PROTOCOL_NOT_REGISTERED');
  return handle(new Request(`eky://app${path}`, { method }));
};

beforeEach(() => vi.resetAllMocks());

describe('selector application protocol', () => {
  it('serves the existing static app with its security headers and no backend', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('<main>selector</main>'));
    registerApplicationProtocol({ mode: 'selector', webRoot });
    const response = await dispatch('GET', '/index.html#workspace-selector');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<main>selector</main>');
    expect(readFile).toHaveBeenCalledWith(resolve(webRoot, 'index.html'));
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/health'], ['GET', '/customers'], ['POST', '/customers'],
    ['GET', '/company-settings'], ['PUT', '/company-settings'],
    ['GET', '/company-settings/email-secret'], ['DELETE', '/company-settings/email-secret'],
    ['GET', '/diagnostics/events'], ['GET', '/activity'],
    ['POST', '/invoices/invoice-1/email/smtp/send'],
    ['POST', '/invoice-drafts/draft-1/approve'],
  ])('denies %s %s without reading static files or contacting a backend', async (method, path) => {
    registerApplicationProtocol({ mode: 'selector', webRoot });
    const response = await dispatch(method, path);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Avaa yritys ennen tämän toiminnon käyttämistä.' });
    expect(readFile).not.toHaveBeenCalled();
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('keeps unknown mutations and foreign origins closed', async () => {
    registerApplicationProtocol({ mode: 'selector', webRoot });
    expect((await dispatch('POST', '/unknown')).status).toBe(405);
    const handle = vi.mocked(protocol.handle).mock.calls[0]![1];
    expect((await handle(new Request('eky://foreign/index.html'))).status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('preserves the ordinary business proxy and main-owned credentials', async () => {
    const release = vi.fn();
    const begin = vi.fn(() => ({ release }));
    vi.mocked(net.fetch).mockResolvedValue(Response.json({ status: 'ok' }));
    registerApplicationProtocol({ backendOrigin: 'http://127.0.0.1:12345', runtimeSessionSecret: 'a'.repeat(43),
      webRoot, backendRequestAdmission: { begin } });
    expect((await dispatch('GET', '/health')).status).toBe(200);
    expect(net.fetch).toHaveBeenCalledWith('http://127.0.0.1:12345/health', expect.objectContaining({
      method: 'GET', headers: expect.any(Headers),
    }));
    const headers = vi.mocked(net.fetch).mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('x-eky-local-session')).toBe('a'.repeat(43));
    expect(begin).toHaveBeenCalledWith('GET');
    expect(release).toHaveBeenCalledOnce();
  });
});
