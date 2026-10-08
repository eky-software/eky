import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInvoiceReadModelTestDatabase } from '../../testFixtures/invoiceReadModelTestFixtures.js';
import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { runMigrations } from './runMigrations.js';

export const migrationName = '039_add_invoice_content_revisions.sql';
export type Row = Record<string, string | number | null>;

const databases: DatabaseConnection[] = [];
const folders: string[] = [];
interface MigrationDirectories {
  before: string;
  after: string;
}

let directories: MigrationDirectories | undefined;

export function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'eky-invoice-revision-migration-'));
  folders.push(directory);
  return directory;
}

export function migrationDirectories(): MigrationDirectories {
  if (directories) {
    return directories;
  }

  const source = fileURLToPath(new URL('../migrations/', import.meta.url));
  const names = readdirSync(source)
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && name <= migrationName)
    .sort();
  if (names.length !== 39 || names[38] !== migrationName) {
    throw new Error('Expected the unchanged production migration chain 001..039');
  }
  const root = temporaryDirectory();
  const before = join(root, 'through-038');
  const after = join(root, 'through-039');
  mkdirSync(before);
  mkdirSync(after);
  // Bound this regression to 039 while copying the real SQL bytes unchanged.
  for (const name of names) {
    copyFileSync(join(source, name), join(after, name));
    if (name !== migrationName) {
      copyFileSync(join(source, name), join(before, name));
    }
  }
  directories = { before, after };
  return directories;
}

export async function historicalDatabase(): Promise<DatabaseConnection> {
  const database = await createInvoiceReadModelTestDatabase(migrationDirectories().before);
  databases.push(database);
  return database;
}

export function openDatabase(path: string): DatabaseConnection {
  const database = new Database(path);
  databases.push(database);
  database.pragma('foreign_keys = ON');
  return database;
}

export async function migrate(database: DatabaseConnection): Promise<void> {
  await runMigrations(database, { migrationsDirectory: migrationDirectories().after });
}

export function closeDatabases(): void {
  for (const database of databases.splice(0)) {
    if (database.open) {
      database.close();
    }
  }
}

export function removeDirectories(): void {
  closeDatabases();
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
  directories = undefined;
}

export function insert(
  database: DatabaseConnection,
  table: string,
  values: Row,
  replace = false,
): void {
  // Identifiers are fixed test inputs, including deliberate invalid columns.
  const names = Object.keys(values);
  database.prepare(
    `INSERT ${replace ? 'OR REPLACE ' : ''}INTO ${table} (${names.join(',')})
     VALUES (${names.map((name) => '@' + name).join(',')})`,
  )
    .run(values);
}

export function failMigrationHistoryWrite(database: DatabaseConnection): void {
  // Fail after the production SQL, without substituting a test migration.
  database.exec(
    `
    CREATE TRIGGER fail_revision_history BEFORE INSERT ON schema_migrations
    WHEN NEW.name = '${migrationName}'
    BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_HISTORY_FAILURE'); END;
  `,
  );
}

export function oldState(database: DatabaseConnection): Record<string, Row[]> {
  return Object.fromEntries(
    [
      'invoices',
      'invoice_lines',
      'invoice_documents',
      'invoice_delivery_events',
      'schema_migrations',
      'schema_migration_metadata',
    ].map((table) => [table, database.prepare<[], Row>(`SELECT * FROM ${table} ORDER BY 1`).all()]),
  );
}

export function snapshots(database: DatabaseConnection): Record<string, Row[]> {
  return Object.fromEntries(
    [
      'invoice_content_revisions',
      'invoice_revision_lines',
      'invoice_revision_vat_breakdown',
      'invoice_current_revisions',
    ].map((table) => [table, database.prepare<[], Row>(`SELECT * FROM ${table} ORDER BY 1,2,3`).all()]),
  );
}
