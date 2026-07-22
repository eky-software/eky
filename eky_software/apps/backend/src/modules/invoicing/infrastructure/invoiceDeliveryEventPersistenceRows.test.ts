import { describe, expect, it } from 'vitest';

import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import {
  toInvoiceDeliveryEvent,
  toInvoiceDeliveryEventSummary,
  toRow,
} from './invoiceDeliveryEventPersistenceRows.js';

describe('invoice delivery event persistence rows', () => {
  it('maps a domain event to the persistence row without reclassifying fields', () => {
    expect(toRow(createEvent())).toEqual(createRow());
  });

  it('maps a persistence row back to the complete domain event', () => {
    expect(toInvoiceDeliveryEvent(createRow())).toEqual(createEvent());
  });

  it('maps only safe delivery summary fields', () => {
    expect(toInvoiceDeliveryEventSummary(createRow())).toEqual({
      ccEmail: 'copy@example.fi',
      createdAt: '2026-07-10T10:00:00.000Z',
      deliveryMethod: 'email',
      id: 'event-1',
      provider: 'smtp',
      recipientEmail: 'customer@example.fi',
      safeErrorMessage: null,
      status: 'succeeded',
    });
  });
});

function createEvent(): InvoiceDeliveryEvent {
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
    provider: 'smtp',
    providerMessageId: '<message@example.fi>',
    recipientEmail: 'customer@example.fi',
    safeErrorMessage: null,
    status: 'succeeded',
    subject: 'Lasku 20260001',
    technicalErrorCode: null,
  };
}

function createRow(): InvoiceDeliveryEventRow {
  return {
    body_preview: 'Liitteenä lasku.',
    cc_email: 'copy@example.fi',
    company_id: 'dev-company',
    created_at: '2026-07-10T10:00:00.000Z',
    created_by: 'user-1',
    delivery_method: 'email',
    document_id: 'document-1',
    id: 'event-1',
    invoice_id: 'invoice-1',
    provider: 'smtp',
    provider_message_id: '<message@example.fi>',
    recipient_email: 'customer@example.fi',
    safe_error_message: null,
    status: 'succeeded',
    subject: 'Lasku 20260001',
    technical_error_code: null,
  };
}
