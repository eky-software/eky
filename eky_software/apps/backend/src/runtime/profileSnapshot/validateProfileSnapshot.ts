import { toNamespacedPath } from 'node:path';

import Database from 'better-sqlite3';

import { createMigrationSchemaReferences } from '../../database/migration/migrationSchemaReference.js';
import { StagedProfileSnapshotInspector } from './inspectStagedProfileSnapshot.js';
import type {
  ProfileInspectionContextReader,
  ProfileSnapshotValidationMetadata,
  ProfileRestoreActivationPreparationMetadata,
  ProfileSnapshotValidationService,
} from './profileSnapshotTypes.js';

// The existing broker keeps its contract until its isolated inspection caller
// replaces this adapter. The inspector itself never receives the active DB.
export class StagedProfileSnapshotValidationService
  implements ProfileSnapshotValidationService
{
  private readonly inspector: StagedProfileSnapshotInspector;

  constructor(
    private readonly dependencies: {
      activeContextReader: ProfileInspectionContextReader;
      migrationsDirectory: string;
      stagingRoot: string;
    },
  ) {
    this.inspector = new StagedProfileSnapshotInspector({
      databaseSource: { kind: 'stagedSnapshot' },
      migrationPolicy: 'restoreCompatible',
      migrationsDirectory: dependencies.migrationsDirectory,
      stagingRoot: dependencies.stagingRoot,
      // This is the existing business-broker adapter, not a utility fallback.
      // K2 removes it when the isolated caller and broker v10 are connected.
      databaseFactory: {
        openReadonly: path => new Database(toNamespacedPath(path), { readonly: true, fileMustExist: true }),
        openReference: () => new Database(':memory:'),
        schemaReferences: createMigrationSchemaReferences(() => new Database(':memory:')),
      },
    });
  }

  async validateProfileSnapshot(
    operationId: string,
  ): Promise<ProfileSnapshotValidationMetadata> {
    const { activeProfileId } = this.dependencies.activeContextReader
      .readProfileInspectionContext();
    try {
      const inspection = await this.inspector.inspectProfileSnapshot(operationId);
      return {
        ...inspection,
        activeProfileIsEmpty: this.dependencies.activeContextReader
          .readProfileInspectionContext().activeProfileIsEmpty,
        profileMatchesActive: inspection.profileId === activeProfileId,
      };
    } catch {
      throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    }
  }

  async prepareProfileRestoreActivation(
    operationId: string,
  ): Promise<ProfileRestoreActivationPreparationMetadata> {
    try {
      // Preserve active-profile admission until broker v10 owns the context.
      this.dependencies.activeContextReader.readProfileInspectionContext();
      return await this.inspector.prepareProfileRestoreActivation(operationId);
    } catch {
      throw new Error('PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED');
    }
  }
}
