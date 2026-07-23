import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedCreditInvoiceResult,
  type CreditInvoiceDraft,
  type UpdateCreditInvoiceDraftInput,
} from '../../index.js';

describe('invoice credits api client', () => {
  it('approves a credit draft without a renderer-owned request body', async () => {
    const requests: RecordedRequest[] = [];
    const approvedInvoice = createApprovedCreditInvoiceResult();
    const client = createTestClient(requests, { approvedInvoice });

    await expect(
      client.approveCreditInvoiceDraft('draft/1'),
    ).resolves.toEqual(approvedInvoice);
    expect(requests).toEqual([
      {
        input: '/invoice-drafts/draft%2F1/approve-credit',
        init: {
          headers: { Accept: 'application/json' },
          method: 'POST',
        },
      },
    ]);
  });

  it('creates a credit draft without a renderer-owned request body', async () => {
    const requests: RecordedRequest[] = [];
    const creditInvoiceDraft = createCreditInvoiceDraft();
    const client = createTestClient(requests, { creditInvoiceDraft }, 201);

    await expect(
      client.createCreditInvoiceDraft('invoice/1'),
    ).resolves.toEqual(creditInvoiceDraft);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/credit-draft',
        init: {
          headers: { Accept: 'application/json' },
          method: 'POST',
        },
      },
    ]);
  });

  it('gets a credit draft through its dedicated read route', async () => {
    const requests: RecordedRequest[] = [];
    const creditInvoiceDraft = createCreditInvoiceDraft();
    const client = createTestClient(requests, { creditInvoiceDraft });

    await client.getCreditInvoiceDraft('draft/1');

    expect(requests[0]?.input).toBe('/invoice-drafts/draft%2F1/credit');
    expect(requests[0]?.init?.method).toBeUndefined();
  });

  it('updates only editable credit draft fields', async () => {
    const requests: RecordedRequest[] = [];
    const creditInvoiceDraft = createCreditInvoiceDraft();
    const client = createTestClient(requests, { creditInvoiceDraft });
    const unsafeInput = {
      subject: 'Osahyvitys',
      note: 'Hyvityksen lisätieto',
      refundIban: 'FI2112345600000785',
      companyId: 'other-company',
      totals: { grossTotalCents: 1 },
      lines: [
        {
          lineType: 'source',
          sourceInvoiceLineId: 'source-line-1',
          description: 'Korjattu kuvaus',
          quantityHundredths: 50,
          unitPriceCents: 1,
          vatRateBasisPoints: 0,
        },
        {
          lineType: 'manual',
          description: 'Asiakaspalautus',
          quantityHundredths: 100,
          unit: 'kpl',
          unitPriceCents: 2_500,
          vatRateBasisPoints: 2_550,
          sourceInvoiceLineId: 'server-owned',
          grossCents: 1,
        },
      ],
    } as unknown as UpdateCreditInvoiceDraftInput;

    await client.updateCreditInvoiceDraft('draft/1', unsafeInput);

    expect(requests[0]?.input).toBe('/invoice-drafts/draft%2F1/credit');
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(readRequestBody(requests[0])).toEqual({
      subject: 'Osahyvitys',
      note: 'Hyvityksen lisätieto',
      refundIban: 'FI2112345600000785',
      lines: [
        {
          lineType: 'source',
          sourceInvoiceLineId: 'source-line-1',
          description: 'Korjattu kuvaus',
          quantityHundredths: 50,
        },
        {
          lineType: 'manual',
          description: 'Asiakaspalautus',
          quantityHundredths: 100,
          unit: 'kpl',
          unitPriceCents: 2_500,
          vatRateBasisPoints: 2_550,
        },
      ],
    });
  });

  it('reads a manual credit line without a source allocation', async () => {
    const requests: RecordedRequest[] = [];
    const creditInvoiceDraft = createCreditInvoiceDraft();
    creditInvoiceDraft.lines = [createManualCreditLine()];
    const client = createTestClient(requests, { creditInvoiceDraft });

    await expect(
      client.getCreditInvoiceDraft('draft-1'),
    ).resolves.toMatchObject({
      lines: [
        {
          lineType: 'manual',
          sourceInvoiceLineId: null,
          maximumQuantityHundredths: null,
        },
      ],
    });
  });

  it('rejects a response with contradictory credit line ownership', async () => {
    const requests: RecordedRequest[] = [];
    const creditInvoiceDraft = createCreditInvoiceDraft();
    const client = createTestClient(requests, {
      creditInvoiceDraft: {
        ...creditInvoiceDraft,
        lines: [
          {
            ...createManualCreditLine(),
            sourceInvoiceLineId: 'source-line-1',
          },
        ],
      },
    });

    await expect(
      client.getCreditInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects an invalid credit draft response shape', async () => {
    const requests: RecordedRequest[] = [];
    const client = createTestClient(requests, {
      creditInvoiceDraft: {
        ...createCreditInvoiceDraft(),
        paymentTermDays: 14,
      },
    });

    await expect(
      client.getCreditInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects an invalid credit approval response shape', async () => {
    const requests: RecordedRequest[] = [];
    const client = createTestClient(requests, {
      approvedInvoice: {
        ...createApprovedCreditInvoiceResult(),
        status: 'sent',
      },
    });

    await expect(
      client.approveCreditInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });
});

interface RecordedRequest {
  input: string;
  init: RequestInit | undefined;
}

function createTestClient(
  requests: RecordedRequest[],
  responseBody: unknown,
  status = 200,
) {
  return createEkyApiClient({
    baseUrl: '',
    fetch: async (input, init) => {
      requests.push({ input: input.toString(), init });
      return new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
        status,
      });
    },
  });
}

function readRequestBody(
  request: RecordedRequest | undefined,
): Record<string, unknown> {
  if (typeof request?.init?.body !== 'string') {
    throw new Error('Expected a JSON request body.');
  }

  return JSON.parse(request.init.body) as Record<string, unknown>;
}

function createCreditInvoiceDraft(): CreditInvoiceDraft {
  return {
    id: 'draft-1',
    invoiceKind: 'credit',
    creditedInvoiceId: 'invoice-1',
    creditedInvoiceNumber: '20260001',
    creditedInvoiceDate: '2026-07-01',
    customer: createParty('customer-1'),
    billingRecipient: createParty('billing-customer-1'),
    invoiceDate: '2026-07-23',
    dueDate: '2026-07-23',
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: 'net',
    subject: 'Hyvitys laskulle 20260001',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    refundIban: '',
    lines: [
      {
        id: 'draft-line-1',
        lineType: 'source',
        sourceInvoiceLineId: 'source-line-1',
        isIncluded: true,
        position: 1,
        code: '',
        description: 'Työ',
        quantityHundredths: 100,
        maximumQuantityHundredths: 100,
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

function createApprovedCreditInvoiceResult(): ApprovedCreditInvoiceResult {
  return {
    invoiceId: 'credit-invoice-1',
    draftId: 'draft-1',
    invoiceNumber: '20260002',
    sequenceNumber: 2,
    sequenceScope: 'calendar-year:2026',
    numberingMode: 'calendarYearSequence',
    status: 'approved',
  };
}

function createManualCreditLine(): CreditInvoiceDraft['lines'][number] {
  return {
    id: 'manual-line-1',
    lineType: 'manual',
    sourceInvoiceLineId: null,
    isIncluded: true,
    position: 1,
    code: '',
    description: 'Asiakaspalautus',
    quantityHundredths: 100,
    maximumQuantityHundredths: null,
    unit: 'kpl',
    unitPriceCents: 2_500,
    vatRateBasisPoints: 2_550,
    discount: { type: 'none' },
    baseCents: 2_500,
    discountCents: 0,
    netCents: 2_500,
    vatCents: 638,
    grossCents: 3_138,
  };
}

function createParty(customerId: string) {
  return {
    customerId,
    customerNumber: '1001',
    name: 'Asiakas Oy',
    businessId: '1234567-8',
    email: 'asiakas@example.test',
    phone: '040 123 4567',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
  };
}
