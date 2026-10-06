import type { MigrationHistoryInspection } from '../../../database/migration/migrationMetadata.js';

export type InvoiceBackupArtifactCatalogSchema = 'legacyDocuments' | 'revisionHistory';

export const invoiceContentRevisionMigrationName = '039_add_invoice_content_revisions.sql';
const invoiceDocumentsMigrationName = '018_create_invoice_documents.sql';
const localRuntimeIdentityMigrationName = '025_create_local_runtime_identity.sql';

// The caller has already verified this applied prefix against its migration manifest.
export function selectInvoiceBackupArtifactCatalogSchema(
  history: Pick<MigrationHistoryInspection, 'appliedMigrationNames'>,
): InvoiceBackupArtifactCatalogSchema {
  const names = history.appliedMigrationNames;
  if (!names.includes(invoiceDocumentsMigrationName) || !names.includes(localRuntimeIdentityMigrationName)) {
    throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  }
  return names.includes(invoiceContentRevisionMigrationName) ? 'revisionHistory' : 'legacyDocuments';
}
