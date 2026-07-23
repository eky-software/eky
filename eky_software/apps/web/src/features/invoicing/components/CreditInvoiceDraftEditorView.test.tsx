import type { CreditInvoiceDraft } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CreditInvoiceDraftEditorView } from './CreditInvoiceDraftEditorView.js';
import { uiText } from '../../../i18n/fi.js';

describe('CreditInvoiceDraftEditorView', () => {
  it('shows source details, editable credit lines and negative saved totals', () => {
    const html = renderToStaticMarkup(
      <CreditInvoiceDraftEditorView
        approvalErrorMessage={null}
        draft={createCreditDraft()}
        errorMessage={null}
        isApproving={false}
        isLoading={false}
        isSaving={false}
        successMessage={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.creditDraftTitle);
    expect(html).toContain('20260001');
    expect(html).toContain('1001 – Asiakas Oy');
    expect(html).toContain(uiText.invoicing.creditDraftIncludeLine);
    expect(html).toContain('−125,50');
    expect(html).toContain(uiText.invoicing.creditDraftApprove);
    expect(html).toContain('readonly');
    expect(html).not.toContain('companyId');
    expect(html).not.toContain('creditedInvoiceId');
  });

  it('shows a safe loading state', () => {
    const html = renderToStaticMarkup(
      <CreditInvoiceDraftEditorView
        approvalErrorMessage={null}
        draft={null}
        errorMessage={null}
        isApproving={false}
        isLoading
        isSaving={false}
        successMessage={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.creditDraftLoading);
  });
});

function createCreditDraft(): CreditInvoiceDraft {
  return {
    id: 'credit-draft-1',
    invoiceKind: 'credit',
    creditedInvoiceId: 'invoice-1',
    creditedInvoiceNumber: '20260001',
    creditedInvoiceDate: '2026-07-01',
    customer: createParty('customer-1', '1001', 'Asiakas Oy'),
    billingRecipient: createParty('customer-1', '1001', 'Asiakas Oy'),
    invoiceDate: '2026-07-23',
    dueDate: '2026-07-23',
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: 'net',
    subject: 'Hyvityslasku laskulle 20260001',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    refundIban: '',
    lines: [
      {
        id: 'line-1',
        lineType: 'source',
        sourceInvoiceLineId: 'source-line-1',
        isIncluded: true,
        position: 1,
        code: 'WORK',
        description: 'Työ',
        quantityHundredths: 100,
        maximumQuantityHundredths: 200,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2_550,
        discount: { type: 'none' },
        baseCents: 10_000,
        discountCents: 0,
        netCents: 10_000,
        vatCents: 2_550,
        grossCents: 12_550,
      },
    ],
    totals: {
      netTotalCents: 10_000,
      vatTotalCents: 2_550,
      grossTotalCents: 12_550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2_550,
          netCents: 10_000,
          vatCents: 2_550,
          grossCents: 12_550,
        },
      ],
    },
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
  };
}

function createParty(
  customerId: string,
  customerNumber: string,
  name: string,
) {
  return {
    customerId,
    customerNumber,
    name,
    businessId: '',
    email: '',
    phone: '',
    streetAddress: '',
    postalCode: '',
    city: '',
  };
}
