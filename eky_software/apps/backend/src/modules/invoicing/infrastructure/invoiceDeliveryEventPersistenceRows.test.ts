import { describe, expect, it } from 'vitest';

import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type {
  InvoiceDryRunDeliveryEvent,
  InvoiceRecordedDeliveryEvent,
} from '../domain/invoiceRecordedDeliveryEvent.js';
import {
  toInvoiceDeliveryEvent,
  toInvoiceDeliveryEventSummary,
  toRow,
} from './invoiceDeliveryEventPersistenceRows.js';

describe('invoice delivery event persistence rows', () => {
  it.each(['succeeded', 'failed'] as const)('maps a %s dry-run event with its exact revision and document evidence', (status) => {
    expect(toRow(createDryRunEvent(status))).toStrictEqual({
      ...createRow(),
      provider: 'dryRun',
      send_mode: 'dryRun',
      status,
    });
  });

  it.each(['manual', 'print'] as const)('maps a %s delivery with manual send mode and exact document evidence', (deliveryMethod) => {
    const event: InvoiceRecordedDeliveryEvent = {
      ...createDryRunEvent('succeeded'),
      bodyPreview: '',
      ccEmail: '',
      deliveryMethod,
      provider: 'manual',
      providerMessageId: null,
      recipientEmail: '',
      status: 'succeeded',
      subject: '',
    };

    expect(toRow(event)).toStrictEqual({
      ...createRow(),
      body_preview: '',
      cc_email: '',
      delivery_method: deliveryMethod,
      provider: 'manual',
      provider_message_id: null,
      recipient_email: '',
      send_mode: 'manual',
      subject: '',
    });
  });

  it('maps a revision-bound SMTP row back to the existing generic read shape', () => {
    expect(toInvoiceDeliveryEvent(createRow())).toStrictEqual(createEvent());
  });

  it('retains historical null document identity without inventing a target', () => {
    expect(toInvoiceDeliveryEvent({
      ...createRow(),
      binding_kind: 'legacyOriginal',
      document_id: null,
      document_sha256: null,
      document_size_bytes: null,
      revision_id: null,
      send_mode: 'legacyUnknown',
    })).toStrictEqual({ ...createEvent(), documentId: null });
  });

  it('maps only safe delivery summary fields', () => {
    expect(toInvoiceDeliveryEventSummary(createRow())).toEqual({
      ccEmail: 'copy@example.fi',
      createdAt: '2026-07-10T10:00:00.000Z',
      deliveryMethod: 'email',
      documentSource: 'revision',
      id: 'event-1',
      provider: 'smtp',
      recipientEmail: 'customer@example.fi',
      safeErrorMessage: null,
      sendMode: 'customer',
      status: 'succeeded',
    });
  });

  it.each([
    ['revision', 'customer', 'smtp', 'email', 'document-1', 'revision'],
    ['revision', 'smtpTest', 'smtp', 'email', 'document-1', 'revision'],
    ['revision', 'dryRun', 'dryRun', 'email', 'document-1', 'revision'],
    ['revision', 'manual', 'manual', 'manual', 'document-1', 'revision'],
    ['revision', 'manual', 'manual', 'print', 'document-1', 'revision'],
    ['preservedLegacy', 'customer', 'smtp', 'email', 'document-1', 'preservedLegacy'],
    ['legacyOriginal', 'legacyUnknown', 'smtp', 'email', 'document-1', 'legacyOriginal'],
    ['legacyOriginal', 'legacyUnknown', 'smtp', 'email', null, 'legacyMissingDocument'],
    ['legacyOriginal', 'legacyUnknown', 'manual', 'print', null, 'legacyMissingDocument'],
    ['legacyOriginal', 'legacyUnknown', 'dryRun', 'email', 'document-1', 'legacyOriginal'],
  ] as const)('projects %s / %s without guessing historical purpose', (
    bindingKind, sendMode, provider, deliveryMethod, documentId, documentSource,
  ) => {
    const row = {
      ...createRow(),
      binding_kind: bindingKind,
      send_mode: sendMode,
      provider,
      delivery_method: deliveryMethod,
      document_id: documentId,
    };
    expect(toInvoiceDeliveryEventSummary(row)).toStrictEqual({
      ccEmail: row.cc_email,
      createdAt: row.created_at,
      deliveryMethod,
      documentSource,
      id: row.id,
      provider,
      recipientEmail: row.recipient_email,
      safeErrorMessage: row.safe_error_message,
      sendMode,
      status: row.status,
    });
  });

  it.each([
    { send_mode: 'unknown' },
    { binding_kind: 'unknown' },
    { binding_kind: 'legacyMissingDocument', document_id: null },
    { document_id: null },
    { document_id: '' },
    { document_id: '  ' },
    { send_mode: 'legacyUnknown' },
    { binding_kind: 'legacyOriginal' },
    { binding_kind: 'legacyOriginal', document_id: null },
    { binding_kind: 'preservedLegacy', document_id: null },
    { binding_kind: 'preservedLegacy', send_mode: 'smtpTest' },
    { binding_kind: 'preservedLegacy', send_mode: 'legacyUnknown' },
    { binding_kind: 'preservedLegacy', send_mode: 'dryRun', provider: 'dryRun' },
    { binding_kind: 'preservedLegacy', send_mode: 'manual', provider: 'manual', delivery_method: 'print' },
    { provider: 'manual' },
    { delivery_method: 'print' },
    { send_mode: 'smtpTest', provider: 'dryRun' },
    { send_mode: 'dryRun' },
    { send_mode: 'dryRun', provider: 'dryRun', delivery_method: 'manual' },
    { send_mode: 'manual' },
    { send_mode: 'manual', provider: 'manual' },
  ])('rejects inconsistent stored provenance without exposing row data: %j', (overrides) => {
    expect(() => toInvoiceDeliveryEventSummary({ ...createRow(), ...overrides } as unknown as Parameters<typeof toInvoiceDeliveryEventSummary>[0]))
      .toThrow(new InvoiceDocumentIntegrityError());
  });
});

function createDryRunEvent(
  status: InvoiceDryRunDeliveryEvent['status'],
): InvoiceDryRunDeliveryEvent {
  return {
    ...createEvent(),
    deliveryMethod: 'email',
    documentId: 'document-1',
    provider: 'dryRun',
    status,
    target: {
      kind: 'revision',
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
      revisionId: 'revision-1',
      documentId: 'document-1',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      sizeBytes: 2048,
    },
  };
}

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
    binding_kind: 'revision',
    revision_id: 'revision-1',
    send_mode: 'customer',
    document_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    document_size_bytes: 2048,
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
