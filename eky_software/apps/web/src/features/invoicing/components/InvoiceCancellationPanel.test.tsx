import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  InvoiceCancellationPanel,
  isInvoiceCancellationConfirmationValid,
} from './InvoiceCancellationPanel.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceCancellationPanel', () => {
  it('shows the invoice number, reason field and disabled confirmation', () => {
    const html = renderToStaticMarkup(
      <InvoiceCancellationPanel
        errorMessage={null}
        invoiceNumber="20260001"
        isCancelling={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.cancelApprovedInvoiceWarning);
    expect(html).toContain('20260001');
    expect(html).toContain(
      uiText.invoicing.cancelApprovedInvoiceReasonLabel,
    );
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('disabled=""');
  });

  it('renders only a safe caller-provided error', () => {
    const html = renderToStaticMarkup(
      <InvoiceCancellationPanel
        errorMessage={uiText.invoicing.cancelApprovedInvoiceConflictError}
        invoiceNumber="20260001"
        isCancelling={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain(
      uiText.invoicing.cancelApprovedInvoiceConflictError,
    );
    expect(html).not.toContain('stack');
  });
});

describe('isInvoiceCancellationConfirmationValid', () => {
  it('requires the exact invoice number and a bounded reason', () => {
    expect(
      isInvoiceCancellationConfirmationValid({
        cancellationReason: 'Duplicate invoice',
        confirmationInvoiceNumber: '20260001',
        invoiceNumber: '20260001',
      }),
    ).toBe(true);
    expect(
      isInvoiceCancellationConfirmationValid({
        cancellationReason: 'Duplicate invoice',
        confirmationInvoiceNumber: '20260002',
        invoiceNumber: '20260001',
      }),
    ).toBe(false);
    expect(
      isInvoiceCancellationConfirmationValid({
        cancellationReason: '   ',
        confirmationInvoiceNumber: '20260001',
        invoiceNumber: '20260001',
      }),
    ).toBe(false);
    expect(
      isInvoiceCancellationConfirmationValid({
        cancellationReason: 'x'.repeat(501),
        confirmationInvoiceNumber: '20260001',
        invoiceNumber: '20260001',
      }),
    ).toBe(false);
  });
});
