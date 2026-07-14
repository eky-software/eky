import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetCompanySettingsInput } from '../application/getCompanySettings.js';
import type { UpdateCompanySettingsInput } from '../application/updateCompanySettings.js';
import type { CompanySettings } from '../domain/companySettings.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';
import { createCompanySettingsRoutes } from './companySettingsRoutes.js';

describe('companySettingsRoutes', () => {
  it('gets company settings through the route dependencies', async () => {
    const companySettings = createTestCompanySettings();
    let getInput: GetCompanySettingsInput | undefined;
    const app = createAuthenticatedTestApp(createCompanySettingsRoutes({
      async getCompanySettings(input): Promise<CompanySettings> {
        getInput = input;

        return companySettings;
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new Error('updateCompanySettings should not be called');
      },
    }));

    const response = await app.request('/company-settings');
    const body = (await response.json()) as { companySettings: CompanySettings };

    expect(response.status).toBe(200);
    expect(getInput).toEqual({ companyId: 'dev-company' });
    expect(body).toEqual({ companySettings });
  });

  it('updates company settings through the route dependencies', async () => {
    const companySettings = createTestCompanySettings();
    let updateInput: UpdateCompanySettingsInput | undefined;
    const app = createAuthenticatedTestApp(createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        throw new Error('getCompanySettings should not be called');
      },
      async updateCompanySettings(input): Promise<CompanySettings> {
        updateInput = input;

        return companySettings;
      },
    }));

    const response = await app.request('/company-settings', {
      body: JSON.stringify({
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        companyName: '  Example Builder Oy  ',
        vatNumber: '  fi12345678  ',
        defaultHourlyRateCents: 6500,
        hourlyRateShortcut: '  työ  ',
        iban: ' fi21 1234 5600 0007 85 ',
        bic: ' ndeafihh ',
        bankName: '  Test Bank  ',
        email: '  info@example.fi  ',
        emailDeliveryProvider: 'smtp',
        emailSenderName: '  Example Builder Oy  ',
        emailSenderAddress: '  laskutus@example.fi  ',
        emailSmtpHost: '  smtp.dnamail.fi  ',
        emailSmtpPort: 587,
        emailSmtpSecurity: 'starttls',
        emailUsername: '  laskutus@example.fi  ',
        emailTestRecipientOverride: '  test@example.fi  ',
        phone: '  040 123 4567  ',
        website: '  www.example.fi  ',
        postalCode: '  00100  ',
        streetAddress: '  Testikatu 1  ',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const body = (await response.json()) as { companySettings: CompanySettings };

    expect(response.status).toBe(200);
    expect(updateInput).toEqual({
      actorContext: expect.objectContaining({
        actorId: 'dev-user',
        companyId: 'dev-company',
        permissions: expect.arrayContaining(['manageCompanySettings']),
      }),
      businessId: '  1234567-8  ',
      city: '  Helsinki  ',
      companyName: '  Example Builder Oy  ',
      vatNumber: '  fi12345678  ',
      defaultHourlyRateCents: 6500,
      hourlyRateShortcut: '  työ  ',
      iban: ' fi21 1234 5600 0007 85 ',
      bic: ' ndeafihh ',
      bankName: '  Test Bank  ',
      email: '  info@example.fi  ',
      emailDeliveryProvider: 'smtp',
      emailSenderName: '  Example Builder Oy  ',
      emailSenderAddress: '  laskutus@example.fi  ',
      emailSmtpHost: '  smtp.dnamail.fi  ',
      emailSmtpPort: 587,
      emailSmtpSecurity: 'starttls',
      emailUsername: '  laskutus@example.fi  ',
      emailTestRecipientOverride: '  test@example.fi  ',
      phone: '  040 123 4567  ',
      website: '  www.example.fi  ',
      postalCode: '  00100  ',
      streetAddress: '  Testikatu 1  ',
    });
    expect(body).toEqual({ companySettings });
  });

  it('rejects invalid JSON bodies', async () => {
    const app = createAuthenticatedTestApp(createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        return createTestCompanySettings();
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new Error('updateCompanySettings should not be called');
      },
    }));

    const response = await app.request('/company-settings', {
      body: '{',
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body.' });
  });

  it('maps validation errors to bad request responses', async () => {
    const app = createAuthenticatedTestApp(createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        return createTestCompanySettings();
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new CompanySettingsValidationError('Default hourly rate cannot be negative.');
      },
    }));

    const response = await app.request('/company-settings', {
      body: JSON.stringify({ defaultHourlyRateCents: -1 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Default hourly rate cannot be negative.' });
  });

  it('maps denied company settings updates to a safe forbidden response', async () => {
    const app = createAuthenticatedTestApp(createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        return createTestCompanySettings();
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new AuthorizationError();
      },
    }));

    const response = await app.request('/company-settings', {
      body: JSON.stringify({ companyName: 'Synthetic company' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Permission denied.',
    });
  });
});

function createAuthenticatedTestApp(
  routes: Hono<BackendEnvironment>,
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'dev-user',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions: [
          'manageCompanySettings',
          'manageCompanyEmailSettings',
          'manageCompanyEmailSecret',
          'sendInvoices',
        ],
      }),
    );
    await next();
  });
  app.route('/', routes);

  return app;
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
    emailDeliveryProvider: 'smtp',
    emailSenderName: 'Example Builder Oy',
    emailSenderAddress: 'laskutus@example.fi',
    emailSmtpHost: 'smtp.dnamail.fi',
    emailSmtpPort: 587,
    emailSmtpSecurity: 'starttls',
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
