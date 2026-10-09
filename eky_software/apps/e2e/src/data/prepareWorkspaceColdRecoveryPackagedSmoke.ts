import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { prepareWorkspaceColdRecoveryRegistry } from '../../../desktop/e2e/workspaceColdRecoveryPackagedFixture.js';
import { createDesktopProfilePaths } from '../../../desktop/src/runtime/desktopProfilePaths.js';
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
  const prepared = await prepareWorkspaceColdRecoveryRegistry({
    kind: input.kind, userDataRoot,
    async prepareProfile({ paths, role }) {
      await migrate(paths.databaseFilePath);
      const preservedPaths = role === 'target' ? [paths.databaseFilePath] : [];
      if (role === 'target' && input.kind === 'import') {
        const sourceRoot = join(input.runRoot, 'import-source');
        await mkdir(sourceRoot, { mode: 0o700 });
        await createLegacyInvoiceProfile({ runRoot: input.runRoot, userDataPath: sourceRoot });
        const source = createDesktopProfilePaths(sourceRoot);
        await migrate(source.databaseFilePath);
        // The destination database is a closed empty fixture, not an active runtime.
        await copyFile(source.databaseFilePath, paths.databaseFilePath);
        const sourcePdf = join(source.invoiceDocumentStorageRoot, 'legacy/original.pdf');
        const targetPdf = join(paths.invoiceDocumentStorageRoot, 'legacy/original.pdf');
        await mkdir(dirname(targetPdf), { mode: 0o700 });
        await copyFile(sourcePdf, targetPdf, constants.COPYFILE_EXCL);
        preservedPaths.push(targetPdf, source.databaseFilePath, sourcePdf);
      }
      return { preservedPaths,
        profileId: inspectSqliteProfileDatabase(paths.databaseFilePath, workspaceBackupMigrationsDirectory).profileId };
    },
  });
  return { smokeRoot, userDataRoot, ...prepared };
}

async function migrate(databaseFilePath: string) {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    await runMigrations(database, { migrationsDirectory: workspaceBackupMigrationsDirectory,
      releaseIdentity: { appVersion: workspaceBackupTestAppVersion, buildRevision: '3'.repeat(40) } });
  } finally { database.close(); }
}
