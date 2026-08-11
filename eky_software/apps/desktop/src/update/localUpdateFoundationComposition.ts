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
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  resourcesPath: string;
  selectManifestPath(): Promise<string | null>;
  showSafeError(): void;
  systemRoot: string | undefined;
  userDataPath: string;
}

export function createLocalUpdateFoundationComposition(
  options: LocalUpdateFoundationCompositionOptions,
): LocalUpdateSelectionCapability {
  const cacheRoot = resolve(options.userDataPath, 'update-cache');
  const inspectorRoot = join(options.resourcesPath, 'update-runtime');
  const installerInspectorScriptPath = join(
    inspectorRoot,
    'inspectWindowsInstallerIdentity.ps1',
  );
  const regularFileInspectorScriptPath = join(
    inspectorRoot,
    'inspectWindowsRegularFile.ps1',
  );
  const powershellPath = resolveWindowsPowerShellPath(options.systemRoot);
  const cache = new LocalUpdatePackageCache({
    cacheRoot,
    inspectInstaller: (msiPath) =>
      readWindowsInstallerIdentity({
        inspectorScriptPath: installerInspectorScriptPath,
        msiPath,
        powershellPath,
      }),
    inspectRegularFile: (filePath) =>
      readWindowsRegularFileMetadata({
        filePath,
        inspectorScriptPath: regularFileInspectorScriptPath,
        powershellPath,
      }),
    releaseInfo: options.releaseInfo,
    trustPolicy: new LocalUnsignedPilotUpdatePackageTrustPolicy(),
  });

  return createLocalUpdateSelectionCapability({
    cache,
    ipcMain: options.ipcMain,
    mainWindow: options.mainWindow,
    selectManifestPath: options.selectManifestPath,
    showSafeError: options.showSafeError,
  });
}

