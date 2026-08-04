import { promises as fileSystem } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import type { InvoiceBackupArtifactCatalog } from '../../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';
import type { ProfileMaintenanceState } from '../profileMaintenance/profileMaintenanceState.js';
import {
  createSqliteProfileSnapshotService,
} from './createSqliteProfileSnapshot.js';
import {
  ProfileBusinessArtifactStager,
} from './stageProfileBusinessArtifacts.js';
import type {
  CreateProfileSnapshotInput,
  ProfileSnapshotMetadata,
  ProfileSnapshotService,
  SqliteProfileSnapshotService,
} from './profileSnapshotTypes.js';

interface ConsistentProfileSnapshotDependencies {
  artifactStager: Pick<ProfileBusinessArtifactStager, 'stageArtifacts'>;
  sqliteSnapshotService: SqliteProfileSnapshotService;
  stagingRoot: string;
}

export class ConsistentProfileSnapshotService
  implements ProfileSnapshotService
{
  private readonly stagingRoot: string;

  constructor(
    private readonly dependencies: ConsistentProfileSnapshotDependencies,
  ) {
    if (!isAbsolute(dependencies.stagingRoot)) {
      throw new Error('PROFILE_SNAPSHOT_PATH_INVALID');
    }
    this.stagingRoot = resolve(dependencies.stagingRoot);
  }

  async createProfileSnapshot(
    input: CreateProfileSnapshotInput,
  ): Promise<ProfileSnapshotMetadata> {
    const database =
      await this.dependencies.sqliteSnapshotService.createSqliteSnapshot(
        input,
      );

    try {
      const artifactCatalog =
        await this.dependencies.artifactStager.stageArtifacts(input);

      return { artifactCatalog, database };
    } catch {
      await fileSystem
        .rm(join(this.stagingRoot, input.operationId), {
          force: true,
          recursive: true,
        })
        .catch(() => undefined);
      throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_FAILED');
    }
  }
}

export function createConsistentProfileSnapshotService(input: {
  catalog: InvoiceBackupArtifactCatalog;
  database: DatabaseConnection;
  invoiceDocumentStorageRoot: string;
  maintenanceState: ProfileMaintenanceState;
  migrationsDirectory: string;
  stagingRoot: string;
}): ConsistentProfileSnapshotService {
  return new ConsistentProfileSnapshotService({
    artifactStager: new ProfileBusinessArtifactStager({
      catalog: input.catalog,
      invoiceDocumentStorageRoot: input.invoiceDocumentStorageRoot,
      maintenanceState: input.maintenanceState,
      stagingRoot: input.stagingRoot,
    }),
    sqliteSnapshotService: createSqliteProfileSnapshotService({
      database: input.database,
      maintenanceState: input.maintenanceState,
      migrationsDirectory: input.migrationsDirectory,
      stagingRoot: input.stagingRoot,
    }),
    stagingRoot: input.stagingRoot,
  });
}
