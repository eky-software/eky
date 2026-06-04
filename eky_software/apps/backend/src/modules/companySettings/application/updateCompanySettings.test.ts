import { describe, expect, it } from 'vitest';

import type { CompanySettings } from '../domain/companySettings.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';
import { updateCompanySettings } from './updateCompanySettings.js';

class FakeCompanySettingsRepository implements CompanySettingsRepository {
  savedSettings: CompanySettings | undefined;

  async findByCompanyId(): Promise<CompanySettings | null> {
    return null;
  }

  async upsertCompanySettings(settings: CompanySettings): Promise<CompanySettings> {
    this.savedSettings = settings;

    return settings;
  }
}

describe('updateCompanySettings', () => {
  it('normalizes and saves settings through the repository port', async () => {
    const repository = new FakeCompanySettingsRepository();

    const settings = await updateCompanySettings(
      {
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        companyId: 'dev-company',
        companyName: '  Example Builder Oy  ',
        defaultHourlyRateCents: 6500,
        email: '  info@example.fi  ',
        phone: '  040 123 4567  ',
        postalCode: '  00100  ',
        streetAddress: '  Testikatu 1  ',
      },
      repository,
    );

    expect(repository.savedSettings).toBe(settings);
    expect(settings.id).toEqual(expect.any(String));
    expect(settings.companyId).toBe('dev-company');
    expect(settings.companyName).toBe('Example Builder Oy');
    expect(settings.businessId).toBe('1234567-8');
    expect(settings.streetAddress).toBe('Testikatu 1');
    expect(settings.postalCode).toBe('00100');
    expect(settings.city).toBe('Helsinki');
    expect(settings.email).toBe('info@example.fi');
    expect(settings.phone).toBe('040 123 4567');
    expect(settings.defaultHourlyRateCents).toBe(6500);
    expect(settings.createdAt).toEqual(expect.any(String));
    expect(settings.updatedAt).toEqual(expect.any(String));
    expect(settings.createdAt).toBe(settings.updatedAt);
  });

  it('keeps null as an unset default hourly rate', async () => {
    const settings = await updateCompanySettings(
      {
        businessId: '',
        city: '',
        companyId: 'dev-company',
        companyName: '',
        defaultHourlyRateCents: null,
        email: '',
        phone: '',
        postalCode: '',
        streetAddress: '',
      },
      new FakeCompanySettingsRepository(),
    );

    expect(settings.defaultHourlyRateCents).toBeNull();
  });
});
