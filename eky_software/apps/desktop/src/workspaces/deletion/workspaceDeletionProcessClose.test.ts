import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, it, vi, type TestContext } from 'vitest';
import { deletionProcessFixture, startDeletionProcessChild } from './workspaceDeletionProcessTestSupport.js';

vi.mock('node:child_process', () => ({ fork: vi.fn() }));

function fixture(test: TestContext) {
  const controller = new AbortController();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const process = Object.assign(new EventEmitter(), {
    pid: 1234, connected: true, stdout, stderr,
    disconnect: vi.fn(), kill: vi.fn(() => true),
    send: vi.fn((_config: unknown, done: (error: Error | null) => void) => { done(null); return true; }),
  });
  // This boundary double controls OS events; the separate process suite proves real close.
  vi.mocked(fork).mockReturnValue(process as unknown as ChildProcess);
  const child = startDeletionProcessChild({ ...test, signal: controller.signal }, { synthetic: true });
  test.onTestFinished(() => {
    process.emit('close', null, 'SIGKILL');
    stdout.destroy(); stderr.destroy(); vi.clearAllMocks();
  });
  return { child, process, controller, stdout, stderr,
    close() { process.emit('close', null, 'SIGKILL'); } };
}

it.for(['finish', 'abort'] as const)('retains IPC and joins delayed final close after %s', async (mode, test) => {
  const f = fixture(test);
  if (mode === 'abort') f.controller.abort(new Error('SYNTHETIC_TEST_ABORT'));
  let settled = false;
  const finishing = f.child.finish().then(result => { settled = true; return result; });
  expect(f.process.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  expect(f.process.disconnect).not.toHaveBeenCalled();
  f.process.emit('disconnect');
  f.process.emit('exit', null, 'SIGKILL');
  f.stdout.end(); f.stderr.end();
  await Promise.resolve();
  expect(settled).toBe(false);
  f.close();
  expect(await finishing).toEqual({ stdout: '', stderr: '', closed: true });
});

it('shares the final close across repeated joins without repeated termination', async test => {
  const f = fixture(test);
  const first = f.child.finish(), second = f.child.finish();
  f.controller.abort(new Error('SYNTHETIC_TEST_ABORT'));
  expect(f.process.kill).toHaveBeenCalledTimes(1);
  f.close();
  expect(await first).toEqual(await second);
  expect(await f.child.finish()).toEqual({ stdout: '', stderr: '', closed: true });
  expect(f.process.kill).toHaveBeenCalledTimes(1);
  expect(f.process.disconnect).not.toHaveBeenCalled();
});

it('accepts false kill only after real close, not as a completion receipt', async test => {
  const f = fixture(test);
  f.process.kill.mockReturnValue(false);
  f.process.emit('exit', 1, null);
  let settled = false;
  const finishing = f.child.finish().then(result => { settled = true; return result; });
  await Promise.resolve();
  expect(settled).toBe(false);
  f.close();
  expect((await finishing).closed).toBe(true);
});

it.for(['beforeAbort', 'afterAbort'] as const)('preserves a child error %s through final join', async (order, test) => {
  const f = fixture(test), original = new Error('SYNTHETIC_CHILD_FAILURE');
  if (order === 'beforeAbort') f.process.emit('error', original);
  f.controller.abort(new Error('SYNTHETIC_TEST_ABORT'));
  if (order === 'afterAbort') f.process.emit('error', original);
  const finishing = f.child.finish();
  const rejected = expect(finishing).rejects.toBe(original);
  f.close();
  await rejected;
  await expect(f.child.finish()).rejects.toBe(original);
});

it('wakes a message wait on cancellation without treating cancellation as cleanup failure', async test => {
  const f = fixture(test), reason = new Error('SYNTHETIC_TEST_ABORT');
  const waiting = expect(f.child.message('completed')).rejects.toBe(reason);
  f.controller.abort(reason);
  await waiting;
  const finishing = f.child.finish();
  f.close();
  expect((await finishing).closed).toBe(true);
});

it.for(['stdout', 'stderr'] as const)('retains %s errors instead of returning a clean receipt', async (stream, test) => {
  const f = fixture(test), original = new Error('SYNTHETIC_PIPE_FAILURE');
  f[stream].emit('error', original);
  const rejected = expect(f.child.finish()).rejects.toBe(original);
  f.close();
  await rejected;
});

it('retains a synchronous kill error but still waits for final close', async test => {
  const f = fixture(test), original = new Error('SYNTHETIC_KILL_FAILURE');
  f.process.kill.mockImplementation(() => { throw original; });
  let settled = false;
  const finishing = f.child.finish().catch(error => { settled = true; throw error; });
  const rejected = expect(finishing).rejects.toBe(original);
  await Promise.resolve();
  expect(settled).toBe(false);
  f.close();
  await rejected;
});

it('does not hide a send callback error', async test => {
  const f = fixture(test), original = new Error('SYNTHETIC_SEND_FAILURE');
  f.process.send.mock.calls[0]![1](original);
  const rejected = expect(f.child.finish()).rejects.toBe(original);
  f.close();
  await rejected;
});

it.for(['invalidMessage', 'outputLimit'] as const)('retains %s failures through cleanup', async (failure, test) => {
  const f = fixture(test);
  if (failure === 'invalidMessage') f.process.emit('message', { event: 'completed', pid: 4321 });
  else f.stdout.emit('data', Buffer.alloc(64 * 1024 + 1));
  const rejected = expect(f.child.finish()).rejects.toThrow(failure === 'invalidMessage'
    ? 'DELETION_PROCESS_MESSAGE_INVALID' : 'DELETION_PROCESS_OUTPUT_LIMIT');
  f.close();
  await rejected;
});

it('retains an immutable completion wait before abort rather than calling close completion', async test => {
  const f = fixture(test), reason = new Error('SYNTHETIC_TEST_ABORT');
  const waiting = expect(f.child.message('completed')).rejects.toBe(reason);
  f.controller.abort(reason);
  await waiting;
  const before = f.child.readEvidence();
  expect(before.atAbort).toEqual({ waiting: { cut: 0, completed: 1, failed: 0, termination: 0, exit: 0 },
    messages: [], closed: false, terminationRequested: false });
  const finishing = f.child.finish();
  f.close();
  expect(await finishing).toEqual({ stdout: '', stderr: '', closed: true });
  expect(f.child.readEvidence()).toEqual({ atAbort: before.atAbort,
    after: { waiting: { cut: 0, completed: 0, failed: 0, termination: 0, exit: 0 },
      messages: [], closed: true, terminationRequested: true }, close: { code: null, signal: 'SIGKILL' } });
  expect(Object.isFrozen(before.atAbort)).toBe(true);
  expect(Object.isFrozen(before.atAbort!.waiting)).toBe(true);
  expect(Object.isFrozen(before.atAbort!.messages)).toBe(true);
});

it('distinguishes completed IPC from pending successful process close at abort', async test => {
  const f = fixture(test);
  f.process.emit('message', { event: 'completed', pid: f.process.pid });
  await f.child.message('completed');
  const exiting = expect(f.child.successfulExit()).rejects.toBeInstanceOf(Error);
  f.process.emit('exit', 0, null);
  f.controller.abort(new Error('SYNTHETIC_TEST_ABORT'));
  expect(f.child.readEvidence().atAbort).toEqual({
    waiting: { cut: 0, completed: 0, failed: 0, termination: 0, exit: 1 },
    messages: ['completed'], closed: false, terminationRequested: false,
  });
  const finishing = f.child.finish();
  f.close();
  await exiting;
  await finishing;
  expect(f.child.readEvidence().close).toEqual({ code: null, signal: 'SIGKILL' });
});

it('requires close after completed IPC even when exit and disconnect were observed', async test => {
  const f = fixture(test);
  f.process.emit('message', { event: 'completed', pid: f.process.pid });
  await f.child.message('completed');
  let settled = false;
  const exiting = f.child.successfulExit().then(() => { settled = true; });
  f.process.emit('exit', 0, null); f.process.emit('disconnect');
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(f.child.readEvidence().after.waiting.exit).toBe(1);
  expect(f.child.readEvidence().close).toBeNull();
  f.process.emit('close', 0, null);
  await exiting;
  expect(await f.child.finish()).toEqual({ stdout: '', stderr: '', closed: true });
  expect(f.child.readEvidence().after.waiting.exit).toBe(0);
  expect(f.child.readEvidence().close).toEqual({ code: 0, signal: null });
  expect(f.process.kill).not.toHaveBeenCalled();
});

it('does not invent completion when a process closes without a completion message', async test => {
  const f = fixture(test);
  const waiting = expect(f.child.message('completed')).rejects.toThrow('DELETION_PROCESS_PHASE_NOT_REACHED');
  f.process.emit('close', 0, null);
  await waiting;
  expect(await f.child.finish()).toEqual({ stdout: '', stderr: '', closed: true });
  expect(f.child.readEvidence().after.messages).toEqual([]);
  expect(f.child.readEvidence().close).toEqual({ code: 0, signal: null });
});

it('projects only allowed message event names into retained observations', async test => {
  const f = fixture(test);
  const message = { event: 'completed', pid: f.process.pid,
    completion: { secret: 'SYNTHETIC_MUST_NOT_BE_COPIED' }, extra: 'SYNTHETIC_EXTRA_PAYLOAD' };
  f.process.emit('message', message);
  await f.child.message('completed');
  message.event = 'SYNTHETIC_MUST_NOT_BE_COPIED';
  const observation = JSON.stringify(f.child.readEvidence());
  expect(f.child.readEvidence().after.messages).toEqual(['completed']);
  expect(observation).not.toContain('SYNTHETIC_MUST_NOT_BE_COPIED');
  expect(observation).not.toContain('SYNTHETIC_EXTRA_PAYLOAD');
  f.close(); await f.child.finish();
});

it('counts concurrent same-event waits separately until their settlement', async test => {
  const f = fixture(test), reason = new Error('SYNTHETIC_TEST_ABORT');
  const first = expect(f.child.message('completed')).rejects.toBe(reason);
  const second = expect(f.child.message('completed')).rejects.toBe(reason);
  const exiting = expect(f.child.successfulExit()).rejects.toBeInstanceOf(Error);
  expect(f.child.readEvidence().after.waiting).toEqual({ cut: 0, completed: 2, failed: 0, termination: 0, exit: 1 });
  f.controller.abort(reason);
  expect(f.child.readEvidence().atAbort!.waiting).toEqual({ cut: 0, completed: 2, failed: 0, termination: 0, exit: 1 });
  await Promise.all([first, second]);
  expect(f.child.readEvidence().after.waiting).toEqual({ cut: 0, completed: 0, failed: 0, termination: 0, exit: 1 });
  const finishing = f.child.finish(); f.close();
  await exiting; await finishing;
  expect(f.child.readEvidence().after.waiting).toEqual({ cut: 0, completed: 0, failed: 0, termination: 0, exit: 0 });
});

it('retains the owned termination wait until its final close', async test => {
  const f = fixture(test), joining = f.child.killAndJoin();
  expect(f.child.readEvidence().after.waiting.termination).toBe(1);
  expect(f.child.readEvidence().after.terminationRequested).toBe(true);
  f.controller.abort(new Error('SYNTHETIC_TEST_ABORT'));
  expect(f.child.readEvidence().atAbort!.waiting.termination).toBe(1);
  f.process.emit('exit', null, 'SIGKILL');
  await Promise.resolve();
  expect(f.child.readEvidence().after.waiting.termination).toBe(1);
  f.close(); await joining;
  expect(f.child.readEvidence().after.waiting.termination).toBe(0);
  expect(f.child.readEvidence().close).toEqual({ code: null, signal: 'SIGKILL' });
});

it('writes abort and close observations into the existing retained child receipt', async test => {
  const f = fixture(test);
  let finishFixture!: () => Promise<void>;
  const files = await deletionProcessFixture({ ...test, signal: f.controller.signal,
    onTestFinished(callback) { finishFixture = async () => { await callback(test); }; },
  });
  let finishing: Promise<void> | undefined;
  const finish = () => finishing ??= finishFixture();
  test.onTestFinished(async () => {
    f.close(); await finish();
    if (test.task.result?.state === 'pass') await rm(dirname(files.root), { recursive: true, force: true });
  });
  const child = files.start('resumeCold', null), reason = new Error('SYNTHETIC_TEST_ABORT');
  const waiting = expect(child.message('completed')).rejects.toBe(reason);
  f.controller.abort(reason);
  await waiting;
  const joined = finish();
  f.close(); await joined;
  const receipt = JSON.parse(await readFile(join(dirname(files.root), 'children.private.json'), 'utf8'));
  expect(receipt).toEqual([{ status: 'fulfilled', value: { stdout: '', stderr: '', closed: true },
    observed: { atAbort: { waiting: { cut: 0, completed: 1, failed: 0, termination: 0, exit: 0 },
      messages: [], closed: false, terminationRequested: false },
    after: { waiting: { cut: 0, completed: 0, failed: 0, termination: 0, exit: 0 },
      messages: [], closed: true, terminationRequested: true }, close: { code: null, signal: 'SIGKILL' } },
  }]);
});
