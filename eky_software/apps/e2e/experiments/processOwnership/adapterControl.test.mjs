import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { beforeDeadline, connectAdapter } from './adapterControl.mjs';
import { encodeFrame } from './adapterContract.mjs';

const generation = 'a'.repeat(64);
const state = { launched: true, creationCompleted: true, rootExited: true, rootExitCode: 0,
  activeProcesses: 0, assignedBeforeResume: true, descendantsAfterRoot: false, bridgeLost: false,
  cleanup: 'processTreeAbsent', failure: null };

function fakePipe(onWrite = () => {}, onConnect = socket => socket.emit('connect')) {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
  socket.end = () => { socket.emit('end'); socket.emit('close'); };
  socket.write = (bytes, callback) => queueMicrotask(() => {
    callback();
    onWrite(JSON.parse(bytes), socket);
  });
  const connect = name => {
    assert.equal(name, `\\\\.\\pipe\\eky-t3c-${generation}-caller`);
    queueMicrotask(() => onConnect(socket));
    return socket;
  };
  return { connect, socket };
}

test('control keeps one connection and binds every response to the next request', async () => {
  const requests = [];
  const pipe = fakePipe((request, socket) => {
    requests.push(request);
    socket.emit('data', encodeFrame({ ...request, kind: request.kind === 'stop' ? 'terminal' : 'snapshot', state }));
  });
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await control.request('status');
  await control.request('stop');
  await control.request('stop');
  assert.deepEqual(requests.map(({ sequence, kind }) => [sequence, kind]), [[1, 'status'], [2, 'stop'], [3, 'stop']]);
  await control.finish();
});

for (const [name, mutate] of [
  ['old generation', value => ({ ...value, generation: 'b'.repeat(64) })],
  ['replayed sequence', value => ({ ...value, sequence: 0 })],
  ['wrong response kind', value => ({ ...value, kind: 'terminal' })],
  ['unknown fields', value => ({ ...value, rawError: 'not allowed' })],
]) test(`control rejects ${name} and closes the pipe`, async () => {
  const pipe = fakePipe((request, socket) => socket.emit('data', encodeFrame(mutate({ ...request, kind: 'snapshot', state }))));
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await assert.rejects(control.request('status'));
  assert.equal(pipe.socket.destroyed, true);
  await assert.rejects(control.request('stop'));
});

test('EOF without response and malformed trailing frame cannot satisfy a request', async () => {
  for (const bytes of [null, Buffer.from('{')]) {
    const pipe = fakePipe((_request, socket) => {
      if (bytes) socket.emit('data', bytes);
      socket.end();
    });
    const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
    await assert.rejects(control.request('status'));
  }
});

test('concurrent requests are rejected without replacing the original waiter', async () => {
  let reply;
  const pipe = fakePipe((request, socket) => { reply = () => socket.emit('data', encodeFrame({ ...request, kind: 'snapshot', state })); });
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  const first = control.request('status');
  await assert.rejects(control.request('status'), /concurrentControlRequest/);
  reply();
  await first;
  await control.finish();
});

test('expired absolute deadline rejects even an already resolved operation', async () => {
  await assert.rejects(beforeDeadline(Promise.resolve('late'), performance.now() - 1), /adapterDeadlineExceeded/);
  await assert.rejects(beforeDeadline(Promise.reject(new Error('late rejection')), performance.now() - 1), /adapterDeadlineExceeded/);
});

test('expired request sends nothing and creates no unobserved cleanup rejection', async () => {
  let writes = 0;
  const pipe = fakePipe(() => { writes++; });
  const deadline = performance.now() + 1000;
  let now = deadline - 1;
  const control = await connectAdapter(generation, deadline, pipe.connect, () => now);
  now = deadline + 1;
  await assert.rejects(control.request('stop'), /adapterDeadlineExceeded/);
  assert.equal(writes, 0);
  control.destroy();
});

for (const [name, suffix] of [
  ['duplicate response', value => encodeFrame(value)],
  ['malformed response', () => Buffer.from('invalid\n')],
  ['truncated response', () => Buffer.from('{')],
]) test(`terminal finalization rejects ${name} after a valid response`, async () => {
  const pipe = fakePipe((request, socket) => {
    const response = { ...request, kind: 'terminal', state };
    socket.emit('data', Buffer.concat([encodeFrame(response), suffix(response)]));
  });
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await assert.rejects(async () => { await control.request('stop'); await control.finish(); });
  control.destroy();
});

test('channel error between terminal and final close remains a failure', async () => {
  const pipe = fakePipe((request, socket) => socket.emit('data', encodeFrame({ ...request, kind: 'terminal', state })));
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await control.request('stop');
  pipe.socket.emit('error', new Error('late channel error'));
  await assert.rejects(control.finish(), /late channel error/);
  control.destroy();
});

for (const code of ['ENOENT', 'EACCES']) test(`connection ${code} preserves the original error and destroys its socket`, async () => {
  const original = Object.assign(new Error('synthetic connect failure'), { code });
  const pipe = fakePipe(undefined, socket => socket.emit('error', original));
  await assert.rejects(connectAdapter(generation, performance.now() + 1000, pipe.connect), error => error === original);
  assert.equal(pipe.socket.destroyed, true);
  assert.doesNotThrow(() => pipe.socket.emit('error', new Error('late connect failure')));
});

test('error during a pending request rejects it and preserves the first failure', async () => {
  const pipe = fakePipe();
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  const request = control.request('status');
  const original = new Error('synthetic pending request error');
  pipe.socket.emit('error', original);
  await assert.rejects(request, error => error === original);
  assert.equal(pipe.socket.destroyed, true);
  pipe.socket.emit('error', new Error('later socket failure'));
  await assert.rejects(control.request('stop'), error => error === original);
});

test('write callback failure rejects a pending request without waiting for EOF', async () => {
  const pipe = fakePipe();
  const original = new Error('synthetic write failure');
  pipe.socket.write = (_bytes, callback) => queueMicrotask(() => callback(original));
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await assert.rejects(control.request('status'), error => error === original);
  assert.equal(pipe.socket.destroyed, true);
  await assert.rejects(control.finish(), error => error === original);
});

test('missing response reaches the existing deadline and destroys the pending socket', async () => {
  const pipe = fakePipe();
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  const request = control.request('status');
  await assert.rejects(request, /adapterDeadlineExceeded/);
  assert.equal(pipe.socket.destroyed, true);
  await assert.rejects(control.request('stop'), /adapterDeadlineExceeded/);
});

test('terminal does not finalize while the peer holds its read side open', async () => {
  const pipe = fakePipe((request, socket) => socket.emit('data', encodeFrame({ ...request, kind: 'terminal', state })));
  let endRequested = false;
  pipe.socket.end = () => { endRequested = true; };
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await control.request('stop');
  const finalization = control.finish();
  assert.equal(endRequested, true);
  await assert.rejects(finalization, /adapterDeadlineExceeded/);
  // Finalization failure returns to the driver, which owns this destruction.
  control.destroy();
  assert.equal(pipe.socket.destroyed, true);
});

test('stream error while awaiting final EOF cannot be erased by a subsequent clean close', async () => {
  const pipe = fakePipe((request, socket) => socket.emit('data', encodeFrame({ ...request, kind: 'terminal', state })));
  pipe.socket.end = () => {};
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await control.request('stop');
  const finalization = control.finish();
  const original = new Error('final EOF failure');
  pipe.socket.emit('error', original);
  pipe.socket.emit('end');
  pipe.socket.emit('close');
  await assert.rejects(finalization, error => error === original);
  control.destroy();
});

test('final close without peer EOF is not accepted as graceful finalization', async () => {
  const pipe = fakePipe((request, socket) => socket.emit('data', encodeFrame({ ...request, kind: 'terminal', state })));
  pipe.socket.end = () => pipe.socket.emit('close');
  const control = await connectAdapter(generation, performance.now() + 1000, pipe.connect);
  await control.request('stop');
  await assert.rejects(control.finish(), /adapterControlClosed/);
  control.destroy();
});
