import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  insert,
  removeDirectories,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { InvoiceDeliveryEventRow, InvoiceTable } from '../../../database/schema.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import {
  createEmailReservationFixture,
  readReservedEvent,
  reservationFields,
} from './invoiceEmailReservation.fixture.js';
import {
  countDeliveryEvents,
  countInvoiceAuditEvents,
  createDryRunEvent,
  createUnresolvedDeliveryFixture,
  type DeliveryRepositoryFixture,
  manualDeliveryInput,
  readEventTerminalFields,
  readInvoiceStatus,
  reserveCustomerDelivery,
  reserveSmtpTestDelivery,
  unresolvedDeliveryCases,
} from './sqliteInvoiceDeliveryEventRepository.fixture.js';
import {
  closePublicationDatabases,
  documentCandidate,
  publicationState,
} from './sqliteInvoiceDocumentPublication.fixture.js';

describe('SqliteInvoiceDeliveryEventRepository', () => {
  let fixture: DeliveryRepositoryFixture;
  let database: DatabaseConnection;
  let target: RevisionInvoiceDeliveryTarget;

  beforeEach(async () => {
    fixture = await createEmailReservationFixture();
    database = fixture.database;
    target = fixture.input.target;
  });

  afterEach(closePublicationDatabases);
  afterAll(removeDirectories);

  it('creates a company-scoped invoice delivery event table', () => {
    const table = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('invoice_delivery_events');

    expect(table?.name).toBe('invoice_delivery_events');
  });

  it.each(['succeeded', 'failed'] as const)(
    'saves revision-bound dry-run %s metadata without storing the full email body',
    async (status) => {
      const event = createDryRunEvent(target, {
        status,
        safeErrorMessage: status === 'failed' ? 'Safe failure.' : null,
        technicalErrorCode: status === 'failed' ? 'DRY_RUN_FAILED' : null,
      });
      const before = publicationState(database);

      await expect(fixture.delivery.saveDeliveryEvent(event)).resolves.toEqual(event);

      const storedEvent = database
        .prepare<[], InvoiceDeliveryEventRow>('SELECT * FROM invoice_delivery_events')
        .get();

      expect(storedEvent).toEqual({
        body_preview: 'Synthetic invoice attached.',
        cc_email: 'copy@example.invalid',
        company_id: target.companyId,
        created_at: event.createdAt,
        created_by: 'synthetic-actor',
        delivery_method: 'email',
        document_id: target.documentId,
        binding_kind: 'revision',
        revision_id: target.revisionId,
        send_mode: 'dryRun',
        document_sha256: target.sha256,
        document_size_bytes: target.sizeBytes,
        id: 'event-1',
        invoice_id: target.invoiceId,
        provider: 'dryRun',
        provider_message_id: null,
        recipient_email: 'customer@example.invalid',
        safe_error_message: event.safeErrorMessage,
        status,
        subject: 'Synthetic invoice 20270001',
        technical_error_code: event.technicalErrorCode,
      });
      expect(storedEvent).not.toHaveProperty('body');
      expect(storedEvent).not.toHaveProperty('mime');
      expect(publicationState(database)).toEqual({ ...before, events: [storedEvent] });
    },
  );

  it('completes an exact SMTP test reservation within the company boundary without marking sent', async () => {
    const beforeInvoice = readInvoiceStatus(database, target.invoiceId);
    const reservation = await reserveSmtpTestDelivery(fixture);
    expect(readReservedEvent(database, reservation.eventId)).toMatchObject({
      status: 'attempted',
      provider: 'smtp',
      send_mode: 'smtpTest',
      document_id: target.documentId,
      revision_id: target.revisionId,
    });

    await expect(fixture.delivery.completeDeliveryEvent({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<synthetic@example.test>' },
    })).resolves.toEqual({ outcome: 'completed' });

    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: '<synthetic@example.test>',
      safe_error_message: null,
      status: 'succeeded',
      technical_error_code: null,
    });
    expect(readInvoiceStatus(database, target.invoiceId)).toEqual(beforeInvoice);
  });

  it('atomically completes a successful customer reservation and marks an approved invoice sent at reservation time', async () => {
    const { reservation, invoiceStatusAtReservation } = await reserveCustomerDelivery(fixture);
    const before = publicationState(database);
    const beforeInvoices = database.prepare<[], InvoiceTable>('SELECT * FROM invoices ORDER BY id').all();
    expect(invoiceStatusAtReservation).toBe('approved');

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<message@example.invalid>' },
    })).resolves.toEqual({ outcome: 'completed' });

    expect(readInvoiceStatus(database, target.invoiceId)).toEqual({
      status: 'sent',
      updated_at: fixture.input.createdAt,
    });
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: '<message@example.invalid>',
      safe_error_message: null,
      status: 'succeeded',
      technical_error_code: null,
    });
    expect(readReservedEvent(database, reservation.eventId)?.created_at).toBe(fixture.input.createdAt);
    expect(publicationState(database)).toEqual({
      ...before,
      invoices: beforeInvoices.map((invoice) => ({
        ...invoice, status: 'sent', updated_at: fixture.input.createdAt,
      })),
      events: before.events.map((event) => ({
        ...(event as InvoiceDeliveryEventRow),
        status: 'succeeded',
        provider_message_id: '<message@example.invalid>',
      })),
    });
  });

  it('finalizes a resend without changing the sent invoice identity or timestamp', async () => {
    const first = await reserveCustomerDelivery(fixture);
    await fixture.delivery.completeSuccessfulEmailDelivery({
      reservation: first.reservation,
      result: { status: 'succeeded', providerMessageId: '<first@example.invalid>' },
    });
    const { reservation, invoiceStatusAtReservation } = await reserveCustomerDelivery(fixture, {
      eventId: 'resend-event-1',
      createdAt: '2027-01-15T14:00:00.000Z',
    });
    const before = publicationState(database);
    expect(invoiceStatusAtReservation).toBe('sent');

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<resend@example.invalid>' },
    })).resolves.toEqual({ outcome: 'completed' });

    expect(readInvoiceStatus(database, target.invoiceId)).toEqual({
      status: 'sent',
      updated_at: fixture.input.createdAt,
    });
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: '<resend@example.invalid>',
      safe_error_message: null,
      status: 'succeeded',
      technical_error_code: null,
    });
    expect(publicationState(database)).toEqual({
      ...before,
      events: before.events.map((event) => {
        const row = event as InvoiceDeliveryEventRow;
        return row.id === reservation.eventId
          ? { ...row, status: 'succeeded', provider_message_id: '<resend@example.invalid>' }
          : row;
      }),
    });
  });

  it('rejects a missing reservation event without changing the invoice or any table', async () => {
    const { reservation } = await reserveCustomerDelivery(fixture);
    const before = publicationState(database);

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation: { ...reservation, eventId: 'missing-event' },
      result: { status: 'succeeded', providerMessageId: null },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(readReservedEvent(database, reservation.eventId)?.status).toBe('attempted');
    expect(publicationState(database)).toEqual(before);
  });

  it('does not change the event or invoice when successful delivery uses another company', async () => {
    const { reservation } = await reserveCustomerDelivery(fixture);
    const before = publicationState(database);

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation: { ...reservation, target: { ...target, companyId: 'foreign-company' } },
      result: { status: 'succeeded', providerMessageId: '<message@example.invalid>' },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: null,
      safe_error_message: null,
      status: 'attempted',
      technical_error_code: null,
    });
    expect(publicationState(database)).toEqual(before);
  });

  it('does not finalize an event that belongs to another invoice', async () => {
    const key = await fixture.approve('invoice-2');
    const published = await fixture.repository.publishDocumentIfCurrent({
      key, candidate: documentCandidate(key, 'document-2'),
    });
    if (published.outcome === 'conflict') throw new Error('Synthetic second document publication failed.');
    const otherTarget: RevisionInvoiceDeliveryTarget = {
      ...key,
      kind: 'revision',
      documentId: published.document.id,
      sha256: published.document.sha256,
      sizeBytes: published.document.sizeBytes,
    };
    const { reservation } = await reserveCustomerDelivery(fixture, {
      eventId: 'event-invoice-2', target: otherTarget,
    });
    const before = publicationState(database);

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation: { ...reservation, target },
      result: { status: 'succeeded', providerMessageId: '<message@example.invalid>' },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(readInvoiceStatus(database, otherTarget.invoiceId)?.status).toBe('approved');
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: null,
      safe_error_message: null,
      status: 'attempted',
      technical_error_code: null,
    });
    expect(publicationState(database)).toEqual(before);
  });

  it('rolls back the successful event update when the invoice status update fails', async () => {
    const { reservation } = await reserveCustomerDelivery(fixture);
    const before = publicationState(database);
    database.exec(`
      CREATE TRIGGER fail_invoice_sent_update
      BEFORE UPDATE OF status ON invoices
      WHEN NEW.status = 'sent'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic invoice update failure');
      END
    `);

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<message@example.invalid>' },
    })).rejects.toThrow('synthetic invoice update failure');

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: null,
      safe_error_message: null,
      status: 'attempted',
      technical_error_code: null,
    });
    expect(publicationState(database)).toEqual(before);
  });

  it('repeats successful customer completion idempotently but rejects a differing terminal acknowledgement', async () => {
    const { reservation } = await reserveCustomerDelivery(fixture);
    const result = { status: 'succeeded' as const, providerMessageId: '<original@example.invalid>' };
    await fixture.delivery.completeSuccessfulEmailDelivery({ reservation, result });
    const before = publicationState(database);

    await expect(fixture.delivery.completeSuccessfulEmailDelivery({ reservation, result }))
      .resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(publicationState(database)).toEqual(before);
    await expect(fixture.delivery.completeSuccessfulEmailDelivery({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<replacement@example.invalid>' },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(readInvoiceStatus(database, target.invoiceId)).toEqual({
      status: 'sent',
      updated_at: fixture.input.createdAt,
    });
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: '<original@example.invalid>',
      safe_error_message: null,
      status: 'succeeded',
      technical_error_code: null,
    });
    expect(publicationState(database)).toEqual(before);
  });

  it('stores an unknown delivery outcome and rejects another company', async () => {
    const { reservation } = await reserveCustomerDelivery(fixture);
    const before = publicationState(database);
    const result = {
      status: 'outcomeUnknown' as const,
      safeErrorMessage: 'Outcome unknown.',
      technicalErrorCode: 'SMTP_FINAL_RESPONSE_MISSING',
    };

    await expect(fixture.delivery.completeDeliveryEvent({
      reservation: { ...reservation, target: { ...target, companyId: 'foreign-company' } },
      result,
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: null,
      safe_error_message: null,
      status: 'attempted',
      technical_error_code: null,
    });
    expect(publicationState(database)).toEqual(before);

    await expect(fixture.delivery.completeDeliveryEvent({ reservation, result }))
      .resolves.toEqual({ outcome: 'completed' });
    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: null,
      safe_error_message: 'Outcome unknown.',
      status: 'outcomeUnknown',
      technical_error_code: 'SMTP_FINAL_RESPONSE_MISSING',
    });
    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
  });

  it('repeats a failed terminal completion idempotently but does not overwrite it with success', async () => {
    const reservation = await reserveSmtpTestDelivery(fixture);
    const result = {
      status: 'failed' as const,
      safeErrorMessage: 'Safe failure.',
      technicalErrorCode: 'SMTP_REJECTED',
    };
    await fixture.delivery.completeDeliveryEvent({ reservation, result });
    const before = publicationState(database);

    await expect(fixture.delivery.completeDeliveryEvent({ reservation, result }))
      .resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(publicationState(database)).toEqual(before);
    await expect(fixture.delivery.completeDeliveryEvent({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<late@example.invalid>' },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(readEventTerminalFields(database, reservation.eventId)).toEqual({
      provider_message_id: null,
      safe_error_message: 'Safe failure.',
      status: 'failed',
      technical_error_code: 'SMTP_REJECTED',
    });
    expect(publicationState(database)).toEqual(before);
  });

  it.each(unresolvedDeliveryCases)(
    'blocks a new customer send while a $source $provider $status event remains unresolved',
    async (testCase) => {
      const f = await createUnresolvedDeliveryFixture(fixture, testCase);
      const before = publicationState(f.database);

      await expect(f.delivery.hasUnresolvedDeliveryEvent(f.target.companyId, f.target.invoiceId))
        .resolves.toBe(true);
      await expect(f.delivery.hasUnresolvedDeliveryEvent('foreign-company', f.target.invoiceId))
        .resolves.toBe(false);
      await expect(f.delivery.hasUnresolvedDeliveryEvent(f.target.companyId, 'missing-invoice'))
        .resolves.toBe(false);
      await expect(f.delivery.reserveEmailDelivery({
        eventId: 'blocked-next-attempt',
        mode: 'customer',
        target: f.target,
        ...reservationFields,
      })).resolves.toEqual({ outcome: 'conflict' });
      expect(publicationState(f.database)).toEqual(before);
    },
  );

  it('lists only company-scoped safe delivery metadata in stable newest-first order', async () => {
    await fixture.delivery.saveDeliveryEvent(createDryRunEvent(target, {
      safeErrorMessage: 'Safe failure.',
      status: 'failed',
      technicalErrorCode: 'PRIVATE_TECHNICAL_CODE',
    }));
    const { reservation } = await reserveCustomerDelivery(fixture, {
      bodyPreview: 'This must not be returned.',
      ccEmail: '',
      createdAt: '2027-01-15T14:00:00.000Z',
      eventId: 'event-2',
      recipientEmail: 'customer@example.invalid',
      subject: 'Private subject',
    });
    await fixture.delivery.completeSuccessfulEmailDelivery({
      reservation,
      result: { status: 'succeeded', providerMessageId: '<private-provider-id@example.invalid>' },
    });
    await fixture.delivery.saveDeliveryEvent(createDryRunEvent(target, {
      id: 'event-3',
      createdAt: '2027-01-15T14:00:00.000Z',
    }));
    const before = publicationState(database);
    const summaries = await fixture.delivery.listDeliveryEvents(target.companyId, target.invoiceId);

    expect(summaries).toEqual([
      {
        ccEmail: 'copy@example.invalid',
        createdAt: '2027-01-15T14:00:00.000Z',
        deliveryMethod: 'email',
        id: 'event-3',
        documentSource: 'revision',
        sendMode: 'dryRun',
        provider: 'dryRun',
        recipientEmail: 'customer@example.invalid',
        safeErrorMessage: null,
        status: 'succeeded',
      },
      {
        ccEmail: '',
        createdAt: '2027-01-15T14:00:00.000Z',
        deliveryMethod: 'email',
        id: 'event-2',
        documentSource: 'revision',
        sendMode: 'customer',
        provider: 'smtp',
        recipientEmail: 'customer@example.invalid',
        safeErrorMessage: null,
        status: 'succeeded',
      },
      {
        ccEmail: 'copy@example.invalid',
        createdAt: '2027-01-15T13:00:00.000Z',
        deliveryMethod: 'email',
        id: 'event-1',
        provider: 'dryRun',
        documentSource: 'revision',
        sendMode: 'dryRun',
        recipientEmail: 'customer@example.invalid',
        safeErrorMessage: 'Safe failure.',
        status: 'failed',
      },
    ]);
    for (const summary of summaries) {
      expect(summary).not.toHaveProperty('subject');
      expect(summary).not.toHaveProperty('bodyPreview');
      expect(summary).not.toHaveProperty('providerMessageId');
      expect(summary).not.toHaveProperty('technicalErrorCode');
      expect(summary).not.toHaveProperty('target');
      expect(summary).not.toHaveProperty('revisionId');
    }
    expect(readReservedEvent(database, 'event-1')?.technical_error_code).toBe('PRIVATE_TECHNICAL_CODE');
    expect(readReservedEvent(database, 'event-2')).toMatchObject({
      subject: 'Private subject',
      body_preview: 'This must not be returned.',
      provider_message_id: '<private-provider-id@example.invalid>',
    });
    await expect(fixture.delivery.listDeliveryEvents('foreign-company', target.invoiceId))
      .resolves.toEqual([]);
    await expect(fixture.delivery.listDeliveryEvents(target.companyId, 'missing-invoice'))
      .resolves.toEqual([]);
    expect(publicationState(database)).toEqual(before);
  });

  it.each(['manual', 'print'] as const)(
    'atomically records %s delivery, sent status and audit metadata for the exact revision',
    async (deliveryMethod) => {
      const input = manualDeliveryInput(target, { deliveryMethod });
      const beforeAuditCount = countInvoiceAuditEvents(database);

      await expect(fixture.delivery.completeManualDelivery(input)).resolves.toEqual({
        outcome: 'completed',
        updatedAt: input.deliveredAt,
      });

      expect(readInvoiceStatus(database, target.invoiceId)).toEqual({
        status: 'sent',
        updated_at: input.deliveredAt,
      });
      expect(readReservedEvent(database, input.deliveryEventId)).toMatchObject({
        company_id: target.companyId,
        invoice_id: target.invoiceId,
        document_id: target.documentId,
        binding_kind: 'revision',
        revision_id: target.revisionId,
        document_sha256: target.sha256,
        document_size_bytes: target.sizeBytes,
        send_mode: 'manual',
        delivery_method: deliveryMethod,
        provider: 'manual',
        recipient_email: '',
        status: 'succeeded',
      });
      expect(database.prepare<[string], { action: string; actor_user_id: string }>(
        'SELECT action, actor_user_id FROM invoice_audit_events WHERE id = ?',
      ).get(input.auditEventId)).toEqual({
        action: 'invoice.marked_sent_manually',
        actor_user_id: input.actorUserId,
      });
      expect(countDeliveryEvents(database)).toBe(1);
      expect(countInvoiceAuditEvents(database)).toBe(beforeAuditCount + 1);
    },
  );

  it.each(unresolvedDeliveryCases)(
    'atomically blocks manual delivery when a $source $provider $status event remains unresolved',
    async (testCase) => {
      const f = await createUnresolvedDeliveryFixture(fixture, testCase);
      const input = manualDeliveryInput(f.target);
      const before = publicationState(f.database);
      const beforeInvoice = readInvoiceStatus(f.database, f.target.invoiceId);
      expect(beforeInvoice?.status).toBe('approved');

      await expect(f.delivery.completeManualDelivery(input))
        .rejects.toEqual(new InvoiceDeliveryConflictError());

      expect(readInvoiceStatus(f.database, f.target.invoiceId)).toEqual(beforeInvoice);
      expect(readReservedEvent(f.database, input.deliveryEventId)).toBeUndefined();
      expect(f.database.prepare<[string], { id: string }>(
        'SELECT id FROM invoice_audit_events WHERE id = ?',
      ).get(input.auditEventId)).toBeUndefined();
      expect(publicationState(f.database)).toEqual(before);
    },
  );

  it('does not write manual delivery data for another company', async () => {
    const before = publicationState(database);
    const beforeAuditCount = countInvoiceAuditEvents(database);

    await expect(fixture.delivery.completeManualDelivery(manualDeliveryInput({
      ...target, companyId: 'foreign-company',
    }))).resolves.toBeUndefined();

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(countDeliveryEvents(database)).toBe(0);
    expect(countInvoiceAuditEvents(database)).toBe(beforeAuditCount);
    expect(publicationState(database)).toEqual(before);
  });

  it('treats manual finalization of a sent invoice as an alreadySent idempotent no-op', async () => {
    const first = manualDeliveryInput(target, { deliveredAt: '2027-01-15T13:30:00.000Z' });
    await fixture.delivery.completeManualDelivery(first);
    const before = publicationState(database);
    const beforeAuditCount = countInvoiceAuditEvents(database);

    await expect(fixture.delivery.completeManualDelivery(manualDeliveryInput(target, {
      auditEventId: 'audit-sent-no-op',
      deliveryEventId: 'manual-event-sent-no-op',
      deliveryMethod: 'print',
    }))).resolves.toEqual({ outcome: 'alreadySent', updatedAt: first.deliveredAt });

    expect(readInvoiceStatus(database, target.invoiceId)).toEqual({
      status: 'sent',
      updated_at: first.deliveredAt,
    });
    expect(countDeliveryEvents(database)).toBe(1);
    expect(countInvoiceAuditEvents(database)).toBe(beforeAuditCount);
    expect(publicationState(database)).toEqual(before);
  });

  it('rolls back the manual event when the invoice status guard changes no row', async () => {
    database.exec(`
      CREATE TRIGGER ignore_invoice_sent_update
      BEFORE UPDATE OF status ON invoices
      WHEN NEW.status = 'sent'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    const before = publicationState(database);
    const beforeAuditCount = countInvoiceAuditEvents(database);

    await expect(fixture.delivery.completeManualDelivery(manualDeliveryInput(target)))
      .rejects.toThrow('Approved invoice could not be marked sent.');

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(countDeliveryEvents(database)).toBe(0);
    expect(countInvoiceAuditEvents(database)).toBe(beforeAuditCount);
    expect(publicationState(database)).toEqual(before);
  });

  it('rolls back manual delivery when its delivery event id already exists', async () => {
    await fixture.delivery.saveDeliveryEvent(createDryRunEvent(target, {
      id: 'duplicate-manual-event',
    }));
    const before = publicationState(database);
    const beforeAuditCount = countInvoiceAuditEvents(database);

    await expect(fixture.delivery.completeManualDelivery(manualDeliveryInput(target, {
      auditEventId: 'audit-duplicate-manual-event',
      deliveryEventId: 'duplicate-manual-event',
    }))).rejects.toThrow();

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(countDeliveryEvents(database)).toBe(1);
    expect(countInvoiceAuditEvents(database)).toBe(beforeAuditCount);
    expect(publicationState(database)).toEqual(before);
  });

  it('rolls back manual delivery when its audit event cannot be stored', async () => {
    const approvalAuditId = `${target.invoiceId}-audit`;
    expect(database.prepare<[string], { action: string }>(
      'SELECT action FROM invoice_audit_events WHERE id = ?',
    ).get(approvalAuditId)).toEqual({ action: 'invoice.approved' });
    const input = manualDeliveryInput(target, { auditEventId: approvalAuditId });
    const before = publicationState(database);

    await expect(fixture.delivery.completeManualDelivery(input)).rejects.toThrow();

    expect(readInvoiceStatus(database, target.invoiceId)?.status).toBe('approved');
    expect(readReservedEvent(database, input.deliveryEventId)).toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it('enforces company and invoice indexes for later scoped reads', () => {
    const indexes = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      )
      .all('invoice_delivery_events')
      .map((index) => index.name);

    expect(indexes).toContain('invoice_delivery_events_company_invoice_created_index');
    expect(indexes).toContain('invoice_delivery_events_unresolved_smtp_key');
    expect(database.prepare<[], { name: string }>(
      "PRAGMA index_info('invoice_delivery_events_company_invoice_created_index')",
    ).all().map((column) => column.name)).toEqual(['company_id', 'invoice_id', 'created_at']);
  });

  it.each([
    { field: 'provider', column: 'provider', value: 'webmailAutomation' },
    { field: 'deliveryMethod', column: 'delivery_method', value: 'webmail' },
    { field: 'status', column: 'status', value: 'queued' },
  ] as const)(
    'rejects invalid delivery $field values at the repository and database boundaries',
    async ({ field, column, value }) => {
      const event = createDryRunEvent(target);
      const before = publicationState(database);

      await expect(fixture.delivery.saveDeliveryEvent({
        ...event, [field]: value,
      } as InvoiceDryRunDeliveryEvent)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
      expect(publicationState(database)).toEqual(before);

      await fixture.delivery.saveDeliveryEvent(event);
      const storedEvent = readReservedEvent(database, event.id);
      if (!storedEvent) throw new Error('Synthetic dry-run event was not stored.');
      const stored = publicationState(database);
      expect(() => insert(database, 'invoice_delivery_events', {
        ...storedEvent, id: 'invalid-enum-event', [column]: value,
      })).toThrow(/CHECK constraint failed/);
      expect(countDeliveryEvents(database)).toBe(1);
      expect(publicationState(database)).toEqual(stored);
    },
  );

  it('rejects revision-bound dry-run events for unknown invoices without changing data', async () => {
    const before = publicationState(database);
    const event = createDryRunEvent({ ...target, invoiceId: 'missing-invoice' });

    await expect(fixture.delivery.saveDeliveryEvent(event))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(countDeliveryEvents(database)).toBe(0);
    expect(publicationState(database)).toEqual(before);
  });
});
