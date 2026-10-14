import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { isSqliteMemoryError } from '../../../database/connection/isSqliteMemoryError.js';
import {
  invoiceBackupArtifactMaximumCount,
  invoiceBackupArtifactMaximumTextBytes,
  type InvoiceBackupArtifactCatalog,
  type InvoiceBackupArtifactCatalogItem,
} from '../ports/invoiceBackupArtifactCatalog.js';
import type { InvoiceBackupArtifactCatalogSchema } from './selectInvoiceBackupArtifactCatalogSchema.js';
import { validateInvoiceHistoryRelationEncoding } from './validateInvoiceHistoryRelationEncoding.js';
import { validateInvoiceRevisionCatalog } from './validateInvoiceRevisionCatalog.js';
import { validateInvoiceRevisionCatalogDocuments } from './validateInvoiceRevisionCatalogDocuments.js';

interface InvoiceBackupArtifactCatalogRow {
  bound_invoice_id: string | null;
  company_id: string;
  document_id: string;
  document_type: string;
  file_name: string;
  invoice_id: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

export class SqliteInvoiceBackupArtifactCatalog
  implements InvoiceBackupArtifactCatalog
{
  constructor(
    private readonly database: DatabaseConnection,
    private readonly schema: InvoiceBackupArtifactCatalogSchema,
  ) {}

  async listAuthoritativeArtifacts(): Promise<
    readonly InvoiceBackupArtifactCatalogItem[]
  > {
    switch (this.schema) {
      case 'legacyDocuments':
        this.assertDocumentReadLimits();
        return this.listDocuments();
      case 'revisionHistory':
        try {
          return this.database.transaction(() => {
            this.assertDocumentReadLimits();
            validateInvoiceHistoryRelationEncoding(this.database);
            validateInvoiceRevisionCatalog(this.database);
            validateInvoiceRevisionCatalogDocuments(this.database);
            return this.listDocuments();
          }).deferred();
        } catch (error) {
          if (isSqliteMemoryError(error)) throw error;
          // A malformed new schema is never evidence for selecting the old branch.
          throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
        }
      default:
        throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
    }
  }

  private assertDocumentReadLimits(): void {
    const count = this.database.prepare<[number], { artifact_count: number }>(`
      SELECT COUNT(*) AS artifact_count FROM (
        SELECT 1 FROM invoice_documents LIMIT ?
      )
    `).get(invoiceBackupArtifactMaximumCount + 1);
    if (count === undefined || count.artifact_count > invoiceBackupArtifactMaximumCount) {
      throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
    }
    // Only module-owned column names form this SQL; large values never reach JS.
    const textColumns = ['id', 'company_id', 'invoice_id', 'document_type', 'file_name',
      'storage_path', 'mime_type', 'sha256', 'created_at',
      ...(this.schema === 'revisionHistory' ? ['binding_kind', 'revision_id', 'source_document_id'] : [])];
    const invalidText = textColumns.map(column =>
      `(typeof(${column}) NOT IN ('text', 'null') OR length(CAST(${column} AS BLOB)) > ?)`);
    const invalid = this.database.prepare<number[], { invalid: number }>(`
      SELECT 1 AS invalid FROM invoice_documents
      WHERE typeof(size_bytes) <> 'integer' OR ${invalidText.join(' OR ')} LIMIT 1
    `).get(...textColumns.map(() => invoiceBackupArtifactMaximumTextBytes));
    if (invalid !== undefined) throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  }

  private listDocuments(): readonly InvoiceBackupArtifactCatalogItem[] {
    const rows = this.database
      .prepare<[number], InvoiceBackupArtifactCatalogRow>(
        `
          SELECT
            document.id AS document_id,
            document.company_id,
            document.invoice_id,
            document.document_type,
            document.file_name,
            document.storage_path,
            document.mime_type,
            document.sha256,
            document.size_bytes,
            invoice.id AS bound_invoice_id
          FROM invoice_documents AS document
          LEFT JOIN invoices AS invoice
            ON invoice.id = document.invoice_id
            AND invoice.company_id = document.company_id
          ORDER BY document.id
          LIMIT ?
        `,
      )
      .all(invoiceBackupArtifactMaximumCount + 1);

    if (rows.length > invoiceBackupArtifactMaximumCount) {
      throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
    }

    return rows.map(toCatalogItem);
  }
}

function toCatalogItem(
  row: InvoiceBackupArtifactCatalogRow,
): InvoiceBackupArtifactCatalogItem {
  if (
    row.bound_invoice_id !== row.invoice_id ||
    row.document_type !== 'approved_invoice_pdf' ||
    row.mime_type !== 'application/pdf'
  ) {
    throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  }

  return {
    companyId: row.company_id,
    documentId: row.document_id,
    documentType: 'approved_invoice_pdf',
    fileName: row.file_name,
    invoiceId: row.invoice_id,
    mediaType: 'application/pdf',
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
  };
}
