import type { CompanySettings } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { getInvoiceEmailSmtpTestUnavailableMessage } from './invoiceEmailSmtpTestAvailability.js';
import { uiText } from '../../../i18n/fi.js';

describe('getInvoiceEmailSmtpTestUnavailableMessage', () => {
  it('requires the fixed DNA profile and a configured desktop secret', () => {
    const settings = createSettings();

    expect(
      getInvoiceEmailSmtpTestUnavailableMessage(settings, null, false),
    ).toBe(uiText.invoicing.invoiceEmailSmtpTestProfileMissing);
    expect(
      getInvoiceEmailSmtpTestUnavailableMessage(
        { ...settings, emailDeliveryProvider: 'dnaSmtp' },
        null,
        false,
      ),
    ).toBe(uiText.invoicing.invoiceEmailSmtpTestSecretMissing);
  });

  it('allows the test only when the DNA settings and secret are ready', () => {
    expect(
      getInvoiceEmailSmtpTestUnavailableMessage(
        {
          ...createSettings(),
          emailDeliveryProvider: 'dnaSmtp',
          emailSecretConfigured: true,
          emailSenderAddress: 'billing@example.fi',
          emailTestRecipientOverride: 'owner@example.fi',
          emailUsername: 'billing@example.fi',
        },
        null,
        false,
      ),
    ).toBeNull();
  });
});

function createSettings(): CompanySettings {
  return {
    bankName: '',
    bic: '',
    businessId: '',
    city: '',
    companyId: 'company-1',
    companyName: 'Example Oy',
    createdAt: '2026-07-16T10:00:00.000Z',
    defaultHourlyRateCents: null,
    email: '',
    emailDeliveryProvider: 'dryRun',
    emailSecretConfigured: false,
    emailSenderAddress: '',
    emailSenderName: '',
    emailSmtpHost: '',
    emailSmtpPort: null,
    emailSmtpSecurity: 'tls',
    emailTestRecipientOverride: '',
    emailUsername: '',
    hourlyRateShortcut: '',
    iban: '',
    id: 'settings-1',
    phone: '',
    postalCode: '',
    streetAddress: '',
    updatedAt: '2026-07-16T10:00:00.000Z',
    vatNumber: '',
    website: '',
  };
}
