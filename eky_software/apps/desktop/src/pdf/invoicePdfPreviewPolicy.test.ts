import { describe, expect, it } from 'vitest';

import { isAllowedBackendRequest } from '../main/protocolPolicy.js';
import {
  createInvoicePdfPreviewUrl,
  createInvoicePdfPreviewWindowOptions,
  isAllowedInvoicePdfPreviewNavigation,
} from './invoicePdfPreviewPolicy.js';

describe('invoice PDF preview policy', () => {
  it('creates only the approved application PDF URL from a strict resource id', () => {
    expect(createInvoicePdfPreviewUrl('invoice_2026-1')).toBe(
      'eky://app/invoices/invoice_2026-1/pdf',
    );
    expect(createInvoicePdfPreviewUrl('invoice_2026-1', undefined)).toBe(
      'eky://app/invoices/invoice_2026-1/pdf',
    );

    for (const value of [
      '',
      '../invoice-1',
      'invoice/1',
      'invoice%2f1',
      'https://example.com/invoice.pdf',
      'file:///C:/secret.pdf',
      'data:application/pdf;base64,JVBERi0=',
      'javascript:alert(1)',
      'x'.repeat(101),
      'invoice-1\n',
      'invoice-1\r',
      'invoice-1\u2028',
      'invoice-1\u2029',
      123,
      null,
    ]) {
      expect(() => createInvoicePdfPreviewUrl(value)).toThrow(
        'INVOICE_PDF_PREVIEW_INVALID_ID',
      );
    }
  });

  it('binds a preserved preview to the exact invoice and document ids', () => {
    expect(createInvoicePdfPreviewUrl('invoice_2026-1', {
      kind: 'preservedLegacy',
      documentId: 'document_2026-2',
    })).toBe(
      'eky://app/invoices/invoice_2026-1/preserved-documents/document_2026-2/pdf',
    );

    const longestUrl = createInvoicePdfPreviewUrl('i'.repeat(100), {
      kind: 'preservedLegacy',
      documentId: 'd'.repeat(100),
    });
    expect(isAllowedBackendRequest('GET', new URL(longestUrl).pathname)).toBe(true);
  });

  it.each([
    null,
    false,
    1,
    'document-1',
    [],
    {},
    { kind: 'preservedLegacy' },
    { documentId: 'document-1' },
    { kind: undefined, documentId: 'document-1' },
    { kind: 'revision', documentId: 'document-1' },
    { kind: 'unknown', documentId: 'document-1' },
    { kind: 'preservedLegacy', documentId: null },
    { kind: 'preservedLegacy', documentId: 1 },
    { kind: 'preservedLegacy', documentId: '' },
    { kind: 'preservedLegacy', documentId: '../document-1' },
    { kind: 'preservedLegacy', documentId: 'document/1' },
    { kind: 'preservedLegacy', documentId: 'document%2f1' },
    { kind: 'preservedLegacy', documentId: 'document-1?companyId=other' },
    { kind: 'preservedLegacy', documentId: 'document-1#page=2' },
    { kind: 'preservedLegacy', documentId: 'document-1\n' },
    { kind: 'preservedLegacy', documentId: 'document-1\r' },
    { kind: 'preservedLegacy', documentId: 'document-1\u2028' },
    { kind: 'preservedLegacy', documentId: 'document-1\u2029' },
    { kind: 'preservedLegacy', documentId: 'd'.repeat(101) },
    { kind: 'preservedLegacy', documentId: 'https://example.test/doc.pdf' },
    { kind: 'preservedLegacy', documentId: 'file:///C:/doc.pdf' },
    { kind: 'preservedLegacy', documentId: 'document-1', url: 'https://example.test' },
    { kind: 'preservedLegacy', documentId: 'document-1', path: '/document.pdf' },
    { kind: 'preservedLegacy', documentId: 'document-1', body: {} },
    { kind: 'preservedLegacy', documentId: 'document-1', companyId: 'other' },
    { kind: 'preservedLegacy', documentId: 'document-1', extra: undefined },
    { kind: 'preservedLegacy', documentId: 'document-1', [Symbol('extra')]: true },
    Object.create({ kind: 'preservedLegacy', documentId: 'document-1' }),
  ])('rejects an invalid preserved target without normal-preview fallback: %o', (target) => {
    expect(() => createInvoicePdfPreviewUrl('invoice-1', target)).toThrow(
      'INVOICE_PDF_PREVIEW_INVALID_TARGET',
    );
  });

  it('does not relax invoice id validation for preserved previews', () => {
    expect(() => createInvoicePdfPreviewUrl('../invoice-1', {
      kind: 'preservedLegacy',
      documentId: 'document-1',
    })).toThrow('INVOICE_PDF_PREVIEW_INVALID_ID');
  });

  it('binds delivery-event previews to strict invoice and event ids', () => {
    const target = { kind: 'deliveryEvent', eventId: 'event_2026-1' };
    const expectedUrl = 'eky://app/invoices/invoice-1/delivery-events/event_2026-1/pdf';
    expect(createInvoicePdfPreviewUrl('invoice-1', target)).toBe(expectedUrl);
    expect(createInvoicePdfPreviewUrl('invoice-1',
      Object.assign(Object.create(null), target),
    )).toBe(expectedUrl);
    const longestUrl = createInvoicePdfPreviewUrl('i'.repeat(100), {
      kind: 'deliveryEvent', eventId: 'e'.repeat(100),
    });
    expect(isAllowedBackendRequest('GET', new URL(longestUrl).pathname)).toBe(true);
    expect(() => createInvoicePdfPreviewUrl('../invoice-1', target))
      .toThrow('INVOICE_PDF_PREVIEW_INVALID_ID');
  });

  it.each([
    { kind: 'deliveryEvent' },
    { eventId: 'event-1' },
    { kind: undefined, eventId: 'event-1' },
    { kind: 'unknown', eventId: 'event-1' },
    { kind: 'deliveryEvent', documentId: 'event-1' },
    { kind: 'preservedLegacy', eventId: 'event-1' },
    { kind: 'deliveryEvent', eventId: 'event-1', documentId: 'document-1' },
    { kind: 'deliveryEvent', eventId: 'event-1', url: 'https://example.test' },
    { kind: 'deliveryEvent', eventId: 'event-1', path: '/event.pdf' },
    { kind: 'deliveryEvent', eventId: 'event-1', session: 'synthetic' },
    { kind: 'deliveryEvent', eventId: 'event-1', companyId: 'other' },
    { kind: 'deliveryEvent', eventId: 'event-1', extra: undefined },
    { kind: 'deliveryEvent', eventId: 'event-1', [Symbol('extra')]: true },
    Object.defineProperty({ kind: 'deliveryEvent', eventId: 'event-1' }, 'extra', {
      value: true, enumerable: false,
    }),
    Object.create({ kind: 'deliveryEvent', eventId: 'event-1' }),
    Object.assign(Object.create({}), { kind: 'deliveryEvent', eventId: 'event-1' }),
    ...[
      undefined, null, false, 1, {}, [], '', '../event-1', 'event/1', 'event%2f1',
      'event-1?companyId=other', 'event-1#page=2', 'event-1\\other',
      'event-1\n', 'event-1\r', 'event-1\u2028', 'event-1\u2029',
      'e'.repeat(101), 'https://example.test/event.pdf', 'file:///C:/event.pdf',
    ].map((eventId) => ({ kind: 'deliveryEvent', eventId })),
  ])('rejects invalid delivery-event targets without a current PDF fallback: %o', (target) => {
    expect(() => createInvoicePdfPreviewUrl('invoice-1', target))
      .toThrow('INVOICE_PDF_PREVIEW_INVALID_TARGET');
  });

  it('restricts delivery-event navigation to the exact invoice and event URL', () => {
    const expectedUrl = createInvoicePdfPreviewUrl('invoice-1', {
      kind: 'deliveryEvent', eventId: 'event-1',
    });
    expect(isAllowedInvoicePdfPreviewNavigation(expectedUrl, expectedUrl)).toBe(true);
    for (const targetUrl of [
      createInvoicePdfPreviewUrl('invoice-1'),
      createInvoicePdfPreviewUrl('invoice-1', {
        kind: 'preservedLegacy', documentId: 'event-1',
      }),
      createInvoicePdfPreviewUrl('invoice-1', {
        kind: 'deliveryEvent', eventId: 'event-2',
      }),
      createInvoicePdfPreviewUrl('invoice-2', {
        kind: 'deliveryEvent', eventId: 'event-1',
      }),
      `${expectedUrl}?companyId=other`,
      `${expectedUrl}#page=2`,
    ]) {
      expect(isAllowedInvoicePdfPreviewNavigation(targetUrl, expectedUrl)).toBe(false);
    }
  });

  it('does not allow a preserved preview to navigate to another document or normal PDF', () => {
    const expectedUrl = createInvoicePdfPreviewUrl('invoice-1', {
      kind: 'preservedLegacy',
      documentId: 'document-1',
    });

    expect(isAllowedInvoicePdfPreviewNavigation(expectedUrl, expectedUrl)).toBe(true);
    for (const targetUrl of [
      createInvoicePdfPreviewUrl('invoice-1'),
      createInvoicePdfPreviewUrl('invoice-1', {
        kind: 'preservedLegacy',
        documentId: 'document-2',
      }),
      createInvoicePdfPreviewUrl('invoice-2', {
        kind: 'preservedLegacy',
        documentId: 'document-1',
      }),
      `${expectedUrl}?companyId=other`,
      `${expectedUrl}#page=2`,
      'https://example.test/document.pdf',
    ]) {
      expect(isAllowedInvoicePdfPreviewNavigation(targetUrl, expectedUrl)).toBe(false);
    }
  });

  it('allows navigation only to the exact main-created PDF URL', () => {
    const expectedUrl = createInvoicePdfPreviewUrl('invoice-1');

    expect(
      isAllowedInvoicePdfPreviewNavigation(expectedUrl, expectedUrl),
    ).toBe(true);
    expect(
      isAllowedInvoicePdfPreviewNavigation(
        'eky://app/invoices/invoice-2/pdf',
        expectedUrl,
      ),
    ).toBe(false);
    expect(
      isAllowedInvoicePdfPreviewNavigation(`${expectedUrl}?session=secret`, expectedUrl),
    ).toBe(false);
    expect(
      isAllowedInvoicePdfPreviewNavigation(`${expectedUrl}#page=2`, expectedUrl),
    ).toBe(false);

    for (const targetUrl of [
      'http://127.0.0.1:3000/invoices/invoice-1/pdf',
      'https://example.com/invoice.pdf',
      'file:///C:/secret.pdf',
      'data:application/pdf;base64,JVBERi0=',
      'javascript:alert(1)',
    ]) {
      expect(
        isAllowedInvoicePdfPreviewNavigation(targetUrl, expectedUrl),
      ).toBe(false);
    }
  });

  it('creates a sandboxed child window without preload or Node privileges', () => {
    const parent = {} as never;
    const options = createInvoicePdfPreviewWindowOptions(parent);

    expect(options).toMatchObject({
      modal: false,
      parent,
      show: false,
    });
    expect(options.webPreferences).toEqual({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      plugins: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
    expect(options.webPreferences).not.toHaveProperty('preload');
  });
});
