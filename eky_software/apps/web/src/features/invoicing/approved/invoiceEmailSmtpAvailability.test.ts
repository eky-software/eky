import type { CompanySettings } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { getInvoiceEmailSmtpUnavailableMessage } from './invoiceEmailSmtpAvailability.js';
import { uiText } from '../../../i18n/fi.js';

describe('getInvoiceEmailSmtpUnavailableMessage', () => {
  it('allows customer SMTP delivery only with a complete DNA profile and secret', () => {
    expect(
      getInvoiceEmailSmtpUnavailableMessage(createSettings(), null, false),
    ).toBeNull();
  });

  it('does not require the SMTP test recipient for customer delivery', () => {
    expect(
      getInvoiceEmailSmtpUnavailableMessage(
        createSettings({ emailTestRecipientOverride: '' }),
        null,
        false,
      ),
    ).toBeNull();
  });

  it('keeps actual delivery disabled while the secret status is unavailable', () => {
    expect(
      getInvoiceEmailSmtpUnavailableMessage(
        createSettings({ emailSecretConfigured: false }),
        null,
        false,
      ),
    ).toBe(uiText.invoicing.invoiceEmailSmtpSecretMissing);
  });

  it('keeps actual delivery disabled for dry-run settings', () => {
    expect(
      getInvoiceEmailSmtpUnavailableMessage(
        createSettings({ emailDeliveryProvider: 'dryRun' }),
        null,
        false,
      ),
    ).toBe(uiText.invoicing.invoiceEmailSmtpProfileMissing);
  });

  it('does not expose a settings error to the user', () => {
    const technicalMessage = 'secret path C:\\must-not-leak';
    const message = getInvoiceEmailSmtpUnavailableMessage(
      null,
      technicalMessage,
      false,
    );

    expect(message).toBe(
      uiText.invoicing.invoiceEmailSmtpSettingsUnavailable,
    );
    expect(message).not.toContain(technicalMessage);
  });
});

function createSettings(
  overrides: Partial<CompanySettings> = {},
): CompanySettings {
  return {
    bankName: '',
    bic: '',
    businessId: '1234567-8',
    city: 'Turku',
    companyId: 'company-1',
    companyName: 'Example Oy',
    createdAt: '2026-07-17T22:00:00.000Z',
    defaultHourlyRateCents: 6500,
    email: 'billing@example.fi',
    emailDeliveryProvider: 'dnaSmtp',
    emailSecretConfigured: true,
    emailSenderAddress: 'billing@example.fi',
    emailSenderName: 'Example Oy',
    emailSmtpHost: 'smtp.dnamail.fi',
    emailSmtpPort: 465,
    emailSmtpSecurity: 'tls',
    emailTestRecipientOverride: 'owner@example.fi',
    emailUsername: 'billing@example.fi',
    hourlyRateShortcut: 'työ',
    iban: '',
    id: 'settings-1',
    phone: '',
    postalCode: '20100',
    streetAddress: 'Katu 1',
    updatedAt: '2026-07-17T22:00:00.000Z',
    vatNumber: 'FI12345678',
    website: '',
    ...overrides,
  };
}
