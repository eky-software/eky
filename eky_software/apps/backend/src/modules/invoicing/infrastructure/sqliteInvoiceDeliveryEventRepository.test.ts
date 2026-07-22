import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type {
  InvoiceDeliveryEventRow,
} from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';

describe('SqliteInvoiceDeliveryEventRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertInvoice(database);
    insertInvoiceDocument(database);
  });

  afterEach(() => {
    database.close();
  });

  it('creates a company-scoped invoice delivery event table', () => {
    const table = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('invoice_delivery_events');

    expect(table?.name).toBe('invoice_delivery_events');
  });

  it('saves delivery event metadata without storing the full email body', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent();

    await expect(repository.saveDeliveryEvent(event)).resolves.toEqual(event);

    const storedEvent = database
      .prepare<[], InvoiceDeliveryEventRow>(
        'SELECT * FROM invoice_delivery_events',
      )
      .get();

    expect(storedEvent).toMatchObject({
      body_preview: 'Liitteenä lasku.',
      cc_email: 'copy@example.fi',
      company_id: 'dev-company',
      created_at: '2026-07-10T10:00:00.000Z',
      created_by: 'user-1',
      delivery_method: 'email',
      document_id: 'document-1',
      id: 'event-1',
      invoice_id: 'invoice-1',
      provider: 'dryRun',
      provider_message_id: null,
      recipient_email: 'customer@example.fi',
      safe_error_message: null,
      status: 'prepared',
      subject: 'Lasku 20260001',
      technical_error_code: null,
    });
  });

  it('completes an attempted event within the company boundary', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({ status: 'attempted' });
    await repository.saveDeliveryEvent(event);

    await repository.completeDeliveryEvent({
      companyId: event.companyId,
      eventId: event.id,
      providerMessageId: '<synthetic@example.test>',
      safeErrorMessage: null,
      status: 'succeeded',
      technicalErrorCode: null,
    });

    const row = database
      .prepare<[string], InvoiceDeliveryEventRow>(
        'SELECT * FROM invoice_delivery_events WHERE id = ?',
      )
      .get(event.id);

    expect(row?.status).toBe('succeeded');
    expect(row?.provider_message_id).toBe('<synthetic@example.test>');
  });

  it('atomically completes a successful SMTP event and marks an approved invoice sent', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({ provider: 'smtp', status: 'attempted' });
    await repository.saveDeliveryEvent(event);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'dev-company',
        eventId: event.id,
        invoiceId: event.invoiceId,
        providerMessageId: '<message@example.fi>',
        sentAt: '2026-07-10T10:01:00.000Z',
      }),
    ).resolves.toEqual({
      invoiceStatus: 'sent',
      updatedAt: '2026-07-10T10:01:00.000Z',
      wasResend: false,
    });

    expect(
      database
        .prepare<[string], { status: string; updated_at: string }>(
          'SELECT status, updated_at FROM invoices WHERE id = ?',
        )
        .get('invoice-1'),
    ).toEqual({
      status: 'sent',
      updated_at: '2026-07-10T10:01:00.000Z',
    });
    expect(
      database
        .prepare<[string], { provider_message_id: string; status: string }>(
          'SELECT provider_message_id, status FROM invoice_delivery_events WHERE id = ?',
        )
        .get(event.id),
    ).toEqual({
      provider_message_id: '<message@example.fi>',
      status: 'succeeded',
    });
  });

  it('finalizes a resend without changing the sent invoice identity or timestamp', async () => {
    database
      .prepare(
        `
          UPDATE invoices
          SET status = 'sent', updated_at = '2026-07-10T09:30:00.000Z'
          WHERE id = 'invoice-1'
        `,
      )
      .run();
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({
      id: 'resend-event-1',
      provider: 'smtp',
      status: 'attempted',
    });
    await repository.saveDeliveryEvent(event);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'dev-company',
        eventId: event.id,
        invoiceId: event.invoiceId,
        providerMessageId: '<resend@example.fi>',
        sentAt: '2026-07-10T10:02:00.000Z',
      }),
    ).resolves.toEqual({
      invoiceStatus: 'sent',
      updatedAt: '2026-07-10T09:30:00.000Z',
      wasResend: true,
    });

    expect(
      database
        .prepare<[string], { id: string; status: string; updated_at: string }>(
          'SELECT id, status, updated_at FROM invoices WHERE id = ?',
        )
        .get('invoice-1'),
    ).toEqual({
      id: 'invoice-1',
      status: 'sent',
      updated_at: '2026-07-10T09:30:00.000Z',
    });
    expect(
      database
        .prepare<[string], { provider_message_id: string; status: string }>(
          'SELECT provider_message_id, status FROM invoice_delivery_events WHERE id = ?',
        )
        .get(event.id),
    ).toEqual({
      provider_message_id: '<resend@example.fi>',
      status: 'succeeded',
    });
  });

  it('rolls back the sent transition when the delivery event cannot be finalized', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'dev-company',
        eventId: 'missing-event',
        invoiceId: 'invoice-1',
        providerMessageId: null,
        sentAt: '2026-07-10T10:01:00.000Z',
      }),
    ).rejects.toThrow('Invoice delivery event could not be completed.');

    expect(
      database
        .prepare<[string], { status: string; updated_at: string }>(
          'SELECT status, updated_at FROM invoices WHERE id = ?',
        )
        .get('invoice-1'),
    ).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
  });

  it('does not change the event or invoice when successful delivery uses another company', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({ provider: 'smtp', status: 'attempted' });
    await repository.saveDeliveryEvent(event);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'other-company',
        eventId: event.id,
        invoiceId: event.invoiceId,
        providerMessageId: '<message@example.fi>',
        sentAt: '2026-07-10T10:01:00.000Z',
      }),
    ).rejects.toThrow('Approved invoice could not be finalized after delivery.');

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(readEventCompletion(database, event.id)).toEqual({
      provider_message_id: null,
      status: 'attempted',
    });
  });

  it('does not finalize an event that belongs to another invoice', async () => {
    insertInvoice(database, {
      draftId: 'draft-2',
      invoiceId: 'invoice-2',
      invoiceNumber: '20260002',
      sequenceNumber: 2,
    });
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({
      documentId: null,
      id: 'event-invoice-2',
      invoiceId: 'invoice-2',
      provider: 'smtp',
      status: 'attempted',
    });
    await repository.saveDeliveryEvent(event);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'dev-company',
        eventId: event.id,
        invoiceId: 'invoice-1',
        providerMessageId: '<message@example.fi>',
        sentAt: '2026-07-10T10:01:00.000Z',
      }),
    ).rejects.toThrow('Invoice delivery event could not be completed.');

    expect(readInvoiceStatus(database, 'invoice-1')?.status).toBe('approved');
    expect(readEventCompletion(database, event.id)).toEqual({
      provider_message_id: null,
      status: 'attempted',
    });
  });

  it('rolls back the successful event update when the invoice status update fails', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({ provider: 'smtp', status: 'attempted' });
    await repository.saveDeliveryEvent(event);
    database.exec(`
      CREATE TRIGGER fail_invoice_sent_update
      BEFORE UPDATE OF status ON invoices
      WHEN OLD.id = 'invoice-1' AND NEW.status = 'sent'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic invoice update failure');
      END
    `);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'dev-company',
        eventId: event.id,
        invoiceId: event.invoiceId,
        providerMessageId: '<message@example.fi>',
        sentAt: '2026-07-10T10:01:00.000Z',
      }),
    ).rejects.toThrow('synthetic invoice update failure');

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(readEventCompletion(database, event.id)).toEqual({
      provider_message_id: null,
      status: 'attempted',
    });
  });

  it('does not change the invoice when the successful delivery event is no longer attempted', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({
      provider: 'smtp',
      providerMessageId: '<original@example.fi>',
      status: 'succeeded',
    });
    await repository.saveDeliveryEvent(event);

    await expect(
      repository.completeSuccessfulEmailDelivery({
        companyId: 'dev-company',
        eventId: event.id,
        invoiceId: event.invoiceId,
        providerMessageId: '<replacement@example.fi>',
        sentAt: '2026-07-10T10:01:00.000Z',
      }),
    ).rejects.toThrow('Invoice delivery event could not be completed.');

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(readEventCompletion(database, event.id)).toEqual({
      provider_message_id: '<original@example.fi>',
      status: 'succeeded',
    });
  });

  it('stores an unknown delivery outcome and rejects another company', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({ status: 'attempted' });
    await repository.saveDeliveryEvent(event);

    await expect(
      repository.completeDeliveryEvent({
        companyId: 'other-company',
        eventId: event.id,
        providerMessageId: null,
        safeErrorMessage: null,
        status: 'outcomeUnknown',
        technicalErrorCode: null,
      }),
    ).rejects.toThrow('Invoice delivery event could not be completed.');

    expect(readEventTerminalFields(database, event.id)).toEqual({
      provider_message_id: null,
      safe_error_message: null,
      status: 'attempted',
      technical_error_code: null,
    });

    await repository.completeDeliveryEvent({
      companyId: event.companyId,
      eventId: event.id,
      providerMessageId: null,
      safeErrorMessage: 'Outcome unknown.',
      status: 'outcomeUnknown',
      technicalErrorCode: 'SMTP_FINAL_RESPONSE_MISSING',
    });

    const row = database
      .prepare<[string], InvoiceDeliveryEventRow>(
        'SELECT * FROM invoice_delivery_events WHERE id = ?',
      )
      .get(event.id);

    expect(row?.status).toBe('outcomeUnknown');
  });

  it('does not complete a terminal event again', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent({ status: 'attempted' });
    await repository.saveDeliveryEvent(event);
    await repository.completeDeliveryEvent({
      companyId: event.companyId,
      eventId: event.id,
      providerMessageId: null,
      safeErrorMessage: 'Safe failure.',
      status: 'failed',
      technicalErrorCode: 'SMTP_REJECTED',
    });

    await expect(
      repository.completeDeliveryEvent({
        companyId: event.companyId,
        eventId: event.id,
        providerMessageId: '<late@example.fi>',
        safeErrorMessage: null,
        status: 'succeeded',
        technicalErrorCode: null,
      }),
    ).rejects.toThrow('Invoice delivery event could not be completed.');

    expect(
      database
        .prepare<
          [string],
          Pick<
            InvoiceDeliveryEventRow,
            | 'provider_message_id'
            | 'safe_error_message'
            | 'status'
            | 'technical_error_code'
          >
        >(
          `
            SELECT
              provider_message_id,
              safe_error_message,
              status,
              technical_error_code
            FROM invoice_delivery_events
            WHERE id = ?
          `,
        )
        .get(event.id),
    ).toEqual({
      provider_message_id: null,
      safe_error_message: 'Safe failure.',
      status: 'failed',
      technical_error_code: 'SMTP_REJECTED',
    });
  });

  it.each(['attempted', 'outcomeUnknown'] as const)(
    'blocks a new customer send while a %s event remains unresolved',
    async (status) => {
      const repository = new SqliteInvoiceDeliveryEventRepository(database);
      await repository.saveDeliveryEvent(createEvent({ status }));

      await expect(
        repository.hasUnresolvedDeliveryEvent('dev-company', 'invoice-1'),
      ).resolves.toBe(true);
      await expect(
        repository.hasUnresolvedDeliveryEvent('other-company', 'invoice-1'),
      ).resolves.toBe(false);
    },
  );

  it('lists only company-scoped safe delivery metadata in stable newest-first order', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    await repository.saveDeliveryEvent(
      createEvent({
        id: 'event-1',
        createdAt: '2026-07-10T10:00:00.000Z',
        safeErrorMessage: 'Safe failure.',
        status: 'failed',
      }),
    );
    await repository.saveDeliveryEvent(
      createEvent({
        bodyPreview: 'This must not be returned.',
        ccEmail: '',
        createdAt: '2026-07-10T11:00:00.000Z',
        id: 'event-2',
        provider: 'smtp',
        providerMessageId: '<private-provider-id@example.fi>',
        safeErrorMessage: null,
        status: 'succeeded',
        subject: 'Private subject',
        technicalErrorCode: 'PRIVATE_TECHNICAL_CODE',
      }),
    );

    const summaries = await repository.listDeliveryEvents(
      'dev-company',
      'invoice-1',
    );

    expect(summaries).toEqual([
      {
        ccEmail: '',
        createdAt: '2026-07-10T11:00:00.000Z',
        deliveryMethod: 'email',
        id: 'event-2',
        provider: 'smtp',
        recipientEmail: 'customer@example.fi',
        safeErrorMessage: null,
        status: 'succeeded',
      },
      {
        ccEmail: 'copy@example.fi',
        createdAt: '2026-07-10T10:00:00.000Z',
        deliveryMethod: 'email',
        id: 'event-1',
        provider: 'dryRun',
        recipientEmail: 'customer@example.fi',
        safeErrorMessage: 'Safe failure.',
        status: 'failed',
      },
    ]);
    expect(summaries[0]).not.toHaveProperty('subject');
    expect(summaries[0]).not.toHaveProperty('bodyPreview');
    expect(summaries[0]).not.toHaveProperty('providerMessageId');
    expect(summaries[0]).not.toHaveProperty('technicalErrorCode');
    await expect(
      repository.listDeliveryEvents('other-company', 'invoice-1'),
    ).resolves.toEqual([]);
  });

  it('atomically records manual delivery, sent status and audit metadata', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'audit-manual-1',
        companyId: 'dev-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'manual-event-1',
        deliveryMethod: 'print',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).resolves.toEqual({
      updatedAt: '2026-07-10T12:00:00.000Z',
    });

    expect(
      database
        .prepare<[string], { status: string; updated_at: string }>(
          'SELECT status, updated_at FROM invoices WHERE id = ?',
        )
        .get('invoice-1'),
    ).toEqual({
      status: 'sent',
      updated_at: '2026-07-10T12:00:00.000Z',
    });
    expect(
      database
        .prepare<
          [string],
          Pick<
            InvoiceDeliveryEventRow,
            'delivery_method' | 'provider' | 'recipient_email' | 'status'
          >
        >(
          `
            SELECT delivery_method, provider, recipient_email, status
            FROM invoice_delivery_events
            WHERE id = ?
          `,
        )
        .get('manual-event-1'),
    ).toEqual({
      delivery_method: 'print',
      provider: 'manual',
      recipient_email: '',
      status: 'succeeded',
    });
    expect(
      database
        .prepare<[string], { action: string; actor_user_id: string }>(
          'SELECT action, actor_user_id FROM invoice_audit_events WHERE id = ?',
        )
        .get('audit-manual-1'),
    ).toEqual({
      action: 'invoice.marked_sent_manually',
      actor_user_id: 'user-1',
    });
  });

  it('atomically blocks manual delivery when an unresolved event exists', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    await repository.saveDeliveryEvent(
      createEvent({ id: 'unresolved-event', status: 'attempted' }),
    );

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'audit-manual-blocked',
        companyId: 'dev-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'manual-event-blocked',
        deliveryMethod: 'manual',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).rejects.toEqual(new InvoiceDeliveryConflictError());

    expect(
      database
        .prepare<[string], { status: string; updated_at: string }>(
          'SELECT status, updated_at FROM invoices WHERE id = ?',
        )
        .get('invoice-1'),
    ).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(
      database
        .prepare<[string], { id: string }>(
          'SELECT id FROM invoice_delivery_events WHERE id = ?',
        )
        .get('manual-event-blocked'),
    ).toBeUndefined();
    expect(
      database
        .prepare<[string], { id: string }>(
          'SELECT id FROM invoice_audit_events WHERE id = ?',
        )
        .get('audit-manual-blocked'),
    ).toBeUndefined();
  });

  it('does not write manual delivery data for another company', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'audit-other-company',
        companyId: 'other-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'manual-event-other-company',
        deliveryMethod: 'manual',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).resolves.toBeUndefined();

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(countDeliveryEvents(database)).toBe(0);
    expect(countInvoiceAuditEvents(database)).toBe(0);
  });

  it('treats manual finalization of a sent invoice as an idempotent no-op', async () => {
    database
      .prepare(
        `
          UPDATE invoices
          SET status = 'sent', updated_at = '2026-07-10T09:30:00.000Z'
          WHERE id = 'invoice-1'
        `,
      )
      .run();
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'audit-sent-no-op',
        companyId: 'dev-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'manual-event-sent-no-op',
        deliveryMethod: 'print',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).resolves.toEqual({ updatedAt: '2026-07-10T09:30:00.000Z' });

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'sent',
      updated_at: '2026-07-10T09:30:00.000Z',
    });
    expect(countDeliveryEvents(database)).toBe(0);
    expect(countInvoiceAuditEvents(database)).toBe(0);
  });

  it('rolls back the manual event when the invoice status guard changes no row', async () => {
    database.exec(`
      CREATE TRIGGER ignore_invoice_sent_update
      BEFORE UPDATE OF status ON invoices
      WHEN OLD.id = 'invoice-1' AND NEW.status = 'sent'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'audit-manual-guard',
        companyId: 'dev-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'manual-event-guard',
        deliveryMethod: 'manual',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).rejects.toThrow('Approved invoice could not be marked sent.');

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(countDeliveryEvents(database)).toBe(0);
    expect(countInvoiceAuditEvents(database)).toBe(0);
  });

  it('rolls back manual delivery when its delivery event id already exists', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    await repository.saveDeliveryEvent(
      createEvent({ id: 'duplicate-manual-event', status: 'succeeded' }),
    );

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'audit-duplicate-manual-event',
        companyId: 'dev-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'duplicate-manual-event',
        deliveryMethod: 'manual',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).rejects.toThrow();

    expect(readInvoiceStatus(database, 'invoice-1')).toEqual({
      status: 'approved',
      updated_at: '2026-07-10T09:00:00.000Z',
    });
    expect(countDeliveryEvents(database)).toBe(1);
    expect(countInvoiceAuditEvents(database)).toBe(0);
  });

  it('rolls back manual delivery when its audit event cannot be stored', async () => {
    database
      .prepare(
        `
          INSERT INTO invoice_audit_events (
            id, company_id, actor_user_id, action, draft_id,
            invoice_id, invoice_number, created_at
          )
          VALUES (
            'duplicate-audit', 'dev-company', 'user-1', 'invoice.approved',
            'draft-1', 'invoice-1', '20260001', '2026-07-10T09:00:00.000Z'
          )
        `,
      )
      .run();
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.completeManualDelivery({
        actorUserId: 'user-1',
        auditEventId: 'duplicate-audit',
        companyId: 'dev-company',
        deliveredAt: '2026-07-10T12:00:00.000Z',
        deliveryEventId: 'manual-event-rollback',
        deliveryMethod: 'manual',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
      }),
    ).rejects.toThrow();

    expect(
      database
        .prepare<[string], { status: string }>(
          'SELECT status FROM invoices WHERE id = ?',
        )
        .get('invoice-1'),
    ).toEqual({ status: 'approved' });
    expect(
      database
        .prepare<[string], { id: string }>(
          'SELECT id FROM invoice_delivery_events WHERE id = ?',
        )
        .get('manual-event-rollback'),
    ).toBeUndefined();
  });

  it('enforces company and invoice indexes for later scoped reads', () => {
    const indexes = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      )
      .all('invoice_delivery_events')
      .map((index) => index.name);

    expect(indexes).toContain(
      'invoice_delivery_events_company_invoice_created_index',
    );
  });

  it('rejects invalid delivery enum values at the database boundary', () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    return expect(
      repository.saveDeliveryEvent(
        createEvent({
          provider: 'webmailAutomation' as InvoiceDeliveryEvent['provider'],
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects events for unknown invoices', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.saveDeliveryEvent(createEvent({ invoiceId: 'missing-invoice' })),
    ).rejects.toThrow();

    expect(countDeliveryEvents(database)).toBe(0);
  });
});

function createEvent(
  overrides: Partial<InvoiceDeliveryEvent> = {},
): InvoiceDeliveryEvent {
  return {
    bodyPreview: 'Liitteenä lasku.',
    ccEmail: 'copy@example.fi',
    companyId: 'dev-company',
    createdAt: '2026-07-10T10:00:00.000Z',
    createdBy: 'user-1',
    deliveryMethod: 'email',
    documentId: 'document-1',
    id: 'event-1',
    invoiceId: 'invoice-1',
    provider: 'dryRun',
    providerMessageId: null,
    recipientEmail: 'customer@example.fi',
    safeErrorMessage: null,
    status: 'prepared',
    subject: 'Lasku 20260001',
    technicalErrorCode: null,
    ...overrides,
  };
}

interface InsertInvoiceOptions {
  companyId?: string;
  draftId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  sequenceNumber?: number;
}

function insertInvoice(
  database: DatabaseConnection,
  options: InsertInvoiceOptions = {},
): void {
  const companyId = options.companyId ?? 'dev-company';
  const draftId = options.draftId ?? 'draft-1';
  const invoiceId = options.invoiceId ?? 'invoice-1';
  const invoiceNumber = options.invoiceNumber ?? '20260001';
  const sequenceNumber = options.sequenceNumber ?? 1;

  database
    .prepare(
      `
        INSERT INTO invoice_drafts (
          id,
          company_id,
          customer_id,
          status,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          subject,
          order_number,
          note,
          net_total_cents,
          vat_total_cents,
          gross_total_cents,
          created_at,
          updated_at
        )
        VALUES (
          @draft_id,
          @company_id,
          'customer-1',
          'draft',
          '2026-07-10',
          '2026-07-24',
          14,
          'net',
          '',
          '',
          '',
          1000,
          255,
          1255,
          '2026-07-10T09:00:00.000Z',
          '2026-07-10T09:00:00.000Z'
        )
      `,
    )
    .run({ company_id: companyId, draft_id: draftId });

  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_number,
          series_key,
          sequence_scope,
          sequence_number,
          numbering_mode,
          status,
          customer_id,
          customer_number_snapshot,
          customer_name_snapshot,
          customer_business_id_snapshot,
          customer_type_snapshot,
          company_name_snapshot,
          company_business_id_snapshot,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          subject,
          order_number,
          note,
          total_net_cents,
          total_vat_cents,
          total_gross_cents,
          created_at,
          approved_at,
          updated_at
        )
        VALUES (
          @invoice_id,
          @company_id,
          @draft_id,
          @invoice_number,
          'default',
          'calendar-year:2026',
          @sequence_number,
          'calendarYearSequence',
          'approved',
          'customer-1',
          '1001',
          'Test Customer Oy',
          '',
          'company',
          'Eky Oy',
          '1234567-8',
          '2026-07-10',
          '2026-07-24',
          14,
          'net',
          '',
          '',
          '',
          1000,
          255,
          1255,
          '2026-07-10T09:00:00.000Z',
          '2026-07-10T09:00:00.000Z',
          '2026-07-10T09:00:00.000Z'
        )
      `,
    )
    .run({
      company_id: companyId,
      draft_id: draftId,
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      sequence_number: sequenceNumber,
    });
}

function readInvoiceStatus(database: DatabaseConnection, invoiceId: string) {
  return database
    .prepare<[string], { status: string; updated_at: string }>(
      'SELECT status, updated_at FROM invoices WHERE id = ?',
    )
    .get(invoiceId);
}

function readEventCompletion(database: DatabaseConnection, eventId: string) {
  return database
    .prepare<
      [string],
      Pick<InvoiceDeliveryEventRow, 'provider_message_id' | 'status'>
    >(
      `
        SELECT provider_message_id, status
        FROM invoice_delivery_events
        WHERE id = ?
      `,
    )
    .get(eventId);
}

function readEventTerminalFields(
  database: DatabaseConnection,
  eventId: string,
) {
  return database
    .prepare<
      [string],
      Pick<
        InvoiceDeliveryEventRow,
        | 'provider_message_id'
        | 'safe_error_message'
        | 'status'
        | 'technical_error_code'
      >
    >(
      `
        SELECT
          provider_message_id,
          safe_error_message,
          status,
          technical_error_code
        FROM invoice_delivery_events
        WHERE id = ?
      `,
    )
    .get(eventId);
}

function countDeliveryEvents(database: DatabaseConnection): number {
  return database
    .prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM invoice_delivery_events',
    )
    .get()!.count;
}

function countInvoiceAuditEvents(database: DatabaseConnection): number {
  return database
    .prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM invoice_audit_events',
    )
    .get()!.count;
}

function insertInvoiceDocument(database: DatabaseConnection): void {
  database
    .prepare(
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
          'document-1',
          'dev-company',
          'invoice-1',
          'approved_invoice_pdf',
          'invoice.pdf',
          'invoice.pdf',
          'application/pdf',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          100,
          '2026-07-10T09:30:00.000Z'
        )
      `,
    )
    .run();
}
