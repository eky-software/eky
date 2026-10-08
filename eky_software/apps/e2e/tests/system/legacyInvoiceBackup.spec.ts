import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { readDecryptedBackupPayload } from '../../../desktop/src/profileBackup/container/backupContainerReader.js';
import { decryptBackupPayload } from '../../../desktop/src/profileBackup/container/decryptBackupPayload.js';
import { extractBackupPayload } from '../../../desktop/src/profileBackup/container/extractBackupPayload.js';
import { createLegacyInvoiceBackup } from '../../src/data/createLegacyInvoiceBackup.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { createRealPortableWorkspaceBackup, workspaceBackupMigrationsDirectory } from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

const password = 'Synthetic legacy backup fixture password, not a real secret';

test('SYS-LEGACY-BACKUP-FIXTURE-001 @critical @recovery preserves the actual 038 database and original PDF in an authenticated backup', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  mkdirSync(userDataPath);
  const priorMarker = process.env.EKY_E2E;
  process.env.EKY_E2E = '1';
  let passed = false;
  try {
    const fixture = await createLegacyInvoiceBackup({ runRoot, userDataPath, password });
    const sourcePdf = readFileSync(join(userDataPath, 'runtime/storage/invoices/legacy/original.pdf'));
    await expect(decryptBackupPayload({ containerPath: fixture.backupPath,
      password: 'wrong synthetic password', quarantinePath: join(runRoot, 'wrong.payload') })).rejects.toThrow();
    const quarantinePath = join(runRoot, 'authenticated.payload');
    await decryptBackupPayload({ containerPath: fixture.backupPath, password, quarantinePath });
    const parsed = await readDecryptedBackupPayload(quarantinePath);
    expect(parsed.manifest.profileId).toBe(fixture.profileId);
    expect(parsed.manifest.migrationChainIdentity).toBe(fixture.migrationChainIdentity);
    expect(parsed.entries.map(entry => entry.type).sort()).toEqual([
      'artifactCatalog', 'businessArtifact', 'database', 'manifest',
    ]);
    const pdfEntry = parsed.entries.find(entry => entry.type === 'businessArtifact');
    expect(pdfEntry?.sha256).toBe(fixture.pdfSha256);
    expect(pdfEntry?.contentLength).toBe(BigInt(sourcePdf.length));

    const operationRoot = join(runRoot, 'extracted');
    await extractBackupPayload({ operationRoot, parsedPayload: parsed, payloadPath: quarantinePath });
    const databasePath = join(operationRoot, 'profile.sqlite');
    const inspection = inspectSqliteProfileDatabase(databasePath,
      workspaceBackupMigrationsDirectory, 'restoreCompatible');
    expect(inspection.appliedMigrationNames).toHaveLength(38);
    expect(inspection.profileId).toBe(fixture.profileId);
    expect(inspection.migrationChainIdentity).toBe(fixture.migrationChainIdentity);
    expect(() => inspectSqliteProfileDatabase(databasePath, workspaceBackupMigrationsDirectory))
      .toThrow('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
    const database = createDatabaseConnection({ databaseFilePath: databasePath });
    try {
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'invoice_content_revisions'").get()).toBeUndefined();
      expect(database.prepare('SELECT invoice_id, document_id, status FROM invoice_delivery_events WHERE id = ?').get(fixture.eventId))
        .toEqual({ invoice_id: fixture.invoiceId, document_id: fixture.documentId, status: 'succeeded' });
      expect(database.prepare('SELECT status, invoice_number FROM invoices WHERE id = ?').get(fixture.invoiceId))
        .toEqual({ status: 'sent', invoice_number: fixture.invoiceNumber });
    } finally { database.close(); }
    expect(readFileSync(join(operationRoot, pdfEntry!.logicalPath))).toEqual(sourcePdf);
    const sourceDatabasePath = join(userDataPath, 'runtime/data/eky.sqlite');
    expect(inspectSqliteProfileDatabase(sourceDatabasePath, workspaceBackupMigrationsDirectory,
      'compatibleHistoricalPrefix').appliedMigrationNames).toHaveLength(38);

    // The ordinary helper must still reject old schemas without explicit admission.
    const rejectedBackup = join(userDataPath, 'must-not-exist.ekybackup');
    await expect(createRealPortableWorkspaceBackup({ backupPath: rejectedBackup,
      databaseFilePath: sourceDatabasePath, invoiceDocumentStorageRoot: join(userDataPath, 'runtime/storage/invoices'),
      password, stagingRoot: join(userDataPath, 'strict-staging') })).rejects.toThrow('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
    expect(existsSync(rejectedBackup)).toBe(false);
    const backupHash = createHash('sha256').update(readFileSync(fixture.backupPath)).digest('hex');
    await expect(createLegacyInvoiceBackup({ runRoot, userDataPath, password }))
      .rejects.toThrow('LEGACY_INVOICE_FIXTURE_ALREADY_EXISTS');
    expect(createHash('sha256').update(readFileSync(fixture.backupPath)).digest('hex')).toBe(backupHash);
    passed = true;
  } finally {
    if (priorMarker === undefined) delete process.env.EKY_E2E;
    else process.env.EKY_E2E = priorMarker;
    if (passed) await removeE2eRunRoot(runRoot);
  }
});

test('SYS-LEGACY-BACKUP-FIXTURE-002 @critical @security refuses preparation without the E2E marker before creating files', async () => {
  const runRoot = createE2eRunRoot();
  const priorMarker = process.env.EKY_E2E;
  delete process.env.EKY_E2E;
  let passed = false;
  try {
    await expect(createLegacyInvoiceBackup({ runRoot, userDataPath: join(runRoot, 'user-data'), password }))
      .rejects.toThrow('LEGACY_INVOICE_BACKUP_E2E_REQUIRED');
    expect(readdirSync(runRoot)).toEqual([]);
    passed = true;
  } finally {
    if (priorMarker !== undefined) process.env.EKY_E2E = priorMarker;
    if (passed) await removeE2eRunRoot(runRoot);
  }
});
