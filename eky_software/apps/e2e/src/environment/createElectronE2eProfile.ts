import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { assertPathUnderRoot } from './assertE2eSafetyBoundary.js';

export interface ElectronE2eProfilePaths {
  appDataLocal: string;
  appDataRoaming: string;
  root: string;
  temp: string;
}

export function createElectronE2eProfile(
  workerRoot: string,
): ElectronE2eProfilePaths {
  const root = createPrivateDirectory(join(workerRoot, 'windows-profile'));
  const appDataRoot = createPrivateDirectory(join(root, 'AppData'));
  const profile = {
    appDataLocal: createPrivateDirectory(join(appDataRoot, 'Local')),
    appDataRoaming: createPrivateDirectory(join(appDataRoot, 'Roaming')),
    root,
    temp: createPrivateDirectory(join(root, 'Temp')),
  };

  for (const path of listElectronE2eProfileDirectories(profile)) {
    if (
      lstatSync(path).isSymbolicLink() ||
      !statSync(path).isDirectory()
    ) {
      throw new Error('Electron E2E profile directory is invalid.');
    }
    assertPathUnderRoot(path, workerRoot);
  }

  return profile;
}

export function listElectronE2eProfileDirectories(
  profile: ElectronE2eProfilePaths,
): readonly string[] {
  return [
    profile.root,
    profile.appDataRoaming,
    profile.appDataLocal,
    profile.temp,
  ];
}

function createPrivateDirectory(path: string): string {
  mkdirSync(path, { mode: 0o700, recursive: true });
  return realpathSync.native(path);
}
