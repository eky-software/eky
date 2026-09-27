import { resolve } from 'node:path';

import { createElectronEnvironment } from './createElectronEnvironment.js';
import type { ElectronE2eRuntime } from './createElectronE2eRuntime.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import type { E2eProcessStartupState } from './e2eProcessStartupObservation.js';
import { OwnedWindowsElectronStartupFailure, startOwnedWindowsElectron } from './startOwnedWindowsElectron.js';
import type { ObservedWindowsService, OwnedWindowsServiceStartupFailureCode } from './startOwnedWindowsService.js';

type FailureCode = 'startupFailed' | 'exitDeadlineExceeded' | 'observationLost' | 'exitCodeUnavailable' | 'unexpectedExitCode' | 'cleanupFailed';
export class DirectElectronRunFailure extends Error {
  constructor(readonly failure: FailureCode, readonly processTree: 'stopped' | 'unverified',
    readonly exitCode: number | null = null, readonly ownerFailure?: OwnedWindowsServiceStartupFailureCode) {
    super(`E2E_ELECTRON_DIRECT_RUN_FAILED failure=${failure} exit=${exitCode} cleanup=${processTree} owner=${ownerFailure ?? 'none'}`);
  }
}
interface Dependencies {
  start: typeof startOwnedWindowsElectron;
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}
const defaults: Dependencies = {
  start: startOwnedWindowsElectron, now: () => performance.now(),
  schedule(callback, milliseconds) {
    const timer = setTimeout(callback, Math.max(1, milliseconds));
    return () => clearTimeout(timer);
  },
};

// A root exit is a result, not permission to delete the fixture. Success is
// returned only after the same owner's complete process-tree cleanup receipt.
export async function runOwnedWindowsElectron(input: {
  runtime: ElectronE2eRuntime; runRoot: string; lifetime: E2eFixtureLifetime; timeoutMilliseconds: number;
  expectedExitCode: 0 | 1;
}, overrides: Partial<Dependencies> = {}): Promise<{ exitCode: number; output: string }> {
  const dependencies = { ...defaults, ...overrides };
  let owned: ObservedWindowsService | undefined;
  let failure: FailureCode | undefined;
  let ownerFailure: OwnedWindowsServiceStartupFailureCode | undefined;
  let processTree: 'stopped' | 'unverified' = 'stopped';
  let exitCode: number | null = null;
  const deadline = dependencies.now() + input.timeoutMilliseconds;
  const lifetime: E2eFixtureLifetime = {
    readRemainingWorkMilliseconds: () => Math.max(0, Math.min(input.lifetime.readRemainingWorkMilliseconds(),
      Math.floor(deadline - dependencies.now()))),
  };
  try {
    const environment = createElectronEnvironment({ configPath: input.runtime.configPath,
      profile: input.runtime.profile, runRoot: input.runtime.runtimeRoot });
    processTree = 'unverified';
    owned = await dependencies.start({ repositoryRoot: resolve(import.meta.dirname, '../../../..'),
      runRoot: input.runRoot, runtimeRoot: input.runtime.runtimeRoot, runtimeConfigPath: input.runtime.configPath,
      environment, lifetime, startupDeadline: deadline, redactedValues: [input.runtime.sessionSecret] });
    failure = await waitForExit(owned, deadline, dependencies);
    if (failure === undefined) {
      exitCode = owned.workload.readExitCode();
      if (exitCode === null) failure = 'exitCodeUnavailable';
      else if (exitCode !== input.expectedExitCode) failure = 'unexpectedExitCode';
    }
  } catch (error) {
    failure = 'startupFailed';
    if (error instanceof OwnedWindowsElectronStartupFailure) {
      processTree = error.evidence.processTree; ownerFailure = error.evidence.startupFailure;
    }
  }
  if (owned !== undefined) {
    try { await owned.stop(); processTree = 'stopped'; }
    catch (error) {
      failure ??= 'cleanupFailed';
      if (error instanceof OwnedWindowsElectronStartupFailure) {
        processTree = error.evidence.processTree; ownerFailure ??= error.evidence.startupFailure;
      }
    }
  }
  if (failure !== undefined) throw new DirectElectronRunFailure(failure, processTree, exitCode, ownerFailure);
  if (owned === undefined || exitCode === null || processTree !== 'stopped') {
    throw new DirectElectronRunFailure('cleanupFailed', processTree);
  }
  return { exitCode, output: owned.readCombinedOutput() };
}

async function waitForExit(owned: ObservedWindowsService, deadline: number, dependencies: Dependencies): Promise<FailureCode | undefined> {
  let unsubscribe = () => {};
  let cancel = () => {};
  try {
    return await new Promise<FailureCode | undefined>(resolveWait => {
      const observe = (state: E2eProcessStartupState) => {
        if (state.terminal !== undefined) resolveWait(state.terminal === 'exited' ? undefined : 'observationLost');
      };
      unsubscribe = owned.startup.subscribe(observe);
      cancel = dependencies.schedule(() => resolveWait('exitDeadlineExceeded'), deadline - dependencies.now());
      if (dependencies.now() >= deadline) resolveWait('exitDeadlineExceeded');
      else observe(owned.startup.readState());
    });
  } finally { cancel(); unsubscribe(); }
}
