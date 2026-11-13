import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as waitForReservationRelease } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireWorkspaceProcessReservation,
  readWorkspaceProcessReservationIdentity,
  WorkspaceProcessReservationError,
  type WorkspaceProcessReservation,
  type WorkspaceProcessReservationPreparation,
} from '../runtime/workspaceProcessReservation.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { runOwnedProfileInspection } from '../profileBackup/runOwnedProfileInspection.js';
import { resolveProfileInspectionCopyRoot } from '../runtime/profileInspectionMessages.js';
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

async function fixture(prepareMainOwned?: WorkspaceProcessReservationPreparation) {
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
  const transfer = owner.bind(randomUUID(), assertAuthority, prepareMainOwned);
  return { owner, transfer, initial, reclaimed, assertSingleInstanceOwnership, signal, lease, handle, assertAuthority };
}

beforeEach(() => {
  acquire.mockReset();
  readIdentity.mockReset().mockResolvedValue(identity);
  waitForRelease.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('captured main reservation tenure', () => {
  async function mainFixture() {
    const f = await fixture();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    return f;
  }

  it('captures an immutable main-only receipt and performs fresh physical checks', async () => {
    const f = await mainFixture();
    const receipt = f.owner.captureMainOwnership();
    const reads = f.initial.handle.assertOwned.mock.calls.length;
    expect(Object.isFrozen(receipt)).toBe(true);
    receipt.assertCurrent();
    await receipt.assertOwned();
    await receipt.assertOwned();
    expect(f.initial.handle.assertOwned).toHaveBeenCalledTimes(reads + 2);
    expect(acquire).toHaveBeenCalledOnce();
    expect(f.initial.handle.release).not.toHaveBeenCalled();
    await f.handle.release();
    await f.owner.close();
  });

  it.each(['invalidGeneration', 'rejectedAuthority'] as const)(
    'keeps the current receipt after a rejected %s bind', async variant => {
      const f = await mainFixture();
      const receipt = f.owner.captureMainOwnership();
      const rejected = new Error('synthetic rejected binding');
      expect(() => f.owner.bind(variant === 'invalidGeneration' ? 'invalid' : randomUUID(), () => {
        if (variant === 'rejectedAuthority') throw rejected;
      })).toThrow();
      receipt.assertCurrent();
      await receipt.assertOwned();
      expect(f.initial.handle.release).not.toHaveBeenCalled();
      await f.handle.release();
      await f.owner.close();
    },
  );

  it.each(['bound', 'granted'] as const)(
    'rejects capture and permanently expires old receipts during a %s transfer', async phase => {
      const f = await mainFixture();
      const receipt = f.owner.captureMainOwnership();
      const transfer = f.owner.bind(randomUUID(), f.assertAuthority);
      if (phase === 'granted') {
        await transfer.prepare(f.signal.signal);
        await transfer.assertGrant(f.signal.signal);
        transfer.assertCurrent();
      }
      expect(() => f.owner.captureMainOwnership()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await transfer.reclaimAfterExit(f.signal.signal);
      // Bound-only reclaim keeps the exact same physical handle, not the tenure.
      expect(acquire).toHaveBeenCalledTimes(phase === 'bound' ? 1 : 2);
      expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await f.owner.captureMainOwnership().assertOwned();
      await f.handle.release();
      await f.owner.close();
    },
  );

  it.each([
    ['retained', 'success'], ['retained', 'failure'],
    ['reacquired', 'success'], ['reacquired', 'failure'],
  ] as const)('rejects a late %s-handle %s without touching the successor', async (handle, outcome) => {
    const f = await mainFixture();
    const receipt = f.owner.captureMainOwnership();
    const read = deferred();
    f.initial.handle.assertOwned.mockReturnValueOnce(read.promise);
    const pending = expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    const transfer = f.owner.bind(randomUUID(), f.assertAuthority);
    if (handle === 'reacquired') {
      await transfer.prepare(f.signal.signal);
      await transfer.assertGrant(f.signal.signal);
      transfer.assertCurrent();
    }
    await transfer.reclaimAfterExit(f.signal.signal);
    const successor = f.owner.captureMainOwnership();
    const callbacks = f.assertSingleInstanceOwnership.mock.calls.length;
    const reads = f.reclaimed.handle.assertOwned.mock.calls.length;
    if (outcome === 'success') read.resolve();
    else read.reject(new Error('synthetic old native read failure'));
    await pending;
    expect(f.assertSingleInstanceOwnership).toHaveBeenCalledTimes(callbacks);
    expect(f.reclaimed.handle.assertOwned).toHaveBeenCalledTimes(reads);
    await successor.assertOwned();
    await f.owner.assertMainOwned();
    await f.handle.release();
    await f.owner.close();
  });

  it.each([
    ['capture', 'success'], ['capture', 'failure'],
    ['current', 'success'], ['current', 'failure'],
    ['owned', 'success'], ['owned', 'failure'],
  ] as const)('rechecks tenure after a synchronous %s callback with %s', async (boundary, outcome) => {
    const f = await mainFixture();
    const receipt = f.owner.captureMainOwnership();
    let transfer: ReturnType<typeof f.owner.bind> | undefined;
    f.assertSingleInstanceOwnership.mockImplementationOnce(() => {
      transfer = f.owner.bind(randomUUID(), f.assertAuthority);
      if (outcome === 'failure') throw new Error('synthetic old instance callback failure');
    });
    if (boundary === 'owned') {
      await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    } else {
      expect(() => boundary === 'capture' ? f.owner.captureMainOwnership() : receipt.assertCurrent())
        .toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    }
    expect(transfer).toBeDefined();
    await transfer!.reclaimAfterExit(f.signal.signal);
    await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await f.owner.captureMainOwnership().assertOwned();
    await f.handle.release();
    await f.owner.close();
  });

  it.each(['native', 'singleInstance', 'lossSignal', 'invalidated'] as const)(
    'keeps a current-tenure %s ownership failure sticky', async failure => {
      const f = await mainFixture();
      const receipt = f.owner.captureMainOwnership();
      if (failure === 'native') {
        f.initial.handle.assertOwned.mockRejectedValueOnce(new Error('synthetic current native failure'));
      } else if (failure === 'singleInstance') {
        f.assertSingleInstanceOwnership.mockImplementationOnce(() => { throw new Error('synthetic instance loss'); });
      } else if (failure === 'lossSignal') f.initial.loss.abort();
      else f.owner.invalidate();
      await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => f.owner.captureMainOwnership()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(f.owner.assertMainOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(f.initial.handle.release).not.toHaveBeenCalled();
      await f.handle.release();
      await expect(f.owner.close()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    },
  );

  it('expires receipts immediately on close and shares the physical release', async () => {
    const f = await mainFixture();
    const receipt = f.owner.captureMainOwnership();
    const release = deferred();
    f.initial.handle.release.mockReturnValueOnce(release.promise);
    const closing = f.owner.close();
    expect(f.owner.close()).toBe(closing);
    expect(() => f.owner.captureMainOwnership()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    release.resolve();
    await closing;
    expect(f.initial.handle.release).toHaveBeenCalledOnce();
    expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await f.handle.release();
  });

  it.each(['success', 'failure'] as const)('rejects a pending native %s after close', async outcome => {
    const f = await mainFixture();
    const receipt = f.owner.captureMainOwnership();
    const read = deferred();
    f.initial.handle.assertOwned.mockReturnValueOnce(read.promise);
    const pending = expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await f.owner.close();
    const callbacks = f.assertSingleInstanceOwnership.mock.calls.length;
    if (outcome === 'success') read.resolve();
    else read.reject(new Error('synthetic late native failure after close'));
    await pending;
    expect(f.assertSingleInstanceOwnership).toHaveBeenCalledTimes(callbacks);
    expect(f.initial.handle.release).toHaveBeenCalledOnce();
    expect(() => f.owner.captureMainOwnership()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    await f.handle.release();
  });

  it.for(['missing', 'replaced'] as const)('rejects an actually %s native root through the captured receipt', async (kind, context) => {
    const actual = await vi.importActual<typeof import('../runtime/workspaceProcessReservation.js')>(
      '../runtime/workspaceProcessReservation.js',
    );
    let native: WorkspaceProcessReservation | undefined;
    acquire.mockImplementation(async options => {
      native = await actual.acquireWorkspaceProcessReservation(options);
      return native;
    });
    const root = await mkdtemp(join(tmpdir(), 'eky-main-tenure-root-'));
    const liveRoot = join(root, 'live');
    await mkdir(liveRoot);
    let cleanupVerified = false;
    context.onTestFinished(async () => {
      if (context.task.result?.state === 'pass' && cleanupVerified) await rm(root, { recursive: true });
    });
    let firstFailure: { cause: unknown } | undefined;
    try {
      const owner = await acquireDesktopWorkspaceReservation({ userDataRoot: liveRoot,
        signal: new AbortController().signal, assertSingleInstanceOwnership() {} });
      const receipt = owner.captureMainOwnership();
      await receipt.assertOwned();
      await rename(liveRoot, join(root, 'original'));
      if (kind === 'replaced') await mkdir(liveRoot);
      await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => owner.captureMainOwnership()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(owner.close()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(native?.invalidated.aborted).toBe(true);
    } catch (cause) { firstFailure = { cause }; }
    // Only this test's native socket remains; all of its checks have settled.
    try { await native?.release(); cleanupVerified = true; }
    catch (cause) {
      if (firstFailure !== undefined) throw new AggregateError([firstFailure.cause, cause], 'TEST_RESERVATION_CLEANUP_FAILED',
        { cause: firstFailure.cause });
      throw cause;
    }
    if (firstFailure !== undefined) throw firstFailure.cause;
  });
});

describe('selector lifecycle with the desktop reservation owner', () => {
  async function selectorFixture() {
    const f = await fixture();
    // Discard the fixture's unused binding without releasing its main reservation.
    await f.transfer.reclaimAfterExit(f.signal.signal);
    const relaunch = vi.fn();
    const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(relaunch);
    const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({
      assertSelectorCurrent: f.owner.assertInstallationCurrent,
      reservation: f.owner,
      maintenanceLease: f.lease,
      runtimeRelaunch,
    });
    await lifecycle.quiesceWrites(null);
    await lifecycle.stopAndProveHandlesClosed(null);
    return { ...f, lifecycle, runtimeRelaunch, relaunch };
  }

  it('proves the reclaimed main reservation before returning to the selector', async () => {
    const f = await selectorFixture();
    const transfer = f.owner.bind(randomUUID(), f.lease.captureCurrentOwner(['create']));
    try {
      await transfer.prepare(f.signal.signal);
      await transfer.assertGrant(f.signal.signal);
      transfer.assertCurrent();
      expect(() => f.owner.assertMainCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      // The process fixture reports exit; the real owner performs reclaim/readback.
      await transfer.reclaimAfterExit(f.signal.signal);
      const before = f.reclaimed.handle.assertOwned.mock.calls.length;
      await f.lifecycle.assertNoActiveWorkspaceRuntime();
      expect(f.reclaimed.handle.assertOwned.mock.calls.length).toBeGreaterThan(before);
      await f.lifecycle.ensurePreviousWorkspaceRunning(null);
      expect(f.relaunch).not.toHaveBeenCalled();
      await f.handle.release();
      f.runtimeRelaunch.complete();
      expect(f.relaunch).toHaveBeenCalledOnce();
    } finally { await f.owner.close(); }
  });

  it.each(['bound', 'granted'] as const)('does not reuse stop evidence while a candidate is %s', async phase => {
    const f = await selectorFixture();
    const transfer = f.owner.bind(randomUUID(), f.lease.captureCurrentOwner(['create']));
    try {
      if (phase === 'granted') {
        await transfer.prepare(f.signal.signal);
        await transfer.assertGrant(f.signal.signal);
        transfer.assertCurrent();
      }
      await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    } finally { await transfer.reclaimAfterExit(f.signal.signal); }
    try {
      await f.owner.assertMainOwned();
      await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(f.runtimeRelaunch.isRequested()).toBe(false);
    } finally { await f.handle.release(); await f.owner.close(); }
  });

  it('does not authorize selector return after the physical reservation is lost', async () => {
    const f = await selectorFixture();
    f.initial.loss.abort();
    try {
      await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(f.runtimeRelaunch.isRequested()).toBe(false);
    } finally {
      await f.handle.release();
      await expect(f.owner.close()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    }
  });
});

describe('desktop composition workspace reservation owner', () => {
  it.for(['bound', 'unbound'] as const)(
    'consumes the real inspection grant once after repeatable %s selection checks', async (kind, context) => {
      const actual = await vi.importActual<typeof import('../runtime/workspaceProcessReservation.js')>(
        '../runtime/workspaceProcessReservation.js',
      );
      acquire.mockImplementation(actual.acquireWorkspaceProcessReservation);
      readIdentity.mockImplementation(actual.readWorkspaceProcessReservationIdentity);
      const root = await mkdtemp(join(tmpdir(), 'eky-inspection-grant-'));
      const reservationRoot = join(root, 'reservation');
      await mkdir(reservationRoot);
      const signal = new AbortController().signal;
      const owner = await acquireDesktopWorkspaceReservation({
        userDataRoot: reservationRoot, signal, assertSingleInstanceOwnership() {},
      });
      let child: WorkspaceProcessReservation | undefined;
      const selection = vi.fn(async (assertCurrent: () => void) => {
        assertCurrent(); await Promise.resolve(); assertCurrent();
      });
      let grants = 0;
      let cleanupVerified = false;
      let firstFailure: { error: unknown } | undefined;
      context.onTestFinished(async () => {
        if (context.task.result?.state === 'pass' && cleanupVerified) {
          await rm(root, { recursive: true, force: true });
        }
      });
      try {
        await expect(runOwnedProfileInspection({
          operationId: randomUUID(), signal, reservation: owner, assertAuthority() {},
          target: kind === 'unbound' ? { kind } : {
            kind, installationRoot: root, workspaceId: randomUUID(),
            lineageIdentity: { formatVersion: 1, profileId: 'c'.repeat(64) },
            assertSelectionCurrent: selection,
          },
          prepare: control => control.assertMainOwned(),
          // Real Main and IPC ownership; only the child protocol and exit are modeled.
          async inspect(_preparation, input) {
            const transfer = input.reservationTransfer;
            try {
              await transfer.prepare(input.signal);
              child = await actual.acquireWorkspaceProcessReservation({
                userDataRoot: reservationRoot, expectedIdentity: transfer.descriptor.identity, signal,
              });
              await transfer.assertGrant(input.signal);
              transfer.assertCurrent();
              grants += 1;
              await writeFile(join(resolveProfileInspectionCopyRoot(transfer.descriptor), 'profile.sqlite'),
                'synthetic protocol payload', { flag: 'wx' });
              return 'receipt';
            } finally {
              await child?.release(); child = undefined;
              await transfer.reclaimAfterExit(signal);
            }
          },
          accept: async () => 'accepted',
        })).resolves.toBe('accepted');
        expect(grants).toBe(1);
        expect(selection.mock.calls.length > 0).toBe(kind === 'bound');
        expect(await readdir(reservationRoot)).toEqual([]);
        await owner.assertMainOwned();
      } catch (error) {
        firstFailure = { error };
      } finally {
        try { await child?.release(); }
        catch (error) { firstFailure ??= { error }; }
        try { await owner.close(); cleanupVerified = true; }
        catch (error) { firstFailure ??= { error }; }
      }
      if (firstFailure !== undefined) throw firstFailure.error;
    },
  );

  it('observes only the granted phase repeatedly without consuming or reclaiming it', async () => {
    const f = await fixture();
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    await f.transfer.prepare(f.signal.signal);
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    await f.transfer.assertGrant(f.signal.signal);
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    f.transfer.assertCurrent();
    const acquisitions = acquire.mock.calls.length;
    const identityReads = readIdentity.mock.calls.length;
    f.transfer.assertGrantedCurrent();
    f.transfer.assertGrantedCurrent();
    expect(acquire).toHaveBeenCalledTimes(acquisitions);
    expect(readIdentity).toHaveBeenCalledTimes(identityReads);
    expect(() => f.owner.assertMainCurrent()).toThrow();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    await f.owner.assertMainOwned();
    await f.handle.release();
    await f.owner.close();
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
  });

  it('rejects a stale granted observer without inspecting its old authority or harming the successor', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    const successor = f.owner.bind(randomUUID(), f.lease.captureCurrentOwner(['create']));
    await successor.prepare(f.signal.signal);
    await successor.assertGrant(f.signal.signal);
    successor.assertCurrent();
    f.assertAuthority.mockImplementation(() => { throw new Error('stale authority'); });
    f.assertAuthority.mockClear();
    const instanceChecks = f.assertSingleInstanceOwnership.mock.calls.length;
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    expect(f.assertAuthority).not.toHaveBeenCalled();
    expect(f.assertSingleInstanceOwnership).toHaveBeenCalledTimes(instanceChecks);
    successor.assertGrantedCurrent();
    acquire.mockResolvedValueOnce(reservation().handle);
    await successor.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it('does not observe pending preparation or reclaim as a granted owner', async () => {
    const entered = deferred();
    const prepared = deferred();
    const f = await fixture(async () => { entered.resolve(); await prepared.promise; });
    const preparation = f.transfer.prepare(f.signal.signal);
    await entered.promise;
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    prepared.resolve();
    await preparation;
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    const acquired = deferred<WorkspaceProcessReservation>();
    acquire.mockReturnValueOnce(acquired.promise);
    const reclaim = f.transfer.reclaimAfterExit(f.signal.signal);
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    acquired.resolve(f.reclaimed.handle);
    await reclaim;
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    await f.handle.release();
    await f.owner.close();
  });

  it('rechecks the owner after a synchronous authority callback invalidates it', async () => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    f.assertAuthority.mockImplementationOnce(() => f.transfer.invalidate());
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    await expect(f.owner.close()).rejects.toThrow();
  });

  it.each(['abort', 'reclaim'] as const)('rejects synchronous authority-triggered %s', async mode => {
    const f = await fixture();
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    let reclaim: Promise<void> | undefined;
    f.assertAuthority.mockImplementationOnce(() => {
      if (mode === 'abort') f.signal.abort();
      else reclaim = f.transfer.reclaimAfterExit(new AbortController().signal);
    });
    expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    await (reclaim ?? f.transfer.reclaimAfterExit(new AbortController().signal));
    await f.handle.release();
    await f.owner.close();
  });

  it.each(['signal', 'lease', 'instance', 'invalidated'] as const)(
    'rejects a granted observation after losing %s', async mode => {
      const f = await fixture();
      await f.transfer.prepare(f.signal.signal);
      await f.transfer.assertGrant(f.signal.signal);
      f.transfer.assertCurrent();
      if (mode === 'signal') f.signal.abort();
      else if (mode === 'lease') await f.handle.release();
      else if (mode === 'instance') f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lost'); });
      else f.transfer.invalidate();
      expect(() => f.transfer.assertGrantedCurrent()).toThrow();
      expect(() => f.transfer.assertGrantedCurrent()).toThrow();
      if (mode === 'instance' || mode === 'invalidated') {
        await expect(f.owner.close()).rejects.toThrow();
      } else {
        await f.transfer.reclaimAfterExit(new AbortController().signal);
        await f.owner.close();
      }
    },
  );

  it('lends a repeatable preparing guard without granting main ownership or a child grant', async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    let captured!: () => void;
    f = await fixture(async (_signal, assertPreparationCurrent) => {
      captured = assertPreparationCurrent;
      expect(() => f.owner.assertMainCurrent()).toThrow();
      await expect(f.owner.assertMainOwned()).rejects.toThrow();
      expect(assertPreparationCurrent()).toBeUndefined();
      await Promise.resolve();
      expect(assertPreparationCurrent()).toBeUndefined();
      expect(f.initial.handle.release).not.toHaveBeenCalled();
    });
    await f.transfer.prepare(f.signal.signal);
    expect(() => captured()).toThrow();
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it('checks physical preparation ownership repeatedly without releasing or granting the reservation', async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (_signal, _assertCurrent, assertOwned) => {
      expect(assertOwned).toBeTypeOf('function');
      const checks = f.initial.handle.assertOwned.mock.calls.length;
      await assertOwned();
      await assertOwned();
      expect(f.initial.handle.assertOwned).toHaveBeenCalledTimes(checks + 2);
      expect(f.initial.handle.release).not.toHaveBeenCalled();
      await expect(f.owner.assertMainOwned()).rejects.toThrow();
      expect(() => f.transfer.assertGrantedCurrent()).toThrow();
    });
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it.each(['cancelled', 'leaseLost', 'instanceLost', 'invalidated', 'physicalLoss'] as const)(
    'rejects physical preparation ownership after %s during the read', async mode => {
      const entered = deferred();
      const read = deferred();
      let f!: Awaited<ReturnType<typeof fixture>>;
      f = await fixture(async (_signal, _assertCurrent, assertOwned) => {
        f.initial.handle.assertOwned.mockImplementationOnce(() => { entered.resolve(); return read.promise; });
        await assertOwned();
      });
      const preparation = f.transfer.prepare(f.signal.signal);
      const rejected = expect(preparation).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await entered.promise;
      if (mode === 'cancelled') f.signal.abort();
      else if (mode === 'leaseLost') await f.handle.release();
      else if (mode === 'instanceLost') f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lost'); });
      else if (mode === 'invalidated') f.owner.invalidate();
      else f.initial.loss.abort();
      read.resolve();
      await rejected;
      expect(f.initial.handle.release).not.toHaveBeenCalled();
      await expect(f.owner.close()).rejects.toThrow();
    },
  );

  it('retains the reservation when the physical preparation read rejects', async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (_signal, _assertCurrent, assertOwned) => {
      f.initial.handle.assertOwned.mockRejectedValueOnce(new Error('synthetic physical read failure'));
      await assertOwned();
    });
    await expect(f.transfer.prepare(f.signal.signal)).rejects.toMatchObject({ reason: 'lost' });
    expect(f.initial.handle.release).not.toHaveBeenCalled();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
    await expect(f.owner.close()).rejects.toThrow();
  });

  it('seals both preparation guards as soon as the callback finishes', async () => {
    const entered = deferred();
    const read = deferred();
    let assertCurrent!: () => void;
    let assertOwned!: () => Promise<void>;
    let f!: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (_signal, current, owned) => {
      assertCurrent = current;
      assertOwned = owned;
      f.initial.handle.assertOwned.mockImplementationOnce(() => { entered.resolve(); return read.promise; });
    });
    const preparation = f.transfer.prepare(f.signal.signal);
    await entered.promise;
    f.assertAuthority.mockImplementationOnce(() => { throw new Error('expired callback authority'); });
    const calls = f.assertAuthority.mock.calls.length;
    expect(() => assertCurrent()).toThrow();
    await expect(assertOwned()).rejects.toThrow();
    expect(f.assertAuthority).toHaveBeenCalledTimes(calls);
    f.assertAuthority.mockReset().mockImplementation(f.lease.captureCurrentOwner(['create']));
    read.resolve();
    await preparation;
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it('rejects stale preparation guards without reading old authority or harming a successor', async () => {
    let assertCurrent!: () => void;
    let assertOwned!: () => Promise<void>;
    const f = await fixture(async (_signal, current, owned) => { assertCurrent = current; assertOwned = owned; });
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.assertGrant(f.signal.signal);
    f.transfer.assertCurrent();
    f.assertAuthority.mockImplementation(() => { throw new Error('stale authority'); });
    const calls = f.assertAuthority.mock.calls.length;
    expect(() => assertCurrent()).toThrow();
    await expect(assertOwned()).rejects.toThrow();
    expect(f.assertAuthority).toHaveBeenCalledTimes(calls);
    await f.transfer.reclaimAfterExit(f.signal.signal);
    const next = f.owner.bind(randomUUID(), f.lease.captureCurrentOwner(['create']));
    await next.prepare(f.signal.signal);
    await next.assertGrant(f.signal.signal);
    next.assertCurrent();
    expect(() => assertCurrent()).toThrow();
    await expect(assertOwned()).rejects.toThrow();
    expect(f.assertAuthority).toHaveBeenCalledTimes(calls);
    next.assertGrantedCurrent();
    acquire.mockResolvedValueOnce(reservation().handle);
    await next.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it.each(['resolved', 'rejected'] as const)(
    'rejects a late %s physical preparation read without invalidating its successor', async outcome => {
      const entered = deferred();
      const read = deferred();
      let oldCheck!: Promise<unknown>;
      let f!: Awaited<ReturnType<typeof fixture>>;
      f = await fixture(async (_signal, _assertCurrent, assertOwned) => {
        f.initial.handle.assertOwned.mockImplementationOnce(() => { entered.resolve(); return read.promise; });
        // Deliberately retain a borrowed read beyond its allowed callback lifetime.
        oldCheck = assertOwned().then(() => 'unexpectedSuccess', error => error);
      });
      await f.transfer.prepare(f.signal.signal);
      await entered.promise;
      await f.transfer.reclaimAfterExit(f.signal.signal);
      const next = f.owner.bind(randomUUID(), f.lease.captureCurrentOwner(['create']));
      await next.prepare(f.signal.signal);
      await next.assertGrant(f.signal.signal);
      next.assertCurrent();
      f.assertAuthority.mockImplementation(() => { throw new Error('stale authority'); });
      const calls = f.assertAuthority.mock.calls.length;
      if (outcome === 'resolved') read.resolve();
      else read.reject(new Error('synthetic late physical read failure'));
      expect(await oldCheck).toMatchObject({ reason: 'lost' });
      expect(f.assertAuthority).toHaveBeenCalledTimes(calls);
      next.assertGrantedCurrent();
      acquire.mockResolvedValueOnce(reservation().handle);
      await next.reclaimAfterExit(f.signal.signal);
      await f.handle.release();
      await f.owner.close();
    },
  );

  it.each(['cancelled', 'leaseLost', 'instanceLost', 'invalidated'] as const)(
    'seals the preparation guard after %s without releasing the held reservation', async mode => {
      const entered = deferred();
      const finish = deferred();
      let captured!: () => void;
      const f = await fixture(async (_signal, assertPreparationCurrent) => {
        captured = assertPreparationCurrent;
        assertPreparationCurrent();
        entered.resolve();
        await finish.promise;
        assertPreparationCurrent();
      });
      const preparation = f.transfer.prepare(f.signal.signal);
      const failure = expect(preparation).rejects.toThrow();
      await entered.promise;
      if (mode === 'cancelled') f.signal.abort();
      else if (mode === 'leaseLost') await f.handle.release();
      else if (mode === 'instanceLost') f.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('lost'); });
      else f.owner.invalidate();
      expect(() => captured()).toThrow();
      finish.resolve();
      await failure;
      expect(() => captured()).toThrow();
      expect(f.initial.handle.release).not.toHaveBeenCalled();
      await expect(f.owner.close()).rejects.toThrow();
    },
  );

  it('does not let a sealed preparation guard invalidate or authorize a later generation', async () => {
    let captured!: () => void;
    const f = await fixture(async (_signal, assertPreparationCurrent) => { captured = assertPreparationCurrent; });
    await f.transfer.prepare(f.signal.signal);
    await f.transfer.reclaimAfterExit(f.signal.signal);
    const next = f.owner.bind(randomUUID(), f.assertAuthority);
    expect(() => captured()).toThrow();
    await next.prepare(f.signal.signal);
    await next.assertGrant(f.signal.signal);
    next.assertCurrent();
    acquire.mockResolvedValueOnce(reservation().handle);
    await next.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it('seals the borrowed guard when its preparation callback rejects', async () => {
    let captured!: () => void;
    let capturedOwned!: () => Promise<void>;
    const original = new Error('synthetic preparation failure');
    const f = await fixture(async (_signal, assertPreparationCurrent, assertPreparationOwned) => {
      captured = assertPreparationCurrent;
      capturedOwned = assertPreparationOwned;
      assertPreparationCurrent();
      throw original;
    });
    await expect(f.transfer.prepare(f.signal.signal)).rejects.toBe(original);
    expect(() => captured()).toThrow();
    await expect(capturedOwned()).rejects.toThrow();
    expect(f.initial.handle.release).not.toHaveBeenCalled();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    await f.handle.release();
    await f.owner.close();
  });

  it('keeps installation validity repeatable without granting main ownership or consuming a child grant', async () => {
    const f = await fixture();
    const assertRepeatable = () => {
      f.owner.assertInstallationCurrent();
      f.owner.assertInstallationCurrent();
    };
    assertRepeatable();
    expect(() => f.owner.assertMainCurrent()).toThrow();
    await f.transfer.prepare(f.signal.signal);
    assertRepeatable();
    await f.transfer.assertGrant(f.signal.signal);
    assertRepeatable();
    f.transfer.assertCurrent();
    assertRepeatable();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
    await f.transfer.reclaimAfterExit(f.signal.signal);
    assertRepeatable();
    await f.owner.assertMainOwned();
    const close = f.owner.close();
    expect(() => f.owner.assertInstallationCurrent()).toThrow();
    await close;
    expect(() => f.owner.assertInstallationCurrent()).toThrow();
  });

  it.each(['heldLoss', 'invalidatedTransfer', 'singleInstance'] as const)(
    'does not restore installation validity after %s', async mode => {
      const f = await fixture();
      if (mode === 'heldLoss') {
        await f.transfer.reclaimAfterExit(f.signal.signal);
        f.initial.loss.abort();
      } else {
        await f.transfer.prepare(f.signal.signal);
        await f.transfer.assertGrant(f.signal.signal);
        f.transfer.assertCurrent();
        if (mode === 'invalidatedTransfer') f.transfer.invalidate();
        else f.assertSingleInstanceOwnership.mockImplementationOnce(() => { throw new Error('lost'); });
      }
      expect(() => f.owner.assertInstallationCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => f.owner.assertInstallationCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(f.owner.assertMainOwned()).rejects.toThrow();
    },
  );

  it('prepares owned inspection work before releasing the existing reservation', async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    const prepare = vi.fn(async (signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      expect(f.initial.handle.assertOwned).toHaveBeenCalled();
      expect(f.initial.handle.release).not.toHaveBeenCalled();
    });
    f = await fixture(prepare);
    await f.transfer.prepare(f.signal.signal);
    expect(prepare).toHaveBeenCalledOnce();
    expect(f.initial.handle.assertOwned).toHaveBeenCalledTimes(2);
    expect(f.initial.handle.release).toHaveBeenCalledOnce();
  });

  it('does not release ownership after losing the lease during inspection preparation', async () => {
    const pending = deferred();
    const entered = deferred();
    const f = await fixture(async () => { entered.resolve(); await pending.promise; });
    const preparation = f.transfer.prepare(f.signal.signal);
    const rejected = expect(preparation).rejects.toThrow();
    await entered.promise;
    await f.handle.release();
    await f.lease.acquire('create');
    pending.resolve();
    await rejected;
    expect(f.initial.handle.release).not.toHaveBeenCalled();
    await expect(f.owner.assertMainOwned()).rejects.toThrow();
  });

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
      const receipt = owner.captureMainOwnership();
      await receipt.assertOwned();
      await expect(actual.acquireWorkspaceProcessReservation({ userDataRoot: root, signal })).rejects.toThrow();
      let preparationOwned!: () => Promise<void>;
      const transfer = owner.bind(randomUUID(), () => {}, async (_signal, assertCurrent, assertOwned) => {
        preparationOwned = assertOwned;
        assertCurrent();
        await assertOwned();
        await expect(actual.acquireWorkspaceProcessReservation({ userDataRoot: root, signal })).rejects.toThrow();
        await assertOwned();
      });
      expect(() => receipt.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await transfer.prepare(signal);
      await expect(preparationOwned()).rejects.toThrow();
      child = await actual.acquireWorkspaceProcessReservation({
        userDataRoot: root, expectedIdentity: transfer.descriptor.identity, signal,
      });
      await transfer.assertGrant(signal);
      transfer.assertCurrent();
      expect(() => owner.captureMainOwnership()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(owner.assertMainOwned()).rejects.toThrow();
      await child.release();
      child = undefined;
      await transfer.reclaimAfterExit(signal);
      await expect(receipt.assertOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await owner.captureMainOwnership().assertOwned();
      await owner.assertMainOwned();
      await expect(actual.acquireWorkspaceProcessReservation({ userDataRoot: root, signal })).rejects.toThrow();
    } finally {
      await child?.release();
      await owner.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
