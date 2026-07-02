import { EkyApiError, type InvoicePaymentSettingsView } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoicePaymentDefaultsErrorMessage,
  loadInvoicePaymentDefaults,
} from './useInvoicePaymentDefaults.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadInvoicePaymentDefaults', () => {
  it('loads invoice payment defaults with api-client', async () => {
    const settings = createPaymentSettings();
    const apiClient = {
      getInvoicePaymentSettings: vi.fn(async () => settings),
    };

    await expect(loadInvoicePaymentDefaults(apiClient)).resolves.toBe(settings);
    expect(apiClient.getInvoicePaymentSettings).toHaveBeenCalledWith();
  });
});

describe('getInvoicePaymentDefaultsErrorMessage', () => {
  it('returns a safe Finnish fallback error', () => {
    const error = new EkyApiError('Unexpected response.', {
      responseBody: { stack: 'hidden' },
    });

    const message = getInvoicePaymentDefaultsErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoicePaymentSettingsLoadError);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});

function createPaymentSettings(): InvoicePaymentSettingsView {
  return {
    defaultLatePaymentInterestBasisPoints: 950,
    defaultReminderPeriodDays: 8,
    isPersisted: true,
  };
}
