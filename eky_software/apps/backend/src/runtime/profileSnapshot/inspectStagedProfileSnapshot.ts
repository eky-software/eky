import {
  promises as fileSystem,
} from 'node:fs';
import {
  isAbsolute,
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { ProfileInspectionDatabaseFactory } from './createProfileInspectionDatabase.js';
import {
  inspectSqliteProfileConnectionWithReferences, isProfileMigrationInspectionPolicy,
  type ProfileMigrationInspectionPolicy,
} from './inspectSqliteProfileDatabase.js';
import type {
  InspectedProfileSnapshotMetadata,
  ProfileRestoreActivationPreparationMetadata,
} from './profileSnapshotTypes.js';
import { validateProfileArtifactCatalog } from './validateProfileArtifactCatalog.js';
import { selectInvoiceBackupArtifactCatalogSchema } from '../../modules/invoicing/infrastructure/selectInvoiceBackupArtifactCatalogSchema.js';
import { materializeValidatedProfileArtifacts } from './materializeValidatedProfileArtifacts.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const databaseLogicalPath = 'profile.sqlite';
const activationDocumentsLogicalPath = join(
  'activation',
  'storage',
  'invoices',
);

export class StagedProfileSnapshotInspector {
  private readonly stagingRoot: string;

  constructor(
    private readonly dependencies: {
      migrationsDirectory: string;
      migrationPolicy: ProfileMigrationInspectionPolicy;
      databaseSource: { readonly kind: 'stagedSnapshot' } |
        { readonly kind: 'ownedInspectionCopy'; readonly databasePath: string };
      stagingRoot: string;
      databaseFactory: ProfileInspectionDatabaseFactory;
    },
  ) {
    if (
      !isAbsolute(dependencies.migrationsDirectory) ||
      !isAbsolute(dependencies.stagingRoot)
    ) {
      throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }
    if (typeof dependencies.databaseFactory?.openReadonly !== 'function' ||
        typeof dependencies.databaseFactory.openReference !== 'function' ||
        typeof dependencies.databaseFactory.schemaReferences?.getTechnicalSchema !== 'function' ||
        typeof dependencies.databaseFactory.schemaReferences.getSchemaReference !== 'function' ||
        !isProfileMigrationInspectionPolicy(dependencies.migrationPolicy) ||
        (dependencies.databaseSource?.kind !== 'stagedSnapshot' && dependencies.databaseSource?.kind !== 'ownedInspectionCopy')) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
    this.stagingRoot = resolve(dependencies.stagingRoot);
    if (dependencies.databaseSource.kind === 'ownedInspectionCopy') {
      const path = dependencies.databaseSource.databasePath;
      if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0') ||
          basename(path) !== databaseLogicalPath || !pathsAreEqual(dirname(dirname(path)), this.stagingRoot) ||
          !/^profile-inspection-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(basename(dirname(path)))) {
        throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      }
    }
  }

  async inspectProfileSnapshot(
    operationId: string,
  ): Promise<InspectedProfileSnapshotMetadata> {
    const inspection = await this.inspectProfileSnapshotWithArtifacts(operationId);
    return inspection.validation;
  }

  async inspectProfileSnapshotWithArtifacts(operationId: string): Promise<{
    validation: InspectedProfileSnapshotMetadata;
    artifacts: Awaited<ReturnType<typeof validateProfileArtifactCatalog>>['artifacts'];
  }> {
    const inspection = await this.inspect(operationId);
    return { validation: inspection.validation, artifacts: inspection.artifacts };
  }

  async prepareProfileRestoreActivation(
    operationId: string,
  ): Promise<ProfileRestoreActivationPreparationMetadata> {
    return (await this.inspectAndPrepareProfileRestoreActivation(operationId)).prepared;
  }

  async inspectAndPrepareProfileRestoreActivation(
    operationId: string,
  ): Promise<{
    validation: InspectedProfileSnapshotMetadata;
    prepared: ProfileRestoreActivationPreparationMetadata;
    artifacts: Awaited<ReturnType<typeof validateProfileArtifactCatalog>>['artifacts'];
  }> {
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
        validation: inspection.validation,
        artifacts: inspection.artifacts,
        prepared: {
          artifactCount: inspection.validation.artifactCount,
          artifactTotalByteSize: inspection.validation.artifactTotalByteSize,
        },
      };
    } catch (error) {
      if (operationRoot !== undefined) {
        await fileSystem
          .rm(join(operationRoot, 'activation'), {
            force: true,
            recursive: true,
          })
          .catch(() => undefined);
      }
      throw inspectionError(error, 'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED');
    }
  }

  private async inspect(operationId: string): Promise<{
    artifacts: Awaited<
      ReturnType<typeof validateProfileArtifactCatalog>
    >['artifacts'];
    databasePath: string;
    operationRoot: string;
    validation: InspectedProfileSnapshotMetadata;
  }> {
    if (!operationIdPattern.test(operationId)) {
      throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }

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

      const inspectionPath = this.dependencies.databaseSource.kind === 'stagedSnapshot'
        ? databasePath : this.dependencies.databaseSource.databasePath;
      if (inspectionPath !== databasePath) {
        await assertPrivateOperationRoot(dirname(inspectionPath));
        const copyMetadata = await fileSystem.lstat(inspectionPath);
        if (!copyMetadata.isFile() || copyMetadata.isSymbolicLink() || copyMetadata.nlink !== 1 || copyMetadata.size < 1 ||
            !pathsAreEqual(await fileSystem.realpath(inspectionPath), inspectionPath)) {
          throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
        }
      }
      const stagedDatabase = this.dependencies.databaseFactory.openReadonly(inspectionPath);
      let inspectionFailure: unknown;
      try {
        const databaseInspection = inspectSqliteProfileConnectionWithReferences(
          stagedDatabase,
          this.dependencies.migrationsDirectory,
          this.dependencies.migrationPolicy,
          this.dependencies.databaseFactory.schemaReferences,
        );
        const artifacts = await validateProfileArtifactCatalog({
          database: stagedDatabase,
          operationRoot,
          schema: selectInvoiceBackupArtifactCatalogSchema(databaseInspection),
        });

        return {
          artifacts: artifacts.artifacts,
          databasePath,
          operationRoot,
          validation: {
            artifactCount: artifacts.artifactCount,
            artifactTotalByteSize: artifacts.artifactTotalByteSize,
            databaseHealth: 'healthy',
            migrationChainIdentity:
              databaseInspection.migrationChainIdentity,
            profileId: databaseInspection.profileId,
          },
        };
      } catch (error) {
        inspectionFailure = error;
        throw error;
      } finally {
        try { stagedDatabase.close(); }
        catch (error) {
          throw new AggregateError([...(inspectionFailure === undefined ? [] : [inspectionFailure]), error],
            'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED');
        }
      }
    } catch (error) {
      throw inspectionError(error, 'PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }
  }
}

function inspectionError(error: unknown, fallback: string): Error {
  return new Error(error instanceof Error && (
    error.message === 'PROFILE_SCHEMA_UNSUPPORTED' ||
    error.message === 'PROFILE_INSPECTION_LIMIT_EXCEEDED'
  )
    ? error.message
    : fallback, { cause: error });
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
