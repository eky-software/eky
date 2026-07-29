import { Hono } from 'hono';
import { AuthorizationError } from '@eky/permissions';

import { getOptionalStringField, isRecord } from '../../../http/requestBody.js';
import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetCompanySettingsInput } from '../application/getCompanySettings.js';
import type { UpdateCompanySettingsInput } from '../application/updateCompanySettings.js';
import type { CompanySettings } from '../domain/companySettings.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';

interface CompanySettingsRouteDependencies {
  getCompanySettings(input: GetCompanySettingsInput): Promise<CompanySettings>;
  updateCompanySettings(input: UpdateCompanySettingsInput): Promise<CompanySettings>;
}

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

export function createCompanySettingsRoutes(
  dependencies: CompanySettingsRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/company-settings', async (context) => {
    const actorContext = context.get('actorContext');
    const companySettings = await dependencies.getCompanySettings({
      companyId: actorContext.companyId,
    });

    return context.json({ companySettings });
  });

  routes.put('/company-settings', async (context) => {
    const actorContext = context.get('actorContext');
    const bodyResult = await readJsonRequestBody(context.req, 'required');

    if (!bodyResult.ok) {
      return context.json(
        { error: bodyResult.message },
        bodyResult.status,
      );
    }
    const body = bodyResult.body;

    if (!isRecord(body)) {
      return context.json({ error: 'Invalid company settings body.' }, 400);
    }

    if (
      Object.keys(body).some(
        (fieldName) => !allowedCompanySettingsBodyFields.has(fieldName),
      )
    ) {
      return context.json({ error: 'Invalid company settings body.' }, 400);
    }

    if (
      'emailSmtpHost' in body ||
      'emailSmtpPort' in body ||
      'emailSmtpSecurity' in body
    ) {
      return context.json({ error: 'SMTP connection settings are fixed.' }, 400);
    }

    try {
      const companySettings = await dependencies.updateCompanySettings({
        actorContext,
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        companyName: getOptionalStringField(body, 'companyName'),
        vatNumber: getOptionalStringField(body, 'vatNumber'),
        defaultHourlyRateCents: body.defaultHourlyRateCents,
        hourlyRateShortcut: getOptionalStringField(body, 'hourlyRateShortcut'),
        emailDeliveryProvider: getOptionalStringField(body, 'emailDeliveryProvider'),
        emailSenderName: getOptionalStringField(body, 'emailSenderName'),
        emailSenderAddress: getOptionalStringField(body, 'emailSenderAddress'),
        emailUsername: getOptionalStringField(body, 'emailUsername'),
        emailTestRecipientOverride: getOptionalStringField(
          body,
          'emailTestRecipientOverride',
        ),
        iban: getOptionalStringField(body, 'iban'),
        bic: getOptionalStringField(body, 'bic'),
        bankName: getOptionalStringField(body, 'bankName'),
        email: getOptionalStringField(body, 'email'),
        phone: getOptionalStringField(body, 'phone'),
        website: getOptionalStringField(body, 'website'),
        postalCode: getOptionalStringField(body, 'postalCode'),
        streetAddress: getOptionalStringField(body, 'streetAddress'),
      });

      return context.json({ companySettings });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: error.message }, 403);
      }

      if (error instanceof CompanySettingsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  return routes;
}
