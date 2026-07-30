export type ElectronDevelopmentRuntimeErrorCode =
  | 'ELECTRON_EXECUTABLE_MISSING'
  | 'ELECTRON_PACKAGE_INVALID'
  | 'ELECTRON_PACKAGE_MISSING'
  | 'ELECTRON_VERSION_MISMATCH';

export class ElectronDevelopmentRuntimeError extends Error {
  readonly code: ElectronDevelopmentRuntimeErrorCode;
}

export interface ElectronDevelopmentRuntime {
  executablePath: string;
  version: string;
}

export function resolveElectronDevelopmentRuntime(input?: {
  desktopPackageJsonPath?: string;
}): ElectronDevelopmentRuntime;
