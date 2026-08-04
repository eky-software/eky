import {
  hasOnlyAllowedFields,
  isRecord,
  readOptionalStringFields,
} from '../../../http/requestBody.js';
import type { UpdateCompanySettingsInput } from '../application/updateCompanySettings.js';

type ParsedCompanySettingsRequest = Omit<
  UpdateCompanySettingsInput,
  'actorContext'
>;

export type CompanySettingsRequestResult =
  | { ok: true; input: ParsedCompanySettingsRequest }
  | { ok: false; reason: 'fixedSmtpSettings' | 'invalidBody' };

const allowedCompanySettingsBodyFields = new Set([
  'bankName',
  'bic',
  'businessId',
  'city',
  'companyName',
  'defaultHourlyRateCents',
  'email',
  'emailDeliveryProvider',
  'emailSenderAddress',
  'emailSenderName',
  'emailSmtpHost',
  'emailSmtpPort',
  'emailSmtpSecurity',
  'emailTestRecipientOverride',
  'emailUsername',
  'hourlyRateShortcut',
  'iban',
  'phone',
  'postalCode',
  'streetAddress',
  'vatNumber',
  'website',
]);

const companySettingsStringFields = [
  'bankName',
  'bic',
  'businessId',
  'city',
  'companyName',
  'email',
  'emailDeliveryProvider',
  'emailSenderAddress',
  'emailSenderName',
  'emailTestRecipientOverride',
  'emailUsername',
  'hourlyRateShortcut',
  'iban',
  'phone',
  'postalCode',
  'streetAddress',
  'vatNumber',
  'website',
] as const;

export function parseCompanySettingsRequest(
  body: unknown,
): CompanySettingsRequestResult {
  if (
    !isRecord(body) ||
    !hasOnlyAllowedFields(body, allowedCompanySettingsBodyFields)
  ) {
    return { ok: false, reason: 'invalidBody' };
  }

  if (
    'emailSmtpHost' in body ||
    'emailSmtpPort' in body ||
    'emailSmtpSecurity' in body
  ) {
    return { ok: false, reason: 'fixedSmtpSettings' };
  }

  const fields = readOptionalStringFields(body, companySettingsStringFields);

  if (fields === null) {
    return { ok: false, reason: 'invalidBody' };
  }

  return {
    ok: true,
    input: {
      bankName: fields.bankName,
      bic: fields.bic,
      businessId: fields.businessId,
      city: fields.city,
      companyName: fields.companyName,
      defaultHourlyRateCents: body.defaultHourlyRateCents,
      email: fields.email,
      emailDeliveryProvider: fields.emailDeliveryProvider,
      emailSenderAddress: fields.emailSenderAddress,
      emailSenderName: fields.emailSenderName,
      emailTestRecipientOverride: fields.emailTestRecipientOverride,
      emailUsername: fields.emailUsername,
      hourlyRateShortcut: fields.hourlyRateShortcut,
      iban: fields.iban,
      phone: fields.phone,
      postalCode: fields.postalCode,
      streetAddress: fields.streetAddress,
      vatNumber: fields.vatNumber,
      website: fields.website,
    },
  };
}
