import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../database/connection/createDatabaseConnection.js';
import { readMigrationManifest } from '../database/migration/migrationManifest.js';
import { resolveMigrationsDirectory } from '../database/migration/runMigrations.js';
import { createInvoiceReadModelTestDatabase } from '../testFixtures/invoiceReadModelTestFixtures.js';
import { ProfileMaintenanceState } from '../runtime/profileMaintenance/profileMaintenanceState.js';
import { inspectSqliteProfileDatabase } from '../runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import type { ProfileSnapshotRuntimeService } from '../runtime/profileSnapshot/profileSnapshotTypes.js';
import { createApp } from './app.js';
import { insertBoundHistoryEvent } from '../modules/invoicing/infrastructure/invoiceEventPdfRead.fixture.js';
import {
  closePublicationDatabases, createPublicationFixture, documentCandidate,
  nextPublicationRevision, openPublicationDatabase, publicationState,
} from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';

const roots: string[] = [];
const databases: connections.DatabaseConnection[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  closePublicationDatabases();
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('profile snapshot catalog schema composition', () => {
  it('registers on an empty database without reading a catalog and preserves the startup message', async () => {
    const f = await fixture();
    let registered = false;
    await expect(createApp({
      ...f.options,
      profileSnapshotServiceRegistration: {
        stagingRoot: f.stagingRoot,
        register: () => { registered = true; },
      },
      beforeMigrations: async (inspection) => {
        expect(registered).toBe(true);
        expect(inspection).toEqual({
          appliedMigrationCount: 0, migrationChainIdentity: '',
          pendingMigrationCount: readMigrationManifest(f.migrationsDirectory).length,
          profileState: 'empty',
        });
        throw new Error('synthetic startup stop');
      },
    })).rejects.toThrow('Database migration startup gate could not be completed.');
  });

  it.each(['short', 'long'] as const)('uses the checked historical schema before migration and the current schema afterwards (%s staging path)', async (stagingPath) => {
    const f = await fixture(stagingPath === 'long');
    const historicalDirectory = join(f.root, 'historical');
    await mkdir(historicalDirectory);
    const manifest = readMigrationManifest(f.migrationsDirectory);
    for (const entry of manifest.slice(0, 38)) {
      await writeFile(join(historicalDirectory, entry.fileName), entry.content);
    }
    const source = await createInvoiceReadModelTestDatabase(historicalDirectory);
    const bytes = Buffer.from('%PDF-1.7\nSynthetic preserved legacy PDF\n');
    const storagePath = 'legacy/original.pdf';
    await mkdir(join(f.options.invoiceDocumentStorageRoot, 'legacy'));
    await writeFile(join(f.options.invoiceDocumentStorageRoot, storagePath), bytes);
    try {
      source.prepare('UPDATE local_runtime_identity SET company_id = ?').run('dev-company');
      source.prepare(`
        INSERT INTO invoice_documents (
          id, company_id, invoice_id, document_type, file_name, storage_path,
          mime_type, sha256, size_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('legacy-doc', 'dev-company', 'invoice-1', 'approved_invoice_pdf',
        'Original.pdf', storagePath, 'application/pdf',
        createHash('sha256').update(bytes).digest('hex'), bytes.length, '2026-07-01T00:00:00Z');
      await source.backup(f.options.databaseFilePath);
    }
    finally { source.close(); }

    let services: ProfileSnapshotRuntimeService | undefined;
    let originalCatalog: string | undefined;
    await createApp({
      ...f.options,
      profileSnapshotServiceRegistration: {
        stagingRoot: f.stagingRoot,
        register: value => { services = value; },
      },
      beforeMigrations: async (inspection) => {
        expect(Object.keys(inspection).sort()).toEqual([
          'appliedMigrationCount', 'migrationChainIdentity', 'pendingMigrationCount', 'profileState',
        ]);
        expect(inspection.appliedMigrationCount).toBe(38);
        expect(inspection.pendingMigrationCount).toBe(1);
        if (services === undefined) throw new Error('missing registration');
        await expect(services.validateActiveProfile()).resolves.toMatchObject({
          artifactCount: 1,
          migrationChainIdentity: inspection.migrationChainIdentity,
        });
        const operationId = await snapshot(f, services, 'compatibleHistoricalPrefix', 1);
        if (stagingPath === 'long') {
          expect(join(f.stagingRoot, operationId, 'profile.sqlite').length).toBeGreaterThan(300);
        }
        await expect(services.validateProfileSnapshot(operationId)).resolves.toMatchObject({
          artifactCount: 1, profileMatchesActive: true,
          migrationChainIdentity: inspection.migrationChainIdentity,
        });
        originalCatalog = await readFile(join(f.stagingRoot, operationId, 'snapshot-catalog-v1.json'), 'utf8');
        expect(inspectSqliteProfileDatabase(
          join(f.stagingRoot, operationId, 'profile.sqlite'), f.migrationsDirectory,
          'compatibleHistoricalPrefix',
        ).appliedMigrationNames).toEqual(manifest.slice(0, 38).map(entry => entry.fileName));
      },
    });
    if (services === undefined) throw new Error('missing registration');
    const operationId = await snapshot(f, services, 'exactCurrentManifest', 1);
    await expect(services.validateProfileSnapshot(operationId)).resolves.toMatchObject({
      artifactCount: 1, profileMatchesActive: true,
      migrationChainIdentity: manifest.at(-1)?.chainSha256,
    });
    expect(originalCatalog).toBeDefined();
    expect(await readFile(join(f.stagingRoot, operationId, 'snapshot-catalog-v1.json'), 'utf8'))
      .toBe(originalCatalog);
    expect(inspectSqliteProfileDatabase(
      join(f.stagingRoot, operationId, 'profile.sqlite'), f.migrationsDirectory,
    ).appliedMigrationNames).toEqual(manifest.map(entry => entry.fileName));
    await expect(services.validateActiveProfile()).resolves.toMatchObject({
      artifactCount: 1, migrationChainIdentity: manifest.at(-1)?.chainSha256,
    });
  });

  it('uses the runner default migration directory when no directory option is provided', async () => {
    const f = await fixture();
    let services: ProfileSnapshotRuntimeService | undefined;
    let inspected = false;
    const app = await createApp({
      databaseFilePath: f.options.databaseFilePath,
      invoiceDocumentStorageRoot: f.options.invoiceDocumentStorageRoot,
      profileMaintenanceState: f.maintenance,
      beforeMigrations: async inspection => {
        expect(services).toBeDefined();
        expect(inspection.profileState).toBe('empty');
        expect(inspection.pendingMigrationCount)
          .toBe(readMigrationManifest(resolveMigrationsDirectory()).length);
        inspected = true;
      },
      profileSnapshotServiceRegistration: {
        stagingRoot: f.stagingRoot, register: value => { services = value; },
      },
    });
    expect(app).toBeDefined();
    expect(inspected).toBe(true);
    expect(inspectSqliteProfileDatabase(f.options.databaseFilePath, resolveMigrationsDirectory())
      .appliedMigrationNames).toEqual(readMigrationManifest(resolveMigrationsDirectory()).map(entry => entry.fileName));
    if (services === undefined) throw new Error('Missing registration');
    await snapshot(f, services, 'exactCurrentManifest');
    await expect(services.validateActiveProfile()).resolves.toMatchObject({ artifactCount: 0 });
  });

  it('still requires an explicit document storage root for snapshot registration', async () => {
    const f = await fixture();
    await expect(createApp({
      databaseFilePath: f.options.databaseFilePath,
      profileSnapshotServiceRegistration: {
        stagingRoot: f.stagingRoot, register: () => { throw new Error('Must not register'); },
      },
    })).rejects.toThrow('Profile snapshot runtime paths must be configured.');
  });

  it('snapshots and restores old and current PDF bytes with their revision and delivery history', async () => {
    const f = await fixture();
    const source = openPublicationDatabase(f.options.databaseFilePath);
    const publication = await createPublicationFixture(source);
    source.prepare('UPDATE local_runtime_identity SET company_id = ?')
      .run(publication.key.companyId);
    const documents = [];
    for (const index of [0, 1]) {
      const key = index === 0 ? publication.key : nextPublicationRevision(source, publication.key);
      const bytes = Buffer.from(`%PDF-1.7\nSynthetic revision ${index}\n`);
      const candidate = documentCandidate(key, `snapshot-document-${index}`, {
        sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
      });
      const path = join(f.options.invoiceDocumentStorageRoot, candidate.storagePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      const result = await publication.repository.publishDocumentIfCurrent({ key, candidate });
      if (result.outcome === 'conflict') throw new Error('Synthetic document not published');
      insertBoundHistoryEvent(source, result.document, {
        id: `snapshot-event-${index}`, send_mode: index === 0 ? 'smtpTest' : 'customer',
      });
      documents.push({ document: result.document, bytes });
    }
    const expectedState = publicationState(source);
    source.close();

    let services: ProfileSnapshotRuntimeService | undefined;
    await createApp({
      ...f.options,
      profileSnapshotServiceRegistration: {
        stagingRoot: f.stagingRoot, register: value => { services = value; },
      },
    });
    if (services === undefined) throw new Error('Missing registration');
    const operationId = await snapshot(f, services, 'exactCurrentManifest', 2);
    await expect(services.validateProfileSnapshot(operationId)).resolves.toMatchObject({
      artifactCount: 2, profileMatchesActive: true,
    });
    await expect(services.prepareProfileRestoreActivation(operationId)).resolves.toMatchObject({
      artifactCount: 2,
    });
    for (const database of databases.splice(0)) if (database.open) database.close();
    const restoredDatabasePath = join(f.stagingRoot, operationId, 'profile.sqlite');
    const restoredStorageRoot = join(f.stagingRoot, operationId, 'activation', 'storage', 'invoices');
    const restored = connections.createDatabaseConnection({ databaseFilePath: restoredDatabasePath });
    expect(publicationState(restored)).toStrictEqual(expectedState);
    restored.close();

    await createApp({
      ...f.options, databaseFilePath: restoredDatabasePath,
      invoiceDocumentStorageRoot: restoredStorageRoot,
      profileSnapshotServiceRegistration: {
        stagingRoot: f.stagingRoot, register: value => { services = value; },
      },
    });
    await expect(services.validateActiveProfile()).resolves.toMatchObject({ artifactCount: 2 });
    for (const { document, bytes } of documents) {
      expect(await readFile(join(restoredStorageRoot, document.storagePath))).toEqual(bytes);
    }
    const first = documents[0]!;
    await writeFile(join(restoredStorageRoot, first.document.storagePath), 'damaged historical PDF');
    await expect(services.validateActiveProfile()).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
  });
});

async function fixture(longStagingPath = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-catalog-composition-'));
  roots.push(root);
  const stagingRoot = longStagingPath
    ? join(root, ...Array<string>(3).fill('snapshot-segment-'.repeat(6)), 'staging')
    : join(root, 'staging');
  const storageRoot = join(root, 'storage');
  await mkdir(stagingRoot, { mode: 0o700, recursive: true });
  await mkdir(storageRoot, { mode: 0o700 });
  const maintenance = new ProfileMaintenanceState();
  const migrationsDirectory = resolveMigrationsDirectory();
  const createConnection = connections.createDatabaseConnection;
  vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
    const database = createConnection(options);
    databases.push(database);
    return database;
  });
  return {
    root, stagingRoot, maintenance, migrationsDirectory,
    options: {
      databaseFilePath: join(root, 'profile.sqlite'), migrationsDirectory,
      invoiceDocumentStorageRoot: storageRoot, profileMaintenanceState: maintenance,
    },
  };
}

async function snapshot(
  f: Awaited<ReturnType<typeof fixture>>, services: ProfileSnapshotRuntimeService,
  migrationPolicy: 'exactCurrentManifest' | 'compatibleHistoricalPrefix',
  artifactCount = 0,
) {
  const operationId = randomUUID();
  await f.maintenance.begin(operationId, 1_000);
  try {
    const result = await services.createProfileSnapshot({
      operationId, migrationPolicy, signal: new AbortController().signal,
    });
    expect(result.artifactCatalog.artifactCount).toBe(artifactCount);
    return operationId;
  } finally { f.maintenance.end(operationId); }
}
