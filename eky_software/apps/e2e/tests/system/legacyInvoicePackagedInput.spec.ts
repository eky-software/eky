import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { prepareLegacyInvoicePackagedSmoke } from '../../src/data/prepareLegacyInvoicePackagedSmoke.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { workspaceBackupMigrationsDirectory } from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

const password = 'Synthetic legacy packaged fixture password, not a real secret';

test('SYS-LEGACY-PACKAGED-INPUT-001 @critical @recovery seeds independent historical bytes without registry or migration', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  mkdirSync(userDataPath);
  const smokeToken = randomBytes(16).toString('hex');
  const smokeRoot = join(realpathSync(tmpdir()), 'eky-desktop-smoke', smokeToken);
  const previous = process.env.EKY_E2E;
  process.env.EKY_E2E = '1';
  let passed = false;
  try {
    const prepared = await prepareLegacyInvoicePackagedSmoke({ runRoot, userDataPath, password, smokeToken });
    expect(prepared.smokeRoot).toBe(smokeRoot);
    expect(prepared.files.map(file => file.relativePath)).toEqual([
      'user-data/runtime/data/eky.sqlite',
      'user-data/runtime/storage/invoices/legacy/original.pdf',
      'legacy-input/original.ekybackup',
    ]);
    expect(readdirSync(smokeRoot).sort()).toEqual(['legacy-input', 'user-data']);
    expect(readdirSync(join(smokeRoot, 'user-data'))).toEqual(['runtime']);
    const sourceDatabase = join(userDataPath, 'runtime/data/eky.sqlite');
    const seededDatabase = join(smokeRoot, 'user-data/runtime/data/eky.sqlite');
    for (const path of [sourceDatabase, seededDatabase]) {
      const inspection = inspectSqliteProfileDatabase(path, workspaceBackupMigrationsDirectory, 'compatibleHistoricalPrefix');
      expect(inspection.appliedMigrationNames).toHaveLength(38);
      expect(inspection.profileId).toBe(prepared.fixture.profileId);
      expect(inspection.migrationChainIdentity).toBe(prepared.fixture.migrationChainIdentity);
    }
    expect(readFileSync(seededDatabase)).toEqual(readFileSync(sourceDatabase));
    expect(readFileSync(join(smokeRoot, 'legacy-input/original.ekybackup')))
      .toEqual(readFileSync(prepared.fixture.backupPath));
    const sourcePdf = join(userDataPath, 'runtime/storage/invoices/legacy/original.pdf');
    const seededPdf = join(smokeRoot, 'user-data/runtime/storage/invoices/legacy/original.pdf');
    expect(readFileSync(seededPdf)).toEqual(readFileSync(sourcePdf));
    const originalPdf = readFileSync(sourcePdf);
    const originalDatabase = readFileSync(sourceDatabase);
    const database = createDatabaseConnection({ databaseFilePath: seededDatabase });
    try {
      await runMigrations(database);
      expect(database.prepare('SELECT name FROM schema_migrations').all()).toHaveLength(39);
      expect(database.prepare('SELECT binding_kind, revision_id, send_mode FROM invoice_delivery_events WHERE id = ?')
        .get(prepared.fixture.eventId)).toEqual({ binding_kind: 'legacyOriginal', revision_id: null, send_mode: 'legacyUnknown' });
    } finally { database.close(); }
    expect(readFileSync(sourceDatabase)).toEqual(originalDatabase);
    expect(inspectSqliteProfileDatabase(sourceDatabase, workspaceBackupMigrationsDirectory,
      'compatibleHistoricalPrefix').appliedMigrationNames).toHaveLength(38);
    expect(readFileSync(seededPdf)).toEqual(originalPdf);
    writeFileSync(seededPdf, 'synthetic destination mutation');
    expect(readFileSync(sourcePdf)).toEqual(originalPdf);
    writeFileSync(seededDatabase, 'synthetic destination mutation');
    expect(readFileSync(sourceDatabase)).toEqual(originalDatabase);
    const originalBackup = readFileSync(prepared.fixture.backupPath);
    // The container writer seals the original read-only; copyFile preserves
    // that attribute on Windows. Mutate only this disposable destination.
    chmodSync(join(smokeRoot, 'legacy-input/original.ekybackup'), 0o600);
    writeFileSync(join(smokeRoot, 'legacy-input/original.ekybackup'), 'synthetic destination mutation');
    expect(readFileSync(prepared.fixture.backupPath)).toEqual(originalBackup);

    const secondInput = join(runRoot, 'second-input');
    mkdirSync(secondInput);
    await expect(prepareLegacyInvoicePackagedSmoke({ runRoot, userDataPath: secondInput, password, smokeToken }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(readdirSync(secondInput)).toEqual([]);
    expect(readFileSync(seededPdf, 'utf8')).toBe('synthetic destination mutation');
    passed = true;
  } finally {
    if (previous === undefined) delete process.env.EKY_E2E;
    else process.env.EKY_E2E = previous;
    if (passed) {
      await rm(smokeRoot, { recursive: true });
      await removeE2eRunRoot(runRoot);
    }
  }
});

test('SYS-LEGACY-PACKAGED-INPUT-003 @critical @security refuses a linked destination without touching its target', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  const otherPath = join(runRoot, 'link-target');
  mkdirSync(userDataPath);
  mkdirSync(otherPath);
  const previous = process.env.EKY_E2E;
  process.env.EKY_E2E = '1';
  const smokeToken = randomBytes(16).toString('hex');
  const smokeBase = join(realpathSync(tmpdir()), 'eky-desktop-smoke');
  mkdirSync(smokeBase, { recursive: true });
  const smokeRoot = join(smokeBase, smokeToken);
  let passed = false;
  try {
    symlinkSync(otherPath, smokeRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepareLegacyInvoicePackagedSmoke({ runRoot, userDataPath, password, smokeToken }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(readdirSync(userDataPath)).toEqual([]);
    expect(readdirSync(otherPath)).toEqual([]);
    passed = true;
  } finally {
    if (previous === undefined) delete process.env.EKY_E2E;
    else process.env.EKY_E2E = previous;
    if (passed) {
      unlinkSync(smokeRoot);
      await removeE2eRunRoot(runRoot);
    }
  }
});

test('SYS-LEGACY-PACKAGED-INPUT-002 @critical @security refuses missing marker and noncanonical token before fixture writes', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  mkdirSync(userDataPath);
  const previous = process.env.EKY_E2E;
  const smokeToken = randomBytes(16).toString('hex');
  const smokeRoot = join(realpathSync(tmpdir()), 'eky-desktop-smoke', smokeToken);
  let passed = false;
  try {
    delete process.env.EKY_E2E;
    await expect(prepareLegacyInvoicePackagedSmoke({ runRoot, userDataPath, password, smokeToken }))
      .rejects.toThrow('LEGACY_PACKAGED_SMOKE_ADMISSION_FAILED');
    process.env.EKY_E2E = '1';
    for (const invalidToken of ['', '../escape', 'A'.repeat(32), `${smokeToken}/child`]) {
      await expect(prepareLegacyInvoicePackagedSmoke({ runRoot, userDataPath, password, smokeToken: invalidToken }))
        .rejects.toThrow('LEGACY_PACKAGED_SMOKE_ADMISSION_FAILED');
    }
    expect(existsSync(smokeRoot)).toBe(false);
    expect(readdirSync(userDataPath)).toEqual([]);
    passed = true;
  } finally {
    if (previous === undefined) delete process.env.EKY_E2E;
    else process.env.EKY_E2E = previous;
    if (passed) await removeE2eRunRoot(runRoot);
  }
});
