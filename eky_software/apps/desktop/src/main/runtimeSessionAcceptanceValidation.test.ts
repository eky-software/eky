import { describe, expect, it, vi } from 'vitest';

import { assertDifferentRuntimeSessionRejected } from './runtimeSessionAcceptanceValidation.js';

const activeSession = 'a'.repeat(43);
const rejectedSession = 'b'.repeat(43);

describe('runtime session acceptance validation', () => {
  it('probes a protected read-only route and accepts a rejected session', async () => {
    let capturedRequest: RequestInit | undefined;
    let capturedUrl: string | undefined;
    const fetchImplementation = vi.fn(
      async (url: string, request: RequestInit) => {
        capturedUrl = url;
        capturedRequest = request;
        return new Response(
          JSON.stringify({ error: 'Authentication required.' }),
          { status: 401 },
        );
      },
    );

    await expect(
      assertDifferentRuntimeSessionRejected({
        backendOrigin: 'http://127.0.0.1:3000',
        createRuntimeSession: () => rejectedSession,
        fetchImplementation,
        runtimeSessionSecret: activeSession,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(capturedUrl).toBe('http://127.0.0.1:3000/customers');
    expect(capturedRequest?.method).toBe('GET');
    expect(
      new Headers(capturedRequest?.headers).get('x-eky-local-session'),
    ).toBe(
      rejectedSession,
    );
  });

  it('fails closed when a protected route accepts another session', async () => {
    await expect(
      assertDifferentRuntimeSessionRejected({
        backendOrigin: 'http://127.0.0.1:3000',
        createRuntimeSession: () => rejectedSession,
        fetchImplementation: async () =>
          new Response(JSON.stringify({ customers: [] }), { status: 200 }),
        runtimeSessionSecret: activeSession,
      }),
    ).rejects.toThrow('FIRST_START_SESSION_VALIDATION_FAILED');
  });

  it('fails closed when a distinct session cannot be generated', async () => {
    const fetchImplementation = vi.fn();

    await expect(
      assertDifferentRuntimeSessionRejected({
        backendOrigin: 'http://127.0.0.1:3000',
        createRuntimeSession: () => activeSession,
        fetchImplementation,
        runtimeSessionSecret: activeSession,
      }),
    ).rejects.toThrow('FIRST_START_SESSION_VALIDATION_FAILED');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
