import { describe, expect, it } from 'vitest';

import {
  euroInputToCents,
  formatCompanyIbanInput,
  initialCompanySettingsForm,
  normalizeCompanyEmailAddressInput,
  normalizeCompanyBicInput,
  normalizeCompanyIbanInput,
  normalizeCompanySmtpHostInput,
  normalizeCompanyVatNumberInput,
  parseCompanySmtpPortInput,
  toCompanySettingsForm,
  toUpdateCompanySettingsRequest,
} from './companySettingsFormModel.js';

describe('companySettingsFormModel', () => {
  it('maps API settings to form values', () => {
    expect(
      toCompanySettingsForm({
        id: 'company-settings-1',
        companyId: 'dev-company',
        companyName: 'Example Builder Oy',
        businessId: '1234567-8',
        vatNumber: 'FI12345678',
        streetAddress: 'Testikatu 1',
        postalCode: '00100',
        city: 'Helsinki',
        email: 'info@example.fi',
        phone: '040 123 4567',
        website: 'www.example.fi',
        emailDeliveryProvider: 'smtp',
        emailSenderName: 'Example Builder Oy',
        emailSenderAddress: 'laskutus@example.fi',
        emailSmtpHost: 'smtp.dnamail.fi',
        emailSmtpPort: 587,
        emailSmtpSecurity: 'starttls',
        emailUsername: 'laskutus@example.fi',
        emailTestRecipientOverride: 'test@example.fi',
        emailSecretConfigured: false,
        defaultHourlyRateCents: 6500,
        hourlyRateShortcut: 'työ',
        iban: 'FI2112345600000785',
        bic: 'NDEAFIHH',
        bankName: 'Test Bank',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      }),
    ).toEqual({
      businessId: '1234567-8',
      city: 'Helsinki',
      companyName: 'Example Builder Oy',
      defaultHourlyRateEuro: '65,00',
      vatNumber: 'FI12345678',
      hourlyRateShortcut: 'työ',
      iban: 'FI21 1234 5600 0007 85',
      bic: 'NDEAFIHH',
      bankName: 'Test Bank',
      email: 'info@example.fi',
      phone: '040 123 4567',
      website: 'www.example.fi',
      emailDeliveryProvider: 'smtp',
      emailSenderName: 'Example Builder Oy',
      emailSenderAddress: 'laskutus@example.fi',
      emailSmtpHost: 'smtp.dnamail.fi',
      emailSmtpPort: '587',
      emailSmtpSecurity: 'starttls',
      emailUsername: 'laskutus@example.fi',
      emailTestRecipientOverride: 'test@example.fi',
      emailSecretConfigured: false,
      postalCode: '00100',
      streetAddress: 'Testikatu 1',
    });
  });

  it('maps an empty hourly rate to null cents', () => {
    expect(
      toUpdateCompanySettingsRequest({
        ...initialCompanySettingsForm,
      companyName: 'Example Builder Oy',
    }),
    ).toEqual({
      businessId: '',
      city: '',
      companyName: 'Example Builder Oy',
      vatNumber: '',
      defaultHourlyRateCents: null,
      hourlyRateShortcut: '',
      iban: '',
      bic: '',
      bankName: '',
      email: '',
      emailDeliveryProvider: 'dryRun',
      emailSenderName: '',
      emailSenderAddress: '',
      emailSmtpHost: '',
      emailSmtpPort: null,
      emailSmtpSecurity: 'starttls',
      emailUsername: '',
      emailTestRecipientOverride: '',
      phone: '',
      website: '',
      postalCode: '',
      streetAddress: '',
    });
  });

  it('parses euro input to whole cents', () => {
    expect(euroInputToCents('65')).toBe(6500);
    expect(euroInputToCents('65,50')).toBe(6550);
    expect(euroInputToCents('65.05')).toBe(6505);
    expect(euroInputToCents('0')).toBe(0);
  });

  it('rejects invalid euro input', () => {
    expect(() => euroInputToCents('65,555')).toThrow('Invalid hourly rate.');
    expect(() => euroInputToCents('abc')).toThrow('Invalid hourly rate.');
  });

  it('normalizes bank detail input for the update request', () => {
    expect(
      toUpdateCompanySettingsRequest({
        ...initialCompanySettingsForm,
        iban: ' fi21 1234 5600 0007 85 ',
        bic: ' ndeafihh ',
        bankName: '  Test Bank  ',
        website: '  www.example.fi  ',
      }),
    ).toMatchObject({
      iban: 'FI2112345600000785',
      bic: 'NDEAFIHH',
      bankName: 'Test Bank',
      website: 'www.example.fi',
    });
  });

  it('formats company IBAN for easier reading in the form', () => {
    expect(formatCompanyIbanInput('FI2112345600000785')).toBe(
      'FI21 1234 5600 0007 85',
    );
  });

  it('normalizes company VAT number input for the update request', () => {
    expect(
      toUpdateCompanySettingsRequest({
        ...initialCompanySettingsForm,
        vatNumber: '  fi12345678  ',
      }),
    ).toMatchObject({
      vatNumber: 'FI12345678',
    });
  });

  it('normalizes email delivery settings for the update request', () => {
    expect(
      toUpdateCompanySettingsRequest({
        ...initialCompanySettingsForm,
        emailDeliveryProvider: 'smtp',
        emailSenderName: '  Example Builder Oy  ',
        emailSenderAddress: '  laskutus@example.fi  ',
        emailSmtpHost: '  SMTP.DNAMAIL.FI  ',
        emailSmtpPort: '587',
        emailSmtpSecurity: 'starttls',
        emailUsername: '  laskutus@example.fi  ',
        emailTestRecipientOverride: '  test@example.fi  ',
      }),
    ).toMatchObject({
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

  it('rejects clearly invalid bank detail input', () => {
    expect(() => normalizeCompanyIbanInput('bad')).toThrow(
      'Invalid company IBAN.',
    );
    expect(() => normalizeCompanyBicInput('bad')).toThrow(
      'Invalid company BIC.',
    );
  });

  it('rejects invalid VAT number input', () => {
    expect(normalizeCompanyVatNumberInput('')).toBe('');
    expect(() => normalizeCompanyVatNumberInput('1234567-8')).toThrow(
      'Invalid company VAT number.',
    );
  });

  it('rejects invalid email delivery setting input', () => {
    expect(parseCompanySmtpPortInput('')).toBeNull();
    expect(() => parseCompanySmtpPortInput('0')).toThrow('Invalid company SMTP port.');
    expect(() => normalizeCompanySmtpHostInput('https://smtp.example.fi')).toThrow(
      'Invalid company SMTP host.',
    );
    expect(() =>
      normalizeCompanyEmailAddressInput('bad', 'Invalid company email sender address.'),
    ).toThrow('Invalid company email sender address.');
  });
});
