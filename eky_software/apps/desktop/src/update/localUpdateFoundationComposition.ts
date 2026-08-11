import { join, resolve } from 'node:path';

import type { BrowserWindow, IpcMain } from 'electron';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { LocalUnsignedPilotUpdatePackageTrustPolicy } from './localUnsignedPilotUpdatePackageTrustPolicy.js';
import { LocalUpdatePackageCache } from './localUpdatePackageCache.js';
import {
  createLocalUpdateSelectionCapability,
  type LocalUpdateSelectionCapability,
} from './localUpdateSelectionCapability.js';
import {
  readWindowsInstallerIdentity,
  resolveWindowsPowerShellPath,
} from './windowsInstallerIdentity.js';
import { readWindowsRegularFileMetadata } from './windowsRegularFileMetadata.js';

interface LocalUpdateFoundationCompositionOptions {
  cache?: LocalUpdatePackageCache;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  resourcesPath: string;
  selectManifestPath(): Promise<string | null>;
  showSafeError(): void;
  systemRoot: string | undefined;
  userDataPath: string;
}

export interface LocalUpdatePackageCacheCompositionOptions {
  releaseInfo: Readonly<DesktopReleaseInfo>;
  resourcesPath: string;
  systemRoot: string | undefined;
  userDataPath: string;
}

export function createLocalUpdatePackageCacheComposition(
  options: LocalUpdatePackageCacheCompositionOptions,
): LocalUpdatePackageCache {
  const cacheRoot = resolve(options.userDataPath, 'update-cache');
  const inspectorRoot = join(options.resourcesPath, 'update-runtime');
  const powershellPath = resolveWindowsPowerShellPath(options.systemRoot);
  return new LocalUpdatePackageCache({
    cacheRoot,
    inspectInstaller: (msiPath) =>
      readWindowsInstallerIdentity({
        inspectorScriptPath: join(
          inspectorRoot,
          'inspectWindowsInstallerIdentity.ps1',
        ),
        msiPath,
        powershellPath,
      }),
    inspectRegularFile: (filePath) =>
      readWindowsRegularFileMetadata({
        filePath,
        inspectorScriptPath: join(
          inspectorRoot,
          'inspectWindowsRegularFile.ps1',
        ),
        powershellPath,
      }),
    releaseInfo: options.releaseInfo,
    trustPolicy: new LocalUnsignedPilotUpdatePackageTrustPolicy(),
  });
}

export function createLocalUpdateFoundationComposition(
  options: LocalUpdateFoundationCompositionOptions,
): LocalUpdateSelectionCapability {
  const cache =
    options.cache ?? createLocalUpdatePackageCacheComposition(options);

  return createLocalUpdateSelectionCapability({
    cache,
    ipcMain: options.ipcMain,
    mainWindow: options.mainWindow,
    selectManifestPath: options.selectManifestPath,
    showSafeError: options.showSafeError,
  });
}
