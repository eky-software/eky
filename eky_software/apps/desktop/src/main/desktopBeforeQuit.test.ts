import { readFile } from 'node:fs/promises';
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { terminateW6b2PackagedProofRuntime } from './w6b2PackagedProofTermination.js';

describe('desktop before-quit handler', () => {
  it('invalidates startup reporting synchronously before reading an absent lifecycle', async () => {
    let reportingClosed = false;
    const fixture = createFixture(async () => undefined, () => { reportingClosed = true; });
    fixture.readLifecycle.mockImplementation(() => {
      expect(reportingClosed).toBe(true);
      return undefined;
    });
    const event = createEvent();
    const finished = fixture.handleBeforeQuit(event);

    expect(reportingClosed).toBe(true);
    expect(fixture.invalidateStartupReporting).toHaveBeenCalledOnce();
    expect(fixture.invalidateStartupReporting.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.readLifecycle.mock.invocationCallOrder[0]!);
    await finished;
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.shutdown).not.toHaveBeenCalled();
    expect(fixture.quitApplication).not.toHaveBeenCalled();
  });

  it('invalidates reporting for pending, handoff-deferred and settled quit requests', async () => {
    const shutdown = createDeferredShutdown();
    const fixture = createFixture(() => shutdown.promise, () => undefined);
    const first = fixture.handleBeforeQuit(createEvent());
    try {
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(1);
      const pending = createEvent();
      await fixture.handleBeforeQuit(pending);
      expect(pending.preventDefault).toHaveBeenCalledOnce();
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(2);

      fixture.isInstallerHandoffPending.mockReturnValue(true);
      const handoff = createEvent();
      await fixture.handleBeforeQuit(handoff);
      expect(handoff.preventDefault).toHaveBeenCalledOnce();
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(3);
      shutdown.resolve();
      await first;
      expect(fixture.quitApplication).not.toHaveBeenCalled();

      const settledHandoff = createEvent();
      await fixture.handleBeforeQuit(settledHandoff);
      expect(settledHandoff.preventDefault).toHaveBeenCalledOnce();
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(4);

      fixture.isInstallerHandoffPending.mockReturnValue(false);
      const settled = createEvent();
      await fixture.handleBeforeQuit(settled);
      expect(settled.preventDefault).not.toHaveBeenCalled();
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(5);
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.quitApplication).not.toHaveBeenCalled();
    } finally { shutdown.resolve(); await first; }
  });

  it('joins a reentrant invalidation without recursive hooks or duplicate shutdown', async () => {
    const shutdown = createDeferredShutdown();
    const reentrantEvent = createEvent();
    const reentrantWork: Promise<void>[] = [];
    const fixture = createFixture(() => shutdown.promise, () => {
      reentrantWork.push(fixture.handleBeforeQuit(reentrantEvent));
    });
    const firstEvent = createEvent();
    const first = fixture.handleBeforeQuit(firstEvent);
    try {
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledOnce();
      expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
      expect(reentrantEvent.preventDefault).toHaveBeenCalledOnce();
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.quitApplication).not.toHaveBeenCalled();
      shutdown.resolve();
      await first;
      await Promise.all(reentrantWork);
      expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(2);
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.quitApplication).toHaveBeenCalledOnce();
      expect(fixture.finalQuitEvent.preventDefault).not.toHaveBeenCalled();
    } finally { shutdown.resolve(); await first; await Promise.all(reentrantWork); }
  });

  it.each(['throw', 'rejection', 'pending'] as const)(
    'does not await reporting invalidation or skip ordinary shutdown on %s', async outcome => {
      const pendingHook = createDeferredShutdown();
      const fixture = createFixture(async () => undefined, () => {
        if (outcome === 'throw') throw new Error('synthetic reporting invalidation failure');
        if (outcome === 'rejection') return Promise.reject(new Error('synthetic async reporting invalidation failure'));
        return pendingHook.promise;
      });
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const event = createEvent();
      const turn = nextEventLoopTurn();
      const finished = fixture.handleBeforeQuit(event);
      try {
        expect(await Promise.race([finished.then(() => 'quitFinished'), turn.then(() => 'turn')]))
          .toBe('quitFinished');
        await turn;
        expect(unhandled).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(fixture.invalidateStartupReporting).toHaveBeenCalledTimes(2);
        expect(fixture.shutdown).toHaveBeenCalledOnce();
        expect(fixture.quitApplication).toHaveBeenCalledOnce();
        expect(fixture.finalQuitEvent.preventDefault).not.toHaveBeenCalled();
      } finally {
        pendingHook.resolve();
        try { await finished; } finally { process.off('unhandledRejection', unhandled); }
      }
    },
  );

  it('defers every quit while installer handoff is pending without latching shutdown', async () => {
    const fixture = createFixture(async () => undefined);
    fixture.isInstallerHandoffPending.mockReturnValue(true);
    const events = [createEvent(), createEvent()];
    for (const event of events) await fixture.handleBeforeQuit(event);
    for (const event of events) expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.shutdown).not.toHaveBeenCalled();
    expect(fixture.quitApplication).not.toHaveBeenCalled();

    fixture.isInstallerHandoffPending.mockReturnValue(false);
    await fixture.handleBeforeQuit(createEvent());
    expect(fixture.shutdown).toHaveBeenCalledOnce();
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
    expect(fixture.finalQuitEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('rechecks handoff after awaited shutdown and guards an already settled quit handler', async () => {
    const shutdown = createDeferredShutdown();
    const fixture = createFixture(() => shutdown.promise);
    const first = fixture.handleBeforeQuit(createEvent());
    fixture.isInstallerHandoffPending.mockReturnValue(true);
    shutdown.resolve();
    await first;
    const pending = createEvent();
    await fixture.handleBeforeQuit(pending);
    expect(pending.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.quitApplication).not.toHaveBeenCalled();

    fixture.isInstallerHandoffPending.mockReturnValue(false);
    const terminal = createEvent();
    await fixture.handleBeforeQuit(terminal);
    expect(terminal.preventDefault).not.toHaveBeenCalled();
    expect(fixture.shutdown).toHaveBeenCalledOnce();
  });

  it.each(['success', 'rejection'] as const)(
    'prevents every pending quit and quits once after shutdown %s',
    async (outcome) => {
      const shutdown = createDeferredShutdown();
      const fixture = createFixture(() => shutdown.promise);
      const firstEvent = createEvent();
      const finished = fixture.handleBeforeQuit(firstEvent);
      const secondEvent = createEvent();
      const thirdEvent = createEvent();

      await fixture.handleBeforeQuit(secondEvent);
      await fixture.handleBeforeQuit(thirdEvent);

      for (const event of [firstEvent, secondEvent, thirdEvent]) {
        expect(event.preventDefault).toHaveBeenCalledOnce();
      }
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.quitApplication).not.toHaveBeenCalled();

      if (outcome === 'success') shutdown.resolve();
      else shutdown.reject(new Error('synthetic shutdown failure'));

      await expect(finished).resolves.toBeUndefined();
      expect(fixture.quitApplication).toHaveBeenCalledOnce();
      expect(fixture.finalQuitEvent.preventDefault).not.toHaveBeenCalled();

      const laterEvent = createEvent();
      await fixture.handleBeforeQuit(laterEvent);
      expect(laterEvent.preventDefault).not.toHaveBeenCalled();
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.quitApplication).toHaveBeenCalledOnce();
    },
  );

  it('consumes a synchronous shutdown throw before allowing the final quit', async () => {
    const fixture = createFixture(() => {
      throw new Error('synthetic synchronous shutdown failure');
    });
    const event = createEvent();

    await expect(fixture.handleBeforeQuit(event)).resolves.toBeUndefined();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.shutdown).toHaveBeenCalledOnce();
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
    expect(fixture.finalQuitEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('marks shutdown pending before invoking a reentrant lifecycle', async () => {
    const shutdown = createDeferredShutdown();
    const reentrantEvent = createEvent();
    const fixture = createFixture(() => {
      void fixture.handleBeforeQuit(reentrantEvent);
      return shutdown.promise;
    });

    const finished = fixture.handleBeforeQuit(createEvent());

    expect(reentrantEvent.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.shutdown).toHaveBeenCalledOnce();
    expect(fixture.quitApplication).not.toHaveBeenCalled();
    shutdown.resolve();
    await finished;
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
  });

  it('does not prevent quit without a lifecycle or latch shutdown prematurely', async () => {
    const fixture = createFixture(async () => undefined);
    fixture.readLifecycle.mockReturnValue(undefined);
    const event = createEvent();

    await fixture.handleBeforeQuit(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.shutdown).not.toHaveBeenCalled();
    expect(fixture.quitApplication).not.toHaveBeenCalled();

    fixture.readLifecycle.mockReturnValue({ shutdown: fixture.shutdown });
    const runtimeEvent = createEvent();
    await fixture.handleBeforeQuit(runtimeEvent);
    expect(runtimeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.shutdown).toHaveBeenCalledOnce();
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
  });

  it('keeps preventing quit if the lifecycle reference disappears while pending', async () => {
    const shutdown = createDeferredShutdown();
    const fixture = createFixture(() => shutdown.promise);
    const finished = fixture.handleBeforeQuit(createEvent());
    fixture.readLifecycle.mockReturnValue(undefined);
    const pendingEvent = createEvent();

    await fixture.handleBeforeQuit(pendingEvent);

    expect(pendingEvent.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.quitApplication).not.toHaveBeenCalled();
    shutdown.resolve();
    await finished;
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
  });

  it.each(['success', 'rejection'] as const)(
    'keeps the W6 proof quit bypass behind awaited shutdown %s',
    async (outcome) => {
      const shutdown = createDeferredShutdown();
      const fixture = createFixture(() => shutdown.promise);
      let proofShutdownCompleted = false;
      const proofQuitEvent = createEvent();
      const destroy = vi.fn();
      const handleProofQuit = () => {
        if (proofShutdownCompleted) return;
        void fixture.handleBeforeQuit(proofQuitEvent);
      };
      const quitApplication = vi.fn(() => {
        proofShutdownCompleted = true;
        handleProofQuit();
      });
      const termination = terminateW6b2PackagedProofRuntime({
        lifecycle: {
          applicationWindow: { destroy, isDestroyed: () => false },
          shutdown: fixture.shutdown,
        },
        quitApplication,
        quitRequested: false,
        relaunchRequested: false,
      });

      expect(proofShutdownCompleted).toBe(false);
      expect(quitApplication).not.toHaveBeenCalled();
      expect(destroy).not.toHaveBeenCalled();

      if (outcome === 'success') {
        shutdown.resolve();
        await termination;
        expect(proofShutdownCompleted).toBe(true);
        expect(quitApplication).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
      } else {
        const failed = expect(termination).rejects.toThrow(
          'synthetic proof failure',
        );
        shutdown.reject(new Error('synthetic proof failure'));
        await failed;
        expect(proofShutdownCompleted).toBe(false);
        expect(quitApplication).not.toHaveBeenCalled();
        expect(destroy).not.toHaveBeenCalled();
      }
      expect(proofQuitEvent.preventDefault).not.toHaveBeenCalled();
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.quitApplication).not.toHaveBeenCalled();
    },
  );

  it('wires the production handler and confines the bypass to proof termination', async () => {
    const source = await readFile(
      new URL('./index.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('let w6b2ProofShutdownCompleted = false;');
    expect(
      source.match(/w6b2ProofShutdownCompleted\s*=\s*true/g),
    ).toHaveLength(1);
    expect(source).toMatch(
      /await terminateW6b2PackagedProofRuntime\(\{\s*lifecycle: desktopLifecycle,\s*quitApplication\(\) \{\s*w6b2ProofShutdownCompleted = true;\s*app\.quit\(\);\s*\}/,
    );
    expect(source).toMatch(
      /const handleBeforeQuit = createDesktopBeforeQuitHandler\(\{\s*invalidateStartupReporting,\s*closeStartupAdmission: \(\) => recoveryStartup\?\.beforeQuit\(\),\s*readLifecycle: \(\) => desktopLifecycle \?\? recoveryStartup\?\.readLifecycle\(\),\s*quitApplication: \(\) => app\.quit\(\),\s*\}\);/,
    );
    expect(source).toMatch(
      /app\.on\('before-quit', \(event\) => \{\s*if \(w6b2ProofShutdownCompleted\) \{\s*invalidateStartupReporting\(\);\s*return;\s*\}\s*void handleBeforeQuit\(event\);\s*\}\);/,
    );
    expect(source).toMatch(
      /app\.on\('window-all-closed', \(\) => \{\s*if \(\s*!smokeConfiguration\.enabled &&\s*w6b2ProofConfiguration === undefined &&\s*!desktopLifecycle\?\.isInstallerHandoffPending\(\)/,
    );
  });

  it('wires the same shutdown guard into the Electron E2E entrypoint without a pending-quit bypass', async () => {
    const source = await readFile(
      new URL('../../e2e/electronE2eEntrypoint.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "import { createDesktopBeforeQuitHandler } from '../src/main/desktopBeforeQuit.js';",
    );
    expect(source).toMatch(
      /const handleBeforeQuit = createDesktopBeforeQuitHandler\(\{\s*closeStartupAdmission: \(\) => recoveryStartup\?\.beforeQuit\(\),\s*readLifecycle: \(\) => readElectronE2eQuitLifecycle\(lifecycle \?\? recoveryStartup\?\.readLifecycle\(\),\s*recoveryStartup === undefined \? undefined : deletionExecutionProof\?\.waitForPreparation\),\s*quitApplication: \(\) => app\.quit\(\),\s*\}\);/,
    );
    expect(source.match(/app\.on\('before-quit'/g)).toHaveLength(1);
    expect(source).toMatch(
      /app\.on\('before-quit', \(event\) => \{\s*deletionExecutionProof\?\.markPhaseShutdown\(\);\s*deletionProof\?\.closeChannel\(\);\s*deletionExecutionProof\?\.close\(\);\s*void handleBeforeQuit\(event\);\s*\}\);/,
    );
    expect(source).not.toContain('shutdownStarted');
    expect(source).toContain("app.on('window-all-closed', () => app.quit());");
  });
});

function createEvent() {
  return { preventDefault: vi.fn() };
}

function createDeferredShutdown() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createFixture(shutdown: () => Promise<void>, invalidateStartupReporting?: () => void) {
  const stop = vi.fn(shutdown);
  const invalidate = vi.fn(invalidateStartupReporting);
  const isInstallerHandoffPending = vi.fn(() => false);
  const readLifecycle = vi.fn<() => { shutdown(): Promise<void>; deferQuitForInstallerHandoff?(): boolean } | undefined>(
    () => ({ shutdown: stop, deferQuitForInstallerHandoff: isInstallerHandoffPending }),
  );
  const finalQuitEvent = createEvent();
  let handleBeforeQuit: ReturnType<typeof createDesktopBeforeQuitHandler>;
  const quitApplication = vi.fn(() => {
    void handleBeforeQuit(finalQuitEvent);
  });
  handleBeforeQuit = createDesktopBeforeQuitHandler({
    ...(invalidateStartupReporting === undefined ? {} : { invalidateStartupReporting: invalidate }),
    readLifecycle,
    quitApplication,
  });

  return {
    handleBeforeQuit,
    invalidateStartupReporting: invalidate,
    isInstallerHandoffPending,
    shutdown: stop,
    readLifecycle,
    quitApplication,
    finalQuitEvent,
  };
}
