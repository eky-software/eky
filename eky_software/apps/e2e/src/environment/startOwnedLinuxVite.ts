import { startLinuxService, type LinuxViteServiceInput, type OwnedLinuxService }
  from '../../experiments/processOwnership/linuxServiceSession.mjs';

export { OwnedLinuxServiceStartupFailure } from '../../experiments/processOwnership/linuxServiceSession.mjs';

export function startOwnedLinuxVite(input: LinuxViteServiceInput): Promise<OwnedLinuxService> {
  return startLinuxService('vite', input);
}
