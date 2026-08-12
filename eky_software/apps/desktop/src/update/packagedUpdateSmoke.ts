import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { DesktopBackendHandle } from '../runtime/backendProcess.js';
import { localRuntimeSessionHeaderName } from '../main/protocolPolicy.js';
import { createInvoicePdfPreviewSmokeFixture } from '../pdf/invoicePdfPreviewSmoke.js';
import type { PortableProfileBackupService } from '../profileBackup/portableProfileBackup.js';
import type { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import type { ProfileRestoreActivationService } from '../profileBackup/restore/profileRestoreActivationService.js';
import type { ProfileRestoreStagingService } from '../profileBackup/restore/profileRestoreStagingService.js';
import type { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import type { DirectSetupMigrationRecoveryStore } from './directSetupMigrationRecoveryStore.js';
import type { LocalUpdateHandoffCoordinator } from './localUpdateHandoffCoordinator.js';
import type { LocalUpdatePackageCache } from './localUpdatePackageCache.js';
import type { PackagedUpdateSmokeConfiguration, PackagedUpdateSmokePhase } from './packagedUpdateSmokeConfiguration.js';
import type { UpdateJournalStore } from './updateJournalStore.js';

const resultFileName = 'desktop-update-smoke-result.json';
const syntheticProfileStateFileName = 'synthetic-profile.json';
const maximumStateBytes = 4 * 1024;
const syntheticBackupPassword =
  'Eky-packaged-update-smoke-only-not-a-real-secret-2026';
const identifierPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

export const packagedUpdateSmokeFailureStages = Object.freeze([
  'backendStartup',
  'backendPreMigrationBrokerReadiness',
  'backendPreMigrationRecovery',
  'firstStartPreMigration',
  'backendRuntimeReadiness',
  'profileRestoreValidation',
  'backendHealthValidation',
  'oldRuntimeSessionRejection',
  'firstStartAcceptance',
  'packageCacheRotation',
  'recoveryPointSchedulerStart',
] as const);

export type PackagedUpdateSmokeFailureStage =
  (typeof packagedUpdateSmokeFailureStages)[number];

export type PackagedUpdateSmokeResult =
  | {
      appVersion: string;
      phase: PackagedUpdateSmokePhase;
      status:
        | 'handoffReady'
        | 'previousSetupReady'
        | 'restoreReady'
        | 'rollbackInstallerLaunched';
    }
  | {
      acceptedVersion: string;
      appVersion: string;
      artifactCount: number;
      journalState: string | null;
      migrationChainIdentity: string;
      pdfSha256: string;
      phase: PackagedUpdateSmokePhase;
      secretConfigured: true;
      status: 'ok';
    }
  | {
      code: string;
      failureStage?: PackagedUpdateSmokeFailureStage;
      phase: PackagedUpdateSmokePhase;
      status: 'failed';
    };

interface PackagedUpdateSmokeDependencies {
  acceptedBuildStore: Pick<AcceptedBuildMetadataStore, 'read'>;
  appVersion: string;
  backend: Pick<DesktopBackendHandle, 'port'>;
  buildRevision: string;
  cache: Pick<
    LocalUpdatePackageCache,
    | 'getPackageStatus'
    | 'repairCurrentRegistration'
    | 'stageSelectedPackage'
  >;
  configuration: PackagedUpdateSmokeConfiguration;
  directSetupRecoveryStore: Pick<
    DirectSetupMigrationRecoveryStore,
    'read'
  >;
  handoffCoordinator: Pick<
    LocalUpdateHandoffCoordinator,
    'handoffPreparedUpdate' | 'prepareConfirmedUpdate'
  >;
  journalStore: Pick<UpdateJournalStore, 'read'>;
  portableProfileBackupService: Pick<
    PortableProfileBackupService,
    'create'
  >;
  profileRestoreActivationService: Pick<
    ProfileRestoreActivationService,
    'activate'
  >;
  profileRestoreStagingService: Pick<
    ProfileRestoreStagingService,
    'inspect' | 'stage'
  >;
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    'validateActiveProfile'
  >;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  runtimeSessionSecret: string;
  shutdownAndQuit(): Promise<void>;
}

export async function runPackagedUpdateSmoke(
  dependencies: PackagedUpdateSmokeDependencies,
): Promise<void> {
  const { configuration } = dependencies;
  if (
    !configuration.enabled ||
    configuration.phase === undefined ||
    configuration.root === undefined
  ) {
    return;
  }

  try {
    switch (configuration.phase) {
      case 'seed':
        await seedSyntheticProfile(dependencies);
        break;
      case 'prepareSuccess':
      case 'prepareCancel':
        await prepareUpdate(dependencies, 'next');
        return;
      case 'prepareFailure':
        await prepareUpdate(dependencies, 'failure');
        return;
      case 'createBackup':
        await createSyntheticBackup(dependencies);
        break;
      case 'restoreBackup':
        await restoreSyntheticBackup(dependencies);
        return;
      case 'verifyBackup':
        await verifySyntheticProfile(dependencies, {
          expectedJournalState: null,
        });
        await createPostRestoreBackup(dependencies);
        break;
      case 'verifyCancel':
        await verifySyntheticProfile(dependencies, {
          expectedJournalState: 'installerNotApplied',
        });
        break;
      case 'verifyDirectFailure':
        await verifyDirectSetupState(dependencies, 'current');
        break;
      case 'verifyDirectSuccess':
        await verifyDirectSetupState(dependencies, 'target');
        break;
      case 'verifyRollback':
        await verifySyntheticProfile(dependencies, {
          expectedJournalState: 'rolledBack',
        });
        break;
      case 'verifySuccess':
        await verifySyntheticProfile(dependencies, {
          expectedJournalState: 'accepted',
        });
        break;
    }
    await dependencies.shutdownAndQuit();
  } catch (error) {
    const errorCode = readSafeSmokeErrorCode(error);
    await writePackagedUpdateSmokeResult(configuration, {
      code: errorCode,
      phase: configuration.phase,
      status: 'failed',
    }).catch(() => undefined);
    throw new Error(errorCode);
  }
}

export async function writePackagedUpdateSmokeHandoffResult(
  configuration: PackagedUpdateSmokeConfiguration,
  appVersion: string,
): Promise<void> {
  if (
    !configuration.enabled ||
    configuration.phase === undefined ||
    !isPreparePhase(configuration.phase)
  ) {
    throw new Error('DESKTOP_UPDATE_SMOKE_HANDOFF_INVALID');
  }
  await writePackagedUpdateSmokeResult(configuration, {
    appVersion,
    phase: configuration.phase,
    status: 'handoffReady',
  });
}

export async function writePackagedUpdateSmokeRestoreResult(
  configuration: PackagedUpdateSmokeConfiguration,
  appVersion: string,
): Promise<void> {
  if (
    !configuration.enabled ||
    configuration.phase !== 'restoreBackup'
  ) {
    throw new Error('DESKTOP_UPDATE_SMOKE_RESTORE_INVALID');
  }
  await writePackagedUpdateSmokeResult(configuration, {
    appVersion,
    phase: configuration.phase,
    status: 'restoreReady',
  });
}

export async function writePackagedUpdateSmokePreviousSetupResult(
  configuration: PackagedUpdateSmokeConfiguration,
  appVersion: string,
): Promise<void> {
  if (
    !configuration.enabled ||
    configuration.phase !== 'verifyDirectFailure'
  ) {
    throw new Error('DESKTOP_UPDATE_SMOKE_PREVIOUS_SETUP_INVALID');
  }
  await writePackagedUpdateSmokeResult(configuration, {
    appVersion,
    phase: configuration.phase,
    status: 'previousSetupReady',
  });
}

export async function writePackagedUpdateSmokeRollbackHandoffResult(
  configuration: PackagedUpdateSmokeConfiguration,
  appVersion: string,
): Promise<void> {
  if (!configuration.enabled || configuration.phase !== 'verifyRollback') {
    throw new Error('DESKTOP_UPDATE_SMOKE_ROLLBACK_HANDOFF_INVALID');
  }
  await writePackagedUpdateSmokeResult(configuration, {
    appVersion,
    phase: configuration.phase,
    status: 'rollbackInstallerLaunched',
  });
}

export async function writePackagedUpdateSmokeFailure(
  configuration: PackagedUpdateSmokeConfiguration,
  errorCode: string,
  failureStage?: PackagedUpdateSmokeFailureStage,
): Promise<void> {
  if (
    !configuration.enabled ||
    configuration.phase === undefined ||
    !/^[A-Z][A-Z0-9_]{0,99}$/.test(errorCode)
  ) {
    return;
  }
  await writePackagedUpdateSmokeResult(configuration, {
    code: errorCode,
    ...(failureStage === undefined ? {} : { failureStage }),
    phase: configuration.phase,
    status: 'failed',
  });
}

export async function writePackagedUpdateSmokeResult(
  configuration: PackagedUpdateSmokeConfiguration,
  result: PackagedUpdateSmokeResult,
): Promise<void> {
  if (
    !configuration.enabled ||
    configuration.root === undefined ||
    readPackagedUpdateSmokeResult(result) === undefined
  ) {
    throw new Error('DESKTOP_UPDATE_SMOKE_RESULT_INVALID');
  }

  const resultRoot = join(configuration.root, 'result');
  const targetPath = join(resultRoot, resultFileName);
  const nextPath = join(resultRoot, `${resultFileName}.next`);
  await mkdir(resultRoot, { recursive: true });
  await writeFile(nextPath, `${JSON.stringify(result)}\n`, {
    encoding: 'utf8',
    flag: 'w',
    mode: 0o600,
  });
  await rm(targetPath, { force: true });
  await rename(nextPath, targetPath);
}

export function readPackagedUpdateSmokeResult(
  value: unknown,
): PackagedUpdateSmokeResult | undefined {
  if (!isRecord(value) || !isPackagedUpdateSmokePhase(value.phase)) {
    return undefined;
  }
  if (
    (value.status === 'handoffReady' ||
      value.status === 'previousSetupReady' ||
      value.status === 'restoreReady' ||
      value.status === 'rollbackInstallerLaunched') &&
    typeof value.appVersion === 'string' &&
    Object.keys(value).length === 3
  ) {
    return {
      appVersion: value.appVersion,
      phase: value.phase,
      status: value.status,
    };
  }
  if (
    value.status === 'failed' &&
    typeof value.code === 'string' &&
    (Object.keys(value).length === 3 || Object.keys(value).length === 4) &&
    (value.failureStage === undefined ||
      isPackagedUpdateSmokeFailureStage(value.failureStage)) &&
    /^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)
  ) {
    return {
      code: value.code,
      ...(value.failureStage === undefined
        ? {}
        : { failureStage: value.failureStage }),
      phase: value.phase,
      status: 'failed',
    };
  }
  if (
    value.status === 'ok' &&
    typeof value.acceptedVersion === 'string' &&
    typeof value.appVersion === 'string' &&
    Number.isSafeInteger(value.artifactCount) &&
    (value.artifactCount as number) >= 1 &&
    (value.journalState === null || typeof value.journalState === 'string') &&
    typeof value.migrationChainIdentity === 'string' &&
    sha256Pattern.test(value.migrationChainIdentity) &&
    typeof value.pdfSha256 === 'string' &&
    sha256Pattern.test(value.pdfSha256) &&
    value.secretConfigured === true &&
    Object.keys(value).length === 9
  ) {
    return {
      acceptedVersion: value.acceptedVersion,
      appVersion: value.appVersion,
      artifactCount: value.artifactCount as number,
      journalState: value.journalState,
      migrationChainIdentity: value.migrationChainIdentity,
      pdfSha256: value.pdfSha256,
      phase: value.phase,
      secretConfigured: true,
      status: 'ok',
    };
  }
  return undefined;
}

function isPackagedUpdateSmokeFailureStage(
  value: unknown,
): value is PackagedUpdateSmokeFailureStage {
  return packagedUpdateSmokeFailureStages.some((stage) => stage === value);
}

function isPackagedUpdateSmokePhase(
  value: unknown,
): value is PackagedUpdateSmokePhase {
  return (
    typeof value === 'string' &&
    [
      'seed',
      'prepareSuccess',
      'verifySuccess',
      'prepareCancel',
      'verifyCancel',
      'prepareFailure',
      'verifyRollback',
      'verifyDirectSuccess',
      'verifyDirectFailure',
      'createBackup',
      'restoreBackup',
      'verifyBackup',
    ].includes(value)
  );
}

async function seedSyntheticProfile(
  dependencies: PackagedUpdateSmokeDependencies,
): Promise<void> {
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_REGISTRATION_FAILED', () =>
    dependencies.cache.repairCurrentRegistration({
      manifestPath: packageManifestPath(dependencies, 'current'),
    }),
  );
  const invoiceId = await runSmokeStep(
    'DESKTOP_UPDATE_SMOKE_INVOICE_FIXTURE_FAILED',
    () =>
      createInvoicePdfPreviewSmokeFixture({
        backendPort: dependencies.backend.port,
        runtimeSessionSecret: dependencies.runtimeSessionSecret,
      }),
  );
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_SECRET_FAILED', () =>
    setSyntheticSecret(
      dependencies.backend.port,
      dependencies.runtimeSessionSecret,
    ),
  );
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_STATE_FAILED', () =>
    writeSyntheticProfileState(dependencies, { invoiceId }),
  );
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_PROFILE_VALIDATION_FAILED', () =>
    verifySyntheticProfile(dependencies, { expectedJournalState: null }),
  );
}

async function prepareUpdate(
  dependencies: PackagedUpdateSmokeDependencies,
  role: 'failure' | 'next',
): Promise<void> {
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_PACKAGE_STAGE_FAILED', () =>
    dependencies.cache.stageSelectedPackage({
      manifestPath: packageManifestPath(dependencies, role),
      role: 'candidate',
    }),
  );
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_PREPARATION_FAILED', () =>
    dependencies.handoffCoordinator.prepareConfirmedUpdate(),
  );
  await runSmokeStep('DESKTOP_UPDATE_SMOKE_HANDOFF_FAILED', () =>
    dependencies.handoffCoordinator.handoffPreparedUpdate(),
  );
}

async function verifyDirectSetupState(
  dependencies: PackagedUpdateSmokeDependencies,
  expectedBuild: 'current' | 'target',
): Promise<void> {
  if ((await dependencies.directSetupRecoveryStore.read()) !== undefined) {
    throw new Error('DESKTOP_UPDATE_SMOKE_DIRECT_RECOVERY_REMAINS');
  }
  const acceptedBuild = await dependencies.acceptedBuildStore.read();
  const expectedVersion =
    expectedBuild === 'current'
      ? '0.0.0-update-fixture.1'
      : dependencies.releaseInfo.appVersion;
  if (acceptedBuild?.appVersion !== expectedVersion) {
    throw new Error('DESKTOP_UPDATE_SMOKE_ACCEPTED_BUILD_INVALID');
  }
  await verifySyntheticProfile(dependencies, { expectedJournalState: null });
}

async function verifySyntheticProfile(
  dependencies: PackagedUpdateSmokeDependencies,
  input: { expectedJournalState: string | null },
): Promise<void> {
  const state = await readSyntheticProfileState(dependencies);
  const [acceptedBuild, journal, profile, pdfSha256, secretConfigured] =
    await Promise.all([
      dependencies.acceptedBuildStore.read(),
      dependencies.journalStore.read(),
      dependencies.profileSnapshotClient.validateActiveProfile(),
      readInvoicePdfSha256(
        dependencies.backend.port,
        dependencies.runtimeSessionSecret,
        state.invoiceId,
      ),
      readSecretConfigured(
        dependencies.backend.port,
        dependencies.runtimeSessionSecret,
      ),
    ]);
  if (
    acceptedBuild === undefined ||
    acceptedBuild.appVersion !== dependencies.releaseInfo.appVersion ||
    acceptedBuild.buildRevision !== dependencies.buildRevision ||
    (journal?.state ?? null) !== input.expectedJournalState ||
    !secretConfigured
  ) {
    throw new Error('DESKTOP_UPDATE_SMOKE_PROFILE_VALIDATION_FAILED');
  }
  const configuration = dependencies.configuration;
  if (configuration.phase === undefined) {
    throw new Error('DESKTOP_UPDATE_SMOKE_PHASE_INVALID');
  }
  await writePackagedUpdateSmokeResult(configuration, {
    acceptedVersion: acceptedBuild.appVersion,
    appVersion: dependencies.appVersion,
    artifactCount: profile.artifactCount,
    journalState: journal?.state ?? null,
    migrationChainIdentity: profile.migrationChainIdentity,
    pdfSha256,
    phase: configuration.phase,
    secretConfigured: true,
    status: 'ok',
  });
}

async function createSyntheticBackup(
  dependencies: PackagedUpdateSmokeDependencies,
): Promise<void> {
  await mkdir(join(requireSmokeRoot(dependencies), 'backup'), {
    recursive: true,
  });
  await dependencies.portableProfileBackupService.create({
    destinationPath: backupPath(dependencies, 'source.ekybackup'),
    password: syntheticBackupPassword,
  });
  await verifySyntheticProfile(dependencies, { expectedJournalState: null });
}

async function restoreSyntheticBackup(
  dependencies: PackagedUpdateSmokeDependencies,
): Promise<void> {
  const inspection = await dependencies.profileRestoreStagingService.inspect({
    containerPath: backupPath(dependencies, 'source.ekybackup'),
    password: syntheticBackupPassword,
  });
  const prepared = await dependencies.profileRestoreStagingService.stage({
    inspectionId: inspection.inspectionId,
    password: syntheticBackupPassword,
  });
  await dependencies.profileRestoreActivationService.activate(
    prepared.operationId,
  );
  await writePackagedUpdateSmokeRestoreResult(
    dependencies.configuration,
    dependencies.appVersion,
  );
  await dependencies.shutdownAndQuit();
}

async function createPostRestoreBackup(
  dependencies: PackagedUpdateSmokeDependencies,
): Promise<void> {
  await mkdir(join(requireSmokeRoot(dependencies), 'backup'), {
    recursive: true,
  });
  await dependencies.portableProfileBackupService.create({
    destinationPath: backupPath(dependencies, 'restored.ekybackup'),
    password: syntheticBackupPassword,
  });
}

function packageManifestPath(
  dependencies: PackagedUpdateSmokeDependencies,
  role: 'current' | 'failure' | 'next',
): string {
  return join(requireSmokeRoot(dependencies), 'packages', role, 'manifest.json');
}

function backupPath(
  dependencies: PackagedUpdateSmokeDependencies,
  fileName: 'restored.ekybackup' | 'source.ekybackup',
): string {
  return join(requireSmokeRoot(dependencies), 'backup', fileName);
}

async function writeSyntheticProfileState(
  dependencies: PackagedUpdateSmokeDependencies,
  state: { invoiceId: string },
): Promise<void> {
  if (!identifierPattern.test(state.invoiceId)) {
    throw new Error('DESKTOP_UPDATE_SMOKE_STATE_INVALID');
  }
  const stateRoot = join(requireSmokeRoot(dependencies), 'state');
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    join(stateRoot, syntheticProfileStateFileName),
    `${JSON.stringify({ formatVersion: 1, invoiceId: state.invoiceId })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

async function readSyntheticProfileState(
  dependencies: PackagedUpdateSmokeDependencies,
): Promise<{ invoiceId: string }> {
  const bytes = await readFile(
    join(
      requireSmokeRoot(dependencies),
      'state',
      syntheticProfileStateFileName,
    ),
  );
  if (bytes.byteLength < 1 || bytes.byteLength > maximumStateBytes) {
    throw new Error('DESKTOP_UPDATE_SMOKE_STATE_INVALID');
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 2 ||
      value.formatVersion !== 1 ||
      typeof value.invoiceId !== 'string' ||
      !identifierPattern.test(value.invoiceId)
    ) {
      throw new Error('DESKTOP_UPDATE_SMOKE_STATE_INVALID');
    }
    return { invoiceId: value.invoiceId };
  } catch {
    throw new Error('DESKTOP_UPDATE_SMOKE_STATE_INVALID');
  }
}

async function setSyntheticSecret(
  port: number,
  runtimeSessionSecret: string,
): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/company-settings/email-secret`,
    {
      body: JSON.stringify({
        secret: 'eky-packaged-update-smoke-synthetic-secret',
      }),
      headers: createJsonHeaders(runtimeSessionSecret),
      method: 'PUT',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('DESKTOP_UPDATE_SMOKE_SECRET_FAILED');
  }
  await response.body?.cancel().catch(() => undefined);
}

async function readSecretConfigured(
  port: number,
  runtimeSessionSecret: string,
): Promise<boolean> {
  const response = await fetch(
    `http://127.0.0.1:${port}/company-settings/email-secret`,
    {
      headers: createHeaders(runtimeSessionSecret),
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('DESKTOP_UPDATE_SMOKE_SECRET_FAILED');
  }
  try {
    const value: unknown = await response.json();
    return (
      isRecord(value) &&
      isRecord(value.emailSecretStatus) &&
      value.emailSecretStatus.configured === true
    );
  } catch {
    throw new Error('DESKTOP_UPDATE_SMOKE_SECRET_FAILED');
  }
}

async function readInvoicePdfSha256(
  port: number,
  runtimeSessionSecret: string,
  invoiceId: string,
): Promise<string> {
  const response = await fetch(
    `http://127.0.0.1:${port}/invoices/${invoiceId}/pdf`,
    {
      headers: createHeaders(runtimeSessionSecret),
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (
    !response.ok ||
    !(response.headers.get('content-type') ?? '')
      .toLowerCase()
      .startsWith('application/pdf')
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('DESKTOP_UPDATE_SMOKE_PDF_FAILED');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength < 4 || bytes.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('DESKTOP_UPDATE_SMOKE_PDF_FAILED');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function createHeaders(runtimeSessionSecret: string): Headers {
  return new Headers({
    accept: 'application/json',
    [localRuntimeSessionHeaderName]: runtimeSessionSecret,
  });
}

function createJsonHeaders(runtimeSessionSecret: string): Headers {
  const headers = createHeaders(runtimeSessionSecret);
  headers.set('content-type', 'application/json');
  return headers;
}

function requireSmokeRoot(
  dependencies: PackagedUpdateSmokeDependencies,
): string {
  const root = dependencies.configuration.root;
  if (root === undefined) {
    throw new Error('DESKTOP_UPDATE_SMOKE_ROOT_MISSING');
  }
  return root;
}

function isPreparePhase(phase: PackagedUpdateSmokePhase): boolean {
  return (
    phase === 'prepareSuccess' ||
    phase === 'prepareCancel' ||
    phase === 'prepareFailure'
  );
}

function readSafeSmokeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'DESKTOP_UPDATE_SMOKE_FAILED';
  }
  const value =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : error.message;
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(value)
    ? value
    : 'DESKTOP_UPDATE_SMOKE_FAILED';
}

async function runSmokeStep<T>(
  fallbackCode: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const safeCode = readSafeSmokeErrorCode(error);
    throw new Error(
      safeCode === 'DESKTOP_UPDATE_SMOKE_FAILED' ? fallbackCode : safeCode,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
