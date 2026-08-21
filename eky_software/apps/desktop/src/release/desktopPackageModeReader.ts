import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseDesktopPackageModeInfo,
  type DesktopPackageMode,
} from './desktopPackageMode.js';

export type DesktopRuntimePackageMode =
  | DesktopPackageMode
  | 'unpackagedDevelopment';

interface ReadDesktopPackageModeOptions {
  applicationPath: string;
  isPackaged: boolean;
  readTextFile?: (path: string) => string;
}

export function readDesktopPackageMode(
  options: ReadDesktopPackageModeOptions,
): DesktopRuntimePackageMode {
  if (!options.isPackaged) {
    return 'unpackagedDevelopment';
  }

  const read = options.readTextFile ?? ((path) => readFileSync(path, 'utf8'));

  try {
    return parseDesktopPackageModeInfo(
      JSON.parse(
        read(join(options.applicationPath, 'dist', 'package-mode.json')),
      ) as unknown,
    ).mode;
  } catch {
    throw new Error('PACKAGED_PACKAGE_MODE_INVALID');
  }
}
