import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { createRestoreStartupTestLifetime, releaseRestoreStartupTestResources } from './desktopRestoreStartupTestSupport.js';

let parents: string[];

beforeEach(context => {
  const ownedParents: string[] = [];
  parents = ownedParents;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass') {
      await Promise.all(ownedParents.map(root => rm(root, { recursive: true, force: true })));
    }
  });
});
afterEach(() => vi.restoreAllMocks());

describe('restore startup test evidence ownership', () => {
  it('cleans only a settled successful test after shared resources have been released', async context => {
    const completion = captureCompletion(context);
    const release = vi.fn();
    const lifetime = createRestoreStartupTestLifetime(completion.context, release);
    const root = await createRoot();
    await lifetime.run(async () => {
      await lifetime.step('fixturePreparation', async () => { lifetime.roots.push(root); });
      await lifetime.step('startupRollback', async () => {});
      await lifetime.step('restoredContentCheck', async () => {});
    });
    expect(() => lifetime.assertSharedStateReleased()).toThrow('DESKTOP_RESTORE_TEST_PREVIOUS_WORK_UNSETTLED');
    lifetime.releaseWhenSettled();
    lifetime.assertSharedStateReleased();
    expect(release).toHaveBeenCalledTimes(1);
    await expect(readFile(join(root, 'evidence'), 'utf8')).resolves.toBe('original');
    await completion.finish('pass');
    await expect(readFile(join(root, 'evidence'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('preserves the primary failure and last completed phase even after a later pass notification', async context => {
    const completion = captureCompletion(context);
    const lifetime = createRestoreStartupTestLifetime(completion.context, vi.fn());
    const original = new Error('synthetic original failure');
    const root = await createRoot();
    await expect(lifetime.run(async () => {
      await lifetime.step('fixturePreparation', async () => { lifetime.roots.push(root); });
      await lifetime.step('startupRollback', async () => { throw original; });
    })).rejects.toBe(original);
    lifetime.releaseWhenSettled();
    await completion.finish('fail');
    await completion.finish('pass');
    await expect(readFile(join(root, 'evidence'), 'utf8')).resolves.toBe('original');
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0] as string)).toEqual({
      diagnostic: 'desktopRestoreStartupTest', phase: 'startupRollback', lastCompletedPhase: 'fixturePreparation',
      bodySettled: true, resourceCleanup: 'completed', rootsRetained: true,
      resourceCleanupFailureCode: null, resourceCleanupFailureStages: [],
    });
  });

  it.for([false, true])('retains a timed-out body and late roots without resetting shared state (rejection: %s)', async (reject, context) => {
    const completion = captureCompletion(context);
    const shared = { value: 'owned' };
    const release = vi.fn(() => { shared.value = 'released'; });
    const lifetime = createRestoreStartupTestLifetime(completion.context, release);
    const root = await createRoot();
    const lateRoot = join(root, 'late');
    const entered = createGate();
    const gate = createGate();
    const original = new Error('synthetic late failure');
    const nextStep = vi.fn(async () => {});
    const pending = lifetime.run(async () => {
      await lifetime.step('fixturePreparation', async () => {
        lifetime.roots.push(root);
        entered.resolve();
        await gate.promise;
        expect(shared.value).toBe('owned');
        lifetime.roots.push(lateRoot);
        await mkdir(lateRoot);
        await writeFile(join(lateRoot, 'late-evidence'), 'retained');
        if (reject) throw original;
      });
      await lifetime.step('startupRollback', nextStep);
    });
    const outcome = pending.then(() => undefined, (error: unknown) => error);
    try {
      await entered.promise;
      lifetime.releaseWhenSettled();
      completion.abort();
      await completion.finish('fail');
      expect(() => lifetime.assertSharedStateReleased()).toThrow('DESKTOP_RESTORE_TEST_PREVIOUS_WORK_UNSETTLED');
      expect(release).not.toHaveBeenCalled();
      await expect(readFile(join(root, 'evidence'), 'utf8')).resolves.toBe('original');
      gate.resolve();
      expect(await outcome).toBe(reject ? original : completion.context.signal.reason);
      expect(nextStep).not.toHaveBeenCalled();
      lifetime.assertSharedStateReleased();
      expect(release).toHaveBeenCalledTimes(1);
      await completion.finish('pass');
      await expect(readFile(join(lateRoot, 'late-evidence'), 'utf8')).resolves.toBe('retained');

      const nextCompletion = captureCompletion(context);
      const next = createRestoreStartupTestLifetime(nextCompletion.context, vi.fn());
      const nextRoot = await createRoot();
      await next.run(async () => { next.roots.push(nextRoot); });
      next.releaseWhenSettled();
      await nextCompletion.finish('pass');
      await expect(readFile(join(nextRoot, 'evidence'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, 'evidence'), 'utf8')).resolves.toBe('original');
      expect(vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(line as string).bodySettled))
        .toEqual([false, true, true]);
    } finally {
      gate.resolve();
      await outcome;
    }
  });

  it('retains an aborted body that had already succeeded', async context => {
    const completion = captureCompletion(context);
    const lifetime = createRestoreStartupTestLifetime(completion.context, vi.fn());
    const root = await createRoot();
    await lifetime.run(async () => { lifetime.roots.push(root); });
    lifetime.releaseWhenSettled();
    completion.abort();
    await completion.finish('pass');
    await expect(readFile(join(root, 'evidence'), 'utf8')).resolves.toBe('original');
  });

  it('does not allow another test to reset shared state after failed late resource cleanup', async context => {
    const completion = captureCompletion(context);
    const failure = new Error('synthetic cleanup failure');
    const lifetime = createRestoreStartupTestLifetime(completion.context, () => releaseRestoreStartupTestResources(
      [{ close() { throw failure; } }], vi.fn(), vi.fn(),
    ));
    const gate = createGate();
    const root = await createRoot();
    const pending = lifetime.run(async () => { lifetime.roots.push(root); await gate.promise; });
    const outcome = pending.then(() => undefined, (error: unknown) => error);
    try {
      lifetime.releaseWhenSettled();
      completion.abort();
      await completion.finish('fail');
      gate.resolve();
      expect(await outcome).toBe(completion.context.signal.reason);
      expect(() => lifetime.assertSharedStateReleased()).toThrow('DESKTOP_RESTORE_TEST_PREVIOUS_WORK_UNSETTLED');
      // The real late path has no second afterEach; its first report must suffice.
      expect(JSON.parse(vi.mocked(console.error).mock.calls.at(-1)![0] as string)).toMatchObject({
        resourceCleanup: 'failed', resourceCleanupFailureCode: 'resourceCleanupFailed',
        resourceCleanupFailureStages: ['clientClose'], bodySettled: true, rootsRetained: true,
      });
      expect(() => lifetime.releaseWhenSettled()).toThrow(expect.objectContaining({ errors: [failure] }));
      await expect(readFile(join(root, 'evidence'), 'utf8')).resolves.toBe('original');
      expect(JSON.parse(vi.mocked(console.error).mock.calls.at(-1)![0] as string).resourceCleanup).toBe('failed');
    } finally {
      gate.resolve();
      await outcome;
    }
  });

  it('attempts every client and reset while keeping resource cleanup errors separate', () => {
    const first = new Error('synthetic close failure');
    const second = new Error('synthetic mock reset failure');
    const order: string[] = [];
    expect(() => releaseRestoreStartupTestResources([
      { close() { order.push('first'); throw first; } },
      { close() { order.push('second'); } },
    ], () => { order.push('mocks'); throw second; }, () => { order.push('environment'); }))
      .toThrow(expect.objectContaining({ errors: [first, second] }));
    expect(order).toEqual(['first', 'second', 'mocks', 'environment']);
  });
});

function captureCompletion(context: TestContext) {
  let finish: Parameters<TestContext['onTestFinished']>[0] | undefined;
  const controller = new AbortController();
  return {
    context: {
      signal: controller.signal,
      onTestFinished(callback: Parameters<TestContext['onTestFinished']>[0]) { finish = callback; },
    },
    abort: () => controller.abort(),
    async finish(state: 'pass' | 'fail') {
      if (!finish) throw new Error('Completion hook was not registered');
      await finish({ ...context, task: { ...context.task, result: { state } } });
    },
  };
}

function createGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function createRoot(): Promise<string> {
  const ownedParents = parents;
  const parent = await mkdtemp(join(tmpdir(), 'eky-restore-startup-evidence-'));
  ownedParents.push(parent);
  const root = join(parent, 'owned');
  await mkdir(root);
  await writeFile(join(root, 'evidence'), 'original');
  return root;
}
