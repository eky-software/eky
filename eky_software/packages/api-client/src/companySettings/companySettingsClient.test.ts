import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type CompanySettings,
} from '../index.js';

describe('company settings api client', () => {
  it('gets the email secret status without receiving a secret value', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input, init) => {
        expect(input.toString()).toBe('/company-settings/email-secret');
        expect(init).toEqual({ headers: { Accept: 'application/json' } });

        return jsonResponse({ emailSecretStatus: { configured: true } });
      },
    });

    const status = await client.getCompanyEmailSecretStatus();

    expect(status).toEqual({ configured: true });
    expect(status).not.toHaveProperty('secret');
  });

  it('sets only the email secret through the lifecycle endpoint', async () => {
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input, init) => {
        requests.push({ input: input.toString(), init });

        return jsonResponse({ emailSecretStatus: { configured: true } });
      },
    });

    const status = await client.setCompanyEmailSecret({
      secret: 'synthetic-password',
      companyId: 'untrusted-company',
    } as { secret: string });

    expect(status).toEqual({ configured: true });
    expect(requests[0]?.input).toBe('/company-settings/email-secret');
    expect(requests[0]?.init).toEqual({
      body: JSON.stringify({ secret: 'synthetic-password' }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    });
  });

  it('removes the email secret without a request body', async () => {
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input, init) => {
        requests.push({ input: input.toString(), init });

        return jsonResponse({ emailSecretStatus: { configured: false } });
      },
    });

    await expect(client.removeCompanyEmailSecret()).resolves.toEqual({
      configured: false,
    });
    expect(requests).toEqual([
      {
        input: '/company-settings/email-secret',
        init: {
          headers: { Accept: 'application/json' },
          method: 'DELETE',
        },
      },
    ]);
  });

  it('rejects invalid email secret status responses safely', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          emailSecretStatus: {
            configured: 'yes',
            secret: 'must-not-be-returned',
          },
        }),
    });

    await expect(client.getCompanyEmailSecretStatus()).rejects.toMatchObject({
      message: 'Invalid company email secret response.',
      name: 'EkyApiError',
    });
  });

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
      vatNumber: 'FI12345678',
      hourlyRateShortcut: 'työ',
      iban: 'FI2112345600000785',
      bic: 'NDEAFIHH',
      bankName: 'Test Bank',
      email: 'info@example.fi',
      emailDeliveryProvider: 'dnaSmtp',
      emailSenderName: 'Example Builder Oy',
      emailSenderAddress: 'laskutus@example.fi',
      emailUsername: 'laskutus@example.fi',
      emailTestRecipientOverride: 'test@example.fi',
      phone: '040 123 4567',
      website: 'www.example.fi',
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
        vatNumber: '',
        defaultHourlyRateCents: null,
        hourlyRateShortcut: '',
        iban: '',
        bic: '',
        bankName: '',
        email: '',
        emailDeliveryProvider: 'dryRun',
        emailSenderName: '',
        emailSenderAddress: '',
        emailUsername: '',
        emailTestRecipientOverride: '',
        phone: '',
        website: '',
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

  it('throws a controlled API error when bank detail fields are invalid', async () => {
    const invalidSettings = {
      ...createTestCompanySettings(),
      iban: 123,
    };
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
    vatNumber: 'FI12345678',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
    email: 'info@example.fi',
    emailDeliveryProvider: 'dnaSmtp',
    emailSenderName: 'Example Builder Oy',
    emailSenderAddress: 'laskutus@example.fi',
    emailSmtpHost: 'smtp.dnamail.fi',
    emailSmtpPort: 465,
    emailSmtpSecurity: 'tls',
    emailUsername: 'laskutus@example.fi',
    emailTestRecipientOverride: 'test@example.fi',
    emailSecretConfigured: false,
    phone: '040 123 4567',
    website: 'www.example.fi',
    iban: 'FI2112345600000785',
    bic: 'NDEAFIHH',
    bankName: 'Test Bank',
    defaultHourlyRateCents: 6500,
    hourlyRateShortcut: 'työ',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}
