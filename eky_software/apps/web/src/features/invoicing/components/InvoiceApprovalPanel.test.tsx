import type { ApprovedInvoiceResult } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  InvoiceApprovalConfirmation,
  InvoiceApprovalSuccessPanel,
} from './InvoiceApprovalPanel.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceApprovalConfirmation', () => {
  it('renders the confirmation text and action buttons', () => {
    const html = renderToStaticMarkup(
      <InvoiceApprovalConfirmation
        isApproving={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.approveDraftConfirmationTitle);
    expect(html).toContain(uiText.invoicing.approveDraftConfirmationIntro);
    expect(html).toContain(uiText.invoicing.approveDraftConfirmationLock);
    expect(html).toContain(uiText.invoicing.approveDraftConfirmAction);
    expect(html).toContain(uiText.invoicing.cancel);
  });

  it('shows a loading label while approval is running', () => {
    const html = renderToStaticMarkup(
      <InvoiceApprovalConfirmation
        isApproving={true}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.approvingDraft);
  });
});

describe('InvoiceApprovalSuccessPanel', () => {
  it('renders the approved invoice number and reference number', () => {
    const html = renderToStaticMarkup(
      <InvoiceApprovalSuccessPanel
        approvedInvoice={createApprovedInvoiceResult()}
        onBack={vi.fn()}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.approveDraftSuccess);
    expect(html).toContain(uiText.invoicing.invoiceNumber);
    expect(html).toContain('2026001');
    expect(html).toContain(uiText.invoicing.referenceNumber);
    expect(html).toContain('20260015');
    expect(html).toContain(uiText.invoicing.invoicePreviewOpen);
    expect(html).toContain(uiText.invoicing.backToDrafts);
    expect(html).not.toContain('finnishDomestic');
  });
});

function createApprovedInvoiceResult(): ApprovedInvoiceResult {
  return {
    draftId: 'draft-1',
    invoiceId: 'invoice-1',
    invoiceNumber: '2026001',
    numberingMode: 'calendarYearSequence',
    referenceNumber: '20260015',
    referenceNumberType: 'finnishDomestic',
    sequenceNumber: 1,
    sequenceScope: '2026',
    status: 'approved',
  };
}
