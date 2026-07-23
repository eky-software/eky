import { EkyApiError, type ApprovedInvoiceView } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getApprovedInvoiceErrorMessage,
  getApprovedInvoiceWithClient,
} from './useApprovedInvoice.js';
import { uiText } from '../../../i18n/fi.js';

describe('getApprovedInvoiceWithClient', () => {
  it('loads an approved invoice with api-client', async () => {
    const invoice = createApprovedInvoiceView();
    const apiClient = {
      getApprovedInvoice: vi.fn(async () => invoice),
    };

    await expect(
      getApprovedInvoiceWithClient(apiClient, 'invoice-1'),
    ).resolves.toBe(invoice);
    expect(apiClient.getApprovedInvoice).toHaveBeenCalledWith('invoice-1');
  });
});

describe('getApprovedInvoiceErrorMessage', () => {
  it('maps not found to a safe Finnish message', () => {
    const error = new EkyApiError('Approved invoice was not found.', {
      status: 404,
    });

    expect(getApprovedInvoiceErrorMessage(error)).toBe(
      uiText.invoicing.approvedInvoiceNotFound,
    );
  });

  it('does not expose technical response body or stack text', () => {
    const error = new EkyApiError('Unexpected backend stack trace', {
      responseBody: { stack: 'secret stack' },
      status: 500,
    });

    const message = getApprovedInvoiceErrorMessage(error);

    expect(message).toBe(uiText.invoicing.approvedInvoiceLoadError);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: null,
    billingRecipientCustomerNumberSnapshot: '1001',
    billingRecipientCustomerTypeSnapshot: 'company',
    billingRecipientEmailSnapshot: 'billing@example.fi',
    billingRecipientNameSnapshot: 'Example Customer Oy',
    billingRecipientPhoneSnapshot: '',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 1',
    companyBankNameSnapshot: 'Example Bank',
    companyBicSnapshot: 'NDEAFIHH',
    companyBusinessIdSnapshot: '7654321-0',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyId: 'dev-company',
    companyNameSnapshot: 'Example Builder Oy',
    companyPhoneSnapshot: '03 123 4567',
    companyPostalCodeSnapshot: '33100',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyVatNumberSnapshot: 'FI76543210',
    companyWebsiteSnapshot: '',
    createdAt: '2026-06-13T10:00:00.000Z',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    customerBusinessIdSnapshot: '',
    customerCitySnapshot: 'Espoo',
    customerEmailSnapshot: '',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '',
    customerPostalCodeSnapshot: '02100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: '',
    refundIbanSnapshot: '',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceKind: 'standard',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
    lines: [],
    note: '',
    numberingMode: 'calendarYearSequence',
    orderNumber: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 8,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'approved',
    subject: 'Test invoice',
    totals: {
      grossTotalCents: 0,
      netTotalCents: 0,
      vatBreakdown: [],
      vatTotalCents: 0,
    },
    updatedAt: '2026-06-13T10:00:00.000Z',
    vatBreakdown: [],
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
  };
}
