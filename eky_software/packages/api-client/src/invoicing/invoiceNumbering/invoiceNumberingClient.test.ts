import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type ActivateInvoiceNumberingSeriesRequest,
  type InvoiceNumberingSettingsView,
  type InvoiceNumberingSeriesOverviewView,
  type UpdateInvoiceNumberingSettingsRequest,
} from '../../index.js';

describe('invoice numbering settings api client', () => {
  it('gets invoice numbering settings through GET /invoice-numbering-settings', async () => {
    const requests = createRequestLog();
    const invoiceNumberingSettings = createTestSettings();
    const client = createTestClient(requests, { invoiceNumberingSettings });

    const result = await client.getInvoiceNumberingSettings();

    expect(result).toEqual(invoiceNumberingSettings);
    expect(requests).toEqual([
      {
        input: '/invoice-numbering-settings',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('updates invoice numbering settings through PUT /invoice-numbering-settings', async () => {
    const requests = createRequestLog();
    const invoiceNumberingSettings = createTestSettings({
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
      sequencePadding: 5,
      firstSequenceNumber: 1000,
      isPersisted: true,
    });
    const input: UpdateInvoiceNumberingSettingsRequest = {
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
      sequencePadding: 5,
      firstSequenceNumber: 1000,
    };
    const client = createTestClient(requests, { invoiceNumberingSettings });

    const result = await client.updateInvoiceNumberingSettings(input);

    expect(result).toEqual(invoiceNumberingSettings);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/invoice-numbering-settings');
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(readRequestBody(requests[0])).toEqual(input);
  });

  it('strips server-owned fields from update bodies', async () => {
    const requests = createRequestLog();
    const invoiceNumberingSettings = createTestSettings();
    const unsafeInput = {
      mode: 'plainSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 0,
      firstSequenceNumber: 1000,
      companyId: 'other-company',
      seriesKey: 'secondary',
      hasUsedNumbering: true,
      isPersisted: true,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as unknown as UpdateInvoiceNumberingSettingsRequest;
    const client = createTestClient(requests, { invoiceNumberingSettings });

    await client.updateInvoiceNumberingSettings(unsafeInput);

    const body = readRequestBody(requests[0]);

    expect(body).toEqual({
      mode: 'plainSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 0,
      firstSequenceNumber: 1000,
    });
    expect(body).not.toHaveProperty('companyId');
    expect(body).not.toHaveProperty('seriesKey');
    expect(body).not.toHaveProperty('hasUsedNumbering');
    expect(body).not.toHaveProperty('isPersisted');
    expect(body).not.toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('updatedAt');
  });

  it('rejects invalid response shapes', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      invoiceNumberingSettings: {
        ...createTestSettings(),
        hasUsedNumbering: 'no',
      },
    });

    await expect(
      client.getInvoiceNumberingSettings(),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('preserves a controlled API error from the backend', async () => {
    const requests = createRequestLog();
    const responseBody = {
      error: 'Invoice numbering settings cannot be changed after numbering has been used.',
    };
    const client = createTestClient(requests, responseBody, 400);

    await expect(
      client.updateInvoiceNumberingSettings({
        mode: 'plainSequence',
        fiscalYearStartMonth: 1,
        sequencePadding: 0,
        firstSequenceNumber: 1000,
      }),
    ).rejects.toMatchObject({
      message: 'Invoice numbering settings cannot be changed after numbering has been used.',
      name: 'EkyApiError',
      responseBody,
      status: 400,
    });
  });

  it('gets the public numbering series overview without internal keys', async () => {
    const requests = createRequestLog();
    const invoiceNumberingSeriesOverview = createTestSeriesOverview();
    const client = createTestClient(requests, {
      invoiceNumberingSeriesOverview,
    });

    await expect(client.getInvoiceNumberingSeriesOverview()).resolves.toEqual(
      invoiceNumberingSeriesOverview,
    );
    expect(requests[0]?.input).toBe('/invoice-numbering-series');
    expect(
      JSON.stringify(invoiceNumberingSeriesOverview),
    ).not.toContain('seriesKey');
  });

  it('gets a date-bound safe start preview using only supported query values', async () => {
    const requests = createRequestLog();
    const invoiceNumberingSeriesActivationPreview = {
      capacity: 'available',
      maximumSequenceNumber: 9999,
      minimumFirstSequenceNumber: 100,
      previewDate: '2026-08-02',
      previewInvoiceNumber: '20260100',
    };
    const client = createTestClient(requests, {
      invoiceNumberingSeriesActivationPreview,
    });

    await expect(
      client.previewInvoiceNumberingSeriesActivation({
        mode: 'calendarYearSequence',
        fiscalYearStartMonth: 1,
        sequencePadding: 4,
        previewDate: '2026-08-02',
      }),
    ).resolves.toEqual(invoiceNumberingSeriesActivationPreview);
    expect(requests[0]?.input).toBe(
      '/invoice-numbering-series/activation-preview?mode=calendarYearSequence&fiscalYearStartMonth=1&sequencePadding=4&previewDate=2026-08-02',
    );
  });

  it('activates a series through a whitelisted POST body', async () => {
    const requests = createRequestLog();
    const invoiceNumberingSeriesOverview = createTestSeriesOverview({
      revision: 2,
    });
    const input: ActivateInvoiceNumberingSeriesRequest = {
      confirmation: 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN',
      currentRevision: 1,
      firstSequenceNumber: 100,
      fiscalYearStartMonth: 1,
      mode: 'calendarYearSequence',
      reasonCode: 'accountingRequirement',
      reasonNote: 'Kirjanpidon vaatima muutos',
      sequencePadding: 4,
    };
    const unsafeInput = {
      ...input,
      companyId: 'other-company',
      actorUserId: 'other-user',
      seriesKey: 'chosen-by-browser',
      now: '2020-01-01T00:00:00.000Z',
    } as unknown as ActivateInvoiceNumberingSeriesRequest;
    const client = createTestClient(requests, {
      invoiceNumberingSeriesOverview,
    }, 201);

    await expect(
      client.activateInvoiceNumberingSeries(unsafeInput),
    ).resolves.toEqual(invoiceNumberingSeriesOverview);
    expect(requests[0]?.input).toBe('/invoice-numbering-series/activate');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(readRequestBody(requests[0])).toEqual(input);
  });

  it('rejects extra technical fields in numbering series responses', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      invoiceNumberingSeriesOverview: {
        ...createTestSeriesOverview(),
        seriesKey: 'internal',
      },
    });

    await expect(
      client.getInvoiceNumberingSeriesOverview(),
    ).rejects.toBeInstanceOf(EkyApiError);
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

function createTestSettings(
  overrides: Partial<InvoiceNumberingSettingsView> = {},
): InvoiceNumberingSettingsView {
  return {
    seriesKey: 'default',
    mode: 'calendarYearSequence',
    fiscalYearStartMonth: 1,
    sequencePadding: 4,
    firstSequenceNumber: 1,
    hasUsedNumbering: false,
    isPersisted: false,
    ...overrides,
  };
}

function createTestSeriesOverview(
  overrides: Partial<InvoiceNumberingSeriesOverviewView> = {},
): InvoiceNumberingSeriesOverviewView {
  return {
    activeSeries: {
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      activatedAt: '2026-01-01T00:00:00.000Z',
    },
    activationConfirmationText: 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN',
    history: [
      {
        previousSeries: {
          mode: 'plainSequence',
          fiscalYearStartMonth: 1,
          sequencePadding: 3,
          firstSequenceNumber: 1,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        replacedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    revision: 1,
    ...overrides,
  };
}
