import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceSummary,
  type ApprovedInvoiceView,
} from '../index.js';

describe('approved invoices api client', () => {
  it('lists approved invoices through GET /invoices', async () => {
    const requests = createRequestLog();
    const invoiceSummary = createTestApprovedInvoiceSummary();
    const client = createTestClient(requests, { invoices: [invoiceSummary] });

    const result = await client.listApprovedInvoices();

    expect(result).toEqual([invoiceSummary]);
    expect(requests).toEqual([
      {
        input: '/invoices',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('gets an approved invoice through GET /invoices/:id', async () => {
    const requests = createRequestLog();
    const invoice = createTestApprovedInvoiceView();
    const client = createTestClient(requests, { invoice });

    const result = await client.getApprovedInvoice('invoice/1');

    expect(result).toEqual(invoice);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('rejects a missing invoice response object', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {});

    await expect(
      client.getApprovedInvoice('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a missing approved invoice list response array', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {});

    await expect(client.listApprovedInvoices()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });

  it('rejects invalid enum values in the response', async () => {
    await expectInvalidInvoiceResponse({ status: 'draft' });
    await expectInvalidInvoiceResponse({ priceInputMode: 'withVatMaybe' });
    await expectInvalidInvoiceResponse({ referenceNumberType: 'international' });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          unit: 'hour',
        },
      ],
    });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          discount: { type: 'mystery' },
        },
      ],
    });
  });

  it('rejects non-integer money and total values', async () => {
    await expectInvalidInvoiceResponse({
      totals: {
        ...createTestApprovedInvoiceView().totals,
        grossTotalCents: 12550.5,
      },
    });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          netCents: '10000',
        },
      ],
    });
  });

  it('allows a nullable billing recipient customer id', async () => {
    const requests = createRequestLog();
    const invoice = {
      ...createTestApprovedInvoiceView(),
      billingRecipientCustomerId: null,
    };
    const client = createTestClient(requests, { invoice });

    await expect(
      client.getApprovedInvoice('invoice-1'),
    ).resolves.toMatchObject({
      billingRecipientCustomerId: null,
    });
  });

  it('preserves a controlled API error from the backend', async () => {
    const requests = createRequestLog();
    const responseBody = { error: 'Approved invoice was not found.' };
    const client = createTestClient(requests, responseBody, 404);

    await expect(client.getApprovedInvoice('missing')).rejects.toMatchObject({
      message: 'Approved invoice was not found.',
      name: 'EkyApiError',
      responseBody,
      status: 404,
    });
  });
});

async function expectInvalidInvoiceResponse(
  invoiceOverrides: Record<string, unknown>,
): Promise<void> {
  const requests = createRequestLog();
  const invoice = {
    ...createTestApprovedInvoiceView(),
    ...invoiceOverrides,
  } as Record<string, unknown>;
  const client = createTestClient(requests, { invoice });

  await expect(
    client.getApprovedInvoice('invoice-1'),
  ).rejects.toBeInstanceOf(EkyApiError);
}

interface RecordedRequest {
  input: string;
  init: RequestInit | undefined;
}

function createRequestLog(): RecordedRequest[] {
  return [];
}

function createTestClient(
  requests: RecordedRequest[],
  responseBody: unknown,
  status = 200,
) {
  return createEkyApiClient({
    baseUrl: 'http://api.test',
    fetch: async (input, init) => {
      const path =
        typeof input === 'string'
          ? input.replace('http://api.test', '')
          : input instanceof URL
            ? input.href.replace('http://api.test', '')
            : input.url.replace('http://api.test', '');

      requests.push({ input: path, init });

      return new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
        status,
      });
    },
  });
}

function createTestApprovedInvoiceView(): ApprovedInvoiceView {
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
    customerNameSnapshot: 'Example Customer Oy',
    customerBusinessIdSnapshot: '1234567-8',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: 'customer@example.fi',
    customerPhoneSnapshot: '040 111 2222',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerPostalCodeSnapshot: '00100',
    customerCitySnapshot: 'Helsinki',
    companyNameSnapshot: 'Example Builder Oy',
    companyBusinessIdSnapshot: '7654321-0',
    companyVatNumberSnapshot: 'FI76543210',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyPostalCodeSnapshot: '33100',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyPhoneSnapshot: '03 123 4567',
    companyIbanSnapshot: 'FI2112345600000785',
    companyBicSnapshot: 'NDEAFIHH',
    companyBankNameSnapshot: 'Example Bank',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientCitySnapshot: 'Espoo',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    deliveryAddressText: 'Worksite Street 4',
    lines: [
      {
        id: 'line-1',
        lineOrder: 1,
        code: 'WORK',
        description: 'Work',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatRateBasisPoints: 2550,
        discount: { type: 'none' },
        baseCents: 10000,
        discountCents: 0,
        netCents: 10000,
        vatCents: 2550,
        grossCents: 12550,
      },
    ],
    totals: {
      netTotalCents: 10000,
      vatTotalCents: 2550,
      grossTotalCents: 12550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 10000,
          vatCents: 2550,
          grossCents: 12550,
        },
      ],
    },
    vatBreakdown: [
      {
        vatRateBasisPoints: 2550,
        netCents: 10000,
        vatCents: 2550,
        grossCents: 12550,
      },
    ],
    createdAt: '2026-06-13T10:00:00.000Z',
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}

function createTestApprovedInvoiceSummary(): ApprovedInvoiceSummary {
  return {
    id: 'invoice-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}
