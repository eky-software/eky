import { selectorRecoveryScenarioId } from '../../../desktop/e2e/electronSelectorTestRelease.js';
import { runOwnedWindowsElectron } from '../environment/runOwnedWindowsElectron.js';
import { ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS } from './electronLaunchBudgets.js';

// One expected startup without a window, not a retry of an unsuccessful launch.
// The existing native owner must prove both the root result and tree cleanup.
export async function runElectronSelectorRecoveryStartup(input: Omit<
  Parameters<typeof runOwnedWindowsElectron>[0], 'expectedExitCode' | 'timeoutMilliseconds'
> & {
  scenarioId: string;
  readRelaunchCount(): number;
}, run = runOwnedWindowsElectron): Promise<void> {
  if (input.scenarioId !== selectorRecoveryScenarioId || input.readRelaunchCount() !== 0) {
    throw new Error('E2E_SELECTOR_RECOVERY_STARTUP_INVALID');
  }
  await run({ runtime: input.runtime, runRoot: input.runRoot, lifetime: input.lifetime,
    expectedExitCode: 0, timeoutMilliseconds: ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS,
    ...(input.captureOutput === undefined ? {} : { captureOutput: input.captureOutput }),
  });
  if (input.readRelaunchCount() !== 1) throw new Error('E2E_SELECTOR_RECOVERY_RELAUNCH_MISSING');
}
