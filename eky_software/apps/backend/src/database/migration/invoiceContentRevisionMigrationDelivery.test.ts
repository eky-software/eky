import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDatabases, insert, removeDirectories } from './invoiceContentRevisionMigration.fixture.js';
import { bindingState, createBoundRevisionDatabase, documentRow, eventRow } from './invoiceContentRevisionMigrationBinding.fixture.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('invoice content revision migration: delivery event binding and outcomes', () => {
  it.each(
    [
      ['null document', { document_id: null }],
      ['null revision', { revision_id: null }],
      ['wrong revision', { revision_id: 'revision-2' }],
      ['wrong invoice', { invoice_id: 'invoice-2' }],
      ['wrong company', { company_id: 'other-company' }],
      ['wrong binding kind', { binding_kind: 'preservedLegacy', revision_id: null }],
      [
        'legacy document as preserved',
        { binding_kind: 'preservedLegacy', revision_id: null, document_id: 'doc-old' },
      ],
      ['wrong hash', { document_sha256: 'b'.repeat(64) }],
      ['wrong size', { document_size_bytes: 65 }],
      ['null hash', { document_sha256: null }],
      ['null size', { document_size_bytes: null }],
      ['unknown new mode', { send_mode: 'legacyUnknown' }],
      ['wrong provider', { provider: 'manual' }],
      ['wrong method', { delivery_method: 'manual' }],
      ['test with dry-run provider', { send_mode: 'smtpTest', provider: 'dryRun' }],
      [
        'new legacy event',
        {
          binding_kind: 'legacyOriginal',
          revision_id: null,
          document_sha256: null,
          document_size_bytes: null,
          send_mode: 'legacyUnknown',
        },
      ],
    ] as const,
  )('rejects invalid event binding: %s', async (_name, override) => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    const before = bindingState(db);

    expect(() => insert(db, 'invoice_delivery_events', eventRow(override))).toThrow();
    expect(bindingState(db)).toEqual(before);
  });

  it('blocks multiple NEW unresolved SMTP events across revisions while retaining historical unknowns', async () => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(
      db,
      'invoice_documents',
      documentRow({ id: 'doc-second', revision_id: 'revision-2', storage_path: 'synthetic/second.pdf' }),
    );
    insert(db, 'invoice_delivery_events', eventRow());

    expect(() => insert(
      db,
      'invoice_delivery_events',
      eventRow(
        {
          id: 'second',
          send_mode: 'smtpTest',
          status: 'outcomeUnknown',
          document_id: 'doc-second',
          revision_id: 'revision-2',
        },
      ),
    ))
      .toThrow();
    db.prepare("UPDATE invoice_delivery_events SET status = 'outcomeUnknown' WHERE id = 'event-new'").run();

    expect(() => insert(db, 'invoice_delivery_events', eventRow({ id: 'second', send_mode: 'smtpTest' }))).toThrow();
    db.prepare("UPDATE invoice_delivery_events SET status = 'failed' WHERE id = 'event-new'").run();
    insert(db, 'invoice_delivery_events', eventRow({ id: 'second', send_mode: 'smtpTest' }));

    expect(
      db.prepare("SELECT id FROM invoice_delivery_events WHERE binding_kind = 'legacyOriginal' AND status = 'outcomeUnknown'")
        .all(),
    )
      .toHaveLength(2);
    // This schema-only direct insertion does NOT prove the runtime legacy/status/current guards.
    // Those must reject provider calls within the existing immediate reservation transaction.
  });

  it('keeps manual and dry-run events distinct from SMTP reservations', async () => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(
      db,
      'invoice_delivery_events',
      eventRow({
        id: 'manual',
        send_mode: 'manual',
        provider: 'manual',
        delivery_method: 'print',
        status: 'succeeded',
      }),
    );
    insert(
      db,
      'invoice_delivery_events',
      eventRow({ id: 'dry', send_mode: 'dryRun', provider: 'dryRun', status: 'succeeded' }),
    );
    insert(db, 'invoice_delivery_events', eventRow());

    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each([
    { provider: 'other', delivery_method: 'print' },
    { provider: 'manual', delivery_method: 'other' },
  ])('rejects new manual combinations absent from the current caller: %j', async (override) => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());

    expect(() => insert(db, 'invoice_delivery_events', eventRow({ send_mode: 'manual', status: 'succeeded', ...override })))
      .toThrow(/CHECK constraint failed/);
  });

  it.each(['status', 'provider_message_id', 'safe_error_message', 'technical_error_code'])('freezes migrated legacy outcome: %s', async (field) => {
    const db = await createBoundRevisionDatabase();
    const before = bindingState(db);

    expect(() => db.prepare(`UPDATE invoice_delivery_events SET ${field} = ? WHERE id = 'event-unknown-1'`)
      .run(field === 'status' ? 'failed' : 'changed'))
      .toThrow('INVOICE_DELIVERY_BINDING_IMMUTABLE');
    expect(bindingState(db)).toEqual(before);
  });

  it('prevents document mutation and event rebinding without blocking completion fields', async () => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(db, 'invoice_delivery_events', eventRow());
    const before = bindingState(db);

    for (const sql of [
      "UPDATE invoice_documents SET file_name = 'changed.pdf' WHERE id = 'doc-new'",
      "DELETE FROM invoice_documents WHERE id = 'doc-new'",
    ]) {
      expect(() => db.exec(sql)).toThrow('INVOICE_DOCUMENT_IMMUTABLE');
      expect(bindingState(db)).toEqual(before);
    }
    for (const sql of [
      "UPDATE invoice_delivery_events SET revision_id = NULL WHERE id = 'event-new'",
      "UPDATE invoice_delivery_events SET recipient_email = 'changed@example.invalid' WHERE id = 'event-new'",
      "UPDATE invoice_delivery_events SET send_mode = 'smtpTest' WHERE id = 'event-new'",
    ]) {
      expect(() => db.exec(sql)).toThrow('INVOICE_DELIVERY_BINDING_IMMUTABLE');
      expect(bindingState(db)).toEqual(before);
    }

    expect(() => db.exec("DELETE FROM invoice_delivery_events WHERE id = 'event-new'"))
      .toThrow('INVOICE_DELIVERY_IMMUTABLE');
    expect(bindingState(db)).toEqual(before);

    db.prepare(
      "UPDATE invoice_delivery_events SET status = 'succeeded', provider_message_id = 'synthetic' WHERE id = 'event-new'",
    )
      .run();

    expect(db.prepare("SELECT status FROM invoice_delivery_events WHERE id = 'event-new'").get()).toEqual({ status: 'succeeded' });
  });

  it.each([
    ['recipient_email', 'changed@example.invalid'],
    ['cc_email', 'copy@example.invalid'],
    ['subject', 'Changed synthetic subject'],
    ['body_preview', 'Changed synthetic preview'],
    ['created_at', '2026-07-02T00:00:00Z'],
    ['created_by', 'different-synthetic-actor'],
  ] as const)('freezes the new event message field %s independently of legacy rows', async (field, value) => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(db, 'invoice_delivery_events', eventRow());
    const before = bindingState(db);

    expect(() => db.prepare(`UPDATE invoice_delivery_events SET ${field} = ? WHERE id = 'event-new'`).run(value)).toThrow('INVOICE_DELIVERY_BINDING_IMMUTABLE');

    expect(bindingState(db)).toEqual(before);
  });

  it('rejects rebinding a new event to a valid alternate document and revision', async () => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(db, 'invoice_documents', documentRow({
      id: 'doc-second',
      revision_id: 'revision-2',
      storage_path: 'synthetic/second.pdf',
    }));
    insert(db, 'invoice_delivery_events', eventRow());
    // A completed event proves the alternate tuple is valid without another reservation.
    insert(db, 'invoice_delivery_events', eventRow({
      id: 'alternate-event',
      document_id: 'doc-second',
      revision_id: 'revision-2',
      status: 'succeeded',
    }));

    expect(db.pragma('foreign_key_check')).toEqual([]);
    const before = bindingState(db);

    expect(() => db.prepare(`
      UPDATE invoice_delivery_events
      SET document_id = 'doc-second', revision_id = 'revision-2'
      WHERE id = 'event-new'
    `).run()).toThrow('INVOICE_DELIVERY_BINDING_IMMUTABLE');

    expect(bindingState(db)).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each([{ send_mode: 'smtpTest' }, { id: 'replacement' }, { status: 'succeeded' }])(
    'rejects INSERT OR REPLACE across event ID or unresolved unique keys: %j', async (override) => {
      const db = await createBoundRevisionDatabase();
      insert(db, 'invoice_documents', documentRow());
      insert(db, 'invoice_delivery_events', eventRow());
      const beforeEvent = bindingState(db);

      expect(() => insert(db, 'invoice_delivery_events', eventRow(override), true)).toThrow();
      expect(bindingState(db)).toEqual(beforeEvent);
    });

  it('rejects UPDATE OR REPLACE deleting another unresolved event through the unique index', async () => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(db, 'invoice_delivery_events', eventRow());
    insert(db, 'invoice_delivery_events', eventRow({ id: 'previous', status: 'failed' }));
    const before = bindingState(db);

    expect(() => db.prepare("UPDATE OR REPLACE invoice_delivery_events SET status = 'attempted' WHERE id = 'previous'").run())
      .toThrow();
    expect(bindingState(db)).toEqual(before);
  });
});
