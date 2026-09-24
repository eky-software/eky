import { expect, test } from '@playwright/test';

import { createFirstStartLoadProbe } from '../../../desktop/e2e/workspaceFirstStartLoadObservation.js';
import { runFirstStartProofShutdown } from '../../../desktop/e2e/workspaceFirstStartProofShutdown.js';

const loadErrorTitle = 'Eky ei k\u00e4ynnistynyt';
const loadErrorMessage = 'K\u00e4ytt\u00f6liittym\u00e4\u00e4 ei voitu ladata turvallisesti.';

test.describe('SYS-FIRST-START-LOAD-SHUTDOWN-001 @critical @security', () => {
  test('pending native load prevents shutdown and removal until its successful settlement', async () => {
    const native = deferredLoad();
    const waiting = deferredLoad();
    const order: string[] = [];
    const cleanupFailures: boolean[] = [];
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
    const returned = probe.wrapLoad(() => native.promise)();
    const nativeResult = captureCompletion(returned);
    const owner = captureCompletion(runFirstStartProofShutdown({
      async beforeShutdown() {
        order.push('beforeShutdown');
        waiting.resolve();
        await probe.waitForLoadBeforeShutdown();
        order.push('loadReady');
      },
      async shutdown() {
        expect(probe.snapshot().loadSucceeded).toBe(1);
        probe.shutdownStarted();
      },
      async cleanup(shutdownFailed) {
        cleanupFailures.push(shutdownFailed);
        order.push('cleanup');
        probe.protocolRemoved(true, true);
        probe.assertComplete();
      },
      reportSecondaryFailure() { order.push('secondaryFailure'); },
    }));
    try {
      expect(returned).toBe(native.promise);
      await waiting.promise;
      expect(order).toEqual(['loadRequested', 'loadStarted', 'beforeShutdown']);
      expect(probe.snapshot()).toMatchObject({ loadSucceeded: 0, loadRejected: 0, protocolRemoved: false });
      expect(cleanupFailures).toEqual([]);
      native.resolve();
      expect(await owner).toEqual({ status: 'fulfilled' });
      expect(cleanupFailures).toEqual([false]);
      expect(order).toEqual([
        'loadRequested', 'loadStarted', 'beforeShutdown', 'loadSucceeded',
        'loadReady', 'shutdownStarted', 'cleanup', 'protocolRemoved',
      ]);
    } finally {
      native.resolve();
      probe.dispose();
      await nativeResult;
      await owner;
    }
  });

  for (const rejection of ['error', 'undefined'] as const) {
    test(`native ${rejection} rejection preserves identity while shutdown and cleanup still run`, async () => {
      const original = rejection === 'error' ? new Error('SYNTHETIC_NATIVE_LOAD_FAILURE') : undefined;
      const native = deferredLoad();
      const waiting = deferredLoad();
      const order: string[] = [];
      const cleanupFailures: boolean[] = [];
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
      const returned = probe.wrapLoad(() => native.promise)();
      const nativeResult = captureCompletion(returned);
      const owner = captureCompletion(runFirstStartProofShutdown({
        async beforeShutdown() {
          order.push('beforeShutdown');
          waiting.resolve();
          await probe.waitForLoadBeforeShutdown();
          order.push('loadReady');
        },
        async shutdown() { probe.shutdownStarted(); },
        async cleanup(shutdownFailed) {
          cleanupFailures.push(shutdownFailed);
          order.push('cleanup');
          probe.protocolRemoved(true, true);
        },
        reportSecondaryFailure() { order.push('secondaryFailure'); },
      }));
      try {
        expect(returned).toBe(native.promise);
        await waiting.promise;
        expect(order).toEqual(['loadRequested', 'loadStarted', 'beforeShutdown']);
        native.reject(original);
        expectRejectedWithIdentity(await owner, original);
        expectRejectedWithIdentity(await nativeResult, original);
        expect(cleanupFailures).toEqual([false]);
        expect(order).toEqual([
          'loadRequested', 'loadStarted', 'beforeShutdown', 'loadRejected',
          'shutdownStarted', 'cleanup', 'protocolRemoved',
        ]);
        expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_UNEXPECTED_FAILURE');
      } finally {
        native.resolve();
        probe.dispose();
        await nativeResult;
        await owner;
      }
    });
  }

  for (const lateOutcome of ['resolve', 'reject'] as const) {
    test(`cancellation terminalizes the pending owner without fabricating native ${lateOutcome}`, async () => {
      const native = deferredLoad();
      const waiting = deferredLoad();
      const order: string[] = [];
      const cleanupFailures: boolean[] = [];
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
      const returned = probe.wrapLoad(() => native.promise)();
      const nativeResult = captureCompletion(returned);
      const owner = captureCompletion(runFirstStartProofShutdown({
        async beforeShutdown() {
          order.push('beforeShutdown');
          waiting.resolve();
          await probe.waitForLoadBeforeShutdown();
          order.push('loadReady');
        },
        async shutdown() { probe.shutdownStarted(); },
        async cleanup(shutdownFailed) {
          cleanupFailures.push(shutdownFailed);
          order.push('cleanup');
          probe.protocolRemoved(true, true);
        },
        reportSecondaryFailure() { order.push('secondaryFailure'); },
      }));
      try {
        await waiting.promise;
        expect(order).toEqual(['loadRequested', 'loadStarted', 'beforeShutdown']);
        probe.dispose();
        const result = await owner;
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(Error);
          expect(result.reason).toHaveProperty('message', 'E2E_FIRST_START_LOAD_GATE_CANCELLED');
        }
        expect(probe.snapshot()).toMatchObject({ cancelled: true, loadSucceeded: 0, loadRejected: 0 });
        expect(cleanupFailures).toEqual([false]);
        expect(order).toEqual([
          'loadRequested', 'loadStarted', 'beforeShutdown', 'gateCancelled', 'hookReleased',
          'shutdownStarted', 'cleanup', 'protocolRemoved',
        ]);
        expect(returned).toBe(native.promise);
        if (lateOutcome === 'resolve') {
          native.resolve();
          expect(await nativeResult).toEqual({ status: 'fulfilled' });
        } else {
          const lateError = new Error('SYNTHETIC_LATE_NATIVE_FAILURE');
          native.reject(lateError);
          expectRejectedWithIdentity(await nativeResult, lateError);
        }
        expect(probe.snapshot()).toMatchObject({
          cancelled: true, loadSucceeded: lateOutcome === 'resolve' ? 1 : 0,
          loadRejected: lateOutcome === 'reject' ? 1 : 0,
        });
        expect(await owner).toBe(result);
        expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      } finally {
        native.resolve();
        probe.dispose();
        await nativeResult;
        await owner;
      }
    });
  }

  test('a missing load fails closed but still performs owned shutdown and cleanup', async () => {
    const order: string[] = [];
    const cleanupFailures: boolean[] = [];
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
    try {
      await expect(runFirstStartProofShutdown({
        beforeShutdown: () => probe.waitForLoadBeforeShutdown(),
        async shutdown() { probe.shutdownStarted(); },
        async cleanup(shutdownFailed) {
          cleanupFailures.push(shutdownFailed);
          order.push('cleanup');
          probe.protocolRemoved(true, true);
        },
        reportSecondaryFailure() { order.push('secondaryFailure'); },
      })).rejects.toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      expect(cleanupFailures).toEqual([false]);
      expect(order).toEqual(['shutdownStarted', 'cleanup', 'protocolRemoved']);
      expect(probe.snapshot()).toMatchObject({ loadRequests: 0, loadStarts: 0, loadRejected: 0 });
    } finally { probe.dispose(); }
  });

  for (const duplicateTiming of ['beforeWait', 'duringWait'] as const) {
    test(`a duplicate load ${duplicateTiming} cannot become accepted shutdown readiness`, async () => {
      const first = deferredLoad();
      const second = deferredLoad();
      const waiting = deferredLoad();
      const order: string[] = [];
      const cleanupFailures: boolean[] = [];
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
      const firstResult = captureCompletion(probe.wrapLoad(() => first.promise)());
      let secondResult: Promise<Completion> | undefined;
      if (duplicateTiming === 'beforeWait') secondResult = captureCompletion(probe.wrapLoad(() => second.promise)());
      const owner = captureCompletion(runFirstStartProofShutdown({
        async beforeShutdown() {
          order.push('beforeShutdown');
          waiting.resolve();
          await probe.waitForLoadBeforeShutdown();
          order.push('loadReady');
        },
        async shutdown() { probe.shutdownStarted(); },
        async cleanup(shutdownFailed) {
          cleanupFailures.push(shutdownFailed);
          order.push('cleanup');
          probe.protocolRemoved(true, true);
        },
        reportSecondaryFailure() { order.push('secondaryFailure'); },
      }));
      try {
        await waiting.promise;
        if (duplicateTiming === 'duringWait') {
          expect(order).toEqual(['loadRequested', 'loadStarted', 'beforeShutdown']);
          secondResult = captureCompletion(probe.wrapLoad(() => second.promise)());
        }
        first.resolve();
        second.resolve();
        const result = await owner;
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason).toHaveProperty('message', 'E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
        }
        expect(await firstResult).toEqual({ status: 'fulfilled' });
        expect(await secondResult).toEqual({ status: 'fulfilled' });
        expect(order).not.toContain('loadReady');
        expect(order.filter((event) => event === 'shutdownStarted')).toHaveLength(1);
        expect(order.indexOf('shutdownStarted')).toBeLessThan(order.indexOf('cleanup'));
        expect(order.indexOf('cleanup')).toBeLessThan(order.indexOf('protocolRemoved'));
        expect(cleanupFailures).toEqual([false]);
        expect(probe.snapshot()).toMatchObject({ loadRequests: 2, loadStarts: 2, loadSucceeded: 2 });
        expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      } finally {
        first.resolve();
        second.resolve();
        probe.dispose();
        await firstResult;
        await secondResult;
        await owner;
      }
    });
  }

  for (const rejection of ['error', 'undefined'] as const) {
    test(`pre-load ${rejection} failure wins over shutdown, cleanup and secondary reporting failures`, async () => {
      const original = rejection === 'error' ? new Error('SYNTHETIC_NATIVE_LOAD_FAILURE') : undefined;
      const native = deferredLoad();
      const waiting = deferredLoad();
      const order: string[] = [];
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
      const nativeResult = captureCompletion(probe.wrapLoad(() => native.promise)());
      const cleanupFailures: boolean[] = [];
      const owner = captureCompletion(runFirstStartProofShutdown({
        async beforeShutdown() {
          order.push('beforeShutdown');
          waiting.resolve();
          await probe.waitForLoadBeforeShutdown();
        },
        async shutdown() { probe.shutdownStarted(); throw new Error('SYNTHETIC_SHUTDOWN_FAILURE'); },
        async cleanup(shutdownFailed) {
          cleanupFailures.push(shutdownFailed);
          order.push('cleanup');
          throw new Error('SYNTHETIC_CLEANUP_FAILURE');
        },
        async reportSecondaryFailure() {
          order.push('secondaryFailure');
          throw new Error('SYNTHETIC_REPORT_FAILURE');
        },
      }));
      try {
        await waiting.promise;
        expect(order).toEqual(['loadRequested', 'loadStarted', 'beforeShutdown']);
        native.reject(original);
        expectRejectedWithIdentity(await owner, original);
        expectRejectedWithIdentity(await nativeResult, original);
        expect(cleanupFailures).toEqual([true]);
        expect(order).toEqual([
          'loadRequested', 'loadStarted', 'beforeShutdown', 'loadRejected',
          'shutdownStarted', 'secondaryFailure', 'cleanup', 'secondaryFailure',
        ]);
      } finally {
        native.resolve();
        probe.dispose();
        await nativeResult;
        await owner;
      }
    });
  }

  for (const firstFailure of ['shutdown', 'cleanup'] as const) {
    test(`successful pre-load preserves the first ${firstFailure} failure`, async () => {
      const original = new Error('SYNTHETIC_FIRST_FAILURE');
      const order: string[] = [];
      const cleanupFailures: boolean[] = [];
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => order.push(event) });
      try {
        await probe.wrapLoad(() => Promise.resolve())();
        await expect(runFirstStartProofShutdown({
          async beforeShutdown() { await probe.waitForLoadBeforeShutdown(); order.push('loadReady'); },
          async shutdown() {
            probe.shutdownStarted();
            if (firstFailure === 'shutdown') throw original;
          },
          async cleanup(shutdownFailed) {
            cleanupFailures.push(shutdownFailed);
            order.push('cleanup');
            throw firstFailure === 'cleanup' ? original : new Error('SYNTHETIC_SECONDARY_CLEANUP_FAILURE');
          },
          reportSecondaryFailure() { order.push('secondaryFailure'); throw new Error('SYNTHETIC_REPORT_FAILURE'); },
        })).rejects.toBe(original);
        expect(cleanupFailures).toEqual([firstFailure === 'shutdown']);
        expect(order).toEqual([
          'loadRequested', 'loadStarted', 'loadSucceeded', 'loadReady', 'shutdownStarted', 'cleanup',
          ...(firstFailure === 'shutdown' ? ['secondaryFailure'] : []),
        ]);
      } finally { probe.dispose(); }
    });
  }

  test('forced mode bypasses only the pre-wait and still requires removal, rejection, exact dialog and quit', async () => {
    const native = deferredLoad();
    const cleanupEntered = deferredLoad();
    const removalAllowed = deferredLoad();
    const nativeStarted = deferredLoad();
    const order: string[] = [];
    const cleanupFailures: boolean[] = [];
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: true, observe: (event) => order.push(event) });
    const original = new Error('SYNTHETIC_FORCED_LOAD_FAILURE');
    const returned = probe.wrapLoad(() => {
      nativeStarted.resolve();
      return native.promise;
    })();
    const nativeResult = captureCompletion(returned);
    const owner = captureCompletion(runFirstStartProofShutdown({
      async beforeShutdown() { await probe.waitForLoadBeforeShutdown(); order.push('preWaitBypassed'); },
      async shutdown() { probe.shutdownStarted(); },
      async cleanup(shutdownFailed) {
        cleanupFailures.push(shutdownFailed);
        order.push('cleanup');
        cleanupEntered.resolve();
        await removalAllowed.promise;
        probe.protocolRemoved(false, true);
        probe.protocolRemoved(true, false);
        expect(probe.snapshot()).toMatchObject({ loadStarts: 0, releasedAfterRemoval: false });
        probe.protocolRemoved(true, true);
        await probe.forcedOutcome;
        probe.assertComplete();
      },
      reportSecondaryFailure() { order.push('secondaryFailure'); },
    }));
    try {
      await cleanupEntered.promise;
      expect(order).toEqual(['loadRequested', 'loadHeld', 'preWaitBypassed', 'shutdownStarted', 'cleanup']);
      expect(probe.snapshot()).toMatchObject({ loadStarts: 0, protocolRemoved: false, releasedAfterRemoval: false });
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      removalAllowed.resolve();
      await nativeStarted.promise;
      expect(probe.snapshot()).toMatchObject({
        protocolRemoved: true, releasedAfterRemoval: true,
        loadStarts: 1, loadSucceeded: 0, loadRejected: 0,
      });
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
      native.reject(original);
      expectRejectedWithIdentity(await nativeResult, original);
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
      probe.showErrorBox(loadErrorTitle, loadErrorMessage);
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
      probe.quitRequested();
      expect(await owner).toEqual({ status: 'fulfilled' });
      expect(cleanupFailures).toEqual([false]);
      expect(order).toEqual([
        'loadRequested', 'loadHeld', 'preWaitBypassed', 'shutdownStarted', 'cleanup',
        'protocolRemovalUnverified', 'protocolRemovalUnverified', 'protocolRemoved',
        'loadReleased', 'loadStarted', 'loadRejected', 'loadErrorDialog', 'quitRequested',
      ]);
    } finally {
      removalAllowed.resolve();
      native.resolve();
      probe.dispose();
      // A failed assertion after native rejection must not strand the owner in cleanup.
      if (probe.snapshot().quitRequests === 0) probe.quitRequested();
      await nativeResult;
      await owner;
    }
  });
});

type Completion = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };

function captureCompletion(promise: Promise<void>): Promise<Completion> {
  return promise.then<Completion, Completion>(
    () => ({ status: 'fulfilled' }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
}

function expectRejectedWithIdentity(completion: Completion, reason: unknown): void {
  expect(completion.status).toBe('rejected');
  if (completion.status === 'rejected') expect(completion.reason).toBe(reason);
}

function deferredLoad() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
