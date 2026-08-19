import { promises as fileSystem } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { readDecryptedBackupPayload } from '../../profileBackup/container/backupContainerReader.js';
import { decryptBackupPayload } from '../../profileBackup/container/decryptBackupPayload.js';
import { extractBackupPayload } from '../../profileBackup/container/extractBackupPayload.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';
import type {
  WorkspaceBackupContainerPort,
  WorkspaceBackupPreflightResult,
  WorkspaceBackupSourceInput,
  WorkspaceBackupStageInput,
} from './workspaceBackupImportPorts.js';
import type { WorkspaceBackupPlaintextQuarantinePort } from './workspaceBackupPlaintextQuarantine.js';

const sha256Pattern = /^[0-9a-f]{64}$/;
const appVersionPattern = /^[A-Za-z0-9.+_-]{1,80}$/;

export interface WorkspaceBackupContainerAdapterOptions {
  readonly plaintextQuarantine: WorkspaceBackupPlaintextQuarantinePort;
}

export class WorkspaceBackupContainerAdapter
  implements WorkspaceBackupContainerPort {
  private readonly plaintextQuarantine: WorkspaceBackupPlaintextQuarantinePort;

  constructor(options: Readonly<WorkspaceBackupContainerAdapterOptions>) {
    this.plaintextQuarantine = options.plaintextQuarantine;
  }

  inspect(
    input: Readonly<WorkspaceBackupSourceInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>> {
    return this.authenticateAndRead(input);
  }

  async stage(
    input: Readonly<WorkspaceBackupStageInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>> {
    validateStageInput(input);
    const quarantinePath = await this.createQuarantinePath();
    try {
      const decrypted = await decryptBackupPayload({
        containerPath: input.containerPath,
        password: input.password,
        quarantinePath,
      });
      const parsed = await readDecryptedBackupPayload(quarantinePath);
      const result = toInspectionResult(decrypted.containerSha256, parsed.manifest);
      if (
        result.containerSha256 !== input.expectedContainerSha256 ||
        result.migrationChainIdentity !==
          input.expectedMigrationChainIdentity ||
        result.profileId !== input.expectedProfileId
      ) {
        throw backupFailure('backupStage');
      }
      await assertSafeMissingStagingRoot(input.importStagingRoot);
      await extractBackupPayload({
        operationRoot: input.importStagingRoot,
        parsedPayload: parsed,
        payloadPath: quarantinePath,
      });
      return result;
    } catch (error) {
      throw error instanceof WorkspaceBackupImportError
        ? error
        : backupFailure('backupStage');
    } finally {
      await this.plaintextQuarantine.removePayload(quarantinePath);
    }
  }

  private async authenticateAndRead(
    input: Readonly<WorkspaceBackupSourceInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>> {
    validateSourceInput(input);
    const quarantinePath = await this.createQuarantinePath();
    try {
      const decrypted = await decryptBackupPayload({
        containerPath: input.containerPath,
        password: input.password,
        quarantinePath,
      });
      const parsed = await readDecryptedBackupPayload(quarantinePath);
      return toInspectionResult(decrypted.containerSha256, parsed.manifest);
    } catch (error) {
      throw error instanceof WorkspaceBackupImportError
        ? error
        : backupFailure('backupPreflight');
    } finally {
      await this.plaintextQuarantine.removePayload(quarantinePath);
    }
  }

  private createQuarantinePath(): Promise<string> {
    return this.plaintextQuarantine.createPayloadPath();
  }
}

function validateSourceInput(input: Readonly<WorkspaceBackupSourceInput>): void {
  if (
    !isAbsolute(input.containerPath) ||
    input.containerPath.includes('\0') ||
    typeof input.password !== 'string'
  ) {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_INVALID',
      'inputValidation',
    );
  }
}

function validateStageInput(input: Readonly<WorkspaceBackupStageInput>): void {
  validateSourceInput(input);
  try {
    validateSha256(input.expectedContainerSha256);
    validateSha256(input.expectedMigrationChainIdentity);
    validateSha256(input.expectedProfileId);
  } catch {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_INVALID',
      'inputValidation',
    );
  }
  if (!isAbsolute(input.importStagingRoot)) {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_INVALID',
      'inputValidation',
    );
  }
}

function toInspectionResult(
  containerSha256: string,
  manifest: {
    readonly appVersion: string;
    readonly migrationChainIdentity: string;
    readonly profileId: string;
  },
): Readonly<WorkspaceBackupPreflightResult> {
  validateSha256(containerSha256);
  validateSha256(manifest.migrationChainIdentity);
  validateSha256(manifest.profileId);
  if (!appVersionPattern.test(manifest.appVersion)) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
  return Object.freeze({
    appVersion: manifest.appVersion,
    containerSha256,
    migrationChainIdentity: manifest.migrationChainIdentity,
    profileId: manifest.profileId,
  });
}

function validateSha256(value: string): void {
  if (!sha256Pattern.test(value)) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
}

async function assertSafeMissingStagingRoot(path: string): Promise<void> {
  const parent = dirname(path);
  const parentMetadata = await fileSystem.lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error('BACKUP_STAGING_INVALID');
  }
  if (!pathsEqual(await fileSystem.realpath(parent), parent)) {
    throw new Error('BACKUP_STAGING_INVALID');
  }
  await assertPathMissing(path);
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('path exists');
}

function backupFailure(
  stage: 'backupPreflight' | 'backupStage',
): WorkspaceBackupImportError {
  return new WorkspaceBackupImportError('WORKSPACE_IMPORT_BACKUP_FAILED', stage);
}

function pathsEqual(first: string, second: string): boolean {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
