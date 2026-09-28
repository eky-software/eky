import { startLinuxService, type LinuxBackendServiceInput, type OwnedLinuxService }
  from '../../experiments/processOwnership/linuxServiceSession.mjs';

export { OwnedLinuxServiceStartupFailure } from '../../experiments/processOwnership/linuxServiceSession.mjs';

export function startOwnedLinuxBackend(input: LinuxBackendServiceInput): Promise<OwnedLinuxService> {
  return startLinuxService('backend', input);
}
