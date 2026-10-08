import type { InvoiceDraftDeliveryHistory as History } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceDraftDeliveryHistory } from './InvoiceDraftDeliveryHistory.js';
import { uiText } from '../../../i18n/fi.js';

const observed = vi.hoisted(() => ({ history: null as History | null, errorMessage: null as string | null, isLoading: false }));
vi.mock('../hooks/useInvoiceDraftDeliveryHistory.js', () => ({ useInvoiceDraftDeliveryHistory: () => observed }));
function render() {
  return renderToStaticMarkup(<InvoiceDraftDeliveryHistory draftId="draft-1"
    apiClient={{ getInvoiceDraftDeliveryHistory: vi.fn() }} onOpenPdf={vi.fn(async () => true)} />);
}
describe('draft history presentation', () => {
  it('does not add an empty history section to ordinary drafts', () => {
    observed.history = { invoiceId: null, events: [] };
    expect(render()).toBe('');
  });
  it('shows loading and failure without offering an unbound PDF action', () => {
    observed.history = null;
    observed.isLoading = true;
    expect(render()).toContain(uiText.invoicing.invoiceDeliveryHistoryLoading);
    observed.isLoading = false;
    observed.errorMessage = uiText.invoicing.invoiceDeliveryHistoryError;
    expect(render()).toContain('role="alert"');
    expect(render()).not.toContain('<button');
  });
  it('shows preserved history with the existing event PDF action', () => {
    observed.isLoading = false;
    observed.errorMessage = null;
    observed.history = { invoiceId: 'invoice-1', events: [{
      id: 'event-1', createdAt: '2026-07-20T20:00:00.000Z', deliveryMethod: 'email',
      provider: 'smtp', sendMode: 'smtpTest', documentSource: 'revision',
      recipientEmail: 'synthetic@example.invalid', ccEmail: '', status: 'succeeded', safeErrorMessage: null,
    }] };
    expect(render()).toContain(uiText.invoicing.invoiceDeliveryModes.smtpTest);
    expect(render()).toContain(uiText.invoicing.invoiceDeliveryPdfOpen);
  });
});
