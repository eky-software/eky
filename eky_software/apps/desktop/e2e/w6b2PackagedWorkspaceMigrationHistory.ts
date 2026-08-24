import { DatabaseSync } from 'node:sqlite';

import type { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import type { W6b2PackagedWorkspaceFixture } from './w6b2PackagedWorkspaceFixtures.js';
import {
  inspectWorkspaceFirstStartProofFixture,
  snapshotWorkspaceFirstStartProofBusinessData,
  type WorkspaceFirstStartProofBusinessSnapshot,
} from './workspaceFirstStartMigrationProofFixtures.js';

export async function invalidateW6b2PackagedWorkspaceMigrationHistory(input: {
  readonly fixture: Readonly<W6b2PackagedWorkspaceFixture>;
  readonly targetFactory: ElectronWorkspaceCandidateRuntimeFactory;
}): Promise<void> {
  const businessBefore =
    await snapshotWorkspaceFirstStartProofBusinessData(input.fixture);
  invalidateW6b2MigrationHistoryDatabase(input.fixture.databaseFilePath);
  const businessAfter =
    await snapshotWorkspaceFirstStartProofBusinessData(input.fixture);
  if (!businessSnapshotsEqual(businessBefore, businessAfter)) {
    throw new Error('W6B2_INVALID_HISTORY_CHANGED_BUSINESS_DATA');
  }
  const inspection = await inspectWorkspaceFirstStartProofFixture(
    input.targetFactory,
    input.fixture,
  );
  if (inspection.status !== 'invalidHistory') {
    throw new Error('W6B2_INVALID_HISTORY_NOT_DETECTED');
  }
}

export function invalidateW6b2MigrationHistoryDatabase(
  databaseFilePath: string,
): void {
  const database = new DatabaseSync(databaseFilePath);
  let transactionStarted = false;
  try {
    database.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
    transactionStarted = true;
    const result = database
      .prepare(
        `
          UPDATE schema_migration_metadata
          SET source_sha256 = ?
          WHERE migration_name = (
            SELECT MIN(name)
            FROM schema_migrations
          )
          AND source_sha256 <> ?
        `,
      )
      .run('b'.repeat(64), 'b'.repeat(64));
    if (Number(result.changes) !== 1) {
      throw new Error('W6B2_MIGRATION_HISTORY_NOT_CHANGED');
    }
    requireHealthySqliteDatabase(database);
    database.exec('COMMIT;');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) database.exec('ROLLBACK;');
    throw error;
  } finally {
    database.close();
  }
}

function requireHealthySqliteDatabase(database: DatabaseSync): void {
  const integrityRows = database
    .prepare('PRAGMA integrity_check;')
    .all() as readonly Record<string, unknown>[];
  const integrityResult = integrityRows[0]
    ? Object.values(integrityRows[0])[0]
    : undefined;
  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check;').all();
  if (
    integrityRows.length !== 1 ||
    integrityResult !== 'ok' ||
    foreignKeyRows.length !== 0
  ) {
    throw new Error('W6B2_SQLITE_PROFILE_INVALID');
  }
}

function businessSnapshotsEqual(
  first: Readonly<WorkspaceFirstStartProofBusinessSnapshot>,
  second: Readonly<WorkspaceFirstStartProofBusinessSnapshot>,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}
