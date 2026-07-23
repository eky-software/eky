import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceActions } from './ApprovedInvoiceActions.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoiceActions', () => {
  it('renders approved invoice actions', () => {
    const html = renderActions();

    expect(html).toContain(uiText.invoicing.statusApproved);
    expect(html).toContain(uiText.invoicing.editApprovedInvoice);
    expect(html).toContain(uiText.invoicing.markApprovedInvoiceSent);
    expect(html).toContain(uiText.invoicing.cancelApprovedInvoice);
  });

  it('disables the sent action while the PDF is being prepared', () => {
    const html = renderActions({ isCreatingPdf: true });

    expect(html).toContain(uiText.invoicing.approvedInvoicePdfCreating);
    expect(html).toContain('disabled=""');
  });

  it('renders sent status and hides editing actions for sent invoices', () => {
    const html = renderActions({ invoiceStatus: 'sent' });

    expect(html).toContain(uiText.invoicing.statusSent);
    expect(html).toContain(uiText.invoicing.copyApprovedInvoice);
    expect(html).not.toContain(uiText.invoicing.editApprovedInvoice);
    expect(html).not.toContain(uiText.invoicing.markApprovedInvoiceSent);
    expect(html).not.toContain(uiText.invoicing.cancelApprovedInvoice);
  });

  it('shows credit creation only when the backend context allows it', () => {
    const allowedHtml = renderActions({
      canCreateCreditDraft: true,
      invoiceStatus: 'sent',
    });
    const blockedHtml = renderActions({
      canCreateCreditDraft: false,
      invoiceStatus: 'sent',
    });

    expect(allowedHtml).toContain(uiText.invoicing.createCreditDraft);
    expect(blockedHtml).not.toContain(uiText.invoicing.createCreditDraft);
  });

  it('renders safe action errors without technical data', () => {
    const html = renderActions({
      copyErrorMessage: uiText.invoicing.copyApprovedInvoiceError,
      emailErrorMessage: uiText.invoicing.invoiceEmailPrepareError,
      invoiceStatus: 'sent',
      pdfErrorMessage: uiText.invoicing.approvedInvoicePdfError,
    });

    expect(html).toContain(uiText.invoicing.copyApprovedInvoiceError);
    expect(html).toContain(uiText.invoicing.invoiceEmailPrepareError);
    expect(html).toContain(uiText.invoicing.approvedInvoicePdfError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('shows the PDF create action only when no stored PDF is available', () => {
    const html = renderActions({ isPdfAvailable: false });

    expect(html).toContain(uiText.invoicing.approvedInvoicePdfCreate);
    expect(html).not.toContain(uiText.invoicing.approvedInvoiceOpenPdf);
  });

  it('shows the PDF open action only when a stored PDF is available', () => {
    const html = renderActions({ isPdfAvailable: true });

    expect(html).toContain(uiText.invoicing.approvedInvoiceOpenPdf);
    expect(html).toContain('secondary-action');
    expect(html).not.toContain(uiText.invoicing.approvedInvoicePdfCreate);
  });
});

type ApprovedInvoiceActionsProps = React.ComponentProps<
  typeof ApprovedInvoiceActions
>;

function renderActions(
  overrides: Partial<ApprovedInvoiceActionsProps> = {},
): string {
  return renderToStaticMarkup(
    <ApprovedInvoiceActions
      canCreateCreditDraft={false}
      cancellationErrorMessage={null}
      copyErrorMessage={null}
      emailErrorMessage={null}
      invoiceId="invoice-1"
      invoiceKind="standard"
      invoiceNumber="20260001"
      invoiceStatus="approved"
      isCancellingInvoice={false}
      isCopyingInvoice={false}
      isCreatingPdf={false}
      isMarkingSent={false}
      isPdfAvailable={false}
      isPreparingEmail={false}
      isReopening={false}
      markSentErrorMessage={null}
      pdfErrorMessage={null}
      reopenErrorMessage={null}
      onBack={vi.fn()}
      onCancelInvoice={vi.fn()}
      onCopyInvoice={vi.fn()}
      onCreateCreditDraft={vi.fn()}
      onCreatePdf={vi.fn()}
      onEditInvoice={vi.fn()}
      onMarkSent={vi.fn()}
      onOpenPdf={vi.fn()}
      onPrepareEmail={vi.fn()}
      {...overrides}
    />,
  );
}
