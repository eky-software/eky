import {
  resolveElectronDevelopmentRuntime,
  type ElectronDevelopmentRuntime,
} from '../../../desktop/scripts/electron-development-runtime.mjs';

export function resolveElectronE2eExecutable(input?: {
  desktopPackageJsonPath?: string;
}): string {
  return resolveElectronE2eRuntime(input).executablePath;
}

export function resolveElectronE2eRuntime(input?: {
  desktopPackageJsonPath?: string;
}): ElectronDevelopmentRuntime {
  return resolveElectronDevelopmentRuntime(input);
}
