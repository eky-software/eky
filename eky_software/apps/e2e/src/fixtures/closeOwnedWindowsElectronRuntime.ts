import type { E2eFixtureLifetime } from '../environment/e2eFixtureLifetime.js';
import type { OwnedWindowsElectronBridge } from '../environment/startOwnedWindowsElectronBridge.js';
import { ELECTRON_E2E_GRACEFUL_EXIT_SAFETY_TIMEOUT_MILLISECONDS } from './electronLaunchBudgets.js';
import failureCodes from './electronPublicCloseFailureCodes.json' with { type: 'json' };

export type ElectronPublicCloseFailureReason = keyof typeof failureCodes;

interface CloseInput {
  application?: { close(): Promise<void> };
  alreadyClosed?: boolean;
  owner: Pick<OwnedWindowsElectronBridge, 'stop'>;
  lifetime: E2eFixtureLifetime;
  observePublicCloseFailure?(reason: ElectronPublicCloseFailureReason): void;
}

interface CloseDependencies {
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}

const defaults: CloseDependencies = {
  now: () => performance.now(),
  schedule(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

export async function closeOwnedWindowsElectronRuntime(
  input: CloseInput,
  overrides: Partial<CloseDependencies> = {},
): Promise<void> {
  let closeFailure: Error | undefined;
  let timedOut = false;
  let cancel: (() => void) | undefined;
  try {
    const { application } = input;
    if (application && !input.alreadyClosed) {
      const { now, schedule } = { ...defaults, ...overrides };
      const started = now();
      const remaining = input.lifetime.readRemainingWorkMilliseconds();
      if (!Number.isFinite(started) || started < 0 ||
        !Number.isSafeInteger(remaining) || remaining < 0) {
        throw new Error('Invalid close clock.');
      }
      const budget = Math.min(remaining, ELECTRON_E2E_GRACEFUL_EXIT_SAFETY_TIMEOUT_MILLISECONDS);
      if (budget === 0) {
        timedOut = true;
        throw new Error('Close deadline exhausted.');
      }
      const deadline = started + budget;
      try {
        await new Promise<void>((resolveClose, rejectClose) => {
          cancel = schedule(() => {
            timedOut = true;
            rejectClose();
          }, budget);
          application.close().then(() => {
            try {
              const completed = now();
              const remainingAtClose = input.lifetime.readRemainingWorkMilliseconds();
              if (!Number.isFinite(completed) || completed < started ||
                !Number.isSafeInteger(remainingAtClose) || remainingAtClose < 0) {
                throw new Error('Invalid close clock.');
              }
              // A delayed timer callback must not turn a late close into success.
              if (completed >= deadline || remainingAtClose === 0) {
                timedOut = true;
                rejectClose();
              } else {
                resolveClose();
              }
            } catch {
              rejectClose();
            }
          }, () => rejectClose());
        });
      } finally {
        cancel?.();
      }
    }
  } catch {
    const reason = timedOut ? 'timedOut' : 'failed';
    closeFailure = new Error(failureCodes[reason]);
    // Record before owner-stop can replace the public-close error. No I/O or wait.
    try { input.observePublicCloseFailure?.(reason); } catch {
      // An optional observation cannot interrupt the existing cleanup chain.
    }
  }

  // The existing owner alone verifies cleanup; retain its safe, private-backed error.
  await input.owner.stop();
  if (closeFailure) throw closeFailure;
}
