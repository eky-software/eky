import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { createMigrationChainIdentity, type MigrationManifestEntry } from './migrationManifest.js';
import { createMigrationMetadataTable, createMigrationTable } from './migrationMetadata.js';

export interface MigrationSchemaObject {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

export interface MigrationSchemaReferences {
  getTechnicalSchema(): readonly MigrationSchemaObject[];
  getSchemaReference(
    trustedPrefix: readonly MigrationManifestEntry[],
    withMetadata: boolean,
  ): readonly MigrationSchemaObject[];
}

export function createMigrationSchemaReferences(
  openReference: () => DatabaseConnection,
): MigrationSchemaReferences {
  if (typeof openReference !== 'function') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  let technicalSchema: readonly MigrationSchemaObject[] | undefined;
  let cachedReference: {
    identity: string;
    withMetadata: boolean;
    objects: readonly MigrationSchemaObject[];
  } | undefined;
  return Object.freeze({
    getTechnicalSchema() {
      technicalSchema ??= buildReference([], true, openReference);
      return technicalSchema;
    },
    getSchemaReference(trustedPrefix: readonly MigrationManifestEntry[], withMetadata: boolean) {
      const identity = createMigrationChainIdentity(trustedPrefix);
      if (cachedReference?.identity === identity && cachedReference.withMetadata === withMetadata) {
        return cachedReference.objects;
      }
      const objects = buildReference(trustedPrefix, withMetadata, openReference);
      // One reference per driver owner; never share a default-driver cache with an inspector.
      cachedReference = { identity, withMetadata, objects };
      return objects;
    },
  });
}

const businessReferences = createMigrationSchemaReferences(() => new Database(':memory:'));

export function getMigrationTechnicalSchema(): readonly MigrationSchemaObject[] {
  return businessReferences.getTechnicalSchema();
}

export function getMigrationSchemaReference(
  trustedPrefix: readonly MigrationManifestEntry[],
  withMetadata: boolean,
): readonly MigrationSchemaObject[] {
  return businessReferences.getSchemaReference(trustedPrefix, withMetadata);
}

function buildReference(
  trustedPrefix: readonly MigrationManifestEntry[],
  withMetadata: boolean,
  openReference: () => DatabaseConnection,
): readonly MigrationSchemaObject[] {
  const reference = openReference();
  try {
    reference.pragma('foreign_keys = ON');
    createMigrationTable(reference);
    if (withMetadata) createMigrationMetadataTable(reference);
    for (const entry of trustedPrefix) {
      reference.transaction(() => reference.exec(entry.content.toString('utf8')))();
    }
    return Object.freeze(reference
      .prepare<[], MigrationSchemaObject>('SELECT type, name, tbl_name, sql FROM main.sqlite_schema')
      .all()
      .map(row => Object.freeze(row)));
  } finally {
    reference.close();
  }
}
