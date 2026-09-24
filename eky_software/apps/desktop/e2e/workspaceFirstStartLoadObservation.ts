export const firstStartLoadSlots = ['mixedInitial', 'mixedRestart', 'currentInitial', 'currentRestart'] as const;
export type FirstStartLoadSlot = (typeof firstStartLoadSlots)[number];
export const firstStartLoadEvents = [
  'windowObserved', 'loadRequested', 'loadHeld', 'loadStarted', 'loadSucceeded',
  'loadRejected', 'mainFrameFailed', 'shutdownStarted', 'protocolRemoved',
  'protocolRemovalUnverified', 'loadReleased', 'loadErrorDialog', 'otherErrorDialog',
  'quitRequested', 'gateCancelled', 'hookReleased',
] as const;
export type FirstStartLoadEvent = (typeof firstStartLoadEvents)[number];
export type FirstStartLoadPhase = `${FirstStartLoadSlot}:${FirstStartLoadEvent}`;
export const firstStartLoadPhases: readonly FirstStartLoadPhase[] = firstStartLoadSlots.flatMap(
  (slot) => firstStartLoadEvents.map((event): FirstStartLoadPhase => `${slot}:${event}`),
);

export interface FirstStartLoadSnapshot {
  readonly loadRequests: number;
  readonly loadStarts: number;
  readonly loadSucceeded: number;
  readonly loadRejected: number;
  readonly mainFrameFailures: number;
  readonly loadErrorDialogs: number;
  readonly otherErrorDialogs: number;
  readonly quitRequests: number;
  readonly protocolRemoved: boolean;
  readonly releasedAfterRemoval: boolean;
  readonly cancelled: boolean;
}

type LoadOutcome = { failed: false } | { failed: true; error: unknown };

// Test-only state. The ordinary path returns the exact native load promise;
// only the separate experiment defers invocation until its owner removes the protocol.
export function createFirstStartLoadProbe(input: {
  holdUntilProtocolRemoval: boolean;
  observe(event: FirstStartLoadEvent): void;
}) {
  let loadRequests = 0;
  let loadStarts = 0;
  let loadSucceeded = 0;
  let loadRejected = 0;
  let mainFrameFailures = 0;
  let loadErrorDialogs = 0;
  let otherErrorDialogs = 0;
  let quitRequests = 0;
  let protocolRemoved = false;
  let shutdownStarted = false;
  let releasedAfterRemoval = false;
  let cancelled = false;
  let loadSettled = false;
  let resolveLoadOutcome!: (outcome: LoadOutcome) => void;
  const loadOutcome = new Promise<LoadOutcome>((resolve) => { resolveLoadOutcome = resolve; });
  const settleLoad = (outcome: LoadOutcome) => {
    if (loadSettled) return;
    loadSettled = true;
    resolveLoadOutcome(outcome);
  };
  let release: (() => void) | undefined;
  let cancel: (() => void) | undefined;
  let completeForced: () => void = () => undefined;
  const forcedOutcome = new Promise<void>((resolve) => { completeForced = resolve; });
  const observe = (event: FirstStartLoadEvent) => {
    try { input.observe(event); } catch { /* Evidence cannot alter native callbacks. */ }
  };
  const snapshot = (): FirstStartLoadSnapshot => Object.freeze({
    loadRequests, loadStarts, loadSucceeded, loadRejected, mainFrameFailures,
    loadErrorDialogs, otherErrorDialogs, quitRequests, protocolRemoved,
    releasedAfterRemoval, cancelled,
  });
  return {
    snapshot,
    forcedOutcome,
    observe,
    wrapLoad<Args extends unknown[]>(load: (...args: Args) => Promise<void>) {
      return (...args: Args): Promise<void> => {
        loadRequests++;
        observe('loadRequested');
        const invoke = () => {
          loadStarts++;
          observe('loadStarted');
          let promise: Promise<void>;
          try { promise = load(...args); } catch (error) {
            loadRejected++;
            observe('loadRejected');
            settleLoad({ failed: true, error });
            throw error;
          }
          void promise.then(() => {
            loadSucceeded++;
            observe('loadSucceeded');
            settleLoad({ failed: false });
            completeForced();
          }, (error: unknown) => {
            loadRejected++;
            observe('loadRejected');
            settleLoad({ failed: true, error });
          });
          return promise;
        };
        if (!input.holdUntilProtocolRemoval) return invoke();
        if (loadRequests !== 1 || shutdownStarted || cancelled) {
          throw new Error('E2E_FIRST_START_LOAD_GATE_INVALID');
        }
        observe('loadHeld');
        return new Promise<void>((resolve, reject) => {
          release = () => {
            release = undefined;
            cancel = undefined;
            releasedAfterRemoval = protocolRemoved;
            observe('loadReleased');
            try { resolve(invoke()); } catch (error) { reject(error); }
          };
          cancel = () => {
            release = undefined;
            cancel = undefined;
            cancelled = true;
            observe('gateCancelled');
            reject(new Error('E2E_FIRST_START_LOAD_GATE_CANCELLED'));
            completeForced();
          };
        });
      };
    },
    async waitForLoadBeforeShutdown(): Promise<void> {
      // The separate negative experiment deliberately starts loading after removal.
      if (input.holdUntilProtocolRemoval) return;
      if (cancelled || loadRequests !== 1 || loadStarts !== 1) {
        throw new Error('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      }
      const outcome = await loadOutcome;
      if (outcome.failed) throw outcome.error;
      if (cancelled || loadRequests !== 1 || loadStarts !== 1) {
        throw new Error('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      }
    },
    mainFrameFailed() { mainFrameFailures++; observe('mainFrameFailed'); },
    shutdownStarted() { shutdownStarted = true; observe('shutdownStarted'); },
    protocolRemoved(removed: boolean, absent: boolean) {
      protocolRemoved = shutdownStarted && removed && absent;
      observe(protocolRemoved ? 'protocolRemoved' : 'protocolRemovalUnverified');
      if (protocolRemoved) release?.();
    },
    showErrorBox(title: string, message: string) {
      // Classify the existing composition branch, never export dialog text.
      if (title === 'Eky ei käynnistynyt' && message === 'Käyttöliittymää ei voitu ladata turvallisesti.') {
        loadErrorDialogs++;
        observe('loadErrorDialog');
      } else {
        otherErrorDialogs++;
        observe('otherErrorDialog');
      }
    },
    quitRequested() { quitRequests++; observe('quitRequested'); completeForced(); },
    assertComplete() {
      if (cancelled || loadRequests !== 1 || loadStarts !== 1 || !protocolRemoved) {
        throw new Error('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      }
      if (input.holdUntilProtocolRemoval) {
        // Native loadURL can reject without did-fail-load; retain that event as supplementary evidence.
        if (!releasedAfterRemoval || loadRejected !== 1 || loadSucceeded !== 0 ||
            loadErrorDialogs !== 1 || otherErrorDialogs !== 0 || quitRequests !== 1) {
          throw new Error('E2E_FIRST_START_LOAD_MECHANISM_NOT_DEMONSTRATED');
        }
      } else if (loadErrorDialogs !== 0 || otherErrorDialogs !== 0 || quitRequests !== 0 ||
          loadRejected !== 0 || mainFrameFailures !== 0) {
        throw new Error('E2E_FIRST_START_LOAD_UNEXPECTED_FAILURE');
      } else if (loadSucceeded !== 1) {
        throw new Error('E2E_FIRST_START_LOAD_OBSERVATION_INCOMPLETE');
      }
    },
    dispose() {
      cancel?.();
      if (!input.holdUntilProtocolRemoval && loadRequests > 0 && !loadSettled) {
        cancelled = true;
        observe('gateCancelled');
        settleLoad({ failed: true, error: new Error('E2E_FIRST_START_LOAD_GATE_CANCELLED') });
      }
      observe('hookReleased');
    },
  };
}

export type FirstStartLoadProbe = ReturnType<typeof createFirstStartLoadProbe>;
