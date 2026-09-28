import { startLinuxService, type LinuxBackendServiceInput, type LinuxServiceDependencies, type OwnedLinuxService }
  from '../../experiments/processOwnership/linuxServiceSession.mjs';

export { OwnedLinuxServiceStartupFailure } from '../../experiments/processOwnership/linuxServiceSession.mjs';

export function startOwnedLinuxBackend(input: LinuxBackendServiceInput,
  dependencies?: LinuxServiceDependencies<'backend'>,
): Promise<OwnedLinuxService> {
  return startLinuxService('backend', input, dependencies);
}
