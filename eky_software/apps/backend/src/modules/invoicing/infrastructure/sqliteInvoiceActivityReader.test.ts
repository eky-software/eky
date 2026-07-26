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
    insertDeliveryEvent(database, 'delivery-real', 'smtp');
    insertDeliveryEvent(database, 'delivery-dry-run', 'dryRun');
    const reader = new SqliteInvoiceActivityReader(database);

    await expect(reader.listInvoiceActivity('dev-company', 10)).resolves.toEqual([
      {
        action: 'invoice.delivered',
        id: 'delivery-real',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T11:00:00.000Z',
      },
      {
        action: 'invoice.approved',
        id: 'audit-1',
        invoiceNumber: '20260001',
        occurredAt: '2026-07-27T10:00:00.000Z',
      },
    ]);
  });

  it('does not return another company activity', async () => {
    insertInvoiceAudit(database);
    const reader = new SqliteInvoiceActivityReader(database);

    await expect(reader.listInvoiceActivity('other-company', 10)).resolves.toEqual(
      [],
    );
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

function insertDeliveryEvent(
  database: DatabaseConnection,
  id: string,
  provider: 'dryRun' | 'smtp',
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
          ?, 'dev-company', 'invoice-1', NULL, 'email', ?, 'succeeded', '', '',
          '', '', NULL, NULL, NULL, '2026-07-27T11:00:00.000Z', 'actor-1'
        )
      `,
    )
    .run(id, provider);
}
