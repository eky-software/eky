import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { runPackagedSmoke } from '../../../desktop/scripts/run-packaged-smoke.mjs';
import { legacyPackagedSmokePassword, parseLegacyPackagedSmokeIdentity } from '../../../desktop/src/profileBackup/packagedLegacyProfileSmoke.js';
import { readSmokeState, writeSmokeState } from '../../../desktop/src/profileBackup/packagedProfileBackupSmoke.js';
import { prepareLegacyInvoicePackagedSmoke } from '../../src/data/prepareLegacyInvoicePackagedSmoke.js';
import { assertLegacyInvoiceRecoveryPreserved, readLegacyInvoiceRecoverySnapshot,
  type LegacyInvoiceRecoverySnapshot } from '../../src/data/legacyInvoiceRecoveryComparison.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { workspaceBackupMigrationsDirectory } from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

test('DESK-LEGACY-PACKAGED-RESTORE-001 restores the original 038 backup through the hardened workspace runtime', async () => {
  if (process.platform !== 'win32') throw new Error('PACKAGED_LEGACY_REQUIRES_WINDOWS');
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  mkdirSync(userDataPath);
  const previous = process.env.EKY_E2E;
  process.env.EKY_E2E = '1';
  let passed = false;
  let prepared: Awaited<ReturnType<typeof prepareLegacyInvoicePackagedSmoke>> | undefined;
  let sourceHashes: readonly string[] = [];
  let sourceContent: LegacyInvoiceRecoverySnapshot | undefined;
  const sourcePaths = [join(userDataPath, 'runtime/data/eky.sqlite'),
    join(userDataPath, 'runtime/storage/invoices/legacy/original.pdf'),
    join(userDataPath, 'legacy-invoice.ekybackup')];
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  try {
    await runPackagedSmoke({ legacyPreparation: {
      async prepare({ smokeToken, smokeRootDirectory }) {
        prepared = await prepareLegacyInvoicePackagedSmoke({ runRoot, userDataPath,
          password: legacyPackagedSmokePassword, smokeToken });
        expect(prepared.smokeRoot).toBe(smokeRootDirectory);
        const { invoiceId, invoiceNumber, eventId, pdfSha256, profileId } = prepared.fixture;
        const identity = parseLegacyPackagedSmokeIdentity({ formatVersion: 1,
          invoiceId, invoiceNumber, eventId, pdfSha256, profileId });
        writeFileSync(join(smokeRootDirectory, 'legacy-input/identity.json'), JSON.stringify(identity),
          { flag: 'wx', mode: 0o600 });
        sourceHashes = sourcePaths.map(hash);
        sourceContent = readLegacyInvoiceRecoverySnapshot(sourcePaths[0]!);
      },
      async afterRestoreExit({ smokeRootDirectory }) {
        if (prepared === undefined || sourceContent === undefined) throw new Error('PACKAGED_LEGACY_PREPARATION_MISSING');
        const active = readElectronE2eActiveWorkspace(join(smokeRootDirectory, 'user-data'));
        expect(active.profileId).toBe(prepared.fixture.profileId);
        const inspection = inspectSqliteProfileDatabase(active.databaseFilePath, workspaceBackupMigrationsDirectory);
        expect(inspection.appliedMigrationNames).toHaveLength(39);
        expect(inspection.profileId).toBe(prepared.fixture.profileId);
        assertLegacyInvoiceRecoveryPreserved(sourceContent, readLegacyInvoiceRecoverySnapshot(active.databaseFilePath));
        // The replacement candidate has already migrated under the real owner.
        // Bind its closed bytes before the next backend opens this database.
        const state = await readSmokeState(smokeRootDirectory);
        expect(state.expectedEntries.filter(entry => entry.type === 'database')).toHaveLength(1);
        const info = lstatSync(active.databaseFilePath);
        expect(info.isFile() && !info.isSymbolicLink() && info.nlink === 1).toBe(true);
        await writeSmokeState(smokeRootDirectory, { ...state,
          expectedEntries: state.expectedEntries.map(entry => entry.type === 'database'
            ? { ...entry, sha256: hash(active.databaseFilePath), contentLength: String(info.size) } : entry) });
      },
      async verifySourcePreserved() {
        expect(sourcePaths.map(hash)).toEqual(sourceHashes);
        expect(inspectSqliteProfileDatabase(sourcePaths[0]!, workspaceBackupMigrationsDirectory,
          'compatibleHistoricalPrefix').appliedMigrationNames).toHaveLength(38);
      },
    } });
    passed = true;
  } finally {
    if (previous === undefined) delete process.env.EKY_E2E;
    else process.env.EKY_E2E = previous;
    if (passed) await removeE2eRunRoot(runRoot);
  }
});
