import {
  EkyApiError,
  type InvoiceNumberingSettingsView,
  type UpdateInvoiceNumberingSettingsRequest,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoiceNumberingSettingsErrorMessage,
  getInvoiceNumberingSettingsSaveErrorMessage,
  loadInvoiceNumberingSettings,
  saveInvoiceNumberingSettings,
} from './useInvoiceNumberingSettings.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadInvoiceNumberingSettings', () => {
  it('loads invoice numbering settings through the API client', async () => {
    const settings = createSettings();
    const apiClient = {
      getInvoiceNumberingSettings: vi.fn(async () => settings),
    };

    await expect(loadInvoiceNumberingSettings(apiClient)).resolves.toBe(settings);
    expect(apiClient.getInvoiceNumberingSettings).toHaveBeenCalledOnce();
  });
});

describe('saveInvoiceNumberingSettings', () => {
  it('updates invoice numbering settings through the API client', async () => {
    const settings = createSettings({ firstSequenceNumber: 2026001 });
    const input: UpdateInvoiceNumberingSettingsRequest = {
      firstSequenceNumber: 2026001,
      fiscalYearStartMonth: 1,
      mode: 'calendarYearSequence',
      sequencePadding: 3,
    };
    const apiClient = {
      updateInvoiceNumberingSettings: vi.fn(async () => settings),
    };

    await expect(saveInvoiceNumberingSettings(apiClient, input)).resolves.toBe(settings);
    expect(apiClient.updateInvoiceNumberingSettings).toHaveBeenCalledWith(input);
  });
});

describe('invoice numbering settings error messages', () => {
  it('returns a safe load error without technical response data', () => {
    const message = getInvoiceNumberingSettingsErrorMessage(
      new EkyApiError('SQLITE_INTERNAL_SECRET', {
        responseBody: { stack: 'hidden stack' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.companySettings.invoiceNumberingLoadError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });

  it('translates the used-numbering conflict for saving', () => {
    const message = getInvoiceNumberingSettingsSaveErrorMessage(
      new EkyApiError('Invoice numbering settings cannot be changed after numbering has been used.', {
        responseBody: { stack: 'not rendered' },
        status: 409,
      }),
    );

    expect(message).toBe(
      uiText.apiErrors[
        'Invoice numbering settings cannot be changed after numbering has been used.'
      ],
    );
  });
});

function createSettings(
  overrides: Partial<InvoiceNumberingSettingsView> = {},
): InvoiceNumberingSettingsView {
  return {
    firstSequenceNumber: 1,
    fiscalYearStartMonth: 1,
    hasUsedNumbering: false,
    isPersisted: false,
    mode: 'calendarYearSequence',
    sequencePadding: 3,
    seriesKey: 'default',
    ...overrides,
  };
}
