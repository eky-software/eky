import { describe, expect, it } from 'vitest';

import { CompanySettingsValidationError } from './companySettingsRules.js';
import { normalizeCompanyEmailSettings } from './companyEmailSettings.js';

describe('normalizeCompanyEmailSettings', () => {
  it('normalizes the fixed non-secret DNA SMTP profile', () => {
    expect(
      normalizeCompanyEmailSettings({
        emailDeliveryProvider: 'dnaSmtp',
        emailSenderName: '  Example Builder Oy  ',
        emailSenderAddress: '  laskutus@example.fi  ',
        emailUsername: '  laskutus@example.fi  ',
        emailTestRecipientOverride: '  test@example.fi  ',
      }),
    ).toEqual({
      emailDeliveryProvider: 'dnaSmtp',
      emailSenderName: 'Example Builder Oy',
      emailSenderAddress: 'laskutus@example.fi',
      emailSmtpHost: 'smtp.dnamail.fi',
      emailSmtpPort: 465,
      emailSmtpSecurity: 'tls',
      emailUsername: 'laskutus@example.fi',
      emailTestRecipientOverride: 'test@example.fi',
    });
  });

  it('defaults an empty provider to dry-run without a configurable SMTP endpoint', () => {
    expect(
      normalizeCompanyEmailSettings({
        emailDeliveryProvider: '',
        emailSenderName: '',
        emailSenderAddress: '',
        emailUsername: '',
        emailTestRecipientOverride: '',
      }),
    ).toMatchObject({
      emailDeliveryProvider: 'dryRun',
      emailSmtpHost: '',
      emailSmtpSecurity: 'tls',
      emailSmtpPort: null,
    });
  });

  it('rejects invalid providers, email values, and mismatched DNA identities', () => {
    const baseInput = {
      emailDeliveryProvider: 'dryRun',
      emailSenderName: '',
      emailSenderAddress: '',
      emailUsername: '',
      emailTestRecipientOverride: '',
    };

    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailDeliveryProvider: 'webmail' }),
    ).toThrow(CompanySettingsValidationError);
    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailSenderAddress: 'not-email' }),
    ).toThrow(CompanySettingsValidationError);
    expect(() =>
      normalizeCompanyEmailSettings({
        ...baseInput,
        emailDeliveryProvider: 'dnaSmtp',
        emailSenderAddress: 'sender@example.fi',
        emailUsername: 'other@example.fi',
      }),
    ).toThrow(CompanySettingsValidationError);
  });
});
