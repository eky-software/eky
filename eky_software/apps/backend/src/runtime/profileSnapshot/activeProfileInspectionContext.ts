import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { isActiveProfileRestoreTargetEmpty } from './inspectActiveProfileRestoreTarget.js';
import { createProfileBackupIdentity } from './inspectSqliteProfileDatabase.js';
import type { ProfileInspectionContextReader } from './profileSnapshotTypes.js';

/** Reads only the already admitted active connection, never imported staging. */
export function createActiveProfileInspectionContextReader(
  database: DatabaseConnection,
): ProfileInspectionContextReader {
  return Object.freeze({
    readProfileInspectionContext() {
      const identity = readLocalRuntimeIdentity(database);
      return Object.freeze({
        activeProfileId: createProfileBackupIdentity(identity.companyId),
        activeProfileIsEmpty: isActiveProfileRestoreTargetEmpty(database),
      });
    },
  });
}
