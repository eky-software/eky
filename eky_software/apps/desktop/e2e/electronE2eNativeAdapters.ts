import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  BrowserWindow,
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';

import type { DesktopCompositionDependencies } from '../src/main/desktopComposition.js';
import type { ElectronE2eConfig } from './electronE2eConfig.js';

type NativeAdapterDependencies = Pick<
  DesktopCompositionDependencies,
  | 'openPath'
  | 'showErrorBox'
  | 'showMessageBox'
  | 'showOpenDialog'
  | 'showSaveDialog'
>;

export interface ElectronE2eNativeAdapterSnapshot {
  errorBoxCount: number;
  messageBoxCount: number;
  openDialogCount: number;
  openedPaths: readonly string[];
  saveDialogCount: number;
}

export function createElectronE2eNativeAdapters(
  config: ElectronE2eConfig,
): NativeAdapterDependencies & {
  snapshot(): ElectronE2eNativeAdapterSnapshot;
} {
  const openedPaths: string[] = [];
  let errorBoxCount = 0;
  let messageBoxCount = 0;
  let openDialogCount = 0;
  let saveDialogCount = 0;
  const expectedLogsRoot = resolve(
    config.paths.userDataPath,
    'runtime',
    'logs',
  );

  function record(event: Record<string, boolean | number | string>): void {
    appendFileSync(
      config.paths.observationsPath,
      `${JSON.stringify(event)}\n`,
      { encoding: 'utf8', flag: 'a', mode: 0o600 },
    );
  }

  return {
    async openPath(path) {
      if (resolve(path) !== expectedLogsRoot) {
        throw new Error('ELECTRON_E2E_OPEN_PATH_REJECTED');
      }
      openedPaths.push(path);
      record({ operation: 'openPath' });
      return '';
    },
    showErrorBox() {
      errorBoxCount += 1;
      record({ operation: 'showErrorBox' });
    },
    async showMessageBox(
      _owner: BrowserWindow | undefined,
      options: MessageBoxOptions,
    ): Promise<MessageBoxReturnValue> {
      messageBoxCount += 1;
      const cancelId = options.cancelId ?? 0;
      const acceptedResponse =
        options.buttons?.findIndex((_button, index) => index !== cancelId) ?? 0;
      const response =
        config.dialogMode === 'cancel'
          ? cancelId
          : acceptedResponse >= 0
            ? acceptedResponse
            : 0;
      record({ operation: 'showMessageBox', response });
      return { checkboxChecked: false, response };
    },
    async showOpenDialog(
      _owner: BrowserWindow,
      _options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue> {
      openDialogCount += 1;
      record({ operation: 'showOpenDialog' });
      return {
        canceled: false,
        filePaths: [config.paths.invoicePdfArchiveDirectoryPath],
      };
    },
    async showSaveDialog(
      _owner: BrowserWindow,
      _options: SaveDialogOptions,
    ): Promise<SaveDialogReturnValue> {
      saveDialogCount += 1;
      record({ operation: 'showSaveDialog' });
      return {
        canceled: false,
        filePath: config.paths.supportBundlePath,
      };
    },
    snapshot() {
      return {
        errorBoxCount,
        messageBoxCount,
        openDialogCount,
        openedPaths: [...openedPaths],
        saveDialogCount,
      };
    },
  };
}
