import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDatabases, insert, oldState, removeDirectories, snapshots } from './invoiceContentRevisionMigration.fixture.js';
import { createSnapshotDatabase, header, line, publish, vat } from './invoiceContentRevisionMigrationSnapshot.fixture.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('invoice content revision migration: published snapshot immutability', () => {
  it('keeps published document/event bindings on their exact full revision after advancing current', async () => {
    const db = await createSnapshotDatabase();
    publish(db);
    insert(
      db,
      'invoice_documents',
      {
        id: 'bound-document',
        company_id: 'dev-company',
        invoice_id: 'invoice-1',
        document_type: 'approved_invoice_pdf',
        file_name: 'new.pdf',
        storage_path: 'synthetic/new.pdf',
        mime_type: 'application/pdf',
        sha256: 'b'.repeat(64),
        size_bytes: 80,
        created_at: '2026-10-05T00:00:00Z',
        binding_kind: 'revision',
        revision_id: 'new-revision',
        source_document_id: null,
      },
    );
    insert(
      db,
      'invoice_delivery_events',
      {
        id: 'bound-event',
        company_id: 'dev-company',
        invoice_id: 'invoice-1',
        document_id: 'bound-document',
        delivery_method: 'email',
        provider: 'smtp',
        status: 'succeeded',
        created_at: '2026-10-05T00:00:00Z',
        binding_kind: 'revision',
        revision_id: 'new-revision',
        send_mode: 'smtpTest',
        document_sha256: 'b'.repeat(64),
        document_size_bytes: 80,
      },
    );
    const before = oldState(db);
    publish(
      db,
      header(db, { id: 'next-revision', subject: 'New content' }),
      [line({ revision_id: 'next-revision' })],
      [vat({ revision_id: 'next-revision' })],
    );
    db.prepare("UPDATE invoice_current_revisions SET revision_id = 'next-revision' WHERE invoice_id = 'invoice-1'").run();

    expect(oldState(db).invoice_documents).toEqual(before.invoice_documents);
    expect(oldState(db).invoice_delivery_events).toEqual(before.invoice_delivery_events);
    expect(
      db.prepare(
        `SELECT r.subject FROM invoice_delivery_events e
      JOIN invoice_content_revisions r ON r.company_id = e.company_id AND r.invoice_id = e.invoice_id AND r.id = e.revision_id
      WHERE e.id = 'bound-event'`,
      )
        .get(),
    )
      .toEqual({ subject: 'Snapshot invoice' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['invoice_revision_lines', 'invoice_revision_vat_breakdown'])('cannot commit an orphan collection in %s', async table => {
    const db = await createSnapshotDatabase();
    const before = snapshots(db);

    expect(() => db.transaction(() => insert(db, table, table.endsWith('lines') ? line() : vat())).immediate()).toThrow();
    expect(db.inTransaction).toBe(false);
    expect(snapshots(db)).toEqual(before);
  });

  it.each([
    'invoice_content_revisions',
    'invoice_revision_lines',
    'invoice_revision_vat_breakdown',
  ])('rejects updates, deletes and replacement in %s', async table => {
    const db = await createSnapshotDatabase();
    publish(db);
    const before = snapshots(db);
    for (const sql of [`UPDATE ${table} SET company_id = company_id`, `DELETE FROM ${table}`]) {
      expect(() => db.exec(sql)).toThrow();
    }
    const value = table === 'invoice_content_revisions' ? header(db) : table.endsWith('lines') ? line() : vat();

    expect(() => insert(db, table, value, true)).toThrow();
    expect(snapshots(db)).toEqual(before);
  });

  it('cannot append lines or VAT to a sealed revision, even without a duplicate key', async () => {
    const db = await createSnapshotDatabase();
    publish(db);
    const before = snapshots(db);

    expect(() => insert(db, 'invoice_revision_lines', line({ line_id: 'late', line_order: 2 }))).toThrow();
    expect(() => insert(db, 'invoice_revision_vat_breakdown', vat({ vat_rate_basis_points: 1000 }))).toThrow();
    expect(snapshots(db)).toEqual(before);
  });

  it.each(['invoice_revision_lines', 'invoice_revision_vat_breakdown'])('rejects hidden rowid replacement from a different revision in %s', async table => {
    const db = await createSnapshotDatabase();
    publish(db);
    const before = snapshots(db);
    // A hidden rowid would allow replacement without the child's DELETE trigger.
    const hasRowid = !(db.prepare<[string], { wr: number }>('SELECT wr FROM pragma_table_list WHERE name = ?').get(table)?.wr);
    const oldRowid = hasRowid ? db.prepare<[], { rowid: number }>(`SELECT rowid FROM ${table} WHERE revision_id = 'new-revision'`).get()!.rowid : 1;

    expect(() => db.transaction(() => {
      const l = line({ revision_id: 'rowid-revision' });
      const v = vat({ revision_id: 'rowid-revision' });
      insert(db, 'invoice_revision_lines', table.endsWith('lines') ? { rowid: oldRowid, ...l } : l, true);
      insert(db, 'invoice_revision_vat_breakdown', table.endsWith('lines') ? v : { rowid: oldRowid, ...v }, true);
      insert(db, 'invoice_content_revisions', header(db, { id: 'rowid-revision' }));
    })
      .immediate())
      .toThrow();
    expect(snapshots(db)).toEqual(before);
  });

  it('never inserts new legacy provenance or mutates a revision through current status/payment changes', async () => {
    const db = await createSnapshotDatabase();
    publish(db);
    const before = snapshots(db);
    db.prepare("UPDATE invoices SET subject = 'Changed live', payment_state = 'unpaid' WHERE id = 'invoice-1'").run();

    expect(snapshots(db)).toEqual(before);
    expect(() => publish(
      db,
      header(db, { id: 'forged-legacy', origin: 'legacySnapshot', vat_breakdown_state: 'unavailable' }),
      [line({ revision_id: 'forged-legacy' })],
      [],
    ))
      .toThrow();
  });
});
