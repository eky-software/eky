import type {
  ApprovedInvoiceView,
  InvoiceCreditContext,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceCreditRelations } from './InvoiceCreditRelations.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceCreditRelations', () => {
  it('shows related credits, remaining amount and an active draft', () => {
    const html = renderRelations({
      context: createCreditContext(),
      invoice: createInvoice(),
    });

    expect(html).toContain(uiText.invoicing.creditStatusPartial);
    expect(html).toContain('100,00');
    expect(html).toContain(uiText.invoicing.openActiveCreditDraft);
    expect(html).toContain('20260002');
    expect(html).toContain('−25,50');
  });

  it('links a credit invoice back to its source invoice', () => {
    const html = renderRelations({
      context: null,
      invoice: createInvoice({
        id: 'credit-invoice-1',
        invoiceKind: 'credit',
        creditedInvoiceId: 'invoice-1',
        creditedInvoiceNumber: '20260001',
        creditedInvoiceDate: '2026-07-01',
      }),
    });

    expect(html).toContain(uiText.invoicing.openCreditedInvoice('20260001'));
  });

  it('shows a safe context error without technical details', () => {
    const html = renderRelations({
      context: null,
      errorMessage: uiText.invoicing.creditContextLoadError,
      invoice: createInvoice(),
    });

    expect(html).toContain(uiText.invoicing.creditContextLoadError);
    expect(html).not.toContain('stack');
  });
});

type Props = React.ComponentProps<typeof InvoiceCreditRelations>;

function renderRelations(overrides: Partial<Props>): string {
  return renderToStaticMarkup(
    <InvoiceCreditRelations
      context={null}
      errorMessage={null}
      invoice={createInvoice()}
      isLoading={false}
      onOpenDraft={vi.fn()}
      onOpenInvoice={vi.fn()}
      {...overrides}
    />,
  );
}

function createCreditContext(): InvoiceCreditContext {
  return {
    sourceInvoiceId: 'invoice-1',
    creditInvoices: [
      {
        id: 'credit-invoice-1',
        invoiceKind: 'credit',
        creditedInvoiceId: 'invoice-1',
        invoiceNumber: '20260002',
        referenceNumber: '',
        status: 'approved',
        customerId: 'customer-1',
        customerNumberSnapshot: '1001',
        customerNameSnapshot: 'Asiakas Oy',
        billingRecipientNameSnapshot: 'Asiakas Oy',
        invoiceDate: '2026-07-02',
        dueDate: '2026-07-02',
        grossTotalCents: 2_550,
        approvedAt: '2026-07-02T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
        cancelledAt: null,
      },
    ],
    creditStatus: 'partial',
    remainingCreditableGrossCents: 10_000,
    activeCreditDraftId: 'credit-draft-1',
  };
}

function createInvoice(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    companyId: 'company-1',
    sourceDraftId: 'draft-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2026',
    sequenceNumber: 1,
    numberingMode: 'calendarYearSequence',
    status: 'sent',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Asiakas Oy',
    customerBusinessIdSnapshot: '',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: '',
    customerPhoneSnapshot: '',
    customerStreetAddressSnapshot: '',
    customerPostalCodeSnapshot: '',
    customerCitySnapshot: '',
    companyNameSnapshot: 'Myyjä Oy',
    companyBusinessIdSnapshot: '',
    companyVatNumberSnapshot: '',
    companyStreetAddressSnapshot: '',
    companyPostalCodeSnapshot: '',
    companyCitySnapshot: '',
    companyEmailSnapshot: '',
    companyPhoneSnapshot: '',
    companyWebsiteSnapshot: '',
    companyIbanSnapshot: '',
    companyBicSnapshot: '',
    companyBankNameSnapshot: '',
    billingRecipientCustomerId: null,
    billingRecipientCustomerNumberSnapshot: '',
    billingRecipientNameSnapshot: 'Asiakas Oy',
    billingRecipientBusinessIdSnapshot: '',
    billingRecipientCustomerTypeSnapshot: 'company',
    billingRecipientEmailSnapshot: '',
    billingRecipientPhoneSnapshot: '',
    billingRecipientStreetAddressSnapshot: '',
    billingRecipientPostalCodeSnapshot: '',
    billingRecipientCitySnapshot: '',
    invoiceDate: '2026-07-01',
    dueDate: '2026-07-15',
    paymentTermDays: 14,
    reminderPeriodDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: '',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    lines: [],
    totals: {
      netTotalCents: 10_000,
      vatTotalCents: 2_550,
      grossTotalCents: 12_550,
      vatBreakdown: [],
    },
    vatBreakdown: [],
    createdAt: '2026-07-01T10:00:00.000Z',
    approvedAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  };
}
