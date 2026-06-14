import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type CompanySettings,
} from '../index.js';

describe('company settings api client', () => {
  it('gets company settings through GET /company-settings', async () => {
    const companySettings = createTestCompanySettings();
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input, init) => {
        requests.push({ input: input.toString(), init });

        return jsonResponse({ companySettings });
      },
    });

    const result = await client.getCompanySettings();

    expect(result).toEqual(companySettings);
    expect(requests).toEqual([
      {
        input: '/company-settings',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('updates company settings through PUT /company-settings', async () => {
    const companySettings = createTestCompanySettings();
    const input = {
      businessId: '1234567-8',
      city: 'Helsinki',
      companyName: 'Example Builder Oy',
      defaultHourlyRateCents: 6500,
      email: 'info@example.fi',
      phone: '040 123 4567',
      postalCode: '00100',
      streetAddress: 'Testikatu 1',
    } as const;
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (requestInput, init) => {
        requests.push({ input: requestInput.toString(), init });

        return jsonResponse({ companySettings });
      },
    });

    const result = await client.updateCompanySettings(input);

    expect(result).toEqual(companySettings);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/company-settings');
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(requests[0]?.init?.body).toBe(JSON.stringify(input));
  });

  it('preserves a controlled API error from the backend', async () => {
    const responseBody = {
      error: 'Company settings could not be saved.',
    };
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse(responseBody, { status: 409 }),
    });

    await expect(
      client.updateCompanySettings({
        businessId: '',
        city: '',
        companyName: 'Example Builder Oy',
        defaultHourlyRateCents: null,
        email: '',
        phone: '',
        postalCode: '',
        streetAddress: '',
      }),
    ).rejects.toMatchObject({
      message: 'Company settings could not be saved.',
      name: 'EkyApiError',
      responseBody,
      status: 409,
    });
  });

  it('throws a controlled API error for an invalid response shape', async () => {
    const invalidSettings = {};
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse({ companySettings: invalidSettings }),
    });

    await expect(client.getCompanySettings()).rejects.toMatchObject({
      message: 'Invalid company settings response.',
      name: 'EkyApiError',
      responseBody: invalidSettings,
      status: undefined,
    } satisfies Partial<EkyApiError>);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function createTestCompanySettings(): CompanySettings {
  return {
    id: 'company-settings-1',
    companyId: 'dev-company',
    companyName: 'Example Builder Oy',
    businessId: '1234567-8',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
    email: 'info@example.fi',
    phone: '040 123 4567',
    defaultHourlyRateCents: 6500,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}
