import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('SqliteInvoiceBackupArtifactCatalog', () => {
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

    const catalog = new SqliteInvoiceBackupArtifactCatalog(database);

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

    const catalog = new SqliteInvoiceBackupArtifactCatalog(database);

    await expect(catalog.listAuthoritativeArtifacts()).rejects.toThrow(
      'INVOICE_BACKUP_CATALOG_INVALID',
    );
  });
});

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE approved_invoices (
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
      'INSERT INTO approved_invoices (id, company_id) VALUES (?, ?)',
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
