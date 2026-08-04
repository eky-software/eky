import { promises as fileSystem } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import { readDecryptedBackupPayload } from './container/backupContainerReader.js';
import { decryptBackupPayload } from './container/decryptBackupPayload.js';
import { extractBackupPayload } from './container/extractBackupPayload.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProfileBackupInspectionErrorCode =
  | 'BACKUP_AUTHENTICATION_FAILED'
  | 'BACKUP_CONTENT_INVALID'
  | 'BACKUP_FILE_INVALID'
  | 'BACKUP_INSPECTION_UNAVAILABLE';

export interface ProfileBackupInspectionSummary {
  appVersion: string;
  compatibilityStatus: 'compatible';
  createdAt: string;
  databaseHealth: 'healthy';
  documentCount: number;
  formatVersion: 1;
  profileMatchStatus: 'different' | 'same';
  totalBusinessByteSize: number;
}

export class ProfileBackupInspectionError extends Error {
  constructor(readonly code: ProfileBackupInspectionErrorCode) {
    super(code);
    this.name = 'ProfileBackupInspectionError';
  }
}

interface ProfileSnapshotValidator {
  validateProfileSnapshot(operationId: string): ReturnType<
    ProfileSnapshotBrokerClient['validateProfileSnapshot']
  >;
}

export async function inspectEncryptedProfileBackup(input: {
  containerPath: string;
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
}): Promise<ProfileBackupInspectionSummary> {
  validateTrustedInput(input);
  const quarantinePath = join(
    input.quarantineRoot,
    `${input.operationId}.payload`,
  );
  const operationRoot = join(input.stagingRoot, input.operationId);
  let authenticated = false;
  let decrypted = false;
  let extracted = false;

  try {
    await Promise.all([
      assertPrivateRoot(input.quarantineRoot),
      assertPrivateRoot(input.stagingRoot),
      assertPathMissing(quarantinePath),
      assertPathMissing(operationRoot),
    ]);
    const decryptedPayload = await decryptBackupPayload({
      containerPath: input.containerPath,
      password: input.password,
      quarantinePath,
    });
    authenticated = true;
    decrypted = true;

    const parsed = await readDecryptedBackupPayload(quarantinePath);
    await extractBackupPayload({
      operationRoot,
      parsedPayload: parsed,
      payloadPath: quarantinePath,
    });
    extracted = true;

    const validation = await input.validator.validateProfileSnapshot(
      input.operationId,
    );
    if (
      validation.profileId !== parsed.manifest.profileId ||
      validation.migrationChainIdentity !==
        parsed.manifest.migrationChainIdentity
    ) {
      throw new Error('BACKUP_MANIFEST_IDENTITY_INVALID');
    }

    return {
      appVersion: parsed.manifest.appVersion,
      compatibilityStatus: 'compatible',
      createdAt: new Date(
        Number(parsed.manifest.createdAtEpochMilliseconds),
      ).toISOString(),
      databaseHealth: validation.databaseHealth,
      documentCount: validation.artifactCount,
      formatVersion: decryptedPayload.header.containerVersion,
      profileMatchStatus: validation.profileMatchesActive
        ? 'same'
        : 'different',
      totalBusinessByteSize: validation.artifactTotalByteSize,
    };
  } catch (error) {
    if (error instanceof ProfileBackupInspectionError) {
      throw error;
    }
    if (!authenticated) {
      throw new ProfileBackupInspectionError(
        isMissingOrInvalidSource(error)
          ? 'BACKUP_FILE_INVALID'
          : 'BACKUP_AUTHENTICATION_FAILED',
      );
    }
    throw new ProfileBackupInspectionError('BACKUP_CONTENT_INVALID');
  } finally {
    if (extracted) {
      await fileSystem
        .rm(operationRoot, { force: true, recursive: true })
        .catch(() => undefined);
    }
    if (decrypted) {
      await fileSystem
        .rm(quarantinePath, { force: true })
        .catch(() => undefined);
    }
  }
}

function validateTrustedInput(input: {
  containerPath: string;
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
}): void {
  if (
    !operationIdPattern.test(input.operationId) ||
    !isAbsolute(input.containerPath) ||
    !isAbsolute(input.quarantineRoot) ||
    !isAbsolute(input.stagingRoot) ||
    resolve(input.quarantineRoot) === resolve(input.stagingRoot) ||
    typeof input.password !== 'string'
  ) {
    throw new ProfileBackupInspectionError(
      'BACKUP_INSPECTION_UNAVAILABLE',
    );
  }
}

async function assertPrivateRoot(path: string): Promise<void> {
  const metadata = await fileSystem.lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new ProfileBackupInspectionError(
      'BACKUP_INSPECTION_UNAVAILABLE',
    );
  }

  const realPath = await fileSystem.realpath(path);
  if (!pathsAreEqual(realPath, path)) {
    throw new ProfileBackupInspectionError(
      'BACKUP_INSPECTION_UNAVAILABLE',
    );
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new ProfileBackupInspectionError(
    'BACKUP_INSPECTION_UNAVAILABLE',
  );
}

function isMissingOrInvalidSource(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === 'BACKUP_CONTAINER_FILE_INVALID' ||
      (error as NodeJS.ErrnoException).code === 'ENOENT')
  );
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
