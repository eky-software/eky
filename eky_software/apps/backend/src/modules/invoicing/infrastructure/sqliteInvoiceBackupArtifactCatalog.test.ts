import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { migrate, removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { bindingState, createBindingDatabase } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { insertBoundHistoryEvent } from './invoiceEventPdfRead.fixture.js';
import type { InvoiceBackupArtifactCatalogSchema } from './selectInvoiceBackupArtifactCatalogSchema.js';
import {
  closePublicationDatabases,
  createLegacyPublicationFixture,
  createPublicationFixture,
  documentCandidate,
  nextPublicationRevision,
  openPublicationDatabase,
  publicationState,
} from './sqliteInvoiceDocumentPublication.fixture.js';
import { totalChanges } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';

const databases: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    database.close();
  }
  closePublicationDatabases();
});
afterAll(removeDirectories);

describe('SqliteInvoiceBackupArtifactCatalog', () => {
  it.each(['prepare', 'count', 'historyCursor', 'documents'] as const)
    ('preserves a native memory failure from %s and ends the catalog transaction', async phase => {
      const database = openPublicationDatabase();
      await runMigrations(database);
      const failure = new Database.SqliteError('synthetic private allocation detail', 'SQLITE_NOMEM');
      const injected = vi.fn(() => { throw failure; });
      const prepare = database.prepare.bind(database);
      let cursorReturn: ReturnType<typeof vi.spyOn> | undefined;
      vi.spyOn(database, 'prepare').mockImplementation(sql => {
        if (phase === 'prepare') return injected();
        const statement = prepare(sql);
        if (phase === 'count' && sql.includes('AS artifact_count')) vi.spyOn(statement, 'get').mockImplementation(injected);
        if (phase === 'documents' && /SELECT\s+document.id AS document_id/.test(sql)) {
          vi.spyOn(statement, 'all').mockImplementation(injected);
        }
        if (phase === 'historyCursor') {
          const iterate = statement.iterate.bind(statement);
          vi.spyOn(statement, 'iterate').mockImplementation((...args) => {
            const cursor = iterate(...args);
            vi.spyOn(cursor, 'next').mockImplementation(injected);
            cursorReturn = vi.spyOn(cursor, 'return');
            return cursor;
          });
        }
        return statement;
      });
      await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
        .rejects.toBe(failure);
      expect(injected).toHaveBeenCalledOnce();
      if (phase === 'historyCursor') expect(cursorReturn).toHaveBeenCalledOnce();
      expect(database.inTransaction).toBe(false);
    });

  it.each([
    new Database.SqliteError('synthetic corrupt catalog', 'SQLITE_CORRUPT'),
    new Error('SQLITE_NOMEM'),
    new Error('synthetic wrapped detail', { cause: new Database.SqliteError('private', 'SQLITE_NOMEM') }),
  ])('keeps non-native-memory failures on the ordinary invalid-catalog path (%#)', async failure => {
    const database = openPublicationDatabase();
    await runMigrations(database);
    vi.spyOn(database, 'prepare').mockImplementation(() => { throw failure; });
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
      .rejects.toMatchObject({ message: 'INVOICE_BACKUP_CATALOG_INVALID' });
    expect(database.inTransaction).toBe(false);
  });

  it('accepts the unchanged document-count boundary with a bounded query', async () => {
    const database = createDatabase();
    insertInvoice(database, 'company-1', 'invoice-1');
    const insert = database.prepare(`INSERT INTO invoice_documents VALUES
      (?, 'company-1', 'invoice-1', 'approved_invoice_pdf', 'invoice.pdf', 'old.pdf', 'application/pdf', ?, 16, '2026-08-04')`);
    database.transaction(() => {
      for (let index = 0; index < 100_000; index += 1) insert.run(`document-${index}`, 'a'.repeat(64));
    })();
    const prepare = vi.spyOn(database, 'prepare');
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments').listAuthoritativeArtifacts())
      .resolves.toHaveLength(100_000);
    expect(prepare.mock.calls.filter(([sql]) => /SELECT\s+document.id/i.test(sql))
      .every(([sql]) => /ORDER BY document.id\s+LIMIT \?/i.test(sql))).toBe(true);
  });

  it.each(['legacyDocuments', 'revisionHistory'] as const)('rejects excessive %s document rows before materialization or revision queries', async schema => {
    const database = createDatabase();
    insertInvoice(database, 'company-1', 'invoice-1');
    const insert = database.prepare(`INSERT INTO invoice_documents VALUES
      (?, 'company-1', 'invoice-1', 'approved_invoice_pdf', 'invoice.pdf', 'old.pdf', 'application/pdf', ?, 16, '2026-08-04')`);
    database.transaction(() => {
      for (let index = 0; index <= 100_000; index += 1) insert.run(`document-${index}`, 'a'.repeat(64));
    })();
    const prepare = vi.spyOn(database, 'prepare');
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, schema).listAuthoritativeArtifacts())
      .rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
    expect(prepare.mock.calls.every(([sql]) => !/SELECT\s+(?:document\.|revision\.|\* FROM invoices)/i.test(sql))).toBe(true);
  });

  it.each(['id', 'company_id', 'invoice_id', 'file_name', 'storage_path', 'created_at', 'document_type', 'mime_type', 'sha256'])('rejects oversized %s before catalog fields are materialized', async field => {
    const database = createDatabase();
    insertInvoice(database, 'company-1', 'invoice-1');
    insertDocument(database, { companyId: 'company-1', invoiceId: 'invoice-1', documentId: 'document-1', storagePath: 'old.pdf' });
    database.prepare(`UPDATE invoice_documents SET ${field} = ?`).run('x'.repeat(1_025));
    const prepare = vi.spyOn(database, 'prepare');
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments').listAuthoritativeArtifacts())
      .rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
    expect(prepare.mock.calls.some(([sql]) => /SELECT\s+document.id/i.test(sql))).toBe(false);
  });

  it('rejects a blob in the numeric field before it can become an unbounded buffer', async () => {
    const database = createDatabase();
    insertInvoice(database, 'company-1', 'invoice-1');
    insertDocument(database, { companyId: 'company-1', invoiceId: 'invoice-1', documentId: 'document-1', storagePath: 'old.pdf' });
    database.exec('UPDATE invoice_documents SET size_bytes = zeroblob(2048)');
    const prepare = vi.spyOn(database, 'prepare');
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments').listAuthoritativeArtifacts())
      .rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
    expect(prepare.mock.calls.some(([sql]) => /SELECT\s+document.id/i.test(sql))).toBe(false);
  });

  it.each([1_024, 1_025])('applies the catalog text bound to UTF-8 bytes: %s', async bytes => {
    const database = createDatabase();
    insertInvoice(database, 'company-1', 'invoice-1');
    insertDocument(database, { companyId: 'company-1', invoiceId: 'invoice-1', documentId: 'document-1', storagePath: 'old.pdf' });
    database.prepare('UPDATE invoice_documents SET file_name = ?').run('\u00e4'.repeat(512) + (bytes === 1_025 ? 'a' : ''));
    const result = new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments').listAuthoritativeArtifacts();
    if (bytes === 1_024) await expect(result).resolves.toHaveLength(1);
    else await expect(result).rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  });

  it('lists every authoritative invoice document in stable order', async () => {
    const database = createDatabase();
    insertInvoice(database, 'company-1', 'invoice-1');
    insertInvoice(database, 'company-1', 'invoice-2');
    insertDocument(database, {
      companyId: 'company-1',
      documentId: 'document-b',
      invoiceId: 'invoice-2',
      storagePath: 'company-1/invoice-2/approved-invoice.pdf',
    });
    insertDocument(database, {
      companyId: 'company-1',
      documentId: 'document-a',
      invoiceId: 'invoice-1',
      storagePath: 'company-1/invoice-1/approved-invoice.pdf',
    });

    const catalog = new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments');

    await expect(catalog.listAuthoritativeArtifacts()).resolves.toEqual([
      expect.objectContaining({
        companyId: 'company-1',
        documentId: 'document-a',
        invoiceId: 'invoice-1',
        mediaType: 'application/pdf',
      }),
      expect.objectContaining({
        companyId: 'company-1',
        documentId: 'document-b',
        invoiceId: 'invoice-2',
        mediaType: 'application/pdf',
      }),
    ]);
  });

  it('fails closed when a document is not bound to its company invoice', async () => {
    const database = createDatabase();
    insertDocument(database, {
      companyId: 'company-1',
      documentId: 'document-a',
      invoiceId: 'missing-invoice',
      storagePath: 'company-1/missing-invoice/approved-invoice.pdf',
    });

    const catalog = new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments');

    await expect(catalog.listAuthoritativeArtifacts()).rejects.toThrow(
      'INVOICE_BACKUP_CATALOG_INVALID',
    );
  });

  it('preserves the exact catalog-v1 items across the real 038 -> 039 migration', async () => {
    const database = await createBindingDatabase();
    const before = await new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments').listAuthoritativeArtifacts();
    expect(before).toHaveLength(1);
    const old = bindingState(database);
    await migrate(database);
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
      .resolves.toStrictEqual(before);
    expect(bindingState(database).docs.map(({ binding_kind, revision_id, source_document_id, ...row }) => row))
      .toStrictEqual(old.docs);
    expect(bindingState(database).events.map(({
      binding_kind, revision_id, send_mode, document_sha256, document_size_bytes, ...row
    }) => row)).toStrictEqual(old.events);
  });

  it('retains old and current revision PDFs in document-ID order without expanding catalog-v1', async () => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    const first = await fixture.repository.publishDocumentIfCurrent({
      key: fixture.key, candidate: documentCandidate(fixture.key, 'document-z'),
    });
    if (first.outcome === 'conflict') throw new Error('Synthetic document missing.');
    insertBoundHistoryEvent(database, first.document);
    const next = nextPublicationRevision(database, fixture.key);
    const second = await fixture.repository.publishDocumentIfCurrent({
      key: next, candidate: documentCandidate(next, 'document-a'),
    });
    if (second.outcome === 'conflict') throw new Error('Synthetic document missing.');
    const before = publicationState(database);
    const changes = totalChanges(database);
    database.pragma('query_only = ON');
    const catalog = new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory');
    const expected = [second.document, first.document].map((document) => ({
      companyId: document.companyId, documentId: document.id,
      documentType: document.documentType, fileName: document.fileName,
      invoiceId: document.invoiceId, mediaType: document.mimeType,
      sha256: document.sha256, sizeBytes: document.sizeBytes, storagePath: document.storagePath,
    }));
    await expect(catalog.listAuthoritativeArtifacts()).resolves.toStrictEqual(expected);
    await expect(catalog.listAuthoritativeArtifacts()).resolves.toStrictEqual(expected);
    expect(publicationState(database)).toStrictEqual(before);
    expect(totalChanges(database)).toBe(changes);
    expect(database.inTransaction).toBe(false);
  });

  it('retains both a legacy original and its independently preserved copy', async () => {
    const fixture = await createLegacyPublicationFixture();
    const result = await fixture.repository.publishPreservedLegacyDocument(fixture);
    if (result.outcome === 'conflict') throw new Error('Synthetic preserved document missing.');
    insertBoundHistoryEvent(fixture.database, result.document, { send_mode: 'customer' });
    const before = publicationState(fixture.database);
    const artifacts = await new SqliteInvoiceBackupArtifactCatalog(fixture.database, 'revisionHistory')
      .listAuthoritativeArtifacts();
    expect(artifacts.map((item) => item.documentId)).toEqual([fixture.original.id, fixture.candidate.id]);
    expect(artifacts.map((item) => item.storagePath)).toEqual([fixture.original.storagePath, fixture.candidate.storagePath]);
    expect(publicationState(fixture.database)).toStrictEqual(before);
  });

  it('accepts a fully migrated empty database', async () => {
    const database = openPublicationDatabase();
    await runMigrations(database);
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
      .resolves.toStrictEqual([]);
  });

  it('does not inspect new-looking columns when the explicit schema is legacy', async () => {
    const database = createDatabase();
    database.exec("ALTER TABLE invoice_documents ADD COLUMN binding_kind TEXT DEFAULT 'invalid'");
    insertInvoice(database, 'company-1', 'invoice-1');
    insertDocument(database, {
      companyId: 'company-1', invoiceId: 'invoice-1', documentId: 'document-1', storagePath: 'old.pdf',
    });
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'legacyDocuments').listAuthoritativeArtifacts())
      .resolves.toHaveLength(1);
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
      .rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  });

  it.each(['binding_kind', 'source_document_id'])('rejects a missing new %s column even with no documents', async (column) => {
    const database = openPublicationDatabase();
    await runMigrations(database);
    // Rebuild only this empty test table to simulate damaged new-schema storage.
    database.exec('DROP TABLE invoice_documents');
    database.exec(`CREATE TABLE invoice_documents (
      id TEXT, company_id TEXT, invoice_id TEXT, revision_id TEXT,
      ${column === 'binding_kind' ? 'source_document_id' : 'binding_kind'} TEXT
    )`);
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
      .rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  });

  it.each([undefined, 'unknown'])('fails closed for an absent or unknown runtime schema: %s', async (schema) => {
    const database = createDatabase();
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, schema as InvoiceBackupArtifactCatalogSchema)
      .listAuthoritativeArtifacts()).rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  });
});

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE invoices (
      id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      PRIMARY KEY (id)
    );
    CREATE TABLE invoice_documents (
      id TEXT NOT NULL PRIMARY KEY,
      company_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

function insertInvoice(
  database: Database.Database,
  companyId: string,
  invoiceId: string,
): void {
  database
    .prepare(
      'INSERT INTO invoices (id, company_id) VALUES (?, ?)',
    )
    .run(invoiceId, companyId);
}

function insertDocument(
  database: Database.Database,
  input: {
    companyId: string;
    documentId: string;
    invoiceId: string;
    storagePath: string;
  },
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_documents (
          id,
          company_id,
          invoice_id,
          document_type,
          file_name,
          storage_path,
          mime_type,
          sha256,
          size_bytes,
          created_at
        )
        VALUES (?, ?, ?, 'approved_invoice_pdf', 'invoice.pdf', ?, 'application/pdf', ?, 16, ?)
      `,
    )
    .run(
      input.documentId,
      input.companyId,
      input.invoiceId,
      input.storagePath,
      'a'.repeat(64),
      '2026-08-04T00:00:00.000Z',
    );
}
