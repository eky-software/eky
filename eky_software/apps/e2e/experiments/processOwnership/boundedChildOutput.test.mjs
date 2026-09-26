import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { streamLimit } from './adapterContract.mjs';
import { boundedFailureDetails, observeBoundedChildOutput } from './boundedChildOutput.mjs';

test('private error details preserve stack and fall back from empty stack to message', () => {
  assert.equal(boundedFailureDetails({ stack: 'stack', message: 'message' }).toString(), 'stack');
  assert.equal(boundedFailureDetails({ stack: '', message: 'original failure' }).toString(), 'original failure');
  const empty = new Error();
  empty.stack = '';
  assert.equal(boundedFailureDetails(empty).toString(), 'Error');
});

test('private error details remain bounded and nonempty even for broken formatters', () => {
  assert.equal(boundedFailureDetails({ stack: 'x'.repeat(streamLimit + 1) }).length, streamLimit);
  assert.equal(boundedFailureDetails('').toString(), 'Failure without printable details');
  const broken = { get stack() { throw new Error(); }, get message() { throw new Error(); },
    toString() { throw new Error(); } };
  assert.equal(boundedFailureDetails(broken).toString(), 'Failure without printable details');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('capture retains bounded diagnostic bytes from both streams without parsing them', () => {
  const child = fakeChild();
  const capture = observeBoundedChildOutput(child);
  const bytes = Buffer.from([0, 255, 13, 10]);
  child.stdout.emit('data', bytes);
  child.stderr.emit('data', Buffer.from('synthetic stderr'));
  const expected = Buffer.concat([bytes, Buffer.from('synthetic stderr')]);
  bytes.fill(0);
  assert.deepEqual(capture.output, expected);
  capture.output.fill(0);
  assert.deepEqual(capture.output, expected);
  capture.assertHealthy();
});

test('combined output limit retains the prefix and latches overflow', async () => {
  const child = fakeChild();
  const capture = observeBoundedChildOutput(child);
  child.stdout.emit('data', Buffer.alloc(streamLimit - 1, 65));
  child.stderr.emit('data', Buffer.from('BC'));
  assert.equal(capture.output.length, streamLimit);
  assert.equal(capture.output.at(-1), 66);
  const first = capture.failure;
  assert.match(first.message, /childOutputOverflow/);
  child.stderr.emit('data', Buffer.alloc(streamLimit, 67));
  child.stdout.emit('error', new Error('later read error'));
  assert.equal(capture.failure, first);
  assert.equal(capture.output.length, streamLimit);
  await assert.rejects(capture.guard(Promise.resolve({ code: 0 })), error => error === first);
});

test('exact limit and ignored streams do not manufacture a failure', async () => {
  const stderr = new EventEmitter();
  const capture = observeBoundedChildOutput({ stdout: null, stderr });
  stderr.emit('data', Buffer.alloc(streamLimit));
  assert.equal(capture.output.length, streamLimit);
  capture.assertHealthy();
  assert.equal(await capture.guard(Promise.resolve('closed')), 'closed');
  observeBoundedChildOutput({ stdout: null, stderr: null }).assertHealthy();
});

for (const stream of ['stdout', 'stderr']) {
  test(`${stream} error rejects the waiting operation but leaves owned cleanup possible`, async () => {
    const child = fakeChild();
    const capture = observeBoundedChildOutput(child);
    const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    const waiting = capture.guard(closed);
    const original = new Error(`synthetic ${stream} failure`);
    child[stream].emit('error', original);
    await assert.rejects(waiting, error => error === original);
    // The raw close observation remains available to the existing cleanup owner.
    child.emit('close', 0, null);
    assert.deepEqual(await closed, { code: 0, signal: null });
    assert.throws(() => capture.assertHealthy(), error => error === original);
    await assert.rejects(capture.guard(closed), error => error === original);
  });
}

test('a successful close raced by a stream error cannot pass', async () => {
  const child = fakeChild();
  const capture = observeBoundedChildOutput(child);
  const closed = new Promise(resolve => child.once('close', resolve));
  const waiting = capture.guard(closed);
  child.emit('close', 0);
  const original = new Error('late stream error');
  child.stderr.emit('error', original);
  await assert.rejects(waiting, error => error === original);
});

test('first stream failure survives later errors and observes already-started rejections', async () => {
  const child = fakeChild();
  const capture = observeBoundedChildOutput(child);
  const original = new Error('first read failure');
  child.stdout.emit('error', original);
  child.stderr.emit('error', new Error('second read failure'));
  child.stdout.emit('data', Buffer.from('diagnostic after failure'));
  await assert.rejects(capture.guard(Promise.reject(new Error('operation failed later'))), error => error === original);
  assert.equal(capture.failure, original);
  assert.equal(capture.output.toString(), 'diagnostic after failure');
});

test('ordinary operation errors propagate without becoming output failures', async () => {
  const child = fakeChild();
  const capture = observeBoundedChildOutput(child);
  const original = new Error('operation error');
  await assert.rejects(capture.guard(Promise.reject(original)), error => error === original);
  capture.assertHealthy();
});
