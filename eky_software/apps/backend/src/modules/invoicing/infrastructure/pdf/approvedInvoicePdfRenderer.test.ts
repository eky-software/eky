import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceViewLine } from '../../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceView } from '../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDate,
  formatPdfPercentBasisPoints,
  formatPdfQuantity,
} from './approvedInvoicePdfFormatting.js';
import { renderApprovedInvoicePdf } from './approvedInvoicePdfRenderer.js';

describe('approved invoice PDF renderer', () => {
  it('renders a non-empty PDF from ApprovedInvoiceView snapshot data', async () => {
    const pdf = await renderApprovedInvoicePdf(createApprovedInvoiceView());

    expect(pdf.length).toBeGreaterThan(1000);
    expect(Buffer.from(pdf.subarray(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('accepts Finnish characters in snapshot data', async () => {
    const invoice = createApprovedInvoiceView();
    const firstLine = invoice.lines[0] as ApprovedInvoiceViewLine;

    await expect(
      renderApprovedInvoicePdf({
        ...invoice,
        companyNameSnapshot: 'Äänekäs Rakennus Oy',
        billingRecipientNameSnapshot: 'Isännöinti Öljymäki Oy',
        lines: [
          {
            ...firstLine,
            description: 'Liesituulettimen poistoilmaventtiilin säätötyö',
          },
        ],
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('formats invoice values for the PDF layout', () => {
    expect(formatPdfCents(45430)).toBe('454,30 EUR');
    expect(formatPdfCents(106675)).toBe('1 066,75 EUR');
    expect(formatPdfDate('2026-07-03')).toBe('03.07.2026');
    expect(formatPdfPercentBasisPoints(2550)).toBe('25,50 %');
    expect(formatPdfQuantity(150)).toBe('1,50');
  });

  it('keeps the renderer independent from database and master-data readers', async () => {
    const pdf = await renderApprovedInvoicePdf(createApprovedInvoiceView());

    expect(pdf.length).toBeGreaterThan(0);
  });
});

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2026',
    sequenceNumber: 1,
    numberingMode: 'calendarYearSequence',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Asunto Oy Sininen Kulma',
    customerBusinessIdSnapshot: '1234567-8',
    customerTypeSnapshot: 'housingCompany',
    customerEmailSnapshot: 'hallitus@example.fi',
    customerPhoneSnapshot: '040 111 2222',
    customerStreetAddressSnapshot: 'Taloyhtiönkatu 4',
    customerPostalCodeSnapshot: '20100',
    customerCitySnapshot: 'Turku',
    companyNameSnapshot: 'EKY-Rakenne Oy',
    companyBusinessIdSnapshot: '0970796-9',
    companyVatNumberSnapshot: 'FI09707969',
    companyStreetAddressSnapshot: 'Isovuorentie 310',
    companyPostalCodeSnapshot: '21290',
    companyCitySnapshot: 'Rusko',
    companyEmailSnapshot: 'eky@example.fi',
    companyPhoneSnapshot: '0400647500',
    companyIbanSnapshot: 'FI8554714001000000',
    companyBicSnapshot: 'POPFFI22',
    companyBankNameSnapshot: 'POP Pankki',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientNameSnapshot: 'Isännöinti Äyräs Oy',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'isannointi@example.fi',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientStreetAddressSnapshot: 'Isännöitsijänkatu 5',
    billingRecipientPostalCodeSnapshot: '20500',
    billingRecipientCitySnapshot: 'Turku',
    invoiceDate: '2026-07-03',
    dueDate: '2026-07-17',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'gross',
    subject: 'Liesituulettimen korjaus',
    orderNumber: '',
    note: 'Kiitos tilauksesta.',
    deliveryAddressText: 'Asunto Oy Sininen Kulma, ovi 12, 26.6.2026',
    lines: [
      {
        id: 'line-1',
        lineOrder: 1,
        code: '',
        description:
          'Liesituulettimen poistoilmaventtiilin tarvikehaku ja muutostyöt',
        quantityHundredths: 700,
        unit: 'h',
        unitPriceCents: 5650,
        vatRateBasisPoints: 2550,
        discount: { type: 'none' },
        baseCents: 39550,
        discountCents: 0,
        netCents: 31514,
        vatCents: 8036,
        grossCents: 39550,
      },
      {
        id: 'line-2',
        lineOrder: 2,
        code: 'AJO',
        description: 'Autokulut',
        quantityHundredths: 100,
        unit: 'kpl',
        unitPriceCents: 1000,
        vatRateBasisPoints: 2550,
        discount: { type: 'percentage', basisPoints: 500 },
        baseCents: 1000,
        discountCents: 50,
        netCents: 757,
        vatCents: 193,
        grossCents: 950,
      },
      {
        id: 'line-3',
        lineOrder: 3,
        code: '',
        description: 'Poistoilmaventtiili',
        quantityHundredths: 100,
        unit: 'kpl',
        unitPriceCents: 1650,
        vatRateBasisPoints: 1000,
        discount: { type: 'fixed', amountCents: 100 },
        baseCents: 1650,
        discountCents: 100,
        netCents: 1409,
        vatCents: 141,
        grossCents: 1550,
      },
    ],
    totals: {
      netTotalCents: 33680,
      vatTotalCents: 8370,
      grossTotalCents: 42050,
      vatBreakdown: [
        {
          vatRateBasisPoints: 1000,
          netCents: 1409,
          vatCents: 141,
          grossCents: 1550,
        },
        {
          vatRateBasisPoints: 2550,
          netCents: 32271,
          vatCents: 8229,
          grossCents: 40500,
        },
      ],
    },
    vatBreakdown: [
      {
        vatRateBasisPoints: 1000,
        netCents: 1409,
        vatCents: 141,
        grossCents: 1550,
      },
      {
        vatRateBasisPoints: 2550,
        netCents: 32271,
        vatCents: 8229,
        grossCents: 40500,
      },
    ],
    createdAt: '2026-07-03T10:00:00.000Z',
    approvedAt: '2026-07-03T10:15:00.000Z',
    updatedAt: '2026-07-03T10:15:00.000Z',
  };
}
