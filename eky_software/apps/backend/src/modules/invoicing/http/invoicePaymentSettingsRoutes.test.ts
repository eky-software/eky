import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';

import {
  getInvoicePaymentSettings,
  type GetInvoicePaymentSettingsInput,
} from '../application/getInvoicePaymentSettings.js';
import type {
  InvoicePaymentSettingsView,
} from '../application/invoicePaymentSettingsView.js';
import {
  updateInvoicePaymentSettings,
  type UpdateInvoicePaymentSettingsInput,
} from '../application/updateInvoicePaymentSettings.js';
import type {
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import type {
  InvoicePaymentSettingsRepository,
} from '../ports/invoicePaymentSettingsRepository.js';
import { createInvoicePaymentSettingsRoutes as createInvoicePaymentSettingsRouteHandlers } from './invoicePaymentSettingsRoutes.js';

function createInvoicePaymentSettingsRoutes(
  dependencies: Parameters<
    typeof createInvoicePaymentSettingsRouteHandlers
  >[0],
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions: [],
      }),
    );
    await next();
  });
  app.route('/', createInvoicePaymentSettingsRouteHandlers(dependencies));

  return app;
}

class FakeInvoicePaymentSettingsRepository
  implements InvoicePaymentSettingsRepository
{
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

function createValidBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    defaultLatePaymentInterestBasisPoints: 950,
    defaultReminderPeriodDays: 8,
    ...overrides,
  };
}

function createTestApp(repository: InvoicePaymentSettingsRepository) {
  let getInput: GetInvoicePaymentSettingsInput | undefined;
  let updateInput: UpdateInvoicePaymentSettingsInput | undefined;
  const app = createInvoicePaymentSettingsRoutes({
    async getInvoicePaymentSettings(input) {
      getInput = input;

      return getInvoicePaymentSettings(input, repository);
    },
    async updateInvoicePaymentSettings(input) {
      updateInput = input;

      return updateInvoicePaymentSettings(input, repository);
    },
  });

  return {
    app,
    getGetInput: () => getInput,
    getUpdateInput: () => updateInput,
  };
}

async function putJson(
  app: ReturnType<typeof createInvoicePaymentSettingsRoutes>,
  body: unknown,
): Promise<Response> {
  return app.request('/invoice-payment-settings', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  });
}

describe('invoicePaymentSettingsRoutes', () => {
  it('gets settings with the backend company context', async () => {
    const testContext = createTestApp(
      new FakeInvoicePaymentSettingsRepository([
        createSettings({ defaultLatePaymentInterestBasisPoints: 1050 }),
      ]),
    );

    const response = await testContext.app.request(
      '/invoice-payment-settings?companyId=other-company',
    );
    const body = (await response.json()) as {
      invoicePaymentSettings: InvoicePaymentSettingsView;
    };

    expect(response.status).toBe(200);
    expect(testContext.getGetInput()).toEqual({ companyId: 'dev-company' });
    expect(body.invoicePaymentSettings).toMatchObject({
      defaultLatePaymentInterestBasisPoints: 1050,
      isPersisted: true,
    });
  });

  it('returns default settings when no persisted settings exist', async () => {
    const testContext = createTestApp(
      new FakeInvoicePaymentSettingsRepository(),
    );

    const response = await testContext.app.request('/invoice-payment-settings');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invoicePaymentSettings: {
        defaultLatePaymentInterestBasisPoints: 0,
        defaultReminderPeriodDays: 8,
        isPersisted: false,
      },
    });
  });

  it('saves valid settings without trusting request companyId', async () => {
    const testContext = createTestApp(
      new FakeInvoicePaymentSettingsRepository(),
    );

    const response = await putJson(
      testContext.app,
      createValidBody({
        companyId: 'other-company',
      }),
    );

    expect(response.status).toBe(400);

    const validResponse = await putJson(testContext.app, createValidBody());
    const body = (await validResponse.json()) as {
      invoicePaymentSettings: InvoicePaymentSettingsView;
    };

    expect(validResponse.status).toBe(200);
    expect(testContext.getUpdateInput()).toMatchObject({
      companyId: 'dev-company',
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
    });
    expect(body.invoicePaymentSettings).toMatchObject({
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
      isPersisted: true,
    });
  });

  it('rejects invalid body shapes', async () => {
    const testContext = createTestApp(
      new FakeInvoicePaymentSettingsRepository(),
    );

    const response = await putJson(
      testContext.app,
      createValidBody({ defaultReminderPeriodDays: '8' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid invoice payment settings body.',
    });
  });

  it('rejects invalid values from the domain validation', async () => {
    const testContext = createTestApp(
      new FakeInvoicePaymentSettingsRepository(),
    );

    const response = await putJson(
      testContext.app,
      createValidBody({ defaultLatePaymentInterestBasisPoints: -1 }),
    );

    expect(response.status).toBe(400);
  });
});
