import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDocumentRow,
  NewInvoiceDocumentRow,
} from '../../../database/schema.js';
import type {
  ApprovedInvoiceDocumentMetadata,
  ApprovedInvoiceDocumentType,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';

type InvoiceDocumentKeyParameters = [string, string, string];
type InvoiceDocumentInsertParameters = NewInvoiceDocumentRow;

export class SqliteInvoiceDocumentRepository
  implements InvoiceDocumentRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async deleteDocumentsForInvoice(
    companyId: string,
    invoiceId: string,
    documentType: ApprovedInvoiceDocumentType,
  ): Promise<string[]> {
    const deleteTransaction = this.database.transaction(() => {
      const rows = this.database
        .prepare<InvoiceDocumentKeyParameters, Pick<InvoiceDocumentRow, 'storage_path'>>(
          `
            SELECT storage_path
            FROM invoice_documents
            WHERE
              company_id = ?
              AND invoice_id = ?
              AND document_type = ?
          `,
        )
        .all(companyId, invoiceId, documentType);

      this.database
        .prepare<InvoiceDocumentKeyParameters>(
          `
            DELETE FROM invoice_documents
            WHERE
              company_id = ?
              AND invoice_id = ?
              AND document_type = ?
          `,
        )
        .run(companyId, invoiceId, documentType);

      return rows.map((row) => row.storage_path);
    });

    return deleteTransaction();
  }

  async findDocumentForInvoice(
    companyId: string,
    invoiceId: string,
    documentType: ApprovedInvoiceDocumentType,
  ): Promise<ApprovedInvoiceDocumentMetadata | undefined> {
    const row = this.database
      .prepare<InvoiceDocumentKeyParameters, InvoiceDocumentRow>(
        `
          SELECT *
          FROM invoice_documents
          WHERE
            company_id = ?
            AND invoice_id = ?
            AND document_type = ?
        `,
      )
      .get(companyId, invoiceId, documentType);

    return row === undefined ? undefined : toMetadata(row);
  }

  async saveDocument(
    metadata: ApprovedInvoiceDocumentMetadata,
  ): Promise<ApprovedInvoiceDocumentMetadata> {
    this.database
      .prepare<InvoiceDocumentInsertParameters>(
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
          VALUES (
            @id,
            @company_id,
            @invoice_id,
            @document_type,
            @file_name,
            @storage_path,
            @mime_type,
            @sha256,
            @size_bytes,
            @created_at
          )
        `,
      )
      .run(toRow(metadata));

    return metadata;
  }
}

function toMetadata(row: InvoiceDocumentRow): ApprovedInvoiceDocumentMetadata {
  return {
    id: row.id,
    companyId: row.company_id,
    invoiceId: row.invoice_id,
    documentType: row.document_type as ApprovedInvoiceDocumentType,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: 'application/pdf',
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function toRow(
  metadata: ApprovedInvoiceDocumentMetadata,
): NewInvoiceDocumentRow {
  return {
    id: metadata.id,
    company_id: metadata.companyId,
    invoice_id: metadata.invoiceId,
    document_type: metadata.documentType,
    file_name: metadata.fileName,
    storage_path: metadata.storagePath,
    mime_type: metadata.mimeType,
    sha256: metadata.sha256,
    size_bytes: metadata.sizeBytes,
    created_at: metadata.createdAt,
  };
}
