import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { historicalDatabase, insert, migrate, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { documentRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import type { InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';
import { createPublicationFixture, documentCandidate } from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentPreviewReader } from './sqliteInvoiceDocumentPreviewReader.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';

export const syntheticPdf = Buffer.from('%PDF-1.7\nSynthetic invoice revision\n%%EOF\n');

export function pdfReadDependencies(database: DatabaseConnection, storage: InvoiceDocumentStorage) {
  return {
    invoiceDocumentPreviewReader: new SqliteInvoiceDocumentPreviewReader(database),
    invoiceDocumentRepository: new SqliteInvoiceDocumentRepository(database),
    invoiceDocumentStorage: storage,
  };
}

export async function createPdfReadFixture(database: DatabaseConnection) {
  const publication = await createPublicationFixture(database);
  const root = temporaryDirectory();
  const storage = new LocalInvoiceDocumentStorage(root);
  async function publish(key: InvoiceRevisionKey, id: string, content: Uint8Array = syntheticPdf) {
    const file = await storage.writeCandidate({ scope: key, documentId: id, content });
    const result = await publication.repository.publishDocumentIfCurrent({
      key, candidate: documentCandidate(key, id, {
        storagePath: file.storagePath, sha256: file.sha256, sizeBytes: file.sizeBytes,
      }),
    });
    if (result.outcome !== 'published') throw new Error('Synthetic PDF publication failed.');
    return result.document;
  }
  const document = await publish(publication.key, 'pdf-original');
  return { ...publication, database, root, storage, document, publish,
    dependencies: pdfReadDependencies(database, storage) };
}

export async function createLegacyPdfReadFixture(
  withDeliveryHistory: boolean | 'unambiguous' | 'repeated' = false,
  beforeMigration?: (database: DatabaseConnection) => void,
) {
  const database = await historicalDatabase();
  const root = temporaryDirectory();
  const scope = { companyId: 'dev-company', invoiceId: 'invoice-1' };
  const legacyDocumentId = 'legacy-document';
  const row = documentRow({
    id: legacyDocumentId, file_name: 'original.pdf', storage_path: 'legacy/original.pdf',
    size_bytes: syntheticPdf.byteLength, sha256: createHash('sha256').update(syntheticPdf).digest('hex'),
  });
  delete row.binding_kind;
  delete row.revision_id;
  delete row.source_document_id;
  insert(database, 'invoice_documents', row);
  mkdirSync(join(root, 'legacy'));
  writeFileSync(join(root, 'legacy', 'original.pdf'), syntheticPdf);
  if (withDeliveryHistory) {
    const references: [string, string | null][] = [['legacy-event', legacyDocumentId]];
    if (withDeliveryHistory === 'repeated') references.push(['legacy-repeat-event', legacyDocumentId]);
    else if (withDeliveryHistory !== 'unambiguous') references.push(['legacy-missing-event', null]);
    for (const [id, documentId] of references) {
      insert(database, 'invoice_delivery_events', {
        id, company_id: scope.companyId, invoice_id: scope.invoiceId, document_id: documentId,
        delivery_method: 'email', provider: 'smtp', status: 'succeeded', created_at: '2026-07-01T00:00:00Z',
      });
    }
  }
  beforeMigration?.(database);
  await migrate(database);
  const storage = new LocalInvoiceDocumentStorage(root);
  return { database, root, scope, storage, dependencies: pdfReadDependencies(database, storage) };
}
