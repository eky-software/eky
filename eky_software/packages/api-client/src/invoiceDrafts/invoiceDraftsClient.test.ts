import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceResult,
  type InvoiceDraft,
  type InvoiceDraftInput,
  type InvoiceDraftSummary,
} from '../index.js';

describe('invoice drafts api client', () => {
  it('approves a draft through POST /invoice-drafts/:id/approve', async () => {
    const requests = createRequestLog();
    const approvedInvoice = createTestApprovedInvoiceResult();
    const client = createTestClient(requests, { approvedInvoice });

    const result = await client.approveInvoiceDraft('draft/1');

    expect(result).toEqual(approvedInvoice);
    expect(requests).toEqual([
      {
        input: '/invoice-drafts/draft%2F1/approve',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('creates a draft through POST /invoice-drafts', async () => {
    const requests = createRequestLog();
    const invoiceDraft = createTestInvoiceDraft();
    const client = createTestClient(requests, { invoiceDraft }, 201);

    const result = await client.createInvoiceDraft(createTestInput());

    expect(result).toEqual(invoiceDraft);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/invoice-drafts');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(readRequestBody(requests[0])).toEqual(createTestInput());
  });

  it('gets a draft through GET /invoice-drafts/:id', async () => {
    const requests = createRequestLog();
    const invoiceDraft = createTestInvoiceDraft();
    const client = createTestClient(requests, { invoiceDraft });

    const result = await client.getInvoiceDraft('draft/1');

    expect(result).toEqual(invoiceDraft);
    expect(requests).toEqual([
      {
        input: '/invoice-drafts/draft%2F1',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('deletes a draft through DELETE /invoice-drafts/:id', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, { deleted: true });

    await expect(
      client.deleteInvoiceDraft('draft/1'),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        input: '/invoice-drafts/draft%2F1',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'DELETE',
        },
      },
    ]);
  });

  it('rejects an invalid delete response shape', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, { deleted: false });

    await expect(
      client.deleteInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('lists summaries through GET /invoice-drafts', async () => {
    const requests = createRequestLog();
    const invoiceDrafts = [createTestInvoiceDraftSummary()];
    const client = createTestClient(requests, { invoiceDrafts });

    const result = await client.listInvoiceDrafts();

    expect(result).toEqual(invoiceDrafts);
    expect(requests[0]?.input).toBe('/invoice-drafts');
  });

  it('encodes the optional customerId list query', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, { invoiceDrafts: [] });

    await client.listInvoiceDrafts({ customerId: 'customer/1' });

    expect(requests[0]?.input).toBe(
      '/invoice-drafts?customerId=customer%2F1',
    );
  });

  it('updates a draft through PUT /invoice-drafts/:id', async () => {
    const requests = createRequestLog();
    const invoiceDraft = createTestInvoiceDraft();
    const client = createTestClient(requests, { invoiceDraft });

    const result = await client.updateInvoiceDraft(
      'draft/1',
      createTestInput(),
    );

    expect(result).toEqual(invoiceDraft);
    expect(requests[0]?.input).toBe('/invoice-drafts/draft%2F1');
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(readRequestBody(requests[0])).toEqual(createTestInput());
  });

  it('strips server-owned fields from create and update bodies', async () => {
    const requests = createRequestLog();
    const invoiceDraft = createTestInvoiceDraft();
    const client = createTestClient(requests, { invoiceDraft });
    const unsafeInput = {
      ...createTestInput(),
      id: 'attacker-draft',
      companyId: 'other-company',
      status: 'approved',
      netTotalCents: 1,
      vatTotalCents: 2,
      grossTotalCents: 3,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      lines: [
        {
          ...createTestInput().lines[0],
          id: 'attacker-line',
          position: 99,
          netCents: 1,
          vatCents: 2,
          grossCents: 3,
        },
      ],
    } as unknown as InvoiceDraftInput;

    await client.createInvoiceDraft(unsafeInput);
    await client.updateInvoiceDraft('draft-1', unsafeInput);

    for (const request of requests) {
      const body = readRequestBody(request);
      const lines = body.lines;

      expect(body).toEqual(createTestInput());
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('companyId');
      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('netTotalCents');
      expect(body).not.toHaveProperty('vatTotalCents');
      expect(body).not.toHaveProperty('grossTotalCents');
      expect(body).not.toHaveProperty('createdAt');
      expect(body).not.toHaveProperty('updatedAt');
      expect(Array.isArray(lines)).toBe(true);
      expect(Array.isArray(lines) ? lines[0] : undefined).not.toHaveProperty('id');
      expect(Array.isArray(lines) ? lines[0] : undefined).not.toHaveProperty(
        'position',
      );
      expect(Array.isArray(lines) ? lines[0] : undefined).not.toHaveProperty(
        'netCents',
      );
    }
  });

  it('rejects invalid invoice draft response shapes', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      invoiceDraft: {
        ...createTestInvoiceDraft(),
        totals: {
          ...createTestInvoiceDraft().totals,
          grossTotalCents: 'invalid',
        },
      },
    });

    await expect(
      client.getInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects invalid approve response shapes', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      approvedInvoice: {
        ...createTestApprovedInvoiceResult(),
        invoiceNumber: 20260001,
      },
    });

    await expect(
      client.approveInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects invalid approve reference number response shapes', async () => {
    const requests = createRequestLog();
    const invalidReferenceNumberClient = createTestClient(requests, {
      approvedInvoice: {
        ...createTestApprovedInvoiceResult(),
        referenceNumber: 202600017,
      },
    });

    await expect(
      invalidReferenceNumberClient.approveInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);

    const invalidReferenceTypeClient = createTestClient(requests, {
      approvedInvoice: {
        ...createTestApprovedInvoiceResult(),
        referenceNumberType: 'international',
      },
    });

    await expect(
      invalidReferenceTypeClient.approveInvoiceDraft('draft-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('preserves a controlled API error from the backend', async () => {
    const requests = createRequestLog();
    const responseBody = { error: 'Invoice draft was not found.' };
    const client = createTestClient(requests, responseBody, 404);

    await expect(client.getInvoiceDraft('missing-draft')).rejects.toMatchObject({
      message: 'Invoice draft was not found.',
      name: 'EkyApiError',
      responseBody,
      status: 404,
    });
  });
});

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
    baseUrl: '',
    fetch: async (input, init) => {
      requests.push({ input: input.toString(), init });
      return jsonResponse(responseBody, { status });
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function createTestInput(): InvoiceDraftInput {
  return {
    customerId: 'customer-1',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Test note',
    lines: [
      {
        code: 'WORK',
        description: 'Work',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2550,
        discount: {
          type: 'percentage',
          basisPoints: 500,
        },
      },
    ],
  };
}

function createTestApprovedInvoiceResult(): ApprovedInvoiceResult {
  return {
    draftId: 'draft-1',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    numberingMode: 'calendarYearSequence',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    status: 'approved',
  };
}

function createTestInvoiceDraft(): InvoiceDraft {
  return {
    id: 'draft-1',
    companyId: 'dev-company',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Test note',
    lines: [
      {
        id: 'line-1',
        position: 1,
        code: 'WORK',
        description: 'Work',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2550,
        priceInputMode: 'net',
        discount: {
          type: 'percentage',
          basisPoints: 500,
        },
        baseCents: 15_000,
        discountCents: 750,
        netCents: 14_250,
        vatCents: 3634,
        grossCents: 17_884,
      },
    ],
    totals: {
      netTotalCents: 14_250,
      vatTotalCents: 3634,
      grossTotalCents: 17_884,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 14_250,
          vatCents: 3634,
          grossCents: 17_884,
        },
      ],
    },
    createdAt: '2026-06-13T18:00:00.000Z',
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
}

function createTestInvoiceDraftSummary(): InvoiceDraftSummary {
  return {
    id: 'draft-1',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Test invoice',
    netTotalCents: 14_250,
    vatTotalCents: 3634,
    grossTotalCents: 17_884,
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
}
