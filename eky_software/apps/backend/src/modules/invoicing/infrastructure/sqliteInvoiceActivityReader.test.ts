import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { createInvoiceReadModelTestDatabase } from '../../../testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteInvoiceActivityReader } from './sqliteInvoiceActivityReader.js';

describe('SqliteInvoiceActivityReader', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await createInvoiceReadModelTestDatabase();
  });

  afterEach(() => database.close());

  it('combines audit and real delivery activity without dry-run events', async () => {
    insertInvoiceAudit(database);
    insertDeliveryEvent(database, 'delivery-success', 'smtp', 'succeeded', 11);
    insertDeliveryEvent(database, 'delivery-failed', 'smtp', 'failed', 12);
    insertDeliveryEvent(
      database,
      'delivery-unknown',
      'smtp',
      'outcomeUnknown',
      13,
    );
    insertDeliveryEvent(database, 'delivery-pending', 'smtp', 'attempted', 14);
    insertDeliveryEvent(database, 'delivery-dry-run', 'dryRun', 'failed', 15);
    const reader = new SqliteInvoiceActivityReader(database);

    await expect(reader.listInvoiceActivity({
      companyId: 'dev-company',
      limit: 10,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
      outcomes: ['success', 'failure', 'unknown'],
    })).resolves.toEqual([
      {
        action: 'invoice.delivery_pending',
        id: 'delivery-pending',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T14:00:00.000Z',
        outcome: 'unknown',
      },
      {
        action: 'invoice.delivery_outcome_unknown',
        id: 'delivery-unknown',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T13:00:00.000Z',
        outcome: 'unknown',
      },
      {
        action: 'invoice.delivery_failed',
        id: 'delivery-failed',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'failure',
      },
      {
        action: 'invoice.delivered',
        id: 'delivery-success',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T11:00:00.000Z',
        outcome: 'success',
      },
      {
        action: 'invoice.approved',
        id: 'audit-1',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T10:00:00.000Z',
        outcome: 'success',
      },
    ]);
  });

  it('filters delivery outcomes before applying the result limit', async () => {
    insertInvoiceAudit(database);
    insertDeliveryEvent(database, 'delivery-success', 'smtp', 'succeeded', 11);
    insertDeliveryEvent(database, 'delivery-failed', 'smtp', 'failed', 12);
    const reader = new SqliteInvoiceActivityReader(database);

    await expect(reader.listInvoiceActivity({
      companyId: 'dev-company',
      limit: 1,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
      outcomes: ['failure'],
    })).resolves.toEqual([
      {
        action: 'invoice.delivery_failed',
        id: 'delivery-failed',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'failure',
      },
    ]);
  });

  it('returns module-owned settings audit without setting values', async () => {
    insertInvoiceSettingsAudit(database);
    const reader = new SqliteInvoiceActivityReader(database);

    await expect(
      reader.listInvoiceActivity({
        companyId: 'dev-company',
        limit: 10,
        occurredAtFrom: '2026-07-01T00:00:00.000Z',
        occurredAtTo: '2026-08-01T00:00:00.000Z',
        outcomes: ['success'],
      }),
    ).resolves.toEqual([
      {
        action: 'invoiceVatRates.updated',
        id: 'invoice-settings-audit-1',
        invoiceNumber: null,
        occurredAt: '2026-07-27T15:00:00.000Z',
        outcome: 'success',
      },
    ]);
  });

  it('projects payment events without payment, actor or customer details', async () => {
    insertPaymentEvent(
      database,
      'payment-paid',
      'paymentMarkedPaid',
      '2026-07-27T16:00:00.000Z',
    );
    insertPaymentEvent(
      database,
      'payment-reverted',
      'paymentMarkReverted',
      '2026-07-27T17:00:00.000Z',
    );
    const reader = new SqliteInvoiceActivityReader(database);

    const entries = await reader.listInvoiceActivity({
      companyId: 'dev-company',
      limit: 10,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
      outcomes: ['success'],
    });

    expect(entries).toEqual([
      {
        action: 'invoice.payment_mark_reverted',
        id: 'payment-reverted',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T17:00:00.000Z',
        outcome: 'success',
      },
      {
        action: 'invoice.payment_marked_paid',
        id: 'payment-paid',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T16:00:00.000Z',
        outcome: 'success',
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain('actor-payment-private');
    expect(JSON.stringify(entries)).not.toContain('2026-07-25');
    expect(JSON.stringify(entries)).not.toContain('12345');
  });

  it('does not return another company activity', async () => {
    insertInvoiceAudit(database);
    const reader = new SqliteInvoiceActivityReader(database);

    await expect(reader.listInvoiceActivity({
      companyId: 'other-company',
      limit: 10,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
      outcomes: ['success'],
    })).resolves.toEqual([]);
  });
});

function insertInvoiceAudit(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_audit_events (
          id, company_id, actor_user_id, action, draft_id, invoice_id,
          invoice_number, created_at
        ) VALUES (
          'audit-1', 'dev-company', 'actor-1', 'invoice.approved', 'draft-1',
          'invoice-1', '20260001', '2026-07-27T10:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertInvoiceSettingsAudit(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_settings_audit_events (
          id, company_id, actor_user_id, action, outcome, occurred_at
        ) VALUES (
          'invoice-settings-audit-1', 'dev-company', 'actor-1',
          'invoiceVatRates.updated', 'success',
          '2026-07-27T15:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertDeliveryEvent(
  database: DatabaseConnection,
  id: string,
  provider: 'dryRun' | 'smtp',
  status: 'attempted' | 'failed' | 'outcomeUnknown' | 'succeeded',
  hour: number,
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_delivery_events (
          id, company_id, invoice_id, document_id, delivery_method, provider,
          status, recipient_email, cc_email, subject, body_preview,
          provider_message_id, safe_error_message, technical_error_code,
          created_at, created_by
        ) VALUES (
          ?, 'dev-company', 'invoice-1', NULL, 'email', ?, ?, '', '',
          '', '', NULL, NULL, NULL, ?, 'actor-1'
        )
      `,
    )
    .run(
      id,
      provider,
      status,
      `2026-07-27T${String(hour).padStart(2, '0')}:00:00.000Z`,
    );
}

function insertPaymentEvent(
  database: DatabaseConnection,
  id: string,
  action: 'paymentMarkedPaid' | 'paymentMarkReverted',
  occurredAt: string,
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_payment_events (
          id, company_id, invoice_id, actor_user_id, action, payment_source,
          paid_on, amount_cents, occurred_at
        ) VALUES (
          ?, 'dev-company', 'invoice-1', 'actor-payment-private', ?, 'manual',
          '2026-07-25', 12345, ?
        )
      `,
    )
    .run(id, action, occurredAt);
}
