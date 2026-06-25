import { describe, expect, it } from 'vitest';

import {
  getInvoiceNumberingSettings,
  type GetInvoiceNumberingSettingsInput,
} from '../application/getInvoiceNumberingSettings.js';
import type { InvoiceNumberingSettingsView } from '../application/invoiceNumberingSettingsView.js';
import {
  updateInvoiceNumberingSettings,
  type UpdateInvoiceNumberingSettingsInput,
} from '../application/updateInvoiceNumberingSettings.js';
import {
  defaultInvoiceNumberSeriesKey,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import { createInvoiceNumberingSettingsRoutes } from './invoiceNumberingSettingsRoutes.js';

class FakeInvoiceNumberingSettingsRepository
  implements InvoiceNumberingSettingsRepository
{
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

    this.settingsByKey.set(
      createKey(settings.companyId, settings.seriesKey),
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

function createValidBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mode: 'calendarYearSequence',
    fiscalYearStartMonth: 1,
    sequencePadding: 4,
    firstSequenceNumber: 1,
    ...overrides,
  };
}

function createTestApp(
  repository: InvoiceNumberingSettingsRepository,
) {
  let getInput: GetInvoiceNumberingSettingsInput | undefined;
  let updateInput: UpdateInvoiceNumberingSettingsInput | undefined;
  const app = createInvoiceNumberingSettingsRoutes({
    async getInvoiceNumberingSettings(input) {
      getInput = input;

      return getInvoiceNumberingSettings(input, repository);
    },
    async updateInvoiceNumberingSettings(input) {
      updateInput = input;

      return updateInvoiceNumberingSettings(input, repository);
    },
  });

  return {
    app,
    getGetInput: () => getInput,
    getUpdateInput: () => updateInput,
  };
}

async function putJson(
  app: ReturnType<typeof createInvoiceNumberingSettingsRoutes>,
  body: unknown,
): Promise<Response> {
  return app.request('/invoice-numbering-settings', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  });
}

describe('invoiceNumberingSettingsRoutes', () => {
  it('gets settings with the backend company context', async () => {
    const testContext = createTestApp(
      new FakeInvoiceNumberingSettingsRepository([
        createSettings({ sequencePadding: 6 }),
      ]),
    );

    const response = await testContext.app.request(
      '/invoice-numbering-settings?companyId=other-company',
    );
    const body = (await response.json()) as {
      invoiceNumberingSettings: InvoiceNumberingSettingsView;
    };

    expect(response.status).toBe(200);
    expect(testContext.getGetInput()).toEqual({ companyId: 'dev-company' });
    expect(body.invoiceNumberingSettings).toMatchObject({
      seriesKey: defaultInvoiceNumberSeriesKey,
      sequencePadding: 6,
      isPersisted: true,
    });
  });

  it('returns default settings when no persisted settings exist', async () => {
    const testContext = createTestApp(
      new FakeInvoiceNumberingSettingsRepository(),
    );

    const response = await testContext.app.request('/invoice-numbering-settings');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invoiceNumberingSettings: {
        seriesKey: defaultInvoiceNumberSeriesKey,
        mode: 'calendarYearSequence',
        fiscalYearStartMonth: 1,
        sequencePadding: 4,
        firstSequenceNumber: 1,
        hasUsedNumbering: false,
        isPersisted: false,
      },
    });
  });

  it('saves valid settings without trusting request companyId or seriesKey', async () => {
    const testContext = createTestApp(
      new FakeInvoiceNumberingSettingsRepository(),
    );

    const response = await putJson(
      testContext.app,
      createValidBody({
        mode: 'fiscalYearSequence',
        fiscalYearStartMonth: 2,
        sequencePadding: 5,
        firstSequenceNumber: 1000,
      }),
    );
    const body = (await response.json()) as {
      invoiceNumberingSettings: InvoiceNumberingSettingsView;
    };

    expect(response.status).toBe(200);
    expect(testContext.getUpdateInput()).toMatchObject({
      companyId: 'dev-company',
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
      sequencePadding: 5,
      firstSequenceNumber: 1000,
    });
    expect(body.invoiceNumberingSettings).toEqual({
      seriesKey: defaultInvoiceNumberSeriesKey,
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
      sequencePadding: 5,
      firstSequenceNumber: 1000,
      hasUsedNumbering: false,
      isPersisted: true,
    });
  });

  it('rejects server-owned request fields', async () => {
    const serverOwnedFields = [
      'companyId',
      'seriesKey',
      'hasUsedNumbering',
      'isPersisted',
      'createdAt',
      'updatedAt',
    ];

    for (const fieldName of serverOwnedFields) {
      const testContext = createTestApp(
        new FakeInvoiceNumberingSettingsRepository(),
      );

      const response = await putJson(
        testContext.app,
        createValidBody({ [fieldName]: 'attacker-value' }),
      );

      expect(response.status, fieldName).toBe(400);
      expect(testContext.getUpdateInput(), fieldName).toBeUndefined();
    }
  });

  it('returns safe 400 when used numbering settings are changed', async () => {
    const testContext = createTestApp(
      new FakeInvoiceNumberingSettingsRepository([createSettings()], true),
    );

    const response = await putJson(
      testContext.app,
      createValidBody({ sequencePadding: 6 }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invoice numbering settings cannot be changed after numbering has been used.',
    });
  });

  it('rejects invalid request bodies safely', async () => {
    const invalidBodies = [
      createValidBody({ mode: 'invalid' }),
      createValidBody({ fiscalYearStartMonth: 13 }),
      createValidBody({ sequencePadding: 13 }),
      createValidBody({ firstSequenceNumber: 0 }),
    ];

    for (const body of invalidBodies) {
      const testContext = createTestApp(
        new FakeInvoiceNumberingSettingsRepository(),
      );
      const response = await putJson(testContext.app, body);

      expect(response.status).toBe(400);
    }
  });

  it('rejects invalid JSON before calling the use case', async () => {
    const testContext = createTestApp(
      new FakeInvoiceNumberingSettingsRepository(),
    );

    const response = await testContext.app.request('/invoice-numbering-settings', {
      body: '{',
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body.',
    });
    expect(testContext.getUpdateInput()).toBeUndefined();
  });

  it('rejects request bodies that exceed the route size limit', async () => {
    const testContext = createTestApp(
      new FakeInvoiceNumberingSettingsRepository(),
    );

    const response = await putJson(testContext.app, {
      ...createValidBody(),
      note: 'x'.repeat(20_000),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: 'Invoice numbering settings body is too large.',
    });
    expect(testContext.getUpdateInput()).toBeUndefined();
  });
});
