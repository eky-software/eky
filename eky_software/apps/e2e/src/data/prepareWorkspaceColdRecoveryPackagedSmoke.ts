import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { createDesktopProfilePaths } from '../../../desktop/src/runtime/desktopProfilePaths.js';
import { acquireWorkspaceProcessReservation } from '../../../desktop/src/runtime/workspaceProcessReservation.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../../../desktop/src/workspaces/creation/workspaceCreationJournalPaths.js';
import { serializeWorkspaceCreationJournal } from '../../../desktop/src/workspaces/creation/workspaceCreationJournalSerializer.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../../../desktop/src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from '../../../desktop/src/workspaces/import/workspaceBackupImportJournalSerializer.js';
import { deriveWorkspaceRoot } from '../../../desktop/src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceIdValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../../../desktop/src/workspaces/registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistryEntryV1, LocalWorkspaceRegistryV1 } from '../../../desktop/src/workspaces/registry/workspaceRegistryTypes.js';
import { workspaceBackupMigrationsDirectory, workspaceBackupTestAppVersion } from '../workspaces/workspaceBackupSystemTestSupport.js';
import { createLegacyInvoiceProfile } from './createLegacyInvoiceProfile.js';

/** Closed synthetic rootPublished input; only the packaged application performs recovery. */
export async function prepareWorkspaceColdRecoveryPackagedSmoke(input: {
  readonly kind: 'creation' | 'import';
  readonly runRoot: string;
  readonly smokeToken: string;
}) {
  if (process.env.EKY_E2E !== '1' || !/^[a-f0-9]{32}$/.test(input.smokeToken)
    || (input.kind !== 'creation' && input.kind !== 'import')) {
    throw new Error('WORKSPACE_COLD_PACKAGED_ADMISSION_FAILED');
  }
  const runBase = await realpath(join(tmpdir(), 'eky-e2e'));
  const runRelative = relative(runBase, await realpath(input.runRoot));
  const runInfo = await lstat(input.runRoot);
  if (dirname(runRelative) !== '.' || !basename(runRelative).startsWith('run-')
    || !runInfo.isDirectory() || runInfo.isSymbolicLink()) {
    throw new Error('WORKSPACE_COLD_PACKAGED_ROOT_INVALID');
  }
  const smokeBase = join(await realpath(tmpdir()), 'eky-desktop-smoke');
  await mkdir(smokeBase, { recursive: true, mode: 0o700 });
  const baseInfo = await lstat(smokeBase);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error('WORKSPACE_COLD_PACKAGED_ROOT_INVALID');
  const smokeRoot = join(smokeBase, input.smokeToken);
  await mkdir(smokeRoot, { mode: 0o700 });
  const userDataRoot = join(smokeRoot, 'user-data');
  await mkdir(userDataRoot, { mode: 0o700 });
  const reservation = await acquireWorkspaceProcessReservation({ userDataRoot, signal: AbortSignal.timeout(5_000) });
  let firstError: unknown;
  try {
    const original = await createEmptyWorkspace(userDataRoot, 'Synthetic active workspace');
    const target = await createEmptyWorkspace(userDataRoot, 'Synthetic interrupted workspace');
    const targetPaths = createDesktopProfilePaths(deriveWorkspaceRoot(userDataRoot, target.workspaceId, 1).workspaceRoot);
    const preservedPaths = [targetPaths.databaseFilePath];
    let targetEntry = target;
    if (input.kind === 'import') {
      const sourceRoot = join(input.runRoot, 'import-source');
      await mkdir(sourceRoot, { mode: 0o700 });
      await createLegacyInvoiceProfile({ runRoot: input.runRoot, userDataPath: sourceRoot });
      const source = createDesktopProfilePaths(sourceRoot);
      await migrate(source.databaseFilePath);
      // The destination database is a closed empty fixture, not an active runtime.
      await copyFile(source.databaseFilePath, targetPaths.databaseFilePath);
      const sourcePdf = join(source.invoiceDocumentStorageRoot, 'legacy/original.pdf');
      const targetPdf = join(targetPaths.invoiceDocumentStorageRoot, 'legacy/original.pdf');
      await mkdir(dirname(targetPdf), { mode: 0o700 });
      await copyFile(sourcePdf, targetPdf, constants.COPYFILE_EXCL);
      preservedPaths.push(targetPdf, source.databaseFilePath, sourcePdf);
      targetEntry = { ...target, lineageIdentity: { formatVersion: 1,
        profileId: inspectSqliteProfileDatabase(targetPaths.databaseFilePath, workspaceBackupMigrationsDirectory).profileId } };
    }
    const registry = new WorkspaceRegistryStore({ installationRoot: userDataRoot,
      filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) });
    const initialRegistry: LocalWorkspaceRegistryV1 = { formatVersion: 1,
      activeWorkspaceId: original.workspaceId, workspaces: [original] };
    await registry.write(initialRegistry);
    const journal = { formatVersion: 2, operationId: randomUUID(), workspaceId: targetEntry.workspaceId,
      workspaceLabel: targetEntry.workspaceLabel, previousActiveWorkspaceId: original.workspaceId,
      state: 'rootPublished', createdAt: targetEntry.createdAt, lineageIdentity: targetEntry.lineageIdentity };
    const journalPaths = input.kind === 'creation'
      ? createWorkspaceCreationJournalPaths(userDataRoot, join(userDataRoot, WORKSPACE_CREATION_JOURNAL_FILE_NAME))
      : createWorkspaceBackupImportJournalPaths(userDataRoot, join(userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
    await writeFile(journalPaths.currentPath, input.kind === 'creation'
      ? serializeWorkspaceCreationJournal(journal) : serializeWorkspaceBackupImportJournal(journal), { flag: 'wx', mode: 0o600 });
    const expectedRegistry: LocalWorkspaceRegistryV1 = { ...initialRegistry, workspaces: [original, targetEntry] };
    const before = await Promise.all(preservedPaths.map(readIndependentFile));
    await reservation.assertOwned();
    return {
      smokeRoot, userDataRoot, expectedRegistry, journalPaths,
      async verifyRecovered() {
        // Store reads can repair slots. Acquire the actual exclusion before inspection.
        const verificationOwner = await acquireWorkspaceProcessReservation({ userDataRoot, signal: AbortSignal.timeout(5_000) });
        let verificationError: unknown;
        try {
          for (const path of [journalPaths.currentPath, journalPaths.nextPath, journalPaths.backupPath]) {
            try { await lstat(path); }
            catch (error) {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
              throw error;
            }
            throw new Error('WORKSPACE_COLD_PACKAGED_JOURNAL_REMAINS');
          }
          if (!isDeepStrictEqual(await registry.read(), expectedRegistry)) throw new Error('WORKSPACE_COLD_PACKAGED_REGISTRY_MISMATCH');
          const after = await Promise.all(preservedPaths.map(readIndependentFile));
          if (!before.every((bytes, index) => bytes.equals(after[index]!))) throw new Error('WORKSPACE_COLD_PACKAGED_CONTENT_CHANGED');
          await verificationOwner.assertOwned();
        } catch (error) { verificationError = error; throw error; }
        finally {
          try { await verificationOwner.release(); }
          catch (cleanupError) {
            throw new AggregateError([verificationError, cleanupError], 'WORKSPACE_COLD_PACKAGED_CLEANUP_FAILED', { cause: verificationError ?? cleanupError });
          }
        }
      },
    };
  } catch (error) { firstError = error; throw error; }
  finally {
    try { await reservation.release(); }
    catch (cleanupError) {
      throw new AggregateError([firstError, cleanupError], 'WORKSPACE_COLD_PACKAGED_CLEANUP_FAILED', { cause: firstError ?? cleanupError });
    }
  }
}

async function createEmptyWorkspace(root: string, workspaceLabel: string): Promise<LocalWorkspaceRegistryEntryV1> {
  const workspaceId = validateWorkspaceId(randomUUID());
  const paths = createDesktopProfilePaths(deriveWorkspaceRoot(root, workspaceId, 1).workspaceRoot);
  await mkdir(paths.invoiceDocumentStorageRoot, { recursive: true, mode: 0o700 });
  await migrate(paths.databaseFilePath);
  return { workspaceId, workspaceLabel, layoutVersion: 1, lifecycleState: 'ready',
    lineageIdentity: { formatVersion: 1,
      profileId: inspectSqliteProfileDatabase(paths.databaseFilePath, workspaceBackupMigrationsDirectory).profileId },
    createdAt: '2026-08-21T00:01:00.000Z' };
}

async function migrate(databaseFilePath: string) {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    await runMigrations(database, { migrationsDirectory: workspaceBackupMigrationsDirectory,
      releaseIdentity: { appVersion: workspaceBackupTestAppVersion, buildRevision: '3'.repeat(40) } });
  } finally { database.close(); }
}

async function readIndependentFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size === 0) {
    throw new Error('WORKSPACE_COLD_PACKAGED_FILE_INVALID');
  }
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('WORKSPACE_COLD_PACKAGED_FILE_CHANGED');
  return bytes;
}
