import { Hono } from 'hono';

import { getOptionalStringField, isRecord } from '../../../http/requestBody.js';
import type { GetCompanySettingsInput } from '../application/getCompanySettings.js';
import type { UpdateCompanySettingsInput } from '../application/updateCompanySettings.js';
import type { CompanySettings } from '../domain/companySettings.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';

// Temporary local development company id.
// This is not an authentication, tenant, or permission model.
const devCompanyId = 'dev-company';

interface CompanySettingsRouteDependencies {
  getCompanySettings(input: GetCompanySettingsInput): Promise<CompanySettings>;
  updateCompanySettings(input: UpdateCompanySettingsInput): Promise<CompanySettings>;
}

export function createCompanySettingsRoutes(
  dependencies: CompanySettingsRouteDependencies,
): Hono {
  const routes = new Hono();

  routes.get('/company-settings', async (context) => {
    const companySettings = await dependencies.getCompanySettings({
      companyId: devCompanyId,
    });

    return context.json({ companySettings });
  });

  routes.put('/company-settings', async (context) => {
    let body: unknown;

    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON body.' }, 400);
    }

    if (!isRecord(body)) {
      return context.json({ error: 'Invalid company settings body.' }, 400);
    }

    try {
      const companySettings = await dependencies.updateCompanySettings({
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        companyId: devCompanyId,
        companyName: getOptionalStringField(body, 'companyName'),
        defaultHourlyRateCents: body.defaultHourlyRateCents,
        email: getOptionalStringField(body, 'email'),
        phone: getOptionalStringField(body, 'phone'),
        postalCode: getOptionalStringField(body, 'postalCode'),
        streetAddress: getOptionalStringField(body, 'streetAddress'),
      });

      return context.json({ companySettings });
    } catch (error) {
      if (error instanceof CompanySettingsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  return routes;
}
