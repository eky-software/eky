import { describe, expect, it } from 'vitest';

import { CompanySettingsValidationError } from './companySettingsRules.js';
import { normalizeCompanyEmailSettings } from './companyEmailSettings.js';

describe('normalizeCompanyEmailSettings', () => {
  it('normalizes non-secret SMTP settings', () => {
    expect(
      normalizeCompanyEmailSettings({
        emailDeliveryProvider: 'smtp',
        emailSenderName: '  Example Builder Oy  ',
        emailSenderAddress: '  laskutus@example.fi  ',
        emailSmtpHost: '  SMTP.DNAMAIL.FI  ',
        emailSmtpPort: 587,
        emailSmtpSecurity: 'STARTTLS',
        emailUsername: '  laskutus@example.fi  ',
        emailTestRecipientOverride: '  test@example.fi  ',
      }),
    ).toEqual({
      emailDeliveryProvider: 'smtp',
      emailSenderName: 'Example Builder Oy',
      emailSenderAddress: 'laskutus@example.fi',
      emailSmtpHost: 'smtp.dnamail.fi',
      emailSmtpPort: 587,
      emailSmtpSecurity: 'starttls',
      emailUsername: 'laskutus@example.fi',
      emailTestRecipientOverride: 'test@example.fi',
    });
  });

  it('defaults empty provider and security values to dry-run and STARTTLS', () => {
    expect(
      normalizeCompanyEmailSettings({
        emailDeliveryProvider: '',
        emailSenderName: '',
        emailSenderAddress: '',
        emailSmtpHost: '',
        emailSmtpPort: null,
        emailSmtpSecurity: '',
        emailUsername: '',
        emailTestRecipientOverride: '',
      }),
    ).toMatchObject({
      emailDeliveryProvider: 'dryRun',
      emailSmtpSecurity: 'starttls',
      emailSmtpPort: null,
    });
  });

  it('rejects invalid provider, host, port, security and email values', () => {
    const baseInput = {
      emailDeliveryProvider: 'dryRun',
      emailSenderName: '',
      emailSenderAddress: '',
      emailSmtpHost: '',
      emailSmtpPort: null,
      emailSmtpSecurity: 'starttls',
      emailUsername: '',
      emailTestRecipientOverride: '',
    };

    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailDeliveryProvider: 'webmail' }),
    ).toThrow(CompanySettingsValidationError);
    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailSmtpHost: 'https://smtp.example.fi' }),
    ).toThrow(CompanySettingsValidationError);
    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailSmtpPort: 0 }),
    ).toThrow(CompanySettingsValidationError);
    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailSmtpSecurity: 'plain' }),
    ).toThrow(CompanySettingsValidationError);
    expect(() =>
      normalizeCompanyEmailSettings({ ...baseInput, emailSenderAddress: 'not-email' }),
    ).toThrow(CompanySettingsValidationError);
  });
});
