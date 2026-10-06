import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDocumentRow, NewInvoiceDocumentRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { approvedInvoicePdfDocumentType, approvedInvoicePdfMimeType } from '../domain/approvedInvoiceDocument.js';
import type {
  ApprovedInvoiceDocumentMetadata,
  PreservedLegacyInvoiceDocumentMetadata,
  RevisionInvoiceDocumentMetadata,
  StoredInvoiceDocumentMetadata,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceRevisionKey, InvoiceScope } from '../domain/invoiceContentRevision.js';
import type {
  InvoiceDocumentCandidate, InvoiceDocumentKey, InvoiceDocumentRepository,
  PublishInvoiceDocumentResult, PublishPreservedLegacyDocumentInput, PublishRevisionDocumentInput,
} from '../ports/invoiceDocumentRepository.js';
import {
  isDocumentEvidence, toInvoiceDocumentRow, validateDocumentCandidate,
} from './invoiceDocumentPersistenceMapping.js';
import { readInvoiceDocumentMetadata, validateStoredDocument } from './readInvoiceDocumentMetadata.js';
import { readLegacyResendSourceId } from './invoiceLegacyResendEligibility.js';

export class SqliteInvoiceDocumentRepository
  implements InvoiceDocumentRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async findDocumentForRevision(key: InvoiceRevisionKey): Promise<RevisionInvoiceDocumentMetadata | undefined> {
    return this.database.transaction(() => this.readForRevision(key)).deferred();
  }

  async findCurrentDocumentForRevision(key: InvoiceRevisionKey): Promise<RevisionInvoiceDocumentMetadata | undefined> {
    return this.database.transaction(() => this.isCurrentRevision(key) ? this.readForRevision(key) : undefined).deferred();
  }

  async findDocumentById(key: InvoiceDocumentKey): Promise<StoredInvoiceDocumentMetadata | undefined> {
    return this.database.transaction(() => this.readById(key)).deferred();
  }

  async publishDocumentIfCurrent(
    { key, candidate }: PublishRevisionDocumentInput,
  ): Promise<PublishInvoiceDocumentResult<RevisionInvoiceDocumentMetadata>> {
    validateDocumentCandidate(key, candidate);
    return this.database.transaction((): PublishInvoiceDocumentResult<RevisionInvoiceDocumentMetadata> => {
      // Check eligibility before returning even an existing document for an old revision.
      if (!this.isCurrentRevision(key)) return { outcome: 'conflict' };
      const existing = this.readForRevision(key);
      if (existing !== undefined) return { outcome: 'existing', document: existing };
      if (this.hasCandidateCollision(candidate)) return { outcome: 'conflict' };
      const document: RevisionInvoiceDocumentMetadata = {
        ...candidateMetadata(key, candidate), binding: { kind: 'revision', revisionId: key.revisionId },
      };
      this.insert(document);
      return { outcome: 'published', document };
    }).immediate();
  }

  async publishPreservedLegacyDocument(
    { scope, source, candidate }: PublishPreservedLegacyDocumentInput,
  ): Promise<PublishInvoiceDocumentResult<PreservedLegacyInvoiceDocumentMetadata>> {
    validateDocumentCandidate(scope, candidate);
    if (!isDocumentEvidence(source.sha256, source.sizeBytes)) throw new InvoiceDocumentIntegrityError();
    return this.database.transaction((): PublishInvoiceDocumentResult<PreservedLegacyInvoiceDocumentMetadata> => {
      if (readLegacyResendSourceId(this.database, scope) !== source.documentId) return { outcome: 'conflict' };
      const original = this.readById({ ...scope, documentId: source.documentId });
      if (original === undefined || original.binding.kind !== 'legacyOriginal'
        || original.sha256 !== source.sha256 || original.sizeBytes !== source.sizeBytes
        || candidate.sha256 !== source.sha256 || candidate.sizeBytes !== source.sizeBytes
        || candidate.id === source.documentId || candidate.storagePath === original.storagePath) {
        return { outcome: 'conflict' };
      }
      const row = this.database.prepare<[string, string, string], InvoiceDocumentRow>(`
        SELECT * FROM invoice_documents
        WHERE company_id = ? AND invoice_id = ? AND source_document_id = ?
          AND binding_kind = 'preservedLegacy' AND document_type = 'approved_invoice_pdf'
      `).get(scope.companyId, scope.invoiceId, source.documentId);
      if (row !== undefined) {
        const existing = validateStoredDocument(this.database, row);
        if (existing.binding.kind !== 'preservedLegacy') throw new InvoiceDocumentIntegrityError();
        return { outcome: 'existing', document: { ...existing, binding: existing.binding } };
      }
      if (this.hasCandidateCollision(candidate)) return { outcome: 'conflict' };
      const document: PreservedLegacyInvoiceDocumentMetadata = {
        ...candidateMetadata(scope, candidate),
        binding: { kind: 'preservedLegacy', sourceDocumentId: source.documentId },
      };
      this.insert(document);
      return { outcome: 'published', document };
    }).immediate();
  }

  private isCurrentRevision(key: InvoiceRevisionKey): boolean {
    return this.database.prepare<[string, string, string], { id: string }>(`
      SELECT r.id FROM invoice_current_revisions c
      JOIN invoices i ON i.company_id = c.company_id AND i.id = c.invoice_id
      JOIN invoice_content_revisions r ON r.company_id = c.company_id
        AND r.invoice_id = c.invoice_id AND r.id = c.revision_id
      WHERE c.company_id = ? AND c.invoice_id = ? AND c.revision_id = ?
        AND i.status IN ('approved', 'sent')
        AND r.origin IN ('approval', 'validatedLegacySnapshot')
        AND r.vat_breakdown_state = 'authoritative'
    `).get(key.companyId, key.invoiceId, key.revisionId) !== undefined;
  }

  private readForRevision(key: InvoiceRevisionKey): RevisionInvoiceDocumentMetadata | undefined {
    const row = this.database.prepare<[string, string, string], InvoiceDocumentRow>(`
      SELECT * FROM invoice_documents WHERE company_id = ? AND invoice_id = ? AND revision_id = ?
        AND binding_kind = 'revision' AND document_type = 'approved_invoice_pdf'
    `).get(key.companyId, key.invoiceId, key.revisionId);
    if (row === undefined) return undefined;
    const document = validateStoredDocument(this.database, row);
    if (document.binding.kind !== 'revision') throw new InvoiceDocumentIntegrityError();
    return { ...document, binding: document.binding };
  }

  private readById(key: InvoiceDocumentKey): StoredInvoiceDocumentMetadata | undefined {
    return readInvoiceDocumentMetadata(this.database, key);
  }

  private hasCandidateCollision(candidate: InvoiceDocumentCandidate): boolean {
    return this.database.prepare<[string, string], { id: string }>(`
      SELECT id FROM invoice_documents WHERE id = ? OR storage_path = ? LIMIT 1
    `).get(candidate.id, candidate.storagePath) !== undefined;
  }

  private insert(document: RevisionInvoiceDocumentMetadata | PreservedLegacyInvoiceDocumentMetadata): void {
    this.database.prepare<NewInvoiceDocumentRow>(`
      INSERT INTO invoice_documents (
        id, company_id, invoice_id, document_type, file_name, storage_path, mime_type,
        sha256, size_bytes, created_at, binding_kind, revision_id, source_document_id
      ) VALUES (
        @id, @company_id, @invoice_id, @document_type, @file_name, @storage_path, @mime_type,
        @sha256, @size_bytes, @created_at, @binding_kind, @revision_id, @source_document_id
      )
    `).run(toInvoiceDocumentRow(document));
  }
}

function candidateMetadata(scope: InvoiceScope, candidate: InvoiceDocumentCandidate): ApprovedInvoiceDocumentMetadata {
  return {
    id: candidate.id, companyId: scope.companyId, invoiceId: scope.invoiceId,
    documentType: approvedInvoicePdfDocumentType, mimeType: approvedInvoicePdfMimeType,
    fileName: candidate.fileName, storagePath: candidate.storagePath,
    sha256: candidate.sha256, sizeBytes: candidate.sizeBytes, createdAt: candidate.createdAt,
  };
}
