import { describe, expect, it, vi } from 'vitest';
import { EkyApiError } from '../../http.js';
import { createInvoiceDraftsApi } from './invoiceDraftsClient.js';
import { readInvoiceDraftDeliveryHistoryResponse } from './invoiceDraftDeliveryHistoryResponse.js';

const event = {
  id: 'event-1', createdAt: '2026-07-20T20:00:00.000Z', deliveryMethod: 'email',
  provider: 'smtp', sendMode: 'smtpTest', documentSource: 'revision',
  recipientEmail: 'synthetic@example.invalid', ccEmail: '', status: 'succeeded',
  safeErrorMessage: null,
};

describe('editable draft delivery history', () => {
  it('reads the encoded GET route and returns only the history projection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      invoiceDeliveryHistory: { invoiceId: 'invoice-1', events: [event], companyId: 'private-company' },
    })));
    const api = createInvoiceDraftsApi(fetch, 'https://example.invalid');
    expect(await api.getInvoiceDraftDeliveryHistory('draft/one')).toEqual({ invoiceId: 'invoice-1', events: [event] });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://example.invalid/invoice-drafts/draft%2Fone/delivery-history');
    expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
  });

  it('accepts an ordinary draft without an invoice identity', () => {
    expect(readInvoiceDraftDeliveryHistoryResponse({ invoiceDeliveryHistory: { invoiceId: null, events: [] } }))
      .toEqual({ invoiceId: null, events: [] });
  });

  it.each([undefined, '', 'a/b', 'invoice\n', 'invoice\r', 'invoice\u2028', 'https://example.invalid', 'a'.repeat(101), 1, {}])(
    'rejects invalid invoice identity %j', invoiceId => {
      expect(() => readInvoiceDraftDeliveryHistoryResponse({ invoiceDeliveryHistory: { invoiceId, events: [] } }))
        .toThrow(EkyApiError);
    },
  );

  it.each([
    null, {}, { invoiceDeliveryHistory: null },
    { invoiceDeliveryHistory: { invoiceId: null, events: [event] } },
    { invoiceDeliveryHistory: { invoiceId: 'invoice-1', events: null } },
    { invoiceDeliveryHistory: { invoiceId: 'invoice-1', events: [{ ...event, sendMode: 'unknown' }] } },
  ])('rejects malformed or unbound history', body => {
    expect(() => readInvoiceDraftDeliveryHistoryResponse(body)).toThrow(EkyApiError);
  });
});
