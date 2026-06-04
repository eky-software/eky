import { describe, expect, it } from 'vitest';

import type { GetCompanySettingsInput } from '../application/getCompanySettings.js';
import type { UpdateCompanySettingsInput } from '../application/updateCompanySettings.js';
import type { CompanySettings } from '../domain/companySettings.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';
import { createCompanySettingsRoutes } from './companySettingsRoutes.js';

describe('companySettingsRoutes', () => {
  it('gets company settings through the route dependencies', async () => {
    const companySettings = createTestCompanySettings();
    let getInput: GetCompanySettingsInput | undefined;
    const app = createCompanySettingsRoutes({
      async getCompanySettings(input): Promise<CompanySettings> {
        getInput = input;

        return companySettings;
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new Error('updateCompanySettings should not be called');
      },
    });

    const response = await app.request('/company-settings');
    const body = (await response.json()) as { companySettings: CompanySettings };

    expect(response.status).toBe(200);
    expect(getInput).toEqual({ companyId: 'dev-company' });
    expect(body).toEqual({ companySettings });
  });

  it('updates company settings through the route dependencies', async () => {
    const companySettings = createTestCompanySettings();
    let updateInput: UpdateCompanySettingsInput | undefined;
    const app = createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        throw new Error('getCompanySettings should not be called');
      },
      async updateCompanySettings(input): Promise<CompanySettings> {
        updateInput = input;

        return companySettings;
      },
    });

    const response = await app.request('/company-settings', {
      body: JSON.stringify({
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        companyName: '  Example Builder Oy  ',
        defaultHourlyRateCents: 6500,
        email: '  info@example.fi  ',
        phone: '  040 123 4567  ',
        postalCode: '  00100  ',
        streetAddress: '  Testikatu 1  ',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const body = (await response.json()) as { companySettings: CompanySettings };

    expect(response.status).toBe(200);
    expect(updateInput).toEqual({
      businessId: '  1234567-8  ',
      city: '  Helsinki  ',
      companyId: 'dev-company',
      companyName: '  Example Builder Oy  ',
      defaultHourlyRateCents: 6500,
      email: '  info@example.fi  ',
      phone: '  040 123 4567  ',
      postalCode: '  00100  ',
      streetAddress: '  Testikatu 1  ',
    });
    expect(body).toEqual({ companySettings });
  });

  it('rejects invalid JSON bodies', async () => {
    const app = createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        return createTestCompanySettings();
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new Error('updateCompanySettings should not be called');
      },
    });

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
    const app = createCompanySettingsRoutes({
      async getCompanySettings(): Promise<CompanySettings> {
        return createTestCompanySettings();
      },
      async updateCompanySettings(): Promise<CompanySettings> {
        throw new CompanySettingsValidationError('Default hourly rate cannot be negative.');
      },
    });

    const response = await app.request('/company-settings', {
      body: JSON.stringify({ defaultHourlyRateCents: -1 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Default hourly rate cannot be negative.' });
  });
});

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
