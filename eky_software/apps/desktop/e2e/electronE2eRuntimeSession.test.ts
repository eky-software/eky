import { describe, expect, it, vi } from 'vitest';

import { assertDifferentRuntimeSessionRejected } from '../src/main/runtimeSessionAcceptanceValidation.js';
import { isDesktopRuntimeSession } from '../src/runtime/runtimeSession.js';
import { createElectronE2eRuntimeSessionFactory } from './electronE2eRuntimeSession.js';

describe('Electron E2E runtime session factory', () => {
  it('retains the fixture session once and uses fresh sessions for validation', async () => {
    const primary = 'a'.repeat(43);
    const createRuntimeSession = createElectronE2eRuntimeSessionFactory(primary);
    expect(createRuntimeSession() === primary).toBe(true);
    const fetchImplementation = vi.fn(async (_url: string, request: RequestInit) => {
      const secret = new Headers(request.headers).get('x-eky-local-session');
      expect(secret !== null && secret !== primary).toBe(true);
      expect(isDesktopRuntimeSession(secret)).toBe(true);
      return new Response(null, { status: 401 });
    });
    await expect(assertDifferentRuntimeSessionRejected({
      backendOrigin: 'http://127.0.0.1:3000', createRuntimeSession,
      fetchImplementation, runtimeSessionSecret: primary,
    })).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(createRuntimeSession() !== primary).toBe(true);
  });

  it('does not turn an incorrectly accepted probe into success', async () => {
    const createRuntimeSession = createElectronE2eRuntimeSessionFactory('a'.repeat(43));
    const runtimeSessionSecret = createRuntimeSession();
    await expect(assertDifferentRuntimeSessionRejected({
      backendOrigin: 'http://127.0.0.1:3000', createRuntimeSession,
      fetchImplementation: async () => new Response(null, { status: 200 }), runtimeSessionSecret,
    })).rejects.toThrow('FIRST_START_SESSION_VALIDATION_FAILED');
  });

  it('reproduces the old constant-session adapter failure before any HTTP probe', async () => {
    const fetchImplementation = vi.fn();
    await expect(assertDifferentRuntimeSessionRejected({
      backendOrigin: 'http://127.0.0.1:3000', createRuntimeSession: () => 'a'.repeat(43),
      fetchImplementation, runtimeSessionSecret: 'a'.repeat(43),
    })).rejects.toThrow('FIRST_START_SESSION_VALIDATION_FAILED');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
