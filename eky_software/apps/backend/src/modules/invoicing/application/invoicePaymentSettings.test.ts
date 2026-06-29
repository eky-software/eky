import { describe, expect, it } from 'vitest';

import type {
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import type {
  InvoicePaymentSettingsRepository,
} from '../ports/invoicePaymentSettingsRepository.js';
import { getInvoicePaymentSettings } from './getInvoicePaymentSettings.js';
import {
  updateInvoicePaymentSettings,
  type UpdateInvoicePaymentSettingsInput,
} from './updateInvoicePaymentSettings.js';
import { InvoicePaymentSettingsApplicationError } from './invoicePaymentSettingsError.js';

class FakeInvoicePaymentSettingsRepository
  implements InvoicePaymentSettingsRepository
{
  savedSettings: StoredInvoicePaymentSettings[] = [];
  private readonly settingsByCompanyId = new Map<string, StoredInvoicePaymentSettings>();

  constructor(settings: StoredInvoicePaymentSettings[] = []) {
    for (const item of settings) {
      this.settingsByCompanyId.set(item.companyId, item);
    }
  }

  async getSettings(
    companyId: string,
  ): Promise<StoredInvoicePaymentSettings | undefined> {
    return this.settingsByCompanyId.get(companyId);
  }

  async saveSettings(
    settings: StoredInvoicePaymentSettings,
  ): Promise<StoredInvoicePaymentSettings> {
    const currentSettings = await this.getSettings(settings.companyId);
    const savedSettings = {
      ...settings,
      createdAt: currentSettings?.createdAt ?? settings.createdAt,
    };

    this.savedSettings.push(savedSettings);
    this.settingsByCompanyId.set(savedSettings.companyId, savedSettings);

    return savedSettings;
  }
}

function createSettings(
  overrides: Partial<StoredInvoicePaymentSettings> = {},
): StoredInvoicePaymentSettings {
  return {
    companyId: 'dev-company',
    defaultLatePaymentInterestBasisPoints: 950,
    defaultReminderPeriodDays: 8,
    createdAt: '2026-06-30T10:00:00.000Z',
    updatedAt: '2026-06-30T10:00:00.000Z',
    ...overrides,
  };
}

function createUpdateInput(
  overrides: Partial<UpdateInvoicePaymentSettingsInput> = {},
): UpdateInvoicePaymentSettingsInput {
  return {
    companyId: 'dev-company',
    defaultLatePaymentInterestBasisPoints: 950,
    defaultReminderPeriodDays: 8,
    now: '2026-06-30T11:00:00.000Z',
    ...overrides,
  };
}

describe('invoice payment settings application services', () => {
  it('returns saved payment settings', async () => {
    const repository = new FakeInvoicePaymentSettingsRepository([
      createSettings({ defaultLatePaymentInterestBasisPoints: 1050 }),
    ]);

    await expect(
      getInvoicePaymentSettings({ companyId: 'dev-company' }, repository),
    ).resolves.toEqual({
      defaultLatePaymentInterestBasisPoints: 1050,
      defaultReminderPeriodDays: 8,
      isPersisted: true,
    });
  });

  it('returns default payment settings without writing when settings are missing', async () => {
    const repository = new FakeInvoicePaymentSettingsRepository();

    await expect(
      getInvoicePaymentSettings({ companyId: 'dev-company' }, repository),
    ).resolves.toEqual({
      defaultLatePaymentInterestBasisPoints: 0,
      defaultReminderPeriodDays: 8,
      isPersisted: false,
    });
    expect(repository.savedSettings).toEqual([]);
  });

  it('creates payment settings when none exist', async () => {
    const repository = new FakeInvoicePaymentSettingsRepository();

    await expect(
      updateInvoicePaymentSettings(createUpdateInput(), repository),
    ).resolves.toEqual({
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
      isPersisted: true,
    });
    expect(repository.savedSettings).toEqual([
      {
        companyId: 'dev-company',
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 8,
        createdAt: '2026-06-30T11:00:00.000Z',
        updatedAt: '2026-06-30T11:00:00.000Z',
      },
    ]);
  });

  it('updates payment settings while preserving their createdAt timestamp', async () => {
    const repository = new FakeInvoicePaymentSettingsRepository([
      createSettings(),
    ]);

    await expect(
      updateInvoicePaymentSettings(
        createUpdateInput({ defaultLatePaymentInterestBasisPoints: 1050 }),
        repository,
      ),
    ).resolves.toEqual({
      defaultLatePaymentInterestBasisPoints: 1050,
      defaultReminderPeriodDays: 8,
      isPersisted: true,
    });
    expect(repository.savedSettings[0]).toEqual({
      companyId: 'dev-company',
      defaultLatePaymentInterestBasisPoints: 1050,
      defaultReminderPeriodDays: 8,
      createdAt: '2026-06-30T10:00:00.000Z',
      updatedAt: '2026-06-30T11:00:00.000Z',
    });
  });

  it('rejects an empty company id', async () => {
    const repository = new FakeInvoicePaymentSettingsRepository();

    await expect(
      updateInvoicePaymentSettings(
        createUpdateInput({ companyId: '   ' }),
        repository,
      ),
    ).rejects.toThrow(InvoicePaymentSettingsApplicationError);
    expect(repository.savedSettings).toEqual([]);
  });

  it('rejects invalid payment settings', async () => {
    const repository = new FakeInvoicePaymentSettingsRepository();

    await expect(
      updateInvoicePaymentSettings(
        createUpdateInput({ defaultLatePaymentInterestBasisPoints: -1 }),
        repository,
      ),
    ).rejects.toThrow();
    expect(repository.savedSettings).toEqual([]);
  });
});
