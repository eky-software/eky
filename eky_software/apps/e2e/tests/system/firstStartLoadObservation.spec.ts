import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  createFirstStartLoadProbe,
  firstStartLoadEvents,
  firstStartLoadPhases,
  firstStartLoadSlots,
  type FirstStartLoadEvent,
} from '../../../desktop/e2e/workspaceFirstStartLoadObservation.js';
import {
  createFirstStartProofObserver,
  firstStartProofObservationPath,
  MAX_FIRST_START_PROOF_OBSERVATIONS,
  MAX_FIRST_START_PROOF_OBSERVATION_BYTES,
  parseFirstStartProofObservations,
} from '../../../desktop/e2e/workspaceFirstStartProofObservation.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { runFirstStartProofShutdown } from '../../../desktop/e2e/workspaceFirstStartProofShutdown.js';

const loadErrorTitle = 'Eky ei k\u00e4ynnistynyt';
const loadErrorMessage = 'K\u00e4ytt\u00f6liittym\u00e4\u00e4 ei voitu ladata turvallisesti.';

test.describe('SYS-FIRST-START-LOAD-OBSERVATION-001 @critical @security', () => {
  test('shutdown failure survives diagnostic and secondary reporting failures', async () => {
    const primary = new Error('SYNTHETIC_SHUTDOWN_FAILURE');
    let reports = 0;
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: true, observe() {} });
    const held = probe.wrapLoad(() => { throw new Error('MUST_NOT_START'); })();
    const rejected = expect(held).rejects.toThrow('E2E_FIRST_START_LOAD_GATE_CANCELLED');
    await expect(runFirstStartProofShutdown({
      async shutdown() { throw primary; },
      async cleanup(failed) {
        expect(failed).toBe(true);
        probe.dispose();
        throw new Error('SYNTHETIC_DIAGNOSTIC_FAILURE');
      },
      reportSecondaryFailure() { reports++; throw new Error('SYNTHETIC_REPORT_FAILURE'); },
    })).rejects.toBe(primary);
    await rejected;
    await probe.forcedOutcome;
    expect(probe.snapshot()).toMatchObject({ cancelled: true, loadStarts: 0 });
    expect(reports).toBe(1);
  });

  test('successful shutdown exposes cleanup failure and preserves execution order', async () => {
    const secondary = new Error('SYNTHETIC_CLEANUP_FAILURE');
    const order: string[] = [];
    await expect(runFirstStartProofShutdown({
      async shutdown() { order.push('shutdown'); },
      async cleanup(failed) {
        expect(failed).toBe(false);
        order.push('cleanup');
        throw secondary;
      },
      reportSecondaryFailure() { order.push('secondary'); },
    })).rejects.toBe(secondary);
    expect(order).toEqual(['shutdown', 'cleanup']);
  });

  test('even an undefined shutdown rejection remains a failure after successful cleanup', async () => {
    const cleanup: boolean[] = [];
    await expect(runFirstStartProofShutdown({
      async shutdown() { throw undefined; },
      async cleanup(failed) { cleanup.push(failed); },
      reportSecondaryFailure() { throw new Error('MUST_NOT_REPORT'); },
    })).rejects.toBeUndefined();
    expect(cleanup).toEqual([true]);
  });

  test('normal navigation is immediate and returns the exact promise with unchanged arguments', async () => {
    const native = deferredLoad();
    const events: FirstStartLoadEvent[] = [];
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => events.push(event) });
    const options = Object.freeze({ extraHeaders: 'X-Synthetic: 1' });
    let calls = 0;
    const wrapped = probe.wrapLoad((url: string, receivedOptions: typeof options) => {
      calls++;
      expect(url).toBe('eky://app/index.html');
      expect(receivedOptions).toBe(options);
      return native.promise;
    });
    const returned = wrapped('eky://app/index.html', options);
    expect(calls).toBe(1);
    expect(returned).toBe(native.promise);
    expect(events).toEqual(['loadRequested', 'loadStarted']);
    probe.shutdownStarted();
    probe.protocolRemoved(true, true);
    expect(probe.snapshot().loadSucceeded).toBe(0);
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
    native.resolve();
    await returned;
    expect(probe.snapshot().loadSucceeded).toBe(1);
    expect(() => probe.assertComplete()).not.toThrow();
    probe.dispose();
  });

  test('normal synchronous throws remain synchronous and preserve the same error', () => {
    const original = new Error('SYNTHETIC_LOAD_THROW');
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe() {} });
    const wrapped = probe.wrapLoad(() => { throw original; });
    let caught: unknown;
    try { wrapped(); } catch (error) { caught = error; }
    expect(caught).toBe(original);
    expect(probe.snapshot()).toMatchObject({ loadRequests: 1, loadStarts: 1, loadRejected: 1 });
    probe.shutdownStarted();
    probe.protocolRemoved(true, true);
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_UNEXPECTED_FAILURE');
    probe.dispose();
  });

  test('normal rejection retains the original promise and error', async () => {
    const native = deferredLoad();
    const original = new Error('SYNTHETIC_LOAD_REJECTION');
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe() {} });
    const returned = probe.wrapLoad(() => native.promise)();
    expect(returned).toBe(native.promise);
    const rejection = expect(returned).rejects.toBe(original);
    native.reject(original);
    await rejection;
    expect(probe.snapshot()).toMatchObject({ loadSucceeded: 0, loadRejected: 1 });
    probe.shutdownStarted();
    probe.protocolRemoved(true, true);
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_UNEXPECTED_FAILURE');
    probe.dispose();
  });

  for (const outcome of ['resolve', 'reject', 'throw'] as const) {
    test(`observer exceptions do not change normal ${outcome}`, async () => {
      const native = deferredLoad();
      const original = new Error('SYNTHETIC_NATIVE_FAILURE');
      const probe = createFirstStartLoadProbe({
        holdUntilProtocolRemoval: false,
        observe() { throw new Error('SYNTHETIC_OBSERVER_FAILURE'); },
      });
      const wrapped = probe.wrapLoad(() => {
        if (outcome === 'throw') throw original;
        return native.promise;
      });
      if (outcome === 'throw') {
        let caught: unknown;
        try { wrapped(); } catch (error) { caught = error; }
        expect(caught).toBe(original);
        native.resolve();
      } else {
        const returned = wrapped();
        expect(returned).toBe(native.promise);
        if (outcome === 'resolve') {
          native.resolve();
          await returned;
        } else {
          const rejection = expect(returned).rejects.toBe(original);
          native.reject(original);
          await rejection;
        }
      }
      expect(() => probe.shutdownStarted()).not.toThrow();
      expect(() => probe.protocolRemoved(true, true)).not.toThrow();
      expect(probe.snapshot()).toMatchObject({
        loadRequests: 1, loadStarts: 1, protocolRemoved: true,
        loadSucceeded: outcome === 'resolve' ? 1 : 0,
        loadRejected: outcome === 'resolve' ? 0 : 1,
      });
      expect(() => probe.dispose()).not.toThrow();
    });
  }

  test('forced navigation requires shutdown and both removal booleans, then releases exactly once', async () => {
    const native = deferredLoad();
    const events: FirstStartLoadEvent[] = [];
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: true, observe: (event) => events.push(event) });
    const options = Object.freeze({ extraHeaders: 'X-Synthetic: 1' });
    let calls = 0;
    const returned = probe.wrapLoad((url: string, forwarded: typeof options) => {
      calls++;
      expect(url).toBe('eky://app/index.html');
      expect(forwarded).toBe(options);
      expect(probe.snapshot()).toMatchObject({ protocolRemoved: true, releasedAfterRemoval: true });
      return native.promise;
    })('eky://app/index.html', options);
    expect(calls).toBe(0);
    expect(events).toEqual(['loadRequested', 'loadHeld']);
    probe.protocolRemoved(true, true);
    expect(calls).toBe(0);
    expect(probe.snapshot().protocolRemoved).toBe(false);
    probe.shutdownStarted();
    for (const [removed, absent] of [[false, false], [false, true], [true, false]] as const) {
      probe.protocolRemoved(removed, absent);
      expect(calls).toBe(0);
      expect(probe.snapshot()).toMatchObject({ protocolRemoved: false, releasedAfterRemoval: false });
    }
    probe.protocolRemoved(true, true);
    expect(calls).toBe(1);
    expect(events.slice(-3)).toEqual(['protocolRemoved', 'loadReleased', 'loadStarted']);
    probe.protocolRemoved(true, true);
    expect(calls).toBe(1);
    expect(events.filter((event) => event === 'loadReleased')).toHaveLength(1);
    native.resolve();
    await returned;
    await probe.forcedOutcome;
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
    probe.dispose();
  });

  test('forced rejection alone cannot settle the owner wait or demonstrate the mechanism', async () => {
    const native = deferredLoad();
    const original = new Error('SYNTHETIC_FORCED_REJECTION');
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: true, observe() {} });
    let outcomeSettled = false;
    void probe.forcedOutcome.then(() => { outcomeSettled = true; });
    const returned = probe.wrapLoad(() => native.promise)();
    probe.shutdownStarted();
    probe.protocolRemoved(true, true);
    const rejection = expect(returned).rejects.toBe(original);
    native.reject(original);
    await rejection;
    expect(outcomeSettled).toBe(false);
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
    probe.mainFrameFailed();
    probe.showErrorBox(loadErrorTitle, loadErrorMessage);
    await Promise.resolve();
    expect(outcomeSettled).toBe(false);
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
    probe.quitRequested();
    await probe.forcedOutcome;
    expect(outcomeSettled).toBe(true);
    expect(() => probe.assertComplete()).not.toThrow();
    probe.dispose();
  });

  for (const eventTiming of ['absent', 'afterAcceptance'] as const) {
    test(`forced rejection and exact error branch remain provable with main-frame event ${eventTiming}`, async () => {
      const native = deferredLoad();
      const events: FirstStartLoadEvent[] = [];
      const original = new Error('SYNTHETIC_FORCED_REJECTION');
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: true, observe: (event) => events.push(event) });
      const returned = probe.wrapLoad(() => native.promise)();
      probe.shutdownStarted();
      probe.protocolRemoved(true, true);
      const rejection = expect(returned).rejects.toBe(original);
      native.reject(original);
      await rejection;
      probe.showErrorBox(loadErrorTitle, loadErrorMessage);
      probe.quitRequested();
      await probe.forcedOutcome;
      expect(() => probe.assertComplete()).not.toThrow();
      expect(probe.snapshot()).toEqual({
        loadRequests: 1, loadStarts: 1, loadSucceeded: 0, loadRejected: 1,
        mainFrameFailures: 0, loadErrorDialogs: 1, otherErrorDialogs: 0, quitRequests: 1,
        protocolRemoved: true, releasedAfterRemoval: true, cancelled: false,
      });
      expect(events).toEqual([
        'loadRequested', 'loadHeld', 'shutdownStarted', 'protocolRemoved',
        'loadReleased', 'loadStarted', 'loadRejected', 'loadErrorDialog', 'quitRequested',
      ]);
      if (eventTiming === 'afterAcceptance') {
        probe.mainFrameFailed();
        expect(probe.snapshot().mainFrameFailures).toBe(1);
        expect(events.at(-1)).toBe('mainFrameFailed');
        expect(() => probe.assertComplete()).not.toThrow();
      }
      probe.dispose();
    });
  }

  for (const defect of ['missingLoadErrorDialog', 'missingRejection', 'unrelatedDialog'] as const) {
    test(`quit terminalizes the forced wait but cannot accept ${defect}`, async () => {
      const native = deferredLoad();
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: true, observe() {} });
      const returned = probe.wrapLoad(() => native.promise)();
      probe.shutdownStarted();
      probe.protocolRemoved(true, true);
      if (defect === 'missingRejection') {
        native.resolve();
        await returned;
      } else {
        const original = new Error('SYNTHETIC_FORCED_REJECTION');
        const rejection = expect(returned).rejects.toBe(original);
        native.reject(original);
        await rejection;
      }
      probe.mainFrameFailed();
      if (defect !== 'missingLoadErrorDialog') probe.showErrorBox(loadErrorTitle, loadErrorMessage);
      if (defect === 'unrelatedDialog') probe.showErrorBox(loadErrorTitle, 'SYNTHETIC_OTHER_MESSAGE');
      probe.quitRequested();
      await probe.forcedOutcome;
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
      probe.dispose();
    });
  }

  test('classifies only the exact load dialog and keeps text out of observations', () => {
    const events: FirstStartLoadEvent[] = [];
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe: (event) => events.push(event) });
    probe.showErrorBox(loadErrorTitle, loadErrorMessage);
    probe.showErrorBox('SYNTHETIC_OTHER_TITLE', loadErrorMessage);
    probe.showErrorBox(loadErrorTitle, 'SYNTHETIC_OTHER_MESSAGE');
    expect(events).toEqual(['loadErrorDialog', 'otherErrorDialog', 'otherErrorDialog']);
    expect(probe.snapshot()).toMatchObject({ loadErrorDialogs: 1, otherErrorDialogs: 2 });
    expect(Object.keys(probe.snapshot()).sort()).toEqual([
      'cancelled', 'loadErrorDialogs', 'loadRejected', 'loadRequests', 'loadStarts',
      'loadSucceeded', 'mainFrameFailures', 'otherErrorDialogs', 'protocolRemoved',
      'quitRequests', 'releasedAfterRemoval',
    ].sort());
    probe.dispose();
  });

  for (const dialog of ['load', 'unrelated'] as const) {
    test(`a normal ${dialog} dialog rejects owner acceptance despite successful navigation`, async () => {
      const native = deferredLoad();
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe() {} });
      const returned = probe.wrapLoad(() => native.promise)();
      native.resolve();
      await returned;
      probe.shutdownStarted();
      probe.protocolRemoved(true, true);
      probe.showErrorBox(loadErrorTitle, dialog === 'load' ? loadErrorMessage : 'SYNTHETIC_OTHER_MESSAGE');
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_UNEXPECTED_FAILURE');
      probe.dispose();
    });
  }

  test('a normal main-frame failure still rejects owner acceptance despite successful navigation', async () => {
    const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: false, observe() {} });
    await probe.wrapLoad(() => Promise.resolve())();
    probe.shutdownStarted();
    probe.protocolRemoved(true, true);
    probe.mainFrameFailed();
    expect(probe.snapshot()).toMatchObject({ loadSucceeded: 1, loadRejected: 0, mainFrameFailures: 1 });
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_UNEXPECTED_FAILURE');
    probe.dispose();
  });

  test('missing and pending navigation evidence fails closed in both modes', async () => {
    for (const holdUntilProtocolRemoval of [false, true]) {
      const native = deferredLoad();
      const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval, observe() {} });
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      const returned = probe.wrapLoad(() => native.promise)();
      expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      probe.shutdownStarted();
      probe.protocolRemoved(true, true);
      expect(probe.snapshot()).toMatchObject({ loadSucceeded: 0, loadRejected: 0 });
      expect(() => probe.assertComplete()).toThrow(holdUntilProtocolRemoval
        ? 'E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED'
        : 'E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      native.resolve();
      await returned;
      probe.dispose();
    }
  });

  test('dispose terminalizes an uninvoked gate even when the observer throws', async () => {
    let calls = 0;
    const events: FirstStartLoadEvent[] = [];
    const probe = createFirstStartLoadProbe({
      holdUntilProtocolRemoval: true,
      observe(event) { events.push(event); throw new Error('SYNTHETIC_OBSERVER_FAILURE'); },
    });
    const returned = probe.wrapLoad(() => { calls++; return Promise.resolve(); })();
    const rejection = expect(returned).rejects.toThrow('E2E_FIRST_START_LOAD_GATE_CANCELLED');
    expect(() => probe.dispose()).not.toThrow();
    await rejection;
    await probe.forcedOutcome;
    probe.dispose();
    probe.shutdownStarted();
    probe.protocolRemoved(true, true);
    expect(calls).toBe(0);
    expect(events.filter((event) => event === 'gateCancelled')).toHaveLength(1);
    expect(probe.snapshot()).toMatchObject({ cancelled: true, loadStarts: 0, releasedAfterRemoval: false });
    expect(() => probe.assertComplete()).toThrow('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
  });

  test('roundtrips every closed load phase through the bounded journal and parser', async () => {
    const root = createE2eRunRoot();
    const runtimeId = randomUUID();
    const observer = createFirstStartProofObserver(root, runtimeId, () => 0);
    try {
      expect(firstStartLoadSlots).toEqual(['mixedInitial', 'mixedRestart', 'currentInitial', 'currentRestart']);
      expect(firstStartLoadEvents).toEqual([
        'windowObserved', 'loadRequested', 'loadHeld', 'loadStarted', 'loadSucceeded',
        'loadRejected', 'mainFrameFailed', 'shutdownStarted', 'protocolRemoved',
        'protocolRemovalUnverified', 'loadReleased', 'loadErrorDialog', 'otherErrorDialog',
        'quitRequested', 'gateCancelled', 'hookReleased',
      ]);
      expect(new Set(firstStartLoadPhases).size).toBe(firstStartLoadSlots.length * firstStartLoadEvents.length);
      expect(firstStartLoadPhases).toEqual(firstStartLoadSlots.flatMap(
        (slot) => firstStartLoadEvents.map((event) => `${slot}:${event}`),
      ));
      expect(firstStartLoadPhases.length).toBeLessThan(MAX_FIRST_START_PROOF_OBSERVATIONS);
      for (const phase of firstStartLoadPhases) observer.record(phase);
      observer.close();
      const bytes = readFileSync(firstStartProofObservationPath(root, runtimeId));
      expect(bytes.byteLength).toBeLessThanOrEqual(MAX_FIRST_START_PROOF_OBSERVATION_BYTES);
      expect(parseFirstStartProofObservations(bytes.toString('utf8'))).toEqual({
        status: 'captured', truncated: false,
        observations: firstStartLoadPhases.map((phase) => ({ schemaVersion: 1, phase, elapsedMs: 0 })),
      });
      expect(bytes.toString('utf8')).not.toContain(runtimeId);
      for (const phase of ['unknown:loadStarted', 'mixedInitial:unknown']) {
        expect(parseFirstStartProofObservations(`${JSON.stringify({ schemaVersion: 1, phase, elapsedMs: 0 })}\n`))
          .toEqual({ status: 'invalid' });
      }
    } finally { observer.close(); await removeE2eRunRoot(root); }
  });
});

function deferredLoad() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
