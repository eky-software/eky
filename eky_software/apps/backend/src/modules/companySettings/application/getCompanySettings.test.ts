import { describe, expect, it } from 'vitest';

import type { CompanySettings } from '../domain/companySettings.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';
import { getCompanySettings } from './getCompanySettings.js';

class FakeCompanySettingsRepository implements CompanySettingsRepository {
  constructor(private readonly settings: CompanySettings | null) {}

  async findByCompanyId(): Promise<CompanySettings | null> {
    return this.settings;
  }

  async upsertCompanySettings(settings: CompanySettings): Promise<CompanySettings> {
    return settings;
  }
}

describe('getCompanySettings', () => {
  it('returns existing settings through the repository port', async () => {
    const settings = createTestCompanySettings();
    const result = await getCompanySettings(
      { companyId: 'dev-company' },
      new FakeCompanySettingsRepository(settings),
    );

    expect(result).toEqual(settings);
  });

  it('returns an empty settings shape without creating a database row', async () => {
    const result = await getCompanySettings(
      { companyId: 'dev-company' },
      new FakeCompanySettingsRepository(null),
    );

    expect(result).toEqual({
      id: '',
      companyId: 'dev-company',
      companyName: '',
      businessId: '',
      streetAddress: '',
      postalCode: '',
      city: '',
      email: '',
      phone: '',
      iban: '',
      bic: '',
      bankName: '',
      defaultHourlyRateCents: null,
      hourlyRateShortcut: '',
      createdAt: '',
      updatedAt: '',
    });
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
    iban: 'FI2112345600000785',
    bic: 'NDEAFIHH',
    bankName: 'Test Bank',
    defaultHourlyRateCents: 6500,
    hourlyRateShortcut: 'työ',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}
