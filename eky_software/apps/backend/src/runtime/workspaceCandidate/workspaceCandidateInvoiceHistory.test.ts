import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import { resolveMigrationsDirectory } from '../../database/migration/runMigrations.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import { createInvoiceReadModelTestDatabase, insertInvoiceClone } from '../../testFixtures/invoiceReadModelTestFixtures.js';
import { ProfileMaintenanceState } from '../profileMaintenance/profileMaintenanceState.js';
import { createConsistentProfileSnapshotService } from '../profileSnapshot/createConsistentProfileSnapshot.js';
import { inspectSqliteProfileDatabase } from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import { runWorkspaceCandidateOperation } from './runWorkspaceCandidateOperation.js';

const migrationsDirectory = resolveMigrationsDirectory();
const releaseIdentity = { appVersion: '0.3.0', buildRevision: 'a'.repeat(40) };
const roots: string[] = [];
const originalPdf = Buffer.from('%PDF-1.7\nSynthetic preserved invoice\n');
const storagePath = 'legacy/original.pdf';
const secondStoragePath = 'legacy/second.pdf';
const catalogFaults = ['catalog', 'sourceIdentity', 'restoreIdentity', 'changedPdf', 'missingPdf'] as const;
type CatalogFault = typeof catalogFaults[number];
interface SnapshotCatalog {
  formatVersion: number;
  artifacts: {
    logicalPath: string;
    sourceIdentity: { invoiceId: string; documentId: string };
    restoreValidationIdentity: { invoiceId: string; documentId: string };
  }[];
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('workspace candidate invoice history', () => {
  it.each([true, false])('preserves a nonempty 038 catalog through migration and reopen (metadata: %s)', async metadata => {
    const f = await fixture(metadata);
    const sourceHash = await fileHash(f.sourceDatabase);
    const originalCatalog = await readFile(f.catalogPath);

    await expect(runWorkspaceCandidateOperation(f.migrate)).resolves.toMatchObject({
      kind: 'migration', profileId: f.migrate.expectedProfileId,
      migrationChainIdentity: readMigrationManifest(migrationsDirectory).at(-1)?.chainSha256,
    });
    await expect(runWorkspaceCandidateOperation(f.materialize)).resolves.toMatchObject({ kind: 'readiness' });
    expect(await readFile(join(f.target.artifactRoot, storagePath))).toEqual(originalPdf);
    expect(await readFile(f.catalogPath)).toEqual(originalCatalog);
    expect(await fileHash(f.sourceDatabase)).toBe(sourceHash);
    expect(readRows(f.target.databaseFilePath, 'SELECT * FROM invoices')).toEqual(f.originalInvoices);
    expect(readRows(f.target.databaseFilePath, 'SELECT * FROM invoice_lines ORDER BY id')).toEqual(f.originalLines);
    expect(readRows(f.target.databaseFilePath,
      'SELECT id, binding_kind, revision_id, sha256, size_bytes, storage_path FROM invoice_documents'))
      .toEqual([{
        id: 'legacy-doc', binding_kind: 'legacyOriginal', revision_id: null,
        sha256: hash(originalPdf), size_bytes: originalPdf.length, storage_path: storagePath,
      }]);
    await expect(runWorkspaceCandidateOperation({
      ...releaseIdentity, ...f.target, migrationsDirectory,
      expectedProfileId: f.migrate.expectedProfileId, operation: 'validatePublished',
    })).resolves.toMatchObject({ kind: 'readiness', artifactRootHealth: 'ready' });
  });

  it.each(catalogFaults)(
    'rejects %s in the source before applying revision migrations', async fault => {
      const f = await fixture();
      const sourceHash = await fileHash(f.sourceDatabase);
      await corrupt(f, fault);
      await expect(runWorkspaceCandidateOperation(f.migrate))
        .rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
      expect(readRows(f.target.databaseFilePath, 'SELECT name FROM schema_migrations ORDER BY name'))
        .toEqual(readRows(f.sourceDatabase, 'SELECT name FROM schema_migrations ORDER BY name'));
      expect(readRows(f.target.databaseFilePath,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invoice_content_revisions'"))
        .toEqual([]);
      expect(await fileHash(f.sourceDatabase)).toBe(sourceHash);
      expect(await readdir(f.target.artifactRoot)).toEqual([]);
    },
  );

  it.each(catalogFaults)(
    'rejects %s after migration before materializing any PDF', async fault => {
      const f = await fixture();
      await runWorkspaceCandidateOperation(f.migrate);
      const targetHash = await fileHash(f.target.databaseFilePath);
      await corrupt(f, fault);
      await expect(runWorkspaceCandidateOperation(f.materialize))
        .rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
      expect(await readdir(f.target.artifactRoot)).toEqual([]);
      expect(await fileHash(f.target.databaseFilePath)).toBe(targetHash);
    },
  );

  it('materializes both valid PDFs from a multi-artifact backup', async () => {
    const f = await fixture(true, true);
    await runWorkspaceCandidateOperation(f.migrate);
    await runWorkspaceCandidateOperation(f.materialize);
    expect(await readFile(join(f.target.artifactRoot, storagePath))).toEqual(originalPdf);
    expect(await readFile(join(f.target.artifactRoot, secondStoragePath))).toEqual(originalPdf);
  });

  it.each(['changedPdf', 'missingPdf'] as const)(
    'does not copy the valid first PDF when the second PDF is %s', async fault => {
      const f = await fixture(true, true);
      await runWorkspaceCandidateOperation(f.migrate);
      const targetHash = await fileHash(f.target.databaseFilePath);
      const catalog = JSON.parse(await readFile(f.catalogPath, 'utf8')) as SnapshotCatalog;
      expect(catalog.artifacts.map(entry => entry.sourceIdentity.documentId))
        .toEqual(['legacy-doc', 'legacy-doc-2']);
      const secondPdf = join(dirname(f.catalogPath), catalog.artifacts[1]!.logicalPath);
      expect(await readFile(f.stagedPdf)).toEqual(originalPdf);
      await corrupt({ catalogPath: f.catalogPath, stagedPdf: secondPdf }, fault);

      await expect(runWorkspaceCandidateOperation(f.materialize))
        .rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
      expect(await readdir(f.target.artifactRoot)).toEqual([]);
      expect(await fileHash(f.target.databaseFilePath)).toBe(targetHash);
      expect(await readFile(f.stagedPdf)).toEqual(originalPdf);
    },
  );
});

async function fixture(metadata = true, secondDocument = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-invoice-history-'));
  roots.push(root);
  const historicalDirectory = join(root, 'historical');
  const stagingRoot = join(root, 'staging');
  const documentRoot = join(root, 'documents');
  for (const path of [historicalDirectory, stagingRoot, join(documentRoot, 'legacy')]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  for (const entry of readMigrationManifest(migrationsDirectory).slice(0, 38)) {
    await writeFile(join(historicalDirectory, entry.fileName), entry.content, { mode: 0o600 });
  }
  await writeFile(join(documentRoot, storagePath), originalPdf, { mode: 0o600 });
  const database = await createInvoiceReadModelTestDatabase(historicalDirectory);
  const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const maintenance = new ProfileMaintenanceState();
  try {
    database.prepare('UPDATE local_runtime_identity SET company_id = ?').run('dev-company');
    database.prepare(`
      INSERT INTO invoice_documents (
        id, company_id, invoice_id, document_type, file_name, storage_path,
        mime_type, sha256, size_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-doc', 'dev-company', 'invoice-1', 'approved_invoice_pdf',
      'Original.pdf', storagePath, 'application/pdf', hash(originalPdf),
      originalPdf.length, '2026-07-01T00:00:00Z');
    if (secondDocument) {
      insertInvoiceClone(database, {
        id: 'invoice-2', sourceDraftId: 'draft-2', invoiceKind: 'standard',
        creditedInvoiceId: null, invoiceNumber: '20260002', status: 'approved',
        totalGrossCents: 0, invoiceDate: '2026-07-01',
      });
      database.prepare(`
        INSERT INTO invoice_documents (
          id, company_id, invoice_id, document_type, file_name, storage_path,
          mime_type, sha256, size_bytes, created_at
        ) SELECT 'legacy-doc-2', company_id, 'invoice-2', document_type, 'Second.pdf', ?,
          mime_type, sha256, size_bytes, created_at FROM invoice_documents WHERE id = 'legacy-doc'
      `).run(secondStoragePath);
      await writeFile(join(documentRoot, secondStoragePath), originalPdf, { mode: 0o600 });
    }
    await maintenance.begin(operationId, 5_000);
    await createConsistentProfileSnapshotService({
      catalog: new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments'),
      database, invoiceDocumentStorageRoot: documentRoot,
      maintenanceState: maintenance, migrationsDirectory, stagingRoot,
    }).createProfileSnapshot({
      operationId, migrationPolicy: 'compatibleHistoricalPrefix',
      signal: new AbortController().signal,
    });
  } finally {
    maintenance.end(operationId);
    database.close();
  }
  const importStagingRoot = join(stagingRoot, operationId);
  const sourceDatabase = join(importStagingRoot, 'profile.sqlite');
  if (!metadata) {
    await chmod(sourceDatabase, 0o600);
    const legacy = new Database(sourceDatabase);
    try { legacy.exec('DROP TABLE schema_migration_metadata'); }
    finally { legacy.close(); }
    await chmod(sourceDatabase, 0o400);
  }
  const inspection = inspectSqliteProfileDatabase(sourceDatabase, migrationsDirectory, 'restoreCompatible');
  const target = {
    candidateRoot: join(root, 'target'),
    databaseFilePath: join(root, 'target', 'runtime', 'data', 'eky.sqlite'),
    artifactRoot: join(root, 'target', 'runtime', 'storage', 'invoices'),
  };
  await mkdir(dirname(target.databaseFilePath), { recursive: true, mode: 0o700 });
  await mkdir(target.artifactRoot, { recursive: true, mode: 0o700 });
  const common = {
    ...releaseIdentity, ...target, migrationsDirectory, importStagingRoot,
    expectedProfileId: inspection.profileId,
  };
  const catalogPath = join(importStagingRoot, 'snapshot-catalog-v1.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as SnapshotCatalog;
  expect(catalog.artifacts).toHaveLength(secondDocument ? 2 : 1);
  return {
    target, sourceDatabase, catalogPath,
    stagedPdf: join(importStagingRoot, catalog.artifacts[0]!.logicalPath),
    originalInvoices: readRows(sourceDatabase, 'SELECT * FROM invoices'),
    originalLines: readRows(sourceDatabase, 'SELECT * FROM invoice_lines ORDER BY id'),
    migrate: {
      ...common, operation: 'migrateBackup' as const,
      expectedSourceMigrationChainIdentity: inspection.migrationChainIdentity,
    },
    materialize: { ...common, operation: 'validateAndMaterialize' as const },
  };
}

async function corrupt(f: { catalogPath: string; stagedPdf: string }, fault: CatalogFault) {
  if (fault === 'catalog') {
    await chmod(f.catalogPath, 0o600);
    await writeFile(f.catalogPath, JSON.stringify({ artifacts: [], formatVersion: 1 }));
  } else if (fault === 'sourceIdentity' || fault === 'restoreIdentity') {
    const catalog = JSON.parse(await readFile(f.catalogPath, 'utf8')) as SnapshotCatalog;
    expect(catalog.artifacts).toHaveLength(1);
    const identity = fault === 'sourceIdentity' ? 'sourceIdentity' : 'restoreValidationIdentity';
    catalog.artifacts[0]![identity].invoiceId = 'invoice-9';
    await chmod(f.catalogPath, 0o600);
    await writeFile(f.catalogPath, JSON.stringify(catalog));
  } else if (fault === 'missingPdf') {
    await rm(f.stagedPdf);
  } else {
    await chmod(f.stagedPdf, 0o600);
    await writeFile(f.stagedPdf, Buffer.from(originalPdf.toString().replace('preserved', 'different')));
  }
}

function readRows(path: string, sql: string): unknown[] {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try { return database.prepare(sql).all(); }
  finally { database.close(); }
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileHash(path: string): Promise<string> {
  return hash(await readFile(path));
}
