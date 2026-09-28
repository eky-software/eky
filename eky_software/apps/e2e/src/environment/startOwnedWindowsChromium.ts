import { dirname, join } from 'node:path';
import { chromiumReadyName } from './chromiumWorkerContract.mjs';
import { connectOwnedChromium, OwnedChromiumStartupFailure, type StartedOwnedChromium } from './connectOwnedChromium.js';
import { prepareWindowsServiceConfiguration, type WindowsChromiumServiceInput } from './windowsServiceConfiguration.js';
import { createWindowsOwnerSession, windowsServiceDependencies,
  OwnedWindowsServiceStartupFailure, type OwnedWindowsServiceInput } from './startOwnedWindowsService.js';

type Input = WindowsChromiumServiceInput & OwnedWindowsServiceInput;
const dependencies = windowsServiceDependencies<'chromium', Input>('chromium', input =>
  prepareWindowsServiceConfiguration({ profile: 'chromium', input }));

export async function startOwnedWindowsChromium(input: Input,
  playwright: Pick<typeof import('@playwright/test'), 'chromium'>,
  ownerDependencies = dependencies,
): Promise<StartedOwnedChromium> {
  let owner;
  try { owner = createWindowsOwnerSession('chromium', input, ownerDependencies); }
  catch (error) {
    throw new OwnedChromiumStartupFailure(error instanceof OwnedWindowsServiceStartupFailure
      ? error.evidence.processTree : 'unverified', 'ownerPreparation',
    error instanceof OwnedWindowsServiceStartupFailure ? error.evidence.startupFailure : null);
  }
  try {
    await owner.startDirect();
  } catch {
    try { await owner.stop(); } catch { /* The native receipt remains the cleanup authority. */ }
    throw new OwnedChromiumStartupFailure(owner.readCleanupEvidence().status === 'processTreeAbsent' ? 'stopped' : 'unverified',
      'ownerLaunch', owner.readCleanupEvidence().firstFailure);
  }
  return connectOwnedChromium({
    readyPath: join(dirname(owner.config.configPath), chromiumReadyName), generation: owner.config.generation,
    requireStartupOpen: owner.requireStartupOpen, beforeStartupDeadline: owner.beforeStartupDeadline,
    readStartupRemainingMilliseconds: () => Math.min(input.startupDeadline, owner.config.workDeadline) - performance.now(),
    stop: owner.stop,
    readCleanupRemainingMilliseconds: () => (owner.readCleanupDeadline() ?? performance.now()) - performance.now(),
    readCleanupEvidence: () => ({ processTree: owner.readCleanupEvidence().status === 'processTreeAbsent' ? 'stopped' : 'unverified',
      firstFailure: owner.readCleanupEvidence().firstFailure }),
  }, playwright);
}
