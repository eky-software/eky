import { describe, expect, it, vi } from 'vitest';

import { createBackendRequestHeaders } from './protocolPolicy.js';
import { assertW6b2PackagedUpdateWriteState } from './w6b2PackagedUpdateWriteProbe.js';

const failureCode = 'W6B2_PROOF_PREPARATION_CONCURRENCY_FAILED';

function fixture(response: Response) {
  return {
    backendPort: 12345,
    runtimeSessionSecret: 'synthetic-test-session',
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response),
  };
}

describe('packaged source handoff write admission', () => {
  it.each(['writable', 'blocked'] as const)('requires the %s response to a non-mutating invalid write', async state => {
    const input = fixture(Response.json(state === 'blocked'
      ? { code: 'PROFILE_MAINTENANCE_ACTIVE', error: 'Service is temporarily unavailable.' }
      : { error: 'Invalid JSON body.' }, { status: state === 'blocked' ? 503 : 400 }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state })).resolves.toBeUndefined();
    expect(input.fetchImplementation).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:12345/customers', {
      body: '{', method: 'POST', redirect: 'error',
      headers: createBackendRequestHeaders(new Headers({ 'content-type': 'application/json' }), input.runtimeSessionSecret),
    });
  });

  it.each([200, 201, 400, 401, 403, 404, 500])('rejects status %i as proof of a held fence', async status => {
    const input = fixture(Response.json({ code: 'PROFILE_MAINTENANCE_ACTIVE' }, { status }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).rejects.toThrow(failureCode);
  });

  it('rejects an already blocked baseline instead of accepting a vacuous transition', async () => {
    const input = fixture(Response.json({ code: 'PROFILE_MAINTENANCE_ACTIVE' }, { status: 503 }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'writable' })).rejects.toThrow(failureCode);
  });

  it.each(['null', '[]', '{}', '{"code":"OTHER"}', 'private invalid response', 'x'.repeat(1025)])(
    'rejects absent, unrelated, invalid or oversized evidence %# without publishing it', async body => {
      const input = fixture(new Response(body, { status: 503 }));
      await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).rejects.toThrow(failureCode);
    },
  );

  it('rejects a missing response body', async () => {
    const input = fixture(new Response(null, { status: 503 }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).rejects.toThrow(failureCode);
  });

  it('accepts valid multi-chunk JSON exactly at the byte limit', async () => {
    const json = JSON.stringify({ code: 'PROFILE_MAINTENANCE_ACTIVE' });
    const bytes = new TextEncoder().encode(json.padEnd(1024));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 19));
        controller.enqueue(bytes.slice(19, 700));
        controller.enqueue(bytes.slice(700));
        controller.close();
      },
    });
    const input = fixture(new Response(body, { status: 503 }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).resolves.toBeUndefined();
    expect(body.locked).toBe(false);
  });

  it.each([false, true])('rejects cumulative overflow and releases the reader even if cancellation fails (%s)', async cancelFails => {
    const cancel = vi.fn(() => {
      if (cancelFails) throw new Error('private cancellation error');
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(425));
      },
      cancel,
    });
    const input = fixture(new Response(body, { status: 503 }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).rejects.toThrow(failureCode);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('maps stream failure safely and releases the reader', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('private read error')); },
    });
    const input = fixture(new Response(body, { status: 503 }));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).rejects.toThrow(failureCode);
    expect(body.locked).toBe(false);
  });

  it('does not forward a raw network error or try again', async () => {
    const input = fixture(new Response());
    input.fetchImplementation.mockRejectedValue(new Error('private session and path'));
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, state: 'blocked' })).rejects.toThrow(failureCode);
    expect(input.fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([0, 65536, 1.5, NaN])('rejects an invalid port before sending a request (%s)', async backendPort => {
    const input = fixture(new Response());
    await expect(assertW6b2PackagedUpdateWriteState({ ...input, backendPort, state: 'blocked' })).rejects.toThrow(failureCode);
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
});
