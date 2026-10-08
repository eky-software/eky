import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDatabases, removeDirectories, snapshots, type Row } from './invoiceContentRevisionMigration.fixture.js';
import { createSnapshotDatabase, header, line, publish, reverse, vat } from './invoiceContentRevisionMigrationSnapshot.fixture.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('invoice content revision migration: complete snapshot publication', () => {
  it('publishes a complete new revision and allows the same line identity in another revision', async () => {
    const db = await createSnapshotDatabase();
    publish(db);
    publish(db, header(db, { id: 'next-revision' }), [line({ revision_id: 'next-revision' })], [vat({ revision_id: 'next-revision' })]);

    expect(db.prepare("SELECT line_id FROM invoice_revision_lines WHERE line_id = 'same-line'").all()).toHaveLength(2);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects a partial nullable reference pair rather than accepting SQL UNKNOWN', async () => {
    const db = await createSnapshotDatabase();
    const before = snapshots(db);

    expect(() => publish(db, header(db, { reference_number_type: null }))).toThrow();
    expect(snapshots(db)).toEqual(before);
  });

  it.each(
    [
      ['missing rows', {}, [], [vat()]],
      ['missing VAT', {}, [line()], []],
      ['wrong total', { total_net_cents: 101, total_gross_cents: 126 }, [line()], [vat()]],
      [
        'extra group',
        {},
        [line()],
        [vat(), vat({ vat_rate_basis_points: 1000, net_cents: 0, vat_cents: 0, gross_cents: 0 })],
      ],
      ['missing group', {}, [line({ vat_rate_basis_points: 1000 })], [vat()]],
      ['wrong child company', {}, [line({ company_id: 'other-company' })], [vat()]],
      ['wrong child invoice', {}, [line({ invoice_id: 'other' })], [vat()]],
      ['null VAT in normal', {}, [line({ vat_rate_basis_points: null })], [vat()]],
      ['unsafe integer', {}, [line({ unit_price_cents: 9007199254740992 })], [vat()]],
      ['fraction', {}, [line({ quantity_hundredths: 1.5 })], [vat()]],
      ['incomplete source pair', {}, [line({ source_invoice_line_id: 'line-1' })], [vat()]],
      ['invalid performance pair', { performance_period_start: '2026-01-01' }, [line()], [vat()]],
    ] as [string, Row, Row[], Row[]][],
  )('rejects invalid publication atomically: %s', async (_label, h, ls, vs) => {
    const db = await createSnapshotDatabase();
    const before = snapshots(db);

    expect(() => publish(db, header(db, h), ls, vs)).toThrow();
    expect(snapshots(db)).toEqual(before);
  });

  it('preserves standard group rounding rather than requiring line VAT to sum to the header', async () => {
    const db = await createSnapshotDatabase();
    publish(
      db,
      header(db, { total_net_cents: 4, total_vat_cents: 1, total_gross_cents: 5 }),
      [
        line({ unit_price_cents: 2, base_cents: 2, net_cents: 2, vat_cents: 0, gross_cents: 2 }),
        line({
          line_id: 'small2',
          line_order: 2,
          unit_price_cents: 2,
          base_cents: 2,
          net_cents: 2,
          vat_cents: 0,
          gross_cents: 2,
        }),
      ],
      [vat({ net_cents: 4, vat_cents: 1, gross_cents: 5 })],
    );

    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('allows empty known reverse-charge VAT but distinguishes unavailable legacy VAT', async () => {
    const db = await createSnapshotDatabase();
    publish(db, header(db, reverse),
      [line({ vat_rate_basis_points: null, vat_cents: 0, gross_cents: 100 })], []);

    expect(db.prepare("SELECT vat_breakdown_state FROM invoice_content_revisions WHERE id = 'new-revision'").get())
      .toEqual({ vat_breakdown_state: 'authoritative' });
    expect(() => publish(
      db,
      header(db, { ...reverse, id: 'missing-reverse' }),
      [
        line({
          revision_id: 'missing-reverse',
          vat_rate_basis_points: null,
          vat_cents: 0,
          gross_cents: 100,
        }),
      ],
      [vat({ revision_id: 'missing-reverse', net_cents: 100, vat_cents: 0, gross_cents: 100 })],
    ))
      .toThrow();
  });

  it.each(
    [
      { price_input_mode: 'gross' },
      { tax_treatment_label_snapshot: '' },
      { tax_legal_basis_snapshot: '' },
      { tax_treatment_label_snapshot: 'Wrong label' },
      { tax_legal_basis_snapshot: 'Wrong law' },
    ],
  )
    ('retains the existing reverse-charge variant contract: %j', async invalid => {
      const db = await createSnapshotDatabase();
      const before = snapshots(db);

      expect(() => publish(db, header(db, { ...reverse, ...invalid }), [line({ vat_rate_basis_points: null, vat_cents: 0, gross_cents: 100 })], []))
        .toThrow();
      expect(snapshots(db)).toEqual(before);
    });
});
