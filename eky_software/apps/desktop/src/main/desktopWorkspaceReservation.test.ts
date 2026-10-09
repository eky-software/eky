import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as waitForReservationRelease } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireWorkspaceProcessReservation,
  readWorkspaceProcessReservationIdentity,
  WorkspaceProcessReservationError,
  type WorkspaceProcessReservation,
} from '../runtime/workspaceProcessReservation.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { acquireDesktopWorkspaceReservation } from './desktopComposition.js';

vi.mock('electron', () => ({
  BrowserWindow: class {}, MessageChannelMain: class {}, dialog: {}, ipcMain: {},
  net: {}, safeStorage: {}, session: {}, shell: {}, utilityProcess: {},
}));
vi.mock('../runtime/workspaceProcessReservation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../runtime/workspaceProcessReservation.js')>(),
  acquireWorkspaceProcessReservation: vi.fn(),
  readWorkspaceProcessReservationIdentity: vi.fn(),
}));
vi.mock('node:timers/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:timers/promises')>(),
  setTimeout: vi.fn(),
}));

const identity = 'a'.repeat(64);
const userDataRoot = join(tmpdir(), 'eky-reservation-owner-test');
const acquire = vi.mocked(acquireWorkspaceProcessReservation);
const readIdentity = vi.mocked(readWorkspaceProcessReservationIdentity);
const waitForRelease = vi.mocked(waitForReservationRelease);

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function reservation() {
  const loss = new AbortController();
  const handle = {
    identity,
    invalidated: loss.signal,
    assertOwned: vi.fn(async () => { if (loss.signal.aborted) throw new Error('lost'); }),
    release: vi.fn(async () => { loss.abort(); }),
  } satisfies WorkspaceProcessReservation;
  return { loss, handle };
}

async function fixture() {
  const initial = reservation();
  const reclaimed = reservation();
  acquire.mockResolvedValueOnce(initial.handle).mockResolvedValueOnce(reclaimed.handle);
  const assertSingleInstanceOwnership = vi.fn();
  const signal = new AbortController();
  const owner = await acquireDesktopWorkspaceReservation({
    userDataRoot, assertSingleInstanceOwnership, signal: signal.signal,
  });
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const handle = await lease.acquire('create');
  const assertAuthority = vi.fn(lease.captureCurrentOwner(['create']));
  const transfer = owner.bind(randomUUID(), assertAuthority);
  return { owner, transfer, initial, reclaimed, assertSingleInstanceOwnership, signal, lease, handle, assertAuthority };
}

beforeEach(() => {
  acquire.mockReset();
  readIdentity.mockReset().mockResolvedValue(identity);
  waitForRelease.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('desktop composition workspace reservation owner', () => {
  it('releases initial ownership cancelled between acquisition and its continuation', async () => {
    const initial = reservation();
    const signal = new AbortController();
    acquire.mockImplementationOnce(() => {
      const result = Promise.resolve(initial.handle);
      queueMicrotask(() => signal.abort());
      return result;
    });
    await expect(acquireDesktopWorkspaceReservation({
      userDataRoot, signal: signal.signal, assertSingleInstanceOwnership() {},
    })).rejects.toMatchObject({ reason: 'aborted' });
    expect(initial.handle.release).toHaveBeenCalledOnce();
  });

  it('transfers once, requires a fresh grant and reclaims before main mutation', async () => {
    const f = await fixture();
    await expect(f.owner.assertMainOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await f.transfer.prepare(f.signal.signal);
    expect(f.initial.handle.release).toHaveBeenCalledOnce();
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    await expect(f.owner.assertMainOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await f.transfer.reclaimAfterExit(new AbortController().signal);
    await f.owner.assertMainOwned();
    expect(acquire.mock.calls[1]?.[0]).toMatchObject({ expectedIdentity: identity, userDataRoot });
    expect(f.assertAuthority).toHaveBeenCalled();
    expect(f.assertSingleInstanceOwnership.mock.calls.length).toBeGreaterThan(2);
    const close = f.owner.close();
    expect(f.owner.close()).toBe(close);
    await close;
    expect(f.reclaimed.handle.release).toHaveBeenCalledOnce();
    await expect(f.owner.assertMainOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
  });

  it('rejects a grant without asynchronous authorization', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    expect(() => f.transfer.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await expect(f.transfer.reclaimAfterExit(new AbortController().signal)).rejects.toThrow();
  });

  it.each(['lease', 'singleInstance'] as const)('rechecks %s after asynchronous grant validation', async mode => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    const check = deferred<string>();
    readIdentity.mockReturnValueOnce(check.promise);
    const grant = f.transfer.assertGrant(f.signal.signal);
    const failed = expect(grant).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    if (mode === 'lease') {
      await f.handle.release();
      await f.lease.acquire('create');
    } else {
      f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lock lost'); });
    }
    check.resolve(identity);
    await failed;
    expect(() => f.transfer.assertCurrent()).toThrow();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
  });

  it('checks the captured operation again at the synchronous grant boundary', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.assertGrant(f.signal.signal);
    await f.handle.release();
    await f.lease.acquire('create');
    expect(() => f.transfer.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
  });

  it('does not release a held reservation after cancellation during preparation', async () => {
    const f = await fixture();
    const check = deferred();
    f.initial.handle.assertOwned.mockReturnValueOnce(check.promise);
    const prepare = f.transfer.prepare(f.signal.signal);
    const failed = expect(prepare).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    f.signal.abort();
    check.resolve();
    await failed;
    expect(f.initial.handle.release).not.toHaveBeenCalled();
    await f.transfer.reclaimAfterExit(new AbortController().signal);
    await f.owner.assertMainOwned();
    expect(acquire).toHaveBeenCalledOnce();
    await f.owner.close();
  });

  it('records an intentional release even if cancellation happens during release', async () => {
    const f = await fixture();
    const release = deferred();
    const releaseStarted = deferred();
    f.initial.handle.release.mockImplementationOnce(() => {
      releaseStarted.resolve();
      f.initial.loss.abort();
      return release.promise;
    });
    const prepare = f.transfer.prepare(f.signal.signal);
    const failed = expect(prepare).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await releaseStarted.promise;
    f.signal.abort();
    release.resolve();
    await failed;
    await f.transfer.reclaimAfterExit(new AbortController().signal);
    await f.owner.assertMainOwned();
    expect(acquire).toHaveBeenCalledTimes(2);
    await f.owner.close();
  });

  it('cannot reclaim while a preparation callback is still pending', async () => {
    const f = await fixture();
    const check = deferred();
    f.initial.handle.assertOwned.mockReturnValueOnce(check.promise);
    const prepare = f.transfer.prepare(f.signal.signal);
    const failed = expect(prepare).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await expect(f.transfer.reclaimAfterExit(new AbortController().signal)).rejects.toThrow();
    check.resolve();
    await failed;
    expect(f.initial.handle.release).not.toHaveBeenCalled();
  });

  it('does not publish a late acquisition after reclaim cancellation', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    const late = deferred<WorkspaceProcessReservation>();
    acquire.mockReset().mockReturnValueOnce(late.promise);
    const signal = new AbortController();
    const reclaim = f.transfer.reclaimAfterExit(signal.signal);
    const failed = expect(reclaim).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    signal.abort();
    f.transfer.invalidate();
    late.resolve(f.reclaimed.handle);
    await failed;
    expect(f.reclaimed.handle.release).toHaveBeenCalledOnce();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
    expect(() => f.owner.bind(randomUUID(), () => {})).toThrow();
  });

  it('rejects changed root identity and preserves closed admission', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    readIdentity.mockResolvedValueOnce('b'.repeat(64));
    await expect(f.transfer.assertGrant(f.signal.signal)).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
  });

  it('keeps admission closed during busy reclaim and requires the same identity on every attempt', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    const wait = deferred();
    const waiting = deferred();
    acquire.mockReset().mockRejectedValueOnce(new WorkspaceProcessReservationError('busy'))
      .mockResolvedValueOnce(f.reclaimed.handle);
    waitForRelease.mockImplementationOnce(async () => { waiting.resolve(); await wait.promise; });
    const reclaim = f.transfer.reclaimAfterExit(f.signal.signal);
    await waiting.promise;
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
    await expect(f.owner.close()).rejects.toThrow();
    expect(acquire).toHaveBeenCalledOnce();
    wait.resolve();
    await reclaim;
    await f.owner.assertMainOwned();
    expect(acquire).toHaveBeenCalledTimes(2);
    for (const [options] of acquire.mock.calls) {
      expect(options).toMatchObject({ expectedIdentity: identity, userDataRoot, signal: f.signal.signal });
    }
    expect(waitForRelease).toHaveBeenCalledWith(10, undefined, { signal: f.signal.signal });
    await f.owner.close();
  });

  it.each(['signal', 'singleInstance', 'invalidated'] as const)('stops busy reclaim when %s is lost', async mode => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    acquire.mockReset().mockRejectedValue(new WorkspaceProcessReservationError('busy'));
    waitForRelease.mockImplementationOnce(async () => {
      if (mode === 'signal') f.signal.abort();
      else if (mode === 'singleInstance') f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lost'); });
      else f.transfer.invalidate();
    });
    await expect(f.transfer.reclaimAfterExit(f.signal.signal)).rejects.toThrow();
    expect(acquire).toHaveBeenCalledOnce();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
    await expect(f.owner.close()).rejects.toThrow();
  });

  it.each([
    new WorkspaceProcessReservationError('busy', true),
    new WorkspaceProcessReservationError('unavailable'),
    new WorkspaceProcessReservationError('identityChanged'),
    new Error('unknown'),
  ])('does not retry a failed or uncertain acquisition: %s', async error => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    acquire.mockReset().mockRejectedValue(error);
    await expect(f.transfer.reclaimAfterExit(f.signal.signal)).rejects.toThrow();
    expect(acquire).toHaveBeenCalledOnce();
    expect(waitForRelease).not.toHaveBeenCalled();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
  });

  it('releases a late acquired reservation when the main lock was lost during acquisition', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    acquire.mockReset().mockImplementationOnce(async () => {
      f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lost'); });
      return f.reclaimed.handle;
    });
    await expect(f.transfer.reclaimAfterExit(f.signal.signal)).rejects.toThrow();
    expect(f.reclaimed.handle.release).toHaveBeenCalledOnce();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
  });

  it('cancels an actual pending poll without making another acquisition', async () => {
    const actual = await vi.importActual<typeof import('node:timers/promises')>('node:timers/promises');
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    const waiting = deferred();
    acquire.mockReset().mockRejectedValue(new WorkspaceProcessReservationError('busy'));
    waitForRelease.mockImplementationOnce((milliseconds, value, options) => {
      const pending = actual.setTimeout(milliseconds, value, options);
      waiting.resolve();
      return pending;
    });
    const reclaim = f.transfer.reclaimAfterExit(f.signal.signal);
    const failed = expect(reclaim).rejects.toThrow();
    await waiting.promise;
    f.signal.abort();
    await failed;
    expect(acquire).toHaveBeenCalledOnce();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
  });

  it.each(['signal', 'singleInstance'] as const)('does not publish ownership lost during final assertion: %s', async mode => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    const checking = deferred();
    const finishCheck = deferred();
    f.reclaimed.handle.assertOwned.mockImplementationOnce(async () => {
      checking.resolve();
      await finishCheck.promise;
    });
    const reclaim = f.transfer.reclaimAfterExit(f.signal.signal);
    const failed = expect(reclaim).rejects.toThrow();
    await checking.promise;
    if (mode === 'signal') f.signal.abort();
    else f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lost'); });
    finishCheck.resolve();
    await failed;
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
    expect(() => f.owner.bind(randomUUID(), () => {})).toThrow();
    await expect(f.owner.close()).rejects.toThrow();
    expect(f.reclaimed.handle.release).not.toHaveBeenCalled();
  });

  it('blocks main work when its reservation is lost', async () => {
    const f = await fixture();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    f.initial.loss.abort();
    await expect(f.owner.assertMainOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    expect(() => f.owner.bind(randomUUID(), f.assertAuthority)).toThrow();
  });

  it('does not allow an old generation to invalidate or grant a later one', async () => {
    const f = await fixture();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    const next = f.owner.bind(randomUUID(), f.assertAuthority);
    f.transfer.invalidate();
    expect(() => f.transfer.assertCurrent()).toThrow();
    await next.prepare(f.signal.signal);
    await next.assertGrant(f.signal.signal);
    next.assertCurrent();
    await next.reclaimAfterExit(f.signal.signal);
    await f.owner.close();
  });

  it('keeps real local IPC exclusion across main, child and main again', async () => {
    const actual = await vi.importActual<typeof import('../runtime/workspaceProcessReservation.js')>(
      '../runtime/workspaceProcessReservation.js',
    );
    acquire.mockImplementation(actual.acquireWorkspaceProcessReservation);
    readIdentity.mockImplementation(actual.readWorkspaceProcessReservationIdentity);
    const root = await mkdtemp(join(tmpdir(), 'eky-main-reservation-'));
    const signal = new AbortController().signal;
    const owner = await acquireDesktopWorkspaceReservation({
      userDataRoot: root, signal, assertSingleInstanceOwnership() {},
    });
    let child: WorkspaceProcessReservation | undefined;
    try {
      await expect(actual.acquireWorkspaceProcessReservation({ userDataRoot: root, signal })).rejects.toThrow();
      const transfer = owner.bind(randomUUID(), () => {});
      await transfer.prepare(signal);
      child = await actual.acquireWorkspaceProcessReservation({
        userDataRoot: root, expectedIdentity: transfer.descriptor.identity, signal,
      });
      await transfer.assertGrant(signal);
      transfer.assertCurrent();
      await expect(owner.assertMainOwned()).rejects.toThrow();
      await child.release();
      child = undefined;
      await transfer.reclaimAfterExit(signal);
      await owner.assertMainOwned();
      await expect(actual.acquireWorkspaceProcessReservation({ userDataRoot: root, signal })).rejects.toThrow();
    } finally {
      await child?.release();
      await owner.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
