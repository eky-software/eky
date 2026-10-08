import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readMigrationManifest } from '../../../database/migration/migrationManifest.js';
import {
  invoiceContentRevisionMigrationName,
  selectInvoiceBackupArtifactCatalogSchema,
} from './selectInvoiceBackupArtifactCatalogSchema.js';

const names = readMigrationManifest(fileURLToPath(new URL('../../../database/migrations/', import.meta.url)))
  .map((entry) => entry.fileName);

describe('selectInvoiceBackupArtifactCatalogSchema', () => {
  it.each([25, 26, 37, 38])('selects the old contract for an inspected %i-migration prefix', (count) => {
    expect(selectInvoiceBackupArtifactCatalogSchema({ appliedMigrationNames: names.slice(0, count) }))
      .toBe('legacyDocuments');
  });

  it.each([0, 17, 18, 24])('rejects an empty or too early %i-migration prefix', (count) => {
    expect(() => selectInvoiceBackupArtifactCatalogSchema({ appliedMigrationNames: names.slice(0, count) }))
      .toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  });

  it.each(['018_create_invoice_documents.sql', '025_create_local_runtime_identity.sql'])(
    'requires the named prerequisite %s, not the number of migrations', (name) => {
      expect(() => selectInvoiceBackupArtifactCatalogSchema({
        appliedMigrationNames: names.map((entry) => entry === name ? entry.replace('.sql', '_other.sql') : entry),
      })).toThrow('INVOICE_BACKUP_CATALOG_INVALID');
    },
  );

  it('selects revisions by the exact applied production filename', () => {
    expect(invoiceContentRevisionMigrationName).toBe('039_add_invoice_content_revisions.sql');
    expect(selectInvoiceBackupArtifactCatalogSchema({ appliedMigrationNames: names.slice(0, 39) }))
      .toBe('revisionHistory');
    expect(selectInvoiceBackupArtifactCatalogSchema({
      appliedMigrationNames: [...names.slice(0, 38), '039_other.sql'],
    })).toBe('legacyDocuments');
  });

  it('does not select a pending migration from the available manifest', () => {
    expect(names).toContain(invoiceContentRevisionMigrationName);
    expect(selectInvoiceBackupArtifactCatalogSchema({ appliedMigrationNames: names.slice(0, 38) }))
      .toBe('legacyDocuments');
  });

  it('keeps revision history when later manifest migrations are pending or applied', () => {
    const appliedMigrationNames = names.slice(0, 39);
    expect(selectInvoiceBackupArtifactCatalogSchema({ appliedMigrationNames })).toBe('revisionHistory');
    expect(selectInvoiceBackupArtifactCatalogSchema({
      appliedMigrationNames: [...appliedMigrationNames, '040_synthetic_later_change.sql'],
    })).toBe('revisionHistory');
    expect(appliedMigrationNames).toEqual(names.slice(0, 39));
  });
});
