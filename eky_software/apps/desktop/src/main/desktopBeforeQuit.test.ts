import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { terminateW6b2PackagedProofRuntime } from './w6b2PackagedProofTermination.js';

describe('desktop before-quit handler', () => {
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
      /const handleBeforeQuit = createDesktopBeforeQuitHandler\(\{\s*readLifecycle: \(\) => desktopLifecycle,\s*quitApplication: \(\) => app\.quit\(\),\s*\}\);/,
    );
    expect(source).toMatch(
      /app\.on\('before-quit', \(event\) => \{\s*if \(w6b2ProofShutdownCompleted\) return;\s*void handleBeforeQuit\(event\);\s*\}\);/,
    );
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

function createFixture(shutdown: () => Promise<void>) {
  const stop = vi.fn(shutdown);
  const readLifecycle = vi.fn<() => { shutdown(): Promise<void> } | undefined>(
    () => ({ shutdown: stop }),
  );
  const finalQuitEvent = createEvent();
  let handleBeforeQuit: ReturnType<typeof createDesktopBeforeQuitHandler>;
  const quitApplication = vi.fn(() => {
    void handleBeforeQuit(finalQuitEvent);
  });
  handleBeforeQuit = createDesktopBeforeQuitHandler({
    readLifecycle,
    quitApplication,
  });

  return {
    handleBeforeQuit,
    shutdown: stop,
    readLifecycle,
    quitApplication,
    finalQuitEvent,
  };
}
