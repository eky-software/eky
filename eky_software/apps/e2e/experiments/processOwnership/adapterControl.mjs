import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createFrameReader, encodeFrame, requireToken, validateResponse } from './adapterContract.mjs';

export async function beforeDeadline(promise, deadline) {
  // Observe an operation that was already started even if its deadline expired.
  promise = Promise.resolve(promise);
  promise.catch(() => {});
  assert.ok(Number.isFinite(deadline), 'invalidDeadline');
  const milliseconds = deadline - performance.now();
  assert.ok(milliseconds > 0, 'adapterDeadlineExceeded');
  const controller = new AbortController();
  try {
    const result = await Promise.race([promise, delay(milliseconds, null, { signal: controller.signal })
      .then(() => { throw new Error('adapterDeadlineExceeded'); })]);
    assert.ok(performance.now() < deadline, 'adapterDeadlineExceeded');
    return result;
  } finally { controller.abort(); }
}

export async function connectAdapter(generation, deadline, connectSocket = connect, now = () => performance.now()) {
  requireToken(generation);
  const socket = connectSocket(`\\\\.\\pipe\\eky-t3c-${generation}-caller`);
  let failure;
  let pending;
  let sequence = 0;
  let finishing = false;
  let ended = false;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const fail = error => {
    failure ??= error;
    pending?.reject(error);
    pending = undefined;
  };
  socket.on('error', fail);
  const reader = createFrameReader(value => {
    assert.ok(pending, 'unsolicitedControlResponse');
    const state = validateResponse(value, generation, pending.sequence, pending.kind);
    const result = pending;
    pending = undefined;
    result.resolve(state);
  });
  socket.on('data', chunk => {
    try { reader.push(chunk); } catch (error) { fail(error); socket.destroy(); }
  });
  socket.on('end', () => {
    ended = true;
    try { reader.end(); } catch (error) { fail(error); }
  });
  socket.on('close', () => {
    try { reader.end(); } catch (error) { fail(error); }
    if (!finishing || !ended || pending) fail(new Error('adapterControlClosed'));
    resolveClosed();
  });
  try {
    await beforeDeadline(new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }), deadline);
  } catch (error) { socket.destroy(); throw error; }
  return {
    async request(kind) {
      assert.ok(['status', 'stop', 'breakBridge'].includes(kind));
      if (failure) throw failure;
      assert.equal(finishing, false, 'controlAlreadyFinishing');
      assert.ok(now() < deadline, 'adapterDeadlineExceeded');
      assert.equal(pending, undefined, 'concurrentControlRequest');
      const current = ++sequence;
      const result = new Promise((resolve, reject) => {
        pending = { resolve, reject, sequence: current, kind: kind === 'stop' ? 'terminal' : 'snapshot' };
      });
      result.catch(() => {});
      socket.write(encodeFrame({ schemaVersion: 1, generation, sequence: current, kind }), error => {
        if (error) fail(error);
      });
      try {
        const state = await beforeDeadline(result, deadline);
        if (failure) throw failure;
        return state;
      }
      catch (error) { fail(error); socket.destroy(); throw error; }
    },
    async finish() {
      if (failure) throw failure;
      assert.equal(pending, undefined, 'controlRequestPending');
      finishing = true;
      socket.end();
      await beforeDeadline(closed, deadline);
      if (failure) throw failure;
    },
    destroy() { socket.destroy(); },
  };
}
