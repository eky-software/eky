import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';
import {
  bypassReaderFixtureConstraints, corruptStoredReaderRow, deleteStoredReaderRows, totalChanges,
} from './sqliteInvoiceContentRevisionReader.fixture.js';
import {
  closePublicationDatabases, createPublicationFixture, openPublicationDatabase, setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';
import { invoiceHistoryRelationSources, invoiceHistoryRelationScanSql } from './invoiceHistoryRelationScan.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });

describe('catalog relation encoding integration', () => {
  it.each(['80', 'c080', 'eda080', 'f4908080', 'e282'])(
    'rejects malformed legacy-snapshot IDs before whole history is read: %s', async hex => {
      const database = await legacySnapshot();
      bypassReaderFixtureConstraints(database, 'invoice_content_revisions', () => {
        database.prepare('UPDATE invoice_content_revisions SET id = CAST(? AS TEXT)').run(Buffer.from(hex, 'hex'));
      });
      const before = database.serialize();
      const changes = totalChanges(database);
      database.pragma('query_only = ON');
      const prepare = vi.spyOn(database, 'prepare');
      await expect(catalog(database).listAuthoritativeArtifacts()).rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
      expect(prepare.mock.calls.some(([sql]) => /SELECT \* FROM invoices/.test(sql))).toBe(false);
      expect(totalChanges(database)).toBe(changes);
      expect(database.serialize()).toEqual(before);
      expect(database.inTransaction).toBe(false);
    },
  );

  it.each(['a\u0000b', '\uFEFF\u{1f600}\uFFFD', 'e\u0301', 'long-'.repeat(4096)])(
    'retains previously valid legacy-snapshot relation text: case %#', async id => {
      const database = await legacySnapshot();
      bypassReaderFixtureConstraints(database, 'invoice_content_revisions', () => {
        database.prepare('UPDATE invoice_content_revisions SET id = ?').run(id);
      });
      const before = database.serialize();
      await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
      expect(database.serialize()).toEqual(before);
    },
  );

  it('retains free-text replacement-decoding behavior rather than silently repairing or rejecting it', async () => {
    const database = await legacySnapshot();
    bypassReaderFixtureConstraints(database, 'invoice_content_revisions', () => {
      database.exec("UPDATE invoice_content_revisions SET note = CAST(x'80e282' AS TEXT), customer_id = CAST(x'80' AS TEXT)");
    });
    const before = database.serialize();
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
    expect(database.serialize()).toEqual(before);
  });

  it('uses the real migration keys without a sort or materialized traversal table', async () => {
    const database = openPublicationDatabase();
    await createPublicationFixture(database);
    for (const source of Object.keys(invoiceHistoryRelationSources) as (keyof typeof invoiceHistoryRelationSources)[]) {
      const plan = database.prepare('EXPLAIN QUERY PLAN ' + invoiceHistoryRelationScanSql(source))
        .all({ chunkBytes: 16 }) as { detail: string }[];
      expect(plan.some(row => row.detail === 'CO-ROUTINE scan')).toBe(true);
      expect(plan.some(row => /SEARCH next_row.*(?:PRIMARY KEY|INDEX)/.test(row.detail))).toBe(true);
      expect(plan.some(row => /MATERIALIZE scan|TEMP B-TREE|AUTOMATIC.*INDEX/.test(row.detail))).toBe(false);
    }
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
  });
});

function catalog(database: DatabaseConnection): SqliteInvoiceBackupArtifactCatalog {
  return new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory');
}

async function legacySnapshot(): Promise<DatabaseConnection> {
  const database = openPublicationDatabase();
  const fixture = await createPublicationFixture(database);
  for (const table of ['invoice_current_revisions', 'invoice_revision_lines', 'invoice_revision_vat_breakdown'] as const) {
    deleteStoredReaderRows(database, table, { revision_id: fixture.key.revisionId });
  }
  setInvoiceStatus(database, fixture.key, 'reopened_for_edit');
  corruptStoredReaderRow(database, 'invoice_content_revisions', { id: fixture.key.revisionId }, {
    origin: 'legacySnapshot', vat_breakdown_state: 'unavailable',
  });
  return database;
}
