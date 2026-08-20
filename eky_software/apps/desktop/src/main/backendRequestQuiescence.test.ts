import { describe, expect, it } from 'vitest';

import {
  BackendRequestQuiescence,
  BackendRequestQuiescenceTimeoutError,
} from './backendRequestQuiescence.js';

describe('backend request quiescence', () => {
  it('waits for admitted mutations and rejects new mutations while quiescing', async () => {
    const gate = new BackendRequestQuiescence({ timeoutMilliseconds: 100 });
    const activeWrite = gate.begin('POST');
    expect(activeWrite).toBeDefined();

    let completed = false;
    const quiescence = gate.quiesceAndWait().then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(gate.begin('PUT')).toBeUndefined();
    expect(gate.begin('GET')).toBeDefined();

    activeWrite?.release();
    await quiescence;
    expect(completed).toBe(true);
  });

  it('fails closed at the bounded deadline without losing the active lease', async () => {
    const gate = new BackendRequestQuiescence({ timeoutMilliseconds: 5 });
    const activeWrite = gate.begin('DELETE');

    await expect(gate.quiesceAndWait()).rejects.toBeInstanceOf(
      BackendRequestQuiescenceTimeoutError,
    );
    expect(gate.begin('PATCH')).toBeUndefined();

    activeWrite?.release();
    gate.resume();
    expect(gate.begin('PATCH')).toBeDefined();
  });

  it('rejects every request after the runtime is stopped', () => {
    const gate = new BackendRequestQuiescence();
    gate.stop();

    expect(gate.begin('GET')).toBeUndefined();
    expect(gate.begin('POST')).toBeUndefined();
    expect(() => gate.resume()).toThrow('BACKEND_REQUEST_QUIESCENCE_STOPPED');
  });

  it('releases a mutation lease idempotently', async () => {
    const gate = new BackendRequestQuiescence();
    const lease = gate.begin('POST');

    lease?.release();
    lease?.release();

    await expect(gate.quiesceAndWait()).resolves.toBeUndefined();
  });
});
