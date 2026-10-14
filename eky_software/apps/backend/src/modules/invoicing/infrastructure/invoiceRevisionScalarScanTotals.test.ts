import { afterEach, describe, expect, it } from 'vitest';

import { insert } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { invoiceRevisionHeaderScanSql, invoiceRevisionLineScanSql, invoiceRevisionVatScanSql } from './invoiceRevisionScalarScanSql.js';
import { bypassReaderFixtureConstraints } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { closePublicationDatabases, createPublicationFixture, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { validateInvoiceRevisionScalars } from './validateInvoiceRevisionScalars.js';

afterEach(closePublicationDatabases);

describe('bounded revision scalar aggregate traversal', () => {
  it('visits a large line collection and rejects its later corruption without returning keys or large text', async () => {
    const database = openPublicationDatabase();
    await createPublicationFixture(database);
    const original = database.prepare('SELECT * FROM invoice_revision_lines').get() as Record<string, string | number | null>;
    bypassReaderFixtureConstraints(database, 'invoice_revision_lines', () => {
      database.transaction(() => {
        for (let index = 4; index <= 1002; index++) insert(database, 'invoice_revision_lines', {
          ...original, line_id: `line-${index}`, line_order: index,
        });
      })();
    });
    const check = database.transaction(() => validateInvoiceRevisionScalars(database));
    expect(check).not.toThrow();
    let count = 0;
    for (const row of database.prepare(invoiceRevisionLineScanSql).iterate() as Iterable<Record<string, unknown>>) {
      expect(Object.keys(row)).not.toContain('line_id');
      expect(Object.keys(row)).not.toContain('revision_id');
      count++;
    }
    expect(count).toBe(1002);
    bypassReaderFixtureConstraints(database, 'invoice_revision_lines', () => {
      database.exec('UPDATE invoice_revision_lines SET quantity_hundredths = -1 WHERE line_order = 1002');
    });
    const before = database.serialize();
    expect(check).toThrow(InvoiceContentRevisionIntegrityError);
    expect(database.serialize().equals(before)).toBe(true);
  });

  it('accumulates VAT in exact integer arithmetic at the safe-number boundary', async () => {
    const database = openPublicationDatabase();
    await createPublicationFixture(database);
    const maximum = Number.MAX_SAFE_INTEGER;
    bypassReaderFixtureConstraints(database, 'invoice_content_revisions', () => {
      database.prepare(`UPDATE invoice_content_revisions SET total_net_cents = ?, total_vat_cents = 1, total_gross_cents = ?`)
        .run(maximum - 1, maximum);
    });
    bypassReaderFixtureConstraints(database, 'invoice_revision_vat_breakdown', () => {
      database.exec('UPDATE invoice_revision_vat_breakdown SET net_cents = 0, vat_cents = 0, gross_cents = 0');
      database.prepare(`UPDATE invoice_revision_vat_breakdown SET net_cents = ?, vat_cents = 1, gross_cents = ?
        WHERE vat_rate_basis_points = (SELECT vat_rate_basis_points FROM invoice_revision_vat_breakdown LIMIT 1)`)
        .run(maximum - 1, maximum);
    });
    const check = database.transaction(() => validateInvoiceRevisionScalars(database));
    expect(check).not.toThrow();
    // Floating-point addition would round MAX_SAFE_INTEGER + 2 to a representable
    // value; no such arithmetic may be used to validate stored group totals.
    bypassReaderFixtureConstraints(database, 'invoice_revision_vat_breakdown', () => {
      database.prepare('UPDATE invoice_revision_vat_breakdown SET net_cents = ?, vat_cents = 2, gross_cents = ?')
        .run(maximum, maximum);
    });
    expect(check).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('uses typed projections rather than coercing numeric or date BLOBs into valid scalars', async () => {
    const database = openPublicationDatabase();
    await createPublicationFixture(database);
    for (const query of [invoiceRevisionHeaderScanSql, invoiceRevisionLineScanSql, invoiceRevisionVatScanSql]) {
      expect(query).not.toMatch(/\bSUM\s*\(|\bSELECT\s+\*|\bOFFSET\b/i);
    }
    bypassReaderFixtureConstraints(database, 'invoice_revision_lines', () => {
      database.exec("UPDATE invoice_revision_lines SET vat_rate_basis_points = CAST('2550' AS BLOB)");
    });
    expect(database.transaction(() => validateInvoiceRevisionScalars(database)))
      .toThrow(InvoiceContentRevisionIntegrityError);
  });
});
