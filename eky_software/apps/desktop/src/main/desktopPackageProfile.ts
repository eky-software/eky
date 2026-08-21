import { join, resolve } from 'node:path';

import type { DesktopRuntimePackageMode } from '../release/desktopPackageModeReader.js';

const localDevelopmentProfileDirectoryName = 'Eky Test';

export function resolveDesktopPackageUserDataOverride(input: {
  appDataPath: string;
  packageMode: DesktopRuntimePackageMode;
}): string | undefined {
  return input.packageMode === 'localDevelopment'
    ? join(resolve(input.appDataPath), localDevelopmentProfileDirectoryName)
    : undefined;
}
