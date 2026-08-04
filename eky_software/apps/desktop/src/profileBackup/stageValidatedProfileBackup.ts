import { promises as fileSystem } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import {
  ProfileBackupInspectionError,
  type ProfileBackupInspectionSummary,
} from './profileBackupInspectionTypes.js';
import { readDecryptedBackupPayload } from './container/backupContainerReader.js';
import { decryptBackupPayload } from './container/decryptBackupPayload.js';
import { extractBackupPayload } from './container/extractBackupPayload.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProfileSnapshotValidator {
  validateProfileSnapshot(operationId: string): ReturnType<
    ProfileSnapshotBrokerClient['validateProfileSnapshot']
  >;
}

export interface StagedValidatedProfileBackup {
  containerSha256: string;
  operationRoot: string;
  summary: ProfileBackupInspectionSummary;
  validation: Awaited<
    ReturnType<ProfileSnapshotValidator['validateProfileSnapshot']>
  >;
}

export async function stageValidatedProfileBackup(input: {
  containerPath: string;
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
}): Promise<StagedValidatedProfileBackup> {
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
      containerSha256: decryptedPayload.containerSha256,
      operationRoot,
      summary: {
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
      },
      validation,
    };
  } catch (error) {
    if (extracted) {
      await fileSystem
        .rm(operationRoot, { force: true, recursive: true })
        .catch(() => undefined);
    }
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
