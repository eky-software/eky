import { startLinuxService, type LinuxViteServiceInput, type LinuxServiceDependencies, type OwnedLinuxService }
  from '../../experiments/processOwnership/linuxServiceSession.mjs';

export { OwnedLinuxServiceStartupFailure } from '../../experiments/processOwnership/linuxServiceSession.mjs';

export function startOwnedLinuxVite(input: LinuxViteServiceInput,
  dependencies?: LinuxServiceDependencies<'vite'>,
): Promise<OwnedLinuxService> {
  return startLinuxService('vite', input, dependencies);
}
