import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceBackupArtifactCatalog,
  InvoiceBackupArtifactCatalogItem,
} from '../ports/invoiceBackupArtifactCatalog.js';

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
  constructor(private readonly database: DatabaseConnection) {}

  async listAuthoritativeArtifacts(): Promise<
    readonly InvoiceBackupArtifactCatalogItem[]
  > {
    const rows = this.database
      .prepare<[], InvoiceBackupArtifactCatalogRow>(
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
        `,
      )
      .all();

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
