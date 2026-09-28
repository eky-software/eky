import { startLinuxService, OwnedLinuxServiceStartupFailure, type LinuxChromiumServiceInput }
  from '../../experiments/processOwnership/linuxServiceSession.mjs';
import { connectOwnedChromium, OwnedChromiumStartupFailure, type StartedOwnedChromium }
  from './connectOwnedChromium.js';

export async function startOwnedLinuxChromium(input: LinuxChromiumServiceInput,
  playwright: Pick<typeof import('@playwright/test'), 'chromium'>,
): Promise<StartedOwnedChromium> {
  let service;
  try { service = await startLinuxService('chromium', input); }
  catch (error) {
    const evidence = error instanceof OwnedLinuxServiceStartupFailure ? error.evidence : undefined;
    throw new OwnedChromiumStartupFailure(evidence?.processTree ?? 'unverified',
      evidence?.startupFailure === 'preparationFailed' ? 'ownerPreparation' : 'ownerLaunch',
      evidence?.startupFailure ?? null);
  }
  return connectOwnedChromium(service.connectionOwner, playwright);
}
