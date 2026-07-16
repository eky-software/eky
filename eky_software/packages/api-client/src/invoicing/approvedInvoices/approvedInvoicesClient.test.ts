import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceEmailDryRunSendInput,
  type ApprovedInvoiceEmailDryRunSendResult,
  type ApprovedInvoiceEmailSmtpTestSendResult,
  type ApprovedInvoiceEmailPreview,
  type ApprovedInvoiceSummary,
  type ApprovedInvoiceView,
  type InvoiceDraft,
} from '../../index.js';

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

  it('accepts package and short custom units in approved invoice responses', async () => {
    const requests = createRequestLog();
    const invoice = {
      ...createTestApprovedInvoiceView(),
      lines: [
        { ...createTestApprovedInvoiceView().lines[0], unit: 'pak' },
        {
          ...createTestApprovedInvoiceView().lines[0],
          id: 'line-2',
          unit: 'ltk',
        },
      ],
    };
    const client = createTestClient(requests, { invoice });

    const result = await client.getApprovedInvoice('invoice-1');

    expect(result.lines.map((line) => line.unit)).toEqual(['pak', 'ltk']);
  });

  it('creates approved invoice PDF metadata through POST /invoices/:id/pdf', async () => {
    const requests = createRequestLog();
    const document = createTestApprovedInvoiceDocumentMetadata();
    const client = createTestClient(requests, { document });

    const result = await client.createApprovedInvoicePdf('invoice/1');

    expect(result).toEqual(document);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/pdf',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('gets approved invoice PDF metadata through GET /invoices/:id/pdf/metadata', async () => {
    const requests = createRequestLog();
    const document = createTestApprovedInvoiceDocumentMetadata();
    const client = createTestClient(requests, { document });

    const result = await client.getApprovedInvoicePdfMetadata('invoice/1');

    expect(result).toEqual(document);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/pdf/metadata',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });


  it('builds the approved invoice PDF URL without fetching the binary document', () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {});

    expect(client.getApprovedInvoicePdfUrl('invoice/1')).toBe(
      'http://api.test/invoices/invoice%2F1/pdf',
    );
    expect(requests).toEqual([]);
  });

  it('reopens an approved invoice for editing through POST /invoices/:id/reopen-for-edit', async () => {
    const requests = createRequestLog();
    const reopenedInvoice = {
      invoiceDraftId: 'draft-1',
      invoiceId: 'invoice-1',
    };
    const client = createTestClient(requests, reopenedInvoice);

    const result = await client.reopenApprovedInvoiceForEditing('invoice/1');

    expect(result).toEqual(reopenedInvoice);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/reopen-for-edit',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('marks an approved invoice sent through POST /invoices/:id/mark-sent', async () => {
    const requests = createRequestLog();
    const invoice = createTestApprovedInvoiceView({ status: 'sent' });
    const client = createTestClient(requests, { invoice });

    const result = await client.markApprovedInvoiceSent('invoice/1');

    expect(result).toEqual(invoice);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/mark-sent',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('prepares a dry-run invoice email through POST /invoices/:id/email/dry-run', async () => {
    const requests = createRequestLog();
    const email = createTestApprovedInvoiceEmailPreview();
    const client = createTestClient(requests, { email });

    const result = await client.prepareApprovedInvoiceEmailDryRun('invoice/1');

    expect(result).toEqual(email);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/email/dry-run',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('sends a dry-run invoice email through POST /invoices/:id/email/dry-run/send', async () => {
    const requests = createRequestLog();
    const delivery = createTestApprovedInvoiceEmailDryRunSendResult();
    const input: ApprovedInvoiceEmailDryRunSendInput = {
      body: 'Hei,\n\nMuokattu viesti.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001 - muokattu',
      to: 'recipient@example.fi',
    };
    const client = createTestClient(requests, { delivery });

    const result = await client.sendApprovedInvoiceEmailDryRun(
      'invoice/1',
      input,
    );

    expect(result).toEqual(delivery);
    expect(requests[0]).toEqual(
      {
        input: '/invoices/invoice%2F1/email/dry-run/send',
        init: {
          body: expect.any(String) as string,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      },
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);
  });

  it('does not send server-owned fields in dry-run invoice email requests', async () => {
    const requests = createRequestLog();
    const delivery = createTestApprovedInvoiceEmailDryRunSendResult();
    const client = createTestClient(requests, { delivery });
    const unsafeInput = {
      body: 'Hei',
      companyId: 'other-company',
      deliveryEventId: 'event-from-client',
      providerResult: { provider: 'smtp' },
      status: 'succeeded',
      subject: 'Lasku',
      to: 'recipient@example.fi',
    } as unknown as ApprovedInvoiceEmailDryRunSendInput;

    await client.sendApprovedInvoiceEmailDryRun('invoice-1', unsafeInput);

    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      body: 'Hei',
      subject: 'Lasku',
      to: 'recipient@example.fi',
    });
  });

  it('sends a controlled SMTP test request without server-owned fields', async () => {
    const requests = createRequestLog();
    const delivery = createTestApprovedInvoiceEmailSmtpTestSendResult();
    const client = createTestClient(requests, { delivery });

    const result = await client.sendApprovedInvoiceEmailSmtpTest(
      'invoice/1',
      {
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        body: 'Hei, liitteenä lasku.',
        cc: 'copy@example.fi',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
      },
    );

    expect(result).toEqual(delivery);
    expect(requests[0]).toEqual({
      input: '/invoices/invoice%2F1/email/smtp-test/send',
      init: {
        body: expect.any(String) as string,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    });
  });

  it('prepares a controlled SMTP test without sending server-owned fields', async () => {
    const requests = createRequestLog();
    const preparation = {
      attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
      expiresAt: '2026-07-16T10:01:00.000Z',
      invoiceId: 'invoice-1',
      subject: 'Lasku 20260001',
      testRecipient: 'safe-test@example.fi',
    };
    const client = createTestClient(requests, { preparation });

    const result = await client.prepareApprovedInvoiceEmailSmtpTest(
      'invoice/1',
      {
        body: 'Hei, liitteenä lasku.',
        cc: 'copy@example.fi',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
      },
    );

    expect(result).toEqual(preparation);
    expect(requests[0]).toEqual({
      input: '/invoices/invoice%2F1/email/smtp-test/prepare',
      init: {
        body: expect.any(String) as string,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    });
  });

  it('copies an approved invoice to a draft through POST /invoices/:id/copy-to-draft', async () => {
    const requests = createRequestLog();
    const invoiceDraft = createTestInvoiceDraft();
    const client = createTestClient(requests, { invoiceDraft });

    const result = await client.copyApprovedInvoiceToDraft('invoice/1');

    expect(result).toEqual(invoiceDraft);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/copy-to-draft',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
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

  it('rejects a malformed reopen response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, { invoiceId: 'invoice-1' });

    await expect(
      client.reopenApprovedInvoiceForEditing('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed approved invoice PDF metadata response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      document: {
        ...createTestApprovedInvoiceDocumentMetadata(),
        mimeType: 'application/json',
      },
    });

    await expect(
      client.createApprovedInvoicePdf('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed dry-run email response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      email: {
        ...createTestApprovedInvoiceEmailPreview(),
        provider: 'smtp',
      },
    });

    await expect(
      client.prepareApprovedInvoiceEmailDryRun('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed dry-run email send response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      delivery: {
        ...createTestApprovedInvoiceEmailDryRunSendResult(),
        providerResult: { provider: 'smtp', providerMessageId: null },
      },
    });

    await expect(
      client.sendApprovedInvoiceEmailDryRun('invoice-1', {
        body: 'Hei',
        subject: 'Lasku',
        to: 'recipient@example.fi',
      }),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects invalid enum values in the response', async () => {
    await expectInvalidInvoiceResponse({ status: 'draft' });
    await expectInvalidInvoiceResponse({ priceInputMode: 'withVatMaybe' });
    await expectInvalidInvoiceResponse({ referenceNumberType: 'international' });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          unit: 'bad unit',
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

function createTestApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
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
    companyWebsiteSnapshot: 'www.example.fi',
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
    ...overrides,
  };
}

function createTestApprovedInvoiceDocumentMetadata() {
  return {
    id: 'document-1',
    companyId: 'dev-company',
    invoiceId: 'invoice-1',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 1234,
    createdAt: '2026-07-05T10:00:00.000Z',
  };
}

function createTestApprovedInvoiceEmailPreview(): ApprovedInvoiceEmailPreview {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'lasku-20260001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
    },
    body: 'Hei,\n\nLiitteenä lasku 20260001.',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
  };
}

function createTestApprovedInvoiceEmailDryRunSendResult(): ApprovedInvoiceEmailDryRunSendResult {
  return {
    deliveryEventId: 'delivery-event-1',
    email: {
      ...createTestApprovedInvoiceEmailPreview(),
      body: 'Hei,\n\nMuokattu viesti.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001 - muokattu',
    },
    providerResult: {
      provider: 'dryRun',
      providerMessageId: null,
    },
  };
}

function createTestApprovedInvoiceEmailSmtpTestSendResult(): ApprovedInvoiceEmailSmtpTestSendResult {
  return {
    deliveredTo: 'owner-test@example.fi',
    deliveryEventId: 'delivery-event-2',
    provider: 'smtp',
    providerMessageId: '<synthetic@example.test>',
    testMode: true,
  };
}

function createTestInvoiceDraft(): InvoiceDraft {
  return {
    billingRecipientCustomerId: 'billing-1',
    companyId: 'dev-company',
    createdAt: '2026-07-08T10:00:00.000Z',
    customerId: 'customer-1',
    deliveryAddressText: 'Worksite Street 4',
    dueDate: '2026-07-22',
    id: 'draft-copy-1',
    invoiceDate: '2026-07-08',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        netCents: 10000,
        position: 1,
        priceInputMode: 'net',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Invoice note',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net',
    reminderPeriodDays: 8,
    status: 'draft',
    subject: 'Copied invoice',
    totals: {
      grossTotalCents: 12550,
      netTotalCents: 10000,
      vatBreakdown: [
        {
          grossCents: 12550,
          netCents: 10000,
          vatCents: 2550,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2550,
    },
    updatedAt: '2026-07-08T10:00:00.000Z',
  };
}

function createTestApprovedInvoiceSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
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
    ...overrides,
  };
}
