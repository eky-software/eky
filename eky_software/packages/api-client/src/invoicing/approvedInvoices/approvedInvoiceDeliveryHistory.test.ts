import { describe, expect, it, vi } from 'vitest';

import { EkyApiError } from '../../http.js';
import { readInvoiceDeliveryEventListResponse } from './approvedInvoiceDeliveryResponse.js';
import { createApprovedInvoicesApi } from './approvedInvoicesClient.js';
import type { InvoiceDeliveryEventSummary } from './approvedInvoicesTypes.js';

function summary(): InvoiceDeliveryEventSummary {
  return {
    ccEmail: '',
    createdAt: '2026-07-20T20:00:00.000Z',
    deliveryMethod: 'email',
    documentSource: 'revision',
    id: 'event-1',
    provider: 'smtp',
    recipientEmail: 'customer@example.invalid',
    safeErrorMessage: null,
    sendMode: 'customer',
    status: 'succeeded',
  };
}

describe('delivery history wire contract', () => {
  it.each([
    { sendMode: 'customer', documentSource: 'revision' },
    { sendMode: 'smtpTest', documentSource: 'revision' },
    { sendMode: 'dryRun', documentSource: 'revision', provider: 'dryRun' },
    { sendMode: 'manual', documentSource: 'revision', provider: 'manual', deliveryMethod: 'print' },
    { sendMode: 'customer', documentSource: 'preservedLegacy' },
    { sendMode: 'legacyUnknown', documentSource: 'legacyOriginal' },
    { sendMode: 'legacyUnknown', documentSource: 'legacyMissingDocument' },
  ] satisfies Partial<InvoiceDeliveryEventSummary>[])('preserves explicit provenance %j', (fields) => {
    const event = { ...summary(), ...fields };
    expect(readInvoiceDeliveryEventListResponse({ events: [event] })).toStrictEqual([event]);
  });

  it.each(['sendMode', 'documentSource'] as const)('rejects absent %s', (field) => {
    const event: Record<string, unknown> = { ...summary() };
    delete event[field];
    expect(() => readInvoiceDeliveryEventListResponse({ events: [event] }))
      .toThrow(EkyApiError);
  });

  it.each([
    ['sendMode', undefined],
    ['sendMode', null],
    ['sendMode', 'smtp'],
    ['sendMode', 'Customer'],
    ['sendMode', ''],
    ['sendMode', true],
    ['sendMode', 1],
    ['sendMode', {}],
    ['sendMode', ['customer']],
    ['documentSource', undefined],
    ['documentSource', null],
    ['documentSource', 'current'],
    ['documentSource', 'Revision'],
    ['documentSource', ''],
    ['documentSource', false],
    ['documentSource', 1],
    ['documentSource', {}],
    ['documentSource', ['revision']],
  ] as const)('rejects malformed %s: %j', (field, value) => {
    expect(() => readInvoiceDeliveryEventListResponse({
      events: [{ ...summary(), [field]: value }],
    })).toThrow(EkyApiError);
  });

  it('does not forward document evidence, paths, identities or authorization', () => {
    expect(readInvoiceDeliveryEventListResponse({ events: [{
      ...summary(),
      documentId: 'private-document',
      revisionId: 'private-revision',
      companyId: 'private-company',
      createdBy: 'private-actor',
      sha256: 'private-hash',
      sizeBytes: 512,
      storagePath: 'private/document.pdf',
      authorizationToken: 'private-token',
    }] })).toStrictEqual([summary()]);
  });
});

describe('delivery event PDF URL', () => {
  it.each(['https://example.invalid', 'eky://app'])('uses the fixed read-only route at %s without fetching', (baseUrl) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApprovedInvoicesApi(fetch, baseUrl);
    expect(api.getInvoiceDeliveryEventPdfUrl('invoice-1', 'event-1')).toBe(
      `${baseUrl}/invoices/invoice-1/delivery-events/event-1/pdf`,
    );
    expect(api.getInvoiceDeliveryEventPdfUrl('invoice/other', 'https://other.invalid/file?companyId=foreign#pdf')).toBe(
      `${baseUrl}/invoices/invoice%2Fother/delivery-events/https%3A%2F%2Fother.invalid%2Ffile%3FcompanyId%3Dforeign%23pdf/pdf`,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
