import type { DesktopQuitLifecycle } from './desktopBeforeQuit.js';

export interface DesktopRecoveryStartupObservation {
  closeAdmission(): void;
  waitForSettlement(): Promise<void>;
}

export interface DesktopRecoveryStartupPort {
  registerObservation(owner: DesktopRecoveryStartupObservation): void;
  isClosing(): boolean;
}

/** Startup-local work only; closing this scope never revokes a transferred main owner. */
export function createDesktopRecoveryObservation() {
  const controller = new AbortController();
  const cancelled = new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  let firstFailure: { cause: unknown } | undefined;
  let settlement: Promise<void> | undefined;
  const assertCurrent = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    if (closed) throw cancelled;
  };
  return Object.freeze({
    signal: controller.signal,
    assertCurrent,
    closeAdmission() {
      if (closed) return;
      closed = true;
      controller.abort(cancelled);
    },
    run<T>(work: () => Promise<T>): Promise<T> {
      assertCurrent();
      const task = Promise.resolve().then(async () => {
        try {
          assertCurrent();
          const value = await work();
          assertCurrent();
          return value;
        } catch (cause) {
          if (cause !== cancelled) firstFailure ??= { cause };
          throw cause;
        }
      });
      pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    },
    waitForSettlement(): Promise<void> {
      if (!closed) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      settlement ??= Promise.resolve().then(async () => {
        await Promise.allSettled([...pending]);
        if (firstFailure !== undefined) throw firstFailure.cause;
      });
      return settlement;
    },
  });
}

type CompositionOutcome<Lifecycle> =
  | { status: 'fulfilled'; lifecycle: Lifecycle | undefined }
  | { status: 'rejected'; reason: unknown; cleanupError?: unknown };

/** One recovery entry's quit bridge, never a reservation or mutation owner. */
export function createDesktopRecoveryStartup<Lifecycle extends DesktopQuitLifecycle = DesktopQuitLifecycle>() {
  let closing = false;
  let registered = false;
  let started = false;
  let compositionSettled = false;
  let observation: DesktopRecoveryStartupObservation | undefined;
  let lifecycle: Lifecycle | undefined;
  let fallback: DesktopQuitLifecycle | undefined;
  let raw: Promise<CompositionOutcome<Lifecycle>> | undefined;
  let shutdownTask: Promise<void> | undefined;
  let drainTask: Promise<void> | undefined;
  let observationSealed = false;
  let observationSettlement: Promise<void> | undefined;
  const closeFailures: unknown[] = [];
  const fail = () => new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  const closeObservation = () => {
    if (observationSealed) return;
    observationSealed = true;
    try { observation?.closeAdmission(); }
    catch (error) { closeFailures.push(error); }
  };
  const waitObservation = () => {
    observationSettlement ??= Promise.resolve().then(() => observation?.waitForSettlement());
    return observationSettlement;
  };
  const drain = (outcome: CompositionOutcome<Lifecycle>): Promise<void> => {
    drainTask ??= Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        waitObservation(),
        Promise.resolve().then(() => outcome.status === 'fulfilled' ? outcome.lifecycle?.shutdown() : undefined),
      ]);
      const failures = [...closeFailures, ...results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])];
      if (failures.length !== 0) throw new AggregateError(failures, 'DESKTOP_SHUTDOWN_FAILED', { cause: failures[0] });
    });
    return drainTask;
  };
  const shutdown = (): Promise<void> => {
    if (shutdownTask !== undefined) return shutdownTask;
    closing = true;
    // Publish before abort callbacks can synchronously request another quit.
    shutdownTask = Promise.resolve().then(async () => {
      if (raw === undefined) throw fail();
      await drain(await raw);
    });
    closeObservation();
    return shutdownTask;
  };
  const port: Readonly<DesktopRecoveryStartupPort> = Object.freeze({
    registerObservation(owner: DesktopRecoveryStartupObservation) {
      if (!started || compositionSettled || closing || registered || lifecycle !== undefined) throw fail();
      registered = true;
      observation = owner;
      fallback = { shutdown };
    },
    isClosing: () => closing,
  });
  return Object.freeze({
    port,
    shutdown,
    readLifecycle: () => lifecycle ?? fallback,
    beforeQuit() {
      closing = true;
      if (fallback !== undefined) void shutdown().catch(() => undefined);
    },
    start(compose: (input: Readonly<DesktopRecoveryStartupPort>) => Promise<Lifecycle | undefined>): Promise<CompositionOutcome<Lifecycle>> {
      if (started || closing) throw fail();
      started = true;
      // The raw outcome never waits on reporting or this external quit wrapper.
      raw = Promise.resolve().then(() => compose(port)).then<CompositionOutcome<Lifecycle>, CompositionOutcome<Lifecycle>>(
        value => { compositionSettled = true; return { status: 'fulfilled', lifecycle: value }; },
        reason => { compositionSettled = true; return { status: 'rejected', reason }; },
      );
      return raw.then(async outcome => {
        closeObservation();
        if (outcome.status === 'rejected') {
          let cleanupError: unknown;
          try { await drain(outcome); } catch (error) { cleanupError = error; }
          return { ...outcome, cleanupError };
        }
        try {
          if (closeFailures.length !== 0) throw closeFailures[0];
          await waitObservation();
        } catch (reason) {
          let cleanupError: unknown;
          try { await drain(outcome); } catch (error) { cleanupError = error; }
          return { status: 'rejected', reason, cleanupError };
        }
        if (closing) {
          await shutdown();
        } else {
          // No await may expose a gap between ready and startup ownership.
          lifecycle = outcome.lifecycle;
          fallback = undefined;
        }
        return outcome;
      });
    },
  });
}
