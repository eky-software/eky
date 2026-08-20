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
import { readSafeStartupFailureCode } from '../src/main/earlyStartup.js';
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
  recordStartupFailure(errorCode: string): void;
  recordWorkspaceRelaunchRequested(): void;
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
    recordStartupFailure(errorCode) {
      record({
        errorCode: readSafeStartupFailureCode(new Error(errorCode)),
        operation: 'startupFailure',
      });
    },
    recordWorkspaceRelaunchRequested() {
      record({ operation: 'workspaceRelaunchRequested' });
    },
    showErrorBox(title, message) {
      errorBoxCount += 1;
      record({
        operation: 'showErrorBox',
        reason: classifyErrorBox(title, message),
      });
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
      options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue> {
      openDialogCount += 1;
      assertExpectedOpenDialog(config, options);
      const canceled = config.nativeOpenDialog.mode === 'cancel';
      record({
        canceled,
        operation: 'showOpenDialog',
        purpose: config.nativeOpenDialog.purpose,
      });
      return {
        canceled,
        filePaths: canceled ? [] : [resolveOpenDialogPath(config)],
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

function assertExpectedOpenDialog(
  config: ElectronE2eConfig,
  options: OpenDialogOptions,
): void {
  if (config.nativeOpenDialog.purpose === 'invoicePdfArchive') {
    if (
      options.title !== 'Valitse PDF-kopiokansio' ||
      options.message !==
        'Valitse kansio toimitettujen laskujen PDF-kopioille' ||
      !stringArraysEqual(options.properties, [
        'openDirectory',
        'createDirectory',
      ]) ||
      options.filters !== undefined
    ) {
      throw new Error('ELECTRON_E2E_OPEN_DIALOG_CONTRACT_REJECTED');
    }
    return;
  }

  if (
    options.title !== 'Tuo yritys Eky-varmuuskopiosta' ||
    !stringArraysEqual(options.properties, ['openFile']) ||
    options.filters?.length !== 1 ||
    options.filters[0]?.name !== 'Eky-varmuuskopio' ||
    !stringArraysEqual(options.filters[0]?.extensions, ['ekybackup'])
  ) {
    throw new Error('ELECTRON_E2E_OPEN_DIALOG_CONTRACT_REJECTED');
  }
}

function resolveOpenDialogPath(config: ElectronE2eConfig): string {
  if (config.nativeOpenDialog.purpose === 'invoicePdfArchive') {
    return config.paths.invoicePdfArchiveDirectoryPath;
  }
  if (config.paths.workspaceBackupPath === null) {
    throw new Error('ELECTRON_E2E_WORKSPACE_BACKUP_PATH_MISSING');
  }
  return config.paths.workspaceBackupPath;
}

function stringArraysEqual(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function classifyErrorBox(
  title: string,
  message: string,
): 'backendUnexpectedExit' | 'other' | 'startupFailed' | 'uiLoadFailed' {
  if (
    title === 'Eky ei käynnistynyt' &&
    message ===
      'Paikallista testisovellusta ei voitu käynnistää turvallisesti.'
  ) {
    return 'startupFailed';
  }
  if (
    title === 'Eky ei käynnistynyt' &&
    message === 'Käyttöliittymää ei voitu ladata turvallisesti.'
  ) {
    return 'uiLoadFailed';
  }
  if (
    title === 'Eky suljettiin' &&
    message ===
      'Paikallinen palvelu pysähtyi odottamatta. Sovellus suljetaan turvallisesti.'
  ) {
    return 'backendUnexpectedExit';
  }
  return 'other';
}
