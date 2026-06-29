import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type InvoicePaymentSettingsView,
  type UpdateInvoicePaymentSettingsRequest,
} from '../index.js';

describe('invoice payment settings api client', () => {
  it('gets invoice payment settings through GET /invoice-payment-settings', async () => {
    const requests = createRequestLog();
    const invoicePaymentSettings = createTestSettings();
    const client = createTestClient(requests, { invoicePaymentSettings });

    const result = await client.getInvoicePaymentSettings();

    expect(result).toEqual(invoicePaymentSettings);
    expect(requests).toEqual([
      {
        input: '/invoice-payment-settings',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('updates invoice payment settings through PUT /invoice-payment-settings', async () => {
    const requests = createRequestLog();
    const invoicePaymentSettings = createTestSettings({
      defaultLatePaymentInterestBasisPoints: 1050,
      defaultReminderPeriodDays: 14,
      isPersisted: true,
    });
    const input: UpdateInvoicePaymentSettingsRequest = {
      defaultLatePaymentInterestBasisPoints: 1050,
      defaultReminderPeriodDays: 14,
    };
    const client = createTestClient(requests, { invoicePaymentSettings });

    const result = await client.updateInvoicePaymentSettings(input);

    expect(result).toEqual(invoicePaymentSettings);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/invoice-payment-settings');
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(readRequestBody(requests[0])).toEqual(input);
  });

  it('strips server-owned fields from update bodies', async () => {
    const requests = createRequestLog();
    const invoicePaymentSettings = createTestSettings();
    const unsafeInput = {
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
      companyId: 'other-company',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      isPersisted: true,
    } as unknown as UpdateInvoicePaymentSettingsRequest;
    const client = createTestClient(requests, { invoicePaymentSettings });

    await client.updateInvoicePaymentSettings(unsafeInput);

    const body = readRequestBody(requests[0]);

    expect(body).toEqual({
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
    });
    expect(body).not.toHaveProperty('companyId');
    expect(body).not.toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('updatedAt');
    expect(body).not.toHaveProperty('isPersisted');
  });

  it('rejects invalid response shapes', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      invoicePaymentSettings: {
        ...createTestSettings(),
        defaultReminderPeriodDays: '8',
      },
    });

    await expect(
      client.getInvoicePaymentSettings(),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('preserves a controlled API error from the backend', async () => {
    const requests = createRequestLog();
    const responseBody = {
      error: 'Invalid invoice payment settings body.',
    };
    const client = createTestClient(requests, responseBody, 400);

    await expect(
      client.updateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 8,
      }),
    ).rejects.toMatchObject({
      message: 'Invalid invoice payment settings body.',
      name: 'EkyApiError',
      responseBody,
      status: 400,
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

function createTestSettings(
  overrides: Partial<InvoicePaymentSettingsView> = {},
): InvoicePaymentSettingsView {
  return {
    defaultLatePaymentInterestBasisPoints: 0,
    defaultReminderPeriodDays: 8,
    isPersisted: false,
    ...overrides,
  };
}
