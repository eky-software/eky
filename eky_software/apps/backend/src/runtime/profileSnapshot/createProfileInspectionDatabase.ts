import { isAbsolute, toNamespacedPath } from 'node:path';

import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { inspectProfileInspectionNativeResource } from '../../database/connection/inspectProfileInspectionNativeResource.js';
import { createMigrationSchemaReferences, type MigrationSchemaReferences } from '../../database/migration/migrationSchemaReference.js';
import { configureProfileInspectionConnection, initializeProfileInspectionSqliteBudget } from './profileInspectionSqlite.js';
import { profileInspectionSqliteError } from './profileInspectionSqliteError.js';

export interface ProfileInspectionDatabaseFactory {
  openReadonly(databasePath: string): DatabaseConnection;
  openReference(): DatabaseConnection;
  readonly schemaReferences: MigrationSchemaReferences;
}

// Only the short-lived inspection process may create this factory. The resource
// path comes from its fixed, main-owned deployment, not an inspection request.
export async function createProfileInspectionDatabaseFactory(
  resourceRoot: string,
): Promise<ProfileInspectionDatabaseFactory> {
  const resource = await inspectProfileInspectionNativeResource(resourceRoot);
  // The addon's CommonJS loader requires a canonical absolute module path.
  // SQLite filenames still use Windows namespaced paths for long-path support.
  const nativeBinding = resource.nativeBinding;
  const openReference = () => {
    try { return new Database(':memory:', { nativeBinding }); }
    catch (error) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID', { cause: profileInspectionSqliteError(error) });
    }
  };
  const control = openReference();
  try {
    const sourceId = control.prepare<[], { id: string }>('SELECT sqlite_source_id() AS id').get()?.id;
    const options = control.pragma('compile_options') as { compile_options: string }[];
    if (sourceId !== resource.metadata.sqliteSourceId ||
        JSON.stringify(options.map(row => row.compile_options).sort()) !==
          JSON.stringify(resource.metadata.compileOptions)) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
  } finally { control.close(); }
  initializeProfileInspectionSqliteBudget(openReference);
  return Object.freeze({
    openReference,
    schemaReferences: createMigrationSchemaReferences(openReference),
    openReadonly(databasePath: string) {
      if (!isAbsolute(databasePath)) throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
      let database: DatabaseConnection;
      try {
        database = new Database(toNamespacedPath(databasePath), { fileMustExist: true, readonly: true, nativeBinding });
      } catch (error) {
        const failure = profileInspectionSqliteError(error);
        if (failure !== error) throw failure;
        throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID', { cause: error });
      }
      try {
        configureProfileInspectionConnection(database);
        return database;
      } catch (error) {
        const failure = profileInspectionSqliteError(error);
        try { database.close(); }
        catch (cleanupError) {
          throw new AggregateError([failure, cleanupError], 'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED');
        }
        throw failure;
      }
    },
  });
}
