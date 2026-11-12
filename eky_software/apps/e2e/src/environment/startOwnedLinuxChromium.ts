import { startLinuxService, OwnedLinuxServiceStartupFailure, type LinuxChromiumServiceInput, type LinuxServiceDependencies }
  from '../../experiments/processOwnership/linuxServiceSession.mjs';
import { connectOwnedChromium, OwnedChromiumStartupFailure, type StartedOwnedChromium }
  from './connectOwnedChromium.js';
import { readLinuxServicePreflightCheck } from '../../experiments/processOwnership/linuxServiceDiagnostic.mjs';

export async function startOwnedLinuxChromium(input: LinuxChromiumServiceInput,
  playwright: Pick<typeof import('@playwright/test'), 'chromium'>,
  dependencies?: LinuxServiceDependencies<'chromium'>,
): Promise<StartedOwnedChromium> {
  let service;
  try { service = await startLinuxService('chromium', input, dependencies); }
  catch (error) {
    const evidence = error instanceof OwnedLinuxServiceStartupFailure ? error.evidence : undefined;
    throw new OwnedChromiumStartupFailure(evidence?.processTree ?? 'unverified',
      evidence?.startupFailure === 'preparationFailed' ? 'ownerPreparation' : 'ownerLaunch',
      evidence?.startupFailure ?? null,
      error instanceof OwnedLinuxServiceStartupFailure ? readLinuxServicePreflightCheck(error) : undefined);
  }
  return connectOwnedChromium(service.connectionOwner, playwright);
}
