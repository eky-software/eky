import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { BrowserWindow } from 'electron';

import { createInvoicePdfPreviewSmokeFixture } from '../pdf/invoicePdfPreviewSmoke.js';
import type { InvoicePdfPreviewWindowController } from '../pdf/invoicePdfPreviewWindow.js';
import type { InvoicePdfArchiveService } from '../invoicePdfArchive/invoicePdfArchiveService.js';
import type { DesktopBackendHandle } from '../runtime/backendProcess.js';
import {
  EncryptedSecretFile,
  type EncryptedSecretFileStore,
} from '../secrets/encryptedSecretFile.js';
import {
  createDeleteDraftSmokeFixture,
  markInvoiceDeliveredForArchiveSmoke,
} from './applicationProtocolSmoke.js';
import { localRuntimeSessionHeaderName } from './protocolPolicy.js';
import { runPackagedSupportBundleSmoke } from './packagedSupportBundleSmoke.js';

export interface PackagedSmokeConfiguration {
  enabled: boolean;
  phase: 'initial' | 'restoredProfile';
  root: string | undefined;
  userDataPath: string | undefined;
}

export const packagedSmokeStages = Object.freeze([
  'startup',
  'backend',
  'diagnostics',
  'logFolder',
  'supportBundle',
  'secretStorage',
  'invoicePdfArchive',
  'pdfPreview',
  'profileBackup',
  'profileSnapshotMaintenance',
  'profileSnapshotCreated',
  'profileSnapshotCaptured',
  'profileBackupVerified',
  'profileMutationCreated',
  'profileRestore',
  'profileRestoreStaged',
  'restoreRestart',
  'restoredStartup',
  'restoreActivationJournalLoaded',
  'restoredBackend',
  'restoredSessionValidated',
  'profileComparison',
  'secondBackup',
  'shutdown',
] as const);

export type PackagedSmokeStage = (typeof packagedSmokeStages)[number];

export type PackagedSmokeResult =
  | {
      stage: PackagedSmokeStage;
      status: 'started';
    }
  | {
      code: string;
      stage: PackagedSmokeStage;
      status: 'failed';
    }
  | {
      electronVersion: string;
      stage: 'shutdown';
      status: 'ok';
    };

export interface PackagedSmokeProgressReporter {
  currentStage(): PackagedSmokeStage;
  reportStage(stage: PackagedSmokeStage): Promise<void>;
}

export function resolvePackagedSmokeTempPath(tempPath: string): string {
  try {
    return realpathSync.native(resolve(tempPath));
  } catch {
    throw new Error('DESKTOP_SMOKE_PATH_INVALID');
  }
}

interface RunPackagedSmokeCheckOptions {
  appVersion: string;
  backend: DesktopBackendHandle;
  buildRevision: string;
  databaseFilePath: string;
  mainWindow: BrowserWindow;
  invoicePdfArchiveDirectoryPath: string;
  invoicePdfArchiveService: Pick<
    InvoicePdfArchiveService,
    'chooseDirectory' | 'getStatus'
  >;
  pdfPreviewController: InvoicePdfPreviewWindowController;
  runtimeSessionSecret: string;
  runtimeInstanceId: string;
  secretFilePath: string;
  smokePdfPath: string;
  supportBundlePath: string;
  writeBackupDiagnosticFixture(): void;
  reportStage(stage: PackagedSmokeStage): Promise<void>;
}

export function createPackagedSmokeConfiguration(options: {
  hasRestoredProfileSwitch?: boolean;
  hasSmokeSwitch: boolean;
  tempPath: string;
  tokenValue: string | undefined;
}): PackagedSmokeConfiguration {
  const token = readSmokeToken(options.tokenValue);
  const root =
    token === undefined
      ? undefined
      : join(
          resolvePackagedSmokeTempPath(options.tempPath),
          'eky-desktop-smoke',
          token,
        );
  const enabled = token !== undefined && options.hasSmokeSwitch;

  return {
    enabled,
    phase:
      enabled && options.hasRestoredProfileSwitch === true
        ? 'restoredProfile'
        : 'initial',
    root,
    userDataPath: enabled && root !== undefined ? join(root, 'user-data') : undefined,
  };
}

export function createPackagedSmokeSecretFileStore(
  secretFilePath: string,
  smokeEnabled: boolean,
): EncryptedSecretFileStore {
  const encryptedSecretFile = new EncryptedSecretFile(secretFilePath);

  if (!smokeEnabled) {
    return encryptedSecretFile;
  }

  const forbiddenPlaintextMarker = Buffer.from(
    'eky-safe-storage-smoke-',
    'utf8',
  );

  return {
    confirm: (candidate) => encryptedSecretFile.confirm(candidate),
    readCandidate: () => encryptedSecretFile.readCandidate(),
    remove: () => encryptedSecretFile.remove(),
    async write(ciphertext) {
      if (Buffer.from(ciphertext).includes(forbiddenPlaintextMarker)) {
        throw new Error('DESKTOP_SMOKE_SECRET_ENCRYPTION_FAILED');
      }

      await encryptedSecretFile.write(ciphertext);
    },
  };
}

export function createPackagedSmokeProgressReporter(
  configuration: PackagedSmokeConfiguration,
): PackagedSmokeProgressReporter {
  let currentStageIndex =
    configuration.phase === 'restoredProfile'
      ? packagedSmokeStages.indexOf('restoreRestart')
      : -1;

  return Object.freeze({
    currentStage() {
      return packagedSmokeStages[currentStageIndex] ?? 'startup';
    },
    async reportStage(stage: PackagedSmokeStage) {
      const nextStageIndex = packagedSmokeStages.indexOf(stage);

      if (nextStageIndex !== currentStageIndex + 1) {
        throw new Error('DESKTOP_SMOKE_STAGE_INVALID');
      }

      await writePackagedSmokeResult(configuration, {
        stage,
        status: 'started',
      });
      currentStageIndex = nextStageIndex;
    },
  });
}

export async function writePackagedSmokeResult(
  configuration: PackagedSmokeConfiguration,
  result: PackagedSmokeResult,
): Promise<void> {
  if (!configuration.enabled || configuration.root === undefined) {
    return;
  }

  if (readPackagedSmokeResult(result) === undefined) {
    throw new Error('DESKTOP_SMOKE_RESULT_INVALID');
  }

  const resultDirectory = join(configuration.root, 'result');

  await mkdir(resultDirectory, { recursive: true });
  await writeFile(
    join(resultDirectory, 'desktop-smoke-result.json'),
    `${JSON.stringify(result)}\n`,
    'utf8',
  );
}

export function readPackagedSmokeResult(
  value: unknown,
): PackagedSmokeResult | undefined {
  if (!isRecord(value) || !isPackagedSmokeStage(value.stage)) {
    return undefined;
  }

  if (value.status === 'started') {
    return { stage: value.stage, status: 'started' };
  }

  if (
    value.status === 'ok' &&
    value.stage === 'shutdown' &&
    typeof value.electronVersion === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
      value.electronVersion,
    )
  ) {
    return {
      electronVersion: value.electronVersion,
      stage: 'shutdown',
      status: 'ok',
    };
  }

  if (
    value.status === 'failed' &&
    typeof value.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)
  ) {
    return {
      code: value.code,
      stage: value.stage,
      status: 'failed',
    };
  }

  return undefined;
}

export function createPackagedSmokeTimeoutMessage(value: unknown): string {
  const stage = readPackagedSmokeResult(value)?.stage ?? 'startup';

  return `Packaged desktop smoke check timed out (stage ${stage}).`;
}

export function createPackagedSmokeFailureMessage(
  value: unknown,
  processExitCode: number | null,
): string {
  const result = readPackagedSmokeResult(value);
  const code =
    result?.status === 'failed'
      ? result.code
      : 'DESKTOP_SMOKE_FAILED';
  const stage = result?.stage ?? 'startup';

  return `Packaged desktop smoke check failed (${code}, stage ${stage}, process code ${String(processExitCode)}).`;
}

function isPackagedSmokeStage(
  value: unknown,
): value is PackagedSmokeStage {
  return (
    typeof value === 'string' &&
    packagedSmokeStages.some((stage) => stage === value)
  );
}

export async function runPackagedSmokeCheck(
  options: RunPackagedSmokeCheckOptions,
): Promise<void> {
  const healthResponse = await fetch(
    `http://127.0.0.1:${options.backend.port}/health`,
    { signal: AbortSignal.timeout(5_000) },
  );

  if (!healthResponse.ok) {
    throw new Error('DESKTOP_SMOKE_HEALTH_FAILED');
  }

  await stat(options.databaseFilePath);
  const pdf = await readFile(options.smokePdfPath);

  if (pdf.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('DESKTOP_SMOKE_PDF_FAILED');
  }

  await assertPackagedDesktopBridge(options.pdfPreviewController);
  const deleteDraftId = await createDeleteDraftSmokeFixture({
    backendPort: options.backend.port,
    runtimeSessionSecret: options.runtimeSessionSecret,
  });

  await assertPackagedDeleteTransport(options.mainWindow, deleteDraftId);

  options.writeBackupDiagnosticFixture();
  await options.reportStage('diagnostics');
  await assertPackagedDiagnostics(
    options.mainWindow,
    options.backend.port,
    options.runtimeSessionSecret,
    {
      appVersion: options.appVersion,
      buildRevision: options.buildRevision,
      runtimeInstanceId: options.runtimeInstanceId,
    },
  );

  await options.reportStage('logFolder');
  await assertPackagedOperationalLogFolder(options.mainWindow);
  await assertPackagedBlockedWindowIncident(options.mainWindow);

  await options.reportStage('supportBundle');
  await runPackagedSupportBundleSmoke({
    appVersion: options.appVersion,
    buildRevision: options.buildRevision,
    mainWindow: options.mainWindow,
    runtimeSessionSecret: options.runtimeSessionSecret,
    supportBundlePath: options.supportBundlePath,
  });

  await options.reportStage('secretStorage');
  await verifyCompanyEmailSecretHttpLifecycle(
    options.backend.port,
    options.runtimeSessionSecret,
  );

  await options.reportStage('invoicePdfArchive');
  await mkdir(options.invoicePdfArchiveDirectoryPath, { recursive: true });
  await options.invoicePdfArchiveService.chooseDirectory(
    options.invoicePdfArchiveDirectoryPath,
  );
  const previewInvoiceId = await createInvoicePdfPreviewSmokeFixture({
    backendPort: options.backend.port,
    runtimeSessionSecret: options.runtimeSessionSecret,
  });
  await markInvoiceDeliveredForArchiveSmoke({
    backendPort: options.backend.port,
    invoiceId: previewInvoiceId,
    runtimeSessionSecret: options.runtimeSessionSecret,
  });
  await assertPackagedInvoicePdfArchive({
    directoryPath: options.invoicePdfArchiveDirectoryPath,
    mainWindow: options.mainWindow,
    service: options.invoicePdfArchiveService,
  });

  await options.reportStage('pdfPreview');
  await options.pdfPreviewController.openForSmoke(previewInvoiceId);
  await options.pdfPreviewController.closeForSmoke();

  for (const path of [
    options.secretFilePath,
    `${options.secretFilePath}.next`,
    `${options.secretFilePath}.backup`,
  ]) {
    try {
      await stat(path);
      throw new Error('DESKTOP_SMOKE_SECRET_CLEANUP_FAILED');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }

      throw error;
    }
  }
}

async function assertPackagedInvoicePdfArchive(input: {
  directoryPath: string;
  mainWindow: BrowserWindow;
  service: Pick<InvoicePdfArchiveService, 'getStatus'>;
}): Promise<void> {
  const status = await input.service.getStatus();

  if (
    !status.enabled ||
    status.pendingCount !== 0 ||
    status.lastArchivedAt === null ||
    status.lastSafeErrorCode !== null
  ) {
    throw new Error('DESKTOP_SMOKE_INVOICE_ARCHIVE_STATUS_FAILED');
  }

  const fileNames = await readdir(input.directoryPath);
  const invoicePdfFiles = fileNames.filter((fileName) =>
    /^Lasku-\d{1,50}\.pdf$/.test(fileName),
  );

  if (invoicePdfFiles.length !== 1) {
    throw new Error('DESKTOP_SMOKE_INVOICE_ARCHIVE_FILE_FAILED');
  }
  const fileName = invoicePdfFiles[0];

  if (fileName === undefined) {
    throw new Error('DESKTOP_SMOKE_INVOICE_ARCHIVE_FILE_FAILED');
  }
  const content = await readFile(join(input.directoryPath, fileName));

  if (content.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('DESKTOP_SMOKE_INVOICE_ARCHIVE_FILE_FAILED');
  }

  const bridgeStatus: unknown =
    await input.mainWindow.webContents.executeJavaScript(
      `window.ekyDesktop.getInvoicePdfArchiveStatus()`,
      true,
    );

  if (
    !isRecord(bridgeStatus) ||
    bridgeStatus.enabled !== true ||
    bridgeStatus.pendingCount !== 0 ||
    typeof bridgeStatus.displayName !== 'string' ||
    bridgeStatus.displayName.length === 0 ||
    Object.keys(bridgeStatus).some((key) =>
      ['directoryPath', 'path', 'rawPath'].includes(key),
    )
  ) {
    throw new Error('DESKTOP_SMOKE_INVOICE_ARCHIVE_BRIDGE_FAILED');
  }
}

function readSmokeToken(value: string | undefined): string | undefined {
  return value !== undefined && /^[a-f0-9]{32}$/.test(value)
    ? value
    : undefined;
}

async function assertPackagedDeleteTransport(
  mainWindow: BrowserWindow,
  invoiceDraftId: string,
): Promise<void> {
  const result: unknown = await mainWindow.webContents.executeJavaScript(
    `fetch(${JSON.stringify(`/invoice-drafts/${invoiceDraftId}`)}, { method: 'DELETE' })
      .then(async (response) => ({
        body: await response.text(),
        status: response.status,
      }))`,
    true,
  );

  if (
    typeof result !== 'object' ||
    result === null ||
    !('body' in result) ||
    typeof result.body !== 'string' ||
    !('status' in result) ||
    result.status !== 200
  ) {
    throw new Error('DESKTOP_SMOKE_DELETE_TRANSPORT_FAILED');
  }

  let body: unknown;

  try {
    body = JSON.parse(result.body) as unknown;
  } catch {
    throw new Error('DESKTOP_SMOKE_DELETE_TRANSPORT_FAILED');
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('deleted' in body) ||
    body.deleted !== true
  ) {
    throw new Error('DESKTOP_SMOKE_DELETE_TRANSPORT_FAILED');
  }
}

async function assertPackagedDesktopBridge(
  pdfPreviewController: InvoicePdfPreviewWindowController,
): Promise<void> {
  if (!(await pdfPreviewController.hasRendererBridgeForSmoke())) {
    throw new Error('DESKTOP_SMOKE_PRELOAD_BRIDGE_FAILED');
  }
}

async function assertPackagedOperationalLogFolder(
  mainWindow: BrowserWindow,
): Promise<void> {
  const opened: unknown = await mainWindow.webContents.executeJavaScript(
    `window.ekyDesktop.openOperationalLogFolder()
      .then(() => true)
      .catch(() => false)`,
    true,
  );

  if (opened !== true) {
    throw new Error('DESKTOP_SMOKE_LOG_FOLDER_FAILED');
  }
}

async function assertPackagedBlockedWindowIncident(
  mainWindow: BrowserWindow,
): Promise<void> {
  const blocked: unknown =
    await mainWindow.webContents.executeJavaScript(
      `window.open('https://example.invalid', '_blank') === null`,
      true,
    );

  if (blocked !== true) {
    throw new Error('DESKTOP_SMOKE_WINDOW_POLICY_FAILED');
  }
}

async function assertPackagedDiagnostics(
  mainWindow: BrowserWindow,
  backendPort: number,
  runtimeSessionSecret: string,
  expectedIdentity: {
    appVersion: string;
    buildRevision: string;
    runtimeInstanceId: string;
  },
): Promise<void> {
  const requestOptions = {
    headers: {
      accept: 'application/json',
      [localRuntimeSessionHeaderName]: runtimeSessionSecret,
    },
    signal: AbortSignal.timeout(5_000),
  };
  const summaryResponse = await fetch(
    `http://127.0.0.1:${backendPort}/diagnostics/summary`,
    requestOptions,
  );

  if (!summaryResponse.ok) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_SUMMARY_HTTP_FAILED');
  }

  const summary = readDiagnosticSummary(await summaryResponse.json());
  if (
    summary.appVersion === '0.0.0' ||
    summary.appVersion !== expectedIdentity.appVersion ||
    summary.buildRevision !== expectedIdentity.buildRevision ||
    summary.runtimeInstanceId !== expectedIdentity.runtimeInstanceId
  ) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_IDENTITY_FAILED');
  }

  const response = await fetch(
    `http://127.0.0.1:${backendPort}/diagnostics/events?limit=200`,
    requestOptions,
  );

  if (!response.ok) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_HTTP_FAILED');
  }

  const body: unknown = await response.json();
  const diagnosticEvents = readDiagnosticEvents(body);

  if (
    !diagnosticEvents.some(
      (eventName) =>
        eventName === 'backend.started' ||
        eventName === 'businessAudit.retentionCompleted',
    ) ||
    !diagnosticEvents.includes('backup.completed')
  ) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_EVENT_FAILED');
  }

  const uiResult: unknown = await mainWindow.webContents.executeJavaScript(
    `(async () => {
      const findButton = (label) =>
        [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === label,
        );
      const waitFor = async (condition) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const result = condition();
          if (result) return result;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      };

      findButton('Oma yritys')?.click();
      const diagnosticsButton = await waitFor(() => findButton('Diagnostiikka'));
      diagnosticsButton?.click();
      const heading = await waitFor(
        () => document.querySelector('#diagnostics-heading')?.textContent,
      );
      const eventVisible = await waitFor(() => {
        const text = document.body.textContent ?? '';
        return text.includes('backup.completed');
      });
      const loadError = (document.body.textContent ?? '').includes(
        'Diagnostiikkaa ei voitu ladata',
      );
      const text = document.body.textContent ?? '';
      return {
        eventVisible: Boolean(eventVisible),
        heading,
        loadError,
        revisionVisible: text.includes(${JSON.stringify(expectedIdentity.buildRevision)}),
        versionVisible: text.includes(${JSON.stringify(expectedIdentity.appVersion)}),
      };
    })()`,
    true,
  );

  if (
    !isRecord(uiResult) ||
    uiResult.heading !== 'Diagnostiikka' ||
    uiResult.eventVisible !== true ||
    uiResult.loadError !== false ||
    uiResult.revisionVisible !== true ||
    uiResult.versionVisible !== true
  ) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_VIEW_FAILED');
  }
}

function readDiagnosticSummary(value: unknown): {
  appVersion: string;
  buildRevision: string;
  runtimeInstanceId: string;
} {
  if (
    !isRecord(value) ||
    typeof value.appVersion !== 'string' ||
    typeof value.buildRevision !== 'string' ||
    !/^[0-9a-f]{7,40}$/.test(value.buildRevision) ||
    typeof value.runtimeInstanceId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.runtimeInstanceId,
    )
  ) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_SUMMARY_HTTP_FAILED');
  }

  return {
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
    runtimeInstanceId: value.runtimeInstanceId,
  };
}

function readDiagnosticEvents(value: unknown): string[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.diagnosticEvents)
  ) {
    throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_HTTP_FAILED');
  }

  return value.diagnosticEvents.map((event) => {
    if (
      !isRecord(event) ||
      typeof event.eventName !== 'string'
    ) {
      throw new Error('DESKTOP_SMOKE_DIAGNOSTICS_HTTP_FAILED');
    }
    return event.eventName;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function verifyCompanyEmailSecretHttpLifecycle(
  port: number,
  runtimeSessionSecret: string,
): Promise<void> {
  const secret = `eky-http-secret-smoke-${randomBytes(32).toString('base64url')}`;

  if (await requestCompanyEmailSecretStatus(port, runtimeSessionSecret, 'GET')) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (
    !(await requestCompanyEmailSecretStatus(
      port,
      runtimeSessionSecret,
      'PUT',
      secret,
    ))
  ) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (
    !(await requestCompanyEmailSecretStatus(
      port,
      runtimeSessionSecret,
      'GET',
    ))
  ) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (
    await requestCompanyEmailSecretStatus(
      port,
      runtimeSessionSecret,
      'DELETE',
    )
  ) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (await requestCompanyEmailSecretStatus(port, runtimeSessionSecret, 'GET')) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }
}

async function requestCompanyEmailSecretStatus(
  port: number,
  runtimeSessionSecret: string,
  method: 'DELETE' | 'GET' | 'PUT',
  secret?: string,
): Promise<boolean> {
  const headers = new Headers({
    accept: 'application/json',
    [localRuntimeSessionHeaderName]: runtimeSessionSecret,
  });

  if (method === 'PUT') {
    headers.set('content-type', 'application/json');
  }

  const requestOptions: RequestInit = {
    headers,
    method,
    signal: AbortSignal.timeout(5_000),
  };

  if (method === 'PUT') {
    requestOptions.body = JSON.stringify({ secret });
  }

  const response = await fetch(
    `http://127.0.0.1:${port}/company-settings/email-secret`,
    requestOptions,
  );

  if (!response.ok) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  const body: unknown = await response.json();

  if (
    typeof body !== 'object' ||
    body === null ||
    !('emailSecretStatus' in body) ||
    typeof body.emailSecretStatus !== 'object' ||
    body.emailSecretStatus === null ||
    !('configured' in body.emailSecretStatus) ||
    typeof body.emailSecretStatus.configured !== 'boolean'
  ) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  return body.emailSecretStatus.configured;
}
