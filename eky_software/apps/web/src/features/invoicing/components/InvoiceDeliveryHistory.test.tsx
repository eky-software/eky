import type { InvoiceDeliveryEventSummary } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceDeliveryHistory } from './InvoiceDeliveryHistory.js';
import { uiText } from '../../../i18n/fi.js';

function event(overrides: Partial<InvoiceDeliveryEventSummary> = {}): InvoiceDeliveryEventSummary {
  return {
    id: 'event-1', createdAt: '2026-07-20T20:00:00.000Z', deliveryMethod: 'email',
    provider: 'smtp', sendMode: 'smtpTest', documentSource: 'revision',
    recipientEmail: 'synthetic@example.invalid', ccEmail: '', status: 'succeeded',
    safeErrorMessage: null, ...overrides,
  };
}

function render(events: InvoiceDeliveryEventSummary[]) {
  return renderToStaticMarkup(<InvoiceDeliveryHistory invoiceId="invoice-1"
    events={events} errorMessage={null} isLoading={false} onOpenPdf={vi.fn(async () => true)} />);
}

describe('delivery history PDF presentation', () => {
  it.each(['customer', 'smtpTest', 'dryRun', 'manual', 'legacyUnknown'] as const)(
    'labels %s explicitly without deriving purpose from provider or recipient', sendMode => {
      expect(render([event({ sendMode })])).toContain(uiText.invoicing.invoiceDeliveryModes[sendMode]);
    },
  );
  it.each(['revision', 'preservedLegacy', 'legacyOriginal'] as const)('labels %s PDF evidence without claiming an old delivery is proven', documentSource => {
    const html = render([event({ documentSource })]);
    expect(html).toContain(uiText.invoicing.invoiceDeliveryDocumentSources[documentSource]);
    expect(html).toContain(uiText.invoicing.invoiceDeliveryPdfOpen);
  });
  it('does not offer PDF creation or opening for original missing legacy evidence', () => {
    const html = render([event({ documentSource: 'legacyMissingDocument', sendMode: 'legacyUnknown' })]);
    expect(html).toContain(uiText.invoicing.invoiceDeliveryDocumentSources.legacyMissingDocument);
    expect(html).not.toContain('<button');
    expect(html).not.toContain(uiText.invoicing.approvedInvoicePdfCreate);
  });
  it('does not render raw provider errors or interpret unknown outcome as failure', () => {
    const html = render([event({ status: 'outcomeUnknown', safeErrorMessage: 'synthetic-private-error' })]);
    expect(html).toContain(uiText.invoicing.invoiceDeliveryHistoryOutcomeUnknown);
    expect(html).not.toContain('synthetic-private-error');
  });
});
