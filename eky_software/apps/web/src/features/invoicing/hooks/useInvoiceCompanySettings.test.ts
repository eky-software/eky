import { EkyApiError, type CompanySettings } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoiceCompanySettingsErrorMessage,
  loadInvoiceCompanySettings,
} from './useInvoiceCompanySettings.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadInvoiceCompanySettings', () => {
  it('loads company settings through the API client', async () => {
    const settings = createCompanySettings();
    const apiClient = {
      getCompanySettings: vi.fn(async () => settings),
    };

    await expect(loadInvoiceCompanySettings(apiClient)).resolves.toBe(settings);
    expect(apiClient.getCompanySettings).toHaveBeenCalledOnce();
  });
});

describe('getInvoiceCompanySettingsErrorMessage', () => {
  it('does not expose an unknown API response body or technical message', () => {
    const message = getInvoiceCompanySettingsErrorMessage(
      new EkyApiError('SQLITE_SECRET_DETAIL', {
        responseBody: { stack: 'hidden stack' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.companySettingsLoadError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });
});

function createCompanySettings(): CompanySettings {
  return {
    businessId: '',
    city: '',
    companyId: 'dev-company',
    companyName: 'Example Builder Oy',
    createdAt: '2026-06-25T00:00:00.000Z',
    defaultHourlyRateCents: 6500,
    email: '',
    hourlyRateShortcut: 'työ',
    id: 'settings-1',
    phone: '',
    postalCode: '',
    streetAddress: '',
    updatedAt: '2026-06-25T00:00:00.000Z',
  };
}
