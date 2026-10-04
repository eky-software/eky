import { createActorContext } from '@eky/auth';
import { AuthorizationError, type Permission } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanySettings } from '../domain/companySettings.js';
import type { CompanySettingsAuditEvent } from '../domain/companySettingsAuditEvent.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';
import {
  updateCompanySettings,
  type UpdateCompanySettingsInput,
} from './updateCompanySettings.js';

class FakeCompanySettingsRepository implements CompanySettingsRepository {
  savedAuditEvent: CompanySettingsAuditEvent | undefined;
  savedSettings: CompanySettings | undefined;

  async findByCompanyId(): Promise<CompanySettings | null> {
    return null;
  }

  async upsertCompanySettings(
    settings: CompanySettings,
    auditEvent: CompanySettingsAuditEvent,
  ): Promise<CompanySettings> {
    this.savedAuditEvent = auditEvent;
    this.savedSettings = settings;

    return settings;
  }
}

describe('updateCompanySettings', () => {
  it('normalizes and saves settings through the repository port', async () => {
    const repository = new FakeCompanySettingsRepository();

    const settings = await updateCompanySettings(
      {
        actorContext: createCompanySettingsActorContext(),
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        companyName: '  Example Builder Oy  ',
        vatNumber: '  fi12345678  ',
        defaultHourlyRateCents: 6500,
        hourlyRateShortcut: '  työ  ',
        iban: ' fi21 1234 5600 0007 85 ',
        bic: ' ndeafihh ',
        bankName: '  Test Bank  ',
        email: '  info@example.fi  ',
        emailDeliveryProvider: 'dnaSmtp',
        emailSenderName: '  Example Builder Oy  ',
        emailSenderAddress: '  laskutus@example.fi  ',
        emailUsername: '  laskutus@example.fi  ',
        emailTestRecipientOverride: '  test@example.fi  ',
        phone: '  040 123 4567  ',
        website: '  www.example.fi  ',
        postalCode: '  00100  ',
        streetAddress: '  Testikatu 1  ',
      },
      repository,
    );

    expect(repository.savedSettings).toEqual(settings);
    expect(repository.savedAuditEvent).toMatchObject({
      action: 'companySettings.updated',
      actorUserId: 'local-owner',
      changedFieldCategories: [
        'identity',
        'address',
        'contact',
        'banking',
        'invoicingDefaults',
        'emailConfiguration',
      ],
      companyId: 'dev-company',
      outcome: 'success',
    });
    expect(settings.id).toEqual(expect.any(String));
    expect(settings.companyId).toBe('dev-company');
    expect(settings.companyName).toBe('Example Builder Oy');
    expect(settings.businessId).toBe('1234567-8');
    expect(settings.vatNumber).toBe('FI12345678');
    expect(settings.streetAddress).toBe('Testikatu 1');
    expect(settings.postalCode).toBe('00100');
    expect(settings.city).toBe('Helsinki');
    expect(settings.email).toBe('info@example.fi');
    expect(settings.emailDeliveryProvider).toBe('dnaSmtp');
    expect(settings.emailSenderName).toBe('Example Builder Oy');
    expect(settings.emailSenderAddress).toBe('laskutus@example.fi');
    expect(settings.emailSmtpHost).toBe('smtp.dnamail.fi');
    expect(settings.emailSmtpPort).toBe(465);
    expect(settings.emailSmtpSecurity).toBe('tls');
    expect(settings.emailUsername).toBe('laskutus@example.fi');
    expect(settings.emailTestRecipientOverride).toBe('test@example.fi');
    expect(settings.emailSecretConfigured).toBe(false);
    expect(settings.phone).toBe('040 123 4567');
    expect(settings.website).toBe('www.example.fi');
    expect(settings.defaultHourlyRateCents).toBe(6500);
    expect(settings.hourlyRateShortcut).toBe('työ');
    expect(settings.iban).toBe('FI2112345600000785');
    expect(settings.bic).toBe('NDEAFIHH');
    expect(settings.bankName).toBe('Test Bank');
    expect(settings.createdAt).toEqual(expect.any(String));
    expect(settings.updatedAt).toEqual(expect.any(String));
    expect(settings.createdAt).toBe(settings.updatedAt);
  });

  it('keeps null as an unset default hourly rate', async () => {
    const settings = await updateCompanySettings(
      {
        actorContext: createCompanySettingsActorContext(),
        businessId: '',
        city: '',
        companyName: '',
        vatNumber: '',
        defaultHourlyRateCents: null,
        hourlyRateShortcut: '',
        iban: '',
        bic: '',
        bankName: '',
        email: '',
        emailDeliveryProvider: '',
        emailSenderName: '',
        emailSenderAddress: '',
        emailUsername: '',
        emailTestRecipientOverride: '',
        phone: '',
        website: '',
        postalCode: '',
        streetAddress: '',
      },
      new FakeCompanySettingsRepository(),
    );

    expect(settings.defaultHourlyRateCents).toBeNull();
  });

  it('denies updates without the company settings permission', async () => {
    const repository = new FakeCompanySettingsRepository();

    await expect(
      updateCompanySettings(
        {
          actorContext: createCompanySettingsActorContext([]),
          businessId: '',
          city: '',
          companyName: '',
          vatNumber: '',
          defaultHourlyRateCents: null,
          hourlyRateShortcut: '',
          iban: '',
          bic: '',
          bankName: '',
          email: '',
          emailDeliveryProvider: '',
          emailSenderName: '',
          emailSenderAddress: '',
          emailUsername: '',
          emailTestRecipientOverride: '',
          phone: '',
          website: '',
          postalCode: '',
          streetAddress: '',
        },
        repository,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.savedSettings).toBeUndefined();
  });

  it.each<{ name: string; permissions: Permission[] }>([
    { name: 'no permissions', permissions: [] },
    { name: 'secret permission only', permissions: ['manageCompanyEmailSecret'] },
    { name: 'email settings permission only', permissions: ['manageCompanyEmailSettings'] },
  ])('does not read secret status with $name', async ({ permissions }) => {
    const repository = new FakeCompanySettingsRepository();
    const findByCompanyId = vi.spyOn(repository, 'findByCompanyId');
    const hasSecret = vi.fn(async () => true);

    await expect(
      updateCompanySettings(
        {
          ...createValidInput(),
          actorContext: createCompanySettingsActorContext(permissions),
          streetAddress: 'x'.repeat(201),
        },
        repository,
        { hasSecret },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(hasSecret).not.toHaveBeenCalled();
    expect(findByCompanyId).not.toHaveBeenCalled();
    expect(repository.savedSettings).toBeUndefined();
    expect(repository.savedAuditEvent).toBeUndefined();
  });

  it.each<[keyof Omit<UpdateCompanySettingsInput, 'actorContext'>, unknown]>([
    ['businessId', 'x'.repeat(201)],
    ['city', 'x'.repeat(201)],
    ['companyName', 'x'.repeat(201)],
    ['vatNumber', 'not-a-vat-number'],
    ['defaultHourlyRateCents', -1],
    ['defaultHourlyRateCents', '6500'],
    ['hourlyRateShortcut', 'two\nlines'],
    ['iban', 'not-an-iban'],
    ['bic', 'not-a-bic'],
    ['bankName', 'x'.repeat(201)],
    ['email', 'x'.repeat(201)],
    ['emailDeliveryProvider', 'unsupported-provider'],
    ['emailDeliveryProvider', 'dnaSmtp'],
    ['emailSenderName', 'two\nlines'],
    ['emailSenderAddress', 'not-an-email'],
    ['emailUsername', 'not-an-email'],
    ['emailTestRecipientOverride', 'not-an-email'],
    ['phone', 'x'.repeat(201)],
    ['website', 'x'.repeat(201)],
    ['postalCode', 'x'.repeat(201)],
    ['streetAddress', 'x'.repeat(201)],
  ])('validates %s before reading secret status or the repository', async (field, value) => {
    const repository = new FakeCompanySettingsRepository();
    const findByCompanyId = vi.spyOn(repository, 'findByCompanyId');
    const hasSecret = vi.fn(async () => true);

    await expect(
      updateCompanySettings(
        { ...createValidInput(), [field]: value },
        repository,
        { hasSecret },
      ),
    ).rejects.toBeInstanceOf(CompanySettingsValidationError);

    expect(hasSecret).not.toHaveBeenCalled();
    expect(findByCompanyId).not.toHaveBeenCalled();
    expect(repository.savedSettings).toBeUndefined();
    expect(repository.savedAuditEvent).toBeUndefined();
  });
});

function createCompanySettingsActorContext(
  permissions: Permission[] = ['manageCompanySettings'],
) {
  return createActorContext({
    actorId: 'local-owner',
    authenticationMode: 'local',
    companyId: 'dev-company',
    permissions,
  });
}

function createValidInput(): UpdateCompanySettingsInput {
  return {
    actorContext: createCompanySettingsActorContext(),
    businessId: '',
    city: '',
    companyName: 'Synthetic Company',
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
    emailUsername: '',
    emailTestRecipientOverride: '',
    phone: '',
    website: '',
    postalCode: '',
    streetAddress: '',
  };
}
