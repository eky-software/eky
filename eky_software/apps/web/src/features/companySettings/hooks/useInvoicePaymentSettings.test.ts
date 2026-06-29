import {
  EkyApiError,
  type InvoicePaymentSettingsView,
  type UpdateInvoicePaymentSettingsRequest,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoicePaymentSettingsErrorMessage,
  getInvoicePaymentSettingsSaveErrorMessage,
  loadInvoicePaymentSettings,
  saveInvoicePaymentSettings,
} from './useInvoicePaymentSettings.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadInvoicePaymentSettings', () => {
  it('loads invoice payment settings through the API client', async () => {
    const settings = createSettings();
    const apiClient = {
      getInvoicePaymentSettings: vi.fn(async () => settings),
    };

    await expect(loadInvoicePaymentSettings(apiClient)).resolves.toBe(settings);
    expect(apiClient.getInvoicePaymentSettings).toHaveBeenCalledOnce();
  });
});

describe('saveInvoicePaymentSettings', () => {
  it('updates invoice payment settings through the API client', async () => {
    const settings = createSettings({ defaultLatePaymentInterestBasisPoints: 950 });
    const input: UpdateInvoicePaymentSettingsRequest = {
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
    };
    const apiClient = {
      updateInvoicePaymentSettings: vi.fn(async () => settings),
    };

    await expect(saveInvoicePaymentSettings(apiClient, input)).resolves.toBe(settings);
    expect(apiClient.updateInvoicePaymentSettings).toHaveBeenCalledWith(input);
  });
});

describe('invoice payment settings error messages', () => {
  it('returns a safe load error without technical response data', () => {
    const message = getInvoicePaymentSettingsErrorMessage(
      new EkyApiError('SQLITE_INTERNAL_SECRET', {
        responseBody: { stack: 'hidden stack' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.companySettings.invoicePaymentLoadError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });

  it('translates invalid body errors for saving', () => {
    const message = getInvoicePaymentSettingsSaveErrorMessage(
      new EkyApiError('Invalid invoice payment settings body.', {
        responseBody: { stack: 'not rendered' },
        status: 400,
      }),
    );

    expect(message).toBe(
      uiText.apiErrors['Invalid invoice payment settings body.'],
    );
  });
});

function createSettings(
  overrides: Partial<InvoicePaymentSettingsView> = {},
): InvoicePaymentSettingsView {
  return {
    defaultLatePaymentInterestBasisPoints: 0,
    defaultReminderPeriodDays: 8,
    isPersisted: false,
    ...overrides,
  };
}
