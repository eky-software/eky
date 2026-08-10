import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdtemp,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../connection/createDatabaseConnection.js';
import { runMigrations } from '../migration/runMigrations.js';

const ignoredCountComparisonTables = new Set([
  'schema_migration_metadata',
  'schema_migrations',
]);
const safeTableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SqliteUpgradeCopyVerification {
  foreignKeyCheckPassed: true;
  integrityCheckPassed: true;
  migrationCount: number;
  originalHashUnchanged: true;
  sqliteVersion: string;
  tableCount: number;
  totalRowCount: number;
  transactionRollbackPassed: true;
}

export async function verifySqliteUpgradeCopy(
  sourceDatabaseFilePath: string,
): Promise<SqliteUpgradeCopyVerification> {
  await assertSafeSourceDatabase(sourceDatabaseFilePath);
  const sourceHashBeforeCopy = await calculateFileSha256(
    sourceDatabaseFilePath,
  );
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'eky-sqlite-upgrade-copy-'),
  );
  const copiedDatabaseFilePath = join(
    temporaryDirectory,
    basename(sourceDatabaseFilePath),
  );

  try {
    await copyFile(sourceDatabaseFilePath, copiedDatabaseFilePath);
    await assertHashUnchanged(sourceDatabaseFilePath, sourceHashBeforeCopy);

    const database = createDatabaseConnection({
      databaseFilePath: copiedDatabaseFilePath,
    });
    let verification: Omit<
      SqliteUpgradeCopyVerification,
      'originalHashUnchanged'
    >;

    try {
      const rowCountsBeforeMigration = readTableRowCounts(database);
      await runMigrations(database);
      assertExistingRowCountsUnchanged(
        rowCountsBeforeMigration,
        readTableRowCounts(database),
      );
      verification = verifyOpenedDatabase(database);
    } finally {
      database.close();
    }

    const reopenedDatabase = createDatabaseConnection({
      databaseFilePath: copiedDatabaseFilePath,
    });
    try {
      assertIntegrity(reopenedDatabase);
      assertForeignKeys(reopenedDatabase);
    } finally {
      reopenedDatabase.close();
    }

    await assertHashUnchanged(sourceDatabaseFilePath, sourceHashBeforeCopy);

    return {
      ...verification,
      originalHashUnchanged: true,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function verifyOpenedDatabase(
  database: DatabaseConnection,
): Omit<SqliteUpgradeCopyVerification, 'originalHashUnchanged'> {
  assertIntegrity(database);
  assertForeignKeys(database);
  assertTransactionRollback(database);
  const tableRowCounts = readTableRowCounts(database);
  const sqliteVersionRow = database
    .prepare<[], { sqliteVersion: string }>(
      'SELECT sqlite_version() AS sqliteVersion',
    )
    .get();
  const migrationCount = tableRowCounts.get('schema_migrations');

  if (sqliteVersionRow === undefined || migrationCount === undefined) {
    throw new Error('SQLite runtime metadata could not be verified.');
  }

  return {
    foreignKeyCheckPassed: true,
    integrityCheckPassed: true,
    migrationCount,
    sqliteVersion: sqliteVersionRow.sqliteVersion,
    tableCount: tableRowCounts.size,
    totalRowCount: [...tableRowCounts.values()].reduce(
      (sum, rowCount) => sum + rowCount,
      0,
    ),
    transactionRollbackPassed: true,
  };
}

async function assertSafeSourceDatabase(
  sourceDatabaseFilePath: string,
): Promise<void> {
  if (!isAbsolute(sourceDatabaseFilePath)) {
    throw new Error('SQLite source path must be absolute.');
  }

  const sourceMetadata = await lstat(sourceDatabaseFilePath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error('SQLite source must be a regular non-symbolic file.');
  }

  for (const sidecarSuffix of ['-wal', '-shm']) {
    const sidecarPath = `${sourceDatabaseFilePath}${sidecarSuffix}`;
    const sidecarMetadata = await stat(sidecarPath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      },
    );

    if (sidecarMetadata !== undefined && sidecarMetadata.size > 0) {
      throw new Error(
        'SQLite source has an active sidecar; close the application before verification.',
      );
    }
  }
}

function assertIntegrity(database: DatabaseConnection): void {
  const integrityResult: unknown = database.pragma('integrity_check', {
    simple: true,
  });
  if (integrityResult !== 'ok') {
    throw new Error('SQLite copy integrity check failed.');
  }
}

function assertForeignKeys(database: DatabaseConnection): void {
  const foreignKeyRows = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyRows.length !== 0) {
    throw new Error('SQLite copy foreign key check failed.');
  }
}

function assertTransactionRollback(database: DatabaseConnection): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      CREATE TABLE eky_upgrade_compatibility_probe (
        value TEXT NOT NULL
      );
      INSERT INTO eky_upgrade_compatibility_probe (value)
      VALUES ('synthetic');
    `);
  } finally {
    database.exec('ROLLBACK');
  }

  const remainingProbe = database
    .prepare<[], { name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'eky_upgrade_compatibility_probe'
      `,
    )
    .get();
  if (remainingProbe !== undefined) {
    throw new Error('SQLite synthetic transaction did not roll back.');
  }
}

function readTableRowCounts(
  database: DatabaseConnection,
): ReadonlyMap<string, number> {
  const tableRows = database
    .prepare<[], { name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all();
  const counts = new Map<string, number>();

  for (const { name } of tableRows) {
    if (!safeTableNamePattern.test(name)) {
      throw new Error('SQLite copy contains an unsupported table name.');
    }
    const row = database
      .prepare<[], { count: number }>(
        `SELECT COUNT(*) AS count FROM "${name}"`,
      )
      .get();
    if (
      row === undefined ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0
    ) {
      throw new Error('SQLite table row count could not be verified.');
    }
    counts.set(name, row.count);
  }

  return counts;
}

function assertExistingRowCountsUnchanged(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): void {
  for (const [tableName, rowCount] of before) {
    if (ignoredCountComparisonTables.has(tableName)) {
      continue;
    }
    if (after.get(tableName) !== rowCount) {
      throw new Error('SQLite migration changed existing table row counts.');
    }
  }
}

async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function assertHashUnchanged(
  sourceDatabaseFilePath: string,
  expectedHash: string,
): Promise<void> {
  if ((await calculateFileSha256(sourceDatabaseFilePath)) !== expectedHash) {
    throw new Error('SQLite source changed during copy verification.');
  }
}
