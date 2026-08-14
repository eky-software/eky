import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { localRuntimeSessionHeaderName } from '../main/protocolPolicy.js';
import type {
  PackagedSmokeStage,
} from '../main/packagedSmoke.js';
import type { BackupContainerEntryType } from './container/backupContainerEntry.js';
import { createProfileBackupSourceEntries } from './createProfileBackupSourceEntries.js';
import type { PortableProfileBackupService } from './portableProfileBackup.js';
import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type { ProfileRestoreActivationService } from './restore/profileRestoreActivationService.js';
import type { ProfileRestoreStagingService } from './restore/profileRestoreStagingService.js';

const smokeStateFormatVersion = 1;
const smokePassword =
  'Synthetic packaged backup password 2026 - not a production secret';
const mutationCustomerNumber = 'SMOKE-RESTORE-MUTATION';

interface PackagedProfileBackupSmokeOptions {
  backupService: Pick<PortableProfileBackupService, 'create' | 'inspect'>;
  backendPort: number;
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
  >;
  reportStage(stage: PackagedSmokeStage): Promise<void>;
  restoreActivationService: Pick<
    ProfileRestoreActivationService,
    'activate'
  >;
  restoreStagingService: Pick<
    ProfileRestoreStagingService,
    'inspect' | 'stage'
  >;
  runtimeInstanceId: string;
  runtimeSessionSecret: string;
  smokeRoot: string;
  stagingRoot: string;
}

interface PackagedProfileRestoreVerificationOptions {
  backupService: Pick<PortableProfileBackupService, 'create' | 'inspect'>;
  backendPort: number;
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
  >;
  reportStage(stage: PackagedSmokeStage): Promise<void>;
  runtimeInstanceId: string;
  runtimeSessionSecret: string;
  smokeRoot: string;
  stagingRoot: string;
}

interface PackagedEmptyArtifactSnapshotSmokeOptions {
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
  >;
  reportStage(stage: PackagedSmokeStage): Promise<void>;
  stagingRoot: string;
}

interface SmokeEntry {
  contentLength: string;
  logicalPath: string;
  sha256: string;
  type: BackupContainerEntryType;
}

interface PackagedProfileBackupSmokeState {
  expectedEntries: readonly SmokeEntry[];
  formatVersion: 1;
  originalRuntimeInstanceId: string;
  originalRuntimeSessionSha256: string;
}

export async function runPackagedEmptyArtifactSnapshotSmoke(
  options: PackagedEmptyArtifactSnapshotSmokeOptions,
): Promise<void> {
  await options.reportStage('emptyArtifactSnapshot');
  const entries = await captureActiveProfileEntries({
    profileSnapshotClient: options.profileSnapshotClient,
    stagingRoot: options.stagingRoot,
  });

  if (
    entries.length !== 2 ||
    entries.filter(({ type }) => type === 'database').length !== 1 ||
    entries.filter(({ type }) => type === 'artifactCatalog').length !== 1 ||
    entries.some(({ type }) => type === 'businessArtifact')
  ) {
    throw new Error('DESKTOP_SMOKE_EMPTY_ARTIFACT_SNAPSHOT_FAILED');
  }
}

export async function runPackagedProfileBackupBeforeRestore(
  options: PackagedProfileBackupSmokeOptions,
): Promise<'relaunching'> {
  const backupDirectory = join(options.smokeRoot, 'profile-backup');
  const backupPath = join(backupDirectory, 'packaged-profile.ekybackup');

  await options.reportStage('profileBackup');
  await mkdir(backupDirectory, { mode: 0o700, recursive: true });
  const expectedEntries = await captureActiveProfileEntries({
    profileSnapshotClient: options.profileSnapshotClient,
    reportSnapshotStage: options.reportStage,
    stagingRoot: options.stagingRoot,
  });
  assertPrivateProfileEntries(expectedEntries);
  await options.reportStage('profileSnapshotCaptured');
  await options.backupService.create({
    destinationPath: backupPath,
    password: smokePassword,
  });
  await options.backupService.inspect({
    containerPath: backupPath,
    password: smokePassword,
  });
  await options.reportStage('profileBackupVerified');

  await createRestoreMutation(
    options.backendPort,
    options.runtimeSessionSecret,
  );
  await setSyntheticEmailSecret(
    options.backendPort,
    options.runtimeSessionSecret,
  );
  await assertMutationState(
    options.backendPort,
    options.runtimeSessionSecret,
    true,
  );
  await options.reportStage('profileMutationCreated');

  await options.reportStage('profileRestore');
  const inspection = await options.restoreStagingService.inspect({
    containerPath: backupPath,
    password: smokePassword,
  });
  const prepared = await options.restoreStagingService.stage({
    inspectionId: inspection.inspectionId,
    password: smokePassword,
  });
  const stagedEntries = normalizeEntries(
    await createProfileBackupSourceEntries(
      join(options.stagingRoot, prepared.operationId),
    ),
  );
  assertEntriesEqual(stagedEntries, expectedEntries);
  await options.reportStage('profileRestoreStaged');
  await writeSmokeState(options.smokeRoot, {
    expectedEntries,
    formatVersion: smokeStateFormatVersion,
    originalRuntimeInstanceId: options.runtimeInstanceId,
    originalRuntimeSessionSha256: createHash('sha256')
      .update(options.runtimeSessionSecret, 'utf8')
      .digest('hex'),
  });

  await options.reportStage('restoreRestart');
  return options.restoreActivationService.activate(prepared.operationId);
}

export async function runPackagedProfileBackupAfterRestore(
  options: PackagedProfileRestoreVerificationOptions,
): Promise<void> {
  const state = await readSmokeState(options.smokeRoot);

  assertPackagedRestoreSessionChanged(
    state.originalRuntimeInstanceId,
    options.runtimeInstanceId,
    state.originalRuntimeSessionSha256,
    createHash('sha256')
      .update(options.runtimeSessionSecret, 'utf8')
      .digest('hex'),
  );
  await options.reportStage('restoredSessionValidated');
  await options.reportStage('profileComparison');

  const restoredEntries = await captureActiveProfileEntries({
    profileSnapshotClient: options.profileSnapshotClient,
    stagingRoot: options.stagingRoot,
  });
  assertEntriesEqual(
    restoredEntries.filter(({ type }) => type !== 'database'),
    state.expectedEntries.filter(({ type }) => type !== 'database'),
  );
  assertPrivateProfileEntries(restoredEntries);
  await assertMutationState(
    options.backendPort,
    options.runtimeSessionSecret,
    false,
  );
  assertPackagedRestoreSecretContinuity(
    await requestEmailSecretStatus(
      options.backendPort,
      options.runtimeSessionSecret,
      'GET',
    ),
  );

  await options.reportStage('secondBackup');
  const secondBackupPath = join(
    options.smokeRoot,
    'profile-backup',
    'restored-profile.ekybackup',
  );
  await options.backupService.create({
    destinationPath: secondBackupPath,
    password: smokePassword,
  });
  const secondInspection = await options.backupService.inspect({
    containerPath: secondBackupPath,
    password: smokePassword,
  });
  if (
    secondInspection.databaseHealth !== 'healthy' ||
    secondInspection.profileMatchStatus !== 'same'
  ) {
    throw new Error('DESKTOP_SMOKE_SECOND_BACKUP_FAILED');
  }

  if (
    await requestEmailSecretStatus(
      options.backendPort,
      options.runtimeSessionSecret,
      'DELETE',
    )
  ) {
    throw new Error('DESKTOP_SMOKE_RESTORE_SECRET_CLEANUP_FAILED');
  }
}

export async function verifyPackagedRestoredDatabaseBeforeBackend(
  options: {
    activeDatabasePath: string;
    smokeRoot: string;
  },
): Promise<void> {
  const state = await readSmokeState(options.smokeRoot);
  const expectedDatabases = state.expectedEntries.filter(
    ({ type }) => type === 'database',
  );
  if (expectedDatabases.length !== 1) {
    throw new Error('DESKTOP_SMOKE_RESTORE_STATE_FAILED');
  }

  try {
    const activeDatabasePath = resolve(options.activeDatabasePath);
    const [metadata, realDatabasePath] = await Promise.all([
      lstat(activeDatabasePath),
      realpath(activeDatabasePath),
    ]);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      !pathsAreEqual(realDatabasePath, activeDatabasePath) ||
      metadata.size.toString() !== expectedDatabases[0]!.contentLength
    ) {
      throw new Error(
        'DESKTOP_SMOKE_RESTORE_DATABASE_COMPARISON_FAILED',
      );
    }

    const hash = createHash('sha256');
    for await (const chunk of createReadStream(activeDatabasePath)) {
      hash.update(chunk as Buffer);
    }
    if (hash.digest('hex') !== expectedDatabases[0]!.sha256) {
      throw new Error(
        'DESKTOP_SMOKE_RESTORE_DATABASE_COMPARISON_FAILED',
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        'DESKTOP_SMOKE_RESTORE_DATABASE_COMPARISON_FAILED'
    ) {
      throw error;
    }
    throw new Error(
      'DESKTOP_SMOKE_RESTORE_DATABASE_COMPARISON_FAILED',
    );
  }
}

export function assertPackagedRestoreSessionChanged(
  originalRuntimeInstanceId: string,
  restoredRuntimeInstanceId: string,
  originalRuntimeSessionSha256: string,
  restoredRuntimeSessionSha256: string,
): void {
  if (
    originalRuntimeInstanceId === restoredRuntimeInstanceId ||
    originalRuntimeSessionSha256 === restoredRuntimeSessionSha256
  ) {
    throw new Error('DESKTOP_SMOKE_RESTORE_SESSION_FAILED');
  }
}

export function assertPackagedRestoreSecretContinuity(
  isConfigured: boolean,
): void {
  if (!isConfigured) {
    throw new Error('DESKTOP_SMOKE_RESTORE_SECRET_FAILED');
  }
}

async function captureActiveProfileEntries(options: {
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
  >;
  reportSnapshotStage?(stage: PackagedSmokeStage): Promise<void>;
  stagingRoot: string;
}): Promise<readonly SmokeEntry[]> {
  const operationId = randomUUID();
  const operationRoot = join(options.stagingRoot, operationId);
  let maintenanceStarted = false;

  try {
    await options.profileSnapshotClient.beginMaintenance(operationId);
    maintenanceStarted = true;
    await options.reportSnapshotStage?.('profileSnapshotMaintenance');
    await options.profileSnapshotClient.createProfileSnapshot(operationId);
    await options.reportSnapshotStage?.('profileSnapshotCreated');
    const validation =
      await options.profileSnapshotClient.validateProfileSnapshot(
        operationId,
      );
    if (!validation.profileMatchesActive) {
      throw new Error('DESKTOP_SMOKE_PROFILE_SNAPSHOT_FAILED');
    }
    return normalizeEntries(
      await createProfileBackupSourceEntries(operationRoot),
    );
  } finally {
    if (maintenanceStarted) {
      await options.profileSnapshotClient
        .endMaintenance(operationId)
        .catch(() => undefined);
    }
    await rm(operationRoot, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

async function createRestoreMutation(
  backendPort: number,
  runtimeSessionSecret: string,
): Promise<void> {
  await requestJson(
    backendPort,
    runtimeSessionSecret,
    '/customers',
    'POST',
    {
      businessId: '',
      city: 'Helsinki',
      comment: 'Synthetic restore mutation',
      customerNumber: mutationCustomerNumber,
      customerNumberMode: 'manual',
      customerType: 'company',
      email: 'restore-mutation@example.invalid',
      hourlyRateOverrideCents: null,
      managedByCustomerId: '',
      name: 'Restore mutation must disappear',
      phone: '',
      postalCode: '00100',
      status: 'active',
      streetAddress: 'Mutation test street 1',
    },
  );
}

async function setSyntheticEmailSecret(
  backendPort: number,
  runtimeSessionSecret: string,
): Promise<void> {
  if (
    !(await requestEmailSecretStatus(
      backendPort,
      runtimeSessionSecret,
      'PUT',
      'synthetic-safe-storage-restore-secret',
    ))
  ) {
    throw new Error('DESKTOP_SMOKE_RESTORE_SECRET_SETUP_FAILED');
  }
}

async function assertMutationState(
  backendPort: number,
  runtimeSessionSecret: string,
  expectedToExist: boolean,
): Promise<void> {
  const response = await request(
    backendPort,
    runtimeSessionSecret,
    '/customers',
    'GET',
  );
  const responseText = await response.text();
  if (responseText.includes(mutationCustomerNumber) !== expectedToExist) {
    throw new Error('DESKTOP_SMOKE_RESTORE_MUTATION_FAILED');
  }
}

async function requestEmailSecretStatus(
  backendPort: number,
  runtimeSessionSecret: string,
  method: 'DELETE' | 'GET' | 'PUT',
  secret?: string,
): Promise<boolean> {
  const response = await request(
    backendPort,
    runtimeSessionSecret,
    '/company-settings/email-secret',
    method,
    method === 'PUT' ? { secret } : undefined,
  );
  const value: unknown = await response.json();

  if (
    !isRecord(value) ||
    !isRecord(value.emailSecretStatus) ||
    typeof value.emailSecretStatus.configured !== 'boolean'
  ) {
    throw new Error('DESKTOP_SMOKE_RESTORE_SECRET_FAILED');
  }
  return value.emailSecretStatus.configured;
}

async function requestJson(
  backendPort: number,
  runtimeSessionSecret: string,
  pathname: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await request(
    backendPort,
    runtimeSessionSecret,
    pathname,
    method,
    body,
  );
  return response.json();
}

async function request(
  backendPort: number,
  runtimeSessionSecret: string,
  pathname: string,
  method: 'DELETE' | 'GET' | 'POST' | 'PUT',
  body?: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers({
    accept: 'application/json',
    [localRuntimeSessionHeaderName]: runtimeSessionSecret,
  });
  const requestInit: RequestInit = {
    headers,
    method,
    signal: AbortSignal.timeout(10_000),
  };

  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    requestInit.body = JSON.stringify(body);
  }
  const response = await fetch(
    `http://127.0.0.1:${backendPort}${pathname}`,
    requestInit,
  );
  if (!response.ok) {
    throw new Error('DESKTOP_SMOKE_RESTORE_HTTP_FAILED');
  }
  return response;
}

function normalizeEntries(
  entries: Awaited<ReturnType<typeof createProfileBackupSourceEntries>>,
): readonly SmokeEntry[] {
  return entries.map((entry) => ({
    contentLength: entry.contentLength.toString(),
    logicalPath: entry.logicalPath,
    sha256: entry.sha256,
    type: entry.type,
  }));
}

function assertEntriesEqual(
  actual: readonly SmokeEntry[],
  expected: readonly SmokeEntry[],
): void {
  const entryTypes = [
    'database',
    'artifactCatalog',
    'businessArtifact',
  ] as const satisfies readonly Exclude<
    BackupContainerEntryType,
    'manifest'
  >[];

  for (const entryType of entryTypes) {
    const actualEntries = actual.filter(({ type }) => type === entryType);
    const expectedEntries = expected.filter(({ type }) => type === entryType);
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      throw new Error(readComparisonFailureCode(entryType));
    }
  }
}

function readComparisonFailureCode(
  entryType: Exclude<BackupContainerEntryType, 'manifest'>,
): string {
  switch (entryType) {
    case 'database':
      return 'DESKTOP_SMOKE_RESTORE_DATABASE_COMPARISON_FAILED';
    case 'artifactCatalog':
      return 'DESKTOP_SMOKE_RESTORE_CATALOG_COMPARISON_FAILED';
    case 'businessArtifact':
      return 'DESKTOP_SMOKE_RESTORE_ARTIFACT_COMPARISON_FAILED';
  }
}

function assertPrivateProfileEntries(
  entries: readonly SmokeEntry[],
): void {
  if (
    entries.length < 3 ||
    !entries.some((entry) => entry.type === 'database') ||
    !entries.some((entry) => entry.type === 'artifactCatalog') ||
    !entries.some((entry) => entry.type === 'businessArtifact') ||
    entries.some((entry) =>
      /(?:secret|password|runtime-session|logs|archive-config)/iu.test(
        entry.logicalPath,
      ),
    )
  ) {
    throw new Error('DESKTOP_SMOKE_BACKUP_PRIVACY_FAILED');
  }
}

async function writeSmokeState(
  smokeRoot: string,
  state: PackagedProfileBackupSmokeState,
): Promise<void> {
  const stateDirectory = join(smokeRoot, 'profile-backup');
  const statePath = join(stateDirectory, 'restore-smoke-state-v1.json');
  const temporaryPath = `${statePath}.next`;

  await mkdir(stateDirectory, { mode: 0o700, recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rm(statePath, { force: true });
  await rename(temporaryPath, statePath);
}

async function readSmokeState(
  smokeRoot: string,
): Promise<PackagedProfileBackupSmokeState> {
  const statePath = join(
    smokeRoot,
    'profile-backup',
    'restore-smoke-state-v1.json',
  );
  let value: unknown;
  try {
    value = JSON.parse(await readFile(statePath, 'utf8')) as unknown;
  } catch {
    throw new Error('DESKTOP_SMOKE_RESTORE_STATE_FAILED');
  }

  if (
    !isRecord(value) ||
    value.formatVersion !== smokeStateFormatVersion ||
    typeof value.originalRuntimeInstanceId !== 'string' ||
    typeof value.originalRuntimeSessionSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.originalRuntimeSessionSha256) ||
    !Array.isArray(value.expectedEntries)
  ) {
    throw new Error('DESKTOP_SMOKE_RESTORE_STATE_FAILED');
  }
  const expectedEntries = value.expectedEntries.map(readSmokeEntry);
  return {
    expectedEntries,
    formatVersion: smokeStateFormatVersion,
    originalRuntimeInstanceId: value.originalRuntimeInstanceId,
    originalRuntimeSessionSha256: value.originalRuntimeSessionSha256,
  };
}

function readSmokeEntry(value: unknown): SmokeEntry {
  if (
    !isRecord(value) ||
    typeof value.contentLength !== 'string' ||
    !/^(0|[1-9]\d*)$/u.test(value.contentLength) ||
    typeof value.logicalPath !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    ![
      'artifactCatalog',
      'businessArtifact',
      'database',
    ].includes(String(value.type))
  ) {
    throw new Error('DESKTOP_SMOKE_RESTORE_STATE_FAILED');
  }
  return {
    contentLength: value.contentLength,
    logicalPath: value.logicalPath,
    sha256: value.sha256,
    type: value.type as BackupContainerEntryType,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
