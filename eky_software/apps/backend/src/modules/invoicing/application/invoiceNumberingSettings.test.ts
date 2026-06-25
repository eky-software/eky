import { describe, expect, it } from 'vitest';

import {
  defaultInvoiceNumberSeriesKey,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import { getInvoiceNumberingSettings } from './getInvoiceNumberingSettings.js';
import { InvoiceNumberingSettingsError } from './invoiceNumberingSettingsError.js';
import {
  updateInvoiceNumberingSettings,
  type UpdateInvoiceNumberingSettingsInput,
} from './updateInvoiceNumberingSettings.js';

class FakeInvoiceNumberingSettingsRepository
  implements InvoiceNumberingSettingsRepository
{
  savedSettings: StoredInvoiceNumberingSettings[] = [];
  private readonly settingsByKey = new Map<string, StoredInvoiceNumberingSettings>();

  constructor(
    settings: StoredInvoiceNumberingSettings[] = [],
    private usedNumbering = false,
  ) {
    for (const item of settings) {
      this.settingsByKey.set(createKey(item.companyId, item.seriesKey), item);
    }
  }

  async getSettings(
    companyId: string,
    seriesKey: string,
  ): Promise<StoredInvoiceNumberingSettings | undefined> {
    return this.settingsByKey.get(createKey(companyId, seriesKey));
  }

  async saveSettings(
    settings: StoredInvoiceNumberingSettings,
  ): Promise<StoredInvoiceNumberingSettings> {
    const currentSettings = await this.getSettings(
      settings.companyId,
      settings.seriesKey,
    );
    const savedSettings = {
      ...settings,
      createdAt: currentSettings?.createdAt ?? settings.createdAt,
    };

    this.savedSettings.push(savedSettings);
    this.settingsByKey.set(
      createKey(savedSettings.companyId, savedSettings.seriesKey),
      savedSettings,
    );

    return savedSettings;
  }

  async hasUsedNumbering(): Promise<boolean> {
    return this.usedNumbering;
  }
}

function createKey(companyId: string, seriesKey: string): string {
  return `${companyId}:${seriesKey}`;
}

function createSettings(
  overrides: Partial<StoredInvoiceNumberingSettings> = {},
): StoredInvoiceNumberingSettings {
  return {
    companyId: 'dev-company',
    seriesKey: defaultInvoiceNumberSeriesKey,
    mode: 'calendarYearSequence',
    fiscalYearStartMonth: 1,
    sequencePadding: 4,
    firstSequenceNumber: 1,
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

function createUpdateInput(
  overrides: Partial<UpdateInvoiceNumberingSettingsInput> = {},
): UpdateInvoiceNumberingSettingsInput {
  return {
    companyId: 'dev-company',
    mode: 'calendarYearSequence',
    fiscalYearStartMonth: 1,
    sequencePadding: 4,
    firstSequenceNumber: 1,
    now: '2026-06-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('invoice numbering settings application services', () => {
  it('returns saved numbering settings with usage state', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository(
      [createSettings({ sequencePadding: 6 })],
      true,
    );

    await expect(
      getInvoiceNumberingSettings(
        { companyId: 'dev-company' },
        repository,
      ),
    ).resolves.toEqual({
      seriesKey: defaultInvoiceNumberSeriesKey,
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 6,
      firstSequenceNumber: 1,
      hasUsedNumbering: true,
      isPersisted: true,
    });
  });

  it('returns default settings without writing when settings are missing', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository();

    await expect(
      getInvoiceNumberingSettings(
        { companyId: 'dev-company' },
        repository,
      ),
    ).resolves.toEqual({
      seriesKey: defaultInvoiceNumberSeriesKey,
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      hasUsedNumbering: false,
      isPersisted: false,
    });
    expect(repository.savedSettings).toEqual([]);
  });

  it('creates numbering settings when none exist', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository();

    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({
          mode: 'fiscalYearSequence',
          fiscalYearStartMonth: 2,
          sequencePadding: 5,
          firstSequenceNumber: 1000,
        }),
        repository,
      ),
    ).resolves.toEqual({
      seriesKey: defaultInvoiceNumberSeriesKey,
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
      sequencePadding: 5,
      firstSequenceNumber: 1000,
      hasUsedNumbering: false,
      isPersisted: true,
    });
    expect(repository.savedSettings).toEqual([
      {
        companyId: 'dev-company',
        seriesKey: defaultInvoiceNumberSeriesKey,
        mode: 'fiscalYearSequence',
        fiscalYearStartMonth: 2,
        sequencePadding: 5,
        firstSequenceNumber: 1000,
        createdAt: '2026-06-26T10:00:00.000Z',
        updatedAt: '2026-06-26T10:00:00.000Z',
      },
    ]);
  });

  it('updates settings before numbering has been used', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository([
      createSettings(),
    ]);

    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({ sequencePadding: 6 }),
        repository,
      ),
    ).resolves.toMatchObject({
      sequencePadding: 6,
      hasUsedNumbering: false,
      isPersisted: true,
    });
    expect(repository.savedSettings[0]).toMatchObject({
      createdAt: '2026-06-25T10:00:00.000Z',
      updatedAt: '2026-06-26T10:00:00.000Z',
    });
  });

  it('rejects changed settings after numbering has been used', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository(
      [createSettings()],
      true,
    );

    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({ firstSequenceNumber: 1000 }),
        repository,
      ),
    ).rejects.toThrow(InvoiceNumberingSettingsError);
    expect(repository.savedSettings).toEqual([]);
  });

  it('allows an idempotent update after numbering has been used', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository(
      [createSettings()],
      true,
    );

    await expect(
      updateInvoiceNumberingSettings(createUpdateInput(), repository),
    ).resolves.toEqual({
      seriesKey: defaultInvoiceNumberSeriesKey,
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      hasUsedNumbering: true,
      isPersisted: true,
    });
    expect(repository.savedSettings[0]).toMatchObject({
      createdAt: '2026-06-25T10:00:00.000Z',
      updatedAt: '2026-06-26T10:00:00.000Z',
    });
  });

  it('rejects invalid numbering settings', async () => {
    const repository = new FakeInvoiceNumberingSettingsRepository();

    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({ mode: 'invalid' as never }),
        repository,
      ),
    ).rejects.toThrow();
    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({ fiscalYearStartMonth: 13 }),
        repository,
      ),
    ).rejects.toThrow();
    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({ sequencePadding: 13 }),
        repository,
      ),
    ).rejects.toThrow();
    await expect(
      updateInvoiceNumberingSettings(
        createUpdateInput({ firstSequenceNumber: 0 }),
        repository,
      ),
    ).rejects.toThrow();
    expect(repository.savedSettings).toEqual([]);
  });
});
