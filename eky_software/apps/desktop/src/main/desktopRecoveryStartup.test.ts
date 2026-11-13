import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { runSafeDesktopStartup } from './earlyStartup.js';
import { createRecoveryObservationExperiment } from './desktopRecoveryStartupExperimentTestSupport.js';
import { createDesktopRecoveryObservation, createDesktopRecoveryStartup as createRecoveryStartupExperiment } from './desktopRecoveryStartup.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function quitFixture(startup: ReturnType<typeof createRecoveryStartupExperiment>) {
  const reportingInvalidated = vi.fn();
  const finalEvent = { preventDefault: vi.fn() };
  const quit = vi.fn(() => { void handle(finalEvent); });
  const handle = createDesktopBeforeQuitHandler({
    invalidateStartupReporting() { startup.beforeQuit(); reportingInvalidated(); },
    readLifecycle: startup.readLifecycle,
    quitApplication: quit,
  });
  return { handle, quit, finalEvent, reportingInvalidated };
}

it('creates a close handle before the first read and shares idempotent settlement', async () => {
  const observation = createDesktopRecoveryObservation(), work = vi.fn(async () => undefined);
  const pending = observation.run(work);
  observation.closeAdmission();
  observation.closeAdmission();
  const settlement = observation.waitForSettlement();
  expect(observation.waitForSettlement()).toBe(settlement);
  await expect(pending).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  await settlement;
  expect(work).not.toHaveBeenCalled();
  expect(observation.signal.aborted).toBe(true);
  expect(() => observation.run(work)).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
});

it('retains a settled first error while still joining the other held read', async () => {
  const observation = createDesktopRecoveryObservation(), entered = deferred(), held = deferred();
  const first = new Error('synthetic first read failure'), second = new Error('synthetic later read failure');
  const sibling = observation.run(async () => { entered.resolve(); await held.promise; throw second; });
  void sibling.catch(() => undefined);
  await entered.promise;
  await expect(observation.run(async () => { throw first; })).rejects.toBe(first);
  observation.closeAdmission();
  let settled = false;
  const settlement = observation.waitForSettlement().finally(() => { settled = true; });
  void settlement.catch(() => undefined);
  try {
    await nextTurn();
    expect(settled).toBe(false);
    expect(observation.assertCurrent).toThrow(first);
  } finally { held.resolve(); }
  await expect(sibling).rejects.toBe(second);
  await expect(settlement).rejects.toBe(first);
  await expect(observation.waitForSettlement()).rejects.toBe(first);
});

it('refuses settlement before admission closes without sealing a future read', async () => {
  const observation = createDesktopRecoveryObservation();
  expect(() => observation.waitForSettlement()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(await observation.run(async () => 'selected')).toBe('selected');
  observation.closeAdmission();
  await observation.waitForSettlement();
});

it('joins a held sibling after intentional signal cancellation without a close failure', async () => {
  const observation = createDesktopRecoveryObservation(), entered = deferred(), held = deferred();
  const sibling = observation.run(async () => { entered.resolve(); await held.promise; });
  void sibling.catch(() => undefined);
  const cancelled = observation.run(() => new Promise<void>((_resolve, reject) => {
    observation.signal.addEventListener('abort', () => reject(observation.signal.reason), { once: true });
  }));
  void cancelled.catch(() => undefined);
  await entered.promise;
  observation.closeAdmission();
  let settled = false;
  const closing = observation.waitForSettlement().finally(() => { settled = true; });
  void closing.catch(() => undefined);
  try {
    await expect(cancelled).rejects.toBe(observation.signal.reason);
    await nextTurn();
    expect(settled).toBe(false);
  } finally { held.resolve(); }
  await expect(sibling).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  await expect(closing).resolves.toBeUndefined();
});

it('publishes the shared close before a synchronous abort re-enters the real quit handler', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const quit = quitFixture(startup), entered = deferred(), finish = deferred();
  const reentrant: Promise<void>[] = [];
  observation.signal.addEventListener('abort', () => { reentrant.push(quit.handle({ preventDefault: vi.fn() })); });
  const finished = startup.start(async port => {
    port.registerObservation(observation); entered.resolve();
    await finish.promise;
    return undefined;
  });
  try {
    await entered.promise;
    const event = { preventDefault: vi.fn() }, pending = quit.handle(event);
    expect(startup.port.isClosing()).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(startup.shutdown()).toBe(startup.shutdown());
    await nextTurn();
    expect(quit.quit).not.toHaveBeenCalled();
    finish.resolve();
    await finished; await pending; await Promise.all(reentrant);
    expect(quit.quit).toHaveBeenCalledOnce();
    expect(quit.finalEvent.preventDefault).not.toHaveBeenCalled();
  } finally { finish.resolve(); await finished; await Promise.all(reentrant); }
});

it('does not equate dialog abort with settlement of a sibling read', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const quit = quitFixture(startup), entered = deferred(), read = deferred<string>();
  let answerConsumed = false;
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    const reading = observation.run(() => read.promise);
    const dialog = observation.run(() => new Promise<void>(resolve => {
      observation.signal.addEventListener('abort', () => resolve(), { once: true });
      entered.resolve();
    }));
    try { await dialog; answerConsumed = true; }
    catch { /* Intentional closure is not a successful selection. */ }
    finally { observation.closeAdmission(); await Promise.allSettled([reading, dialog]); await observation.waitForSettlement(); }
    return undefined;
  });
  try {
    await entered.promise;
    const pending = quit.handle({ preventDefault: vi.fn() });
    await nextTurn();
    expect(answerConsumed).toBe(false); expect(quit.quit).not.toHaveBeenCalled();
    expect(() => observation.run(async () => undefined)).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    read.resolve('late bytes');
    await finished; await pending;
    expect(quit.quit).toHaveBeenCalledOnce();
  } finally { read.resolve('late bytes'); await finished; }
});

it.for(['selector', 'runtime'] as const)('drains a late %s lifecycle instead of publishing it', async (_kind) => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const quit = quitFixture(startup), entered = deferred(), construction = deferred(), closing = deferred(), stopped = deferred();
  const lifecycle = { shutdown: vi.fn(async () => { closing.resolve(); await stopped.promise; }) };
  const finished = startup.start(async port => { port.registerObservation(observation); entered.resolve(); await construction.promise; return lifecycle; });
  try {
    await entered.promise;
    const pending = quit.handle({ preventDefault: vi.fn() });
    construction.resolve(); await closing.promise;
    expect(startup.readLifecycle()).not.toBe(lifecycle);
    expect(quit.quit).not.toHaveBeenCalled();
    stopped.resolve(); await finished; await pending;
    expect(lifecycle.shutdown).toHaveBeenCalledOnce(); expect(quit.quit).toHaveBeenCalledOnce();
  } finally { construction.resolve(); stopped.resolve(); await finished; }
});

it('keeps the stop latch after successful handoff and preserves ordinary lifecycle ownership', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const quit = quitFixture(startup), stop = deferred();
  const lifecycle = { shutdown: vi.fn(() => stop.promise) };
  await startup.start(async port => { port.registerObservation(observation); observation.closeAdmission(); return lifecycle; });
  expect(startup.readLifecycle()).toBe(lifecycle); expect(startup.port.isClosing()).toBe(false);
  const pending = quit.handle({ preventDefault: vi.fn() });
  try {
    expect(startup.port.isClosing()).toBe(true);
    expect(lifecycle.shutdown).toHaveBeenCalledOnce();
    await quit.handle({ preventDefault: vi.fn() });
    expect(quit.quit).not.toHaveBeenCalled();
  } finally { stop.resolve(); await pending; }
  expect(lifecycle.shutdown).toHaveBeenCalledOnce();
});

it('allows the composition to request quit without awaiting its own wrapper', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment(), quit = quitFixture(startup);
  const requests: Promise<void>[] = [];
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    observation.closeAdmission(); await observation.waitForSettlement();
    requests.push(quit.handle({ preventDefault: vi.fn() }));
    return undefined;
  });
  await finished; await Promise.all(requests);
  expect(quit.quit).toHaveBeenCalledOnce();
});

it('joins failed local work before the real early-startup failure presentation and direct exit', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const original = new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  const cleanup = new Error('synthetic sibling close failure'), entered = deferred(), sibling = deferred();
  const shown = vi.fn(), exit = vi.fn(), observed = vi.fn();
  const finished = runSafeDesktopStartup({
    waitUntilReady: async () => undefined,
    loadRuntime: async () => ({ startDesktopComposition: true }),
    observeStartupException: observed,
    async startRuntime() {
      const outcome = await startup.start(async port => {
        port.registerObservation(observation);
        void observation.run(async () => { entered.resolve(); await sibling.promise; throw cleanup; });
        await entered.promise;
        throw original;
      });
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBe(original);
        expect(outcome.cleanupError).toMatchObject({ errors: expect.arrayContaining([cleanup]) });
        throw outcome.reason;
      }
    },
    onFailure: shown, exitApplication: exit,
  });
  try {
    await entered.promise; await nextTurn();
    expect(shown).not.toHaveBeenCalled(); expect(exit).not.toHaveBeenCalled();
    expect(startup.port.isClosing()).toBe(false);
    sibling.resolve(); await finished;
    expect(observed).toHaveBeenCalledExactlyOnceWith(original);
    expect(shown).toHaveBeenCalledExactlyOnceWith(original.message);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(shown.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]!);
  } finally { sibling.resolve(); await finished; }
});

it('keeps cleanup authority usable during an explicitly selected normal recovery', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const quit = quitFixture(startup), entered = deferred(), settle = deferred();
  const authority = vi.fn(), stopped = vi.fn(async () => undefined);
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    await observation.run(async () => 'same target');
    observation.closeAdmission(); await observation.waitForSettlement();
    entered.resolve(); await settle.promise;
    authority();
    return { shutdown: stopped };
  });
  try {
    await entered.promise;
    const pending = quit.handle({ preventDefault: vi.fn() });
    expect(observation.signal.aborted).toBe(true);
    settle.resolve(); await finished; await pending;
    expect(authority).toHaveBeenCalledOnce(); expect(stopped).toHaveBeenCalledOnce();
  } finally { settle.resolve(); await finished; }
});

it('rejects registration after stop and duplicate registration without replacing the original owner', async () => {
  const startup = createRecoveryStartupExperiment(), first = createRecoveryObservationExperiment(), second = createRecoveryObservationExperiment();
  const finished = startup.start(async port => {
    port.registerObservation(first);
    expect(() => port.registerObservation(second)).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    startup.beforeQuit();
    expect(() => port.registerObservation(second)).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    return undefined;
  });
  await finished;
  expect(first.signal.aborted).toBe(true); expect(second.signal.aborted).toBe(false);
});

it.for(['emptySuccess', 'failure'] as const)('rejects a stale registration after raw %s without an earlier observation', async outcome => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const failure = new Error('synthetic completed startup failure');
  const result = await startup.start(async () => {
    if (outcome === 'failure') throw failure;
    return undefined;
  });
  expect(result.status).toBe(outcome === 'failure' ? 'rejected' : 'fulfilled');
  expect(() => startup.port.registerObservation(observation)).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(startup.readLifecycle()).toBeUndefined();
  expect(observation.signal.aborted).toBe(false);
});

it('does not publish a successful raw return while an admitted observation is still running', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const entered = deferred(), held = deferred(), completed = vi.fn();
  const lifecycle = { shutdown: vi.fn(async () => undefined) };
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    void observation.run(async () => { entered.resolve(); await held.promise; });
    await entered.promise;
    return lifecycle;
  }).then(outcome => { completed(); return outcome; });
  try {
    await entered.promise; await nextTurn();
    expect(completed).not.toHaveBeenCalled(); expect(startup.readLifecycle()).not.toBe(lifecycle);
    held.resolve();
    expect(await finished).toMatchObject({ status: 'fulfilled', lifecycle });
    expect(startup.readLifecycle()).toBe(lifecycle);
    expect(lifecycle.shutdown).not.toHaveBeenCalled();
  } finally { held.resolve(); await finished; }
});

it('drains a returned lifecycle when late local failure invalidates a successful raw return', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const entered = deferred(), held = deferred(), failure = new Error('synthetic late observation failure');
  const lifecycle = { shutdown: vi.fn(async () => undefined) };
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    void observation.run(async () => { entered.resolve(); await held.promise; throw failure; });
    await entered.promise;
    return lifecycle;
  });
  try {
    await entered.promise; await nextTurn();
    expect(startup.readLifecycle()).not.toBe(lifecycle);
    held.resolve();
    expect(await finished).toMatchObject({ status: 'rejected', reason: failure });
    expect(startup.readLifecycle()).not.toBe(lifecycle);
    expect(lifecycle.shutdown).toHaveBeenCalledOnce(); expect(startup.port.isClosing()).toBe(false);
  } finally { held.resolve(); await finished; }
});

it('keeps the fallback when quit arrives during the post-return observation join', async () => {
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  const quit = quitFixture(startup), entered = deferred(), held = deferred(), rawReturned = deferred();
  const lifecycle = { shutdown: vi.fn(async () => undefined) };
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    void observation.run(async () => { entered.resolve(); await held.promise; });
    await entered.promise; rawReturned.resolve();
    return lifecycle;
  });
  try {
    await rawReturned.promise; await nextTurn();
    const event = { preventDefault: vi.fn() }, pending = quit.handle(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(startup.readLifecycle()).not.toBe(lifecycle); expect(quit.quit).not.toHaveBeenCalled();
    held.resolve(); await finished; await pending;
    expect(lifecycle.shutdown).toHaveBeenCalledOnce(); expect(quit.quit).toHaveBeenCalledOnce();
  } finally { held.resolve(); await finished; }
});

it('joins both local settlement and lifecycle close after a synchronous admission-close failure', async () => {
  const startup = createRecoveryStartupExperiment(), entered = deferred(), held = deferred(), stopEntered = deferred();
  const closeError = new Error('synthetic admission close failure'), stopError = new Error('synthetic lifecycle stop failure');
  const lateError = new Error('synthetic later local settlement failure');
  const localSettlement = vi.fn(async () => { await held.promise; throw lateError; });
  const lifecycle = { shutdown: vi.fn(async () => { stopEntered.resolve(); throw stopError; }) };
  const finished = startup.start(async port => {
    port.registerObservation({ closeAdmission() { throw closeError; }, waitForSettlement: localSettlement });
    entered.resolve(); return lifecycle;
  });
  const failed = expect(finished).resolves.toMatchObject({ status: 'rejected', reason: closeError,
    cleanupError: { errors: expect.arrayContaining([closeError, lateError, stopError]) } });
  try {
    await entered.promise; await stopEntered.promise;
    expect(startup.readLifecycle()).not.toBe(lifecycle);
    expect(lifecycle.shutdown).toHaveBeenCalledOnce();
    held.resolve(); await failed;
    expect(localSettlement).toHaveBeenCalledOnce(); expect(lifecycle.shutdown).toHaveBeenCalledOnce();
  } finally { held.resolve(); await finished; }
});
