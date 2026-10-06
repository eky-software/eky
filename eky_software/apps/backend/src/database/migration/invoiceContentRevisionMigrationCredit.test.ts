import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { InvoiceContentRevisionRow } from '../schema.js';
import { closeDatabases, removeDirectories, snapshots } from './invoiceContentRevisionMigration.fixture.js';
import { createSnapshotDatabase, header, line, publish, vat } from './invoiceContentRevisionMigrationSnapshot.fixture.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('invoice content revision migration: credit source revision integrity', () => {
  it('binds credit to an observed legacy source without promoting it or using live line IDs alone', async () => {
    const db = await createSnapshotDatabase();
    const source = db.prepare<[], InvoiceContentRevisionRow>(
      "SELECT * FROM invoice_content_revisions WHERE invoice_id = 'invoice-1'",
    ).get()!;
    const h = header(
      db,
      {
        invoice_id: 'credit',
        invoice_kind: 'credit',
        credited_invoice_id: 'invoice-1',
        credited_revision_id: source.id,
        credited_invoice_number_snapshot: source.invoice_number,
        credited_invoice_date_snapshot: source.invoice_date,
      },
    );
    publish(
      db,
      h,
      [
        line({ invoice_id: 'credit', source_revision_id: source.id, source_invoice_line_id: 'line-1' }),
      ],
      [vat({ invoice_id: 'credit' })],
    );

    expect(db.prepare('SELECT origin FROM invoice_content_revisions WHERE id = ?').get(source.id)).toEqual({ origin: 'legacySnapshot' });
    for (const overrides of [{ source_revision_id: 'missing' }, { source_invoice_line_id: 'missing' }]) {
      expect(() => publish(
        db,
        { ...h, id: 'invalid-credit' },
        [
          line(
            {
              invoice_id: 'credit',
              revision_id: 'invalid-credit',
              source_revision_id: source.id,
              source_invoice_line_id: 'line-1',
              ...overrides,
            },
          ),
        ],
        [vat({ invoice_id: 'credit', revision_id: 'invalid-credit' })],
      ))
        .toThrow();
    }

    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps free credit lines source-less and prevents a standard revision having a source line', async () => {
    const db = await createSnapshotDatabase();
    const source = db.prepare<[], InvoiceContentRevisionRow>(
      "SELECT * FROM invoice_content_revisions WHERE invoice_id = 'invoice-1'",
    ).get()!;
    publish(
      db,
      header(
        db,
        {
          invoice_id: 'credit',
          invoice_kind: 'credit',
          credited_invoice_id: 'invoice-1',
          credited_revision_id: source.id,
          credited_invoice_number_snapshot: source.invoice_number,
          credited_invoice_date_snapshot: source.invoice_date,
        },
      ),
      [line({ invoice_id: 'credit' })],
      [vat({ invoice_id: 'credit' })],
    );

    expect(() => publish(
      db,
      header(db, { id: 'invalid-standard' }),
      [
        line({
          revision_id: 'invalid-standard',
          source_revision_id: source.id,
          source_invoice_line_id: 'line-1',
        }),
      ],
      [vat({ revision_id: 'invalid-standard' })],
    ))
      .toThrow();
  });

  it.each([
    'other-source-revision',
    'other-source-company',
    'different-number',
    'different-date',
    'credit-source',
  ])
    ('rejects an existing but wrong credit tuple: %s', async variant => {
      const db = await createSnapshotDatabase();
      publish(db, header(db), [line({ line_id: 'line-1' })], [vat()]);
      const foreign = header(db, { id: 'foreign-revision', company_id: 'other-company', invoice_id: 'foreign' });
      publish(
        db,
        foreign,
        [
          line({
            revision_id: 'foreign-revision',
            company_id: 'other-company',
            invoice_id: 'foreign',
            line_id: 'line-1',
          }),
        ],
        [
          vat({ revision_id: 'foreign-revision', company_id: 'other-company', invoice_id: 'foreign' }),
        ],
      );
      const source = db.prepare<[], InvoiceContentRevisionRow>(
        "SELECT * FROM invoice_content_revisions WHERE invoice_id = 'invoice-1' AND origin = 'legacySnapshot'",
      )
        .get()!;
      const credit = db.prepare<[], InvoiceContentRevisionRow>(
        "SELECT * FROM invoice_content_revisions WHERE invoice_id = 'credit'",
      ).get()!;
      const foreignRevision = db.prepare<[], InvoiceContentRevisionRow>(
        "SELECT * FROM invoice_content_revisions WHERE id = 'foreign-revision'",
      ).get()!;
      const invoiceId = variant === 'credit-source' ? 'other' : 'credit';
      const h = header(
        db,
        {
          id: 'invalid-credit',
          invoice_id: 'credit',
          invoice_kind: 'credit',
          credited_invoice_id: 'invoice-1',
          credited_revision_id: source.id,
          credited_invoice_number_snapshot: source.invoice_number,
          credited_invoice_date_snapshot: source.invoice_date,
          ...(variant === 'different-number' ? { credited_invoice_number_snapshot: 'different' } : {}),
          ...(variant === 'different-date' ? { credited_invoice_date_snapshot: '2026-01-01' } : {}),
          ...(variant === 'other-source-company' ? {
            credited_invoice_id: 'foreign',
            credited_revision_id: foreignRevision.id,
            credited_invoice_number_snapshot: foreignRevision.invoice_number,
            credited_invoice_date_snapshot: foreignRevision.invoice_date,
          } : {}),
          ...(variant === 'credit-source' ? {
            invoice_id: 'other',
            credited_invoice_id: 'credit',
            credited_revision_id: credit.id,
            credited_invoice_number_snapshot: credit.invoice_number,
            credited_invoice_date_snapshot: credit.invoice_date,
          } : {}),
        },
      );
      const ls = [
        line(
          {
            invoice_id: invoiceId,
            revision_id: 'invalid-credit',
            source_invoice_line_id: variant === 'credit-source' ? null : 'line-1',
            source_revision_id: variant === 'credit-source' ? null : variant === 'other-source-revision' ? 'new-revision' : variant === 'other-source-company' ? 'foreign-revision' : source.id,
          },
        ),
      ];
      const before = snapshots(db);

      expect(() => publish(db, h, ls, [vat({ invoice_id: invoiceId, revision_id: 'invalid-credit' })])).toThrow();
      expect(snapshots(db)).toEqual(before);
    });
});
