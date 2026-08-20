import {
  promises as fileSystem,
} from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import {
  createProfileBackupIdentity,
  inspectSqliteProfileDatabase,
} from './inspectSqliteProfileDatabase.js';
import type {
  ProfileSnapshotValidationMetadata,
  ProfileRestoreActivationPreparationMetadata,
  ProfileSnapshotValidationService,
} from './profileSnapshotTypes.js';
import { isActiveProfileRestoreTargetEmpty } from './inspectActiveProfileRestoreTarget.js';
import { validateProfileArtifactCatalog } from './validateProfileArtifactCatalog.js';
import { materializeValidatedProfileArtifacts } from './materializeValidatedProfileArtifacts.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const databaseLogicalPath = 'profile.sqlite';
const activationDocumentsLogicalPath = join(
  'activation',
  'storage',
  'invoices',
);

export class StagedProfileSnapshotValidationService
  implements ProfileSnapshotValidationService
{
  private readonly stagingRoot: string;

  constructor(
    private readonly dependencies: {
      activeDatabase: DatabaseConnection;
      migrationsDirectory: string;
      stagingRoot: string;
    },
  ) {
    if (
      !isAbsolute(dependencies.migrationsDirectory) ||
      !isAbsolute(dependencies.stagingRoot)
    ) {
      throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }
    this.stagingRoot = resolve(dependencies.stagingRoot);
  }

  async validateProfileSnapshot(
    operationId: string,
  ): Promise<ProfileSnapshotValidationMetadata> {
    const inspection = await this.inspect(operationId);
    return inspection.validation;
  }

  async prepareProfileRestoreActivation(
    operationId: string,
  ): Promise<ProfileRestoreActivationPreparationMetadata> {
    let operationRoot: string | undefined;
    try {
      const inspection = await this.inspect(operationId);
      operationRoot = inspection.operationRoot;
      const activationDocumentsRoot = join(
        inspection.operationRoot,
        activationDocumentsLogicalPath,
      );
      assertContainedPath(
        inspection.operationRoot,
        activationDocumentsRoot,
      );
      await assertPathMissing(activationDocumentsRoot);
      await fileSystem.mkdir(activationDocumentsRoot, {
        mode: 0o700,
        recursive: true,
      });
      await assertPrivateOperationRoot(activationDocumentsRoot);

      await materializeValidatedProfileArtifacts({
        artifacts: inspection.artifacts,
        destinationRoot: activationDocumentsRoot,
        sourceRoot: inspection.operationRoot,
      });

      await fileSystem.chmod(inspection.databasePath, 0o600);
      return {
        artifactCount: inspection.validation.artifactCount,
        artifactTotalByteSize:
          inspection.validation.artifactTotalByteSize,
      };
    } catch {
      if (operationRoot !== undefined) {
        await fileSystem
          .rm(join(operationRoot, 'activation'), {
            force: true,
            recursive: true,
          })
          .catch(() => undefined);
      }
      throw new Error('PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED');
    }
  }

  private async inspect(operationId: string): Promise<{
    artifacts: Awaited<
      ReturnType<typeof validateProfileArtifactCatalog>
    >['artifacts'];
    databasePath: string;
    operationRoot: string;
    validation: ProfileSnapshotValidationMetadata;
  }> {
    if (!operationIdPattern.test(operationId)) {
      throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }

    const activeProfileId = createProfileBackupIdentity(
      readLocalRuntimeIdentity(this.dependencies.activeDatabase).companyId,
    );

    const operationRoot = join(this.stagingRoot, operationId);
    const databasePath = join(operationRoot, databaseLogicalPath);
    assertContainedPath(this.stagingRoot, operationRoot);
    assertContainedPath(operationRoot, databasePath);

    try {
      await assertPrivateOperationRoot(operationRoot);
      const databaseMetadata = await fileSystem.lstat(databasePath);
      if (
        !databaseMetadata.isFile() ||
        databaseMetadata.isSymbolicLink() ||
        databaseMetadata.nlink !== 1 ||
        databaseMetadata.size < 1
      ) {
        throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
      }
      const realDatabasePath = await fileSystem.realpath(databasePath);
      if (!pathsAreEqual(realDatabasePath, databasePath)) {
        throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
      }

      const databaseInspection = inspectSqliteProfileDatabase(
        databasePath,
        this.dependencies.migrationsDirectory,
        'restoreCompatible',
      );
      const stagedDatabase = new Database(databasePath, {
        fileMustExist: true,
        readonly: true,
      });

      try {
        const artifacts = await validateProfileArtifactCatalog({
          database: stagedDatabase,
          operationRoot,
        });

        return {
          artifacts: artifacts.artifacts,
          databasePath,
          operationRoot,
          validation: {
            activeProfileIsEmpty: isActiveProfileRestoreTargetEmpty(
              this.dependencies.activeDatabase,
            ),
            artifactCount: artifacts.artifactCount,
            artifactTotalByteSize: artifacts.artifactTotalByteSize,
            databaseHealth: 'healthy',
            migrationChainIdentity:
              databaseInspection.migrationChainIdentity,
            profileId: databaseInspection.profileId,
            profileMatchesActive:
              databaseInspection.profileId === activeProfileId,
          },
        };
      } finally {
        stagedDatabase.close();
      }
    } catch {
      throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
  throw new Error('PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED');
}

async function assertPrivateOperationRoot(
  operationRoot: string,
): Promise<void> {
  const metadata = await fileSystem.lstat(operationRoot);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  }

  const realPath = await fileSystem.realpath(operationRoot);
  if (!pathsAreEqual(realPath, operationRoot)) {
    throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  }
}

function assertContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
