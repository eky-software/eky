import type {
  E2eProcessStartupObservation,
  E2eProcessStartupTerminal,
} from './e2eProcessStartupObservation.js';

export type ObservedProcessHealth =
  | { readonly kind: 'healthy' | E2eProcessStartupTerminal }
  | { readonly kind: 'healthFailed'; readonly error: unknown };

export async function waitForObservedProcessHealth(input: {
  readonly startup: E2eProcessStartupObservation;
  waitForHealth(signal: AbortSignal): Promise<void>;
}): Promise<ObservedProcessHealth> {
  let unsubscribe = () => {};
  const terminal = new Promise<ObservedProcessHealth>((resolve) => {
    const readTerminal = () => {
      const state = input.startup.readState();
      if (state.terminal !== undefined) resolve({ kind: state.terminal });
    };
    unsubscribe = input.startup.subscribe(readTerminal);
    readTerminal();
  });
  const healthAbort = new AbortController();
  const health = Promise.resolve()
    .then(() => input.waitForHealth(healthAbort.signal))
    .then<ObservedProcessHealth, ObservedProcessHealth>(
      () => ({ kind: 'healthy' }),
      (error: unknown) => ({ kind: 'healthFailed', error }),
    );
  let outcome: ObservedProcessHealth;
  try {
    outcome = await Promise.race([health, terminal]);
  } finally {
    healthAbort.abort();
    await health;
    unsubscribe();
  }
  const state = input.startup.readState();
  // A queued successful response cannot overrule the actual workload's exit.
  if (state.terminal !== undefined) return { kind: state.terminal };
  if (outcome.kind === 'healthy' && !state.spawnObserved) return { kind: 'observationLost' };
  return outcome;
}
